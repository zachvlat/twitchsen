# twitchsen - Minimal Twitch Viewer
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-pip
RUN pip3 install --break-system-packages --no-cache-dir streamlink

# Install dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

# Copy backend and frontend
WORKDIR /app
COPY backend ./backend
COPY css ./css
COPY js ./js
COPY index.html ./index.html
COPY README.md ./README.md
COPY LICENSE ./LICENSE

# Create data directory for SQLite
RUN mkdir -p /app/backend/db

# Expose port
EXPOSE 4444

# Set environment
ENV PORT=4444
ENV NODE_ENV=production
ENV STATIC_PATH=/app
ENV PATH=/usr/local/bin:/usr/bin:/bin:$PATH

# Start server
WORKDIR /app/backend
CMD ["node", "server.js"]
