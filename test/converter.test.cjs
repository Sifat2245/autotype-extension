const assert = require("node:assert/strict");
const { test } = require("node:test");
const ts = require("typescript");
const {
  parseInput,
  generateTypes,
  suggestRootName,
  isTypeName,
  validateTypeExpression,
} = require("../out/converter");

function convert(text, name = "Root", options = {}) {
  return generateTypes(parseInput(text), name, options).code;
}

function assertTypeChecks(code) {
  const filename = "/tmp/autotype-generated-check.ts";
  const options = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) =>
    file === filename
      ? ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
      : getSourceFile(file, ...args);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
  );
}

test("parses JSON and JS/TS literal syntax without changing primitive types", () => {
  const code = convert(
    `export const initialState: unknown = {
    // initial values
    name: '', count: -1, loading: false, missing: undefined,
    label: \`hello\`, amount: 123n,
  } as const satisfies Record<string, unknown>;`,
    "InitialState",
  );
  for (const property of [
    "name: string;",
    "count: number;",
    "loading: boolean;",
    "missing: undefined;",
    "label: string;",
    "amount: bigint;",
  ]) {
    assert.ok(code.includes(property), property);
  }
  assertTypeChecks(code);
  assert.match(convert('{"enabled": true}'), /enabled: boolean/);
});

test("merges every array sample, preserving optional and nullable fields", () => {
  const code = convert(
    `[
    { id: 1, name: 'Sifat', email: 'a', selected: null },
    { id: '2', name: 'Alex', selected: { id: 3 } },
  ]`,
    "User",
  );
  assert.match(code, /id: number \| string;/);
  assert.match(code, /email\?: string;/);
  assert.match(code, /selected: Selected \| null;/);
  assertTypeChecks(code);
});

test("merges nested object samples and ignores empty arrays when samples exist", () => {
  const code =
    convert(`[{ groups: [] }, { groups: [{ id: 1, profile: { name: 'A' } }] },
    { groups: [{ id: 2, profile: { age: 25 } }] }]`);
  assert.match(code, /groups: Group\[\];/);
  assert.match(code, /name\?: string;/);
  assert.match(code, /age\?: number;/);
  assertTypeChecks(code);
});

test("does not mark explicit null or undefined as an absent property", () => {
  const code = convert("[{value:null},{value:undefined},{value:1}]");
  assert.match(code, /value: null \| undefined \| number;/);
  assert.doesNotMatch(code, /value\?/);
});

test("uses safe empty-state defaults and per-path overrides", () => {
  assert.match(
    convert("{ users: [], selected: null }"),
    /users: unknown\[\];\n  selected: null;/,
  );
  const code = convert(
    "{ users: [], selected: null, profile: { items: [] } }",
    "State",
    {
      emptyArrayType: "string",
      typeOverrides: {
        users: "User[]",
        selected: "User | null",
        "profile.items": "number[]",
      },
    },
  );
  assert.match(code, /users: User\[\];/);
  assert.match(code, /selected: User \| null;/);
  assert.match(code, /items: number\[\];/);
  assertTypeChecks("interface User { id: number }\n" + code);
});

test("supports element-path overrides, including empty array elements", () => {
  const code = convert("{ users: [{id: 1}], tags: [] }", "State", {
    typeOverrides: { "users[].id": "string", "tags[]": "number" },
  });
  assert.match(code, /id: string;/);
  assert.match(code, /tags: number\[\];/);
});

