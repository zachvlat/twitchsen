const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const https = require('https');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4444;
const staticPath = process.env.STATIC_PATH || path.join(__dirname, '../');
const LIVE_STATUS_ENABLED = process.env.LIVE_STATUS !== 'off';

// Twitch logins: 1-25 chars, letters/digits/underscore
const CHANNEL_RE = /^[a-z0-9_]{1,25}$/;
// Streamlink quality names (best, worst, 720p60, audio_only, ...) and comma-separated fallbacks
const QUALITY_RE = /^[a-z0-9_]+(,[a-z0-9_]+)*$/i;

function normalizeChannel(value) {
  if (typeof value !== 'string') return null;
  const ch = value.trim().toLowerCase();
  return CHANNEL_RE.test(ch) ? ch : null;
}

app.use(express.json());

// Only expose the frontend, not the whole project directory
const indexFile = path.join(staticPath, 'index.html');
app.use('/css', express.static(path.join(staticPath, 'css')));
app.use('/js', express.static(path.join(staticPath, 'js')));
app.get(['/', '/index.html', '/channel/:name'], (req, res) => {
  res.sendFile(indexFile);
});

const dbPath = process.env.DB_PATH || path.join(__dirname, 'db', 'twitchsen.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS follows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT UNIQUE NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'twitchsen' }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function getStreamStatus(channels) {
  if (!LIVE_STATUS_ENABLED || !channels || channels.length === 0) return Object.create(null);
  const logins = channels.map(c => encodeURIComponent(c)).join(',');
  try {
    const data = await fetchJson(`https://api.ivr.fi/v2/twitch/user?login=${logins}`);
    const status = Object.create(null);
    (Array.isArray(data) ? data : []).forEach(u => {
      const login = (u.login || '').toLowerCase();
      // viewer count for live channels; offline channels are left out
      if (u.stream) status[login] = Number(u.stream.viewersCount) || 0;
    });
    return status;
  } catch (e) {
    return Object.create(null);
  }
}

function allFollows() {
  return new Promise((resolve, reject) => {
    db.all('SELECT channel FROM follows ORDER BY added_at ASC', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows.map(r => r.channel.toLowerCase()));
    });
  });
}

app.get('/api/follows', async (req, res) => {
  try {
    const channels = await allFollows();
    const status = await getStreamStatus(channels);
    const online = channels.filter(c => c in status).sort();
    const offline = channels.filter(c => !(c in status)).sort();
    const viewers = Object.create(null);
    online.forEach(c => { viewers[c] = status[c]; });
    res.json({ online, offline, viewers, liveStatus: LIVE_STATUS_ENABLED });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/follows', (req, res) => {
  const channel = normalizeChannel(req.body && req.body.channel);
  if (!channel) {
    return res.status(400).json({ error: 'Valid channel name required' });
  }
  db.run('INSERT OR IGNORE INTO follows (channel) VALUES (?)', [channel], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ channel, added: this.changes > 0 });
  });
});

app.delete('/api/follows/:channel', (req, res) => {
  const channel = normalizeChannel(req.params.channel);
  if (!channel) {
    return res.status(400).json({ error: 'Valid channel name required' });
  }
  db.run('DELETE FROM follows WHERE channel = ?', [channel], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ removed: this.changes > 0 });
  });
});

