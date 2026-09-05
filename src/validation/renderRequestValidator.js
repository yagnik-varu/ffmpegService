/**
 * renderRequestValidator.js — validates the body of POST /render.
 */

const VALID_BACKGROUND_THEMES = ['cyber_blue', 'hacker_green', 'error_red', 'dark_minimal', 'none'];
const VALID_VISUAL_ELEMENT_TYPES = ['code_snippet', 'architecture_diagram', 'text_only'];
const VALID_LAYOUT_MODES = ['center_text', 'split_bottom_captions'];

/**
 * @param {object} body - the raw POST /render request body
 * @returns {{ valid: boolean, error?: string }}
 */
function validateRenderRequest(body) {
  const { reel_id, total_seconds, audio_drive_file_id, scenes } = body;

  if (!reel_id || !total_seconds || !audio_drive_file_id || !Array.isArray(scenes) || scenes.length === 0) {
    return {
      valid: false,
      error: "Missing required fields: reel_id, total_seconds, audio_drive_file_id, scenes (non-empty array)",
    };
  }

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.background || typeof s.background !== 'object' || s.caption === undefined || !s.duration_seconds) {
      return {
        valid: false,
        error: `Scene ${i + 1} is missing required fields: background (object), caption, duration_seconds`,
      };
    }

    const { canvas_color_theme, resolved_video_url } = s.background;

    if (!VALID_BACKGROUND_THEMES.includes(canvas_color_theme)) {
      return {
        valid: false,
        error: `Scene ${i + 1} has invalid background.canvas_color_theme. Must be one of: ${VALID_BACKGROUND_THEMES.join(', ')}`,
      };
    }

    if (canvas_color_theme === 'none' && (!resolved_video_url || typeof resolved_video_url !== 'string')) {
      return {
        valid: false,
        error: `Scene ${i + 1} is using 'none' canvas theme but missing valid background.resolved_video_url`,
      };
    }

    if (s.visual_element) {
      const { type, data } = s.visual_element;
      if (!type || !VALID_VISUAL_ELEMENT_TYPES.includes(type)) {
        return {
          valid: false,
          error: `Scene ${i + 1} has invalid or missing visual_element.type. Must be one of: ${VALID_VISUAL_ELEMENT_TYPES.join(', ')}`,
        };
      }
      if (type !== 'text_only' && typeof data !== 'string') {
        return {
          valid: false,
          error: `Scene ${i + 1} is missing visual_element.data (must be a string) required for type '${type}'`,
        };
      }
    }

    if (s.layout_mode) {
      if (!VALID_LAYOUT_MODES.includes(s.layout_mode)) {
        return {
          valid: false,
          error: `Scene ${i + 1} has invalid layout_mode. Must be one of: ${VALID_LAYOUT_MODES.join(', ')}`,
        };
      }
    }
  }

  return { valid: true };
}

module.exports = { validateRenderRequest };
