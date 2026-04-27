const { spawn } = require('child_process');

const mode = process.argv[2] === 'dev' ? 'dev' : 'start';
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const childSpecs = mode === 'dev'
    ? [
        ['run', 'backend:dev'],
        ['run', 'overlay:contributors:dev']
    ]
    : [
        ['run', 'backend:start'],
        ['run', 'overlay:contributors:start']
    ];

const children = childSpecs.map((args) => spawn(npmCommand, args, {
    stdio: 'inherit',
    env: process.env,
    shell: isWindows
}));

let shuttingDown = false;

function stopAll(exitCode) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    children.forEach((child) => {
        if (!child.killed) {
            child.kill('SIGTERM');
        }
    });

    setTimeout(() => {
        process.exit(exitCode);
    }, 100);
}

children.forEach((child) => {
    child.on('exit', (code) => {
        stopAll(code || 0);
    });
});

process.on('SIGINT', () => {
    stopAll(0);
});

process.on('SIGTERM', () => {
    stopAll(0);
});