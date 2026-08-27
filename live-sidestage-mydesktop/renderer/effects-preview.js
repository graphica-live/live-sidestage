'use strict';

(function () {
    const TIKEFFECT_ORIGIN = 'http://localhost:38100';
    const LOAD_TIMEOUT_MS = 20000;
    const SCREEN_COUNT = 10;

    const screenSelect = document.getElementById('screen-select');
    const offsetInput = document.getElementById('offset-input');
    const connectionBadge = document.getElementById('connection-badge');
    const placeholderEl = document.getElementById('preview-placeholder');
    const loadingEl = document.getElementById('preview-loading');
    const errorEl = document.getElementById('preview-error');
    const videoEl = document.getElementById('preview-video');
    const reconnectBanner = document.getElementById('reconnect-banner');

    let watchedScreen = 1;
    let screenOffsets = {};
    // currentJobへの参照そのものが世代識別子を兼ねる。cancelCurrentJob()はcurrentJobをnullにするので、
    // 破棄済みジョブのコールバックは「自分がcurrentJobか」を見るだけで確実に無効化できる。
    let currentJob = null; // { video, timeoutId }

    function getOffsetFor(screenNum) {
        return Number(screenOffsets[String(screenNum)]) || 0;
    }

    function setBadge(state) {
        connectionBadge.classList.remove('badge-connected', 'badge-reconnecting', 'badge-disconnected');
        if (state === 'connected') {
            connectionBadge.textContent = '接続中';
            connectionBadge.classList.add('badge-connected');
            reconnectBanner.hidden = true;
        } else if (state === 'reconnecting') {
            connectionBadge.textContent = '再接続中';
            connectionBadge.classList.add('badge-reconnecting');
            reconnectBanner.hidden = false;
        } else {
            connectionBadge.textContent = '未接続';
            connectionBadge.classList.add('badge-disconnected');
            reconnectBanner.hidden = false;
        }
    }

    function showPlaceholder(message) {
        placeholderEl.textContent = message || 'この画面にはまだ何も表示されていません';
        placeholderEl.hidden = false;
        loadingEl.hidden = true;
        errorEl.hidden = true;
        videoEl.hidden = true;
    }

    function showLoading() {
        placeholderEl.hidden = true;
        loadingEl.hidden = false;
        errorEl.hidden = true;
        videoEl.hidden = true;
    }

    function showError(message) {
        placeholderEl.hidden = true;
        loadingEl.hidden = true;
        errorEl.hidden = false;
        errorEl.textContent = message;
        videoEl.hidden = true;
    }

    function showFrame(sourceVideo) {
        // 新しい非表示videoで既に読み込み・seek済みのフレームを、表示用videoへ引き継ぐ。
        videoEl.src = sourceVideo.src;
        videoEl.currentTime = sourceVideo.currentTime;
        placeholderEl.hidden = true;
        loadingEl.hidden = true;
        errorEl.hidden = true;
        videoEl.hidden = false;
    }

    function cancelCurrentJob() {
        if (!currentJob) return;
        if (currentJob.timeoutId) clearTimeout(currentJob.timeoutId);
        const job = currentJob;
        currentJob = null;
        try {
            job.video.pause();
            job.video.removeAttribute('src');
            job.video.load();
        } catch (err) {
            // 破棄中のエラーは無視してよい
        }
    }

    function resolveSameOriginUrl(rawUrl) {
        let resolved;
        try {
            resolved = new URL(rawUrl, TIKEFFECT_ORIGIN);
        } catch (err) {
            return null;
        }
        if (resolved.origin !== TIKEFFECT_ORIGIN) return null;
        return resolved.href;
    }

    function startLoad(videoUrl) {
        cancelCurrentJob();

        const safeUrl = resolveSameOriginUrl(videoUrl);
        if (!safeUrl) {
            showError('動画URLが不正です');
            return;
        }

        showLoading();

        const job = { video: document.createElement('video') };
        job.video.muted = true;
        job.video.playsInline = true;

        const onLoadedMetadata = () => {
            if (currentJob !== job) return;
            const offsetSeconds = getOffsetFor(watchedScreen);
            const duration = Number.isFinite(job.video.duration) ? job.video.duration : offsetSeconds;
            const target = Math.min(offsetSeconds, Math.max(0, duration - 0.05));
            job.video.currentTime = target;
        };

        const onSeeked = () => {
            if (currentJob !== job) return;
            job.video.pause();
            if (job.timeoutId) clearTimeout(job.timeoutId);
            showFrame(job.video);
            currentJob = null;
        };

        const onError = () => {
            if (currentJob !== job) return;
            if (job.timeoutId) clearTimeout(job.timeoutId);
            showError('動画の読み込みに失敗しました');
            currentJob = null;
        };

        job.video.addEventListener('loadedmetadata', onLoadedMetadata);
        job.video.addEventListener('seeked', onSeeked);
        job.video.addEventListener('error', onError);

        job.timeoutId = setTimeout(() => {
            if (currentJob !== job) return;
            showError('動画の読み込みがタイムアウトしました');
            currentJob = null;
        }, LOAD_TIMEOUT_MS);

        currentJob = job;
        job.video.src = safeUrl;
        job.video.load();
    }

    function handleVideoPlaying(payload) {
        if (!payload || payload.screen !== watchedScreen) return;
        if (!payload.videoUrl) {
            cancelCurrentJob();
            showPlaceholder('この画面には動画が設定されていません');
            return;
        }
        startLoad(payload.videoUrl);
    }

    function applyWatchedScreen(screenNum, latestForWatchedScreen) {
        watchedScreen = screenNum;
        screenSelect.value = String(screenNum);
        offsetInput.value = String(getOffsetFor(screenNum));
        cancelCurrentJob();
        if (latestForWatchedScreen && latestForWatchedScreen.videoUrl) {
            startLoad(latestForWatchedScreen.videoUrl);
        } else {
            showPlaceholder();
        }
    }

    async function init() {
        for (let i = 1; i <= SCREEN_COUNT; i += 1) {
            const option = document.createElement('option');
            option.value = String(i);
            option.textContent = 'Screen ' + i;
            screenSelect.appendChild(option);
        }

        window.mydesktop.onConnectionState((data) => setBadge(data && data.state));
        window.mydesktop.onVideoPlaying(handleVideoPlaying);

        const snapshot = await window.mydesktop.rendererReady();
        setBadge(snapshot.connectionState);
        screenOffsets = (snapshot.settings && snapshot.settings.screenOffsets) || {};
        applyWatchedScreen((snapshot.settings && snapshot.settings.watchedScreen) || 1, snapshot.latestForWatchedScreen);

        screenSelect.addEventListener('change', async () => {
            const result = await window.mydesktop.setWatchedScreen(Number(screenSelect.value));
            screenOffsets = result.screenOffsets || {};
            applyWatchedScreen(result.watchedScreen, result.latestForWatchedScreen);
        });

        offsetInput.addEventListener('change', async () => {
            const seconds = Number(offsetInput.value);
            const result = await window.mydesktop.setScreenOffset(watchedScreen, seconds);
            screenOffsets = result.screenOffsets || {};
            offsetInput.value = String(getOffsetFor(watchedScreen));
        });
    }

    window.EffectsPreviewPage = { init };
})();
