const path = require('path');
const { normalizeGiftNameKey } = require('./tiktok-gift-catalog');

// TikTokのgift/listカタログには絵柄・価格が同じでもgiftIdだけ異なる重複ギフトが存在する。
// 配信者がPush/Pull設定で「実際には配信されない方のgiftId」を選んでいても、
// 名前+価格が一致すれば同一ギフトとして救済する。giftId一致を必ず名前一致より優先すること
// （名前一致を先に評価すると、push/pullどちらか一方が誤って先に一致してしまう）。
function findPushPullMatch(pushGifts, pullGifts, event) {
    const giftId = String(event.giftId || '');
    const matchesId = (g) => g.giftId === giftId;

    let pushMatch = pushGifts.find(matchesId);
    let pullMatch = !pushMatch && pullGifts.find(matchesId);
    if (pushMatch || pullMatch) {
        return { side: pushMatch ? 'push' : 'pull', gift: pushMatch || pullMatch };
    }

    const nameKey = normalizeGiftNameKey(event.giftName);
    const diamondCount = Number(event.diamondCount) || 0;
    if (!nameKey || diamondCount <= 0) {
        return null;
    }
    const matchesNamePrice = (g) => g.diamondCount === diamondCount
        && normalizeGiftNameKey(g.giftName) === nameKey;

    pushMatch = pushGifts.find(matchesNamePrice);
    pullMatch = !pushMatch && pullGifts.find(matchesNamePrice);
    if (!pushMatch && !pullMatch) return null;
    return { side: pushMatch ? 'push' : 'pull', gift: pushMatch || pullMatch };
}

module.exports = function({ dbStore, PUBLIC_DIRECTORY, getPushPullWidgetTextAppearance }) {

const GIFT_JAR_HISTORY_LIMIT = 150;
const giftJarHistory = [];
let giftJarLastPositions = null;
function getGiftJarLastPositions() { return giftJarLastPositions; }
function setGiftJarLastPositions(val) { giftJarLastPositions = val; }
let giftJarHistoryPersistTimer = null;
let giftJarPositionsPersistTimer = null;

function scheduleGiftJarHistoryPersist() {
    if (giftJarHistoryPersistTimer) clearTimeout(giftJarHistoryPersistTimer);
    giftJarHistoryPersistTimer = setTimeout(() => {
        giftJarHistoryPersistTimer = null;
        try { dbStore.setGlobalStateValue('gift_jar_history_v2', JSON.stringify(giftJarHistory), new Date().toISOString()); } catch {}
    }, 3000);
}

function scheduleGiftJarPositionsPersist() {
    if (giftJarPositionsPersistTimer) clearTimeout(giftJarPositionsPersistTimer);
    giftJarPositionsPersistTimer = setTimeout(() => {
        giftJarPositionsPersistTimer = null;
        if (giftJarLastPositions && giftJarLastPositions.length > 0) {
            try { dbStore.setGlobalStateValue('gift_jar_last_positions', JSON.stringify(giftJarLastPositions), new Date().toISOString()); } catch {}
        }
    }, 3000);
}
const GIFT_JAR_THEMES = ['jar', 'glass', 'barrel', 'cauldron', 'flask', 'pig', 'bee'];

const giftJarConfig = {
    dropAboveJar: 0,
    sizeMultiplier: 1.0,
    sizeRatioCoeff: 1.0,
    jarTheme: 'jar',
    customProfiles: {}
};

const pushPullConfig = {
    pushLabel: 'プッシュ',
    pullLabel: 'プル',
    pushGifts: [],
    pullGifts: [],
    giftSize: 88,
    giftPtsSize: 15,
    scoreMode: 'absolute',
};
let pushPullState = {
    pushPoints: 0,
    pullPoints: 0,
};

function loadPersistedJson(key) {
    const raw = dbStore.getGlobalStateValue(key);
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try { return JSON.parse(raw); } catch (e) {
        console.warn(`[db] failed to parse persisted state "${key}":`, e.message);
        return null;
    }
}

function clampGiftJarCoordinate(value) {
    return Math.max(0, Math.min(Math.round(value), 1080));
}

function normalizeGiftJarProfile(rawProfile) {
    if (!rawProfile || typeof rawProfile !== 'object') return null;

    const widthStops = [];
    const seenStopKeys = new Set();
    for (const stop of Array.isArray(rawProfile.widthStops) ? rawProfile.widthStops : []) {
        if (!stop || typeof stop !== 'object') continue;
        const y = clampGiftJarCoordinate(Number(stop.y));
        const left = clampGiftJarCoordinate(Number(stop.left));
        const right = clampGiftJarCoordinate(Number(stop.right));
        if (!Number.isFinite(y) || !Number.isFinite(left) || !Number.isFinite(right)) continue;
        if (right - left < 8) continue;
        const key = `${y}:${left}:${right}`;
        if (seenStopKeys.has(key)) continue;
        seenStopKeys.add(key);
        widthStops.push({ y, left, right });
    }
    widthStops.sort((a, b) => a.y - b.y);

    const wallPoints = [];
    let previousPointKey = '';
    for (const point of Array.isArray(rawProfile.wallPoints) ? rawProfile.wallPoints : []) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const x = clampGiftJarCoordinate(Number(point[0]));
        const y = clampGiftJarCoordinate(Number(point[1]));
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const key = `${x}:${y}`;
        if (key === previousPointKey) continue;
        previousPointKey = key;
        wallPoints.push([x, y]);
    }

    if (widthStops.length < 4 || wallPoints.length < 6) return null;
    return { widthStops, wallPoints };
}

