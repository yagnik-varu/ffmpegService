/**
 * config.js — single source of truth for environment-derived settings.
 *
 * Read once here instead of scattering `process.env` reads across modules.
 */
module.exports = {
  port: process.env.PORT || 3001,
  ffmpegVcodec: process.env.FFMPEG_VCODEC || 'libx264',
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  skipDriveUploadEnv: process.env.SKIP_DRIVE_UPLOAD === 'true',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON || null,
  googleDriveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || null,
};
