const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
delete env.VSCODE_INSPECTOR_OPTIONS;

const child = spawn(process.env.VSCODE_EXECUTABLE || 'code', [
  '--new-window',
  `--extensionDevelopmentPath=${root}`,
  '--disable-extensions',
  `--user-data-dir=${path.join(root, '.vscode-test', 'dev-profile')}`,
  `--extensions-dir=${path.join(root, '.vscode-test', 'dev-extensions')}`,
], { env, detached: true, stdio: 'ignore', shell: process.platform === 'win32' });

child.on('error', (error) => {
  console.error(`Could not launch VS Code: ${error.message}. Put code on PATH or set VSCODE_EXECUTABLE.`);
  process.exitCode = 1;
});
child.unref();
