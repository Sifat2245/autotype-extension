const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { test } = require("node:test");

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}
class Selection extends Range {
  constructor(start, end = start) {
    super(start, end);
    this.active = end;
  }
  get isEmpty() {
    return (
      this.start.line === this.end.line &&
      this.start.character === this.end.character
    );
  }
}
class Uri {
  constructor(filePath) {
    this.path = filePath;
    this.scheme = "file";
    this.authority = "";
  }
  toString() {
    return "file://" + this.path;
  }
  with(changes) {
    return Object.assign(new Uri(this.path), changes);
  }
  static joinPath(base, child) {
    return new Uri(path.posix.join(base.path, child));
  }
}
class Document {
  constructor(text, languageId = "typescript", name = "/project/state.ts") {
    this.text = text;
    this.languageId = languageId;
    this.uri = new Uri(name);
    this.fileName = name;
    this.version = 1;
    this.isClosed = false;
    this.isUntitled = false;
    this.eol = text.includes("\r\n") ? 2 : 1;
  }
  get lineCount() {
    return this.text.split("\n").length;
  }
  getText(range) {
    return range
      ? this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end))
      : this.text;
  }
  offsetAt(position) {
    const lines = this.text.split("\n");
    if (position.line >= lines.length) {
      return this.text.length;
    }
    return (
      lines
        .slice(0, position.line)
        .reduce((sum, line) => sum + line.length + 1, 0) + position.character
    );
  }
  positionAt(offset) {
    const lines = this.text
      .slice(0, Math.min(this.text.length, offset))
      .split("\n");
    return new Position(lines.length - 1, lines.at(-1).length);
  }
  lineAt(line) {
    const text = this.text.split("\n")[line].replace(/\r$/, "");
    const start = new Position(line, 0);
    const end = new Position(line, text.length);
    return {
      text,
      range: new Range(start, end),
      rangeIncludingLineBreak: new Range(
        start,
        line < this.lineCount - 1 ? new Position(line + 1, 0) : end,
      ),
    };
  }
  apply(edits) {
    const offsets = edits
      .map(({ range, text }) => ({
        start: this.offsetAt(range.start),
        end: this.offsetAt(range.end),
        text,
      }))
      .sort((a, b) => b.start - a.start);
    for (const edit of offsets) {
      this.text =
        this.text.slice(0, edit.start) + edit.text + this.text.slice(edit.end);
    }
    this.version++;
  }
  async save() {
    this.saved = true;
    return true;
  }
}

function harness(text, settings = {}, language = "typescript") {
  const document = new Document(text, language);
  const commands = new Map();
  const warnings = [];
  const files = new Map([[document.uri.toString(), document]]);
  const timers = new Map();
  const subscriptions = [];
  const editor = {
    document,
    selection: new Selection(new Position(0, 0)),
    edit: async (callback) => {
      const edits = [];
      callback({
        replace: (range, value) => edits.push({ range, text: value }),
        insert: (position, value) =>
          edits.push({ range: new Range(position, position), text: value }),
      });
      document.apply(edits);
      return true;
    },
  };
  let changed;
  let saveUri = new Uri("/project/state.types.ts");
  let inputHandler;
  class WorkspaceEdit {
    constructor() {
      this.operations = [];
    }
    createFile(uri) {
      this.operations.push({ create: uri });
    }
    insert(uri, position, value) {
      this.operations.push({
        uri,
        range: new Range(position, position),
        text: value,
      });
    }
  }
  const api = {
    Position,
    Range,
    Uri,
    WorkspaceEdit,
    EndOfLine: { LF: 1, CRLF: 2 },
    commands: {
      registerCommand: (id, callback) => {
        commands.set(id, callback);
        return { dispose() {} };
      },
    },
    window: {
      activeTextEditor: editor,
      showWarningMessage: (message) => {
        warnings.push(message);
      },
      setStatusBarMessage() {},
      showInputBox: async (options) => {
        const value = inputHandler ? inputHandler(options) : options.value;
        if (value !== undefined) {
          assert.equal(options.validateInput(value), undefined);
        }
        return value;
      },
      showSaveDialog: async () => saveUri,
      showTextDocument: async () => {},
    },
    workspace: {
      workspaceFolders: [{ uri: new Uri("/project") }],
      getConfiguration: () => ({
        get: (name, fallback) => settings[name] ?? fallback,
      }),
      onDidChangeTextDocument: (callback) => {
        changed = callback;
        return { dispose() {} };
      },
      applyEdit: async (edit) => {
        for (const operation of edit.operations) {
          if (operation.create && files.has(operation.create.toString())) {
            return false;
          }
        }
        for (const operation of edit.operations) {
          if (operation.create) {
            files.set(
              operation.create.toString(),
              new Document("", "typescript", operation.create.path),
            );
          } else {
            files.get(operation.uri.toString()).apply([operation]);
          }
        }
        return true;
      },
      openTextDocument: async (uri) => files.get(uri.toString()),
    },
  };
  const filename = path.resolve(__dirname, "../out/extension.js");
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
      require: (name) => (name === "vscode" ? api : realRequire(name)),
      setTimeout: (callback) => {
        const id = Symbol();
        timers.set(id, callback);
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
    { filename },
  );
  module.exports.activate({ subscriptions });
  return {
    document,
    editor,
    warnings,
    files,
    command: (id = "autotype.generateType") => commands.get(id)(editor),
    select: (value) => {
      const start = text.indexOf(value);
      assert.notEqual(start, -1);
      editor.selection = new Selection(
        document.positionAt(start),
        document.positionAt(start + value.length),
      );
    },
    cursor: (offset) => {
      editor.selection = new Selection(document.positionAt(offset));
    },
    input: (handler) => {
      inputHandler = handler;
    },
    save: (uri) => {
      saveUri = uri === undefined ? undefined : new Uri(uri);
    },
    automatic: async (reason) => {
      changed({
        document,
        reason,
        contentChanges: [
          {
            range: new Range(new Position(0, 0), new Position(0, 0)),
            text: document.text,
          },
        ],
      });
      for (const callback of timers.values()) {
        callback();
      }
      timers.clear();
      await new Promise(setImmediate);
    },
  };
}

