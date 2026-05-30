'use strict';

function firstDefinedString(values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function normalizeBooleanInput(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();

    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function normalizeHexColor(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function normalizeEffectText(value, maxLength = 120) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().slice(0, maxLength);
}

function hasJapaneseText(value) {
    return /[぀-ヿ㐀-䶿一-鿿]/.test(String(value || ''));
}

function normalizeWholeNumber(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeBroadcasterId(value) {
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    const normalizedValue = trimmedValue.replace(/^@+/, '');

    if (!normalizedValue || /\s/.test(normalizedValue)) {
        return null;
    }

    return normalizedValue;
}

module.exports = {
    firstDefinedString,
    normalizeBooleanInput,
    normalizeHexColor,
    normalizeEffectText,
    hasJapaneseText,
    normalizeWholeNumber,
    normalizeBroadcasterId,
};