function normalizeGiftJarCustomProfiles(rawProfiles) {
    const profiles = {};
    if (!rawProfiles || typeof rawProfiles !== 'object') return profiles;
    for (const theme of GIFT_JAR_THEMES) {
        const normalized = normalizeGiftJarProfile(rawProfiles[theme]);
        if (normalized) profiles[theme] = normalized;
    }
    return profiles;
}

function persistGiftJarCustomProfiles() {
    dbStore.setGlobalStateValue('gift_jar_custom_profiles', JSON.stringify(giftJarConfig.customProfiles), Date.now());
}

// Restore persisted gift jar config
{
    const saved = dbStore.getGlobalStateValue('gift_jar_drop_above_jar');
    if (saved !== null) {
        const v = Number(saved);
        if (Number.isFinite(v)) giftJarConfig.dropAboveJar = Math.max(0, Math.min(Math.round(v), 400));
    }

    const savedMult = dbStore.getGlobalStateValue('gift_jar_size_multiplier');
    if (savedMult !== null) {
        const v = Number(savedMult);
        if (Number.isFinite(v)) giftJarConfig.sizeMultiplier = Math.max(0.1, Math.min(v, 5.0));
    }
    const savedTheme = dbStore.getGlobalStateValue('gift_jar_theme');
    if (savedTheme !== null && GIFT_JAR_THEMES.includes(savedTheme) && savedTheme !== 'glass') {
        giftJarConfig.jarTheme = savedTheme;
    }
    const savedCustomProfiles = loadPersistedJson('gift_jar_custom_profiles');
    if (savedCustomProfiles !== null) {
        giftJarConfig.customProfiles = normalizeGiftJarCustomProfiles(savedCustomProfiles);
    }
    const savedHistoryV2 = loadPersistedJson('gift_jar_history_v2');
    if (Array.isArray(savedHistoryV2) && savedHistoryV2.length > 0) {
        giftJarHistory.push(...savedHistoryV2.slice(-GIFT_JAR_HISTORY_LIMIT));
    }
    // giftJarLastPositions は起動時にはロードしない。
    // restoreFromPositions() は全ボディを Sleeping.set(body, true) で強制スリープするため、
    // 新しいギフトの初速 (velocity.y = 0.5) が Matter.js の wake threshold (~4.8) を下回り、
    // スリープボディを起こせず新ギフトが瓶に入らなくなる。
    // 再起動後は history replay (10x 速) で瓶を自然充填する。
}

