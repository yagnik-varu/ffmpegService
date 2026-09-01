
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

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
        console.log("scene", scene)

        console.log(`[render-ui] Scene ${i + 1}/${scenes.length} — type: ${visual_element.type} — duration: ${duration_seconds}s`);

        // Write per-scene data.js so the template can read it
        const sceneData = {
            type: visual_element.type,
            language: visual_element.language || null,
            data: visual_element.data || null,
            caption: caption || '',
        };

        const dataJsContent = `window.SCENE_DATA = ${JSON.stringify(sceneData)};`;
        fs.writeFileSync(path.join(TEMPLATE_DIR, 'data.js'), dataJsContent, 'utf8');

        const page = await browser.newPage();

        // Transparent background is handled by CSS and omitBackground: true in page.screenshot()

        // Load the template (file:// protocol so local scripts load)
        await page.goto(`file://${TEMPLATE_HTML}`, { waitUntil: 'networkidle0', timeout: 30000 });

        // Wait for Prism / Mermaid to finish rendering
        await waitForRenderComplete(page);

        // Calculate how many frames this scene needs
        const frameCount = Math.round(duration_seconds * FPS);

        // Capture each frame as a PNG
        for (let f = 0; f < frameCount; f++) {
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
        console.log(`[render-ui] Scene ${i + 1} captured — ${frameCount} frames.`);
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