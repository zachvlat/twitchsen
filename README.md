# twitchsen

twitchsen is a minimal, self-hosted web application for watching Twitch streams without tracking or bloat. It provides a clean, distraction-free viewing experience with customizable CSS themes, channel following, and integrated chat.

<img height="300" alt="1" src="https://github.com/user-attachments/assets/c0dc884d-8813-4838-8f50-bb531cbea964" />


## How it works

- The backend resolves a channel's HLS playlist with [streamlink](https://streamlink.github.io/) (`/api/stream/:channel`), and the browser plays it with [hls.js](https://github.com/video-dev/hls.js) in a plain `<video>` element. Playlists and video segments are relayed through the backend (`/api/hls`, limited to Twitch video hosts), so browser tracking protection and ad blockers that block Twitch's CDN don't break playback. Each viewer uses roughly 3-8 Mbit/s of the server's bandwidth.
- Chat is read-only, via an anonymous connection to Twitch IRC over WebSocket.
- Follows are stored server-side in SQLite. Live/offline status comes from [api.ivr.fi](https://api.ivr.fi) (can be disabled).

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

Open `http://localhost:4444`.

## Custom Themes

1. Select "New Custom Theme..." from the theme dropdown
2. Give the theme a name and edit the CSS (a `:root { ... }` block of CSS variables is prefilled)
3. Click "Save & Apply" - the theme is added to the dropdown and persisted in localStorage

The custom CSS can override any CSS variables or styles defined in the app.