// ======== オリジナル瓶詰めギフト（完全独立） ========
const CUSTOM_JAR_IMAGES_DIR = path.join(PUBLIC_DIRECTORY, 'widgets', 'custom-jar-images');
try { require('fs').mkdirSync(CUSTOM_JAR_IMAGES_DIR, { recursive: true }); } catch {}

const customJarConfig = {
    activeThemeId: null,
    themes: [],          // [{ id, label, imageUrl, profile }]
    dropAboveJar: 0,
    sizeMultiplier: 0.4,
    sizeRatioCoeff: 1.0
};
let customJarHistory = [];
let customJarLastPositions = null;
function getCustomJarLastPositions() { return customJarLastPositions; }
function setCustomJarLastPositions(val) { customJarLastPositions = val; }
const CUSTOM_JAR_HISTORY_LIMIT = 300;

function persistCustomJarConfig() {
    const toSave = {
        activeThemeId: customJarConfig.activeThemeId,
        themes: customJarConfig.themes,
        dropAboveJar: customJarConfig.dropAboveJar,
        sizeMultiplier: customJarConfig.sizeMultiplier
    };
    dbStore.setGlobalStateValue('custom_jar_config', JSON.stringify(toSave), Date.now());
}

function buildCustomJarPayload() {
    const active = customJarConfig.themes.find(t => t.id === customJarConfig.activeThemeId) || null;
    return {
        activeThemeId: customJarConfig.activeThemeId,
        activeImageUrl: active?.imageUrl || null,
        activeProfile: active?.profile || null,
        dropAboveJar: customJarConfig.dropAboveJar,
        sizeMultiplier: customJarConfig.sizeMultiplier,
        sizeRatioCoeff: customJarConfig.sizeRatioCoeff,
        themes: customJarConfig.themes.map(t => ({ id: t.id, label: t.label, imageUrl: t.imageUrl }))
    };
}

function saveCustomJarImageFile(id, dataUrl) {
    const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!m) throw new Error('invalid image data URL');
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const filename = `${id}.${ext}`;
    require('fs').writeFileSync(
        path.join(CUSTOM_JAR_IMAGES_DIR, filename),
        Buffer.from(m[2], 'base64')
    );
    return `/widgets/custom-jar-images/${filename}`;
}

function deleteCustomJarImageFile(id) {
    const fs = require('fs');
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
        try { fs.unlinkSync(path.join(CUSTOM_JAR_IMAGES_DIR, `${id}.${ext}`)); return; } catch {}
    }
}

// Restore persisted custom jar config
{
    const p = loadPersistedJson('custom_jar_config');
    if (p !== null) {
        if (Array.isArray(p.themes)) customJarConfig.themes = p.themes;
        if (typeof p.activeThemeId === 'string') customJarConfig.activeThemeId = p.activeThemeId;
        if (typeof p.dropAboveJar === 'number') customJarConfig.dropAboveJar = p.dropAboveJar;
        if (typeof p.sizeMultiplier === 'number') customJarConfig.sizeMultiplier = p.sizeMultiplier;
    }
}
// ======== /オリジナル瓶詰めギフト ========

function normalizePushPullGifts(items) {
    if (!Array.isArray(items)) return [];
    return items.slice(0, 5).filter(Boolean).map((item) => ({
        giftId: String(item.giftId || '').trim(),
        giftName: String(item.giftName || '').trim(),
        giftImage: String(item.giftImage || '').trim(),
        diamondCount: Math.max(0, Number(item.diamondCount) || 0),
        points: Math.max(1, Math.min(99999, Math.round(Number(item.points) || 1))),
    })).filter((item) => item.giftId.length > 0);
}

function buildPushPullSnapshot() {
    return {
        pushLabel: pushPullConfig.pushLabel,
        pullLabel: pushPullConfig.pullLabel,
        pushGifts: pushPullConfig.pushGifts,
        pullGifts: pushPullConfig.pullGifts,
        pushPoints: pushPullState.pushPoints,
        pullPoints: pushPullState.pullPoints,
        scoreMode: pushPullConfig.scoreMode,
        appearance: getPushPullWidgetTextAppearance()
    };
}

