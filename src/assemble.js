/**
 * assemble.js — FFmpeg command builder & executor
 *
 * buildBackgroundBase   — scales/blurs/concatenates scene backgrounds
 * compositeFinalReel    — overlays the UI webm + audio onto the background
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getCameraMovementFilter, concatenateBackgroundScenes } = require('./services/visualEffects/ffmpegFilters');
const config = require('./config');

/**
 * buildBackgroundBase
 * Scales each scene video to 1080x1920, applies blur + darken,
 * trims to exact duration, then concatenates.
 *
 * @param {Object[]} scenes   - scene objects with { duration_seconds, video_path }
 * @param {string}   workDir  - /tmp/ffmpeg-job-<uuid>
 * @returns {string}          - path to background_base.mp4
 */
function buildBackgroundBase(scenes, workDir) {
  const processedPaths = [];
  const vcodec = config.ffmpegVcodec;
  console.log(`[assemble] Using video codec: ${vcodec}`);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const inputPath = scene.video_path; // set by download.js
    const outputPath = path.join(workDir, `bg_scene_${i}.mp4`);

    // Check input file exists
    if (!fs.existsSync(inputPath)) {
      console.error(`[assemble] ❌ Input video NOT FOUND: ${inputPath}`);
      throw new Error(`Background input video not found: ${inputPath}`);
    }
    const inputStats = fs.statSync(inputPath);
    console.log(`[assemble] Input: ${inputPath} (${(inputStats.size / 1024 / 1024).toFixed(2)} MB)`);

    let vfFilters = '';
    if (scene.background_type === 'canvas') {
      // Canvas backgrounds are already exact size, just scale/crop to be safe, no blur or darken.
      vfFilters = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
    } else {
      // Pexels videos get blurred and darkened
      vfFilters = [
        'scale=1080:1920:force_original_aspect_ratio=increase',
        'crop=1080:1920',
        'boxblur=8:8',
        'colorchannelmixer=rr=0.45:gg=0.45:bb=0.45',
      ].join(',');
    }

    // Append camera movement filter (zoompan) if specified
    const cameraFilter = getCameraMovementFilter(
      scene.visual_effects?.camera_movement,
      scene.duration_seconds
    );
    if (cameraFilter) {
      vfFilters += `,${cameraFilter}`;
      console.log(`[assemble] Camera movement '${scene.visual_effects.camera_movement}' applied to scene ${i + 1}`);
    }

    // Scale to fill 1080x1920, blur, darken
    // Use -stream_loop -1 before -i so if the video is shorter than duration_seconds, it loops
    const ffmpegCmd = [
      'ffmpeg -y',
      '-stream_loop -1',
      `-i "${inputPath}"`,
      `-t ${scene.duration_seconds}`,
      `-vf "${vfFilters}"`,
      `-c:v ${vcodec}`,
      '-preset fast',
      '-crf 23',
      '-an',
      `"${outputPath}"`,
    ].join(' ');

    console.log(`[assemble] Processing bg scene ${i + 1}/${scenes.length}...`);
    console.log(`[assemble] CMD: ${ffmpegCmd}`);
    execSync(ffmpegCmd, { stdio: 'inherit' });

    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      console.error(`[assemble] ❌ bg_scene_${i}.mp4 was NOT created!`);
      throw new Error(`Background scene output not created: ${outputPath}`);
    }
    const outStats = fs.statSync(outputPath);
    console.log(`[assemble] ✅ bg_scene_${i}.mp4 created (${(outStats.size / 1024 / 1024).toFixed(2)} MB)`);
    processedPaths.push(outputPath);
  }

  // Concatenate scenes — handles both fast-concat (all cuts) and xfade transitions
  const backgroundBasePath = path.join(workDir, 'background_base.mp4');
  concatenateBackgroundScenes(processedPaths, scenes, vcodec, workDir, backgroundBasePath);

  // Verify background_base.mp4
  if (!fs.existsSync(backgroundBasePath)) {
    console.error('[assemble] ❌ background_base.mp4 was NOT created!');
    throw new Error(`background_base.mp4 not created: ${backgroundBasePath}`);
  }
  const bgStats = fs.statSync(backgroundBasePath);
  console.log(`[assemble] ✅ background_base.mp4 ready (${(bgStats.size / 1024 / 1024).toFixed(2)} MB)`);

  return backgroundBasePath;
}

