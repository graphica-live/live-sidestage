'use strict';

const tiktokState = require('./tiktok-state');
const { OFFLINE_RECONNECT_DELAY_MS, RECONNECT_DELAY_MS } = require('./constants');

let _getBroadcasterId;
let _emitAdminDayUpdate;
let _getDisplayDayKey;
let _httpServer;
let _connectToTikTok;
let _hasConfiguredBroadcasterId;
let _isShuttingDown;
let _getRecentTikTokComments;
let _emitAdminCommentsUpdate;
let _finishContributorsSession;
let _normalizeBroadcasterId;
let _setBroadcasterId;

function init({
    getBroadcasterId, emitAdminDayUpdate, getDisplayDayKey, httpServer,
    connectToTikTok, hasConfiguredBroadcasterId, isShuttingDown,
    getRecentTikTokComments, emitAdminCommentsUpdate, finishContributorsSession,
    normalizeBroadcasterId, setBroadcasterId,
}) {
    _getBroadcasterId = getBroadcasterId;
    _emitAdminDayUpdate = emitAdminDayUpdate;
    _getDisplayDayKey = getDisplayDayKey;
    _httpServer = httpServer;
    _connectToTikTok = connectToTikTok;
    _hasConfiguredBroadcasterId = hasConfiguredBroadcasterId;
    _isShuttingDown = isShuttingDown;
    _getRecentTikTokComments = getRecentTikTokComments;
    _emitAdminCommentsUpdate = emitAdminCommentsUpdate;
    _finishContributorsSession = finishContributorsSession;
    _normalizeBroadcasterId = normalizeBroadcasterId;
    _setBroadcasterId = setBroadcasterId;
}

function setTikTokConnectionState(status, message, options = {}) {
    const hasReasonCode = Object.prototype.hasOwnProperty.call(options, 'websocketReasonCode');
    const hasReasonLabel = Object.prototype.hasOwnProperty.call(options, 'websocketReasonLabel');
    const hasReasonDetail = Object.prototype.hasOwnProperty.call(options, 'websocketReasonDetail');
    const hasTransportMethod = Object.prototype.hasOwnProperty.call(options, 'transportMethod');
    const nextState = {
        status,
        message,
        transportMethod: hasTransportMethod ? options.transportMethod : 'unknown',
        websocketReasonCode: hasReasonCode ? options.websocketReasonCode : null,
        websocketReasonLabel: hasReasonLabel ? options.websocketReasonLabel : null,
        websocketReasonDetail: hasReasonDetail ? options.websocketReasonDetail : null,
        retryScheduled: Boolean(options.retryScheduled),
        retryReason: options.retryReason || null,
        retryDelayMs: options.retryDelayMs ?? null,
        broadcasterId: _getBroadcasterId(),
        updatedAt: new Date().toISOString()
    };
    const previousState = tiktokState.connectionState;

    if (
        previousState
        && previousState.status === nextState.status
        && previousState.message === nextState.message
        && previousState.transportMethod === nextState.transportMethod
        && previousState.websocketReasonCode === nextState.websocketReasonCode
        && previousState.websocketReasonLabel === nextState.websocketReasonLabel
        && previousState.websocketReasonDetail === nextState.websocketReasonDetail
        && previousState.retryScheduled === nextState.retryScheduled
        && previousState.retryReason === nextState.retryReason
        && previousState.retryDelayMs === nextState.retryDelayMs
        && previousState.broadcasterId === nextState.broadcasterId
    ) {
        return tiktokState.connectionState;
    }

    tiktokState.connectionState = nextState;

    if (_httpServer.listening) {
        _emitAdminDayUpdate(_getDisplayDayKey());
    }

    return tiktokState.connectionState;
}

function getTikTokConnectionState() {
    return {
        ...tiktokState.connectionState,
        broadcasterId: _getBroadcasterId()
    };
}

function buildTikTokOfflineMessage(broadcasterId) {
    return broadcasterId
        ? `@${broadcasterId} は現在配信していません。配信開始後まで待機してください。アプリは自動で再接続を試行します。`
        : '現在このユーザーは配信していません。';
}

function isTikTokUserOfflineError(error) {
    const candidates = [
        error,
        error?.exception,
        error?.cause,
        error?.response?.data,
        error?.error
    ].filter(Boolean);

    const detailText = candidates.map((candidate) => {
        if (typeof candidate?.message === 'string' && candidate.message.trim()) {
            return candidate.message;
        }
        if (typeof candidate?.info === 'string' && candidate.info.trim()) {
            return candidate.info;
        }
        return String(candidate || '');
    }).join('\n');

    const hasOfflineName = candidates.some((candidate) => candidate?.name === 'UserOfflineError');

    return hasOfflineName || /isn\'t online|user.+offline|requested user.+online/i.test(detailText);
}

function isTikTokAlreadyConnectedError(error) {
    const message = typeof error?.message === 'string' ? error.message : String(error || '');
    return /already connected!?/i.test(message);
}

function getTikTokErrorDetailText(error) {
    return [
        error?.message,
        error?.response?.statusText,
        error?.response?.data?.message,
        error?.response?.data?.error,
        error?.response?.data?.description,
        error?.cause?.message
    ].filter(Boolean).join('\n');
}

function isTikTokRecoverableRoomInfoError(error) {
    const detailText = [
        error?.message,
        error?.info,
        error?.exception?.message,
        error?.cause?.message,
        error?.error?.message
    ].filter(Boolean).join('\n');

    return /Failed to retrieve Room ID from main page|SIGI_STATE|falling back to API source|blocked by TikTok/i.test(detailText);
}

