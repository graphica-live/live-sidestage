'use strict';

const { normalizeEffectText, normalizeWholeNumber, normalizeBroadcasterId } = require('./utils');
const {
    COMMENT_FEED_EVENT_DEFINITIONS,
    COMMENT_OBSERVED_EMOTE_CACHE_LIMIT,
    COMMENT_OBSERVED_EMOJI_CACHE_LIMIT,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS,
    COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION,
} = require('./constants');

function createDefaultCommentFeedSettings() {
    return {
        sortOrder: 'desc',
        enabledTypes: COMMENT_FEED_EVENT_DEFINITIONS.map((item) => item.type),
        readAloudEnabledTypes: COMMENT_FEED_EVENT_DEFINITIONS.map((item) => item.type),
        readAloudEnabled: false,
        readAloudVoiceName: '',
        readAloudVoiceCreditEnabled: true,
        readAloudRandomVoiceEnabled: false,
        readAloudVolume: 100,
        readAloudSpeed: 1.0,
        readAloudFilters: [...COMMENT_READ_ALOUD_DEFAULT_FILTERS],
        readAloudTextReplacements: [],
        readAloudEmojiReplacements: [],
        readAloudEmoteReplacements: [],
        readAloudVoiceMappings: [],
        readAloudAudioOutput: 'overlay1',
        readAloudDefaultsVersion: COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION
    };
}

function normalizeCommentReadAloudVoices(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((voice) => {
            const voiceValue = normalizeEffectText(voice?.value ?? voice?.name, 200);
            const name = normalizeEffectText(voice?.name, 160);

            if (!name || !voiceValue) {
                return null;
            }

            return {
                value: voiceValue,
                name,
                lang: normalizeEffectText(voice?.lang, 40),
                gender: normalizeEffectText(voice?.gender, 40),
                provider: normalizeEffectText(voice?.provider, 40),
                termsUrl: normalizeEffectText(voice?.termsUrl, 400)
            };
        })
        .filter(Boolean)
        .sort((left, right) => String(left.name).localeCompare(String(right.name), 'ja'));
}

function normalizeCommentFeedType(value) {
    const normalized = normalizeEffectText(value, 80);
    return COMMENT_FEED_EVENT_DEFINITIONS.some((item) => item.type === normalized) ? normalized : 'chat';
}

function normalizeCommentReadAloudFilters(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return [...new Set(source
        .map((item) => normalizeEffectText(item, 120))
        .filter(Boolean)
        .slice(0, 100))];
}

function migrateCommentReadAloudFilters(filters, storedDefaultsVersion) {
    if (storedDefaultsVersion >= 2) {
        return filters;
    }

    return normalizeCommentReadAloudFilters([
        ...filters.filter((item) => item !== 'おばさん'),
        'ババア'
    ]);
}

function normalizeCommentReadAloudTextReplacements(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const from = normalizeEffectText(item.from, 120);
                const to = normalizeEffectText(item.to, 120);

                if (!from || !to) {
                    return null;
                }

                return { from, to };
            }

            const line = normalizeEffectText(item, 260);

            if (!line) {
                return null;
            }

            const separatorIndex = line.search(/[=＝]/u);

            if (separatorIndex <= 0) {
                return null;
            }

            const from = normalizeEffectText(line.slice(0, separatorIndex), 120);
            const to = normalizeEffectText(line.slice(separatorIndex + 1), 120);

            if (!from || !to) {
                return null;
            }

            return { from, to };
        })
        .filter(Boolean)
        .sort((left, right) => String(right.from).length - String(left.from).length)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.from === item.from) === index)
        .slice(0, 100);
}

function normalizeCommentReadAloudEmojiReplacements(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const emoji = normalizeEffectText(item.emoji, 32);
                const text = normalizeEffectText(item.text, 120);

                if (!emoji || !text) {
                    return null;
                }

                return { emoji, text };
            }

            const line = normalizeEffectText(item, 180);

            if (!line) {
                return null;
            }

            const separatorIndex = line.indexOf('=');

            if (separatorIndex <= 0) {
                return null;
            }

            const emoji = normalizeEffectText(line.slice(0, separatorIndex), 32);
            const text = normalizeEffectText(line.slice(separatorIndex + 1), 120);

            if (!emoji || !text) {
                return null;
            }

            return { emoji, text };
        })
        .filter(Boolean)
        .sort((left, right) => String(right.emoji).length - String(left.emoji).length)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoji === item.emoji) === index)
        .slice(0, 100);
}

