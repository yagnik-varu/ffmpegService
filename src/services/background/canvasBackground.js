const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('../browser');
const config = require('../../config');

const TEMPLATE_DIR = path.resolve(__dirname, '../../../templates');
const CANVAS_HTML = path.join(TEMPLATE_DIR, 'canvas.html');
const FPS = 30;

/**
 * Generate an animated canvas background MP4 using Puppeteer frame-by-frame + FFmpeg.
 *
 * @param {string} theme           - Canvas color theme (e.g., cyber_blue)
 * @param {string} emotion         - Scene emotion (e.g., neutral, danger, solution, curious)
 * @param {number} durationSeconds - Duration of the background
 * @param {string} outputPath      - Where to save the generated MP4
 * @returns {Promise<string>}      - The path to the generated MP4
 */
async function generateCanvasBackground(theme, emotion, durationSeconds, outputPath) {
  const vcodec = config.ffmpegVcodec;
  const jobDir = path.dirname(outputPath);

  console.log(`[canvasBackground] Generating animated canvas (theme: ${theme} | emotion: ${emotion}) for ${durationSeconds}s...`);

  const framesDir = path.join(jobDir, `canvas_frames_${path.basename(outputPath, '.mp4')}`);
  fs.mkdirSync(framesDir, { recursive: true });

  const browser = await launchBrowser();
  const totalFrames = Math.round(durationSeconds * FPS);

  try {
      const page = await browser.newPage();
      const emotionParam = emotion ? `&emotion=${emotion}` : '';
      await page.goto(`file://${CANVAS_HTML}?theme=${theme}${emotionParam}`, { waitUntil: 'networkidle0' });

      // Capture frame by frame
      for (let f = 0; f < totalFrames; f++) {
          await page.evaluate((frame, total) => {
              if (window.advanceFrame) window.advanceFrame(frame, total);
          }, f, totalFrames);

          const framePath = path.join(framesDir, `frame_${String(f).padStart(6, '0')}.png`);
          await page.screenshot({ 
              path: framePath, 
              type: 'png', 
              clip: { x: 0, y: 0, width: 1080, height: 1920 } 
          });
      }
  } finally {
      await browser.close();
  }

  // Assemble the frames into an MP4 video using FFmpeg
  const ffmpegCmd = [
    'ffmpeg -y',
    `-framerate ${FPS}`,
    `-i "${path.join(framesDir, 'frame_%06d.png')}"`,
    `-c:v ${vcodec}`,
    '-preset fast',
    '-crf 23',
    '-pix_fmt yuv420p',
    '-an', // No audio
    `"${outputPath}"`
  ].join(' ');

  console.log(`[canvasBackground] Assembling frames... CMD: ${ffmpegCmd}`);
  execSync(ffmpegCmd, { stdio: 'inherit' });

  // Cleanup the frames directory
  fs.rmSync(framesDir, { recursive: true, force: true });

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Failed to generate canvas background: ${outputPath}`);
  }

  return outputPath;
}

module.exports = { generateCanvasBackground };
