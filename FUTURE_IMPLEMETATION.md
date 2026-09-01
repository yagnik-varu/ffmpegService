Here is the complete, consolidated `FUTURE_ARCHITECTURE.md` file. It merges your current state with the planned headless-browser rendering strategy into a single, comprehensive document ready for your repository.
 
```markdown
# FUTURE ARCHITECTURE: Rich Visual Elements Pipeline
 
## Overview
This document outlines the architecture, file structure, and processing pipeline of the FFmpeg Video Rendering Service. It details both the **Current State** (pure FFmpeg processing) and the **Future State** (a hybrid architecture using headless browser rendering) to support rich UI overlays like code snippets and architectural diagrams.
 
---
 
## 1. Project Structure
 
The project structure will be updated to handle HTML/UI rendering and headless browser orchestration alongside the existing FFmpeg tools.
 
```text
d:\yagnik-deploy\ffmpegService\
├── src/
│   ├── assemble.js      # FFmpeg processing (scaling, compositing, concatenation)
│   ├── download.js      # Downloads Pexels .mp4s and Google Drive audio
│   ├── render.js        # Main orchestration pipeline tying all steps together
│   ├── render-ui.js     # [FUTURE] Puppeteer logic to record the DOM
│   ├── server.js        # Express.js server, API endpoints, and validation
│   ├── subtitle.js      # [DEPRECATING] Generates ASS subtitles (will be replaced by DOM)
│   └── upload.js        # Google Drive OAuth2 upload logic
├── templates/           # [FUTURE] HTML/CSS/JS files for Puppeteer
│   ├── index.html       # The main DOM canvas for UI rendering
│   ├── script.js        # Parses scene data, mounts Prism.js or Mermaid.js
│   └── style.css        # Glassmorphism UI, typography, and animations
├── scripts/
│   └── get-oauth-token.js 
├── Dockerfile           # Defines container dependencies (FFmpeg, Chromium)
├── docker-compose.yml   # Orchestrates container, mounts output & secrets
├── .env                 # Configuration & environment variables
└── README.md            
 
```
 
---
 
## 2. Incoming Request Schema
 
The `/render` endpoint accepts the following JSON schema. The `visual_element` block is introduced in the future state to dictate precise UI overlays.
 
```json
{
  "reel_id": "string",
  "total_seconds": "number",
  "audio_drive_file_id": "string",
  "skip_drive_upload": "boolean (optional)",
  "scenes": [
    {
      "duration_seconds": "number",
      "caption": "string (the full text to display for the scene)",
      "video_url": "string (direct URL to a downloadable .mp4)",
      "visual_element": {
        "type": "code_snippet | architecture_diagram | text_only",
        "data": "string (raw code or mermaid syntax)"
      }
    }
  ]
}
 
```
 
---
 
## 3. Step-by-Step Processing Pipeline
 
When a request is received, a temporary workspace (`/tmp/ffmpeg-job-<uuid>`) is created. The pipeline will transition from a 5-step FFmpeg process to a hybrid DOM-recording process.
 
### Step 1: Download Assets (`download.js`)
 
Iterates through the `scenes` array and downloads the raw video `.mp4` for each scene. Uses Google Drive API to download the background audio track as `audio.mp3`.
 
### Step 2: Generate UI Frames (`render-ui.js`) [FUTURE]
 
*Currently handled by `subtitle.js` generating an `.ass` file. Will be replaced by:*
 
1. **Inject Data:** Node.js writes the JSON payload and audio file path to a temporary `data.js` accessible by the HTML template.
2. **Render DOM:** Puppeteer launches Chromium and loads `templates/index.html`.
* If `type === 'code_snippet'`, renders using **Prism.js**.
* If `type === 'architecture_diagram'`, renders using **Mermaid.js**.
* Captions render at the bottom via CSS animations synced to timing.
 
 
3. **Record:** Puppeteer captures the DOM with a transparent background (`rgba(0,0,0,0)`) at 30fps.
4. **Output:** A transparent `ui_overlay.webm` is saved to the workspace.
 
### Step 3: FFmpeg Background Assembly (`assemble.js`)
 
Instead of complex foreground/background overlays per scene, this step becomes simplified:
 
1. Scales all downloaded Pexels videos to exactly `1080x1920`.
2. Applies a strong blur (`boxblur=20:20`) and darkens the footage (`colorchannelmixer`) to create an atmospheric canvas.
3. Concatenates these backgrounds into a single `background_base.mp4`.
 
### Step 4: Final Compositing (`assemble.js`)
 
FFmpeg performs a final hardware-accelerated pass (using `libx264` for free CPU tiers or `h264_nvenc` locally):
 
* Takes `background_base.mp4` as the bottom layer.
* Takes the transparent `ui_overlay.webm` as the top layer.
* Uses the `-filter_complex overlay` command to combine them.
* Merges `audio.mp3` and outputs exactly trimmed `final_reel.mp4`.
 
### Step 5: Upload & Cleanup (`upload.js` / `render.js`)
 
* If `skip_drive_upload` is false, uploads `final_reel.mp4` to Google Drive via OAuth2 delegation.
* Cleans up by completely deleting the `/tmp/ffmpeg-job-<uuid>` directory.
 
---
 
## 4. Infrastructure & Free-Tier CPU Considerations
 
To support Puppeteer on a cloud environment without a GPU:
 
1. **Base Image Migration:** The `Dockerfile` must migrate from Alpine Linux to a Debian-based Node image (e.g., `node:18-bullseye-slim`) to reliably install and run Chromium dependencies.
```dockerfile
# Required addition for Puppeteer support
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
 
```
 
 
2. **Server Environment:** Serverless functions (like Vercel/Lambda) will time out due to DOM recording times. The service must be hosted on a persistent container service (e.g., Render Web Service, Railway, or Fly.io).
 
---
 
## 5. Implementation Roadmap
 
1. **Phase 1 (Data):** Update API schema in `server.js` to get the new `visual_element` data structure.
2. **Phase 2 (Frontend Template):** Build `templates/index.html` locally. Implement dynamic DOM injection for Mermaid.js and Prism.js based on hardcoded JSON data.
3. **Phase 3 (Puppeteer Integration):** Write `render-ui.js` to open the HTML template in headless mode and capture the transparent `.webm` overlay.
4. **Phase 4 (FFmpeg Refactor):** Modify `assemble.js` to handle the new `ui_overlay.webm` compositing instead of `.ass` subtitle burning.
5. **Phase 5 (Deployment):** Update `Dockerfile` to Debian, test Chromium installation, and deploy to the cloud worker.
 
```
 
```