test("generates above a selected declaration and preserves the original object", async () => {
  const original = "const initialState = {name: '', loading: false};";
  const h = harness(original);
  h.select(original);
  await h.command();
  assert.match(h.document.text, /^export interface InitialState/);
  assert.ok(h.document.text.endsWith(original));
  assert.deepEqual(h.warnings, []);
});

test("infers the variable name for a selected literal and for a cursor inside it", async () => {
  for (const select of [true, false]) {
    const h = harness("const userProfile = {id: 1};");
    if (select) {
      h.select("{id: 1}");
    } else {
      h.cursor(h.document.text.indexOf("id:"));
    }
    await h.command("autotype.convert");
    assert.match(h.document.text, /^export interface UserProfile/);
    assert.match(h.document.text, /const userProfile = \{id: 1\};$/);
  }
});

test("inserts valid local declarations inside functions without export modifiers", async () => {
  const original =
    "function Component() {\n  const state = {loading: false};\n}";
  const h = harness(original);
  h.select("{loading: false}");
  await h.command();
  assert.match(
    h.document.text,
    /\n  interface State \{\n    loading: boolean;\n  \}/,
  );
  assert.match(h.document.text, /\n  const state = \{loading: false\};/);
  assert.doesNotMatch(h.document.text, /export/);
});

test("cursor conversion can read a literal argument without executing its surrounding call", async () => {
  const h = harness("const state = useState({loading:false});");
  h.cursor(h.document.text.indexOf("loading"));
  await h.command();
  assert.match(h.document.text, /interface State/);
  assert.ok(
    h.document.text.endsWith("const state = useState({loading:false});"),
  );
  assert.deepEqual(h.warnings, []);
});

