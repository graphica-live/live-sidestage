const express = require('express');
const { renderContributorsOverlayHtml } = require('./render');

const DEFAULT_PORT = 38101;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_BACKEND_ORIGIN = 'http://localhost:38100';

function normalizePort(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBackendOrigin(value) {
    if (typeof value !== 'string') {
        return DEFAULT_BACKEND_ORIGIN;
    }

    const normalized = value.trim().replace(/\/+$/u, '');
    return normalized || DEFAULT_BACKEND_ORIGIN;
}

const port = normalizePort(process.env.OVERLAY_PORT, DEFAULT_PORT);
const host = process.env.OVERLAY_HOST?.trim() || DEFAULT_HOST;
const backendOrigin = normalizeBackendOrigin(process.env.OVERLAY_BACKEND_ORIGIN);

const app = express();

function sendOverlayHtml(res) {
    res.type('html').send(renderContributorsOverlayHtml({ backendOrigin }));
}

app.get(['/', '/index.html', '/overlays/contributors', '/overlays/contributors/index.html'], (req, res) => {
    sendOverlayHtml(res);
});

app.get('/healthz', (req, res) => {
    res.json({
        ok: true,
        overlay: 'contributors',
        backendOrigin
    });
});

app.listen(port, host, () => {
    console.log(`Overlay server (contributors) running on http://localhost:${port}`);
    console.log(`Using backend origin ${backendOrigin}`);
});