function normalizeCommentReadAloudEmoteKey(value) {
    const normalizedValue = normalizeEffectText(value, 64);

    if (!normalizedValue) {
        return '';
    }

    if (normalizedValue.startsWith('[emote:') && normalizedValue.endsWith(']')) {
        return normalizeEffectText(normalizedValue.slice(7, -1), 64);
    }

    if (normalizedValue.startsWith('emote:')) {
        return normalizeEffectText(normalizedValue.slice(6), 64);
    }

    return normalizedValue;
}

function normalizeCommentReadAloudEmoteReplacements(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const emoteId = normalizeCommentReadAloudEmoteKey(item.emoteId ?? item.emote);
                const text = normalizeEffectText(item.text, 120);

                if (!emoteId || !text) {
                    return null;
                }

                return { emoteId, text };
            }

            const line = normalizeEffectText(item, 200);

            if (!line) {
                return null;
            }

            const separatorIndex = line.indexOf('=');

            if (separatorIndex <= 0) {
                return null;
            }

            const emoteId = normalizeCommentReadAloudEmoteKey(line.slice(0, separatorIndex));
            const text = normalizeEffectText(line.slice(separatorIndex + 1), 120);

            if (!emoteId || !text) {
                return null;
            }

            return { emoteId, text };
        })
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoteId === item.emoteId) === index)
        .slice(0, 100);
}

function normalizeCommentReadAloudVoiceMappings(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' ? value.split(/\r?\n/gu) : []);

    return source
        .map((item) => {
            if (typeof item === 'object' && item) {
                const uniqueId = normalizeBroadcasterId(item.uniqueId ?? item.userId);
                const voiceName = normalizeEffectText(item.voiceName, 200);

                if (!uniqueId || !voiceName) {
                    return null;
                }

                return { uniqueId, voiceName };
            }

            const line = normalizeEffectText(item, 320);

            if (!line) {
                return null;
            }

            const separatorIndex = line.search(/[=＝]/u);

            if (separatorIndex <= 0) {
                return null;
            }

            const uniqueId = normalizeBroadcasterId(line.slice(0, separatorIndex));
            const voiceName = normalizeEffectText(line.slice(separatorIndex + 1), 200);

            if (!uniqueId || !voiceName) {
                return null;
            }

            return { uniqueId, voiceName };
        })
        .filter(Boolean)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.uniqueId === item.uniqueId) === index)
        .slice(0, 200);
}

function normalizeCommentObservedEmoteCatalog(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    return (Array.isArray(source) ? source : [])
        .map((item) => {
            const emoteId = normalizeCommentReadAloudEmoteKey(item?.emoteId ?? item?.id);
            const imageUrl = normalizeEffectText(item?.imageUrl ?? item?.url, 2000);
            const observedAt = normalizeWholeNumber(item?.observedAt) || 0;

            if (!emoteId || !imageUrl) {
                return null;
            }

            return { emoteId, imageUrl, observedAt };
        })
        .filter(Boolean)
        .sort((left, right) => right.observedAt - left.observedAt)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoteId === item.emoteId) === index)
        .slice(0, COMMENT_OBSERVED_EMOTE_CACHE_LIMIT);
}

function normalizeCommentObservedEmojiCatalog(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    return (Array.isArray(source) ? source : [])
        .map((item) => {
            const emoji = normalizeEffectText(item?.emoji ?? item?.value, 32);
            const observedAt = normalizeWholeNumber(item?.observedAt) || 0;

            if (!emoji) {
                return null;
            }

            return { emoji, observedAt };
        })
        .filter(Boolean)
        .sort((left, right) => right.observedAt - left.observedAt)
        .filter((item, index, list) => list.findIndex((candidate) => candidate.emoji === item.emoji) === index)
        .slice(0, COMMENT_OBSERVED_EMOJI_CACHE_LIMIT);
}

