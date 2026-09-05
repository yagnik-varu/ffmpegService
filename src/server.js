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
const { validateRenderRequest } = require("./validation/renderRequestValidator");
const config = require("./config");

const app = express();
const PORT = config.port;

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
    const { valid, error } = validateRenderRequest(req.body);
    if (!valid) {
      return res.status(400).json({ success: false, error });
    }

    // ── Run pipeline ────────────────────────────────────
    console.log(`[server] Render request accepted for reel ${req.body.reel_id}`);
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
  console.log(`Google Service Account Key: ${config.googleServiceAccountJson || "not configured"}`);
  console.log(`Target Google Drive Folder: ${config.googleDriveFolderId || "not configured"}`);
  console.log(`======================================================\n`);
});

module.exports = app;
