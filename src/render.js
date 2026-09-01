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
const { renderUIOverlay } = require("./render-ui");
const { buildBackgroundBase, compositeFinalReel } = require("./assemble");
const { uploadToDrive, getAuthClient } = require("./upload");
const { resolveBackground } = require("./services/background");

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
  const { reel_id, total_seconds, audio_drive_file_id, timestamps_drive_file_id, scenes } = body;
  const jobId = uuidv4();
  const jobDir = path.join(os.tmpdir(), `ffmpeg-job-${jobId}`);

  console.log(`\n======================================================`);
  console.log(`[PIPELINE START] Reel ID: ${reel_id} | Job ID: ${jobId}`);
  console.log(`[PIPELINE CONFIG] Total duration: ${total_seconds}s | Scenes: ${scenes.length}`);
  console.log(`======================================================`);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    // ── 1. Download/Generate scene backgrounds ────────────────────────────
    console.log(`\n[STEP 1/5] Processing backgrounds for ${scenes.length} scene(s)...`);
    let enrichedScenes;
    try {
      enrichedScenes = await Promise.all(
        scenes.map(async (scene, i) => {
          const { type, video_path } = await resolveBackground(scene, i, jobDir);
          return { ...scene, background_type: type, video_path };
        })
      );
      console.log(`[STEP 1/5 ✅] All ${scenes.length} scene background(s) processed successfully.`);
    } catch (err) {
      console.error(`[STEP 1/5 ❌] Failed to process scene backgrounds: ${err.message}`);
      err.step = "STEP 1: PROCESS_SCENE_BACKGROUNDS";
      if (!err.source) err.source = "internal";
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

    // ── 2b. Download & parse word-level timestamps (optional) ─
    if (timestamps_drive_file_id) {
      console.log(`\n[STEP 2b] Downloading word timestamps from Google Drive (File ID: ${timestamps_drive_file_id})...`);
      const tsPath = path.join(jobDir, `${reel_id}_ts.json`);
      try {
        const googleAuth = getAuthClient();
        await downloadGoogleDriveFile(timestamps_drive_file_id, tsPath, googleAuth);
        const wordTimestamps = JSON.parse(fs.readFileSync(tsPath, 'utf8'));
        console.log("worldTimestamps")
        console.log(`[STEP 2b ✅] Loaded ${wordTimestamps.length} word timestamps.`);

        // ── Map word timestamps to scenes and group into ~4-word chunks ──
        console.log()
        enrichedScenes = assignTimestampsToScenes(enrichedScenes, wordTimestamps);
      } catch (err) {
        console.warn(`[STEP 2b ⚠️] Timestamp download/parse failed: ${err.message} — falling back to proportional timing.`);
        // Non-fatal: continue without timestamps, render-ui.js will use proportional fallback
      }
    } else {
      console.log('[STEP 2b] No timestamps_drive_file_id provided — using proportional caption timing.');
    }

    // ── 3. Render DOM UI overlay via Puppeteer ──────────────
    console.log(`\n[STEP 3/5] Rendering UI overlay (Puppeteer)...`);
    let overlayWebmPath;
    try {
      overlayWebmPath = await renderUIOverlay(enrichedScenes, jobDir);
      console.log(`[STEP 3/5 ✅] UI overlay rendered at ${overlayWebmPath}`);
    } catch (err) {
      console.error(`[STEP 3/5 ❌] UI overlay generation failed: ${err.message}`);
      err.step = "STEP 3: RENDER_UI_OVERLAY";
      err.source = "puppeteer";
      throw err;
    }

    // ── 4. Assemble Background Base & Composite Video ───────
    console.log(`\n[STEP 4/5] Assembling background and compositing final video...`);
    const outputPath = path.join(jobDir, `${reel_id}.mp4`);
    try {
      console.log('[render] Building background base...');
      const backgroundBasePath = buildBackgroundBase(enrichedScenes, jobDir);

      console.log('[render] Compositing final reel...');
      const finalPath = compositeFinalReel(
        backgroundBasePath,
        overlayWebmPath,
        audioPath,
        total_seconds,
        jobDir
      );

      // Rename final_reel.mp4 to our target outputPath
      fs.renameSync(finalPath, outputPath);
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

/**
 * Maps flat word-level timestamps to scenes and groups them into chunks.
 *
 * @param {Array} scenes - Array of scene objects with duration_seconds
 * @param {Array} wordTimestamps - Flat array of { word, start, end } objects
 * @returns {Array} - Enriched scenes with caption_timestamps array
 */
function assignTimestampsToScenes(scenes, wordTimestamps) {
  const WORDS_PER_CHUNK = 4;
  let wordIdx = 0;
  let currentSceneStartTime = 0;

  return scenes.map((scene, sceneIndex) => {
    const sceneEndTime = currentSceneStartTime + scene.duration_seconds;
    const sceneWords = [];
    const isLastScene = sceneIndex === scenes.length - 1;

    // Collect words that belong to this scene
    while (wordIdx < wordTimestamps.length) {
      const word = wordTimestamps[wordIdx];
      // A word belongs to this scene if its start time is before the scene's end time, OR if this is the last scene
      if (word.start < sceneEndTime || isLastScene) {
        sceneWords.push(word);
        wordIdx++;
      } else {
        break;
      }
    }

    // Group words into chunks
    const caption_timestamps = [];
    let currentChunkWords = [];

    for (let i = 0; i < sceneWords.length; i++) {
      const w = sceneWords[i];
      currentChunkWords.push(w);

      const wordText = w.word.trim();
      // Break chunk if we reach the word limit OR if word ends with sentence punctuation (.!?)
      // Note: /[.!?]$/ ensures we don't break on inline dots like console.log or file.js
      const endsWithPunctuation = /[.!?]$/.test(wordText);

      if (currentChunkWords.length >= WORDS_PER_CHUNK || endsWithPunctuation || i === sceneWords.length - 1) {
        const text = currentChunkWords.map(cw => cw.word).join(' ');
        // Make times relative to the scene's start time and bound them
        const start = Math.max(0, currentChunkWords[0].start - currentSceneStartTime);
        const end = Math.min(scene.duration_seconds, currentChunkWords[currentChunkWords.length - 1].end - currentSceneStartTime);
        
        caption_timestamps.push({ text, start, end });
        currentChunkWords = [];
      }
    }

    currentSceneStartTime = sceneEndTime;

    return {
      ...scene,
      caption_timestamps
    };
  });
}

module.exports = { render };
