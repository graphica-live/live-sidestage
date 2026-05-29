'use strict';

const express = require('express');
const { EXPORTABLE_SCOPED_SETTINGS_KEYS, EXPORTABLE_GLOBAL_SETTINGS_KEYS } = require('../constants');

module.exports = function registerSettingsRoutes({ app, dbStore, io, getBroadcasterId, getScopedStateValue, setScopedStateValue, getTimestamp }) {
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
