'use strict';

const {
    normalizeEffectText, normalizeWholeNumber, normalizeBroadcasterId, firstDefinedString,
} = require('./utils');
const {
    COMMENT_SETTINGS_STATE_KEY,
    COMMENT_OBSERVED_EMOTES_STATE_KEY,
    COMMENT_OBSERVED_EMOJIS_STATE_KEY,
    COMMENT_FEED_EVENT_DEFINITIONS,
    COMMENT_READ_ALOUD_EFFECT_SCREEN,
    COMMENT_READ_ALOUD_MAX_AGE_MS,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION,
    LIVE_COMMENT_HISTORY_LIMIT,
    COMMENT_DISPLAY_TTL_MS,
} = require('./constants');
const {
    normalizeCommentReadAloudVoices,
    normalizeCommentFeedType,
    normalizeCommentObservedEmoteCatalog,
    normalizeCommentObservedEmojiCatalog,
    normalizeCommentFeedSettings,
    getCommentFeedTypes,
    normalizeCommentReadAloudEmoteKey,
} = require('./comment-normalizers');

// ── Module-level state ────────────────────────────────────────────────────────
const COMMENT_READ_ALOUD_AUDIO_CACHE_LIMIT = 100;

let commentReadAloudVoiceProvider = async () => [];
let commentReadAloudAudioProvider = null;
const commentReadAloudRandomVoiceAssignments = new Map();
let commentReadAloudVoicevoxRetryAt = 0;
const commentReadAloudAudioCache = new Map();
let commentReadAloudAudioDirectoryReady = false;

let _commentFeedSettingsCache = null;
let _commentFeedSettingsCacheBroadcaster = '__uninitialized__';
let _observedCommentEmoteCatalogCache = null;
let _observedCommentEmoteCatalogCacheBroadcaster = '__uninitialized__';
let _observedCommentEmojiCatalogCache = null;
let _observedCommentEmojiCatalogCacheBroadcaster = '__uninitialized__';

let recentTikTokComments = [];

// ── Injected dependencies ─────────────────────────────────────────────────────
let _io = null;
let _serverEvents = null;
let _getBroadcasterId = null;
let _getScopedStateValue = null;
let _setScopedStateValue = null;
let _getEffectMediaDirectory = null;
let _buildEffectMediaUrl = null;
let _getTimestamp = null;
let _getTodayDayKey = null;
let _path = null;
let _fs = null;

function initCommentFeed({ io, serverEvents, getBroadcasterId, getScopedStateValue, setScopedStateValue, getEffectMediaDirectory, buildEffectMediaUrl, getTimestamp, getTodayDayKey, path, fs }) {
    _io = io;
    _serverEvents = serverEvents;
    _getBroadcasterId = getBroadcasterId;
    _getScopedStateValue = getScopedStateValue;
    _setScopedStateValue = setScopedStateValue;
    _getEffectMediaDirectory = getEffectMediaDirectory;
    _buildEffectMediaUrl = buildEffectMediaUrl;
    _getTimestamp = getTimestamp;
    _getTodayDayKey = getTodayDayKey;
    _path = path;
    _fs = fs;
}

// ── Audio cache ───────────────────────────────────────────────────────────────
function getCommentReadAloudAudioCacheKey(payload) {
    const voice = String(payload?.voiceName || '');
    const volume = Number.isFinite(Number(payload?.volume)) ? Number(payload.volume) : 100;
    const speed = Number.isFinite(Number(payload?.speed)) ? Number(payload.speed) : 1.0;
    const text = String(payload?.text || '');
    if (!voice || !text) {
        return '';
    }
    return `${voice}|${volume}|${speed}|${text}`;
}

function getCommentReadAloudAudioCacheEntry(key) {
    if (!key) return null;
    const entry = commentReadAloudAudioCache.get(key);
    if (!entry) return null;
    commentReadAloudAudioCache.delete(key);
    commentReadAloudAudioCache.set(key, entry);
    return entry;
}

function setCommentReadAloudAudioCacheEntry(key, asset) {
    if (!key || !asset?.url) return;
    if (commentReadAloudAudioCache.size >= COMMENT_READ_ALOUD_AUDIO_CACHE_LIMIT) {
        const oldestKey = commentReadAloudAudioCache.keys().next().value;
        if (oldestKey !== undefined) {
            commentReadAloudAudioCache.delete(oldestKey);
        }
    }
    commentReadAloudAudioCache.set(key, { url: asset.url, mimeType: asset.mimeType });
}

// ── Provider setters ─────────────────────────────────────────────────────────
function setCommentReadAloudVoiceProvider(provider) {
    if (typeof provider === 'function') {
        commentReadAloudVoiceProvider = provider;
        return;
    }

    commentReadAloudVoiceProvider = async () => [];
}

function setCommentReadAloudAudioProvider(provider) {
    commentReadAloudAudioProvider = typeof provider === 'function' ? provider : null;
}

function callCommentReadAloudVoiceProvider(...args) {
    return commentReadAloudVoiceProvider(...args);
}

