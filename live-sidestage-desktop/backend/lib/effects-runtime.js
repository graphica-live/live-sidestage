'use strict';

const fs = require('fs');
const path = require('path');
const { sendMidiForEffectEvent } = require('./midi-helpers');
const { sendLiveStudioActionForEffectEvent } = require('./livestudio-helpers');

module.exports = function createEffectsRuntime({
    io,
    getEffectEvents,
    getEffectTriggers,
    getEffectCategories,
    getEffectsGloballyPaused,
    normalizeBroadcasterId,
    normalizeEffectText,
    normalizeWholeNumber,
    getTimestamp,
    sendVdjEffectForEvent,
    followTriggerGiftName,
    maybeActivateTriggerX5Window,
    rollTriggerX5,
    emitTriggerX5Win,
    TRIGGER_X5_MULTIPLIER,
    applyTimerWidgetAction,
    buildTimerPayload,
}) {
    // カテゴリ単位のON/OFF。個々のトリガーの enabled 値には一切干渉しない。
    function getDisabledCategoryIds() {
        return new Set(getEffectCategories().filter((category) => category.enabled === false).map((category) => category.id));
    }

    // トリガー5倍の抽選結果・当選演出発火済みフラグ（コンボ×トリガー単位）。コンボは
    // 1回の投げで何度もtickが来るため、tickごとに再抽選すると設定した勝率より実質的な
    // 当選率が跳ね上がり（例: 30%設定でも10tick投げれば累積で約97%当たる）、さらに
    // 当選演出（emitTriggerX5Win）もtickの数だけ重複発火してしまう。同一コンボ・同一
    // トリガーでは最初のtickで出た結果を使い回し、当選演出も1回だけに絞る。
    const triggerX5RollState = new Map();

    function getTriggerX5RollState(trigger, giftComboState) {
        if (!giftComboState?.comboKey) {
            return null;
        }

        const cacheKey = `${giftComboState.comboKey}::${trigger.id}`;
        let state = triggerX5RollState.get(cacheKey);
        if (!state) {
            state = { won: null, emitted: false };
            triggerX5RollState.set(cacheKey, state);
        }
        return state;
    }

    function resolveTriggerX5Win(trigger, giftComboState) {
        const state = getTriggerX5RollState(trigger, giftComboState);
        if (!state) {
            return rollTriggerX5();
        }
        if (state.won === null) {
            state.won = rollTriggerX5();
        }
        return state.won;
    }

    // 非コンボ（stateなし）は呼び出し自体が1回だけなので常に発火してよい。
    function shouldEmitTriggerX5Win(trigger, giftComboState) {
        const state = getTriggerX5RollState(trigger, giftComboState);
        if (!state) {
            return true;
        }
        if (state.emitted) {
            return false;
        }
        state.emitted = true;
        return true;
    }

    // コンボ完結（repeatEnd）時に呼ぶ。呼び忘れてもcomboKeyがTikTok側で使い回されることは
    // ほぼ無いため実害は薄いが、長時間配信でのMapの肥大化を防ぐために掃除する。
    function clearTriggerX5RollCacheForCombo(comboKey) {
        if (!comboKey) return;
        const prefix = `${comboKey}::`;
        for (const key of triggerX5RollState.keys()) {
            if (key.startsWith(prefix)) {
                triggerX5RollState.delete(key);
            }
        }
    }
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

    function resolveTreatGiftComboAsSingle(trigger, effectEvent) {
        return trigger?.treatGiftComboAsSingle !== undefined
            ? trigger.treatGiftComboAsSingle !== false
            : effectEvent?.treatGiftComboAsSingle !== false;
    }

    function createEffectPlaybackPayload(effectEvent, trigger, sourceEvent, playbackCountOverride) {
        const treatGiftComboAsSingle = resolveTreatGiftComboAsSingle(trigger, effectEvent);

        return {
            playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
            eventId: effectEvent.id,
            eventName: effectEvent.name,
            screen: effectEvent.screen,
            videoUrl: effectEvent.videoEnabled ? effectEvent.videoAssetUrl : '',
            audioUrl: effectEvent.audioEnabled ? effectEvent.audioAssetUrl : '',
            mediaVolume: effectEvent.mediaVolume,
            playbackCount: typeof playbackCountOverride === 'number'
                ? Math.max(1, playbackCountOverride)
                : (treatGiftComboAsSingle ? 1 : Math.max(1, Number(sourceEvent?.repeatCount || 1))),
            triggerId: trigger?.id || 'preview-trigger',
            triggerName: trigger?.name || 'Preview',
            rapidFireEnabled: Boolean(trigger?.rapidFireEnabled),
            rapidFireCancelMs: Number(trigger?.rapidFireCancelMs ?? 1500),
            giftName: sourceEvent?.giftName || '',
            comment: sourceEvent?.comment || '',
            totalGifts: sourceEvent?.totalGifts || 0,
            repeatCount: sourceEvent?.repeatCount || 1,
            uniqueId: sourceEvent?.uniqueId || '',
            nickname: sourceEvent?.nickname || '',
            timestamp: getTimestamp()
        };
    }

    // 「待機イベント削除」フラグ付きイベント発火時、そのイベントの再生先 screen で
    // 現在待機中（キュー内）のイベントを削除する。count=0（既定）は全件削除で再生中も中断、
    // count>=1 は待機列の先頭からその件数のみ削除し再生中のイベントは継続する。
    function maybeForceInterruptScreen(effectEvent) {
        if (!effectEvent?.forceInterruptAllEvents) return;
        const count = Math.max(0, Number(effectEvent.forceInterruptCount) || 0);
        io.emit('effects:playback:stop', { screen: effectEvent.screen, count, timestamp: getTimestamp() });
    }

    // オーバーレイ側(effect-overlay-html.js)は payload.playbackId をそのまま使わず、
    // playbackCount回分キューに積む際に `${playbackId}-${index}` へ振り直す。
    // TLS連携のONはバッチ1回目の再生開始（`-0`）に、OFF（自動解除）はバッチ最後の
    // 再生終了（`-${playbackCount - 1}`）に紐付ける必要がある。両方とも `-0` にすると、
    // playbackCount>1（トリガー5倍・コンボ分割再生）時にバッチ1回目が終わった時点で
    // OFFが発火し、残りの再生中はエフェクトが解除されたままになってしまう。
    function overlayPlaybackStartId(payload) {
        return `${payload.playbackId}-0`;
    }

    function overlayPlaybackFinishId(payload) {
        const lastIndex = Math.max(1, Number(payload.playbackCount) || 1) - 1;
        return `${payload.playbackId}-${lastIndex}`;
    }

    // MIDI/LIVE Studio/VDJ/タイマーウィジェットなど、動画・音声再生とは別枠のイベント副作用をまとめて実行する。
    function runEffectEventSideEffects(effectEvent, payload, sourceEvent) {
        sendMidiForEffectEvent(effectEvent);
        sendLiveStudioActionForEffectEvent(effectEvent, overlayPlaybackStartId(payload), overlayPlaybackFinishId(payload));
        sendVdjEffectForEvent(effectEvent);

        if (effectEvent.timerWidgetEnabled) {
            const timerResult = applyTimerWidgetAction(effectEvent, payload.playbackCount);
            if (timerResult) {
                io.emit('widgets:timer:updated', buildTimerPayload());
                io.emit('widgets:timer:adjusted', {
                    minutesDelta: timerResult.deltaMinutes,
                    giftName: sourceEvent?.giftName || '',
                    blocked: timerResult.blocked
                });
            }
        }
    }

    function emitEffectPlayback(effectEvent, trigger, sourceEvent, playbackCountOverride) {
        if (getEffectsGloballyPaused()) return;
        maybeForceInterruptScreen(effectEvent);
        const payload = createEffectPlaybackPayload(effectEvent, trigger, sourceEvent, playbackCountOverride);
        io.emit('effects:playback', payload);
        runEffectEventSideEffects(effectEvent, payload, sourceEvent);
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
        const disabledCategoryIds = getDisabledCategoryIds();
        const fileMapTriggers = getEffectTriggers().filter(
            (item) => item.enabled && item.userTargetMode === 'file-map' && item.userIdToFileDir && item.eventIds.length > 0
                && !disabledCategoryIds.has(item.categoryId)
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

    function tryRunEffectTriggers(context, sourceEvent, giftComboState = null) {
        const effectEvents = getEffectEvents();
        const eventById = new Map(effectEvents.map((item) => [item.id, item]));
        const disabledCategoryIds = getDisabledCategoryIds();
        // 発火順序はカテゴリ一覧の表示順（上から下）を優先し、同一カテゴリ内では
        // 従来どおりトリガーの並び順を維持する（Array.sort は安定ソート）。
        const categoryOrderIndex = new Map(getEffectCategories().map((category, index) => [category.id, index]));
        const triggers = getEffectTriggers()
            .filter((item) => item.enabled && item.eventIds.length > 0 && !disabledCategoryIds.has(item.categoryId))
            .sort((a, b) => {
                const orderA = categoryOrderIndex.has(a.categoryId) ? categoryOrderIndex.get(a.categoryId) : categoryOrderIndex.size;
                const orderB = categoryOrderIndex.has(b.categoryId) ? categoryOrderIndex.get(b.categoryId) : categoryOrderIndex.size;
                return orderA - orderB;
            });
        let anyTriggered = false;

        triggers.forEach((trigger) => {
            if (!matchesEffectTrigger(trigger, context)) {
                return;
            }

            anyTriggered = true;

            // トリガー5倍の対象は「ギフト名を指定したトリガー」がそのギフトに一致した発火のみ。
            // ギフト名未指定のトリガー（コメント/フォロー/無条件トリガーなど）は関係のないギフトでも
            // マッチしてしまうため、5倍抽選の対象からは除外する
            // （＝5倍タイム中に無関係なギフトを投げても5倍表記が出ないようにする）。
            const isEligibleForTriggerX5 = context.type === 'gift' && Boolean(trigger.giftName)
                && !trigger.triggerX5ExcludedFromLottery;

            // トリガー5倍タイム中: このトリガーの発火全体に対して1回だけ抽選する
            // （イベントごとに抽選し直すと、同一トリガー内で当落が割れて分かりにくくなるため）。
            const isTriggerX5Won = isEligibleForTriggerX5 && resolveTriggerX5Win(trigger, giftComboState);
            let anyPlaybackEmitted = false;

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

                // コンボ中呼び出し: 「まとめ投げ=1回」トリガーは初回tickのみ発火、
                // それ以外（分割再生）は今回分の増分（deltaRepeat）だけ発火する。
                let playbackCountOverride;

                if (giftComboState) {
                    const treatSingle = resolveTreatGiftComboAsSingle(trigger, effectEvent);

                    if (treatSingle) {
                        if (!giftComboState.isFirstTick) {
                            return;
                        }

                        playbackCountOverride = 1;
                    } else {
                        if (!(giftComboState.deltaRepeat > 0)) {
                            return;
                        }

                        playbackCountOverride = giftComboState.deltaRepeat;
                    }
                }

                if (isTriggerX5Won) {
                    playbackCountOverride = (typeof playbackCountOverride === 'number' ? playbackCountOverride : 1) * TRIGGER_X5_MULTIPLIER;
                }

                if (trigger.userTargetMode === 'file-map' && trigger.userIdToFileDir && context.userId) {
                    const videoInfo = findUserVideoFile(trigger.userIdToFileDir, context.userId);

                    if (!videoInfo) {
                        return;
                    }

                    const normalizedUserId = normalizeUserIdForFilename(context.userId);
                    const payload = createEffectPlaybackPayload(effectEvent, trigger, sourceEvent, playbackCountOverride);
                    payload.videoUrl = effectEvent.videoEnabled
                        ? `/api/effects/user-video/${encodeURIComponent(trigger.id)}/${encodeURIComponent(normalizedUserId)}`
                        : '';
                    if (!getEffectsGloballyPaused()) {
                        maybeForceInterruptScreen(effectEvent);
                        io.emit('effects:playback', payload);
                        runEffectEventSideEffects(effectEvent, payload, sourceEvent);
                        anyPlaybackEmitted = true;
                    }
                } else if (!getEffectsGloballyPaused()) {
                    emitEffectPlayback(effectEvent, trigger, sourceEvent, playbackCountOverride);
                    anyPlaybackEmitted = true;
                }
            });

            if (isTriggerX5Won && anyPlaybackEmitted && shouldEmitTriggerX5Win(trigger, giftComboState)) {
                emitTriggerX5Win(sourceEvent);
            }
        });

        return anyTriggered;
    }

    function tryRunEffectTriggersForGift(giftEvent) {
        const userId = normalizeBroadcasterId(giftEvent?.uniqueId);
        maybeActivateTriggerX5Window(giftEvent);
        speculativelyPreloadUserVideos(userId);
        return tryRunEffectTriggers({
            type: 'gift',
            giftName: normalizeEffectText(giftEvent?.giftName, 80).toLowerCase(),
            comment: '',
            totalGifts: normalizeWholeNumber(giftEvent?.totalGifts) ?? 0,
            userId
        }, giftEvent);
    }

    // コンボギフト用: isFirstTick=true で早期発火（低遅延、まとめ投げ=1回トリガー向け）、
    // それ以降は deltaRepeat 増分だけを分割再生トリガーに流す。
    function tryRunEffectTriggersForGiftCombo(giftEvent, giftComboState) {
        const userId = normalizeBroadcasterId(giftEvent?.uniqueId);

        if (giftComboState?.isFirstTick) {
            maybeActivateTriggerX5Window(giftEvent);
            speculativelyPreloadUserVideos(userId);
        }

        return tryRunEffectTriggers({
            type: 'gift',
            giftName: normalizeEffectText(giftEvent?.giftName, 80).toLowerCase(),
            comment: '',
            totalGifts: normalizeWholeNumber(giftEvent?.totalGifts) ?? 0,
            userId
        }, giftEvent, giftComboState);
    }

    function tryRunEffectTriggersForComment(commentEvent) {
        const isFollowEvent = commentEvent?.type === 'follow';

        if (!isFollowEvent && commentEvent?.type !== 'chat' && commentEvent?.type !== 'emote') {
            return;
        }

        const userId = normalizeBroadcasterId(commentEvent?.uniqueId);
        speculativelyPreloadUserVideos(userId);

        if (isFollowEvent) {
            tryRunEffectTriggers({
                type: 'follow',
                giftName: normalizeEffectText(followTriggerGiftName, 80).toLowerCase(),
                comment: '',
                totalGifts: 0,
                userId
            }, commentEvent);
            return;
        }

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
        clearTriggerX5RollCacheForCombo,
        tryRunEffectTriggers,
        tryRunEffectTriggersForGift,
        tryRunEffectTriggersForGiftCombo,
        tryRunEffectTriggersForComment,
        findUserVideoFile,
        normalizeUserIdForFilename,
        USER_VIDEO_EXTENSIONS,
        USER_VIDEO_MIME_TYPES,
    };
};
