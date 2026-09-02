
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { splitIntoChunks } = require('./subtitle');

const TEMPLATE_DIR = path.resolve(__dirname, '../templates');
const TEMPLATE_HTML = path.join(TEMPLATE_DIR, 'index.html');
const FPS = 30;

/**
 * renderUIOverlay
 * @param {Object[]} scenes  - Array of scene objects from the /render request
 * @param {string}   workDir - Temp workspace path e.g. /tmp/ffmpeg-job-<uuid>
 * @returns {string}         - Absolute path to ui_overlay.webm
 */
async function renderUIOverlay(scenes, workDir) {
    const framesDir = path.join(workDir, 'ui_frames');
    fs.mkdirSync(framesDir, { recursive: true });

    const browserOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1080,1920',
            // Allow transparent background rendering
            '--force-color-profile=srgb',
        ],
        defaultViewport: { width: 1080, height: 1920 },
    };

    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    console.log('[render-ui] Launching Chromium...');
    const browser = await puppeteer.launch(browserOptions);

    let globalFrameIndex = 0;

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        // Support both "visual_element" (correct) and "vissual_element" (typo in request)
        const visual_element = scene.visual_element || scene.vissual_element || { type: 'text_only', data: '' };
        const { caption, duration_seconds } = scene;

        console.log(`[render-ui] Scene ${i + 1}/${scenes.length} — type: ${visual_element.type} — duration: ${duration_seconds}s`);

        // ── Build chunk list with start/end times ──
        // Priority: caption_timestamps (from TTS) > caption_chunks > auto-split
        let timedChunks; // Array of { text, start, end } (seconds relative to scene start)

        if (scene.caption_timestamps && scene.caption_timestamps.length > 0) {
            // Option A: TTS-provided word-level timestamps (perfect sync)
            timedChunks = scene.caption_timestamps.map(ts => ({
                text: ts.text,
                start: ts.start,
                end: ts.end,
            }));
            console.log(`[render-ui]   Using TTS timestamps: ${timedChunks.length} chunks`);
        } else {
            // Fallback: auto-split and distribute proportionally by character length
            const chunks = scene.caption_chunks && scene.caption_chunks.length > 0
                ? scene.caption_chunks
                : splitIntoChunks(caption || '');

            const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
            let cursor = 0;
            timedChunks = chunks.map(chunk => {
                const ratio = totalChars > 0 ? (chunk.length / totalChars) : (1 / chunks.length);
                const chunkDuration = duration_seconds * ratio;
                const entry = { text: chunk, start: cursor, end: cursor + chunkDuration };
                cursor += chunkDuration;
                return entry;
            });
            console.log(`[render-ui]   Using proportional timing (no TTS timestamps): ${timedChunks.length} chunks`);
        }

        timedChunks.forEach((tc, j) => {
            console.log(`[render-ui]     Chunk ${j + 1}: "${tc.text}" [${tc.start.toFixed(2)}s → ${tc.end.toFixed(2)}s]`);
        });

        // Write per-scene data.js — initial caption is first chunk
        const sceneData = {
            type: visual_element.type,
            language: visual_element.language || null,
            data: visual_element.data || null,
            caption: timedChunks[0]?.text || '',
            layout_mode: scene.layout_mode || 'split_bottom_captions',
        };

        const dataJsContent = `window.SCENE_DATA = ${JSON.stringify(sceneData)};`;
        fs.writeFileSync(path.join(TEMPLATE_DIR, 'data.js'), dataJsContent, 'utf8');

        const page = await browser.newPage();

        // Load the template (file:// protocol so local scripts load)
        await page.goto(`file://${TEMPLATE_HTML}`, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait for Prism / Mermaid to finish rendering
        await waitForRenderComplete(page);

        // ── Capture frames with chunk-by-chunk caption updates ──
        const totalFrames = Math.round(duration_seconds * FPS);
        let currentChunkIndex = 0;

        for (let f = 0; f < totalFrames; f++) {
            // Determine which chunk this frame belongs to using start/end timestamps
            const elapsedSeconds = f / FPS;
            let targetChunkIndex = timedChunks.length - 1; // default to last chunk
            for (let c = 0; c < timedChunks.length; c++) {
                if (elapsedSeconds < timedChunks[c].end) {
                    targetChunkIndex = c;
                    break;
                }
            }

            // Update the caption text in the DOM only when the chunk changes
            if (targetChunkIndex !== currentChunkIndex || f === 0) {
                currentChunkIndex = targetChunkIndex;
                const newText = timedChunks[currentChunkIndex]?.text || '';
                await page.evaluate((text) => {
                    document.getElementById('caption-text').textContent = text;
                }, newText);
            }

            const framePath = path.join(framesDir, `frame_${String(globalFrameIndex).padStart(6, '0')}.png`);
            await page.screenshot({
                path: framePath,
                type: 'png',
                omitBackground: true, // keeps alpha channel
                fullPage: false,
                clip: { x: 0, y: 0, width: 1080, height: 1920 },
            });
            globalFrameIndex++;
        }

        await page.close();
        console.log(`[render-ui] Scene ${i + 1} captured — ${totalFrames} frames, ${timedChunks.length} caption chunks.`);
    }

    await browser.close();

    // Assemble PNG frames into a transparent WebM using FFmpeg
    const overlayPath = path.join(workDir, 'ui_overlay.webm');
    const ffmpegCmd = [
        'ffmpeg -y',
        `-framerate ${FPS}`,
        `-i "${path.join(framesDir, 'frame_%06d.png')}"`,
        '-c:v libvpx-vp9',
        '-pix_fmt yuva420p',  // VP9 with alpha channel
        '-b:v 3M',
        '-auto-alt-ref 0',    // required for alpha in VP9
        `"${overlayPath}"`,
    ].join(' ');

    console.log('[render-ui] Assembling PNG frames into WebM...');
    execSync(ffmpegCmd, { stdio: 'inherit' });

    // Cleanup frame PNGs to save disk space
    fs.rmSync(framesDir, { recursive: true, force: true });

    console.log(`[render-ui] ui_overlay.webm ready: ${overlayPath}`);
    return overlayPath;
}

/**
 * Wait until script.js sets window.__RENDER_COMPLETE__ = true
 * or timeout after 8 seconds (safety net for Mermaid async render)
 */
async function waitForRenderComplete(page, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const done = await page.evaluate(() => window.__RENDER_COMPLETE__ === true);
        if (done) return;
        await sleep(150);
    }
    // Timeout — proceed anyway (usually fine for text_only scenes)
    console.warn('[render-ui] waitForRenderComplete timed out — proceeding.');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { renderUIOverlay };