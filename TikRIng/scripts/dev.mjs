import { spawn } from 'node:child_process';

const children = [];

function getScriptCommand(script) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', `npm run ${script}`],
    };
  }

  return {
    command: 'npm',
    args: ['run', script],
  };
}

function startProcess(name, color, script) {
  const scriptCommand = getScriptCommand(script);
  const child = spawn(scriptCommand.command, scriptCommand.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  children.push(child);

  const prefix = `${color}[${name}]\x1b[0m`;

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`${prefix} ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`${prefix} ${chunk}`);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`${prefix} exited with signal ${signal}`);
      shutdown(signal);
      return;
    }

    if (code && code !== 0) {
      console.error(`${prefix} exited with code ${code}`);
      process.exitCode = code;
      shutdown();
    }
  });

  child.on('error', (error) => {
    console.error(`${prefix} failed to start: ${error.message}`);
    process.exitCode = 1;
    shutdown();
  });
}

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal ?? 'SIGTERM');
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startProcess('vite', '\x1b[36m', 'dev:ui');
startProcess('api', '\x1b[35m', 'dev:api');