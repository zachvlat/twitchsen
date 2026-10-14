// twitchsen - Minimal Twitch Viewer
// No tracking - streams via streamlink + hls.js, chat via anonymous IRC

class TwitchViewer {
    constructor() {
        this.channelInput = document.getElementById('channelInput');
        this.loadBtn = document.getElementById('loadBtn');
        this.followBtn = document.getElementById('followBtn');
        this.themeSelect = document.getElementById('themeSelect');
        this.customThemeGroup = document.getElementById('customThemeGroup');
        this.dynamicThemeStyles = document.getElementById('dynamicThemeStyles');
        this.themeEditor = document.getElementById('themeEditor');
        this.closeThemeEditorBtn = document.getElementById('closeThemeEditor');
        this.cancelTheme = document.getElementById('cancelTheme');
        this.saveTheme = document.getElementById('saveTheme');
        this.themeNameInput = document.getElementById('themeNameInput');
        this.themeCssEditor = document.getElementById('themeCssEditor');
        this.welcomeScreen = document.getElementById('welcomeScreen');
        this.playerContainer = document.getElementById('playerContainer');
        this.twitchVideo = document.getElementById('twitchVideo');
        this.followsList = document.getElementById('followsList');
        this.exportFollowsBtn = document.getElementById('exportFollowsBtn');
        this.importFollowsBtn = document.getElementById('importFollowsBtn');
        this.importFollowsInput = document.getElementById('importFollowsInput');
        this.importHelpBadge = document.querySelector('.import-help-badge');
        this.importHelpModal = document.getElementById('importHelpModal');
        this.closeImportHelp = document.getElementById('closeImportHelp');
        this.copyImportSnippet = document.getElementById('copyImportSnippet');
        this.qualitySelect = document.getElementById('qualitySelect');
        this.qualityControl = document.getElementById('qualityControl');
        this.streamInfo = document.getElementById('streamInfo');
        this.streamTitle = document.getElementById('streamTitle');
        this.streamFollowBtn = document.getElementById('streamFollowBtn');
        this.goLiveBtn = document.getElementById('goLiveBtn');
        this.sidebarEmpty = document.getElementById('sidebarEmpty');
        this.currentChannel = null;
        this.currentQuality = 'best';
        this.followed = new Set();
        this.customThemes = {};
        this.chatSizes = this.loadChatSizes();
        this.sidebarCollapsed = localStorage.getItem('twitchsen-sidebar-collapsed') === '1';
        this.init();
    }
    
    async init() {
        await this.loadCustomThemes();
        await this.migrateLocalCustomThemes();
        await this.loadCustomThemes();
        this.loadTheme();
        this.loadCustomThemesIntoDropdown();
        this.loadFollows();
        this.applySidebarCollapsed();
        const sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
            sidebarToggle.addEventListener('click', () => {
                this.sidebarCollapsed = !this.sidebarCollapsed;
                try { localStorage.setItem('twitchsen-sidebar-collapsed', this.sidebarCollapsed ? '1' : '0'); } catch (e) {}
                this.applySidebarCollapsed();
            });
        }
        // Refresh live status and viewer counts every minute while the tab is visible
        setInterval(() => {
            if (!document.hidden) this.loadFollows();
        }, 60000);
        document.addEventListener('visibilitychange', () => {
            // Catch up when returning to the tab, but not on every quick tab switch
            if (!document.hidden && Date.now() - this.lastFollowsLoad > 30000) this.loadFollows();
        });

        this.loadBtn.addEventListener('click', () => this.goToInputChannel());

        if (this.qualitySelect) {
            this.qualitySelect.addEventListener('change', () => this.changeQuality());
        }
        if (this.streamFollowBtn) {
            this.streamFollowBtn.addEventListener('click', () => this.toggleFollowFromStream());
        }

