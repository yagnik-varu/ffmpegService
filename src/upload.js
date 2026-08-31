/**
 * upload.js — Google Drive uploader
 *
 * Uses OAuth2 refresh token to upload an MP4 file to a specific Drive folder,
 * then makes it publicly shareable and returns { id, webViewLink }.
 *
 * Auth strategy: OAuth2 with refresh token (works with personal Google Drive).
 * The refresh token is generated once via: node scripts/get-oauth-token.js
 *
 * Required env vars:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REFRESH_TOKEN
 *   GOOGLE_DRIVE_FOLDER_ID
 *
 * For READING Google Drive files (audio download), the service account is still used
 * via getAuthClient() — OAuth2 is only needed for UPLOADING (quota ownership).
 */

const fs = require("fs");
const { google } = require("googleapis");

/**
 * Build a service-account GoogleAuth client (used for reading/downloading Drive files).
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
    scopes: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
  });
}

/**
 * Build an OAuth2 client using stored refresh token (used for UPLOADING to personal Drive).
 * @returns {import("google-auth-library").OAuth2Client}
 */
function getOAuthClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    const missing = [
      !clientId && "GOOGLE_OAUTH_CLIENT_ID",
      !clientSecret && "GOOGLE_OAUTH_CLIENT_SECRET",
      !refreshToken && "GOOGLE_OAUTH_REFRESH_TOKEN",
    ].filter(Boolean);

    throw new Error(
      `Missing OAuth2 env vars: ${missing.join(", ")}.\n` +
      `Run 'node scripts/get-oauth-token.js' to generate a refresh token, then add these to your .env.`
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/**
 * Upload a local MP4 file to Google Drive (personal Drive via OAuth2) and make it publicly readable.
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

  console.log(`[upload] Authenticating with Google Drive via OAuth2...`);
  const auth = getOAuthClient();
  const drive = google.drive({ version: "v3", auth });

  try {
    // 1. Upload the file
    console.log(`[upload] Uploading ${fileName} to folder ${folderId}...`);
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
    console.log(`[upload] Uploaded to Drive with file ID: ${fileId}`);

    // 2. Make it publicly shareable
    console.log(`[upload] Setting public permissions on file ${fileId}...`);
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

    console.log(`[upload] File is now publicly accessible: ${getRes.data.webViewLink}`);
    return {
      id: getRes.data.id,
      webViewLink: getRes.data.webViewLink,
    };
  } catch (err) {
    const isQuotaError = err.message?.includes("storage quota") || err.message?.includes("storageQuota");
    const isAuthError = err.message?.includes("invalid_grant") || err.message?.includes("Token has been expired");
    let errorMsg = `Google Drive Upload Error: ${err.message}`;

    if (isQuotaError) {
      errorMsg = `[QUOTA ERROR] The authenticated Google account is out of storage or using a service account which has no quota.\n` +
        `[SOLUTION] Run 'node scripts/get-oauth-token.js' on your local machine to generate OAuth2 credentials for YOUR personal Google account.`;
    } else if (isAuthError) {
      errorMsg = `[AUTH ERROR] The OAuth2 refresh token has expired or been revoked.\n` +
        `[SOLUTION] Re-run 'node scripts/get-oauth-token.js' to get a new refresh token and update GOOGLE_OAUTH_REFRESH_TOKEN in .env, then restart the container.`;
    }

    console.error(`[upload] ❌ ${errorMsg}`);
    const driveError = new Error(errorMsg);
    driveError.source = "google_drive";
    driveError.originalError = err;
    throw driveError;
  }
}

module.exports = { uploadToDrive, getAuthClient };