app.get('/api/stream/:channel', (req, res) => {
  const channel = normalizeChannel(req.params.channel);
  if (!channel) return res.status(400).json({ error: 'Valid channel name required' });
  const quality = typeof req.query.quality === 'string' ? req.query.quality : 'best';
  if (!QUALITY_RE.test(quality)) return res.status(400).json({ error: 'Invalid quality' });

  const proc = spawn('streamlink', ['--json', '--', `https://twitch.tv/${channel}`, quality], { timeout: 60000 });
  let stdout = '';
  let stderr = '';
  let done = false;
  const finish = (status, body) => {
    if (done) return;
    done = true;
    res.status(status).json(body);
  };
  proc.stdout.on('data', d => stdout += d);
  proc.stderr.on('data', d => stderr += d);
  proc.on('close', code => {
    if (code !== 0) {
      console.error(`streamlink failed for ${channel} (exit ${code}): ${(stdout + stderr).trim().slice(0, 300)}`);
      return finish(404, { error: 'stream not found or offline', details: stderr.slice(0, 200) });
    }
    try {
      const j = JSON.parse(stdout);
      const upstream = j.url && parseUpstream(j.url);
      if (!upstream) return finish(404, { error: 'stream not found or offline' });
      finish(200, { url: hlsProxyPath(upstream.href), type: j.type });
    } catch (e) {
      finish(500, { error: 'parse error' });
    }
  });
  proc.on('error', (err) => {
    console.error(`could not run streamlink: ${err.message}`);
    finish(500, { error: 'streamlink error' });
  });
});

// Third-party chat emotes (7TV, BTTV, FFZ), merged into { name: [url1x, url2x] }.
// Cached in memory so channel switches and reloads don't hit the providers each time.
const EMOTE_TTL = 10 * 60 * 1000;
const emoteCache = new Map();

async function cachedEmotes(key, loader) {
  const hit = emoteCache.get(key);
  if (hit && Date.now() - hit.at < EMOTE_TTL) return hit.data;
  let data;
  try {
    data = await loader();
  } catch (e) {
    data = hit ? hit.data : [];
  }
  emoteCache.delete(key);
  emoteCache.set(key, { at: Date.now(), data });
  if (emoteCache.size > 300) emoteCache.delete(emoteCache.keys().next().value);
  return data;
}

// Each loader returns a list of [name, url1x, url2x]; a missing user/room just yields []
function sevenTvEmotes(list) {
  return (Array.isArray(list) ? list : []).map(e => {
    const host = e && e.data && e.data.host;
    if (!host || !host.url) return null;
    return [e.name, `https:${host.url}/1x.webp`, `https:${host.url}/2x.webp`];
  }).filter(Boolean);
}

function bttvEmotes(list) {
  return (Array.isArray(list) ? list : []).filter(e => e && e.id).map(e =>
    [e.code, `https://cdn.betterttv.net/emote/${e.id}/1x.webp`, `https://cdn.betterttv.net/emote/${e.id}/2x.webp`]);
}

function ffzEmotes(sets, setIds) {
  const result = [];
  (setIds || []).forEach(id => {
    const set = sets && sets[id];
    ((set && set.emoticons) || []).forEach(e => {
      const urls = e.animated || e.urls || {};
      if (urls['1']) result.push([e.name, urls['1'], urls['2'] || urls['1']]);
    });
  });
  return result;
}

const emoteSources = {
  global: [
    () => cachedEmotes('ffz:global', async () => {
      const d = await fetchJson('https://api.frankerfacez.com/v1/set/global');
      return ffzEmotes(d.sets, d.default_sets);
    }),
    () => cachedEmotes('bttv:global', async () =>
      bttvEmotes(await fetchJson('https://api.betterttv.net/3/cached/emotes/global'))),
    () => cachedEmotes('7tv:global', async () =>
      sevenTvEmotes((await fetchJson('https://7tv.io/v3/emote-sets/global')).emotes)),
  ],
  channel: [
    (id) => cachedEmotes(`ffz:${id}`, async () => {
      const d = await fetchJson(`https://api.frankerfacez.com/v1/room/id/${id}`);
      return d.room ? ffzEmotes(d.sets, [d.room.set]) : [];
    }),
    (id) => cachedEmotes(`bttv:${id}`, async () => {
      const d = await fetchJson(`https://api.betterttv.net/3/cached/users/twitch/${id}`);
      return bttvEmotes([...(d.channelEmotes || []), ...(d.sharedEmotes || [])]);
    }),
    (id) => cachedEmotes(`7tv:${id}`, async () => {
      const d = await fetchJson(`https://7tv.io/v3/users/twitch/${id}`);
      return sevenTvEmotes(d.emote_set && d.emote_set.emotes);
    }),
  ],
};

