const path = require('path');
const { downloadFile } = require('../../download');

/**
 * Download the video and prepare it as a background.
 * For now, this just downloads the file to local disk.
 * The scaling/blurring happens in assemble.js (buildBackgroundBase).
 * 
 * @param {string} resolvedVideoUrl - The resolved Pexels URL
 * @param {number} index            - Scene index
 * @param {string} jobDir           - Temp job directory
 * @returns {Promise<string>}       - Path to the downloaded video
 */
async function generateVideoBackground(resolvedVideoUrl, index, jobDir) {
  console.log(`[videoBackground] Downloading video for scene ${index}...`);
  const ext = ".mp4";
  const dest = path.join(jobDir, `raw_scene_${index}${ext}`);
  
  try {
    await downloadFile(resolvedVideoUrl, dest);
    return dest;
  } catch (err) {
    console.error(`[videoBackground ❌] Failed to download scene clip: ${err.message}`);
    err.step = "STEP 1: DOWNLOAD_SCENE_VIDEOS";
    if (!err.source) err.source = "external_url";
    throw err;
  }
}

module.exports = { generateVideoBackground };