function normalizeCommentFeedSettings(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    const defaults = createDefaultCommentFeedSettings();
    const hasEnabledTypes = Array.isArray(source?.enabledTypes);
    const enabledTypesSource = hasEnabledTypes ? source.enabledTypes : defaults.enabledTypes;
    const enabledTypes = [...new Set(enabledTypesSource.map((item) => normalizeCommentFeedType(item)).filter(Boolean))];
    const hasReadAloudEnabledTypes = Array.isArray(source?.readAloudEnabledTypes);
    const readAloudEnabledTypesSource = hasReadAloudEnabledTypes
        ? source.readAloudEnabledTypes
        : (hasEnabledTypes ? enabledTypesSource : defaults.readAloudEnabledTypes);
    const readAloudEnabledTypes = [...new Set(readAloudEnabledTypesSource.map((item) => normalizeCommentFeedType(item)).filter(Boolean))];
    const hasReadAloudFilters = Array.isArray(source?.readAloudFilters) || typeof source?.readAloudFilters === 'string';
    const storedReadAloudDefaultsVersion = Math.max(0, normalizeWholeNumber(source?.readAloudDefaultsVersion, 0));
    const readAloudVoiceName = normalizeEffectText(source?.readAloudVoiceName, 120);
    const readAloudVoiceCreditEnabled = true;
    const readAloudRandomVoiceEnabled = source?.readAloudRandomVoiceEnabled === true;
    const readAloudVolume = Math.max(0, Math.min(100, normalizeWholeNumber(source?.readAloudVolume) ?? defaults.readAloudVolume));
    const readAloudSpeedRaw = Number.isFinite(Number(source?.readAloudSpeed)) ? Number(source.readAloudSpeed) : defaults.readAloudSpeed;
    const readAloudSpeed = Math.round(Math.max(0.5, Math.min(2.0, readAloudSpeedRaw)) * 10) / 10;
    const normalizedStoredReadAloudFilters = hasReadAloudFilters
        ? normalizeCommentReadAloudFilters(source?.readAloudFilters)
        : [];
    const readAloudTextReplacements = normalizeCommentReadAloudTextReplacements(source?.readAloudTextReplacements);
    const readAloudEmojiReplacements = normalizeCommentReadAloudEmojiReplacements(source?.readAloudEmojiReplacements);
    const readAloudEmoteReplacements = normalizeCommentReadAloudEmoteReplacements(source?.readAloudEmoteReplacements);
    const readAloudVoiceMappings = normalizeCommentReadAloudVoiceMappings(source?.readAloudVoiceMappings);
    const readAloudAudioOutput = typeof source?.readAloudAudioOutput === 'string' && source.readAloudAudioOutput
        ? source.readAloudAudioOutput
        : 'overlay1';
    const readAloudFilters = migrateCommentReadAloudFilters(storedReadAloudDefaultsVersion >= COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION
        ? (hasReadAloudFilters ? normalizedStoredReadAloudFilters : [...defaults.readAloudFilters])
        : normalizeCommentReadAloudFilters([
            ...COMMENT_READ_ALOUD_DEFAULT_FILTERS,
            ...normalizedStoredReadAloudFilters
        ]), storedReadAloudDefaultsVersion);

    return {
        sortOrder: source?.sortOrder === 'asc' ? 'asc' : 'desc',
        enabledTypes: hasEnabledTypes ? enabledTypes : defaults.enabledTypes,
        readAloudEnabledTypes: hasReadAloudEnabledTypes ? readAloudEnabledTypes : (hasEnabledTypes ? enabledTypes : defaults.readAloudEnabledTypes),
        readAloudEnabled: source?.readAloudEnabled === true,
        readAloudVoiceName,
        readAloudVoiceCreditEnabled,
        readAloudRandomVoiceEnabled,
        readAloudVolume,
        readAloudSpeed,
        readAloudFilters,
        readAloudTextReplacements,
        readAloudEmojiReplacements,
        readAloudEmoteReplacements,
        readAloudVoiceMappings,
        readAloudAudioOutput,
        readAloudDefaultsVersion: COMMENT_READ_ALOUD_DEFAULT_FILTERS_VERSION
    };
}

function getCommentFeedTypes() {
    return COMMENT_FEED_EVENT_DEFINITIONS.map((item) => ({ ...item }));
}

module.exports = {
    createDefaultCommentFeedSettings,
    normalizeCommentReadAloudVoices,
    normalizeCommentFeedType,
    normalizeCommentReadAloudFilters,
    migrateCommentReadAloudFilters,
    normalizeCommentReadAloudTextReplacements,
    normalizeCommentReadAloudEmojiReplacements,
    normalizeCommentReadAloudEmoteKey,
    normalizeCommentReadAloudEmoteReplacements,
    normalizeCommentReadAloudVoiceMappings,
    normalizeCommentObservedEmoteCatalog,
    normalizeCommentObservedEmojiCatalog,
    normalizeCommentFeedSettings,
    getCommentFeedTypes,
};