function clearCommentReadAloudRandomVoiceAssignments() {
    const clearedCount = commentReadAloudRandomVoiceAssignments.size;
    commentReadAloudRandomVoiceAssignments.clear();
    return clearedCount;
}

// ── Settings & catalog cache ─────────────────────────────────────────────────
function invalidateCommentFeedCaches() {
    _commentFeedSettingsCache = null;
    _commentFeedSettingsCacheBroadcaster = '__uninitialized__';
    _observedCommentEmoteCatalogCache = null;
    _observedCommentEmoteCatalogCacheBroadcaster = '__uninitialized__';
    _observedCommentEmojiCatalogCache = null;
    _observedCommentEmojiCatalogCacheBroadcaster = '__uninitialized__';
}

function getCommentFeedSettings() {
    const broadcasterCacheKey = String(_getBroadcasterId() || '');
    if (_commentFeedSettingsCache && _commentFeedSettingsCacheBroadcaster === broadcasterCacheKey) {
        return _commentFeedSettingsCache;
    }

    const storedValue = _getScopedStateValue(COMMENT_SETTINGS_STATE_KEY);
    const normalizedSettings = normalizeCommentFeedSettings(storedValue);

    let source = storedValue;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    const storedReadAloudDefaultsVersion = Math.max(0, normalizeWholeNumber(source?.readAloudDefaultsVersion, 0));

    if (storedReadAloudDefaultsVersion < COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION) {
        _setScopedStateValue(COMMENT_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    }

    _commentFeedSettingsCache = normalizedSettings;
    _commentFeedSettingsCacheBroadcaster = broadcasterCacheKey;
    return normalizedSettings;
}

function setCommentFeedSettings(settings) {
    const normalizedSettings = normalizeCommentFeedSettings(settings);
    _setScopedStateValue(COMMENT_SETTINGS_STATE_KEY, JSON.stringify(normalizedSettings));
    _commentFeedSettingsCache = normalizedSettings;
    _commentFeedSettingsCacheBroadcaster = String(_getBroadcasterId() || '');
    return normalizedSettings;
}

function getObservedCommentEmoteCatalog() {
    const broadcasterCacheKey = String(_getBroadcasterId() || '');
    if (_observedCommentEmoteCatalogCache && _observedCommentEmoteCatalogCacheBroadcaster === broadcasterCacheKey) {
        return _observedCommentEmoteCatalogCache;
    }

    const normalized = normalizeCommentObservedEmoteCatalog(_getScopedStateValue(COMMENT_OBSERVED_EMOTES_STATE_KEY));
    _observedCommentEmoteCatalogCache = normalized;
    _observedCommentEmoteCatalogCacheBroadcaster = broadcasterCacheKey;
    return normalized;
}

function setObservedCommentEmoteCatalog(catalog) {
    const normalizedCatalog = normalizeCommentObservedEmoteCatalog(catalog);
    _setScopedStateValue(COMMENT_OBSERVED_EMOTES_STATE_KEY, JSON.stringify(normalizedCatalog));
    _observedCommentEmoteCatalogCache = normalizedCatalog;
    _observedCommentEmoteCatalogCacheBroadcaster = String(_getBroadcasterId() || '');
    return normalizedCatalog;
}

function getObservedCommentEmojiCatalog() {
    const broadcasterCacheKey = String(_getBroadcasterId() || '');
    if (_observedCommentEmojiCatalogCache && _observedCommentEmojiCatalogCacheBroadcaster === broadcasterCacheKey) {
        return _observedCommentEmojiCatalogCache;
    }

    const normalized = normalizeCommentObservedEmojiCatalog(_getScopedStateValue(COMMENT_OBSERVED_EMOJIS_STATE_KEY));
    _observedCommentEmojiCatalogCache = normalized;
    _observedCommentEmojiCatalogCacheBroadcaster = broadcasterCacheKey;
    return normalized;
}

function setObservedCommentEmojiCatalog(catalog) {
    const normalizedCatalog = normalizeCommentObservedEmojiCatalog(catalog);
    _setScopedStateValue(COMMENT_OBSERVED_EMOJIS_STATE_KEY, JSON.stringify(normalizedCatalog));
    _observedCommentEmojiCatalogCache = normalizedCatalog;
    _observedCommentEmojiCatalogCacheBroadcaster = String(_getBroadcasterId() || '');
    return normalizedCatalog;
}

// ── Read-aloud text processing ────────────────────────────────────────────────
function stripCommentReadAloudEmoji(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}‍︎️]/gu, ' ')
        .replace(/[0-9#*]⃣/gu, ' ')
        .replace(/[ヽノﾉ]?[（(][^（(）)\n]{0,40}[ωдДΩ▽△∀εσοﾟ][^（(）)\n]{0,40}[）)][ヽノﾉ]?/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function applyCommentReadAloudEmojiReplacements(value, replacements) {
    if (typeof value !== 'string' || !Array.isArray(replacements) || !replacements.length) {
        return typeof value === 'string' ? value : '';
    }

    return replacements.reduce((result, item) => {
        const emoji = typeof item?.emoji === 'string' ? item.emoji : '';
        const text = typeof item?.text === 'string' ? item.text : '';

        if (!emoji || !text || !result.includes(emoji)) {
            return result;
        }

        const firstIdx = result.indexOf(emoji);
        const withFirst = result.slice(0, firstIdx) + ` ${text} ` + result.slice(firstIdx + emoji.length);
        return withFirst.split(emoji).join(' ');
    }, value);
}

function applyCommentReadAloudTextReplacements(value, replacements) {
    if (typeof value !== 'string' || !Array.isArray(replacements) || !replacements.length) {
        return typeof value === 'string' ? value : '';
    }

    return replacements.reduce((result, item) => {
        const from = typeof item?.from === 'string' ? item.from : '';
        const to = typeof item?.to === 'string' ? item.to : '';

        if (!from || !to || !result.includes(from)) {
            return result;
        }

        return result.split(from).join(to);
    }, value);
}

function applyCommentReadAloudEmoteReplacements(value, replacements) {
    if (typeof value !== 'string') {
        return '';
    }

    const replacementMap = new Map(
        (Array.isArray(replacements) ? replacements : [])
            .map((item) => {
                const emoteId = normalizeCommentReadAloudEmoteKey(item?.emoteId ?? item?.emote);
                const text = normalizeEffectText(item?.text, 120);
                return emoteId && text ? [emoteId, text] : null;
            })
            .filter(Boolean)
    );

    const seenEmoteIds = new Set();

    return value.replace(/\[emote:([^\]]+)\]/gu, (match, rawEmoteId) => {
        const emoteId = normalizeCommentReadAloudEmoteKey(rawEmoteId);
        const replacement = emoteId ? replacementMap.get(emoteId) : '';
        if (replacement && !seenEmoteIds.has(emoteId)) {
            seenEmoteIds.add(emoteId);
            return ` ${replacement} `;
        }
        return ' ';
    });
}

function buildCommentReadAloudText(commentEvent, settings = getCommentFeedSettings()) {
    const replacedComment = applyCommentReadAloudEmojiReplacements(commentEvent?.comment, settings?.readAloudEmojiReplacements);
    const replacedEmoteComment = applyCommentReadAloudEmoteReplacements(replacedComment, settings?.readAloudEmoteReplacements);
    const replacedTextComment = applyCommentReadAloudTextReplacements(replacedEmoteComment, settings?.readAloudTextReplacements);
    const message = normalizeEffectText(stripCommentReadAloudEmoji(replacedTextComment), 240);

    if (!message) {
        return '';
    }

    return message;
}

function createCommentReadAloudPayload(commentEvent) {
    const settings = getCommentFeedSettings();
    const normalizedUniqueId = normalizeBroadcasterId(commentEvent?.uniqueId) || '';
    const mappedVoiceName = (Array.isArray(settings.readAloudVoiceMappings) ? settings.readAloudVoiceMappings : [])
        .find((item) => item.uniqueId === normalizedUniqueId)?.voiceName || '';

    return {
        playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        screen: COMMENT_READ_ALOUD_EFFECT_SCREEN,
        text: buildCommentReadAloudText(commentEvent, settings),
        type: commentEvent?.type || 'chat',
        uniqueId: normalizedUniqueId || commentEvent?.uniqueId || '',
        nickname: commentEvent?.nickname || '',
        voiceName: mappedVoiceName || settings.readAloudVoiceName || '',
        volume: settings.readAloudVolume,
        speed: settings.readAloudSpeed ?? 1.0,
        timestamp: _getTimestamp()
    };
}

async function resolveCommentReadAloudVoiceName(payload, settings = getCommentFeedSettings()) {
    const normalizedUniqueId = normalizeBroadcasterId(payload?.uniqueId) || '';
    const voiceMappings = Array.isArray(settings?.readAloudVoiceMappings) ? settings.readAloudVoiceMappings : [];
    const mappedVoiceName = voiceMappings.find((item) => item.uniqueId === normalizedUniqueId)?.voiceName || '';
    const forcedVoiceName = payload?.forceVoiceName && typeof payload?.voiceName === 'string'
        ? normalizeEffectText(payload.voiceName, 160)
        : '';

    if (mappedVoiceName) {
        return mappedVoiceName;
    }

    if (forcedVoiceName) {
        return forcedVoiceName;
    }

    if (settings?.readAloudRandomVoiceEnabled) {
        try {
            const cachedVoiceName = normalizedUniqueId ? commentReadAloudRandomVoiceAssignments.get(normalizedUniqueId) : '';

            if (cachedVoiceName) {
                return cachedVoiceName;
            }

            let voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider())).filter((v) => v.provider === 'voicevox');

            if (!voices.length && Date.now() >= commentReadAloudVoicevoxRetryAt) {
                commentReadAloudVoicevoxRetryAt = Date.now() + 15000;
                console.log('[read-aloud] VOICEVOXボイスが未検出。自動連携を試みます…');
                voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider({ forceRefresh: true }))).filter((v) => v.provider === 'voicevox');
                if (voices.length) {
                    console.log(`[read-aloud] VOICEVOX自動連携に成功しました。${voices.length}件のボイスを取得。`);
                }
            }

            if (voices.length) {
                const index = Math.floor(Math.random() * voices.length);
                const nextVoiceName = voices[index]?.value || voices[index]?.name || settings?.readAloudVoiceName || '';

                if (normalizedUniqueId && nextVoiceName) {
                    commentReadAloudRandomVoiceAssignments.set(normalizedUniqueId, nextVoiceName);
                }

                return nextVoiceName;
            }

            return null;
        } catch (error) {
            console.error('❌ Failed to resolve random read aloud voice:', error);
            return null;
        }
    }

    return settings?.readAloudVoiceName || payload?.voiceName || '';
}

