module.exports = function({ getDisplayFontFamilyCss }) {

function escapeHtmlForOverlay(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildEffectOverlayHtml(slot, config, options = null) {
    const title = config?.name || `Screen ${slot}`;
    const hasVideo = Boolean(config?.videoAssetUrl);
    const hasAudio = Boolean(config?.audioAssetUrl);
    const readAloudOnly = options?.readAloudOnly === true;
    const readAloudSpeakerEnabled = options?.readAloudSpeakerEnabled === true;
        const displayFontFamilyCss = getDisplayFontFamilyCss();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtmlForOverlay(title)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;700;800&family=Noto+Sans+JP:wght@400;700;900&family=Noto+Serif+JP:wght@400;700;900&family=Zen+Kaku+Gothic+New:wght@400;700;900&family=Kosugi&family=Zen+Old+Mincho:wght@400;700;900&family=Klee+One:wght@400;600&family=Zen+Maru+Gothic:wght@400;700;900&family=Yuji+Syuku&family=Dela+Gothic+One&family=DotGothic16&family=Hachi+Maru+Pop&family=RocknRoll+One&family=Yusei+Magic&family=Kaisei+Decol:wght@400;500;700&family=Mochiy+Pop+One&family=Rampart+One&family=Shippori+Mincho+B1:wght@500;700;800&family=Zen+Antique&family=Yuji+Mai&display=swap" rel="stylesheet">
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root {
            color-scheme: light;
                --display-font-family: ${displayFontFamilyCss};
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: var(--display-font-family);
            background: transparent;
            color: #f8fafc;
            overflow: hidden;
        }

        .read-aloud-credit {
            position: fixed;
                right: 80px;
                bottom: 128px;
            max-width: min(56vw, 720px);
            padding: 14px 20px;
            border-radius: 14px;
            background: rgba(15, 23, 42, 0.66);
            border: 1px solid rgba(148, 163, 184, 0.28);
            color: rgba(248, 250, 252, 0.92);
            font-size: 24px;
            line-height: 1.5;
            letter-spacing: 0.02em;
            text-align: right;
            font-family: inherit;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 160ms ease, transform 160ms ease;
            pointer-events: none;
            backdrop-filter: blur(12px);
            white-space: pre-wrap;
        }

        .read-aloud-credit.is-visible {
            opacity: 1;
            transform: translateY(0);
        }

        .read-aloud-warning {
            position: fixed;
                right: 80px;
                bottom: 128px;
            max-width: min(56vw, 720px);
            padding: 14px 20px;
            border-radius: 14px;
            background: rgba(15, 23, 42, 0.66);
            border: 1px solid rgba(239, 68, 68, 0.4);
            color: #ef4444;
            font-size: 24px;
            line-height: 1.5;
            letter-spacing: 0.02em;
            text-align: right;
            font-family: inherit;
            opacity: 0;
            transform: translateY(6px);
            transition: opacity 160ms ease, transform 160ms ease;
            pointer-events: none;
            backdrop-filter: blur(12px);
            white-space: pre-wrap;
        }

        .read-aloud-warning.is-visible {
            opacity: 1;
            transform: translateY(0);
        }

        video {
            position: fixed;
            inset: 0;
            width: 100vw;
            height: 100vh;
            object-fit: contain;
            display: none;
        }

        .debug-card {
            position: fixed;
            left: 16px;
            bottom: 16px;
            width: min(360px, calc(100vw - 32px));
            padding: 14px 16px;
            border-radius: 18px;
            background: rgba(15, 23, 42, 0.72);
            border: 1px solid rgba(148, 163, 184, 0.32);
            backdrop-filter: blur(18px);
            box-shadow: 0 16px 40px rgba(15, 23, 42, 0.24);
            opacity: 0;
            pointer-events: none;
            transition: opacity 160ms ease;
        }

        body.debug .debug-card {
            opacity: 1;
        }

        .slot {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 4px 10px;
            border-radius: 999px;
            background: rgba(59, 130, 246, 0.22);
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        h1 {
            margin: 12px 0 8px;
            font-size: 24px;
            line-height: 1.15;
        }

        p {
            margin: 0;
            color: rgba(226, 232, 240, 0.86);
            line-height: 1.6;
            font-size: 13px;
        }

        dl {
            margin: 16px 0 0;
            display: grid;
            grid-template-columns: auto 1fr;
            gap: 8px 12px;
            font-size: 13px;
        }

        dt {
            color: rgba(148, 163, 184, 0.96);
        }

        dd {
            margin: 0;
        }
    </style>
</head>
<body>
    <aside class="debug-card" id="debug-card" aria-live="polite">
        <div class="slot">slot ${slot}</div>
        <h1>${escapeHtmlForOverlay(title)}</h1>
        <p>通常は透過のまま待機し、受信したイベントだけを再生します。?debug=1 を付けたときだけこの情報を表示します。</p>
        <dl>
            <dt>Video</dt>
            <dd>${escapeHtmlForOverlay(hasVideo ? config.videoAssetName || 'configured' : 'none')}</dd>
            <dt>Audio</dt>
            <dd>${escapeHtmlForOverlay(hasAudio ? config.audioAssetName || 'configured' : 'none')}</dd>
        </dl>
        <p id="debug-log"></p>
    </aside>
    <video id="effect-video" playsinline preload="auto"></video>
    <audio id="effect-audio" preload="auto"></audio>
    <div class="read-aloud-credit" id="read-aloud-credit" aria-live="polite"></div>
    <div class="read-aloud-warning" id="read-aloud-warning" aria-live="assertive">VOICEVOX未起動</div>
    <script>
        const params = new URLSearchParams(window.location.search);
        document.body.classList.toggle('debug', params.get('debug') === '1');
        const slot = ${slot};
        const readAloudOnly = ${readAloudOnly ? 'true' : 'false'};
        const readAloudSpeakerEnabled = ${readAloudSpeakerEnabled ? 'true' : 'false'};
        const socket = io();
        const video = document.getElementById('effect-video');
        const audio = document.getElementById('effect-audio');
        const _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const _audioSrc = _audioCtx.createMediaElementSource(audio);
        const _audioPanner = _audioCtx.createStereoPanner();
        _audioPanner.pan.value = 0;
        _audioSrc.connect(_audioPanner);
        _audioPanner.connect(_audioCtx.destination);
        const readAloudCredit = document.getElementById('read-aloud-credit');
        const readAloudWarning = document.getElementById('read-aloud-warning');
        const debugLog = document.getElementById('debug-log');
        const OVERLAY_RECOVERY_RETRY_MS = 2000;
        let readAloudWarningClearTimer = null;
        let activePlaybackId = null;
        let activePlaybackEventId = null;
        let activeVideoUrl = null;
        let activeAudioUrl = null;
        let playbackQueue = [];
        let isPlaying = false;
        let audioEnded = true;
        let videoEnded = true;
        let ttsQueue = [];
        let isSpeaking = false;
        let readAloudCreditClearTimer = null;
        let overlayRecoveryTimer = null;
        let overlayRecoveryInFlight = false;

        // メディア Blob URL キャッシュ: 元の URL -> 解決済み Blob URL (ロード中は Promise)
        const mediaBlobCache = new Map();
        const MEDIA_BLOB_CACHE_MAX = 40;

        function isMediaCacheKeyProtected(key) {
            if (key === activeVideoUrl || key === activeAudioUrl) return true;
            return playbackQueue.some((p) => p?.videoUrl === key || p?.audioUrl === key);
        }

        // キャッシュが上限を超えたら、再生中/再生待ちでない古いエントリから Blob URL を解放して破棄
        function evictOldMediaBlobs() {
            if (mediaBlobCache.size <= MEDIA_BLOB_CACHE_MAX) return;
            for (const [key, value] of mediaBlobCache) {
                if (mediaBlobCache.size <= MEDIA_BLOB_CACHE_MAX) break;
                if (typeof value !== 'string') continue; // ロード中は温存
                if (isMediaCacheKeyProtected(key)) continue;
                if (value.startsWith('blob:')) URL.revokeObjectURL(value);
                mediaBlobCache.delete(key);
            }
        }

        function preloadMediaBlob(url) {
            if (!url || mediaBlobCache.has(url) || url.startsWith('data:')) return;
            const promise = fetch(url)
                .then(r => r.ok ? r.blob() : null)
                .then(blob => {
                    const result = blob ? URL.createObjectURL(blob) : url;
                    mediaBlobCache.set(url, result);
                    evictOldMediaBlobs();
                    return result;
                })
                .catch(() => { mediaBlobCache.set(url, url); return url; });
            mediaBlobCache.set(url, promise);
        }

        function resolvedMediaUrl(url) {
            if (!url) return url;
            const v = mediaBlobCache.get(url);
            return (v && typeof v === 'string') ? v : url;
        }

        function awaitMediaUrl(url) {
            if (!url) return url;
            const v = mediaBlobCache.get(url);
            if (!v) return url;
            if (typeof v === 'string') return v;
            // まだfetch中 → 直接URLで即時再生。fetch完了後は次回以降Blob URLを使用
            return url;
        }

        // ページ起動時に設定済みエフェクトのメディアをすべてプリロード
        fetch('/api/effects/config')
            .then(r => r.ok ? r.json() : null)
            .then(cfg => {
                if (!cfg || !Array.isArray(cfg.events)) return;
                cfg.events.forEach(evt => {
                    if (evt.screen !== slot) return;
                    if (evt.videoEnabled && evt.videoAssetUrl) preloadMediaBlob(evt.videoAssetUrl);
                    if (evt.audioEnabled && evt.audioAssetUrl) preloadMediaBlob(evt.audioAssetUrl);
                });
            })
            .catch(() => {});

        function updateDebugLog(message) {
            debugLog.textContent = message || '';
        }

        function clearOverlayRecoveryTimer() {
            if (overlayRecoveryTimer) {
                clearInterval(overlayRecoveryTimer);
                overlayRecoveryTimer = null;
            }
        }

        async function probeOverlayAvailability() {
            if (overlayRecoveryInFlight) {
                return;
            }

            overlayRecoveryInFlight = true;

            try {
                const response = await fetch(window.location.href, { cache: 'no-store' });

                if (!response.ok) {
                    return;
                }

                clearOverlayRecoveryTimer();
                window.location.reload();
            } catch (error) {
                // Backend is still restarting. Keep polling until it becomes reachable again.
            } finally {
                overlayRecoveryInFlight = false;
            }
        }

        function scheduleOverlayRecoveryReload() {
            if (overlayRecoveryTimer) {
                return;
            }

            overlayRecoveryTimer = setInterval(() => {
                probeOverlayAvailability();
            }, OVERLAY_RECOVERY_RETRY_MS);

            probeOverlayAvailability();
        }

        function clearReadAloudCreditTimer() {
            if (readAloudCreditClearTimer) {
                clearTimeout(readAloudCreditClearTimer);
                readAloudCreditClearTimer = null;
            }
        }

        function scheduleReadAloudCreditClear() {
            clearReadAloudCreditTimer();
            readAloudCreditClearTimer = setTimeout(() => {
                readAloudCreditClearTimer = null;
                setReadAloudCredit('');
            }, 10000);
        }

        function setReadAloudCredit(text) {
            const nextText = typeof text === 'string' ? text.trim() : '';
            clearReadAloudCreditTimer();
            readAloudCredit.textContent = nextText;
            readAloudCredit.classList.toggle('is-visible', Boolean(nextText));
        }

        function setReadAloudWarning(text) {
            const nextText = typeof text === 'string' ? text.trim() : '';
            if (readAloudWarningClearTimer) {
                clearTimeout(readAloudWarningClearTimer);
                readAloudWarningClearTimer = null;
            }
            readAloudWarning.textContent = nextText;
            readAloudWarning.classList.toggle('is-visible', Boolean(nextText));
            if (nextText) {
                readAloudWarningClearTimer = setTimeout(() => {
                    readAloudWarningClearTimer = null;
                    setReadAloudWarning('');
                }, 10000);
            }
        }

        function finishSpeech() {
            isSpeaking = false;

            if (ttsQueue.length === 0 && !isPlaying && playbackQueue.length === 0) {
                scheduleReadAloudCreditClear();
            }

            processSpeechQueue();
        }

        function stopSpeechQueue() {
            ttsQueue = [];
            isSpeaking = false;
            setReadAloudCredit('');

            if (window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
                window.speechSynthesis.cancel();
            }

            updateDebugLog('読み上げを停止しました。');
        }

        function processSpeechQueue() {
            if (isSpeaking || ttsQueue.length === 0) {
                return;
            }

            const synth = window.speechSynthesis;

            if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
                updateDebugLog('この screen は読み上げに対応していません。');
                ttsQueue = [];
                return;
            }

            const payload = ttsQueue.shift();

            if (!payload || !payload.text) {
                processSpeechQueue();
                return;
            }

            isSpeaking = true;
            updateDebugLog('読み上げ: ' + payload.text);
            setReadAloudCredit(payload.readAloudCreditText || '');

            const utterance = new window.SpeechSynthesisUtterance(payload.text);
            const voices = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
            const requestedVoiceName = typeof payload.voiceName === 'string'
                ? payload.voiceName.replace(/^(screen1:|browser:)/, '')
                : '';
            const selectedVoice = requestedVoiceName
                ? voices.find((voice) => voice && voice.name === requestedVoiceName)
                : null;

            utterance.lang = 'ja-JP';
            utterance.rate = 1;
            utterance.pitch = 1;
            utterance.volume = Math.max(0, Math.min(1, Number(payload.volume ?? 100) / 100));

            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang || utterance.lang;
            }

            utterance.onend = finishSpeech;
            utterance.onerror = finishSpeech;

            synth.speak(utterance);
        }

        function finishPlayback() {
            if (!isPlaying) {
                return;
            }

            stopMedia();
            isPlaying = false;

            if (playbackQueue.length === 0 && !isSpeaking && ttsQueue.length === 0) {
                scheduleReadAloudCreditClear();
            }

            processPlaybackQueue();
        }

        function stopPlaybackQueue(eventId = '') {
            if (eventId) {
                playbackQueue = playbackQueue.filter((payload) => payload?.eventId !== eventId);

                if (activePlaybackEventId && activePlaybackEventId !== eventId) {
                    return;
                }
            } else {
                playbackQueue = [];
            }

            stopMedia();
            isPlaying = false;
            videoEnded = true;
            audioEnded = true;
            setReadAloudCredit('');
            updateDebugLog(eventId ? '再生を停止しました。' : 'すべての再生を停止しました。');
        }

        function stopMedia() {
            video.pause();
            audio.pause();
            video.removeAttribute('src');
            audio.removeAttribute('src');
            video.load();
            audio.load();
            video.style.display = 'none';
            activePlaybackId = null;
            activePlaybackEventId = null;
            activeVideoUrl = null;
            activeAudioUrl = null;
        }

        video.addEventListener('ended', () => {
            videoEnded = true;

            if (audioEnded) {
                finishPlayback();
            }
        });

        audio.addEventListener('ended', () => {
            audioEnded = true;

            if (videoEnded) {
                finishPlayback();
            }
        });

        socket.on('connect', () => {
            clearOverlayRecoveryTimer();
        });

        socket.on('disconnect', () => {
            scheduleOverlayRecoveryReload();
        });

        socket.on('connect_error', () => {
            scheduleOverlayRecoveryReload();
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible') return;
            if (!socket.connected) {
                scheduleOverlayRecoveryReload();
            }
        });

        async function processPlaybackQueue() {
            if (isPlaying || playbackQueue.length === 0) {
                return;
            }

            const payload = playbackQueue.shift();

            // 次のアイテムを先行プリロード（現在の再生中にfetchを完了させておく）
            if (playbackQueue.length > 0) {
                const next = playbackQueue[0];
                if (next.videoUrl) preloadMediaBlob(next.videoUrl);
                if (next.audioUrl) preloadMediaBlob(next.audioUrl);
            }

            isPlaying = true;
            activePlaybackId = payload.playbackId || String(Date.now());
            activePlaybackEventId = payload.eventId || '';
            activeVideoUrl = payload.videoUrl || null;
            activeAudioUrl = payload.audioUrl || null;
            videoEnded = !payload.videoUrl;
            audioEnded = !payload.audioUrl;
            updateDebugLog((payload.eventName || 'event') + ' / ' + (payload.uniqueId || '') + ' / ' + (payload.giftName || ''));
            setReadAloudCredit(payload.readAloudCreditText || '');

            try {
                const resolvedVideo = payload.videoUrl ? awaitMediaUrl(payload.videoUrl) : null;
                const resolvedAudio = payload.audioUrl ? awaitMediaUrl(payload.audioUrl) : null;

                if (resolvedVideo) {
                    video.src = resolvedVideo;
                    video.currentTime = 0;
                    video.volume = Math.max(0, Math.min(1, Number(payload.mediaVolume ?? 100) / 100));
                    video.style.display = 'block';
                    await video.play().catch(() => null);
                } else {
                    video.style.display = 'none';
                }

                if (resolvedAudio) {
                    audio.src = resolvedAudio;
                    audio.currentTime = 0;
                    audio.volume = Math.max(0, Math.min(1, Number(payload.mediaVolume ?? 100) / 100));
                    await _audioCtx.resume().catch(() => null);
                    await audio.play().catch(() => null);
                }
            } catch (error) {
                updateDebugLog(error && error.message ? error.message : 'playback failed');
                finishPlayback();
                return;
            }

            if (!payload.videoUrl && !payload.audioUrl) {
                updateDebugLog('再生するメディアが設定されていません。');
                finishPlayback();
                return;
            }

            if (videoEnded && audioEnded) {
                finishPlayback();
            }
        }

        socket.on('effects:preload', (payload) => {
            if (!payload || payload.screen !== slot) return;
            if (payload.videoUrl) preloadMediaBlob(payload.videoUrl);
            if (payload.audioUrl) preloadMediaBlob(payload.audioUrl);
        });

        socket.on('effects:playback', async (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            if (readAloudOnly) {
                return;
            }

            // Blob URL プリロードを即座に開始（再生待ち中に解決されることが多い）
            if (payload.videoUrl) preloadMediaBlob(payload.videoUrl);
            if (payload.audioUrl) preloadMediaBlob(payload.audioUrl);

            const playbackCount = Math.max(1, Number(payload.playbackCount || 1));

            for (let index = 0; index < playbackCount; index += 1) {
                playbackQueue.push({
                    ...payload,
                    playbackId: String(payload.playbackId || Date.now()) + '-' + index
                });
            }

            processPlaybackQueue();
        });

        socket.on('effects:tts', (payload) => {
            if (!payload || payload.screen !== slot || !payload.text) {
                return;
            }

            if (readAloudOnly) {
                return;
            }

            ttsQueue.push(payload);
            processSpeechQueue();
        });

        socket.on('effects:tts:stop', (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            stopSpeechQueue();
        });

        socket.on('effects:playback:stop', (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            stopPlaybackQueue(typeof payload.eventId === 'string' ? payload.eventId : '');
        });

        socket.on('screen1:voicevox-warning', (payload) => {
            if (!payload || payload.screen !== slot) {
                return;
            }

            setReadAloudWarning('VOICEVOX\u672a\u8d77\u52d5');
        });
    </script>
</body>
</html>`;
}

    return { buildEffectOverlayHtml, escapeHtmlForOverlay };
};
