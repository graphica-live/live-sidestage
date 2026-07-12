'use strict';

const CONNECTION_STATE_KEY = 'vdjConnectionSettings';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 80;
const REQUEST_TIMEOUT_MS = 4000;

module.exports = function createVdjClient({ getGlobalStateValue, setGlobalStateValue }) {
    function normalizeConnectionSettings(value) {
        let source = value;

        if (typeof source === 'string') {
            try {
                source = JSON.parse(source);
            } catch {
                source = null;
            }
        }

        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            source = {};
        }

        const port = Number.parseInt(source.port, 10);

        return {
            host: String(source.host || '').trim() || DEFAULT_HOST,
            port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
            password: String(source.password || '')
        };
    }

    function getConnectionSettings() {
        return normalizeConnectionSettings(getGlobalStateValue(CONNECTION_STATE_KEY));
    }

    function setConnectionSettings(next) {
        const normalized = normalizeConnectionSettings(next);
        setGlobalStateValue(CONNECTION_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    async function sendRequest(kind, script) {
        const { host, port, password } = getConnectionSettings();
        const url = new URL(`http://${host}:${port}/${kind}`);
        url.searchParams.set('script', script);
        if (password) {
            url.searchParams.set('password', password);
        }

        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
            if (!response.ok) {
                return null;
            }
            return (await response.text()).trim();
        } catch (error) {
            console.warn(`⚠️ VirtualDJへの接続に失敗しました (${kind} "${script}"):`, error.message);
            return null;
        }
    }

    function vdjQuery(script) {
        return sendRequest('query', script);
    }

    function vdjExecute(script) {
        return sendRequest('execute', script);
    }

    // VDJScript の文字列リテラルはダブルクォート区切りのため、内部の " をエスケープする
    function escapeVdjScriptString(value) {
        return String(value || '').replace(/"/g, '\\"');
    }

    async function isDeckAudible(deckNum) {
        const result = await vdjQuery(`deck ${deckNum} is_audible`);
        if (result === null) {
            return null;
        }
        const normalized = result.toLowerCase();
        return normalized === 'true' || normalized === '1' || normalized === 'on';
    }

    // active/inactive は deck1/deck2 の2デッキ運用を前提に is_audible で判定する。
    // 両方audible・両方非audibleのどちらの場合も deck2 を非アクティブ側にフォールバックする。
    async function resolveTargetDecks(targetMode) {
        switch (targetMode) {
            case 'deck1':
                return [1];
            case 'deck2':
                return [2];
            case 'both':
                return [1, 2];
            case 'active':
            case 'inactive': {
                const [deck1Audible, deck2Audible] = await Promise.all([isDeckAudible(1), isDeckAudible(2)]);
                let activeDeck = null;
                if (deck1Audible && !deck2Audible) activeDeck = 1;
                else if (deck2Audible && !deck1Audible) activeDeck = 2;
                else if (deck1Audible && deck2Audible) activeDeck = 1;

                const inactiveDeck = activeDeck === 1 ? 2 : activeDeck === 2 ? 1 : 2;
                return targetMode === 'active'
                    ? (activeDeck ? [activeDeck] : [])
                    : [inactiveDeck];
            }
            default:
                return [1];
        }
    }

    function triggerBackspin(deckNum, beatsToken) {
        return vdjExecute(`deck ${deckNum} backspin ${beatsToken}bt`);
    }

    function loadTrackToDeck(deckNum, filePath) {
        return vdjExecute(`deck ${deckNum} load "${escapeVdjScriptString(filePath)}"`);
    }

    async function testConnection() {
        const version = await vdjQuery('get_version');
        return { ok: version !== null, version };
    }

    return {
        getConnectionSettings,
        setConnectionSettings,
        vdjQuery,
        vdjExecute,
        isDeckAudible,
        resolveTargetDecks,
        triggerBackspin,
        loadTrackToDeck,
        testConnection
    };
};
