// エフェクト再生エラー通知
// オーバーレイ側の動画/音声再生失敗（effects:playback-error）を受信し、
// 管理画面右上にトースト表示する。原因不明な「再生できない」を可視化するためのもの。
(function () {
    'use strict';

    function init() {
        if (window.self !== window.top) {
            return;
        }
        setupToastContainer();
        const socket = (window.socket && typeof window.socket.on === 'function') ? window.socket : io();
        socket.on('effects:playback-error', showToast);
    }

    let container = null;

    function setupToastContainer() {
        const style = document.createElement('style');
        style.textContent = `
#playback-error-toasts {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 99998;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(92vw, 420px);
}
.playback-error-toast {
    background: rgba(127, 29, 29, 0.96);
    color: #fff;
    border: 1px solid rgba(248, 113, 113, 0.5);
    border-radius: 10px;
    padding: 10px 14px;
    font-family: "Segoe UI", "Yu Gothic UI", sans-serif;
    font-size: 13px;
    line-height: 1.5;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
    animation: playback-error-toast-in 0.25s ease;
    word-break: break-all;
}
.playback-error-toast strong {
    display: block;
    margin-bottom: 2px;
    font-size: 13px;
}
.playback-error-toast .playback-error-toast-close {
    float: right;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    margin-left: 8px;
}
@keyframes playback-error-toast-in {
    from { transform: translateX(24px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
}
`;
        document.head.appendChild(style);

        container = document.createElement('div');
        container.id = 'playback-error-toasts';
        document.body.appendChild(container);
    }

    function kindLabel(kind) {
        if (kind === 'video') return '動画';
        if (kind === 'audio') return '音声';
        return 'メディア';
    }

    function escapeHtml(str) {
        return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function showToast(payload) {
        if (!container) return;
        const screen = payload && payload.screen ? `screen${payload.screen}` : '';
        const eventName = (payload && payload.eventName) || '';
        const label = kindLabel(payload && payload.kind);
        const message = (payload && payload.message) || '';
        const url = (payload && payload.url) || '';

        const toast = document.createElement('div');
        toast.className = 'playback-error-toast';
        toast.innerHTML = `<button type="button" class="playback-error-toast-close" aria-label="閉じる">✕</button>` +
            `<strong>${label}の再生に失敗しました${screen ? '（' + escapeHtml(screen) + '）' : ''}</strong>` +
            `${eventName ? escapeHtml(eventName) + ': ' : ''}${escapeHtml(message)}` +
            `${url ? `<br><span style="opacity:0.75;">${escapeHtml(url)}</span>` : ''}`;

        toast.querySelector('.playback-error-toast-close').addEventListener('click', () => toast.remove());
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 12000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
