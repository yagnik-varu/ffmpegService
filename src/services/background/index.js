const path = require('path');
const { generateCanvasBackground } = require('./canvasBackground');
const { generateVideoBackground } = require('./videoBackground');

/**
 * Factory to resolve the background of a scene.
 * Either generates a solid-color canvas or downloads the Pexels video.
 * 
 * @param {object} scene  - Scene object
 * @param {number} index  - Scene index
 * @param {string} jobDir - Temp job directory
 * @returns {Promise<{ type: string, video_path: string }>}
 */
async function resolveBackground(scene, index, jobDir) {
  const { background } = scene;
  const { canvas_color_theme, resolved_video_url } = background;
  const { duration_seconds } = scene;
  const emotion = scene.visual_effects?.emotion || 'neutral';

  if (canvas_color_theme && canvas_color_theme !== 'none') {
    // Mode 1: Canvas — pass emotion so the background gradient reflects the scene's mood
    const outputPath = path.join(jobDir, `raw_scene_${index}.mp4`);
    const finalPath = await generateCanvasBackground(canvas_color_theme, emotion, duration_seconds, outputPath);
    return {
      type: 'canvas',
      video_path: finalPath
    };
  } else {
    // Mode 2: Video (Pexels)
    const finalPath = await generateVideoBackground(resolved_video_url, index, jobDir);
    return {
      type: 'video',
      video_path: finalPath
    };
  }
}

module.exports = { resolveBackground };
