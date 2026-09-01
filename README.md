# FFmpeg Video Rendering Service

A Node.js microservice running in a Dockerized Alpine Linux container, designed to automatically generate and assemble short-form video reels (e.g., TikToks, YouTube Shorts, Instagram Reels) using FFmpeg.

## Features

- **Automated Video Assembly**: Concatenates multiple scene clips into a single video.
- **Dynamic Word-by-Word Subtitles**: Automatically chunks text and generates ASS subtitles with fade-in animations, perfectly synced to speech timing, and styled with opaque background boxes.
- **Blurred Backgrounds**: Automatically scales horizontal/landscape video clips and adds a visually appealing blurred background effect to fill the 1080x1920 vertical format (replacing ugly black padding).
- **Google Drive Integration**: Fetches audio tracks directly from Google Drive and uploads the final assembled video back to a Google Drive folder using OAuth2 delegation.
- **Local Testing Mode**: Ability to skip Google Drive upload and save the rendered video to a local `./output/` directory for fast testing.
- **Dockerized Environment**: Bundles `ffmpeg`, `libass`, `fontconfig`, and the `DejaVu Sans` font ensuring consistent and reproducible rendering across any host machine.

## Pipeline Overview

When the `/render` API endpoint is called, the service executes a 5-step pipeline:

1. **Download Scenes**: Downloads all provided video clips via their external URLs to a temporary job directory.
2. **Download Audio**: Authenticates via Google Service Account and downloads the background audio track from Google Drive.
3. **Generate Subtitles**: Parses the text captions, calculates proportional timings, and generates a `.ass` (Advanced SubStation Alpha) subtitle file with word-by-word fade-in animations.
4. **FFmpeg Assembly**:
   - Scales and blurs the background.
   - Overlays the foreground.
   - Concatenates the scenes.
   - Burns the `.ass` subtitles directly onto the video.
   - Merges the audio track.
5. **Upload & Cleanup**: Uploads the final `.mp4` to Google Drive (or saves locally) and forcefully cleans up the temporary `/tmp/ffmpeg-job-*` directory.

## Getting Started

### Prerequisites

- Docker and Docker Compose
- Google Cloud Platform Service Account Key (`service-account.json`)
- Google OAuth2 Client ID and Secret (for Google Drive upload quota workaround)

### Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

Key environment variables:
- `PORT`: Port the service listens on (default: `3001`).
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Path to your service account key.
- `GOOGLE_DRIVE_FOLDER_ID`: The target Drive folder for output videos.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`: OAuth2 credentials for uploading.
- `SKIP_DRIVE_UPLOAD`: Set to `true` to save videos locally to `./output/` instead of uploading.

### Running the Service

Start the service using Docker Compose:

```bash
docker compose up -d --build
```

The service will be available at `http://localhost:3001`.

### Testing the UI Rendering Pipeline (Puppeteer)

To specifically test the headless browser UI overlay rendering without running the full API, you can build and run the test container. The command mounts a volume so the generated WebM video is saved to your host machine:

```powershell
# 1. Build the test image
docker build -t ffmpeg-puppeteer-test .

# 2. Run the test script and output to the local test_output_workspace folder
docker run --rm -v "${PWD}\test_output_workspace:/app/test_output_workspace" ffmpeg-puppeteer-test node test-render-ui.js
```

## API Documentation

### POST `/render`

Initiates the video rendering pipeline.

**Payload Example:**

```json
{
  "reel_id": "my_awesome_reel",
  "total_seconds": 15,
  "audio_drive_file_id": "1abcXYZ_drive_file_id_here",
  "skip_drive_upload": false,
  "scenes": [
    {
      "duration_seconds": 5,
      "caption": "Did you know that AI can now render videos automatically?",
      "video_url": "https://example.com/videos/scene1.mp4"
    },
    {
      "duration_seconds": 10,
      "caption": "It generates word by word subtitles with a blurred background!",
      "video_url": "https://example.com/videos/scene2.mp4"
    }
  ]
}
```

**Parameters:**
- `reel_id`: Unique identifier for the output video.
- `total_seconds`: The total duration to trim the final video to.
- `audio_drive_file_id`: The ID of the audio file hosted on Google Drive.
- `skip_drive_upload`: (Optional) Boolean to override the `.env` upload setting per request.
- `scenes`: Array of scene objects, each containing:
  - `duration_seconds`: How long the scene should play.
  - `caption`: The text to display over the scene (will be chunked automatically).
  - `caption_chunks`: (Optional) Pre-chunked array of phrases if you want precise control over the word chunks.
  - `video_url`: Direct URL to the raw video `.mp4`.

## Troubleshooting

- **Subtitles not appearing**: Check the generated `.ass` file in the FFmpeg logs. Ensure `fontconfig` and `ttf-dejavu` are properly installed in the Dockerfile.
- **Drive Upload Quota Errors**: Google Drive restricts Service Accounts from uploading files. You must use the OAuth2 delegation flow (`scripts/get-oauth-token.js`) to generate a refresh token.
