'use strict';

const { WIDGET_SHOGO_MONTHLY_MVP_STATUS_STATE_KEY } = require('./constants');

const DEFAULT_STATUS = {
    lastComputedMonth: '',
    lastRunAt: '',
    lastError: '',
};

function normalizeStatus(value) {
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
        lastComputedMonth: typeof source.lastComputedMonth === 'string' ? source.lastComputedMonth : DEFAULT_STATUS.lastComputedMonth,
        lastRunAt: typeof source.lastRunAt === 'string' ? source.lastRunAt : DEFAULT_STATUS.lastRunAt,
        lastError: typeof source.lastError === 'string' ? source.lastError : DEFAULT_STATUS.lastError,
    };
}

module.exports = function createMonthlyMvpAutomation({
    getScopedStateValue,
    setScopedStateValue,
    getTimestamp,
    replaceAutoMonthlyEntries,
    monthlyMvpClient,
}) {
    let running = false;

    function getStatus() {
        return normalizeStatus(getScopedStateValue(WIDGET_SHOGO_MONTHLY_MVP_STATUS_STATE_KEY));
    }

    function setStatus(next) {
        const normalized = normalizeStatus(next);
        setScopedStateValue(WIDGET_SHOGO_MONTHLY_MVP_STATUS_STATE_KEY, JSON.stringify(normalized));
        return normalized;
    }

    // 起動時・定期チェックの両方から呼ばれる。lastComputedMonthとtargetMonthが一致していれば
    // 何もしない。取得に失敗した場合はlastErrorだけ更新しlastComputedMonthは据え置く（次回リトライ）。
    async function checkAndRunMonthlyMvpUpdate({ force = false } = {}) {
        if (running) {
            return { ran: false, reason: 'already-running' };
        }

        const settings = monthlyMvpClient.getSettings();
        if (!settings.enabled || !settings.baseUrl || !settings.apiKey) {
            return { ran: false, reason: 'disabled' };
        }

        const targetMonth = monthlyMvpClient.getTargetMonth();
        const status = getStatus();

        if (!force && status.lastComputedMonth === targetMonth) {
            return { ran: false, reason: 'up-to-date' };
        }

        running = true;

        try {
            const data = await monthlyMvpClient.fetchMonthlyContributors(targetMonth);

            if (!data) {
                setStatus({ ...status, lastRunAt: getTimestamp(), lastError: 'LIVE Sidestage Analyticsからデータを取得できませんでした。' });
                return { ran: false, reason: 'fetch-failed' };
            }

            replaceAutoMonthlyEntries({ mvpUsers: data.mvp, top5Users: data.top5 });
            setStatus({ lastComputedMonth: targetMonth, lastRunAt: getTimestamp(), lastError: '' });
            return { ran: true, targetMonth };
        } finally {
            running = false;
        }
    }

    return {
        getStatus,
        checkAndRunMonthlyMvpUpdate,
    };
};