test("honors declaration style, exports, readonly, indentation and decorated names", () => {
  const code = convert("{ users: [{id:1}], tags: [] }", "State", {
    style: "type",
    exportTypes: false,
    readonly: true,
    indent: "\t",
    namePrefix: "I",
    nameSuffix: "Dto",
  });
  assert.match(code, /^type IStateDto = \{/);
  assert.match(code, /\treadonly users: ReadonlyArray<IUserDto>;/);
  assert.match(code, /\treadonly tags: ReadonlyArray<unknown>;/);
  assert.doesNotMatch(code, /export/);
  assertTypeChecks(code);
});

test("handles primitive, mixed, nested, and empty root arrays with valid aliases", () => {
  for (const input of [
    "[]",
    '[1,"a",null]',
    "[{id:1},false]",
    '[[1],["a"]]',
    "{}",
    '{"a-b":1, "123":true}',
  ]) {
    assertTypeChecks(convert(input));
  }
  assert.match(convert('[1,"a"]'), /type Root = \(number \| string\)\[\];/);
});

test("parenthesizes complex fallback element types correctly", () => {
  const code = convert("{ callbacks: [] }", "Callbacks", {
    emptyArrayType: "() => void",
  });
  assert.match(code, /callbacks: \(\(\) => void\)\[\];/);
  assertTypeChecks(code);
});

test("avoids root, nested and existing declaration name collisions", () => {
  const code = convert("{ user: {id:1}, users: [{id:2}] }", "User", {
    reservedNames: ["User", "User2"],
  });
  assert.match(code, /interface User3/);
  assert.match(code, /user: User4;/);
  assert.match(code, /users: User5\[\];/);
  assertTypeChecks(code);
  assertTypeChecks(
    convert('{records:[{id:1}], readonlyArray:{name:"a"}}', "Array"),
  );
});

test("does not decorate a confirmed root name twice", () => {
  const code = generateTypes(
    parseInput("{profile:{id:1}}"),
    "CustomDto",
    { nameSuffix: "Dto" },
    false,
  ).code;
  assert.match(code, /^export interface CustomDto/);
  assert.match(code, /profile: ProfileDto/);
});

test("infers names from declarations, array variables and portable filenames", () => {
  assert.equal(
    suggestRootName(parseInput("const userProfile = {id:1}"), "example.ts"),
    "UserProfile",
  );
  assert.equal(
    suggestRootName(parseInput("const users = [{id:1}]"), "example.ts"),
    "User",
  );
  assert.equal(
    suggestRootName(parseInput("{}"), "C:\\project\\user-profile.ts"),
    "UserProfile",
  );
  assert.equal(
    suggestRootName(parseInput("{}"), "/project/123-state.ts"),
    "Type123State",
  );
});

test("keeps special object keys as data without prototype pollution", () => {
  const input = parseInput(
    '{"__proto__": {polluted: true}, constructor: "safe"}',
  );
  assert.equal(Object.getPrototypeOf(input.value), null);
  assert.equal(input.value.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  assertTypeChecks(generateTypes(input, "State").code);
});

test("rejects executable expressions, partial literals and multiple declarations", () => {
  for (const input of [
    "{value: getValue()}",
    "{...other}",
    "{name}",
    "{[key]: 1}",
    "{method() {}}",
    "{value: new Date()}",
    "{value: `hello ${name}`}",
    "{value:",
    "{value:1",
    "const a = {}, b = {}",
    "const a = {}; const b = {}",
    "{}; process.exit()",
    "42",
    "[,1]",
    "{nested: {value: other}}",
  ]) {
    assert.throws(() => parseInput(input), undefined, input);
  }
});

test("validates configured type expressions and declaration names", () => {
  for (const type of ["", "User;", "string; type Injected = number", "User["]) {
    assert.equal(validateTypeExpression(type), false, type);
  }
  for (const type of [
    "User | null",
    "Record<string, unknown>",
    "() => void",
    "readonly string[]",
  ]) {
    assert.equal(validateTypeExpression(type), true, type);
  }
  for (const name of [
    "123User",
    "string",
    "User-Profile",
    "class",
    "User; type Other",
  ]) {
    assert.equal(isTypeName(name), false, name);
  }
  assert.equal(isTypeName("UserProfile"), true);
  assert.throws(
    () => convert("{}", "User", { nullType: "string; type Injected = number" }),
    /Invalid type expression/,
  );
});