function getAudioDuration(audioPath) {
  try {
    const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    const output = execSync(cmd).toString().trim();
    return parseFloat(output);
  } catch (e) {
    console.warn(`[assemble] ⚠️ Failed to get audio duration via ffprobe. Fallback to totalSeconds.`);
    return null;
  }
}

/**
 * compositeFinalReel
 * Overlays the transparent ui_overlay.webm onto background_base.mp4,
 * merges audio.mp3, and trims to the exact duration of the audio track.
 *
 * @param {string} backgroundBasePath - /tmp/.../background_base.mp4
 * @param {string} overlayWebmPath    - /tmp/.../ui_overlay.webm
 * @param {string} audioPath          - /tmp/.../audio.mp3
 * @param {number} totalSeconds       - exact final duration (fallback)
 * @param {string} workDir            - /tmp/ffmpeg-job-<uuid>
 * @returns {string}                  - path to final_reel.mp4
 */
function compositeFinalReel(backgroundBasePath, overlayWebmPath, audioPath, totalSeconds, workDir) {
  const finalPath = path.join(workDir, 'final_reel.mp4');
  const vcodec = config.ffmpegVcodec;

  const rawAudioDuration = getAudioDuration(audioPath);
  // Add a 0.5s buffer at the end of the video after audio finishes
  const finalDuration = rawAudioDuration ? rawAudioDuration + 0.5 : totalSeconds;
  console.log(`[assemble] Audio track duration detected: ${rawAudioDuration}s (Padded final video: ${finalDuration}s)`);

  // Log all input files and their sizes
  console.log('[assemble] ── Composite inputs ──');
  [backgroundBasePath, overlayWebmPath, audioPath].forEach((f, idx) => {
    const label = ['background', 'overlay', 'audio'][idx];
    if (fs.existsSync(f)) {
      const s = fs.statSync(f);
      console.log(`[assemble]   ${label}: ${f} (${(s.size / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      console.error(`[assemble]   ❌ ${label} MISSING: ${f}`);
    }
  });

  // VP9 WebM with alpha channel is composited using overlay filter
  // [0:v] = blurred background
  // [1:v] = transparent UI overlay (VP9 alpha)
  // IMPORTANT: -c:v libvpx-vp9 BEFORE -i forces FFmpeg to use the libvpx decoder
  // which properly reads the alpha plane. Without it, FFmpeg's native VP9 decoder
  // strips alpha and decodes as opaque yuv420p (causing black background).
  const ffmpegCmd = [
    'ffmpeg -y',
    `-i "${backgroundBasePath}"`,            // input 0: background
    '-c:v libvpx-vp9',                       // force VP9 alpha decoder for next input
    `-i "${overlayWebmPath}"`,               // input 1: transparent UI overlay
    `-i "${audioPath}"`,                     // input 2: voiceover audio
    '-filter_complex',
    '"[1:v]format=yuva420p[overlay];[0:v][overlay]overlay=0:0[composited]"',
    '-map "[composited]"',
    '-map 2:a',
    `-t ${finalDuration}`,
    `-c:v ${vcodec}`,
    '-preset fast',
    '-crf 20',
    '-c:a aac',
    '-b:a 192k',
    '-movflags +faststart',
    `"${finalPath}"`,
  ].join(' ');

  console.log('[assemble] Compositing final reel...');
  console.log(`[assemble] CMD: ${ffmpegCmd}`);
  execSync(ffmpegCmd, { stdio: 'inherit' });

  // Verify final output
  if (!fs.existsSync(finalPath)) {
    console.error('[assemble] ❌ final_reel.mp4 was NOT created!');
    throw new Error(`final_reel.mp4 not created: ${finalPath}`);
  }
  const finalStats = fs.statSync(finalPath);
  console.log(`[assemble] ✅ Final reel ready: ${finalPath} (${(finalStats.size / 1024 / 1024).toFixed(2)} MB)`);
  return finalPath;
}

module.exports = { buildBackgroundBase, compositeFinalReel };
