/**
 * render.js — Orchestration pipeline
 *
 * download → srt → assemble → upload → cleanup
 *
 * All temp files live under /tmp/ffmpeg-job-{jobId}/ and are removed in a
 * `finally` block so they are cleaned up even when upload fails.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

const { downloadFile, downloadGoogleDriveFile } = require("./download");
const { generateSRT } = require("./srt");
const { buildAndRun } = require("./assemble");
const { uploadToDrive, getAuthClient } = require("./upload");

/**
 * Run the full render pipeline for a single reel.
 *
 * @param {object}  body
 * @param {string}  body.reel_id
 * @param {number}  body.total_seconds
 * @param {string}  body.audio_drive_file_id
 * @param {Array}   body.scenes
 * @returns {Promise<{ video_url: string, drive_file_id: string }>}
 */
async function render(body) {
  const { reel_id, total_seconds, audio_drive_file_id, scenes } = body;
  const jobId = uuidv4();
  const jobDir = path.join(os.tmpdir(), `ffmpeg-job-${jobId}`);

  console.log(`[render] Job ${jobId} started for reel ${reel_id}`);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    // ── 1. Download scene videos ────────────────────────────
    console.log(`[render] Downloading ${scenes.length} scene video(s)…`);
    const enrichedScenes = await Promise.all(
      scenes.map(async (scene, i) => {
        const ext = ".mp4";
        const dest = path.join(jobDir, `raw_scene_${i}${ext}`);
        await downloadFile(scene.video_url, dest);
        return { ...scene, video_path: dest };
      })
    );

    // ── 2. Download audio from Google Drive ─────────────────
    console.log(`[render] Downloading audio (Drive ID: ${audio_drive_file_id})…`);
    const audioPath = path.join(jobDir, "audio.mp3");
    const googleAuth = getAuthClient();
    await downloadGoogleDriveFile(audio_drive_file_id, audioPath, googleAuth);

    // ── 3. Generate SRT subtitles ───────────────────────────
    const srtPath = path.join(jobDir, "subtitles.srt");
    generateSRT(enrichedScenes, srtPath);
    console.log(`[render] SRT written to ${srtPath}`);

    // ── 4. Assemble video ───────────────────────────────────
    const outputPath = path.join(jobDir, `${reel_id}.mp4`);
    console.log(`[render] Assembling video…`);
    await buildAndRun(enrichedScenes, audioPath, outputPath, total_seconds);
    console.log(`[render] Assembly complete → ${outputPath}`);

    // ── 5. Upload to Google Drive ───────────────────────────
    console.log(`[render] Uploading to Google Drive…`);
    const { id: driveFileId, webViewLink } = await uploadToDrive(
      outputPath,
      `${reel_id}.mp4`
    );
    console.log(`[render] Upload complete → ${webViewLink}`);

    return {
      video_url: webViewLink,
      drive_file_id: driveFileId,
    };
  } finally {
    // ── Cleanup: remove entire job directory ────────────────
    console.log(`[render] Cleaning up ${jobDir}`);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[render] Cleanup warning: ${cleanupErr.message}`);
    }
  }
}

module.exports = { render };