        if (this.exportFollowsBtn) {
            this.exportFollowsBtn.addEventListener('click', () => this.exportFollows());
        }
        if (this.importFollowsBtn && this.importFollowsInput) {
            this.importFollowsBtn.addEventListener('click', () => this.importFollowsInput.click());
            this.importFollowsInput.addEventListener('change', (e) => this.importFollows(e));
        }
        if (this.importHelpBadge) {
            this.importHelpBadge.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (this.importHelpModal) this.importHelpModal.style.display = 'flex';
            });
        }
        if (this.closeImportHelp && this.importHelpModal) {
            this.closeImportHelp.addEventListener('click', () => { this.importHelpModal.style.display = 'none'; });
            this.importHelpModal.addEventListener('click', (e) => {
                if (e.target === this.importHelpModal) this.importHelpModal.style.display = 'none';
            });
        }
        if (this.copyImportSnippet) {
            this.copyImportSnippet.addEventListener('click', async () => {
                const code = this.copyImportSnippet.parentElement.parentElement.querySelector('code');
                if (!code) return;
                try { await navigator.clipboard.writeText(code.textContent); } catch (e) {}
            });
        }
        if (this.goLiveBtn) {
            this.goLiveBtn.addEventListener('click', () => this.goToLiveEdge());
        }
        
        if (this.followBtn) {
            this.followBtn.addEventListener('click', () => {
                this.followCurrentChannel();
            });
        }
        
        this.channelInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.goToInputChannel();
        });
        
        this.themeSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === 'new-custom') {
                this.openThemeEditor();
            } else if (this.customThemes[value]) {
                this.applyCustomTheme(value, this.customThemes[value]);
            } else {
                this.setTheme(value);
                this.dynamicThemeStyles.textContent = '';
            }
        });
        
        this.saveTheme.addEventListener('click', () => this.saveCustomTheme());
        this.cancelTheme.addEventListener('click', () => this.closeThemeEditor());
        this.closeThemeEditorBtn.addEventListener('click', () => this.closeThemeEditor());
        this.themeEditor.addEventListener('click', (e) => {
            if (e.target === this.themeEditor) this.closeThemeEditor();
        });
        
        const path = window.location.pathname;
        const channelMatch = path.match(/^\/channel\/([^/?#]+)/i);
        if (channelMatch) {
            let channel = null;
            try { channel = normalizeChannel(decodeURIComponent(channelMatch[1])); } catch (e) {}
            if (channel) {
                this.channelInput.value = channel;
                this.loadChannel(channel);
            }
        }
    }

    goToInputChannel() {
        const ch = normalizeChannel(this.channelInput.value);
        if (ch) {
            this.channelInput.classList.remove('invalid');
            window.location.href = `/channel/${ch}`;
        } else if (this.channelInput.value.trim()) {
            this.channelInput.classList.add('invalid');
        }
    }
    
    async loadCustomThemes() {
        try {
            const res = await fetch('/api/themes');
            if (!res.ok) throw new Error('bad response');
            const list = await res.json();
            const themes = {};
            (Array.isArray(list) ? list : []).forEach(t => {
                if (t && t.slug) themes[t.slug] = { name: t.name, css: t.css };
            });
            this.customThemes = themes;
        } catch (e) {
            this.customThemes = this.customThemes || {};
        }
    }

    async migrateLocalCustomThemes() {
        if (localStorage.getItem('twitchsen-themes-migrated') === '1') {
            try { localStorage.removeItem('twitchsen-custom-themes'); } catch (e) {}
            return;
        }
        let local = {};
        try { local = JSON.parse(localStorage.getItem('twitchsen-custom-themes') || '{}') || {}; } catch (e) {}
        for (const slug in local) {
            const t = local[slug];
            if (!t || !t.name || !t.css) continue;
            try {
                await fetch('/api/themes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: t.name, css: t.css })
                });
            } catch (e) {}
        }
        try { localStorage.setItem('twitchsen-themes-migrated', '1'); } catch (e) {}
        try { localStorage.removeItem('twitchsen-custom-themes'); } catch (e) {}
    }

    loadCustomThemesIntoDropdown() {
        if (!this.customThemeGroup) return;
        this.customThemeGroup.innerHTML = '';
        Object.keys(this.customThemes).forEach(slug => {
            const theme = this.customThemes[slug];
            const opt = document.createElement('option');
            opt.value = slug;
            opt.textContent = theme.name;
            this.customThemeGroup.appendChild(opt);
        });
    }
    
    slugify(text) {
        return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    
    openThemeEditor() {
        this.themeNameInput.value = '';
        this.themeCssEditor.value = `:root {\n  --bg-primary: #1e1e2e;\n  --bg-secondary: #313244;\n  --bg-tertiary: #45475a;\n  --text-primary: #cdd6f4;\n  --text-secondary: #a6adc8;\n  --border-color: #45475a;\n  --accent-color: #cba6f7;\n  --accent-hover: #b4befe;\n  --input-bg: #313244;\n  --input-border: #45475a;\n  --input-focus: #cba6f7;\n  --footer-text: #9399b2;\n  --welcome-bg: #313244;\n  --sidebar-bg: #313244;\n}`;
        this.themeEditor.style.display = 'flex';
    }
    
    closeThemeEditor() {
        this.themeEditor.style.display = 'none';
        // Don't leave "New Custom Theme..." selected after cancelling
        if (this.themeSelect) this.themeSelect.value = document.documentElement.getAttribute('data-theme');
    }
    
    async saveCustomTheme() {
        const name = this.themeNameInput.value.trim();
        const css = this.themeCssEditor.value.trim();
        if (!name || !css) return;
        try {
            const res = await fetch('/api/themes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, css })
            });
            if (!res.ok) return;
            const theme = await res.json();
            this.customThemes[theme.slug] = { name: theme.name, css: theme.css };
            this.loadCustomThemesIntoDropdown();
            this.applyCustomTheme(theme.slug, this.customThemes[theme.slug]);
            this.closeThemeEditor();
        } catch (e) {}
    }
    
    applyCustomTheme(slug, themeObj) {
        document.documentElement.setAttribute('data-theme', slug);
        this.dynamicThemeStyles.textContent = themeObj.css;
        localStorage.setItem('twitchsen-theme', slug);
        if (this.themeSelect) this.themeSelect.value = slug;
    }
    
    loadTheme() {
        const savedTheme = localStorage.getItem('twitchsen-theme') || 'dark';
        if (this.customThemes[savedTheme]) {
            this.applyCustomTheme(savedTheme, this.customThemes[savedTheme]);
        } else {
            this.dynamicThemeStyles.textContent = '';
            document.documentElement.setAttribute('data-theme', savedTheme);
            if (this.themeSelect) this.themeSelect.value = savedTheme;
        }
    }
    
    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('twitchsen-theme', theme);
    }
    
    applySidebarCollapsed() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed', !!this.sidebarCollapsed);
        const btn = document.getElementById('sidebarToggle');
        if (btn) {
            btn.textContent = this.sidebarCollapsed ? '›' : '‹';
            btn.title = this.sidebarCollapsed ? 'Expand follows' : 'Collapse follows';
        }
    }

    async loadFollows() {
        this.lastFollowsLoad = Date.now();
        try {
            const res = await fetch('/api/follows');
            const follows = await res.json();
            this.renderFollows(follows);
        } catch (e) {
            if (this.followsList) this.followsList.innerHTML = '';
            if (this.sidebarEmpty) this.sidebarEmpty.style.display = 'block';
        }
    }
    
    renderFollows(follows) {
        if (!this.followsList) return;
        this.followsList.innerHTML = '';
        if (this.sidebarEmpty) this.sidebarEmpty.style.display = 'block';
        if (!follows || (follows.online.length === 0 && follows.offline.length === 0)) {
            return;
        }
        if (this.sidebarEmpty) this.sidebarEmpty.style.display = 'none';
        
        const logos = follows.logos || {};
        this.followed = new Set([...(follows.online || []), ...(follows.offline || [])].map(c => String(c).toLowerCase()));
        this.updateFollowButton();
        if (follows.online.length > 0) {
            const onlineHeader = document.createElement('div');
            onlineHeader.className = 'follow-group-header';
            onlineHeader.textContent = 'Online (' + follows.online.length + ')';
            this.followsList.appendChild(onlineHeader);
            const viewers = follows.viewers || {};
            follows.online.forEach(channel => {
                this.createFollowItem(channel, true, viewers[channel], logos[channel]);
            });
        }
        
        if (follows.offline.length > 0) {
            const offlineHeader = document.createElement('div');
            offlineHeader.className = 'follow-group-header';
            const label = follows.liveStatus === false ? 'Following' : 'Offline';
            offlineHeader.textContent = label + ' (' + follows.offline.length + ')';
            this.followsList.appendChild(offlineHeader);
            follows.offline.forEach(channel => {
                this.createFollowItem(channel, false, undefined, logos[channel]);
            });
        }
    }
    
    createFollowItem(channel, isOnline, viewers, logo) {
        const item = document.createElement('a');
        item.className = 'follow-item' + (isOnline ? ' online' : ' offline');
        item.href = `/channel/${encodeURIComponent(channel)}`;

        const logoEl = document.createElement('span');
        logoEl.className = 'follow-logo';
        if (logo) {
            const img = document.createElement('img');
            img.src = logo;
            img.alt = '';
            img.loading = 'lazy';
            img.addEventListener('error', () => {
                img.remove();
                logoEl.textContent = (channel.charAt(0) || '?').toUpperCase();
                logoEl.classList.add('follow-logo-fallback');
            });
            logoEl.appendChild(img);
        } else {
            logoEl.textContent = (channel.charAt(0) || '?').toUpperCase();
            logoEl.classList.add('follow-logo-fallback');
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'follow-name';
        nameEl.textContent = channel;

        item.appendChild(logoEl);
        item.appendChild(nameEl);

        if (typeof viewers === 'number') {
            const viewersEl = document.createElement('span');
            viewersEl.className = 'follow-viewers';
            viewersEl.title = viewers.toLocaleString() + ' viewers';
            viewersEl.textContent = formatViewers(viewers);
            item.appendChild(viewersEl);
        }

        this.followsList.appendChild(item);
    }
    
    async followCurrentChannel() {
        if (!this.currentChannel) return;
        try {
            await fetch('/api/follows', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel: this.currentChannel })
            });
            await this.loadFollows();
        } catch (e) {}
    }
    
    async unfollowChannel(channel) {
        try {
            await fetch(`/api/follows/${encodeURIComponent(channel)}`, { method: 'DELETE' });
            await this.loadFollows();
        } catch (e) {}
    }
    
    async loadStream(channel, isRetry = false) {
        const video = this.twitchVideo;
        if (!video) return;
        if (!isRetry) this.streamReloads = 0;
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        video.removeAttribute('src');
        video.load();
        if (!this.playingListenerAdded) {
            video.addEventListener('playing', () => {
                if (!video.muted) this.hidePlayerMessage();
            });
            this.playingListenerAdded = true;
        }
        this.showPlayerMessage('Loading stream…');
        if (this.qualityControl) this.qualityControl.style.display = 'none';
        if (this.streamInfo) this.streamInfo.style.display = 'none';
        const quality = this.currentQuality || 'best';
        try {
            const res = await fetch(`/api/stream/${encodeURIComponent(channel)}?quality=${encodeURIComponent(quality)}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                console.error('stream lookup failed', res.status, body);
                this.showPlayerError(res.status === 404
                    ? 'Stream is offline or unavailable'
                    : `Could not load stream (${body.error || 'HTTP ' + res.status})`);
                this.updateStreamInfo(res.status === 404 ? `${channel} (offline)` : channel, channel);
                return;
            }
            const data = await res.json();
            if (data.quality) this.currentQuality = data.quality;
            this.populateQualityOptions(data.qualities, this.currentQuality);
            this.updateStreamInfo(data.title, channel, data.game, data.bio);
            const src = data.url;
            if (window.Hls && window.Hls.isSupported()) {
                const Hls = window.Hls;
                const hls = new Hls();
                this.hls = hls;
                let networkRetries = 0;
                let mediaRecoveries = 0;
                hls.loadSource(src);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => this.startPlayback());
                hls.on(Hls.Events.FRAG_BUFFERED, () => {
                    networkRetries = 0;
                });
                hls.on(Hls.Events.ERROR, (event, err) => {
                    if (this.hls !== hls || !err || !err.fatal) return;
                    console.error('hls.js fatal error', err);
                    // Recovery steps recommended by hls.js. Media errors are typical when
                    // Twitch splices in ad segments with a different encoding.
                    if (err.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
                        networkRetries++;
                        setTimeout(() => { if (this.hls === hls) hls.startLoad(); }, 1000 * networkRetries);
                    } else if (err.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
                        mediaRecoveries++;
                        if (mediaRecoveries === 2) hls.swapAudioCodec();
                        hls.recoverMediaError();
                    } else if (this.streamReloads < 2) {
                        // Playlist token may have expired: ask the backend for a fresh URL
                        this.streamReloads++;
                        this.loadStream(channel, true);
                    } else {
                        this.showPlayerError(`Playback error (${err.type}: ${err.details})`);
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = src;
                this.startPlayback();
            } else {
                this.showPlayerError('HLS playback not supported in this browser');
            }
        } catch (e) {
            this.showPlayerError('Failed to load stream');
            this.updateStreamInfo(channel, channel);
        }
    }
    
    updateStreamInfo(title, channel, game, bio) {
        if (this.streamTitle) {
            this.streamTitle.textContent = title || channel || '';
        }
        if (this.streamInfo) {
            this.streamInfo.style.display = 'flex';
        }
        const details = document.getElementById('streamDetails');
        const gameEl = document.getElementById('streamGame');
        const bioEl = document.getElementById('streamBio');
        if (details) {
            if (gameEl) { gameEl.textContent = game ? ('Game: ' + game) : ''; gameEl.style.display = game ? '' : 'none'; }
            if (bioEl) { bioEl.textContent = bio || ''; bioEl.style.display = bio ? '' : 'none'; }
            details.style.display = (game || bio) ? 'flex' : 'none';
        }
        this.updateFollowButton();
    }

    updateFollowButton() {
        if (!this.streamFollowBtn) return;
        if (!this.currentChannel) {
            this.streamFollowBtn.style.display = 'none';
            return;
        }
        this.streamFollowBtn.style.display = '';
        const isFollowed = this.followed.has(this.currentChannel);
        this.streamFollowBtn.textContent = isFollowed ? 'Unfollow' : 'Follow';
    }

    async exportFollows() {
        try {
            const res = await fetch('/api/follows/export');
            if (!res.ok) return;
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'twitchsen-follows.json';
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {}
    }

    async importFollows(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const res = await fetch('/api/follows/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed)
            });
            if (res.ok) {
                await this.loadFollows();
            }
        } catch (e) {}
        input.value = '';
    }

    goToLiveEdge() {
        const video = this.twitchVideo;
        if (!video) return;
        try {
            if (this.hls) {
                // Jump hls.js to the live sync position
                if (typeof this.hls.liveSyncPosition === 'number') {
                    video.currentTime = this.hls.liveSyncPosition;
                } else if (video.seekable && video.seekable.length > 0) {
                    video.currentTime = Math.max(0, video.seekable.end(video.seekable.length - 1) - 0.5);
                }
                this.hls.startLoad();
            } else if (video.seekable && video.seekable.length > 0) {
                video.currentTime = Math.max(0, video.seekable.end(video.seekable.length - 1) - 0.5);
            }
            video.play().catch(() => {});
        } catch (e) {}
    }

    async toggleFollowFromStream() {
        if (!this.currentChannel) return;
        const ch = this.currentChannel;
        try {
            if (this.followed.has(ch)) {
                await fetch(`/api/follows/${encodeURIComponent(ch)}`, { method: 'DELETE' });
                this.followed.delete(ch);
            } else {
                await fetch('/api/follows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel: ch })
                });
                this.followed.add(ch);
            }
            await this.loadFollows();
        } catch (e) {}
        this.updateFollowButton();
    }

    changeQuality() {
        if (!this.qualitySelect || !this.currentChannel) return;
        this.currentQuality = this.qualitySelect.value;
        this.loadStream(this.currentChannel);
    }

    populateQualityOptions(qualities, selected) {
        if (!this.qualitySelect) return;
        if (!qualities || qualities.length === 0) {
            if (this.qualityControl) this.qualityControl.style.display = 'none';
            return;
        }
        const prev = selected || this.currentQuality || 'best';
        this.qualitySelect.innerHTML = '';
        this.orderQualities(qualities).forEach(q => {
            const opt = document.createElement('option');
            opt.value = q;
            opt.textContent = q;
            if (q === prev) opt.selected = true;
            this.qualitySelect.appendChild(opt);
        });
        if (qualities.indexOf(prev) === -1) this.qualitySelect.value = qualities[0];
        if (this.qualityControl) this.qualityControl.style.display = 'block';
    }

    orderQualities(qs) {
        const priority = (q) => {
            if (q === 'best') return 1e9;
            if (q === 'worst') return -1;
            if (q === 'audio_only') return -2;
            const m = String(q).match(/(\\d+)/);
            return m ? parseInt(m[1], 10) : 0;
        };
        return (qs || []).slice().sort((a, b) => priority(b) - priority(a));
    }

    // Browsers block autoplay with sound when the page was opened without a click
    // (e.g. /channel/name links), so fall back to muted autoplay, then to click-to-play.
    startPlayback() {
        const video = this.twitchVideo;
        video.muted = false;
        video.play().then(() => this.hidePlayerMessage()).catch(err => {
            if (!err || err.name !== 'NotAllowedError') return;
            video.muted = true;
            video.play().then(() => {
                this.showPlayerMessage('🔇 Click to unmute', () => {
                    video.muted = false;
                    this.hidePlayerMessage();
                });
            }).catch(() => {
                this.showPlayerMessage('▶ Click to play', () => {
                    video.muted = false;
                    video.play().catch(() => {});
                    this.hidePlayerMessage();
                });
            });
        });
    }

    showPlayerMessage(message, onClick) {
        this.showPlayerError(message);
        const el = this.twitchVideo.parentElement.querySelector('.player-error');
        el.classList.toggle('clickable', !!onClick);
        el.onclick = onClick || null;
    }

    hidePlayerMessage() {
        const el = this.twitchVideo && this.twitchVideo.parentElement.querySelector('.player-error');
        if (el) {
            el.style.display = 'none';
            el.classList.remove('clickable');
            el.onclick = null;
        }
    }

    showPlayerError(message) {
        const video = this.twitchVideo;
        if (!video) return;
        const wrapper = video.parentElement;
        let errEl = wrapper.querySelector('.player-error');
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.className = 'player-error';
            wrapper.appendChild(errEl);
        }
        errEl.textContent = message;
        errEl.style.display = 'block';
    }
    
    loadChannel(channel) {
        if (!channel) return;
        this.currentChannel = channel.toLowerCase();
        this.currentQuality = 'best';
        if (this.welcomeScreen) this.welcomeScreen.style.display = 'none';
        if (this.playerContainer) this.playerContainer.style.display = 'flex';
        if (this.twitchVideo) {
            this.loadStream(this.currentChannel);
        }
        const chatSidebar = document.getElementById('chatSidebar');
        if (chatSidebar) {
            chatSidebar.innerHTML = `
                <div class="chat-header">
                    <h3>Chat</h3>
                </div>
                <div id="chatMessages" class="chat-messages"></div>
                <div class="chat-footer">
                    ${Object.keys(CHAT_SIZES).map(key => `
                        <div class="chat-size-control" data-setting="${key}">
                            <span class="chat-size-label">${CHAT_SIZES[key].label}</span>
                            <button class="chat-size-btn" data-delta="-1" title="Smaller" aria-label="Smaller ${CHAT_SIZES[key].label.toLowerCase()}">−</button>
                            <button class="chat-size-value" title="Reset to default"></button>
                            <button class="chat-size-btn" data-delta="1" title="Larger" aria-label="Larger ${CHAT_SIZES[key].label.toLowerCase()}">+</button>
                        </div>
                    `).join('')}
                </div>
            `;
            chatSidebar.querySelectorAll('.chat-size-control').forEach(control => {
                const key = control.dataset.setting;
                control.querySelectorAll('.chat-size-btn').forEach(btn => {
                    btn.addEventListener('click', () => this.changeChatSize(key, Number(btn.dataset.delta) * CHAT_SIZES[key].step));
                });
                control.querySelector('.chat-size-value').addEventListener('click', () => {
                    this.changeChatSize(key, CHAT_SIZES[key].default - this.chatSizes[key]);
                });
            });
            this.applyChatSizes();
            chatSidebar.style.display = 'flex';
            this.startChat(this.currentChannel);
        }
    }
    
    startChat(channel) {
        if (this.chatSocket) {
            try { this.chatSocket.close(); } catch (e) {}
            this.chatSocket = null;
        }
        const messagesEl = document.getElementById('chatMessages');
        if (!messagesEl) return;
        messagesEl.innerHTML = '';
        this.emotes = new Map();
        this.emoteRoomId = null;
        const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
        this.chatSocket = ws;
        ws.onopen = () => {
            ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
            ws.send('PASS SCHMOOPIIE');
            ws.send('NICK justinfan' + Math.floor(Math.random() * 99999));
            ws.send('JOIN #' + channel);
        };
        ws.onmessage = (event) => {
            const lines = event.data.split('\r\n');
            lines.forEach(line => {
                if (!line) return;
                if (line.startsWith('PING')) {
                    ws.send('PONG :tmi.twitch.tv');
                    return;
                }
                const { tags, rest } = parseIrcLine(line);
                if (rest.includes(' PRIVMSG ')) {
                    this.appendChatMessage(tags, rest);
                } else if (rest.includes(' ROOMSTATE ') && tags['room-id']) {
                    // Sent once on join; carries the channel's numeric id needed for emote lookups
                    this.loadEmotes(tags['room-id']);
                }
            });
        };
        ws.onclose = () => {
            const el = document.getElementById('chatMessages');
            if (el) {
                const note = document.createElement('div');
                note.className = 'chat-system';
                note.textContent = 'Disconnected from chat';
                el.appendChild(note);
            }
        };
        ws.onerror = () => {};
    }
    
    loadChatSizes() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('twitchsen-chat-sizes') || '{}') || {}; } catch (e) {}
        const sizes = {};
        Object.keys(CHAT_SIZES).forEach(key => {
            const { min, max } = CHAT_SIZES[key];
            const value = Number(saved[key]);
            sizes[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : CHAT_SIZES[key].default;
        });
        return sizes;
    }

    changeChatSize(key, delta) {
        const { min, max } = CHAT_SIZES[key];
        this.chatSizes[key] = Math.min(max, Math.max(min, this.chatSizes[key] + delta));
        try { localStorage.setItem('twitchsen-chat-sizes', JSON.stringify(this.chatSizes)); } catch (e) {}
        this.applyChatSizes();
    }

    applyChatSizes() {
        const chatSidebar = document.getElementById('chatSidebar');
        if (!chatSidebar) return;
        const messagesEl = document.getElementById('chatMessages');
        const atBottom = messagesEl && messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
        chatSidebar.style.setProperty('--chat-font-size', this.chatSizes.text + 'px');
        chatSidebar.style.setProperty('--chat-emote-size', this.chatSizes.emote + 'px');
        chatSidebar.querySelectorAll('.chat-size-control').forEach(control => {
            const key = control.dataset.setting;
            const value = this.chatSizes[key];
            control.querySelector('.chat-size-value').textContent = value;
            const [smaller, larger] = control.querySelectorAll('.chat-size-btn');
            smaller.disabled = value <= CHAT_SIZES[key].min;
            larger.disabled = value >= CHAT_SIZES[key].max;
        });
        // Swap already rendered emotes to the higher-resolution image when they get big
        const large = this.chatSizes.emote > CHAT_SIZES.emote.default;
        chatSidebar.querySelectorAll('img.chat-emote').forEach(img => setEmoteResolution(img, large));
        if (atBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async loadEmotes(roomId) {
        if (this.emoteRoomId === roomId) return;
        this.emoteRoomId = roomId;
        try {
            const res = await fetch(`/api/emotes/${encodeURIComponent(roomId)}`);
            if (!res.ok) return;
            const emotes = await res.json();
            // Ignore the result if the user switched channel meanwhile
            if (this.emoteRoomId === roomId) this.emotes = new Map(Object.entries(emotes));
        } catch (e) {}
    }

    appendChatMessage(tags, rest) {
        // rest: :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :message
        const msgIdx = rest.indexOf(' PRIVMSG ');
        if (msgIdx === -1) return;
        const prefix = rest.slice(0, msgIdx);
        const nick = prefix.split('!')[0].replace(':', '');
        const bodyIdx = rest.indexOf(':', msgIdx);
        let message = bodyIdx > -1 ? rest.slice(bodyIdx + 1) : '';
        // "/me" messages arrive wrapped as \x01ACTION ...\x01; emote positions refer to the inner text
        const action = message.startsWith('\x01ACTION ') && message.endsWith('\x01');
        if (action) message = message.slice(8, -1);
        const displayName = tags['display-name'] || nick;
        const color = tags['color'] || '#9146ff';
        const messagesEl = document.getElementById('chatMessages');
        if (!messagesEl) return;
        const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message';
        const nameEl = document.createElement('span');
        nameEl.className = 'chat-name';
        nameEl.style.color = color;
        nameEl.textContent = displayName;
        const textEl = document.createElement('span');
        textEl.className = 'chat-text';
        if (action) {
            textEl.classList.add('chat-action');
            textEl.style.color = color;
        }
        this.renderMessageContent(textEl, message, tags['emotes']);
        msgEl.appendChild(nameEl);
        msgEl.appendChild(document.createTextNode(action ? ' ' : ': '));
        msgEl.appendChild(textEl);
        messagesEl.appendChild(msgEl);
        while (messagesEl.childElementCount > 300) {
            messagesEl.removeChild(messagesEl.firstChild);
        }
        if (atBottom) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
            // Emote images change line widths once loaded; stay pinned to the bottom
            msgEl.querySelectorAll('img').forEach(img => img.addEventListener('load', () => {
                if (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120) {
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                }
            }, { once: true }));
        }
    }

    // Builds message DOM with Twitch emotes (positions from the IRC "emotes" tag)
    // and 7TV/BTTV/FFZ emotes (matched by word). Never uses innerHTML.
    renderMessageContent(container, message, emotesTag) {
        const chars = Array.from(message); // Twitch positions count code points, not UTF-16 units
        const twitchEmotes = [];
        (emotesTag || '').split('/').forEach(part => {
            const [id, ranges] = part.split(':');
            if (!ranges || !/^[\w-]+$/.test(id)) return;
            ranges.split(',').forEach(range => {
                const [start, end] = range.split('-').map(Number);
                if (Number.isInteger(start) && Number.isInteger(end) && end >= start) twitchEmotes.push({ start, end, id });
            });
        });
        twitchEmotes.sort((a, b) => a.start - b.start);

        let pos = 0;
        twitchEmotes.forEach(({ start, end, id }) => {
            if (start < pos) return;
            this.appendTextWithEmotes(container, chars.slice(pos, start).join(''));
            const base = `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark`;
            container.appendChild(createEmoteImg(chars.slice(start, end + 1).join(''), `${base}/1.0`, `${base}/2.0`, this.chatSizes.emote > CHAT_SIZES.emote.default));
            pos = end + 1;
        });
        this.appendTextWithEmotes(container, chars.slice(pos).join(''));
    }

    appendTextWithEmotes(container, text) {
        if (!text) return;
        let buffer = '';
        text.split(/(\s+)/).forEach(token => {
            const emote = this.emotes && this.emotes.get(token);
            if (emote) {
                if (buffer) container.appendChild(document.createTextNode(buffer));
                buffer = '';
                container.appendChild(createEmoteImg(token, emote[0], emote[1], this.chatSizes.emote > CHAT_SIZES.emote.default));
            } else {
                buffer += token;
            }
        });
        if (buffer) container.appendChild(document.createTextNode(buffer));
    }
}

// IRC line -> { tags, rest }, where rest is everything after the @tags section
function parseIrcLine(line) {
    const tags = {};
    let rest = line;
    if (rest.startsWith('@')) {
        const spaceIdx = rest.indexOf(' ');
        const tagStr = rest.slice(1, spaceIdx);
        rest = rest.slice(spaceIdx + 1);
        tagStr.split(';').forEach(pair => {
            const eq = pair.indexOf('=');
            if (eq > -1) {
                const key = pair.slice(0, eq);
                let val = pair.slice(eq + 1);
                val = val.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\').replace(/\\r/g, '').replace(/\\n/g, '');
                tags[key] = val;
            }
        });
    }
    return { tags, rest };
}

// Chat size settings (px), adjustable from the chat footer and kept in localStorage
const CHAT_SIZES = {
    text: { label: 'Text', min: 10, max: 28, step: 1, default: 14 },
    emote: { label: 'Emotes', min: 16, max: 84, step: 4, default: 28 },
};

function createEmoteImg(name, url1x, url2x, large) {
    const img = document.createElement('img');
    img.className = 'chat-emote';
    img.dataset.url1x = url1x;
    if (url2x) img.dataset.url2x = url2x;
    setEmoteResolution(img, large);
    img.alt = name;
    img.title = name;
    img.decoding = 'async';
    return img;
}

// 1x images are 28px tall; above that always use the 2x image so emotes stay sharp
function setEmoteResolution(img, large) {
    const { url1x, url2x } = img.dataset;
    if (large && url2x) {
        img.removeAttribute('srcset');
        if (img.getAttribute('src') !== url2x) img.src = url2x;
    } else {
        if (url2x) img.srcset = `${url1x} 1x, ${url2x} 2x`;
        if (img.getAttribute('src') !== url1x) img.src = url1x;
    }
}

// 950 -> "950", 1234 -> "1.2K", 15300 -> "15K", 2500000 -> "2.5M"
function formatViewers(n) {
    if (n < 1000) return String(n);
    if (n < 999500) return (n < 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1000)) + 'K';
    return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function normalizeChannel(value) {
    const ch = (value || '').trim().toLowerCase();
    return /^[a-z0-9_]{1,25}$/.test(ch) ? ch : null;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new TwitchViewer());
} else {
    new TwitchViewer();
}
