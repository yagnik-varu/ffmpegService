# Project Stack & Pipeline Architecture

This document outlines the architecture, file structure, and step-by-step processing pipeline of the FFmpeg Video Rendering Service.

## 1. Project Structure

```text
d:\yagnik-deploy\ffmpegService\
├── src/
│   ├── assemble.js    # FFmpeg processing (scaling, blur, concat, subtitle burn)
│   ├── download.js    # Helpers to download files from direct URLs and Google Drive
│   ├── render.js      # Main orchestration pipeline tying all steps together
│   ├── server.js      # Express.js server, API endpoints, and validation
│   ├── subtitle.js    # Generates dynamic ASS subtitles from text captions
│   └── upload.js      # Google Drive OAuth2 upload logic
├── scripts/
│   └── get-oauth-token.js # CLI tool to generate OAuth refresh tokens for Drive
├── Dockerfile         # Defines the Alpine Linux container with FFmpeg & libass
├── docker-compose.yml # Orchestrates the container, mounts output & secrets
├── .env               # Configuration & environment variables
└── README.md          # Project overview and getting started guide
```

---

## 2. Incoming Request Schema

The service listens for `POST` requests at the `/render` endpoint. Below is the expected JSON schema:

```json
{
  "reel_id": "string",
  "total_seconds": "number",
  "audio_drive_file_id": "string",
  "skip_drive_upload": "boolean (optional, defaults to false/env)",
  "scenes": [
    {
      "duration_seconds": "number",
      "caption": "string (the full text to display for the scene)",
      "caption_chunks": "array of strings (optional, pre-chunked words)",
      "video_url": "string (direct URL to a downloadable .mp4)"
    }
  ]
}
```

---

## 3. Step-by-Step Processing Pipeline

When a request is received by `server.js`, it is validated and passed to `render.js`, which orchestrates a temporary workspace (`/tmp/ffmpeg-job-<uuid>`) and executes the following 5 steps:

### Step 1: Download Scenes (`download.js`)
Iterates through the `scenes` array and downloads the raw video `.mp4` for each scene via its `video_url`. The files are saved locally in the job directory as `raw_scene_0.mp4`, `raw_scene_1.mp4`, etc.

### Step 2: Download Audio (`download.js`)
Uses the Google Drive API and Service Account credentials to download the background audio track specified by `audio_drive_file_id` as `audio.mp3`.

### Step 3: Subtitle Generation (`subtitle.js`)
Converts the scene captions into a dynamic Advanced SubStation Alpha (`.ass`) file.
1. **Chunking**: If `caption_chunks` is not provided, the scene's full `caption` is automatically split into short phrases (approx. 4 words each).
2. **Proportional Timing**: Instead of dividing the scene duration evenly, the script calculates the duration of each chunk *proportionally based on its character length*. This ensures long words stay on screen longer, closely matching natural speech patterns.
3. **Styling & Animation**:
   - A fade-in animation `{\fad(150,0)}` is applied to every chunk.
   - The ASS header defines the style: `DejaVu Sans` font, center-screen alignment (`Alignment: 5`), white text, and a semi-transparent black background box (`BackColour: &H40000000`, `BorderStyle: 3`).

### Step 4: FFmpeg Assembly (`assemble.js`)
This is the core rendering step, executed in two passes:

**Pass 1: Process Individual Scenes**
Each raw scene is processed through a complex filtergraph:
1. **Blurred Background**: The original video is scaled up to fill 1080x1920 and a strong boxblur (`boxblur=20:20`) is applied to create a background canvas.
2. **Foreground**: The original video is scaled to *fit* within 1080x1920 while maintaining its aspect ratio.
3. **Overlay**: The sharp foreground is overlaid on top of the blurred background, and the scene is trimmed to exactly match `duration_seconds`.

**Pass 2: Final Concatenation & Burning**
FFmpeg takes the processed scenes, the background audio, and the ASS subtitles:
- Uses the `concat` demuxer to stitch the processed scenes together.
- Merges the `audio.mp3` track.
- Uses the `ass` video filter (`-vf ass=subtitles.ass`) to burn the animated subtitles directly into the video frames.
- Trims the final output to exactly `total_seconds`.

### Step 5: Upload & Cleanup (`upload.js` / `render.js`)
- If `skip_drive_upload` is false, the final `.mp4` is uploaded to the target Google Drive folder using OAuth2 delegation (bypassing Service Account quota limits).
- If `skip_drive_upload` is true, the `.mp4` is copied to the `/app/output` directory (mapped to your host's `./output` folder) for local testing.
- **Cleanup**: The `/tmp/ffmpeg-job-<uuid>` directory is completely deleted to free up container disk space, regardless of whether the job succeeded or failed.
