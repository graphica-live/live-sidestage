'use strict';

const { DISPLAY_NAME } = require('../app-identity');

const express = require('express');
const { EXPORTABLE_SCOPED_SETTINGS_KEYS, EXPORTABLE_GLOBAL_SETTINGS_KEYS, EULER_STREAM_API_KEY_STATE_KEY, ANALYTICS_BASE_URL_STATE_KEY, ANALYTICS_REFRESH_TOKEN_STATE_KEY, ANALYTICS_ACCESS_TOKEN_STATE_KEY } = require('../constants');

const POPOUT_WINDOW_KINDS = ['comments', 'gifts', 'comments-gifts'];
const GIFT_SORT_ORDERS = ['timestamp-asc', 'timestamp-desc'];

function popoutAutoOpenStateKey(kind) {
    return `popout_auto_open_${kind}`;
}

function popoutAutoFrontStateKey(kind) {
    return `popout_auto_front_${kind}`;
}

function isLocalControlRequest(req) {
    const origin = String(req.get('origin') || '').trim();
    if (!origin) return true;
    try {
        const host = new URL(origin).hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1'
            || host === '127.0.0.1.sslip.io' || host.endsWith('.127.0.0.1.sslip.io');
    } catch {
        return false;
    }
}

module.exports = function registerSettingsRoutes({ app, dbStore, io, serverEvents, getBroadcasterId, setBroadcasterId, connectToTikTok, resetTikTokConnection, getScopedStateValue, setScopedStateValue, getTimestamp, IS_ELECTRON, IS_PACKAGED_ELECTRON }) {
    app.get('/api/settings/popout-windows', (req, res) => {
        const windows = {};
        for (const kind of POPOUT_WINDOW_KINDS) {
            windows[kind] = {
                autoOpenOnStartup: dbStore.getGlobalStateValue(popoutAutoOpenStateKey(kind)) === '1',
                autoFront: dbStore.getGlobalStateValue(popoutAutoFrontStateKey(kind)) === '1'
            };
        }
        res.json({ available: IS_ELECTRON, windows });
    });

    app.post('/api/settings/popout-windows/auto-open', express.json(), (req, res) => {
        const kind = String((req.body || {}).kind || '');
        if (!POPOUT_WINDOW_KINDS.includes(kind)) {
            return res.status(400).json({ ok: false, error: 'invalid kind' });
        }
        const enabled = Boolean((req.body || {}).enabled);
        dbStore.setGlobalStateValue(popoutAutoOpenStateKey(kind), enabled ? '1' : '0', getTimestamp());
        res.json({ ok: true, enabled });
    });

    app.post('/api/settings/popout-windows/auto-front', express.json(), (req, res) => {
        const kind = String((req.body || {}).kind || '');
        if (!POPOUT_WINDOW_KINDS.includes(kind)) {
            return res.status(400).json({ ok: false, error: 'invalid kind' });
        }
        const enabled = Boolean((req.body || {}).enabled);
        dbStore.setGlobalStateValue(popoutAutoFrontStateKey(kind), enabled ? '1' : '0', getTimestamp());
        res.json({ ok: true, enabled });
    });

    app.post('/api/settings/popout-windows/open', express.json(), (req, res) => {
        if (!IS_ELECTRON) {
            return res.status(400).json({ ok: false, error: 'インストール版でのみ利用できます' });
        }
        const kind = String((req.body || {}).kind || '');
        if (!POPOUT_WINDOW_KINDS.includes(kind)) {
            return res.status(400).json({ ok: false, error: 'invalid kind' });
        }
        res.json({ ok: true });
        serverEvents.emit('popout-window-open-requested', kind);
    });

    app.get('/api/settings/popout-comment-style', (req, res) => {
        const fontKey = dbStore.getGlobalStateValue('popout_comments_font_key') || 'default';
        const storedFontSize = Number(dbStore.getGlobalStateValue('popout_comments_font_size'));
        const fontSize = Number.isFinite(storedFontSize) && storedFontSize > 0 ? storedFontSize : 13;
        const flashNew = dbStore.getGlobalStateValue('popout_comments_flash_new') !== '0';
        res.json({ fontKey, fontSize, flashNew });
    });

    app.post('/api/settings/popout-comment-style', express.json(), (req, res) => {
        const fontKey = String((req.body || {}).fontKey || 'default').trim().slice(0, 60) || 'default';
        const rawFontSize = Number((req.body || {}).fontSize);
        const fontSize = Number.isFinite(rawFontSize) ? Math.max(10, Math.min(48, Math.round(rawFontSize))) : 13;
        const flashNew = (req.body || {}).flashNew !== false;

        dbStore.setGlobalStateValue('popout_comments_font_key', fontKey, getTimestamp());
        dbStore.setGlobalStateValue('popout_comments_font_size', String(fontSize), getTimestamp());
        dbStore.setGlobalStateValue('popout_comments_flash_new', flashNew ? '1' : '0', getTimestamp());

        io.emit('popout-comment-style-changed', { fontKey, fontSize, flashNew });
        res.json({ ok: true, fontKey, fontSize, flashNew });
    });

    app.get('/api/settings/popout-gift-style', (req, res) => {
        const storedSortOrder = dbStore.getGlobalStateValue('popout_gifts_sort_order');
        const sortOrder = GIFT_SORT_ORDERS.includes(storedSortOrder) ? storedSortOrder : 'timestamp-asc';
        const fontKey = dbStore.getGlobalStateValue('popout_gifts_font_key') || 'default';
        const storedFontSize = Number(dbStore.getGlobalStateValue('popout_gifts_font_size'));
        const fontSize = Number.isFinite(storedFontSize) && storedFontSize > 0 ? storedFontSize : 13;
        const flashNew = dbStore.getGlobalStateValue('popout_gifts_flash_new') !== '0';

        res.json({ sortOrder, fontKey, fontSize, flashNew });
    });

    app.post('/api/settings/popout-gift-style', express.json(), (req, res) => {
        const body = req.body || {};
        const rawSortOrder = String(body.sortOrder || '');
        const sortOrder = GIFT_SORT_ORDERS.includes(rawSortOrder) ? rawSortOrder : 'timestamp-asc';
        const fontKey = String(body.fontKey || 'default').trim().slice(0, 60) || 'default';
        const rawFontSize = Number(body.fontSize);
        const fontSize = Number.isFinite(rawFontSize) ? Math.max(10, Math.min(48, Math.round(rawFontSize))) : 13;
        const flashNew = body.flashNew !== false;

        dbStore.setGlobalStateValue('popout_gifts_sort_order', sortOrder, getTimestamp());
        dbStore.setGlobalStateValue('popout_gifts_font_key', fontKey, getTimestamp());
        dbStore.setGlobalStateValue('popout_gifts_font_size', String(fontSize), getTimestamp());
        dbStore.setGlobalStateValue('popout_gifts_flash_new', flashNew ? '1' : '0', getTimestamp());

        io.emit('popout-gift-style-changed', { sortOrder, fontKey, fontSize, flashNew });
        res.json({ ok: true, sortOrder, fontKey, fontSize, flashNew });
    });

    app.get('/api/settings/auto-launch', (req, res) => {
        if (!IS_ELECTRON || !IS_PACKAGED_ELECTRON) {
            return res.json({ available: false, enabled: false });
        }
        const { app: electronApp } = require('electron');
        const launchItems = electronApp.getLoginItemSettings().launchItems || [];
        const item = launchItems.find((entry) => entry.name === DISPLAY_NAME);
        res.json({ available: true, enabled: Boolean(item && item.enabled) });
    });

    app.post('/api/settings/auto-launch', express.json(), (req, res) => {
        if (!IS_ELECTRON || !IS_PACKAGED_ELECTRON) {
            return res.status(400).json({ ok: false, error: 'インストール版でのみ利用できます' });
        }
        const enabled = Boolean((req.body || {}).enabled);
        const { app: electronApp } = require('electron');
        electronApp.setLoginItemSettings({
            openAtLogin: enabled,
            name: DISPLAY_NAME,
            path: process.execPath
        });
        res.json({ ok: true, enabled });
    });



    app.get('/api/settings/analytics-auth', async (req, res) => {
        const baseUrl = String(dbStore.getGlobalStateValue(ANALYTICS_BASE_URL_STATE_KEY) || '').replace(/\/$/, '');
        const token = dbStore.getGlobalStateValue(ANALYTICS_ACCESS_TOKEN_STATE_KEY) || '';
        const loggedIn = Boolean(dbStore.getGlobalStateValue(ANALYTICS_REFRESH_TOKEN_STATE_KEY));
        let session = null;
        if (loggedIn && baseUrl && token) {
            try {
                const response = await fetch(baseUrl + '/api/desktop/session', {
                    headers: { Authorization: 'Bearer ' + token }
                });
                if (response.ok) {
                    session = await response.json();
                    if (session && session.streamer && session.streamer.tiktokHandle && setBroadcasterId) {
                        setBroadcasterId(session.streamer.tiktokHandle);
                    }
                }
            } catch (_) { /* ignore */ }
        }
        res.json({ baseUrl, loggedIn, session });
    });

    app.post('/api/settings/analytics-login', express.json(), async (req, res) => {
        if (!isLocalControlRequest(req)) {
            return res.status(403).json({ error: 'この操作は Control 画面からのみ行えます' });
        }
        const body = req.body || {};
        const baseUrl = String(body.baseUrl || '').trim().replace(/\/$/, '');
        const email = String(body.email || '').trim();
        const password = String(body.password || '');
        if (!baseUrl || !email || !password) {
            return res.status(400).json({ error: 'analytics の URL とメール、パスワードが必要です' });
        }
        try {
            const response = await fetch(baseUrl + '/api/desktop/auth/email/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                return res.status(response.status).json({ error: payload.error || 'ログインに失敗しました' });
            }
            dbStore.setGlobalStateValue(ANALYTICS_BASE_URL_STATE_KEY, baseUrl, getTimestamp());
            dbStore.setGlobalStateValue(ANALYTICS_ACCESS_TOKEN_STATE_KEY, payload.token || '', getTimestamp());
            dbStore.setGlobalStateValue(ANALYTICS_REFRESH_TOKEN_STATE_KEY, payload.refreshToken || '', getTimestamp());
            if (payload.streamer && payload.streamer.tiktokHandle && setBroadcasterId) {
                setBroadcasterId(payload.streamer.tiktokHandle);
            }
            if (typeof connectToTikTok === 'function') {
                connectToTikTok().catch((err) => console.warn('[analytics-login] connect failed:', err?.message || err));
            }
            res.json({
                ok: true,
                onboardingRequired: Boolean(payload.onboardingRequired),
                streamer: payload.streamer || null
            });
        } catch (error) {
            res.status(502).json({ error: error?.message || 'analytics に接続できません' });
        }
    });

    app.post('/api/settings/analytics-register-streamer', express.json(), async (req, res) => {
        if (!isLocalControlRequest(req)) {
            return res.status(403).json({ error: 'この操作は Control 画面からのみ行えます' });
        }
        const baseUrl = String(dbStore.getGlobalStateValue(ANALYTICS_BASE_URL_STATE_KEY) || '').replace(/\/$/, '');
        const token = dbStore.getGlobalStateValue(ANALYTICS_ACCESS_TOKEN_STATE_KEY) || '';
        const tiktokHandle = String((req.body || {}).tiktokHandle || '').replace(/^@/, '').trim();
        if (!baseUrl || !token) {
            return res.status(401).json({ error: '先に analytics へログインしてください' });
        }
        if (!tiktokHandle) {
            return res.status(400).json({ error: 'TikTok IDを入力してください' });
        }
        try {
            const response = await fetch(baseUrl + '/api/desktop/streamer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                body: JSON.stringify({ tiktokHandle })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                return res.status(response.status).json({ error: payload.error || '登録に失敗しました' });
            }
            if (payload.token) {
                dbStore.setGlobalStateValue(ANALYTICS_ACCESS_TOKEN_STATE_KEY, payload.token, getTimestamp());
            }
            if (payload.streamer && payload.streamer.tiktokHandle && setBroadcasterId) {
                setBroadcasterId(payload.streamer.tiktokHandle);
            }
            if (typeof connectToTikTok === 'function') {
                connectToTikTok().catch((err) => console.warn('[analytics-register] connect failed:', err?.message || err));
            }
            res.status(201).json({ ok: true, streamer: payload.streamer || null });
        } catch (error) {
            res.status(502).json({ error: error?.message || 'analytics に接続できません' });
        }
    });

    app.post('/api/settings/analytics-logout', express.json(), async (req, res) => {
        if (!isLocalControlRequest(req)) {
            return res.status(403).json({ error: 'この操作は Control 画面からのみ行えます' });
        }
        const baseUrl = String(dbStore.getGlobalStateValue(ANALYTICS_BASE_URL_STATE_KEY) || '').replace(/\/$/, '');
        const refreshToken = dbStore.getGlobalStateValue(ANALYTICS_REFRESH_TOKEN_STATE_KEY) || '';
        if (baseUrl && refreshToken) {
            try {
                await fetch(baseUrl + '/api/desktop/auth/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refreshToken })
                });
            } catch (_) { /* ignore */ }
        }
        dbStore.setGlobalStateValue(ANALYTICS_ACCESS_TOKEN_STATE_KEY, '', getTimestamp());
        dbStore.setGlobalStateValue(ANALYTICS_REFRESH_TOKEN_STATE_KEY, '', getTimestamp());
        if (typeof resetTikTokConnection === 'function') {
            await resetTikTokConnection();
        }
        res.json({ ok: true });
    });

    app.get('/api/settings/eulerstream-api-key', (req, res) => {
        const apiKey = dbStore.getGlobalStateValue(EULER_STREAM_API_KEY_STATE_KEY) || '';
        res.json({ apiKey });
    });

    app.post('/api/settings/eulerstream-api-key', express.json(), (req, res) => {
        const apiKey = String((req.body || {}).apiKey || '').trim().slice(0, 500);
        dbStore.setGlobalStateValue(EULER_STREAM_API_KEY_STATE_KEY, apiKey, getTimestamp());
        res.json({ ok: true, apiKey });
    });

    app.get('/api/settings/export', (req, res) => {
        const broadcasterId = getBroadcasterId();
        const settings = {};
        for (const key of EXPORTABLE_SCOPED_SETTINGS_KEYS) {
            const value = getScopedStateValue(key);
            if (value != null) settings[key] = value;
        }
        const globalSettings = {};
        for (const key of EXPORTABLE_GLOBAL_SETTINGS_KEYS) {
            const value = dbStore.getGlobalStateValue(key);
            if (value != null) globalSettings[key] = value;
        }
        res.json({
            version: 1,
            broadcasterId: broadcasterId || null,
            exportedAt: new Date().toISOString(),
            settings,
            globalSettings
        });
    });

    app.post('/api/settings/import', express.json({ limit: '4mb' }), (req, res) => {
        const { settings, globalSettings } = req.body || {};
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
            return res.status(400).json({ ok: false, error: 'invalid payload: settings must be an object' });
        }
        const allowedScoped = new Set(EXPORTABLE_SCOPED_SETTINGS_KEYS);
        const allowedGlobal = new Set(EXPORTABLE_GLOBAL_SETTINGS_KEYS);
        for (const [key, value] of Object.entries(settings)) {
            if (!allowedScoped.has(key) || value == null) continue;
            setScopedStateValue(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        if (globalSettings && typeof globalSettings === 'object' && !Array.isArray(globalSettings)) {
            for (const [key, value] of Object.entries(globalSettings)) {
                if (!allowedGlobal.has(key) || value == null) continue;
                dbStore.setGlobalStateValue(key, String(value), getTimestamp());
            }
        }
        io.emit('settings:imported', { broadcasterId: getBroadcasterId() });
        res.json({ ok: true });
    });
};
