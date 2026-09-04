/**
 * test-render.js
 * 
 * A standalone test script to quickly render visuals (UI overlay, diagrams, code blocks, backgrounds)
 * without running the full pipeline (TTS, Google Drive, audio).
 * 
 * SOLID Principles applied:
 * - Single Responsibility: Each step (resolve, UI, background, composite) is handled by its dedicated module.
 * - Dependency Inversion: This script orchestrates high-level modules without relying on the Express app.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { resolveBackground } = require('./services/background');
const { renderUIOverlay } = require('./render-ui');
const { buildBackgroundBase } = require('./assemble');

// Mock data provided by user
const MOCK_SCENES = [
  {
    scene_number: 1,
    caption: "Think the spread operator creates a deep copy in JavaScript? You're setting yourself up for bugs!",
    duration_seconds: 3.5,
    layout_mode: 'center_text',
    visual_effects: {
      important_words: ['spread operator', 'deep copy', 'bugs'],
      emotion: 'danger',
      camera_movement: 'zoom_out',
      screen_transition: 'cut',
    },
    background: {
      canvas_color_theme: 'cyber_blue',
      pexels_search_query: '',
      resolved_video_url: '',
    },
    audio: { sfx_trigger: 'whoosh' },
    visual_element: {
      type: 'text_only',
      language: '',
      data: '',
      diagram_concept: '',
    },
  },
  {
    scene_number: 2,
    caption: 'Syntax like spread or Object.assign only creates a shallow copy.',
    duration_seconds: 5.5,
    layout_mode: 'split_bottom_captions',
    visual_effects: {
      important_words: ['spread', 'Object.assign', 'shallow copy'],
      emotion: 'curious',
      camera_movement: 'zoom_in',
      screen_transition: 'cut',
    },
    background: { canvas_color_theme: 'cyber_blue', pexels_search_query: '' },
    audio: { sfx_trigger: 'keyboard_typing' },
    visual_element: {
      type: 'code_snippet',
      language: 'javascript',
      data: "const user = {\n  name: 'Alex',\n  meta: { id: 101 }\n};\nconst copy = { ...user };",
      diagram_concept: '',
    },
  },
  {
    scene_number: 3,
    caption: 'This means top-level primitives copy by value, but nested objects still share the exact same memory references.',
    duration_seconds: 6,
    layout_mode: 'split_bottom_captions',
    visual_effects: {
      important_words: ['primitives', 'nested objects', 'memory references'],
      emotion: 'neutral',
      camera_movement: 'zoom_in',
      screen_transition: 'slide_left',
    },
    background: { canvas_color_theme: 'cyber_blue', pexels_search_query: '' },
    audio: { sfx_trigger: 'none' },
    visual_element: {
      type: 'architecture_diagram',
      language: '',
      data: 'graph TD; Orig[Original Object] --> Prim1[Primitive Slot 1]; Copy[Copied Object] --> Prim2[Primitive Slot 2]; Orig --> Nested[Shared Nested<br>Memory Slot]; Copy --> Nested;',
      diagram_concept: 'Diagram showing original object and copied object pointing to distinct primitive slots, but both pointing to the exact same memory address for the nested object.',
      diagram_steps: [['Orig', 'Copy'], ['Prim1', 'Prim2'], ['Nested']],
    },
  },
];

/**
 * Composites the background and the transparent UI overlay into a final silent video.
 */
function compositeSilentVideo(backgroundPath, overlayPath, finalPath, totalSeconds) {
  const vcodec = process.env.FFMPEG_VCODEC || 'libx264';

  const ffmpegCmd = [
    'ffmpeg -y',
    `-i "${backgroundPath}"`,
    '-c:v libvpx-vp9',
    `-i "${overlayPath}"`,
    '-filter_complex',
    '"[1:v]format=yuva420p[overlay];[0:v][overlay]overlay=0:0[composited]"',
    '-map "[composited]"',
    `-t ${totalSeconds}`,
    `-c:v ${vcodec}`,
    '-preset fast',
    '-crf 20',
    '-movflags +faststart',
    `"${finalPath}"`
  ].join(' ');

  console.log('[test-render] Compositing silent video...');
  execSync(ffmpegCmd, { stdio: 'inherit' });
  console.log(`[test-render] Composited silent video to ${finalPath}`);
}

/**
 * Main Orchestrator for the test pipeline
 */
async function runTestPipeline() {
  const jobDir = path.join(os.tmpdir(), `test-job-${Date.now()}`);
  fs.mkdirSync(jobDir, { recursive: true });
  console.log(`[test-render] Created temporary job directory: ${jobDir}`);

  try {
    // 1. Resolve Backgrounds
    console.log('[test-render] Resolving backgrounds...');
    const enrichedScenes = await Promise.all(
      MOCK_SCENES.map(async (scene, i) => {
        const { type, video_path } = await resolveBackground(scene, i, jobDir);
        return { ...scene, background_type: type, video_path };
      })
    );
    console.log('[test-render] Backgrounds resolved successfully.');

    // 2. Render UI Overlay (Code blocks & Diagrams)
    console.log('[test-render] Rendering UI Overlay...');
    const overlayWebmPath = await renderUIOverlay(enrichedScenes, jobDir);
    console.log(`[test-render] UI Overlay rendered at: ${overlayWebmPath}`);

    // 3. Build Background Base
    console.log('[test-render] Building Background Base...');
    const backgroundBasePath = buildBackgroundBase(enrichedScenes, jobDir);
    console.log(`[test-render] Background Base built at: ${backgroundBasePath}`);

    // 4. Composite final output
    const totalSeconds = enrichedScenes.reduce((acc, scene) => acc + scene.duration_seconds, 0);
    const finalOutputPath = path.resolve(__dirname, '../output/test_reel.mp4');

    // Ensure output directory exists
    fs.mkdirSync(path.resolve(__dirname, '../output'), { recursive: true });

    compositeSilentVideo(backgroundBasePath, overlayWebmPath, finalOutputPath, totalSeconds);

    console.log(`\n======================================================`);
    console.log(`✅ Test rendering complete!`);
    console.log(`Output available at: ${finalOutputPath}`);
    console.log(`======================================================\n`);

  } catch (error) {
    console.error(`[test-render] Pipeline failed:`, error);
  } finally {
    // Optional: Clean up job directory
    // fs.rmSync(jobDir, { recursive: true, force: true });
    console.log(`[test-render] Kept temporary files in ${jobDir} for debugging.`);
  }
}

// Execute
runTestPipeline();