app.get('/api/emotes/:roomId', async (req, res) => {
  const roomId = req.params.roomId;
  if (!/^\d{1,20}$/.test(roomId)) return res.status(400).json({ error: 'Invalid room id' });
  const lists = await Promise.all([
    ...emoteSources.global.map(load => load()),
    ...emoteSources.channel.map(load => load(roomId)),
  ]);
  // Later lists win on name clashes: channel over global, 7TV over BTTV over FFZ
  const emotes = Object.create(null);
  lists.flat().forEach(([name, url1, url2]) => {
    if (typeof name === 'string' && name) emotes[name] = [url1, url2];
  });
  res.set('Cache-Control', 'private, max-age=300');
  res.json(emotes);
});

// HLS relay: the browser fetches playlists and segments from us instead of Twitch's CDN,
// which browser tracking protection and ad blockers often block. Only Twitch video hosts
// are allowed so this can't be used as an open proxy.
function isAllowedHost(hostname) {
  return hostname === 'ttvnw.net' || hostname.endsWith('.ttvnw.net');
}

function parseUpstream(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && isAllowedHost(url.hostname)) return url;
  } catch (e) {}
  return null;
}

function hlsProxyPath(absUrl) {
  return `/api/hls?u=${encodeURIComponent(absUrl)}`;
}

function rewritePlaylist(text, base) {
  const proxied = (uri) => {
    try {
      const abs = new URL(uri, base);
      return isAllowedHost(abs.hostname) ? hlsProxyPath(abs.href) : uri;
    } catch (e) {
      return uri;
    }
  };
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // Tags that reference other resources (init segments, keys, renditions, parts)
      if (/^#EXT-X-(MAP|KEY|MEDIA|I-FRAME-STREAM-INF|PART|PRELOAD-HINT|RENDITION-REPORT|SESSION-KEY)\b/.test(trimmed)) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => `URI="${proxied(uri)}"`);
      }
      return line;
    }
    return proxied(trimmed);
  }).join('\n');
}

function relayHls(target, req, res, redirects = 0) {
  const upstream = https.get(target, { headers: { 'User-Agent': 'twitchsen' }, timeout: 15000 }, (up) => {
    if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
      up.resume();
      const next = parseUpstream(new URL(up.headers.location, target).href);
      if (!next || redirects >= 3) return res.status(502).end();
      return relayHls(next, req, res, redirects + 1);
    }
    const type = up.headers['content-type'] || '';
    const isPlaylist = /mpegurl/i.test(type) || target.pathname.endsWith('.m3u8');
    res.status(up.statusCode);
    res.set('Cache-Control', 'no-store');
    if (isPlaylist) {
      let body = '';
      up.setEncoding('utf8');
      up.on('data', chunk => body += chunk);
      up.on('end', () => {
        res.type('application/vnd.apple.mpegurl');
        res.send(up.statusCode === 200 ? rewritePlaylist(body, target) : body);
      });
    } else {
      if (type) res.set('Content-Type', type);
      if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
      up.pipe(res);
    }
  });
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
  upstream.on('error', (err) => {
    console.error(`HLS relay error for ${target.hostname}: ${err.message}`);
    if (!res.headersSent) res.status(502).end();
    else res.destroy();
  });
  // Stop downloading if the browser goes away (e.g. switched channel)
  res.on('close', () => upstream.destroy());
}

app.get('/api/hls', (req, res) => {
  const target = parseUpstream(typeof req.query.u === 'string' ? req.query.u : '');
  if (!target) return res.status(400).json({ error: 'URL not allowed' });
  relayHls(target, req, res);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
