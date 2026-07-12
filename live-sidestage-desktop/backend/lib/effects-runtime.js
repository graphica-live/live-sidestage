'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function createEffectsRuntime({
    io,
    getEffectEvents,
    getEffectTriggers,
    getEffectsGloballyPaused,
    normalizeBroadcasterId,
    normalizeEffectText,
    normalizeWholeNumber,
    getTimestamp,
}) {
    const USER_VIDEO_EXTENSIONS = ['mp4', 'vp9', 'mov'];
    const USER_VIDEO_MIME_TYPES = { mp4: 'video/mp4', vp9: 'video/webm', mov: 'video/quicktime' };

    function normalizeUserIdForFilename(value) {
        const normalized = normalizeBroadcasterId(value);
        if (!normalized) {
            return null;
        }

        const cleaned = normalized.replace(/[^a-zA-Z0-9._-]/g, '');
        return cleaned || null;
    }

    function findUserVideoFile(dirPath, userId) {
        const normalizedUserId = normalizeUserIdForFilename(userId);

        if (!normalizedUserId || !dirPath) {
            return null;
        }

        const resolvedDir = path.resolve(dirPath);

        for (const ext of USER_VIDEO_EXTENSIONS) {
            const filePath = path.join(resolvedDir, `${normalizedUserId}.${ext}`);
            const resolvedPath = path.resolve(filePath);

            if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + path.sep)) {
                continue;
            }

            try {
                const stat = fs.statSync(resolvedPath);

                if (stat.isFile()) {
                    return { filePath: resolvedPath, ext };
                }
            } catch {
                // ファイルが存在しない場合は次の拡張子を試す
            }
        }

        return null;
    }

    function createEffectPlaybackPayload(effectEvent, trigger, sourceEvent) {
        const treatGiftComboAsSingle = trigger?.treatGiftComboAsSingle !== undefined
            ? trigger.treatGiftComboAsSingle !== false
            : effectEvent?.treatGiftComboAsSingle !== false;

        return {
            playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            eventId: effectEvent.id,
            eventName: effectEvent.name,
            screen: effectEvent.screen,
            videoUrl: effectEvent.videoEnabled ? effectEvent.videoAssetUrl : '',
            audioUrl: effectEvent.audioEnabled ? effectEvent.audioAssetUrl : '',
            mediaVolume: effectEvent.mediaVolume,
            playbackCount: treatGiftComboAsSingle ? 1 : Math.max(1, Number(sourceEvent?.repeatCount || 1)),
            triggerId: trigger?.id || 'preview-trigger',
            triggerName: trigger?.name || 'Preview',
            giftName: sourceEvent?.giftName || '',
            comment: sourceEvent?.comment || '',
            totalGifts: sourceEvent?.totalGifts || 0,
            repeatCount: sourceEvent?.repeatCount || 1,
            uniqueId: sourceEvent?.uniqueId || '',
            nickname: sourceEvent?.nickname || '',
            timestamp: getTimestamp()
        };
    }

    function emitEffectPlayback(effectEvent, trigger, sourceEvent) {
        if (getEffectsGloballyPaused()) return;
        io.emit('effects:playback', createEffectPlaybackPayload(effectEvent, trigger, sourceEvent));
    }

    function matchesEffectTrigger(trigger, context) {
        if (trigger.giftName && trigger.giftName !== context.giftName) {
            return false;
        }

        if (trigger.minCoins > 0 && context.totalGifts < trigger.minCoins) {
            return false;
        }

        if (trigger.commentMode === 'any') {
            if (context.type !== 'comment') {
                return false;
            }
        } else if (trigger.commentMode === 'exact') {
            if (context.type !== 'comment' || !trigger.commentText || trigger.commentText !== context.comment) {
                return false;
            }
        }

        if (trigger.userIds.length > 0 && (!context.userId || !trigger.userIds.includes(context.userId))) {
            return false;
        }

        return true;
    }

    // user-video file-map トリガーを持つユーザーの動画を、トリガー条件成立前に投機的プリロード
    function speculativelyPreloadUserVideos(userId) {
        if (!userId) return;
        const effectEvents = getEffectEvents();
        const eventById = new Map(effectEvents.map((item) => [item.id, item]));
        const fileMapTriggers = getEffectTriggers().filter(
            (item) => item.enabled && item.userTargetMode === 'file-map' && item.userIdToFileDir && item.eventIds.length > 0
        );
        fileMapTriggers.forEach((trigger) => {
            if (!findUserVideoFile(trigger.userIdToFileDir, userId)) return;
            const normalizedUserId = normalizeUserIdForFilename(userId);
            const videoUrl = `/api/effects/user-video/${encodeURIComponent(trigger.id)}/${encodeURIComponent(normalizedUserId)}`;
            trigger.eventIds.forEach((eventId) => {
                const effectEvent = eventById.get(eventId);
                if (!effectEvent || !effectEvent.videoEnabled) return;
                io.emit('effects:preload', { screen: effectEvent.screen, videoUrl });
            });
        });
    }

    function tryRunEffectTriggers(context, sourceEvent) {
        const effectEvents = getEffectEvents();
        const eventById = new Map(effectEvents.map((item) => [item.id, item]));
        const triggers = getEffectTriggers().filter((item) => item.enabled && item.eventIds.length > 0);
        let anyTriggered = false;

        triggers.forEach((trigger) => {
            if (!matchesEffectTrigger(trigger, context)) {
                return;
            }

            anyTriggered = true;

            // 再生するイベントを決定（順次 or ランダム）
            let targetEventIds;

            if (trigger.eventPlayMode === 'random') {
                const randomId = trigger.eventIds[Math.floor(Math.random() * trigger.eventIds.length)];
                targetEventIds = randomId ? [randomId] : [];
            } else {
                targetEventIds = trigger.eventIds;
            }

            targetEventIds.forEach((eventId) => {
                const effectEvent = eventById.get(eventId);

                if (!effectEvent) {
                    return;
                }

                if (trigger.userTargetMode === 'file-map' && trigger.userIdToFileDir && context.userId) {
                    const videoInfo = findUserVideoFile(trigger.userIdToFileDir, context.userId);

                    if (!videoInfo) {
                        return;
                    }

                    const normalizedUserId = normalizeUserIdForFilename(context.userId);
                    const payload = createEffectPlaybackPayload(effectEvent, trigger, sourceEvent);
                    payload.videoUrl = effectEvent.videoEnabled
                        ? `/api/effects/user-video/${encodeURIComponent(trigger.id)}/${encodeURIComponent(normalizedUserId)}`
                        : '';
                    if (!getEffectsGloballyPaused()) {
                        io.emit('effects:playback', payload);
                    }
                } else {
                    emitEffectPlayback(effectEvent, trigger, sourceEvent);
                }
            });
        });

        return anyTriggered;
    }

    function tryRunEffectTriggersForGift(giftEvent) {
        const userId = normalizeBroadcasterId(giftEvent?.uniqueId);
        speculativelyPreloadUserVideos(userId);
        return tryRunEffectTriggers({
            type: 'gift',
            giftName: normalizeEffectText(giftEvent?.giftName, 80).toLowerCase(),
            comment: '',
            totalGifts: normalizeWholeNumber(giftEvent?.totalGifts) ?? 0,
            userId
        }, giftEvent);
    }

    function tryRunEffectTriggersForComment(commentEvent) {
        if (commentEvent?.type !== 'chat' && commentEvent?.type !== 'emote') {
            return;
        }

        const userId = normalizeBroadcasterId(commentEvent?.uniqueId);
        speculativelyPreloadUserVideos(userId);
        tryRunEffectTriggers({
            type: 'comment',
            giftName: '',
            comment: normalizeEffectText(commentEvent?.comment, 160).toLowerCase(),
            totalGifts: 0,
            userId
        }, commentEvent);
    }

    return {
        createEffectPlaybackPayload,
        emitEffectPlayback,
        matchesEffectTrigger,
        speculativelyPreloadUserVideos,
        tryRunEffectTriggers,
        tryRunEffectTriggersForGift,
        tryRunEffectTriggersForComment,
        findUserVideoFile,
        normalizeUserIdForFilename,
        USER_VIDEO_EXTENSIONS,
        USER_VIDEO_MIME_TYPES,
    };
};
