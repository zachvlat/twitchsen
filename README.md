# twitchsen

twitchsen is a minimal, self-hosted web application for watching Twitch streams without tracking or bloat. It provides a clean, distraction-free viewing experience with customizable CSS themes, channel following, and integrated chat.

<img height="300" alt="1" src="https://github.com/user-attachments/assets/0d7b62d1-24c2-4017-9b04-741dd1f29d30" />


## How it works

- The backend resolves a channel's HLS playlist with [streamlink](https://streamlink.github.io/) (`/api/stream/:channel`), and the browser plays it with [hls.js](https://github.com/video-dev/hls.js) in a plain `<video>` element. Playlists and video segments are relayed through the backend (`/api/hls`, limited to Twitch video hosts), so browser tracking protection and ad blockers that block Twitch's CDN don't break playback. Each viewer uses roughly 3-8 Mbit/s of the server's bandwidth.
- Chat is read-only, via an anonymous connection to Twitch IRC over WebSocket.
- Follows and custom themes are stored server-side in SQLite (Node's built-in `node:sqlite`, so there are no native modules and the image runs on amd64 and arm64 alike). Live/offline status comes from [api.ivr.fi](https://api.ivr.fi) (can be disabled).

## Features

- **No tracking** - No Twitch page, no analytics; just the video stream and chat
- **Channel Following** - Follow your favorite channels with SQLite persistence
- **Live Chat** - Integrated read-only Twitch chat panel with Twitch, 7TV, BTTV and FrankerFaceZ emotes
- **Themeable** - 6 built-in CSS themes plus an in-app custom theme editor
- **Self-hostable** - Simple Docker deployment with Node.js backend and SQLite storage
- **Responsive** - Works on desktop, tablet, and mobile devices
- **Shareable** - Link directly to a channel: `/channel/username`
- **Lightweight** - Pure HTML, CSS, and vanilla JavaScript - no frameworks

Note: the stream is Twitch's own HLS playlist, so Twitch may still insert ad segments into it.

## Quick Start (local)

```bash
docker run -d --name twitchsen --restart unless-stopped -p 4444:4444 -v ~/twitchsen/data:/app/backend/db zatsando/twitchsen:latest
```

Open `http://localhost:4444`. The `-v` volume keeps your follows and themes (`twitchsen.db`) when the container is replaced; without it they are lost on every update.

### Docker Compose

```yaml
services:
  twitchsen:
    image: zatsando/twitchsen:latest
    container_name: twitchsen
    ports:
      - "4444:4444"   # optional behind a reverse proxy on the same Docker network
    volumes:
      - ./twitchsen/data:/app/backend/db
    restart: unless-stopped
```

To move an existing database in, stop the container and copy your `twitchsen.db` into the mounted folder.

### Building the image (amd64 + arm64)

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64 && (docker buildx use multi 2>/dev/null || docker buildx create --use --name multi) && docker buildx build --platform linux/amd64,linux/arm64 -t zatsando/twitchsen:latest --push .
```

### Running without Docker

Requires Node.js 22.13+ and `streamlink` on your PATH:

```bash
cd backend && npm install && node server.js
```

## Custom Themes

1. Select "New Custom Theme..." from the theme dropdown
2. Give the theme a name and edit the CSS (a `:root { ... }` block of CSS variables is prefilled)
3. Click "Save & Apply" - the theme is added to the dropdown and saved on the server, so it is available in every browser

The custom CSS can override any CSS variables or styles defined in the app.