function isTikTokEulerRateLimitError(error) {
    const candidates = [error, error?.exception, error?.cause].filter(Boolean);
    return candidates.some((candidate) => candidate?.name === 'SignatureRateLimitError')
        || /Rate Limited/i.test(String(error?.reason || ''))
        || /\[Rate Limited\]/i.test(String(error?.message || ''));
}

function scheduleReconnect(reason, errorDetail = null, overrideDelayMs = null, retryMessageOverride = null) {
    if (_isShuttingDown() || tiktokState.reconnectTimer || !_hasConfiguredBroadcasterId()) {
        return;
    }

    if (!tiktokState.autoReconnect) {
        const isOfflineWait = reason === 'user_offline';
        const stateMessage = isOfflineWait
            ? '配信がオフラインです。接続ボタンを押して再試行できます。'
            : '接続が切れました。接続ボタンを押して再接続できます。';
        console.info(`ℹ️ Auto-reconnect disabled. Manual reconnect required (reason: ${reason}).`);
        setTikTokConnectionState('error', stateMessage, {
            transportMethod: 'unknown',
            retryScheduled: false,
            retryReason: reason,
            websocketReasonCode: 'manual_reconnect',
            websocketReasonLabel: '手動接続が必要です。',
            websocketReasonDetail: stateMessage
        });
        return;
    }

    const isOfflineWait = reason === 'user_offline';
    const delayMs = overrideDelayMs ?? (isOfflineWait ? OFFLINE_RECONNECT_DELAY_MS : RECONNECT_DELAY_MS);
    const retryDetail = errorDetail
        ? `切断後の再接続待機中です。再接続が成功すると受信方式が更新されます。\n直前のエラー: ${errorDetail}`
        : isOfflineWait
            ? '配信開始を待機しています。配信が始まると自動的に接続します。'
            : '切断後の再接続待機中です。再接続が成功すると受信方式が更新されます。';
    const retryMessage = retryMessageOverride ?? (isOfflineWait
        ? `配信がオフラインです。${Math.round(delayMs / 1000)}秒後に再確認します。`
        : `TikTok接続が切れました。${Math.round(delayMs / 1000)}秒後に再接続します。`);

    setTikTokConnectionState('retrying', retryMessage, {
        transportMethod: 'unknown',
        retryScheduled: true,
        retryReason: reason,
        retryDelayMs: delayMs,
        websocketReasonCode: 'reconnecting',
        websocketReasonLabel: isOfflineWait ? '配信開始を待機しています。' : '再接続を待機しています。',
        websocketReasonDetail: retryDetail
    });
    console.warn(`⚠️ TikTok connection retry scheduled (${reason}) in ${delayMs}ms${errorDetail ? ` — ${errorDetail}` : ''}`);
    tiktokState.reconnectTimer = setTimeout(() => {
        tiktokState.reconnectTimer = null;
        setTikTokConnectionState('connecting', 'TikTokへ再接続しています...', {
            transportMethod: 'unknown',
            websocketReasonCode: 'reconnecting',
            websocketReasonLabel: '再接続を試行しています。',
            websocketReasonDetail: '接続先の状態を再確認しているため、受信方式はまだ確定していません。'
        });
        _connectToTikTok().catch(() => {});
    }, delayMs);
}

async function resetTikTokConnection() {
    _getRecentTikTokComments().length = 0;
    _emitAdminCommentsUpdate();

    if (tiktokState.reconnectTimer) {
        clearTimeout(tiktokState.reconnectTimer);
        tiktokState.reconnectTimer = null;
    }

    tiktokState.connectPromise = null;
    tiktokState.connectAttempts = 0;

    if (!tiktokState.liveConnection) {
        tiktokState.activeUsername = null;
        return;
    }

    const connection = tiktokState.liveConnection;
    tiktokState.liveConnection = null;
    tiktokState.activeUsername = null;

    _finishContributorsSession();

    connection.removeAllListeners?.();

    try {
        await Promise.resolve(connection.disconnect?.());
    } catch (error) {
        console.warn('⚠️ Failed to disconnect previous TikTok connection cleanly:', error);
    }

    setTikTokConnectionState('idle', 'TikTok接続をリセットしました。', {
        transportMethod: 'unknown',
        websocketReasonCode: 'connection_reset',
        websocketReasonLabel: '接続はリセット済みです。',
        websocketReasonDetail: '次回接続時にあらためて WebSocket か request polling かを判定します。'
    });
}

async function switchBroadcasterId(broadcasterId) {
    const normalizedBroadcasterId = _normalizeBroadcasterId(broadcasterId);

    if (!normalizedBroadcasterId) {
        return null;
    }

    if (_getBroadcasterId() !== normalizedBroadcasterId) {
        await resetTikTokConnection();
    }

    const savedBroadcasterId = _setBroadcasterId(normalizedBroadcasterId);
    setTikTokConnectionState('idle', `@${savedBroadcasterId} への接続準備ができました。`, {
        transportMethod: 'unknown',
        websocketReasonCode: 'pending_connection',
        websocketReasonLabel: '接続前の待機状態です。',
        websocketReasonDetail: '接続が始まると、その配信で WebSocket が使えるかどうかを判定します。'
    });
    return savedBroadcasterId;
}

module.exports = {
    init,
    setTikTokConnectionState,
    getTikTokConnectionState,
    buildTikTokOfflineMessage,
    isTikTokUserOfflineError,
    isTikTokAlreadyConnectedError,
    getTikTokErrorDetailText,
    isTikTokRecoverableRoomInfoError,
    isTikTokEulerRateLimitError,
    scheduleReconnect,
    resetTikTokConnection,
    switchBroadcasterId,
};
