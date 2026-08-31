/**
 * render.js — Orchestration pipeline
 *
 * download → srt → assemble → [upload to Drive OR save locally] → cleanup
 *
 * Set SKIP_DRIVE_UPLOAD=true in .env to save the rendered video to ./output/
 * on the host machine (via Docker volume mount) instead of uploading to Drive.
 * All temp files live under /tmp/ffmpeg-job-{jobId}/ and are removed in a
 * `finally` block so they are cleaned up even when upload fails.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

const { downloadFile, downloadGoogleDriveFile } = require("./download");
const { generateSubtitles } = require("./subtitle");
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

  console.log(`\n======================================================`);
  console.log(`[PIPELINE START] Reel ID: ${reel_id} | Job ID: ${jobId}`);
  console.log(`[PIPELINE CONFIG] Total duration: ${total_seconds}s | Scenes: ${scenes.length}`);
  console.log(`======================================================`);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    // ── 1. Download scene videos ────────────────────────────
    console.log(`\n[STEP 1/5] Downloading ${scenes.length} scene clip(s)...`);
    let enrichedScenes;
    try {
      enrichedScenes = await Promise.all(
        scenes.map(async (scene, i) => {
          const ext = ".mp4";
          const dest = path.join(jobDir, `raw_scene_${i}${ext}`);
          await downloadFile(scene.video_url, dest);
          return { ...scene, video_path: dest };
        })
      );
      console.log(`[STEP 1/5 ✅] All ${scenes.length} scene clip(s) downloaded successfully.`);
    } catch (err) {
      console.error(`[STEP 1/5 ❌] Failed to download scene clips: ${err.message}`);
      err.step = "STEP 1: DOWNLOAD_SCENE_VIDEOS";
      if (!err.source) err.source = "external_url";
      throw err;
    }

    // ── 2. Download audio from Google Drive ─────────────────
    console.log(`\n[STEP 2/5] Downloading audio from Google Drive (File ID: ${audio_drive_file_id})...`);
    const audioPath = path.join(jobDir, "audio.mp3");
    try {
      const googleAuth = getAuthClient();
      await downloadGoogleDriveFile(audio_drive_file_id, audioPath, googleAuth);
      console.log(`[STEP 2/5 ✅] Audio downloaded successfully.`);
    } catch (err) {
      console.error(`[STEP 2/5 ❌] Audio download failed: ${err.message}`);
      err.step = "STEP 2: GOOGLE_DRIVE_AUDIO_DOWNLOAD";
      err.source = "google_drive";
      throw err;
    }

    // ── 3. Generate ASS subtitles (word-by-word phrases) ────
    console.log(`\n[STEP 3/5] Generating ASS subtitles (word-by-word)...`);
    const assPath = path.join(jobDir, "subtitles.ass");
    try {
      generateSubtitles(enrichedScenes, assPath);
      console.log(`[STEP 3/5 ✅] ASS subtitles generated at ${assPath}`);
    } catch (err) {
      console.error(`[STEP 3/5 ❌] Subtitle generation failed: ${err.message}`);
      err.step = "STEP 3: SUBTITLE_GENERATION";
      err.source = "internal";
      throw err;
    }

    // ── 4. Assemble video ───────────────────────────────────
    console.log(`\n[STEP 4/5] Assembling video with FFmpeg (Pass 1 trim/scale + Pass 2 concat/audio/subtitles)...`);
    const outputPath = path.join(jobDir, `${reel_id}.mp4`);
    try {
      await buildAndRun(enrichedScenes, audioPath, outputPath, total_seconds);
      console.log(`[STEP 4/5 ✅] Video assembly complete → ${outputPath}`);
    } catch (err) {
      console.error(`[STEP 4/5 ❌] FFmpeg assembly failed: ${err.message}`);
      err.step = "STEP 4: FFMPEG_ASSEMBLY";
      err.source = "ffmpeg";
      throw err;
    }

    // ── 5. Upload OR save locally ───────────────────────────
    const skipUpload = body.skip_drive_upload !== undefined 
      ? String(body.skip_drive_upload) === "true" 
      : process.env.SKIP_DRIVE_UPLOAD === "true";

    if (skipUpload) {
      // ── Local mode: copy to /app/output (mounted from host ./output) ─
      console.log(`\n[STEP 5/5] SKIP_DRIVE_UPLOAD=true — saving video locally...`);
      const localOutputDir = "/app/output";
      const localOutputPath = path.join(localOutputDir, `${reel_id}.mp4`);

      try {
        fs.mkdirSync(localOutputDir, { recursive: true });
        fs.copyFileSync(outputPath, localOutputPath);
        console.log(`[STEP 5/5 ✅] Video saved locally: ${localOutputPath}`);
        console.log(`   → On your Windows host: d:\\yagnik-deploy\\ffmpegService\\output\\${reel_id}.mp4`);
        console.log(`======================================================\n[PIPELINE COMPLETE SUCCESS]\n======================================================`);

        return {
          video_url: null,
          drive_file_id: null,
          local_path: localOutputPath,
          host_path: `d:\\yagnik-deploy\\ffmpegService\\output\\${reel_id}.mp4`,
          message: `Video saved locally. Open: d:\\yagnik-deploy\\ffmpegService\\output\\${reel_id}.mp4`,
        };
      } catch (err) {
        console.error(`[STEP 5/5 ❌] Failed to save video locally: ${err.message}`);
        err.step = "STEP 5: LOCAL_SAVE";
        err.source = "internal";
        throw err;
      }
    } else {
      // ── Drive mode: upload to Google Drive ──────────────────
      console.log(`\n[STEP 5/5] Uploading rendered video to Google Drive...`);
      try {
        const { id: driveFileId, webViewLink } = await uploadToDrive(
          outputPath,
          `${reel_id}.mp4`
        );
        console.log(`[STEP 5/5 ✅] Upload complete: ${webViewLink} (File ID: ${driveFileId})`);
        console.log(`======================================================\n[PIPELINE COMPLETE SUCCESS]\n======================================================`);

        return {
          video_url: webViewLink,
          drive_file_id: driveFileId,
        };
      } catch (err) {
        console.error(`[STEP 5/5 ❌] Google Drive upload failed: ${err.message}`);
        err.step = "STEP 5: GOOGLE_DRIVE_UPLOAD";
        err.source = "google_drive";
        throw err;
      }
    }
  } finally {
    // ── Cleanup: remove entire job directory ────────────────
    console.log(`[CLEANUP] Removing temp directory ${jobDir}`);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[CLEANUP WARNING] ${cleanupErr.message}`);
    }
  }
}

module.exports = { render };
