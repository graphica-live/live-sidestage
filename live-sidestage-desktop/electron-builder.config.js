'use strict';

const DEFAULT_AUTO_UPDATE_URL = 'https://update.graphica-produce.com/tikeffect/win';
const updateUrl = (process.env.TIKEFFECT_AUTO_UPDATE_URL || DEFAULT_AUTO_UPDATE_URL).trim().replace(/\/+$/u, '');

const config = {
    appId: 'com.tikeffect',
    productName: 'TikEffect',
    copyright: 'Copyright © 2025',
    directories: {
        output: 'dist/electron'
    },
    files: [
        'electron/**/*',
        'backend/**/*',
        'loader-server/**/*',
        'index.js',
        'overlays/**/*',
        'package.json',
        'node_modules/**/*',
        '!node_modules/.cache/**/*'
    ],
    asarUnpack: [
        'node_modules/better-sqlite3/**'
    ],
    win: {
        target: 'nsis',
        icon: 'assets/windows/TikEffect.ico'
    },
    nsis: {
        oneClick: false,
        perMachine: true,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'TikEffect',
        runAfterFinish: true,
        include: 'installer/nsis/uninstall-cleanup.nsh'
    },
    extraResources: [
        {
            from: 'assets/windows/TikEffect.ico',
            to: 'TikEffect.ico'
        }
    ]
};

if (updateUrl) {
    config.publish = [
        {
            provider: 'generic',
            url: updateUrl
        }
    ];
}

module.exports = config;