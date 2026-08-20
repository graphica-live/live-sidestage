'use strict';

const { WIDGET_SHOGO_MONTHLY_MVP_SETTINGS_STATE_KEY } = require('./constants');
const { normalizeBooleanInput, normalizeHttpUrl, normalizeApiKey } = require('./utils');

const REQUEST_TIMEOUT_MS = 4000;

const DEFAULT_MONTHLY_MVP_SETTINGS = {
    enabled: false,
    baseUrl: '',
    apiKey: '',
};

function normalizeMonthlyMvpSettings(value) {
    let source = value;

    if (typeof source === 'string') {
        try {
            source = JSON.parse(source);
        } catch {
            source = null;
        }
    }

    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        source = {};
    }

    return {
        enabled: normalizeBooleanInput(source.enabled, DEFAULT_MONTHLY_MVP_SETTINGS.enabled),
        baseUrl: normalizeHttpUrl(source.baseUrl),
        apiKey: normalizeApiKey(source.apiKey),
    };
}

// 現在のJST日時を基準に「先月」を YYYY-MM 形式で返す。
function getTargetMonth(now = new Date()) {
    const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
    const year = jstNow.getFullYear();
    const month = jstNow.getMonth(); // 0-11, 前月扱いにそのまま使える
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 12 : month;
    return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

module.exports = function createMonthlyMvpClient({ getScopedStateValue, setScopedStateValue }) {
    function getSettings() {
        return normalizeMonthlyMvpSettings(getScopedStateValue(WIDGET_SHOGO_MONTHLY_MVP_SETTINGS_STATE_KEY));
    }

    function setSettings(next) {
        const normalized = normalizeMonthlyMvpSettings(next);
        setScopedStateValue(WIDGET_SHOGO_MONTHLY_MVP_SETTINGS_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    async function requestMonthlyContributors(baseUrl, apiKey, month) {
        const url = new URL('/api/analytics/monthly-contributors', baseUrl);
        url.searchParams.set('month', month);

        try {
            const response = await fetch(url, {
                headers: { 'x-api-key': apiKey },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });

            if (!response.ok) {
                return { ok: false, status: response.status, data: null };
            }

            return { ok: true, status: response.status, data: await response.json() };
        } catch (error) {
            console.warn('⚠️ LIVE Sidestage Analyticsへの接続に失敗しました:', error.message);
            return { ok: false, status: 0, data: null };
        }
    }

    async function fetchMonthlyContributors(targetMonth) {
        const { baseUrl, apiKey } = getSettings();
        if (!baseUrl || !apiKey) {
            return null;
        }

        const result = await requestMonthlyContributors(baseUrl, apiKey, targetMonth);
        return result.ok ? result.data : null;
    }

    async function testConnection() {
        const { baseUrl, apiKey } = getSettings();
        if (!baseUrl || !apiKey) {
            return { ok: false, error: 'Base URLとAPIキーを入力してください。' };
        }

        const result = await requestMonthlyContributors(baseUrl, apiKey, getTargetMonth());

        if (result.ok) {
            return { ok: true };
        }

        if (result.status === 401) {
            return { ok: false, error: 'APIキーが正しくありません。' };
        }

        return { ok: false, error: 'LIVE Sidestage Analyticsへの接続に失敗しました。Base URLを確認してください。' };
    }

    return {
        getSettings,
        setSettings,
        getTargetMonth,
        fetchMonthlyContributors,
        testConnection,
    };
};