function persistPushPullConfig() {
    try {
        dbStore.setGlobalStateValue('push_pull_config', JSON.stringify({
            pushLabel: pushPullConfig.pushLabel,
            pullLabel: pushPullConfig.pullLabel,
            pushGifts: pushPullConfig.pushGifts,
            pullGifts: pushPullConfig.pullGifts,
            giftSize: pushPullConfig.giftSize,
            giftPtsSize: pushPullConfig.giftPtsSize,
            scoreMode: pushPullConfig.scoreMode,
        }), Date.now());
    } catch {}
}

function persistPushPullState() {
    try {
        dbStore.setGlobalStateValue('push_pull_state', JSON.stringify(pushPullState), Date.now());
    } catch {}
}

// Restore persisted push-pull config and state
{
    const savedCfg = loadPersistedJson('push_pull_config');
    if (savedCfg !== null) {
        if (typeof savedCfg.pushLabel === 'string' && savedCfg.pushLabel.trim()) {
            pushPullConfig.pushLabel = savedCfg.pushLabel.trim().slice(0, 30);
        }
        if (typeof savedCfg.pullLabel === 'string' && savedCfg.pullLabel.trim()) {
            pushPullConfig.pullLabel = savedCfg.pullLabel.trim().slice(0, 30);
        }
        if (Array.isArray(savedCfg.pushGifts)) pushPullConfig.pushGifts = normalizePushPullGifts(savedCfg.pushGifts);
        if (Array.isArray(savedCfg.pullGifts)) pushPullConfig.pullGifts = normalizePushPullGifts(savedCfg.pullGifts);
        if (typeof savedCfg.giftSize === 'number' && savedCfg.giftSize >= 40 && savedCfg.giftSize <= 160) {
            pushPullConfig.giftSize = savedCfg.giftSize;
        }
        if (typeof savedCfg.giftPtsSize === 'number' && savedCfg.giftPtsSize >= 8 && savedCfg.giftPtsSize <= 40) {
            pushPullConfig.giftPtsSize = savedCfg.giftPtsSize;
        }
        if (savedCfg.scoreMode === 'relative' || savedCfg.scoreMode === 'absolute') {
            pushPullConfig.scoreMode = savedCfg.scoreMode;
        }
    }
    const savedState = loadPersistedJson('push_pull_state');
    if (savedState !== null) {
        if (typeof savedState.pushPoints === 'number' && Number.isFinite(savedState.pushPoints)) {
            pushPullState.pushPoints = Math.max(0, Math.round(savedState.pushPoints));
        }
        if (typeof savedState.pullPoints === 'number' && Number.isFinite(savedState.pullPoints)) {
            pushPullState.pullPoints = Math.max(0, Math.round(savedState.pullPoints));
        }
    }
}


    return {
        GIFT_JAR_HISTORY_LIMIT,
        CUSTOM_JAR_HISTORY_LIMIT,
        GIFT_JAR_THEMES,
        giftJarHistory,
        giftJarConfig,
        pushPullConfig,
        pushPullState,
        customJarConfig,
        customJarHistory,
        getGiftJarLastPositions,
        setGiftJarLastPositions,
        getCustomJarLastPositions,
        setCustomJarLastPositions,
        scheduleGiftJarHistoryPersist,
        scheduleGiftJarPositionsPersist,
        persistGiftJarCustomProfiles,
        persistCustomJarConfig,
        persistPushPullConfig,
        persistPushPullState,
        normalizeGiftJarProfile,
        normalizeGiftJarCustomProfiles,
        buildCustomJarPayload,
        saveCustomJarImageFile,
        deleteCustomJarImageFile,
        normalizePushPullGifts,
        buildPushPullSnapshot,
        findPushPullMatch,
    };
};

// dbStore等に依存しない純粋関数なので、factory呼び出し(dbStoreのモック)なしに
// unit testから直接requireできるよう、モジュール自体にも直接生やす。
module.exports.findPushPullMatch = findPushPullMatch;
