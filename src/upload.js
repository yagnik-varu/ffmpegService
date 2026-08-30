/**
 * upload.js — Google Drive uploader
 *
 * Uses a service-account JSON credential to upload an MP4 file to a specific
 * Drive folder, then makes it publicly shareable and returns { id, webViewLink }.
 */

const fs = require("fs");
const { google } = require("googleapis");

/**
 * Build a GoogleAuth client scoped to Drive file operations.
 *
 * @returns {import("googleapis").Auth.GoogleAuth}
 */
function getAuthClient() {
  const keyFilePath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyFilePath) {
    throw new Error(
      "Missing env var GOOGLE_SERVICE_ACCOUNT_JSON (path to service-account key file)"
    );
  }

  return new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
}

/**
 * Upload a local MP4 file to Google Drive and make it publicly readable.
 *
 * @param {string} filePath — absolute path to the MP4 on disk
 * @param {string} fileName — the name to give the file in Drive (e.g. reel_id.mp4)
 * @returns {Promise<{ id: string, webViewLink: string }>}
 */
async function uploadToDrive(filePath, fileName) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error("Missing env var GOOGLE_DRIVE_FOLDER_ID");
  }

  const auth = getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  // 1. Upload the file
  const createRes = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: "video/mp4",
      parents: [folderId],
    },
    media: {
      mimeType: "video/mp4",
      body: fs.createReadStream(filePath),
    },
    fields: "id, webViewLink",
  });

  const fileId = createRes.data.id;

  // 2. Make it publicly shareable
  await drive.permissions.create({
    fileId,
    requestBody: {
      type: "anyone",
      role: "reader",
    },
  });

  // 3. Fetch the updated webViewLink (it may change after permission update)
  const getRes = await drive.files.get({
    fileId,
    fields: "id, webViewLink",
  });

  return {
    id: getRes.data.id,
    webViewLink: getRes.data.webViewLink,
  };
}

module.exports = { uploadToDrive, getAuthClient };
