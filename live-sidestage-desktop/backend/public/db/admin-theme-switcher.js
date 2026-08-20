(function () {
    const STORAGE_KEY = 'tikeffect-admin-theme';
    const THEME_CHANNEL_NAME = 'tikeffect-admin-theme-sync';
    const DEFAULT_THEME = 'current';
    const THEMES = [
        { value: 'current', label: 'Current' },
        { value: 'broadcast-console', label: 'Broadcast Console' },
        { value: 'festival-control', label: 'Festival Control' },
        { value: 'signal-lab', label: 'Signal Lab' },
        { value: 'paper-ledger', label: 'Paper Ledger' },
        { value: 'brutal-poster', label: 'Brutal Poster' },
        { value: 'candy-cabinet', label: 'Candy Cabinet' },
        { value: 'zen-garden', label: 'Zen Garden' },
        { value: 'noir-editorial', label: 'Noir Editorial' },
        { value: 'cobalt-studio', label: 'Cobalt Studio' },
        { value: 'marble-ivory', label: 'Marble Ivory' },
        { value: 'amber-workshop', label: 'Amber Workshop' }
    ];
    let themeChannel = null;

    function normalizeTheme(value) {
        return THEMES.some((theme) => theme.value === value) ? value : DEFAULT_THEME;
    }

    function getStoredTheme() {
        try {
            return normalizeTheme(window.localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME);
        } catch {
            return DEFAULT_THEME;
        }
    }

    function applyTheme(theme) {
        const nextTheme = normalizeTheme(theme);
        document.documentElement.dataset.adminTheme = nextTheme;
        return nextTheme;
    }

    function storeTheme(theme) {
        const nextTheme = normalizeTheme(theme);

        try {
            window.localStorage.setItem(STORAGE_KEY, nextTheme);
        } catch {
            return nextTheme;
        }

        return nextTheme;
    }

    function createThemeListener(select) {
        return function syncTheme(theme) {
            const nextTheme = applyTheme(theme);

            if (select) {
                select.value = nextTheme;
            }

            return nextTheme;
        };
    }

    function subscribeThemeUpdates(onThemeChange) {
        window.addEventListener('storage', (event) => {
            if (event.key !== STORAGE_KEY) {
                return;
            }

            onThemeChange(event.newValue || DEFAULT_THEME);
        });

        if (typeof window.BroadcastChannel !== 'function') {
            return;
        }

        themeChannel = new window.BroadcastChannel(THEME_CHANNEL_NAME);
        themeChannel.addEventListener('message', (event) => {
            if (event?.data?.type !== 'theme-change') {
                return;
            }

            onThemeChange(event.data.theme || DEFAULT_THEME);
        });
    }

    function broadcastTheme(theme) {
        if (!themeChannel) {
            return;
        }

        themeChannel.postMessage({
            type: 'theme-change',
            theme: normalizeTheme(theme)
        });
    }

    function closeSettingsModal(modal) {
        if (!modal) {
            return;
        }

        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
    }

    function openSettingsModal(modal) {
        if (!modal) {
            return;
        }

        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
    }

    function mountSettingsPanel() {
        if (!document.body) {
            return;
        }

        const select = document.getElementById('admin-theme-select');
        const syncTheme = createThemeListener(select);

        subscribeThemeUpdates(syncTheme);
        syncTheme(getStoredTheme());

        const root = document.querySelector('[data-admin-settings-root]');

        if (!root || !select) {
            return;
        }

        const modal = document.getElementById('admin-settings-modal');
        const openButton = document.getElementById('open-admin-settings-button');
        const closeButtons = Array.from(document.querySelectorAll('[data-admin-settings-close]'));

        if (!modal || !openButton || !select) {
            return;
        }

        select.innerHTML = THEMES.map((theme) => `<option value="${theme.value}">${theme.label}</option>`).join('');
        select.value = normalizeTheme(document.documentElement.dataset.adminTheme || getStoredTheme());

        select.addEventListener('change', () => {
            const nextTheme = syncTheme(select.value);
            storeTheme(nextTheme);
            broadcastTheme(nextTheme);
            select.value = nextTheme;
        });

        openButton.addEventListener('click', () => {
            select.value = syncTheme(getStoredTheme());
            openSettingsModal(modal);
            select.focus();
        });

        closeButtons.forEach((button) => {
            button.addEventListener('click', () => closeSettingsModal(modal));
        });

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeSettingsModal(modal);
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                closeSettingsModal(modal);
            }
        });
    }

    applyTheme(getStoredTheme());

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mountSettingsPanel, { once: true });
        return;
    }

    mountSettingsPanel();
}());