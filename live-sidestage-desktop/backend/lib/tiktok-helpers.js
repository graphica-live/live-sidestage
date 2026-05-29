'use strict';

const tiktokState = require('./tiktok-state');

let _getBroadcasterId;
let _emitAdminDayUpdate;
let _getDisplayDayKey;
let _httpServer;

function init({ getBroadcasterId, emitAdminDayUpdate, getDisplayDayKey, httpServer }) {
    _getBroadcasterId = getBroadcasterId;
    _emitAdminDayUpdate = emitAdminDayUpdate;
    _getDisplayDayKey = getDisplayDayKey;
    _httpServer = httpServer;
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

module.exports = {
    init,
    setTikTokConnectionState,
    getTikTokConnectionState,
    buildTikTokOfflineMessage,
    isTikTokUserOfflineError,
    isTikTokAlreadyConnectedError,
    getTikTokErrorDetailText,
    isTikTokRecoverableRoomInfoError,
};
