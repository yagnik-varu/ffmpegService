
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { splitIntoChunks } = require('./subtitle');
const { buildHighlightedHTML } = require('./services/captions/highlightWords');

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
            diagram_steps: visual_element.diagram_steps || null,
            emotion: scene.visual_effects?.emotion || null,
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

        // Read important_words once before the frame loop (no per-frame allocation)
        const importantWords = scene.visual_effects?.important_words || [];

        // ── Diagram step timing (independent of caption chunks) ──
        // Animation finishes END_BUFFER seconds before the scene ends,
        // giving the last revealed step time to breathe.
        const diagramSteps = visual_element.diagram_steps;
        const hasDiagramSteps = Array.isArray(diagramSteps) && diagramSteps.length > 0;
        const END_BUFFER_SECONDS = 1.0;
        let diagramStepThresholds = []; // seconds at which each step fires
        if (hasDiagramSteps) {
            const availableTime = Math.max(0, duration_seconds - END_BUFFER_SECONDS);
            const stepDuration = availableTime / diagramSteps.length;
            diagramStepThresholds = diagramSteps.map((_, idx) => idx * stepDuration);
            console.log(`[render-ui]   Diagram steps: ${diagramSteps.length} | stepDuration: ${stepDuration.toFixed(2)}s | endBuffer: ${END_BUFFER_SECONDS}s`);
            diagramStepThresholds.forEach((t, idx) => {
                console.log(`[render-ui]     Step ${idx} fires at t=${t.toFixed(2)}s`);
            });
        }
        let lastRevealedDiagramStep = -1;

        // ── Word highlight timing ──
        // Highlights fire HIGHLIGHT_DELAY_SECONDS after the chunk appears,
        // giving the impression of words "lighting up" as they are spoken.
        const HIGHLIGHT_DELAY_SECONDS = 0.3;
        let isChunkHighlighted = false; // reset every time a new chunk appears

        for (let f = 0; f < totalFrames; f++) {
            // Determine which chunk this frame belongs to using start/end timestamps
            const elapsedSeconds = f / FPS;
            let targetChunkIndex = timedChunks.length > 0 ? timedChunks.length - 1 : -1;
            if (timedChunks.length > 0) {
                for (let c = 0; c < timedChunks.length; c++) {
                    if (elapsedSeconds < timedChunks[c].end) {
                        targetChunkIndex = c;
                        break;
                    }
                }

                // Clear caption if we are more than 0.5s past the end of the last chunk
                if (targetChunkIndex === timedChunks.length - 1) {
                    if (elapsedSeconds > timedChunks[targetChunkIndex].end + 0.5) {
                        targetChunkIndex = -1;
                    }
                }
            }

            // ── Determine which diagram step should be active at this frame ──
            let targetDiagramStep = lastRevealedDiagramStep;
            if (hasDiagramSteps) {
                for (let s = diagramStepThresholds.length - 1; s >= 0; s--) {
                    if (elapsedSeconds >= diagramStepThresholds[s]) {
                        targetDiagramStep = s;
                        break;
                    }
                }
            }

            // ── Update DOM only when caption chunk OR diagram step changes ──
            const captionChanged = (targetChunkIndex !== currentChunkIndex || f === 0);
            const diagramStepChanged = hasDiagramSteps && (targetDiagramStep !== lastRevealedDiagramStep);

            if (captionChanged || diagramStepChanged) {
                if (captionChanged) {
                    currentChunkIndex = targetChunkIndex;
                    isChunkHighlighted = false; // new chunk → highlights reset
                    
                    const logText = currentChunkIndex === -1 ? '<CLEARED>' : (timedChunks[currentChunkIndex]?.text || '');
                    console.log(`[render-ui] Scene ${i+1} Frame ${f} (${elapsedSeconds.toFixed(2)}s) — Caption: "${logText}"`);
                }
                if (diagramStepChanged) lastRevealedDiagramStep = targetDiagramStep;

                const rawText = timedChunks[currentChunkIndex]?.text || '';
                // On chunk arrival: show plain text (no highlights yet)
                const plainHtml = buildHighlightedHTML(rawText, []);
                await page.evaluate((html, stepIndex, shouldRevealStep) => {
                    document.getElementById('caption-text').innerHTML = html;
                    if (shouldRevealStep && window.revealDiagramStep) {
                        window.revealDiagramStep(stepIndex);
                    }
                }, plainHtml, lastRevealedDiagramStep, diagramStepChanged);
            }

            // ── Delayed word highlight: fire once per chunk, HIGHLIGHT_DELAY_SECONDS after it appears ──
            if (importantWords.length > 0 && !isChunkHighlighted) {
                const chunkStart = timedChunks[currentChunkIndex]?.start ?? 0;
                if (elapsedSeconds >= chunkStart + HIGHLIGHT_DELAY_SECONDS) {
                    isChunkHighlighted = true;
                    const rawText = timedChunks[currentChunkIndex]?.text || '';
                    const highlightedHtml = buildHighlightedHTML(rawText, importantWords);
                    // Only do a DOM update if this chunk actually contains an important word
                    if (highlightedHtml !== buildHighlightedHTML(rawText, [])) {
                        await page.evaluate((html) => {
                            document.getElementById('caption-text').innerHTML = html;
                        }, highlightedHtml);
                    }
                }
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