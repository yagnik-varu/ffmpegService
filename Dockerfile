# ── Build stage ──────────────────────────────────────────
FROM node:20-alpine

# ffmpeg (libass subtitle rendering), fonts (required by libass for text rendering), python3
RUN apk add --no-cache ffmpeg python3 ttf-dejavu fontconfig && fc-cache -f

WORKDIR /app

# ── Environment variables ────────────────────────────────
ENV PORT=3001
ENV GOOGLE_SERVICE_ACCOUNT_JSON=/app/service_account.json
ENV GOOGLE_DRIVE_FOLDER_ID=1ptnRDhMy9L5__BIWyNF6piaxsDiUAWhL

# Install deps first (layer-cached when package.json hasn't changed)
COPY package.json ./
RUN npm install --production

# Copy application source
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/server.js"]