function createCommentReadAloudPlaybackPayload(payload, audioUrl) {
    return {
        playbackId: payload.playbackId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        eventId: 'comment-read-aloud',
        eventName: 'Comment Read Aloud',
        screen: payload.screen || COMMENT_READ_ALOUD_EFFECT_SCREEN,
        videoUrl: '',
        audioUrl,
        mediaVolume: Math.max(0, Math.min(100, Number(payload.volume ?? 100))),
        playbackCount: 1,
        triggerId: 'comment-read-aloud',
        triggerName: 'Comment Read Aloud',
        giftName: '',
        uniqueId: payload.uniqueId || '',
        nickname: payload.nickname || '',
        readAloudCreditText: normalizeEffectText(payload.readAloudCreditText, 160),
        timestamp: payload.timestamp || _getTimestamp()
    };
}

async function resolveCommentReadAloudVoiceCreditText(voiceName, settings = getCommentFeedSettings()) {
    const normalizedVoiceName = normalizeEffectText(voiceName, 200);

    if (!normalizedVoiceName.startsWith('voicevox:')) {
        return '';
    }

    try {
        const voices = normalizeCommentReadAloudVoices(await Promise.resolve(commentReadAloudVoiceProvider()));
        const matchedVoice = voices.find((voice) => voice.value === normalizedVoiceName || voice.name === normalizedVoiceName);
        const creditName = normalizeEffectText(matchedVoice?.name, 160);
        return creditName ? `VOICEVOX:${creditName}` : '';
    } catch (error) {
        console.error('❌ Failed to resolve VOICEVOX credit text:', error);
        return '';
    }
}

