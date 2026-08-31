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
  try {
    console.log(`[download·url] Fetching clip from ${url}...`);
    const response = await axios({
      method: "GET",
      url,
      responseType: "stream",
      timeout: 5 * 60 * 1000, // 5 min timeout for large videos
    });

    const writer = fs.createWriteStream(destPath);

    return await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", () => {
        console.log(`[download·url] Saved clip to ${destPath}`);
        resolve(destPath);
      });
      writer.on("error", (err) => reject(err));
      response.data.on("error", (err) => reject(err));
    });
  } catch (err) {
    const error = new Error(`Failed to download scene video from '${url}': ${err.message}`);
    error.source = "external_url";
    error.originalError = err;
    throw error;
  }
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
  console.log(`[download·drive] Fetching audio from Google Drive (fileId: ${fileId})...`);
  const drive = google.drive({ version: "v3", auth: googleAuth });

  let response;
  try {
    response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );
  } catch (err) {
    const isNotFound = err.code === 404 || err.message?.includes("notFound") || err.response?.status === 404;
    const isForbidden = err.code === 403 || err.message?.includes("forbidden") || err.response?.status === 403;

    let friendlyMessage = `Google Drive Audio Download Failed for File ID: ${fileId}.\n`;
    if (isNotFound) {
      friendlyMessage += `[REASON: 404 Not Found] Google Drive reported that the file does not exist or the Service Account cannot see it.\n` +
        `[SOLUTION] Make sure the audio file '${fileId}' in Google Drive is shared with your service account email with 'Viewer' (or 'Editor') access, OR the folder containing it is shared.`;
    } else if (isForbidden) {
      friendlyMessage += `[REASON: 403 Forbidden] Service Account does not have permission to download this file.\n` +
        `[SOLUTION] Grant 'Viewer' or 'Editor' permissions on this file in Google Drive to your service account email.`;
    } else {
      friendlyMessage += `[REASON: Google Drive API Error] ${err.message}`;
    }

    console.error(`[download·drive] ❌ ${friendlyMessage}`);
    const driveError = new Error(friendlyMessage);
    driveError.source = "google_drive";
    driveError.code = err.code || err.response?.status;
    driveError.originalError = err;
    throw driveError;
  }

  const writer = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", () => {
      console.log(`[download·drive] Audio downloaded successfully to ${destPath}`);
      resolve(destPath);
    });
    writer.on("error", (err) => {
      console.error(`[download·drive] Stream write error: ${err.message}`);
      reject(err);
    });
    response.data.on("error", (err) => {
      console.error(`[download·drive] Stream read error: ${err.message}`);
      reject(err);
    });
  });
}

module.exports = { downloadFile, downloadGoogleDriveFile };
