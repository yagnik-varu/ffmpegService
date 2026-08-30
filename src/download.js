/**
 * download.js — File downloaders
 *
 * Provides two strategies:
 *   1. downloadFile()           — streams any public URL to disk via axios
 *   2. downloadGoogleDriveFile() — uses googleapis to pull a Drive file by ID
 */

const fs = require("fs");
const axios = require("axios");
const { google } = require("googleapis");

/**
 * Download a file from any public URL and stream it to `destPath`.
 *
 * @param {string} url      — source URL
 * @param {string} destPath — absolute path to write to
 * @returns {Promise<string>} destPath on success
 */
async function downloadFile(url, destPath) {
  const response = await axios({
    method: "GET",
    url,
    responseType: "stream",
    timeout: 5 * 60 * 1000, // 5 min timeout for large videos
  });

  const writer = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", () => resolve(destPath));
    writer.on("error", (err) => reject(err));
    response.data.on("error", (err) => reject(err));
  });
}

/**
 * Download a file from Google Drive by file ID.
 * Handles the auth and redirect that plain URL download can't.
 *
 * @param {string} fileId    — Google Drive file ID
 * @param {string} destPath  — absolute path to write to
 * @param {import("googleapis").Auth.GoogleAuth} googleAuth — authenticated auth client
 * @returns {Promise<string>} destPath on success
 */
async function downloadGoogleDriveFile(fileId, destPath, googleAuth) {
  const drive = google.drive({ version: "v3", auth: googleAuth });

  const response = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream" }
  );

  const writer = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", () => resolve(destPath));
    writer.on("error", (err) => reject(err));
    response.data.on("error", (err) => reject(err));
  });
}

module.exports = { downloadFile, downloadGoogleDriveFile };
