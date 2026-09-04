'use strict';

// TikTok のギフトカタログ（`gift/list/`）の取得・正規化・永続化。
//
// **`gift/list/` を英語版と日本語版の2回叩く。** 日本語表示名（`nameJa`）を TikTok 公式から
// 取るため。日本語化の条件は `webcast_language=ja-JP` ただ1つで、`ja`（2文字）では効かない
// （2026-08-27 に実ルームで実測。`app_language` / `browser_language` / `region` / `tz_name` /
// `Accept-Language` / Cookie / room_id はいずれも無関係）。
//
// **`name`（トリガの一致キー）は必ず英語版から採る。** LIVE のギフトイベントは
// WebSocket の protobuf 由来で英語固定なので、ここを日本語にすると
// `effects-runtime.js` の照合が通らなくなり、**例外もログも出ないままトリガが発火しなくなる**。
// 日本語は `nameJa`（表示専用）にだけ入れる。
//
// ただし「一致キーは常に英語」ではない。配信者ごとのサブスクギフトは TikTok 自身が
// 日本語名で送ってくる（実測: `wayakichi` の「わやハグ」）。受信履歴に残っている名前が
// あればそれを最優先するのは、実際に飛んでくる表記こそが一致キーだから。
//
// カタログは SQLite にも保存する。以前あった辞書アセット（`gift-name-ja.js`）を廃止したので、
// **起動直後・オフラインで日本語名を出せる供給源がここしかない**。

const { WebcastPushConnection } = require('TLC-sidestage');
const { firstDefinedString, hasJapaneseText } = require('./utils');
const { TIKTOK_GIFT_CACHE_TTL_MS, TIKTOK_JA_LOCALE_CLIENT_PARAMS } = require('./constants');
const tiktokState = require('./tiktok-state');

let _dbStore = null;
let _getBroadcasterId = null;
let _getConnectionOptions = null;

// 表示名の同期 lookup 用。`正規化した英語名 -> 日本語名`。
// ライブイベントの処理経路（index.js の hydrateStoredGiftEvent など）は同期関数なので、
// そこから `await fetchTikTokGiftCatalog()` はできない。起動時に SQLite から載せ、
// 取得が成功するたびに差し替える。
let _nameJaByKey = new Map();

function initGiftCatalog({ dbStore, getBroadcasterId, getConnectionOptions }) {
    _dbStore = dbStore;
    _getBroadcasterId = getBroadcasterId;
    _getConnectionOptions = getConnectionOptions;
}

