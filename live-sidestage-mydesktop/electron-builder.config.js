'use strict';

const config = {
    appId: 'com.livesidestage.mydesktop',
    productName: 'MyDesktop',
    copyright: 'Copyright © 2026',
    directories: {
        output: 'dist/electron'
    },
    files: [
        'main.js',
        'preload.js',
        'renderer/**/*',
        'assets/**/*',
        'package.json',
        'node_modules/**/*'
    ],
    win: {
        target: 'nsis',
        icon: 'assets/windows/icon.ico'
    },
    nsis: {
        oneClick: false,
        perMachine: true,
        allowElevation: true,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: 'MyDesktop',
        runAfterFinish: true
    }
};

module.exports = config;
