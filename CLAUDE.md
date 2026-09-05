# Claude Setup & Project Context (FFmpeg Video Rendering Service)

## 📌 Project Overview
This is a Node.js microservice running in a Dockerized Alpine Linux environment. Its primary purpose is the automated generation and assembly of short-form vertical videos (9:16 aspect ratio, e.g., TikToks, YouTube Shorts, Reels) using FFmpeg.

**Core Capabilities:**
- Downloading video scenes via external URLs and audio tracks via Google Drive.
- Dynamically generating word-by-word fade-in ASS (Advanced SubStation Alpha) subtitles based on text captions.
- Processing videos through FFmpeg (scaling, creating blurred backgrounds for horizontal videos, concatenating scenes, overlaying audio and subtitles).
- Uploading the final output to Google Drive using OAuth2 delegation.

## 🏗️ Tech Stack & Dependencies
- **Runtime:** Node.js (>=20)
- **API Framework:** Express.js (`src/server.js`)
- **Video Processing:** `fluent-ffmpeg` (wrapper for system `ffmpeg`)
- **UI/Headless Rendering:** `puppeteer` (for canvas/overlay rendering)
- **Google Integrations:** `googleapis` (Drive API)
- **Agent Integrations:** `@modelcontextprotocol/sdk` (for MCP Agents like `agent.js` / `agent.mjs`)
- **Infrastructure:** Docker, Docker Compose (Alpine base image includes `libass`, `fontconfig`, and `ttf-dejavu`)

## 📂 Architecture & Key Files
The pipeline is highly modularized inside the `src/` directory:

- **`src/server.js`**: The Express.js entry point. Listens on `PORT` (default 3001) for `POST /render` requests and validates the JSON schema.
- **`src/render.js`**: The orchestrator. Creates temporary job workspaces and sequentially calls the download, subtitle, assemble, and upload modules.
- **`src/download.js`**: Handles HTTP downloads for raw MP4 scenes and authenticates via Google Service Account to download Drive MP3s.
- **`src/subtitle.js`**: Contains the logic to chunk text captions proportionally based on string length and generate the `.ass` subtitle file with custom styling and animations.
- **`src/assemble.js`**: The heavy lifter. Runs FFmpeg filtergraphs in multiple passes to blur backgrounds, scale foregrounds, concat scenes, and burn subtitles.
- **`src/upload.js`**: Handles the final `.mp4` Google Drive upload using an OAuth2 refresh token to bypass Service Account quotas.
- **`scripts/get-oauth-token.js`**: CLI utility for developers to generate the required OAuth2 refresh tokens.
- **`agent.js` / `agent.mjs`**: Local Model Context Protocol (MCP) servers allowing Claude Code to interface with external endpoints (like Omniroutes).

## 🚀 Common Commands & Workflows

**Running the Full Service:**
```bash
# Uses docker-compose.yml to build and mount outputs/secrets
docker compose up -d --build
```
*The API becomes available at `http://localhost:3001/render`.*

**Testing the Puppeteer Headless UI Render Pipeline:**
```bash
docker build -t ffmpeg-puppeteer-test .
docker run --rm -v "${PWD}\test_output_workspace:/app/test_output_workspace" ffmpeg-puppeteer-test node test-render-ui.js
```

## ⚠️ Important Rules & Conventions for Claude

1. **Temporary File Management (CRITICAL)**: 
   - Every rendering job creates a unique directory (e.g., `/tmp/ffmpeg-job-<uuid>`).
   - You MUST ensure absolute cleanup of this directory at the end of the pipeline, regardless of whether the pipeline succeeded or threw an error. Failure to do so will bloat the Docker container's storage.

2. **FFmpeg Filtergraphs**:
   - Filtergraphs can get extremely complex. Always document your FFmpeg complex filters (`-filter_complex`) step-by-step.
   - Maintain the standard 1080x1920 (9:16) vertical resolution constraint for all final outputs. 

3. **Google API Authentication**:
   - Downloads use Service Account Keys (`.env` -> `GOOGLE_SERVICE_ACCOUNT_JSON`).
   - Uploads MUST use OAuth2 User Delegation (`.env` -> `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_REFRESH_TOKEN`) to avoid hitting strict Google Drive Service Account upload limits.

4. **Testing & Output**:
   - The `.env` variable `SKIP_DRIVE_UPLOAD=true` allows bypassing Google Drive to save the final `.mp4` into the mapped `./output` folder for fast local debugging.

5. **Code Style**:
   - Use ES Modules or CommonJS consistently (the project currently uses standard CommonJS `require()` in `src/` but some scripts like `agent.mjs` use ESM). Pay attention to file extensions and `package.json` `type` declarations.
   - Handle all asynchronous operations gracefully and return meaningful error messages in the API response.
