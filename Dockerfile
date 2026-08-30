# ── Build stage ──────────────────────────────────────────
FROM node:20-alpine

# ffmpeg (includes libx264 + aac) and python3 (sometimes needed by npm native addons)
RUN apk add --no-cache ffmpeg python3

WORKDIR /app

# Install deps first (layer-cached when package.json hasn't changed)
COPY package.json ./
RUN npm install --production

# Copy application source
COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/server.js"]
