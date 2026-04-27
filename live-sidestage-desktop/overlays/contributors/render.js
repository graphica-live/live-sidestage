const fs = require('fs');
const path = require('path');

const OVERLAY_HTML_PATH = path.join(__dirname, 'index.html');
const OVERLAY_RUNTIME_CONFIG_TOKEN = '__OVERLAY_RUNTIME_CONFIG_PAYLOAD__';
const SOCKET_IO_CLIENT_URL_TOKEN = '__SOCKET_IO_CLIENT_URL__';

function normalizeBackendOrigin(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim().replace(/\/+$/u, '');
}

function buildSocketIoClientUrl(backendOrigin) {
    return backendOrigin
        ? `${backendOrigin}/socket.io/socket.io.js`
        : '/socket.io/socket.io.js';
}

function renderContributorsOverlayHtml(options = {}) {
    const backendOrigin = normalizeBackendOrigin(options.backendOrigin);
    const template = fs.readFileSync(OVERLAY_HTML_PATH, 'utf8');
    const runtimeConfig = {
        backendOrigin,
        snapshotPath: '/api/overlay/contributors/snapshot'
    };

    return template
        .replace(OVERLAY_RUNTIME_CONFIG_TOKEN, JSON.stringify(runtimeConfig))
        .replace(SOCKET_IO_CLIENT_URL_TOKEN, buildSocketIoClientUrl(backendOrigin));
}

module.exports = {
    renderContributorsOverlayHtml
};