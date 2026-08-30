/**
 * srt.js — SRT subtitle file generator
 *
 * Builds a valid SRT file from an array of scenes with captions and durations,
 * computing cumulative timecodes automatically.
 */

const fs = require("fs");

/**
 * Pad a number to `len` digits with leading zeros.
 */
function pad(n, len = 2) {
  return String(n).padStart(len, "0");
}

/**
 * Convert a time in seconds (float) to SRT timecode format:
 *   HH:MM:SS,mmm
 */
function formatTimecode(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds % 1) * 1000);

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * Generate a valid SRT subtitle file.
 *
 * @param {Array<{ caption: string, duration_seconds: number }>} scenes
 * @param {string} outputPath — where to write the .srt file
 * @returns {string} outputPath
 */
function generateSRT(scenes, outputPath) {
  let cursor = 0; // running time in seconds
  const entries = [];

  scenes.forEach((scene, index) => {
    const start = cursor;
    const end = cursor + scene.duration_seconds;

    entries.push(
      [
        `${index + 1}`,
        `${formatTimecode(start)} --> ${formatTimecode(end)}`,
        scene.caption,
      ].join("\n")
    );

    cursor = end;
  });

  const srtContent = entries.join("\n\n") + "\n";
  fs.writeFileSync(outputPath, srtContent, "utf-8");

  return outputPath;
}

module.exports = { generateSRT };
