/**
 * ffmpegFilters.js — Visual Effects FFmpeg filter service
 *
 * Single Responsibility: build FFmpeg filter strings and execute concat
 * commands for camera_movement (zoompan) and screen_transition (xfade).
 *
 * No knowledge of scenes, rendering, or assembly pipeline — only FFmpeg.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VIDEO_W = 1080;
const VIDEO_H = 1920;
const XFADE_DURATION  = 0.75;         // seconds for slide_left / dissolve
const CUT_FADE_FRAMES = 1;            // 1-frame (imperceptible) fade used in mixed xfade chains

// ─────────────────────────────────────────────────────────────────────────────
// Camera Movement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a zoompan vf filter string for the given camera_movement.
 * Returns null for 'static' or unknown values (caller skips the filter).
 *
 * The centre-locked x/y expressions prevent the frame drifting as zoom changes.
 *
 * @param {string} cameraMovement  - 'zoom_in' | 'zoom_out' | 'static'
 * @param {number} durationSeconds - Scene duration in seconds
 * @param {number} [fps=30]        - Output framerate
 * @returns {string|null}
 */
function getCameraMovementFilter(cameraMovement, durationSeconds, fps = 30) {
    const totalFrames = Math.round(durationSeconds * fps);
    const cx = `iw/2-(iw/zoom/2)`;
    const cy = `ih/2-(ih/zoom/2)`;

    switch (cameraMovement) {
        case 'zoom_in':
            // Smoothly zoom from 1.0x to 1.1x over the scene duration (Ken Burns push-in)
            // fps+format normalizers MUST come before zoompan:
            //   fps=30       → converts VFR Pexels videos to constant framerate (zoompan requirement)
            //   format=yuv420p → ensures compatible pixel format for zoompan + NVENC
            return `fps=${fps},format=yuv420p,zoompan=z='min(1.0+0.1*(on/${totalFrames}),1.1)':x='${cx}':y='${cy}':d=${totalFrames}:s=${VIDEO_W}x${VIDEO_H}`;

        case 'zoom_out':
            // Smoothly zoom from 1.1x back to 1.0x over the scene duration (Ken Burns pull-out)
            return `fps=${fps},format=yuv420p,zoompan=z='max(1.1-0.1*(on/${totalFrames}),1.0)':x='${cx}':y='${cy}':d=${totalFrames}:s=${VIDEO_W}x${VIDEO_H}`;

        case 'static':
        default:
            return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps a screen_transition value to an xfade config.
 * Returns null for 'cut' (no xfade needed).
 *
 * @param {string} screenTransition - 'slide_left' | 'dissolve' | 'cut'
 * @returns {{ type: string, duration: number } | null}
 */
function _getXfadeConfig(screenTransition) {
    switch (screenTransition) {
        case 'slide_left': return { type: 'smoothleft', duration: XFADE_DURATION };
        case 'dissolve':   return { type: 'fade',       duration: XFADE_DURATION };
        case 'cut':
        default:           return null;
    }
}

/**
 * Concatenate per-scene background MP4s with optional xfade transitions.
 *
 * Fast path  → all transitions are 'cut' or unset: uses concat demuxer + -c copy.
 * Xfade path → at least one non-cut transition: builds filter_complex xfade chain.
 *              In the chain, cut transitions use a 1-frame imperceptible fade
 *              so the filter_complex stays uniform.
 *
 * NOTE: screen_transition on scene[i] defines HOW scene[i] ENTERS (its incoming
 * transition). scene[0] is always a hard cut regardless of its value.
 *
 * @param {string[]} processedPaths - Ordered bg_scene_i.mp4 paths
 * @param {Object[]} scenes         - Scene objects (for visual_effects.screen_transition)
 * @param {string}   vcodec         - FFmpeg video codec (e.g. 'libx264' or 'h264_nvenc')
 * @param {string}   workDir        - Temp job directory
 * @param {string}   outputPath     - Destination background_base.mp4
 * @returns {string}  outputPath
 */
function concatenateBackgroundScenes(processedPaths, scenes, vcodec, workDir, outputPath) {
    if (processedPaths.length === 1) {
        // Single scene — just copy it
        fs.copyFileSync(processedPaths[0], outputPath);
        console.log(`[ffmpegFilters] Single scene — copied directly → ${outputPath}`);
        return outputPath;
    }

    // Check if any scene (index ≥ 1) requests a visible transition
    const hasVisibleTransition = scenes
        .slice(1)
        .some(s => {
            const t = s.visual_effects?.screen_transition;
            return t && t !== 'cut';
        });

    if (!hasVisibleTransition) {
        return _fastConcat(processedPaths, workDir, outputPath);
    }

    return _xfadeConcat(processedPaths, scenes, vcodec, outputPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

function _fastConcat(processedPaths, workDir, outputPath) {
    const listPath    = path.join(workDir, 'bg_concat_list.txt');
    const listContent = processedPaths.map(p => `file '${p}'`).join('\n');
    fs.writeFileSync(listPath, listContent, 'utf8');

    const cmd = [
        'ffmpeg -y',
        '-f concat -safe 0',
        `-i "${listPath}"`,
        '-c copy',
        `"${outputPath}"`,
    ].join(' ');

    console.log(`[ffmpegFilters] Fast-concat (all cuts) → ${outputPath}`);
    console.log(`[ffmpegFilters] CMD: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
    return outputPath;
}

function _xfadeConcat(processedPaths, scenes, vcodec, outputPath) {
    const CUT_DUR = CUT_FADE_FRAMES / 30; // ~0.033 s — effectively instant

    const inputs = processedPaths.map(p => `-i "${p}"`).join(' ');

    const filterParts   = [];
    for (let i = 0; i < processedPaths.length; i++) {
        // xfade strictly requires matching timebase, framerate, resolution, and pixel format
        filterParts.push(`[${i}:v]scale=${VIDEO_W}:${VIDEO_H},fps=30,format=yuv420p[v${i}]`);
    }

    let   currentLabel  = '[v0]';
    let   offsetSeconds = 0; // running offset for next xfade start

    for (let i = 1; i < processedPaths.length; i++) {
        const prevDuration = scenes[i - 1].duration_seconds;
        const cfg          = _getXfadeConfig(scenes[i].visual_effects?.screen_transition);
        const xType        = cfg?.type     ?? 'fade';
        const xDur         = cfg?.duration ?? CUT_DUR;

        const offset   = Math.max(0, offsetSeconds + prevDuration - xDur);
        const isLast   = i === processedPaths.length - 1;
        const outLabel = isLast ? '[bg_out]' : `[xf${i}]`;

        filterParts.push(
            `${currentLabel}[v${i}]xfade=transition=${xType}:duration=${xDur.toFixed(3)}:offset=${offset.toFixed(3)}${outLabel}`
        );

        // After this xfade the effective timeline advances by prevDuration - xDur (overlap)
        offsetSeconds  = offset + xDur;
        currentLabel   = outLabel;
    }

    const filterComplex = filterParts.join(';');

    const cmd = [
        'ffmpeg -y',
        inputs,
        `-filter_complex "${filterComplex}"`,
        '-map "[bg_out]"',
        `-c:v ${vcodec}`,
        '-preset fast -crf 23 -pix_fmt yuv420p',
        '-an',
        `"${outputPath}"`,
    ].join(' ');

    console.log(`[ffmpegFilters] xfade-concat (${processedPaths.length} scenes with transitions) → ${outputPath}`);
    console.log(`[ffmpegFilters] CMD: ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
    return outputPath;
}

module.exports = { getCameraMovementFilter, concatenateBackgroundScenes };