async function emitCommentReadAloudToScreen(payload) {
    const settings = getCommentFeedSettings();
    const resolvedVoiceName = await resolveCommentReadAloudVoiceName(payload, settings);

    if (resolvedVoiceName === null) {
        _io.emit('screen1:voicevox-warning', { screen: COMMENT_READ_ALOUD_EFFECT_SCREEN });
        return;
    }

    const effectivePayload = {
        ...payload,
        voiceName: resolvedVoiceName,
        readAloudCreditText: await resolveCommentReadAloudVoiceCreditText(resolvedVoiceName, settings),
        volume: Math.max(0, Math.min(100, Number(payload?.volume ?? settings?.readAloudVolume ?? 100) || 0)),
        speed: Math.max(0.5, Math.min(2.0, Number(payload?.speed ?? settings?.readAloudSpeed ?? 1.0) || 1.0))
    };

    const useDeviceOutput = settings.readAloudAudioOutput === 'device';

    if (commentReadAloudAudioProvider) {
        try {
            const cacheKey = getCommentReadAloudAudioCacheKey(effectivePayload);
            const cachedEntry = cacheKey ? getCommentReadAloudAudioCacheEntry(cacheKey) : null;

            if (cachedEntry?.url) {
                if (useDeviceOutput) {
                    _io.emit('effects:read-aloud:device', { ...effectivePayload, audioUrl: cachedEntry.url });
                } else {
                    _io.emit('effects:playback', createCommentReadAloudPlaybackPayload(effectivePayload, cachedEntry.url));
                }
                return;
            }

            const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.wav`;
            const directory = _getEffectMediaDirectory('audio');
            const filePath = _path.join(directory, fileName);
            if (!commentReadAloudAudioDirectoryReady) {
                await _fs.promises.mkdir(directory, { recursive: true });
                commentReadAloudAudioDirectoryReady = true;
            }
            const asset = await commentReadAloudAudioProvider(effectivePayload, {
                fileName,
                filePath,
                url: _buildEffectMediaUrl('audio', fileName)
            });

            if (asset?.url) {
                if (cacheKey) {
                    setCommentReadAloudAudioCacheEntry(cacheKey, asset);
                }
                if (useDeviceOutput) {
                    _io.emit('effects:read-aloud:device', { ...effectivePayload, audioUrl: asset.url });
                } else {
                    _io.emit('effects:playback', createCommentReadAloudPlaybackPayload(effectivePayload, asset.url));
                }
                return;
            }
        } catch (error) {
            console.error('❌ Failed to generate comment read aloud audio:', error);

            if (settings?.readAloudRandomVoiceEnabled) {
                _io.emit('screen1:voicevox-warning', { screen: COMMENT_READ_ALOUD_EFFECT_SCREEN });
                return;
            }
        }
    }

    if (useDeviceOutput) {
        _io.emit('effects:read-aloud:device', { ...effectivePayload, audioUrl: null });
    } else {
        _io.emit('effects:tts', effectivePayload);
    }
}

function normalizeCommentEventSourceTimestamp(value) {
    const normalized = normalizeWholeNumber(value);

    if (normalized === null || normalized === 0) {
        return null;
    }

    if (normalized < 100000000000) {
        return normalized * 1000;
    }

    return normalized;
}

function isCommentReadAloudBlockedByFilter(commentEvent, settings = getCommentFeedSettings()) {
    const filters = Array.isArray(settings?.readAloudFilters) ? settings.readAloudFilters : [];

    if (!filters.length) {
        return false;
    }

    const comment = typeof commentEvent?.comment === 'string'
        ? commentEvent.comment.toLocaleLowerCase('ja-JP')
        : '';

    if (!comment) {
        return false;
    }

    return filters.some((filter) => comment.includes(String(filter).toLocaleLowerCase('ja-JP')));
}

function isCommentReadAloudEligible(commentEvent, settings = getCommentFeedSettings()) {
    if (!settings.readAloudEnabled) {
        return false;
    }

    if (!settings.readAloudEnabledTypes.includes(commentEvent?.type)) {
        return false;
    }

    if (isCommentReadAloudBlockedByFilter(commentEvent, settings)) {
        return false;
    }

    const receivedAt = normalizeWholeNumber(commentEvent?.receivedAt);
    const sourceTimestamp = normalizeCommentEventSourceTimestamp(commentEvent?.sourceTimestamp);

    if (receivedAt === null) {
        return false;
    }

    if (sourceTimestamp === null) {
        return true;
    }

    return receivedAt - sourceTimestamp <= COMMENT_READ_ALOUD_MAX_AGE_MS;
}

function emitCommentReadAloud(commentEvent) {
    const settings = getCommentFeedSettings();

    if (!isCommentReadAloudEligible(commentEvent, settings)) {
        return;
    }

    const payload = createCommentReadAloudPayload(commentEvent);

    if (!payload.text) {
        return;
    }

    _serverEvents.emit('comment-read-aloud', payload);
    void emitCommentReadAloudToScreen(payload);
}

function stopCommentReadAloud() {
    const payload = {
        screen: COMMENT_READ_ALOUD_EFFECT_SCREEN,
        timestamp: _getTimestamp()
    };

    _io.emit('effects:playback:stop', {
        ...payload,
        eventId: 'comment-read-aloud'
    });
    _io.emit('effects:tts:stop', payload);
    _serverEvents.emit('comment-read-aloud-stop', payload);
    return payload;
}

function emitCommentReadAloudTest(overrides = null) {
    const settings = getCommentFeedSettings();
    const source = overrides && typeof overrides === 'object' ? overrides : null;
    const voiceName = typeof source?.voiceName === 'string'
        ? normalizeEffectText(source.voiceName, 160)
        : '';
    const text = typeof source?.text === 'string'
        ? normalizeEffectText(source.text, 240)
        : '';
    const volume = Number.isFinite(Number(source?.volume))
        ? Math.max(0, Math.min(100, Number(source.volume)))
        : settings.readAloudVolume;
    const speed = Number.isFinite(Number(source?.speed))
        ? Math.max(0.5, Math.min(2.0, Number(source.speed)))
        : (settings.readAloudSpeed ?? 1.0);
    const payload = {
        playbackId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        screen: COMMENT_READ_ALOUD_EFFECT_SCREEN,
        text: text || 'コメント読み上げテストです。screen1 で音声が聞こえれば設定は正常です。',
        type: 'system',
        uniqueId: '',
        nickname: 'TikEffect',
        voiceName: voiceName || settings.readAloudVoiceName || '',
        forceVoiceName: Boolean(voiceName),
        volume,
        speed,
        timestamp: _getTimestamp()
    };

    _serverEvents.emit('comment-read-aloud', payload);
    void emitCommentReadAloudToScreen(payload);
    return payload;
}

// ── Comment feed message building ─────────────────────────────────────────────
function getCommentFeedTypeMeta(type) {
    return COMMENT_FEED_EVENT_DEFINITIONS.find((item) => item.type === type)
        || COMMENT_FEED_EVENT_DEFINITIONS[0];
}

function buildCommentFeedEmoteToken(emote) {
    const emoteId = firstDefinedString([
        emote?.emoteId,
        emote?.emote?.emoteId
    ]);

    if (emoteId) {
        return `[emote:${emoteId}]`;
    }

    return '[emote]';
}

function getCommentFeedEmoteId(emote) {
    return firstDefinedString([
        emote?.emoteId,
        emote?.emote?.emoteId
    ]);
}

function getCommentFeedEmoteImageUrl(emote) {
    return firstDefinedString([
        emote?.emoteImageUrl,
        emote?.image?.imageUrl,
        emote?.emote?.image?.imageUrl,
        emote?.image?.url?.[0],
        emote?.image?.urlList?.[0],
        emote?.emote?.image?.url?.[0],
        emote?.emote?.image?.urlList?.[0]
    ]);
}

function buildCommentFeedEmoteItems(data) {
    const emoteSource = Array.isArray(data?.emotes)
        ? data.emotes
        : (Array.isArray(data?.emoteList) ? data.emoteList : []);

    return emoteSource
        .map((item) => {
            const emoteId = getCommentFeedEmoteId(item);
            const imageUrl = getCommentFeedEmoteImageUrl(item);

            if (!emoteId || !imageUrl) {
                return null;
            }

            return {
                emoteId,
                imageUrl,
                placeInComment: normalizeWholeNumber(item?.placeInComment) ?? null
            };
        })
        .filter(Boolean);
}

function extractObservedEmojiEntries(comment) {
    const source = typeof comment === 'string'
        ? comment.replace(/\[emote:[^\]]+\]/gu, ' ')
        : '';

    if (!source) {
        return [];
    }

    const segmenter = typeof Intl?.Segmenter === 'function'
        ? new Intl.Segmenter('ja', { granularity: 'grapheme' })
        : null;
    const graphemes = segmenter
        ? [...segmenter.segment(source)].map((item) => item.segment)
        : Array.from(source);

    return graphemes
        .filter((item) => /[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]️?⃣/gu.test(item))
        .map((emoji) => ({ emoji, observedAt: Date.now() }));
}

function updateObservedCommentAssetCaches(commentEvent) {
    if (!commentEvent || typeof commentEvent !== 'object') {
        return;
    }

    const observedAt = Date.now();
    const nextEmotes = normalizeCommentObservedEmoteCatalog([
        ...(Array.isArray(commentEvent.emotes)
            ? commentEvent.emotes.map((item) => ({
                emoteId: item?.emoteId,
                imageUrl: item?.imageUrl,
                observedAt
            }))
            : []),
        ...getObservedCommentEmoteCatalog()
    ]);
    const nextEmojis = normalizeCommentObservedEmojiCatalog([
        ...extractObservedEmojiEntries(commentEvent.comment).map((item) => ({
            emoji: item.emoji,
            observedAt
        })),
        ...getObservedCommentEmojiCatalog()
    ]);

    setObservedCommentEmoteCatalog(nextEmotes);
    setObservedCommentEmojiCatalog(nextEmojis);
}

function buildCommentFeedTextWithInlineEmotes(comment, emotes) {
    const baseComment = typeof comment === 'string' ? comment : '';
    const normalizedEmotes = Array.isArray(emotes)
        ? emotes
            .map((item) => ({
                placeInComment: normalizeWholeNumber(item?.placeInComment) ?? null,
                token: buildCommentFeedEmoteToken(item)
            }))
            .filter((item) => item.token)
        : [];

    if (!normalizedEmotes.length) {
        return baseComment.trim();
    }

    const inlineEmotes = normalizedEmotes
        .filter((item) => item.placeInComment !== null)
        .sort((left, right) => left.placeInComment - right.placeInComment);
    const trailingEmotes = normalizedEmotes
        .filter((item) => item.placeInComment === null)
        .map((item) => item.token);

    let cursor = 0;
    let result = '';

    inlineEmotes.forEach((item) => {
        const safeIndex = Math.max(0, Math.min(baseComment.length, item.placeInComment));

        result += baseComment.slice(cursor, safeIndex);
        result += item.token;
        cursor = safeIndex;
    });

    result += baseComment.slice(cursor);

    if (trailingEmotes.length) {
        result += `${result ? ' ' : ''}${trailingEmotes.join(' ')}`;
    }

    return result.trim();
}

function buildCommentFeedEmoteText(data) {
    const inlineCommentText = buildCommentFeedTextWithInlineEmotes(data?.comment, data?.emotes);

    if (inlineCommentText) {
        return inlineCommentText;
    }

    const emoteList = Array.isArray(data?.emoteList)
        ? data.emoteList
        : (Array.isArray(data?.emotes) ? data.emotes : []);
    const tokens = emoteList
        .map((item) => buildCommentFeedEmoteToken(item))
        .filter(Boolean);

    return tokens.join(' ').trim();
}

function getCommentFeedDisplayText(data) {
    const emoteText = buildCommentFeedEmoteText(data);

    const directText = firstDefinedString([
        emoteText,
        data?.questionText,
        data?.content,
        data?.text,
        data?.description,
        data?.title,
        data?.common?.displayText?.defaultPattern,
        data?.common?.displayText?.key
    ]);

    if (directText) {
        return directText;
    }

    const pieces = Array.isArray(data?.common?.displayText?.pieces)
        ? data.common.displayText.pieces
        : [];

    return pieces
        .map((piece) => firstDefinedString([
            piece?.stringValue,
            piece?.text,
            piece?.userValue?.nickname,
            piece?.userValue?.uniqueId,
            piece?.userValue?.unique_id
        ]))
        .filter(Boolean)
        .join(' ')
        .trim();
}

function extractCommentFeedActor(data) {
    const uniqueId = normalizeBroadcasterId(firstDefinedString([
        data?.uniqueId,
        data?.user?.uniqueId,
        data?.user?.unique_id,
        data?.fromUser?.uniqueId,
        data?.fromUser?.unique_id
    ]));
    const nickname = firstDefinedString([
        data?.nickname,
        data?.user?.nickname,
        data?.fromUser?.nickname,
        uniqueId,
        'システム'
    ]) || 'システム';
    const image = firstDefinedString([
        data?.profilePictureUrl,
        data?.user?.profilePictureUrl,
        data?.fromUser?.profilePictureUrl,
        Array.isArray(data?.user?.profilePicture?.url) ? data.user.profilePicture.url[0] : '',
        data?.user?.profilePicture?.mUri,
        Array.isArray(data?.fromUser?.profilePicture?.url) ? data.fromUser.profilePicture.url[0] : '',
        Array.isArray(data?.avatarThumb?.urlList) ? data.avatarThumb.urlList[0] : '',
        Array.isArray(data?.avatarThumb?.url) ? data.avatarThumb.url[0] : ''
    ]) || '';

    return {
        uniqueId: uniqueId || '',
        nickname,
        image
    };
}

function buildCommentFeedMessage(type, data, actor) {
    const displayName = actor.nickname || actor.uniqueId || 'システム';
    const displayText = getCommentFeedDisplayText(data);
    const viewerCount = normalizeWholeNumber(data?.viewerCount);
    const likeCount = normalizeWholeNumber(data?.likeCount);
    const totalLikeCount = normalizeWholeNumber(data?.totalLikeCount);
    const displayType = normalizeEffectText(data?.common?.displayText?.displayType, 80).toLowerCase();

    switch (type) {
        case 'chat':
            return displayText;
        case 'member':
            return `${displayName} が入室しました。`;
        case 'like':
            if (likeCount && totalLikeCount) {
                return `${displayName} が ${likeCount} 件のいいねを送りました。合計 ${totalLikeCount} 件です。`;
            }

            if (likeCount) {
                return `${displayName} が ${likeCount} 件のいいねを送りました。`;
            }

            return `${displayName} がいいねを送りました。`;
        case 'social':
            if (displayType.includes('follow') || displayType.includes('share')) {
                return '';
            }

            return displayText || `${displayName} のソーシャル通知です。`;
        case 'follow':
            return `${displayName} がフォローしました。`;
        case 'share':
            return `${displayName} が配信をシェアしました。`;
        case 'questionNew':
            return displayText ? `${displayName} の質問: ${displayText}` : `${displayName} が質問しました。`;
        case 'roomUser':
            return viewerCount ? `視聴者数が ${viewerCount} 人になりました。` : (displayText || '視聴者数が更新されました。');
        case 'subscribe':
            return `${displayName} がサブスクライブしました。`;
        case 'emote':
            return displayText ? `${displayName} がエモートを送信しました: ${displayText}` : `${displayName} がエモートを送信しました。`;
        case 'envelope':
            return `${displayName} が宝箱を送信しました。`;
        case 'liveIntro':
            return displayText || 'ライブ紹介メッセージを受信しました。';
        case 'streamEnd':
            return '配信が終了しました。';
        case 'goalUpdate':
            return displayText || '配信ゴールが更新されました。';
        case 'roomMessage':
            return displayText || 'ルームメッセージを受信しました。';
        case 'imDelete':
            return displayText || `${displayName} のメッセージが削除されました。`;
        case 'unauthorizedMember':
            return displayText || `${displayName} の制限対象アクションを検知しました。`;
        case 'inRoomBanner':
            return displayText || 'ルームバナーを受信しました。';
        case 'rankUpdate':
            return displayText || 'ランキングが更新されました。';
        case 'pollMessage':
            return displayText || '投票メッセージを受信しました。';
        case 'rankText':
            return displayText || 'ランキング表示を受信しました。';
        case 'oecLiveShopping':
            return displayText || 'ライブショッピング通知を受信しました。';
        case 'msgDetect':
            return displayText || 'システムメッセージ検知通知を受信しました。';
        case 'linkMessage':
            return displayText || 'リンクメッセージを受信しました。';
        case 'roomVerify':
            return displayText || 'ルーム認証通知を受信しました。';
        case 'linkLayer':
            return displayText || 'リンクレイヤー更新を受信しました。';
        case 'roomPin':
            return displayText || '固定メッセージを受信しました。';
        default:
            return displayText || `${getCommentFeedTypeMeta(type).label} を受信しました。`;
    }
}

// ── Comment event normalization & admin feed ──────────────────────────────────
function normalizeTikTokCommentEvent(type, data) {
    const normalizedType = normalizeCommentFeedType(type);
    const actor = extractCommentFeedActor(data);
    const comment = buildCommentFeedMessage(normalizedType, data, actor);
    const receivedAt = Date.now();
    const sourceTimestamp = normalizeCommentEventSourceTimestamp(data?.createTime);

    if (!comment) {
        return null;
    }

    const typeMeta = getCommentFeedTypeMeta(normalizedType);

    return {
        id: [
            _getBroadcasterId() || 'broadcaster:none',
            normalizedType,
            data?.msgId || data?.eventId || actor.uniqueId || typeMeta.label,
            data?.createTime || Date.now()
        ].join(':'),
        type: normalizedType,
        typeLabel: typeMeta.label,
        system: typeMeta.system,
        uniqueId: actor.uniqueId,
        nickname: actor.nickname,
        comment,
        emotes: buildCommentFeedEmoteItems(data),
        image: actor.image,
        timestamp: _getTimestamp(),
        receivedAt,
        sourceTimestamp,
        dayKey: _getTodayDayKey()
    };
}

function getRecentTikTokComments() {
    if (!Number.isFinite(COMMENT_DISPLAY_TTL_MS) || COMMENT_DISPLAY_TTL_MS <= 0) {
        return recentTikTokComments;
    }

    const now = Date.now();

    recentTikTokComments = recentTikTokComments.filter((commentEvent) => {
        const receivedAt = Number(commentEvent?.receivedAt);

        if (!Number.isFinite(receivedAt) || receivedAt <= 0) {
            return true;
        }

        return now - receivedAt < COMMENT_DISPLAY_TTL_MS;
    });

    return recentTikTokComments;
}

function clearRecentTikTokComments() {
    recentTikTokComments = [];
}

function createAdminCommentsPayload() {
    return {
        broadcasterId: _getBroadcasterId(),
        comments: getRecentTikTokComments(),
        settings: getCommentFeedSettings(),
        observedEmotes: getObservedCommentEmoteCatalog(),
        observedEmojis: getObservedCommentEmojiCatalog(),
        commentTypes: getCommentFeedTypes(),
        updatedAt: _getTimestamp()
    };
}

function emitAdminCommentsUpdate() {
    _io.emit('admin_comments_updated', createAdminCommentsPayload());
}

function pushTikTokComment(commentEvent) {
    const activeComments = getRecentTikTokComments();
    recentTikTokComments = [commentEvent, ...activeComments].slice(0, LIVE_COMMENT_HISTORY_LIMIT);
    updateObservedCommentAssetCaches(commentEvent);
    emitAdminCommentAppended(commentEvent);
    emitCommentReadAloud(commentEvent);
    // 別窓（コメント欄）は type === 'chat' のイベントしか表示しないため、
    // それ以外（入室・いいね・視聴者数など）の受信では最前面化しない。
    if (commentEvent?.type === 'chat') {
        _serverEvents.emit('popout-front-requested', 'comments');
    }
}

function emitAdminCommentAppended(commentEvent) {
    if (!commentEvent) {
        return;
    }
    _io.emit('admin_comments_appended', {
        broadcasterId: _getBroadcasterId(),
        comment: commentEvent,
        updatedAt: _getTimestamp()
    });
}

module.exports = {
    initCommentFeed,
    // provider setters / callers
    setCommentReadAloudVoiceProvider,
    setCommentReadAloudAudioProvider,
    callCommentReadAloudVoiceProvider,
    clearCommentReadAloudRandomVoiceAssignments,
    // cache
    invalidateCommentFeedCaches,
    // settings & catalogs
    getCommentFeedSettings,
    setCommentFeedSettings,
    getObservedCommentEmoteCatalog,
    setObservedCommentEmoteCatalog,
    getObservedCommentEmojiCatalog,
    setObservedCommentEmojiCatalog,
    // read-aloud
    buildCommentReadAloudText,
    createCommentReadAloudPayload,
    createCommentReadAloudPlaybackPayload,
    emitCommentReadAloud,
    stopCommentReadAloud,
    emitCommentReadAloudTest,
    // feed building
    getCommentFeedTypeMeta,
    buildCommentFeedEmoteToken,
    getCommentFeedEmoteId,
    getCommentFeedEmoteImageUrl,
    buildCommentFeedEmoteItems,
    buildCommentFeedTextWithInlineEmotes,
    buildCommentFeedEmoteText,
    getCommentFeedDisplayText,
    extractCommentFeedActor,
    buildCommentFeedMessage,
    updateObservedCommentAssetCaches,
    // event normalization & admin
    normalizeTikTokCommentEvent,
    getRecentTikTokComments,
    clearRecentTikTokComments,
    createAdminCommentsPayload,
    emitAdminCommentsUpdate,
    pushTikTokComment,
    emitAdminCommentAppended,
};
