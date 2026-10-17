const assert = require('node:assert/strict');
const vscode = require('vscode');
const path = require('node:path');
const manifest = require('../../package.json');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(predicate, message) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) { throw new Error(message); }
    await delay(50);
  }
}

async function open(text) {
  const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: text });
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  return { document, editor };
}

function select(editor, text) {
  const start = editor.document.getText().indexOf(text);
  assert.notEqual(start, -1);
  editor.selection = new vscode.Selection(editor.document.positionAt(start), editor.document.positionAt(start + text.length));
}

async function generate(command) {
  // Accept the actual name InputBox in the isolated test window.
  let done = false;
  const timer = setInterval(() => {
    if (!done) { void vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem'); }
  }, 100);
  try {
    await Promise.race([
      vscode.commands.executeCommand(command),
      delay(10_000).then(() => { throw new Error(`Command timed out: ${command}`); }),
    ]);
  } finally {
    done = true;
    clearInterval(timer);
  }
}

exports.run = async () => {
  let passed = 0;
  async function check(name, callback) {
    await callback();
    passed++;
    console.log(`PASS: ${name}`);
  }

  await check('local extension activates and registers all three commands', async () => {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension, 'Development extension not found');
    await extension.activate();
    assert.ok(extension.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const command of ['autotype.convert', 'autotype.generateType', 'autotype.generateTypesFile']) {
      assert.ok(commands.includes(command), `${command} not registered`);
    }
    assert.equal(path.resolve(extension.extensionPath), path.resolve(__dirname, '../..'));
  });

  await check('selection conversion prompts and preserves initial state in a real editor', async () => {
    const original = "const initialState = { name: '', loading: false };";
    const { editor, document } = await open(original);
    select(editor, original);
    await generate('autotype.generateType');
    assert.match(document.getText(), /^export interface InitialState/);
    assert.match(document.getText(), /name: string;/);
    assert.ok(document.getText().endsWith(original));
  });

  await check('shortcut command converts a selected literal and infers its variable name', async () => {
    const { editor, document } = await open('const userProfile = {id: 1};');
    select(editor, '{id: 1}');
    await generate('autotype.convert');
    assert.match(document.getText(), /^export interface UserProfile/);
    assert.ok(document.getText().endsWith('const userProfile = {id: 1};'));
  });

  await check('real paste events convert JavaScript literals and preserve following code', async () => {
    const { editor, document } = await open('interface User:\n\nconst keep = 42;');
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    assert.equal(await editor.edit((edit) => edit.insert(new vscode.Position(1, 0), "{name:'Sifat', tags:[],}\n")), true);
    await waitFor(() => document.getText().startsWith('export interface User'), 'Paste trigger did not convert');
    assert.match(document.getText(), /tags: unknown\[\];/);
    assert.ok(document.getText().endsWith('const keep = 42;'));
  });

  await check('multiple samples produce optional properties and unions', async () => {
    const original = "const users = [{id:1,email:'a'},{id:'2'}];";
    const { editor, document } = await open(original);
    select(editor, original);
    await generate('autotype.generateType');
    assert.match(document.getText(), /interface User/);
    assert.match(document.getText(), /id: number \| string;/);
    assert.match(document.getText(), /email\?: string;/);
  });

  await check('workspace output settings and empty-value overrides are applied', async () => {
    const config = vscode.workspace.getConfiguration('autotype');
    const values = { defaultStyle: 'type', readonly: true, nameSuffix: 'Dto',
      typeOverrides: { users: 'string[]', selected: 'string | null' } };
    try {
      for (const [key, value] of Object.entries(values)) {
        await config.update(key, value, vscode.ConfigurationTarget.Workspace);
      }
      const { editor, document } = await open('const state = {users:[], selected:null};');
      select(editor, '{users:[], selected:null}');
      await generate('autotype.generateType');
      assert.match(document.getText(), /^export type StateDto =/);
      assert.match(document.getText(), /readonly users: string\[\];/);
      assert.match(document.getText(), /readonly selected: string \| null;/);
    } finally {
      for (const key of Object.keys(values)) { await config.update(key, undefined, vscode.ConfigurationTarget.Workspace); }
    }
  });

  await check('types-file command saves generated content and imports it into real source', async () => {
    const workspace = vscode.workspace.workspaceFolders[0].uri;
    const source = vscode.Uri.joinPath(workspace, 'source.ts');
    const target = vscode.Uri.joinPath(workspace, 'state.types.ts');
    const original = "'use client';\nconst state = {id:1};\n";
    const config = vscode.workspace.getConfiguration('autotype');
    const files = vscode.workspace.getConfiguration('files');
    await vscode.workspace.fs.writeFile(source, Buffer.from(original));
    try {
      await config.update('addImport', true, vscode.ConfigurationTarget.Workspace);
      await files.update('simpleDialog.enable', true, vscode.ConfigurationTarget.Global);
      const document = await vscode.workspace.openTextDocument(source);
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      select(editor, '{id:1}');
      await generate('autotype.generateTypesFile');
      const content = Buffer.from(await vscode.workspace.fs.readFile(target)).toString();
      assert.match(content, /^export interface State/);
      assert.match(document.getText(), /import type \{ State \} from "\.\/state.types";/);
      assert.match(document.getText(), /^'use client';/);
      assert.ok(document.getText().endsWith('const state = {id:1};\n'));
    } finally {
      await config.update('addImport', undefined, vscode.ConfigurationTarget.Workspace);
      await files.update('simpleDialog.enable', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  console.log(`AutoType: ${passed} real extension-host checks passed.`);
};
