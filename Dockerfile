# ── Build stage ──────────────────────────────────────────
FROM node:20-bookworm-slim

# Install Chromium, FFmpeg, and required fonts for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Environment variables ────────────────────────────────
ENV PORT=3001
ENV GOOGLE_SERVICE_ACCOUNT_JSON=/app/service_account.json
ENV GOOGLE_DRIVE_FOLDER_ID=1ptnRDhMy9L5__BIWyNF6piaxsDiUAWhL
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Install deps first (layer-cached when package.json hasn't changed)
COPY package.json ./
RUN npm install --production

# Copy application source and templates
COPY src/ ./src/
COPY templates/ ./templates/
COPY test-render-ui.js ./

EXPOSE 3001

CMD ["node", "src/server.js"]