const APOSTROPHES = /[‘’ʼ´`]/gu;
const WHITESPACE = /[\s　]+/gu;

/**
 * 日本語名を引くためのキー正規化。
 *
 * TikTok から届く名前は `Adam’s Dream`（カーリー）と `It's Match Time`（ASCII）が
 * 混在するので、アポストロフィを統一しないと同じギフトを引けないことがある。
 * 同じ規則を `live-sidestage-mobile/lib/core/gift_name_ja.dart` が実装しており、
 * `shared/gift-name-normalization/normalize-cases.json` の共有ベクタが両方を固定している。
 */
function normalizeGiftNameKey(raw) {
    return String(raw ?? '')
        .replace(APOSTROPHES, "'")
        .replace(WHITESPACE, ' ')
        .trim()
        .toLowerCase();
}

/** カタログの配列から `name -> nameJa` の索引を作る。 */
function buildNameJaIndex(gifts) {
    const index = new Map();

    for (const gift of gifts || []) {
        const key = normalizeGiftNameKey(gift?.name);
        const ja = firstDefinedString([gift?.nameJa]);
        if (!key || !ja) {
            continue;
        }

        index.set(key, ja);
    }

    return index;
}

/**
 * SQLite に貯めたカタログから同期 lookup を組み直す。
 *
 * 起動時に1回呼ぶ。取得を待たずに日本語名を出せるようにするためで、
 * 失敗しても英語表記のまま動く（表示を良くするためだけの索引）。
 */
function loadGiftCatalogIndex(broadcasterId) {
    if (!broadcasterId || !_dbStore) {
        return 0;
    }

    try {
        const rows = _dbStore.getGiftCatalog(broadcasterId);
        _nameJaByKey = buildNameJaIndex(rows);
        return _nameJaByKey.size;
    } catch (error) {
        return 0;
    }
}

/**
 * 英語のギフト名に対応する日本語表示名。無ければ渡された名前をそのまま返す。
 *
 * **同期関数。** ライブイベントの処理経路から呼ぶのでここを非同期にしてはいけない。
 */
function getCatalogNameJa(name) {
    const raw = firstDefinedString([name]);
    if (!raw) {
        return '';
    }

    return _nameJaByKey.get(normalizeGiftNameKey(raw)) || raw;
}

function getTikTokGiftImageUrl(gift) {
    return firstDefinedString([
        gift?.image?.url_list?.[0],
        gift?.image?.urlList?.[0],
        gift?.image?.url?.[0],
        gift?.giftImage?.url_list?.[0],
        gift?.giftImage?.urlList?.[0],
        gift?.giftImage?.url?.[0],
        gift?.icon?.url_list?.[0],
        gift?.icon?.urlList?.[0],
        gift?.icon?.url?.[0]
    ]);
}

function getTikTokGiftLocalizationInfo(gift) {
    return {
        giftNameKey: firstDefinedString([gift?.giftNameKey]),
        nameRefKey: firstDefinedString([
            gift?.nameRef?.key,
            gift?.gift?.nameRef?.key
        ]),
        nameRefDefaultPattern: firstDefinedString([
            gift?.nameRef?.defaultPattern,
            gift?.gift?.nameRef?.defaultPattern
        ]),
        rawName: firstDefinedString([gift?.name]),
        rawGiftName: firstDefinedString([gift?.giftName]),
        rawGiftTextName: firstDefinedString([gift?.giftTextName]),
        rawGiftSkinName: firstDefinedString([gift?.giftSkinName]),
        rawDescribe: firstDefinedString([gift?.describe, gift?.description])
    };
}

function buildObservedGiftNameMap(broadcasterId) {
    if (!broadcasterId) {
        return new Map();
    }

    return new Map(
        _dbStore.getLatestGiftNamesById(broadcasterId).map((gift) => [String(gift.giftId || ''), gift])
    );
}

/** 生のカタログ要素から表示に使う名前（ロケール依存）を1つ選ぶ。 */
function pickCatalogName(gift) {
    return firstDefinedString([
        gift?.giftTextName,
        gift?.giftSkinName,
        gift?.giftName,
        gift?.name,
        gift?.describe
    ]) || '';
}

/** `gift/list/` の日本語版から `giftId -> 日本語名` を作る。 */
function buildJaNameMap(gifts) {
    const map = new Map();

    for (const gift of gifts || []) {
        const giftId = firstDefinedString([gift?.id?.toString(), gift?.giftId?.toString()]);
        const name = pickCatalogName(gift);
        if (!giftId || !name) {
            continue;
        }

        map.set(giftId, name);
    }

    return map;
}

/**
 * カタログを正規化する。
 *
 * `options.observedGiftNamesById` は受信履歴から作った `giftId -> 実際に届いた名前`、
 * `options.jaNamesById` は日本語版カタログから作った `giftId -> 日本語名`。
 *
 * **`gifts` には英語版を渡すこと。** ここで作る `name` がトリガの一致キーになる。
 */
function normalizeTikTokGiftCatalog(gifts, options = {}) {
    if (!Array.isArray(gifts)) {
        return [];
    }

    const observedGiftNamesById = options.observedGiftNamesById || new Map();
    const jaNamesById = options.jaNamesById || new Map();

    return gifts.map((gift) => {
        const normalizedDiamondCount = Number(
            gift?.diamond_count
            ?? gift?.diamondCount
            ?? gift?.price
            ?? 0
        );
        const giftId = firstDefinedString([gift?.id?.toString(), gift?.giftId?.toString()]) || '';
        const observedGift = observedGiftNamesById.get(giftId);
        const localization = getTikTokGiftLocalizationInfo(gift);
        const catalogName = pickCatalogName(gift) || '名称未取得';

        // **一致キー。実際に届いた名前を最優先する。**
        // 受信履歴があるならその表記こそが `chat:gift` で飛んでくるものなので、
        // カタログのロケール表記より確実。無ければ英語版カタログの名前を使う。
        const preferredName = firstDefinedString([observedGift?.giftName, catalogName]) || '名称未取得';

        // 表示名。日本語版カタログ → 日本語で届いた受信履歴 → 一致キーの順。
        const nameJa = firstDefinedString([
            jaNamesById.get(giftId),
            hasJapaneseText(observedGift?.giftName) ? observedGift.giftName : null,
            preferredName
        ]) || preferredName;

        return {
            id: giftId,
            name: preferredName,
            nameJa,
            imageUrl: firstDefinedString([observedGift?.giftImage, getTikTokGiftImageUrl(gift)]),
            diamondCount: Number.isFinite(normalizedDiamondCount) ? normalizedDiamondCount : 0,
            describe: firstDefinedString([gift?.describe, gift?.description]) || '',
            fallbackName: catalogName,
            localization,
            observedGiftName: observedGift?.giftName || null
        };
    }).filter((gift) => gift.id && gift.name)
        .sort((left, right) => {
            if (left.diamondCount !== right.diamondCount) {
                return left.diamondCount - right.diamondCount;
            }

            return left.name.localeCompare(right.name, 'ja');
        })
        .filter((gift, index, array) => array.findIndex((other) => other.id === gift.id) === index);
}

// ロケールを決めるクライアントパラメータ。英語版を取るときはここを全部落とす。
const LOCALE_PARAM_KEYS = Object.keys(TIKTOK_JA_LOCALE_CLIENT_PARAMS);

function stripLocaleParams(params) {
    const result = { ...(params || {}) };

    for (const key of LOCALE_PARAM_KEYS) {
        delete result[key];
    }

    return result;
}

/**
 * カタログ取得用の一時接続オプション。
 *
 * ギフトカタログ取得用の一時接続では、メイン接続と同じ sessionid を流用しない。
 * 同一アカウントで 2 本目の認証セッションを張ると TikTok 側のリスクスコアが
 * 上がりやすく、宝箱（ギフト送付）系で「異常な取引が検出されました」が
 * 発生する原因になるため、認証情報・ポーリング・WS 昇格・署名プロバイダを
 * すべて剥がした「未認証で fetchAvailableGifts だけ叩く最小構成」にする。
 *
 * @param {'default'|'ja'} locale `default` は言語パラメータ無し（= 英語）。
 */
function buildTikTokGiftCatalogConnectionOptions(locale = 'ja') {
    const {
        sessionId: _omitSessionId,
        ttTargetIdc: _omitTtTargetIdc,
        authenticateWs: _omitAuthenticateWs,
        enableWebsocketUpgrade: _omitEnableWs,
        enableRequestPolling: _omitEnablePolling,
        signedWebSocketProvider: _omitSignedWsProvider,
        ...baseOptions
    } = _getConnectionOptions();

    // メイン接続の webClientParams には日本語ロケールが入っている。英語版を取るときは
    // それを落とさないと、`name`（一致キー）まで日本語で返ってきてしまう。
    const baseParams = stripLocaleParams(baseOptions.webClientParams);

    return {
        ...baseOptions,
        processInitialData: false,
        enableExtendedGiftInfo: false,
        enableWebsocketUpgrade: false,
        enableRequestPolling: false,
        authenticateWs: false,
        sessionId: undefined,
        ttTargetIdc: undefined,
        signedWebSocketProvider: undefined,
        webClientParams: locale === 'ja'
            ? { ...baseParams, ...TIKTOK_JA_LOCALE_CLIENT_PARAMS }
            : baseParams
    };
}

/** 使い捨て接続で `gift/list/` を1回叩く。 */
async function fetchRawGiftList(broadcasterId, locale) {
    const connection = new WebcastPushConnection(
        broadcasterId,
        buildTikTokGiftCatalogConnectionOptions(locale)
    );

    try {
        return await connection.fetchAvailableGifts();
    } finally {
        if (typeof connection?.disconnect === 'function') {
            await connection.disconnect().catch(() => {});
        }
    }
}

async function fetchTikTokGiftCatalog(options = {}) {
    const broadcasterId = _getBroadcasterId();

    if (!broadcasterId) {
        throw new Error('TikTok の配信ユーザーIDが未設定です。');
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const now = Date.now();

    if (!forceRefresh
        && tiktokState.giftCatalog.broadcasterId === broadcasterId
        && Array.isArray(tiktokState.giftCatalog.gifts)
        && tiktokState.giftCatalog.gifts.length > 0
        && now - tiktokState.giftCatalog.fetchedAt < TIKTOK_GIFT_CACHE_TTL_MS) {
        return tiktokState.giftCatalog.gifts;
    }

    if (tiktokState.giftCatalogPromise && !forceRefresh) {
        return tiktokState.giftCatalogPromise;
    }

    tiktokState.giftCatalogPromise = (async () => {
        const observedGiftNamesById = buildObservedGiftNameMap(broadcasterId);

        try {
            // **メイン接続は再利用しない。** あれは日本語ロケールで張ってあるので、
            // 使い回すと英語版カタログが取れず一致キーが日本語になる。
            // 未認証の使い捨て接続を2本使う（リスクスコアの観点でもこちらが安全）。
            const baseGifts = await fetchRawGiftList(broadcasterId, 'default');

            // 日本語版は表示にしか効かない。落ちてもカタログ更新そのものは通す。
            let jaNamesById = new Map();
            try {
                jaNamesById = buildJaNameMap(await fetchRawGiftList(broadcasterId, 'ja'));
            } catch (error) {
                console.warn('[gift-catalog] 日本語版の取得に失敗しました（既存の日本語名は保持）:', error?.message || error);
            }

            const gifts = normalizeTikTokGiftCatalog(baseGifts, {
                observedGiftNamesById,
                jaNamesById
            });

            tiktokState.giftCatalog = {
                broadcasterId,
                fetchedAt: Date.now(),
                gifts
            };

            // 同期 lookup と永続化を更新する。どちらも失敗してもカタログ自体は返す。
            _nameJaByKey = buildNameJaIndex(gifts);
            try {
                _dbStore.saveGiftCatalog(broadcasterId, gifts);
            } catch (error) {
                console.warn('[gift-catalog] カタログの保存に失敗しました:', error?.message || error);
            }

            return gifts;
        } finally {
            tiktokState.giftCatalogPromise = null;
        }
    })();

    return tiktokState.giftCatalogPromise;
}

module.exports = {
    initGiftCatalog,
    getTikTokGiftImageUrl,
    getTikTokGiftLocalizationInfo,
    buildObservedGiftNameMap,
    normalizeTikTokGiftCatalog,
    buildTikTokGiftCatalogConnectionOptions,
    fetchTikTokGiftCatalog,
    normalizeGiftNameKey,
    buildNameJaIndex,
    loadGiftCatalogIndex,
    getCatalogNameJa,
};
