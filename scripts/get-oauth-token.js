/**
 * get-oauth-token.js — One-time script to generate a Google OAuth2 refresh token.
 *
 * Run this ONCE on your local machine to get a refresh token that the service
 * can use to upload videos to YOUR personal Google Drive.
 *
 * Usage:
 *   node scripts/get-oauth-token.js
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com/apis/credentials
 *   2. Create an OAuth 2.0 Client ID of type "Desktop app"
 *   3. Download the JSON and copy client_id and client_secret below
 *      OR set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in your .env
 *
 * After running:
 *   - Copy the printed refresh token into your .env as GOOGLE_OAUTH_REFRESH_TOKEN
 *   - Also add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to your .env
 */

require("dotenv").config();
const { google } = require("googleapis");
const http = require("http");
const url = require("url");

// ── Configuration ─────────────────────────────────────────────
const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:4321/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
❌  Missing OAuth credentials!

Please set these in your .env file (or export them):
  GOOGLE_OAUTH_CLIENT_ID=your_client_id
  GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret

How to get them:
  1. Go to https://console.cloud.google.com/apis/credentials
  2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
  3. Application type: "Desktop app"
  4. Download JSON, copy client_id and client_secret into .env
`);
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",        // ensures we always get a refresh_token
  scope: SCOPES,
});

console.log("\n======================================================");
console.log("  Google OAuth2 Token Generator for ffmpeg-service");
console.log("======================================================");
console.log("\n1. Open this URL in your browser:\n");
console.log(`   ${authUrl}\n`);
console.log("2. Log in with the Google account that OWNS the Drive folder.");
console.log("3. Grant the requested permissions.");
console.log("4. You'll be redirected to localhost — this script will capture the code.\n");

// Start a local server to capture the OAuth redirect
const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new url.URL(req.url, "http://localhost:4321");

    if (parsedUrl.pathname === "/oauth2callback") {
      const code = parsedUrl.searchParams.get("code");
      if (!code) {
        res.end("No auth code received. Please try again.");
        return;
      }

      const { tokens } = await oauth2Client.getToken(code);

      res.end(`
        <html>
          <body style="font-family:sans-serif;text-align:center;padding:40px">
            <h2>Success! Authorization Successful!</h2>
            <p>You can close this browser tab and check the terminal.</p>
          </body>
        </html>
      `);

      console.log("\n======================================================");
      console.log("SUCCESS! Here are your OAuth2 tokens:\n");
      console.log(`  Refresh Token: ${tokens.refresh_token}`);
      console.log("\n  Add these to your .env file:\n");
      console.log(`  GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`);
      console.log(`  GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
      console.log(`  GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log("\n======================================================\n");

      server.close();
      process.exit(0);
    } else {
      res.end("Waiting for OAuth callback...");
    }
  } catch (err) {
    res.end(`Error: ${err.message}`);
    console.error("Error getting token:", err.message);
    server.close();
    process.exit(1);
  }
});

server.listen(4321, () => {
  console.log("Listening for OAuth callback on http://localhost:4321...\n");
});
