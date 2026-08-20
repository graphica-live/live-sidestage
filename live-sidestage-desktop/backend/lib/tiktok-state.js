'use strict';

const tiktokState = {
    liveConnection: null,
    activeUsername: null,
    giftCatalog: {
        broadcasterId: null,
        fetchedAt: 0,
        gifts: []
    },
    giftCatalogPromise: null,
    connectionState: {
        status: 'idle',
        message: 'TikTok接続はまだ開始していません。',
        transportMethod: 'unknown',
        websocketReasonCode: null,
        websocketReasonLabel: null,
        websocketReasonDetail: null,
        retryScheduled: false,
        retryReason: null,
        retryDelayMs: null,
        broadcasterId: null,
        updatedAt: new Date().toISOString()
    },
    reconnectTimer: null,
    autoReconnect: false,
    connectPromise: null,
    connectAttempts: 0,
    lastEventAt: 0,
};

module.exports = tiktokState;
