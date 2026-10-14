# twitchsen - Minimal Twitch Viewer
# Node 24 LTS: includes built-in SQLite (node:sqlite), so there are no native npm
# modules and the same Dockerfile builds correctly for amd64 and arm64.
FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-pip
RUN pip3 install --break-system-packages --no-cache-dir streamlink

# Install dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Copy app files explicitly (never the host's backend/node_modules or data)
WORKDIR /app
COPY backend/server.js ./backend/server.js
COPY css ./css
COPY js ./js
COPY assets ./assets
COPY index.html ./index.html
COPY README.md ./README.md
COPY LICENSE ./LICENSE

# Data directory for SQLite; mount a volume here to keep follows and themes
RUN mkdir -p /app/backend/db

# Expose port
EXPOSE 4444

# Set environment
ENV PORT=4444
ENV NODE_ENV=production
ENV STATIC_PATH=/app

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:4444/ || exit 1

# Start server
WORKDIR /app/backend
CMD ["node", "server.js"]
