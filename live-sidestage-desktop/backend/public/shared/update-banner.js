// アプリ内アップデートバナー
// Socket.IO で app:update-ready を受信したらページ上部にバナーを表示し、
// ユーザーが「今すぐアップデート」を押したら /api/update/install を呼ぶ。
(function () {
    'use strict';

    function initUpdateBanner() {
        // パッケージ版 Electron でなければ（開発環境・ブラウザ起動）何もしない
        fetch('/api/state')
            .then((res) => res.ok ? res.json() : null)
            .then((state) => {
                if (state && state.isPackagedElectron) {
                    setupBanner();
                }
            })
            .catch(() => {});
    }

    function setupBanner() {
        const style = document.createElement('style');
        style.textContent = `
#app-update-banner[hidden] {
    display: none !important;
}
#app-update-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    background: linear-gradient(90deg, #1d4ed8 0%, #1e40af 100%);
    color: #fff;
    padding: 10px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    font-family: "Bahnschrift", "Yu Gothic UI", "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.4;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    animation: update-banner-slide-in 0.3s ease;
}
@keyframes update-banner-slide-in {
    from { transform: translateY(-100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
}
#app-update-banner .update-banner-icon {
    font-size: 18px;
    flex-shrink: 0;
}
#app-update-banner .update-banner-text {
    flex: 1 1 auto;
    min-width: 0;
}
#app-update-banner .update-banner-install-btn {
    background: #fff;
    color: #1d4ed8;
    border: none;
    border-radius: 6px;
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
    flex-shrink: 0;
}
#app-update-banner .update-banner-install-btn:hover {
    opacity: 0.85;
}
#app-update-banner .update-banner-install-btn:disabled {
    opacity: 0.5;
    cursor: default;
}
#app-update-banner .update-banner-dismiss-btn {
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: opacity 0.15s;
}
#app-update-banner .update-banner-dismiss-btn:hover {
    opacity: 0.75;
}
`;
        document.head.appendChild(style);

        const banner = document.createElement('div');
        banner.id = 'app-update-banner';
        banner.hidden = true;
        banner.setAttribute('role', 'status');

        const icon = document.createElement('span');
        icon.className = 'update-banner-icon';
        icon.textContent = '⬆';

        const text = document.createElement('span');
        text.className = 'update-banner-text';

        const installBtn = document.createElement('button');
        installBtn.className = 'update-banner-install-btn';
        installBtn.textContent = '今すぐアップデート';

        const dismissBtn = document.createElement('button');
        dismissBtn.className = 'update-banner-dismiss-btn';
        dismissBtn.textContent = '後で';

        banner.appendChild(icon);
        banner.appendChild(text);
        banner.appendChild(installBtn);
        banner.appendChild(dismissBtn);
        document.body.prepend(banner);

        function showBanner(version) {
            const versionLabel = version ? ` (v${version})` : '';
            text.innerHTML = `<strong>\u65b0\u3057\u3044\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8\u304c\u3042\u308a\u307e\u3059${escapeHtmlBanner(versionLabel)}</strong>\u300c\u4eca\u3059\u3050\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8\u300d\u3092\u62bc\u3059\u3068\u30a2\u30d7\u30ea\u304c\u518d\u8d77\u52d5\u3057\u3066\u81ea\u52d5\u3067\u9069\u7528\u3055\u308c\u307e\u3059\u3002`;
            installBtn.disabled = false;
            installBtn.textContent = '\u4eca\u3059\u3050\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8';
            dismissBtn.hidden = false;
            banner.hidden = false;
        }

        function escapeHtmlBanner(str) {
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        installBtn.addEventListener('click', () => {
            installBtn.disabled = true;
            installBtn.textContent = '\u9069\u7528\u4e2d\u2026';
            dismissBtn.hidden = true;
            text.innerHTML = '<strong>\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8\u3092\u9069\u7528\u3057\u3066\u3044\u307e\u3059\u2026</strong>\u307e\u3082\u306a\u304f\u30a2\u30d7\u30ea\u304c\u81ea\u52d5\u3067\u518d\u8d77\u52d5\u3057\u307e\u3059\u3002';
            fetch('/api/update/install', { method: 'POST' })
                .then((res) => {
                    if (!res.ok) {
                        text.innerHTML = '<strong>\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002</strong>\u5f8c\u3067\u518d\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
                        installBtn.disabled = false;
                        installBtn.textContent = '\u4eca\u3059\u3050\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8';
                        dismissBtn.hidden = false;
                    }
                })
                .catch(() => {
                    text.innerHTML = '<strong>\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002</strong>\u5f8c\u3067\u518d\u8a66\u3057\u3066\u304f\u3060\u3055\u3044\u3002';
                    installBtn.disabled = false;
                    installBtn.textContent = '\u4eca\u3059\u3050\u30a2\u30c3\u30d7\u30c7\u30fc\u30c8';
                    dismissBtn.hidden = false;
                });
        });

        dismissBtn.addEventListener('click', () => {
            banner.hidden = true;
        });

        // 既存ページの socket があれば流用し、なければ専用接続を作成する
        function attachSocket(socket) {
            socket.on('app:update-ready', (info) => {
                showBanner(info && info.version ? info.version : null);
            });
        }

        // DOMContentLoaded 後に window.socket があれば流用、なければ独自作成
        function tryAttach() {
            if (window.socket && typeof window.socket.on === 'function') {
                attachSocket(window.socket);
            } else {
                attachSocket(io());
            }
        }

        // 少し遅らせてページの socket 初期化を待つ
        setTimeout(tryAttach, 0);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUpdateBanner);
    } else {
        initUpdateBanner();
    }
})();
