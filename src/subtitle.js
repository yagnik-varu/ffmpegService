/**
 * subtitle.js — ASS (Advanced SubStation Alpha) subtitle generator
 *
 * Creates word-by-word animated captions in ASS format for TikTok/Reels-style
 * subtitle display. Each scene's caption is split into short ~3-word phrases,
 * timed evenly across the scene duration with fade-in animation.
 *
 * ASS format is used instead of SRT because it supports:
 *   - Per-line styling (font, color, position, background)
 *   - Fade-in/out animation (\fad tag)
 *   - Proper background boxes (BorderStyle=4 or opaque box)
 *   - No FFmpeg force_style escaping headaches
 */

const fs = require("fs");

// ── Configuration ────────────────────────────────────────────
const WORDS_PER_CHUNK = 4;         // words per subtitle phrase
const FADE_IN_MS = 150;            // fade-in duration in milliseconds
const FADE_OUT_MS = 0;             // fade-out duration (0 = instant disappear)

/**
 * Format seconds to ASS timecode: H:MM:SS.CC (centiseconds)
 */
function formatTimecodeASS(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const centis = Math.round(((totalSeconds % 1) * 100));

  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  const cc = String(centis).padStart(2, "0");

  return `${hours}:${mm}:${ss}.${cc}`;
}

/**
 * Split a caption string into chunks of ~WORDS_PER_CHUNK words.
 *
 * @param {string} caption — full caption text
 * @param {number} [wordsPerChunk=WORDS_PER_CHUNK]
 * @returns {string[]} array of phrase chunks
 */
function splitIntoChunks(caption, wordsPerChunk = WORDS_PER_CHUNK) {
  const words = caption.trim().split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }

  return chunks;
}

/**
 * Generate ASS subtitle content from scenes.
 *
 * If a scene has `caption_chunks` (pre-split by n8n/caller), those are used directly.
 * Otherwise, the `caption` string is auto-split into ~3-4 word phrases.
 *
 * @param {Array<{ caption: string, caption_chunks?: string[], duration_seconds: number }>} scenes
 * @param {string} outputPath — where to write the .ass file
 * @returns {string} outputPath
 */
function generateSubtitles(scenes, outputPath) {
  // ── ASS header with embedded style ─────────────────────────
  // Style breakdown:
  //   - DejaVu Sans: the font installed in Docker
  //   - FontSize 42: large, readable on mobile
  //   - PrimaryColour &H00FFFFFF: white text (ABGR)
  //   - OutlineColour &H00000000: black outline
  //   - BackColour &HCC000000: ~80% opaque black background box
  //   - BorderStyle 4: background box behind text (ASS opaque box)
  //   - Outline 0: no outline when using box background
  //   - Shadow 0: no shadow (the box is the background)
  //   - Alignment 5: center-center (ASS numpad alignment)
  //   - MarginV 0: perfectly centered vertically
  const header = `[Script Info]
Title: Reel Subtitles
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,42,&H00FFFFFF,&H000000FF,&H00000000,&H40000000,1,0,0,0,100,100,0,0,3,0,0,5,40,40,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // ── Generate dialogue lines from scenes ────────────────────
  const dialogueLines = [];
  let cursor = 0; // running time in seconds

  scenes.forEach((scene) => {
    // Use pre-split chunks if provided, otherwise auto-split
    const chunks = scene.caption_chunks && scene.caption_chunks.length > 0
      ? scene.caption_chunks
      : splitIntoChunks(scene.caption);

    // Calculate proportional duration based on text length to improve sync
    const totalChars = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    chunks.forEach((chunk) => {
      // If totalChars is 0 (empty caption), divide evenly. Otherwise proportional.
      const chunkRatio = totalChars > 0 ? (chunk.length / totalChars) : (1 / chunks.length);
      const chunkDuration = scene.duration_seconds * chunkRatio;

      const start = cursor;
      const end = cursor + chunkDuration;

      const startTC = formatTimecodeASS(start);
      const endTC = formatTimecodeASS(end);

      // \fad(fadeIn, fadeOut) — smooth appearance
      const fadeTag = `{\\fad(${FADE_IN_MS},${FADE_OUT_MS})}`;

      dialogueLines.push(
        `Dialogue: 0,${startTC},${endTC},Default,,0,0,0,,${fadeTag}${chunk}`
      );
      
      cursor = end;
    });
  });

  // ── Write ASS file ─────────────────────────────────────────
  const assContent = header + dialogueLines.join("\n") + "\n";
  fs.writeFileSync(outputPath, assContent, "utf-8");

  console.log(`[subtitle] Generated ${dialogueLines.length} subtitle phrases across ${scenes.length} scene(s)`);
  return outputPath;
}

module.exports = { generateSubtitles, splitIntoChunks };
