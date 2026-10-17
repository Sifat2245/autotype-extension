const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

const candidates = {
  linux: ['/usr/share/code/code', '/usr/lib/code/code', '/opt/visual-studio-code/code'],
  darwin: ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron'],
  win32: [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe')],
};
const executable = process.env.VSCODE_EXECUTABLE
  || (candidates[process.platform] || []).find((candidate) => fs.existsSync(candidate));

if (!executable) {
  throw new Error('Set VSCODE_EXECUTABLE to your VS Code desktop executable to run the real extension-host tests.');
}

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'autotype-host-'));
const workspace = path.join(temporary, 'workspace');
fs.mkdirSync(workspace);

console.log(`VS Code test files and logs: ${temporary}`);
runTests({
  vscodeExecutablePath: executable,
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, 'test', 'host', 'index.cjs'),
  launchArgs: [
    workspace,
    '--disable-extensions',
    `--user-data-dir=${path.join(temporary, 'profile')}`,
    `--extensions-dir=${path.join(temporary, 'extensions')}`,
  ],
  extensionTestsEnv: {
    ELECTRON_RUN_AS_NODE: undefined,
    NODE_OPTIONS: undefined,
    VSCODE_INSPECTOR_OPTIONS: undefined,
    AUTOTYPE_TEST_WORKSPACE: workspace,
  },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
