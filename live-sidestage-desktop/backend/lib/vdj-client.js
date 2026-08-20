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

    // get_activedeck は VDJScript上の「sync masterデッキ」番号を返す。
    // これが VirtualDJ 用語での「マスターデッキ」に相当する。
    async function getMasterDeckNumber() {
        const result = await vdjQuery('get_activedeck');
        const deckNum = Number.parseInt(result, 10);
        return Number.isInteger(deckNum) && deckNum > 0 ? deckNum : null;
    }

    // master/non-master は2デッキ運用を前提に get_activedeck(マスターデッキ) で判定する。
    // マスターデッキが取得できない場合は deck2 を非マスター側にフォールバックする。
    async function resolveTargetDecks(targetMode) {
        switch (targetMode) {
            case 'deck1':
                return [1];
            case 'deck2':
                return [2];
            case 'both':
                return [1, 2];
            case 'master':
            case 'non-master': {
                const masterDeck = await getMasterDeckNumber();
                const resolvedMaster = masterDeck === 1 || masterDeck === 2 ? masterDeck : null;
                const nonMasterDeck = resolvedMaster === 1 ? 2 : resolvedMaster === 2 ? 1 : 2;
                return targetMode === 'master'
                    ? (resolvedMaster ? [resolvedMaster] : [])
                    : [nonMasterDeck];
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
        getMasterDeckNumber,
        resolveTargetDecks,
        triggerBackspin,
        loadTrackToDeck,
        testConnection
    };
};
