'use strict';

const express = require('express');
const { EXPORTABLE_SCOPED_SETTINGS_KEYS, EXPORTABLE_GLOBAL_SETTINGS_KEYS } = require('../constants');

const POPOUT_WINDOW_KINDS = ['comments', 'gifts'];

function popoutAutoOpenStateKey(kind) {
    return `popout_auto_open_${kind}`;
}

module.exports = function registerSettingsRoutes({ app, dbStore, io, serverEvents, getBroadcasterId, getScopedStateValue, setScopedStateValue, getTimestamp, IS_ELECTRON, IS_PACKAGED_ELECTRON }) {
    app.get('/api/settings/popout-windows', (req, res) => {
        const windows = {};
        for (const kind of POPOUT_WINDOW_KINDS) {
            windows[kind] = { autoOpenOnStartup: dbStore.getGlobalStateValue(popoutAutoOpenStateKey(kind)) === '1' };
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
        res.json({ fontKey, fontSize });
    });

    app.post('/api/settings/popout-comment-style', express.json(), (req, res) => {
        const fontKey = String((req.body || {}).fontKey || 'default').trim().slice(0, 60) || 'default';
        const rawFontSize = Number((req.body || {}).fontSize);
        const fontSize = Number.isFinite(rawFontSize) ? Math.max(10, Math.min(48, Math.round(rawFontSize))) : 13;

        dbStore.setGlobalStateValue('popout_comments_font_key', fontKey, getTimestamp());
        dbStore.setGlobalStateValue('popout_comments_font_size', String(fontSize), getTimestamp());

        io.emit('popout-comment-style-changed', { fontKey, fontSize });
        res.json({ ok: true, fontKey, fontSize });
    });

    app.get('/api/settings/auto-launch', (req, res) => {
        if (!IS_ELECTRON || !IS_PACKAGED_ELECTRON) {
            return res.json({ available: false, enabled: false });
        }
        const { app: electronApp } = require('electron');
        const launchItems = electronApp.getLoginItemSettings().launchItems || [];
        const item = launchItems.find((entry) => entry.name === 'TikEffect');
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
            name: 'TikEffect',
            path: process.execPath
        });
        res.json({ ok: true, enabled });
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
