/**
 * server.js — Express app entry point
 *
 * POST /render  — accepts a reel definition, runs the pipeline, returns JSON
 * GET  /health  — liveness probe
 *
 * All errors are caught and returned as JSON (never HTML stack traces).
 */

const express = require("express");
const { render } = require("./render");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Body parser ─────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));

// ── Request logger ──────────────────────────────────────
app.use((req, _res, next) => {
  const reelId = req.body?.reel_id || "n/a";
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.path} — reel_id: ${reelId}`
  );
  next();
});

// ── Root / Health check ─────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service: "ffmpeg-service",
    status: "ok",
    endpoints: {
      health: "GET /health",
      render: "POST /render"
    },
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Render endpoint ─────────────────────────────────────
app.post("/render", async (req, res, next) => {
  try {
    const { reel_id, total_seconds, audio_drive_file_id, scenes } = req.body;

    // ── Validate required fields ────────────────────────
    if (!reel_id || !total_seconds || !audio_drive_file_id || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "Missing required fields: reel_id, total_seconds, audio_drive_file_id, scenes (non-empty array)",
      });
    }

    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (!s.video_url || s.caption === undefined || !s.duration_seconds) {
        return res.status(400).json({
          success: false,
          error: `Scene ${i + 1} is missing required fields: video_url, caption, duration_seconds`,
        });
      }

      if (s.visual_element) {
        const { type, data } = s.visual_element;
        const validTypes = ['code_snippet', 'architecture_diagram', 'text_only'];
        if (!type || !validTypes.includes(type)) {
          return res.status(400).json({
            success: false,
            error: `Scene ${i + 1} has invalid or missing visual_element.type. Must be one of: ${validTypes.join(', ')}`,
          });
        }
        if (type !== 'text_only' && typeof data !== 'string') {
          return res.status(400).json({
            success: false,
            error: `Scene ${i + 1} is missing visual_element.data (must be a string) required for type '${type}'`,
          });
        }
      }
    }

    // ── Run pipeline ────────────────────────────────────
    console.log(`[server] Render request accepted for reel ${reel_id}`);
    const result = await render(req.body);

    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

// ── Global error handler (always JSON, never HTML) ──────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(`[server ❌ ERROR] Step: ${err.step || "UNKNOWN"} | Source: ${err.source || "INTERNAL"}`);
  console.error(`[server ❌ ERROR MESSAGE] ${err.message}`);
  if (err.originalError?.stack) {
    console.error(err.originalError.stack);
  } else if (err.stack) {
    console.error(err.stack);
  }

  res.status(500).json({
    success: false,
    step: err.step || "UNKNOWN",
    source: err.source || "INTERNAL",
    error: err.message || "Internal server error",
  });
});

// ── Start ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`ffmpeg-service listening on port ${PORT}`);
  console.log(`Google Service Account Key: ${process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "not configured"}`);
  console.log(`Target Google Drive Folder: ${process.env.GOOGLE_DRIVE_FOLDER_ID || "not configured"}`);
  console.log(`======================================================\n`);
});

module.exports = app;