test("applies settings and a renamed root while avoiding existing declarations", async () => {
  const h = harness("interface IStateDto {}\nconst state = {profile:{id:1}};", {
    namePrefix: "I",
    nameSuffix: "Dto",
    defaultStyle: "type",
    readonly: true,
  });
  h.select("{profile:{id:1}}");
  h.input((options) => {
    assert.equal(options.value, "IStateDto2");
    return "Custom";
  });
  await h.command();
  assert.match(
    h.document.text,
    /export type Custom = \{\n  readonly profile: IProfileDto;/,
  );
  assert.match(h.document.text, /export type IProfileDto/);
});

test("creates a separate types file and optional type-only import", async () => {
  const original = "'use client';\nconst initialState = {count: 0};";
  const h = harness(original, { addImport: true });
  h.select("{count: 0}");
  await h.command("autotype.generateTypesFile");
  assert.match(
    h.files.get("file:///project/state.types.ts").text,
    /^export interface InitialState/,
  );
  assert.equal(h.files.get("file:///project/state.types.ts").saved, true);
  assert.match(
    h.document.text,
    /^'use client';\nimport type \{ InitialState \} from "\.\/state.types";/,
  );
  assert.ok(h.document.text.endsWith("const initialState = {count: 0};"));
  assert.deepEqual(h.warnings, []);
});

test("new-file output setting preserves the source when no import is requested", async () => {
  const original = "const state = {id:1};";
  const h = harness(original, { outputLocation: "newFile" });
  h.select("{id:1}");
  await h.command();
  assert.equal(h.document.text, original);
  assert.match(
    h.files.get("file:///project/state.types.ts").text,
    /interface State/,
  );
});

test("JavaScript and JSON commands always create a TypeScript file", async () => {
  for (const [language, original] of [
    ["javascript", "const state = {id:1};"],
    ["json", '{"id":1}'],
    ["jsonc", '{/*comment*/ "id":1,}'],
  ]) {
    const h = harness(original, { addImport: true }, language);
    if (language === "javascript") {
      h.select("{id:1}");
    }
    await h.command();
    assert.equal(h.document.text, original);
    assert.match(
      h.files.get("file:///project/state.types.ts").text,
      /id: number;/,
    );
    assert.deepEqual(h.warnings, []);
  }
});

test("cancelling either prompt does not change source or create files", async () => {
  for (const cancelName of [true, false]) {
    const original = "const state = {id:1};";
    const h = harness(original);
    h.select("{id:1}");
    if (cancelName) {
      h.input(() => undefined);
    } else {
      h.save(undefined);
    }
    await h.command("autotype.generateTypesFile");
    assert.equal(h.document.text, original);
    assert.equal(h.files.size, 1);
  }
});

test("does not overwrite an existing file or the source itself", async () => {
  for (const target of ["/project/state.types.ts", "/project/state.ts"]) {
    const original = "const state = {id:1};";
    const h = harness(original, { addImport: true });
    h.select("{id:1}");
    h.save(target);
    if (target.endsWith(".types.ts")) {
      h.files.set("file://" + target, new Document("existing contents"));
    }
    await h.command("autotype.generateTypesFile");
    assert.equal(h.document.text, original);
    assert.equal(h.warnings.length, 1);
    if (target.endsWith(".types.ts")) {
      assert.equal(h.files.get("file://" + target).text, "existing contents");
    }
  }
});

test("rejects stale source after a prompt and preserves user edits", async () => {
  const h = harness("const state = {id:1};");
  h.select("{id:1}");
  h.input((options) => {
    h.document.text += "\n// edited";
    h.document.version++;
    return options.value;
  });
  await h.command();
  assert.ok(h.document.text.endsWith("// edited"));
  assert.doesNotMatch(h.document.text, /interface/);
  assert.match(h.warnings[0], /source changed/);
});

test("automatic triggers support JS objects and keep following application code", async () => {
  const h = harness(
    "interface User:\n{name:'Sifat', tags:[],}\nconst untouched = 42;\n",
  );
  await h.automatic();
  assert.match(h.document.text, /^export interface User \{/);
  assert.doesNotMatch(h.document.text, /User2/);
  assert.ok(h.document.text.endsWith("const untouched = 42;\n"));
  assert.deepEqual(h.warnings, []);
});

test("explicit type triggers override default interface style and support declarations", async () => {
  const h = harness(
    "type Product:\nconst product = {price:1};\nconst keep = true;",
  );
  await h.automatic();
  assert.match(h.document.text, /^export type Product = \{/);
  assert.ok(h.document.text.endsWith("const keep = true;"));
});

test("explicit trigger names remain unchanged by configured naming decorations", async () => {
  const h = harness("interface State:\n{profile:{id:1}}", {
    nameSuffix: "Dto",
  });
  await h.automatic();
  assert.match(h.document.text, /^export interface State \{/);
  assert.match(h.document.text, /profile: ProfileDto/);
});

test("automatic triggers ignore incomplete input and undo/redo events", async () => {
  for (const [original, reason] of [
    ["interface:\n{name:", undefined],
    ["interface:\n{id:1}", 1],
  ]) {
    const h = harness(original);
    await h.automatic(reason);
    assert.equal(h.document.text, original);
    assert.deepEqual(h.warnings, []);
  }
});

test("automatic triggers do not alter examples inside comments or template strings", async () => {
  for (const original of [
    "/*\ninterface:\n{id:1}\n*/",
    "const example = `\ninterface:\n{id:1}\n`;",
    "const example = `hello ${name}\ninterface:\n{id:1}\n`;",
  ]) {
    const h = harness(original);
    await h.automatic();
    assert.equal(h.document.text, original);
    assert.deepEqual(h.warnings, []);
  }
});

test("preserves CRLF line endings and uses configured empty-value overrides", async () => {
  const original = "const state = {users:[], selected:null};\r\n";
  const h = harness(original, {
    typeOverrides: { users: "string[]", selected: "string | null" },
  });
  h.select("{users:[], selected:null}");
  await h.command();
  assert.match(h.document.text, /users: string\[\];\r\n/);
  assert.match(h.document.text, /selected: string \| null;/);
  assert.equal(h.document.text.replaceAll("\r\n", "").includes("\n"), false);
  assert.ok(h.document.text.endsWith(original));
});

test("manual commands report unsupported expressions without changing the document", async () => {
  const original = "const state = {now: new Date()};";
  const h = harness(original);
  h.select("{now: new Date()}");
  await h.command();
  assert.equal(h.document.text, original);
  assert.match(h.warnings[0], /Unsupported expression at now/);
});
