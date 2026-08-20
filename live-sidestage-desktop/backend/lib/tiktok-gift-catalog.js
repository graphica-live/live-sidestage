'use strict';

const { WebcastPushConnection } = require('tiktok-live-connector');
const { firstDefinedString, hasJapaneseText } = require('./utils');
const { TIKTOK_GIFT_CACHE_TTL_MS, TIKTOK_JA_LOCALE_CLIENT_PARAMS } = require('./constants');
const tiktokState = require('./tiktok-state');
const { getGiftDisplayNameJa } = require('./gift-name-ja');

let _dbStore = null;
let _getBroadcasterId = null;
let _getConnectionOptions = null;

function initGiftCatalog({ dbStore, getBroadcasterId, getConnectionOptions }) {
    _dbStore = dbStore;
    _getBroadcasterId = getBroadcasterId;
    _getConnectionOptions = getConnectionOptions;
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

function normalizeTikTokGiftCatalog(gifts, options = {}) {
    if (!Array.isArray(gifts)) {
        return [];
    }

    const observedGiftNamesById = options.observedGiftNamesById || new Map();

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
        const catalogName = firstDefinedString([
            gift?.giftTextName,
            gift?.giftSkinName,
            gift?.giftName,
            gift?.name,
            gift?.describe
        ]) || '名称未取得';
        const preferredName = hasJapaneseText(observedGift?.giftName) && !hasJapaneseText(catalogName)
            ? observedGift.giftName
            : firstDefinedString([
                hasJapaneseText(gift?.giftTextName) ? gift.giftTextName : null,
                hasJapaneseText(gift?.giftSkinName) ? gift.giftSkinName : null,
                hasJapaneseText(gift?.giftName) ? gift.giftName : null,
                hasJapaneseText(gift?.name) ? gift.name : null,
                observedGift?.giftName,
                catalogName
            ]) || '名称未取得';

        return {
            id: giftId,
            name: preferredName,
            nameJa: getGiftDisplayNameJa(preferredName),
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

function buildTikTokGiftCatalogConnectionOptions() {
    // ギフトカタログ取得用の一時接続では、メイン接続と同じ sessionid を流用しない。
    // 同一アカウントで 2 本目の認証セッションを張ると TikTok 側のリスクスコアが
    // 上がりやすく、宝箱（ギフト送付）系で「異常な取引が検出されました」が
    // 発生する原因になるため、認証情報・ポーリング・WS 昇格・署名プロバイダを
    // すべて剥がした「未認証で fetchAvailableGifts だけ叩く最小構成」にする。
    const {
        sessionId: _omitSessionId,
        ttTargetIdc: _omitTtTargetIdc,
        authenticateWs: _omitAuthenticateWs,
        enableWebsocketUpgrade: _omitEnableWs,
        enableRequestPolling: _omitEnablePolling,
        signedWebSocketProvider: _omitSignedWsProvider,
        ...baseOptions
    } = _getConnectionOptions();

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
        webClientParams: {
            ...(baseOptions.webClientParams || {}),
            ...TIKTOK_JA_LOCALE_CLIENT_PARAMS
        }
    };
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
        const shouldReuseConnection = tiktokState.liveConnection && tiktokState.activeUsername === broadcasterId;
        const connection = shouldReuseConnection
            ? tiktokState.liveConnection
            : new WebcastPushConnection(broadcasterId, buildTikTokGiftCatalogConnectionOptions());
        const observedGiftNamesById = buildObservedGiftNameMap(broadcasterId);

        try {
            const gifts = normalizeTikTokGiftCatalog(await connection.fetchAvailableGifts(), {
                observedGiftNamesById
            });

            tiktokState.giftCatalog = {
                broadcasterId,
                fetchedAt: Date.now(),
                gifts
            };

            return gifts;
        } finally {
            if (!shouldReuseConnection && typeof connection?.disconnect === 'function') {
                await connection.disconnect().catch(() => {});
            }

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
};
