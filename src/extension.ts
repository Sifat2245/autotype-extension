import * as path from "node:path";
import * as ts from "typescript";
import * as vscode from "vscode";
import {
  generateTypes,
  GeneratorOptions,
  isTypeName,
  parseInput,
  ParsedInput,
  parseSource,
  reservedTypeNames,
  suggestRootName,
  unwrapExpression,
} from "./converter";

interface ConversionSource {
  input: ParsedInput;
  anchor: vscode.Position;
  topLevel: boolean;
}

interface TriggerSource {
  input: ParsedInput;
  range: vscode.Range;
  style: "type" | "interface";
  name?: string;
}

const inlineLanguages = new Set(["typescript", "typescriptreact"]);
const supportedLanguages = new Set([
  ...inlineLanguages,
  "javascript",
  "javascriptreact",
  "json",
  "jsonc",
]);

export function activate(context: vscode.ExtensionContext): void {
  const applying = new Set<string>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  async function run(
    editor: vscode.TextEditor,
    action: () => Promise<void>,
    silent = false,
  ): Promise<void> {
    const key = editor.document.uri.toString();
    if (applying.has(key)) {
      return;
    }
    applying.add(key);
    try {
      await action();
    } catch (error) {
      if (!silent) {
        void vscode.window.showWarningMessage(
          `AutoType: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      applying.delete(key);
    }
  }

  async function convertTrigger(
    editor: vscode.TextEditor,
    trigger: TriggerSource,
  ): Promise<void> {
    const options = readOptions(editor.document);
    const containing = enclosingNodes(
      documentSource(editor.document),
      editor.document.offsetAt(trigger.range.start),
      editor.document.offsetAt(trigger.range.start),
    );
    if (
      containing.some((node) => ts.isBlock(node) || ts.isClassDeclaration(node))
    ) {
      options.exportTypes = false;
    }
    options.style = trigger.style;
    options.reservedNames = declaredNames(editor.document, trigger.range);
    const result = generateTypes(
      trigger.input,
      trigger.name || suggestRootName(trigger.input, editor.document.fileName),
      options,
      !trigger.name,
    );
    const indent =
      editor.document
        .lineAt(trigger.range.start.line)
        .text.match(/^\s*/)?.[0] || "";
    const code = formatCode(result.code, editor.document, indent);
    const success = await editor.edit((edit) =>
      edit.replace(trigger.range, `${code}${lineEnding(editor.document)}`),
    );
    if (!success) {
      throw new Error("Could not apply the conversion. Please try again.");
    }
    vscode.window.setStatusBarMessage(
      `AutoType: Generated ${result.rootName} (undo to restore the input)`,
      5000,
    );
  }

  const commands: [string, boolean, boolean][] = [
    ["autotype.convert", false, true],
    ["autotype.generateType", false, false],
    ["autotype.generateTypesFile", true, false],
  ];
  for (const [id, toFile, allowTrigger] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          void vscode.window.showWarningMessage(
            "AutoType: Open a source file first.",
          );
          return;
        }
        await run(editor, async () => {
          if (!supportedLanguages.has(editor.document.languageId)) {
            throw new Error(
              "Open a TypeScript, JavaScript, JSON, or JSONC file first.",
            );
          }
          const trigger =
            allowTrigger && editor.selection.isEmpty
              ? findTrigger(editor.document, editor.selection.active.line)
              : undefined;
          if (trigger && inlineLanguages.has(editor.document.languageId)) {
            await convertTrigger(editor, trigger);
            return;
          }
          await generateFromSource(editor, toFile);
        });
      }),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const document = event.document;
      const key = document.uri.toString();
      const editor = vscode.window.activeTextEditor;
      if (
        !editor ||
        editor.document !== document ||
        applying.has(key) ||
        event.reason !== undefined ||
        !inlineLanguages.has(document.languageId) ||
        !event.contentChanges.length
      ) {
        return;
      }
      const previous = pending.get(key);
      if (previous) {
        clearTimeout(previous);
      }
      const lastLine = Math.min(
        document.lineCount - 1,
        Math.max(
          ...event.contentChanges.map(
            (change) =>
              change.range.start.line + change.text.split("\n").length - 1,
          ),
        ),
      );
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          if (
            document.isClosed ||
            vscode.window.activeTextEditor?.document !== document
          ) {
            return;
          }
          void run(
            editor,
            async () => {
              const trigger = findTrigger(document, lastLine);
              if (trigger) {
                await convertTrigger(editor, trigger);
              }
            },
            true,
          );
        }, 300),
      );
    }),
  );
  context.subscriptions.push({
    dispose: () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
      pending.clear();
    },
  });
}

function readOptions(document: vscode.TextDocument): GeneratorOptions {
  const config = vscode.workspace.getConfiguration("autotype", document.uri);
  const indentSize = config.get<number>("indentSize", 2);
  return {
    style: config.get("defaultStyle", "interface"),
    exportTypes: config.get("exportTypes", true),
    readonly: config.get("readonly", false),
    indent:
      config.get<string>("indentStyle", "spaces") === "tabs"
        ? "\t"
        : " ".repeat(indentSize),
    namePrefix: config.get("namePrefix", ""),
    nameSuffix: config.get("nameSuffix", ""),
    emptyArrayType: config.get("emptyArrayType", "unknown"),
    nullType: config.get("nullType", "null"),
    typeOverrides: config.get("typeOverrides", {}),
    reservedNames: [...reservedTypeNames],
  };
}

function lineEnding(document: vscode.TextDocument): string {
  return document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}

function formatCode(
  code: string,
  document: vscode.TextDocument,
  indent = "",
): string {
  return code
    .split("\n")
    .map((line) => (line ? indent + line : ""))
    .join(lineEnding(document));
}

function documentSource(document: vscode.TextDocument): ts.SourceFile {
  return ts.createSourceFile(
    document.fileName,
    document.getText(),
    ts.ScriptTarget.Latest,
    true,
    /react$/.test(document.languageId) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function enclosingNodes(
  source: ts.SourceFile,
  start: number,
  end: number,
): ts.Node[] {
  const nodes: ts.Node[] = [];
  function visit(node: ts.Node): void {
    if (node.getStart(source) <= start && node.getEnd() >= end) {
      nodes.push(node);
      ts.forEachChild(node, visit);
    }
  }
  visit(source);
  return nodes;
}

function findSource(editor: vscode.TextEditor): ConversionSource {
  const document = editor.document;
  if (document.languageId === "json" || document.languageId === "jsonc") {
    const text = editor.selection.isEmpty
      ? document.getText()
      : document.getText(editor.selection);
    return {
      input: parseInput(text),
      anchor: new vscode.Position(0, 0),
      topLevel: true,
    };
  }
  const source = documentSource(document);
  const selectionText = document.getText(editor.selection);
  const start =
    document.offsetAt(editor.selection.start) +
    (selectionText.match(/^\s*/)?.[0].length || 0);
  const end =
    document.offsetAt(editor.selection.end) -
    (selectionText.match(/\s*$/)?.[0].length || 0);
  const nodes = enclosingNodes(source, start, end);
  let input: ParsedInput;
  if (!editor.selection.isEmpty) {
    input = parseInput(document.getText(editor.selection));
  } else {
    const declaration = [...nodes]
      .reverse()
      .find(
        (node): node is ts.VariableDeclaration =>
          ts.isVariableDeclaration(node) && !!node.initializer,
      );
    const literal = [...nodes]
      .reverse()
      .find(
        (
          node,
        ): node is ts.ObjectLiteralExpression | ts.ArrayLiteralExpression =>
          ts.isObjectLiteralExpression(node) ||
          ts.isArrayLiteralExpression(node),
      );
    const initializer =
      declaration?.initializer && unwrapExpression(declaration.initializer);
    const expression =
      initializer &&
      (ts.isObjectLiteralExpression(initializer) ||
        ts.isArrayLiteralExpression(initializer))
        ? declaration.initializer
        : literal;
    if (!expression) {
      throw new Error(
        "Select an object or declaration, or place the cursor inside its value.",
      );
    }
    input = parseInput(expression.getText(source));
    if (declaration && ts.isIdentifier(declaration.name)) {
      input.variableName = declaration.name.text;
    }
  }
  if (!input.variableName) {
    for (const node of [...nodes].reverse()) {
      if (
        ts.isPropertyAssignment(node) &&
        !ts.isComputedPropertyName(node.name)
      ) {
        input.variableName = node.name
          .getText(source)
          .replace(/^["']|["']$/g, "");
        break;
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        input.variableName = node.name.text;
        break;
      }
    }
  }
  const statement = [...nodes]
    .reverse()
    .find(
      (node) =>
        ts.isStatement(node) &&
        (ts.isSourceFile(node.parent) ||
          ts.isBlock(node.parent) ||
          ts.isCaseClause(node.parent) ||
          ts.isDefaultClause(node.parent)),
    );
  return {
    input,
    anchor: statement
      ? document.positionAt(statement.getStart(source))
      : editor.selection.start,
    topLevel: !statement || ts.isSourceFile(statement.parent),
  };
}

function declaredNames(
  document: vscode.TextDocument,
  exclude?: vscode.Range,
): string[] {
  const names = new Set(reservedTypeNames);
  const start = exclude ? document.offsetAt(exclude.start) : -1;
  const end = exclude ? document.offsetAt(exclude.end) : -1;
  function visit(node: ts.Node): void {
    if (
      !ts.isSourceFile(node) &&
      node.getStart() >= start &&
      node.getEnd() <= end
    ) {
      return;
    }
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isTypeParameterDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(documentSource(document));
  return [...names];
}

function findTrigger(
  document: vscode.TextDocument,
  fromLine: number,
): TriggerSource | undefined {
  for (
    let line = Math.min(fromLine, document.lineCount - 1);
    line >= 0;
    line--
  ) {
    const match = document
      .lineAt(line)
      .text.trim()
      .match(/^(type|interface)\s*([$A-Z_a-z][$\w]*)?\s*:\s*$/);
    if (!match) {
      continue;
    }
    const triggerOffset = document.offsetAt(
      new vscode.Position(line, document.lineAt(line).text.search(/\S/)),
    );
    if (insideTextOrComment(document, triggerOffset)) {
      continue;
    }
    const start = document.offsetAt(new vscode.Position(line + 1, 0));
    const tail = document.getText().slice(start, start + 1_000_000);
    // Parse the first initializer only, so following application code stays intact.
    const prefix = "const __autotypeInput = ";
    let source = parseSource(tail);
    let statement = source.statements[0];
    let length: number;
    if (statement && ts.isVariableStatement(statement)) {
      length = statement.getEnd();
    } else {
      source = parseSource(prefix + tail);
      statement = source.statements[0];
      if (!statement || !ts.isVariableStatement(statement)) {
        return undefined;
      }
      const initializer =
        statement.declarationList.declarations[0]?.initializer;
      if (!initializer) {
        return undefined;
      }
      const value = unwrapExpression(initializer);
      if (
        !ts.isObjectLiteralExpression(value) &&
        !ts.isArrayLiteralExpression(value)
      ) {
        return undefined;
      }
      length = initializer.getEnd() - prefix.length;
    }
    const input = parseInput(tail.slice(0, length));
    const remainder =
      tail.slice(length).match(/^[\t ]*;?[\t ]*(?:\r?\n|$)/)?.[0] || "";
    return {
      input,
      range: new vscode.Range(
        new vscode.Position(line, 0),
        document.positionAt(start + length + remainder.length),
      ),
      style: match[1] as "type" | "interface",
      name: match[2],
    };
  }
  return undefined;
}

function insideTextOrComment(
  document: vscode.TextDocument,
  offset: number,
): boolean {
  const context = enclosingNodes(documentSource(document), offset, offset);
  if (
    context.some(
      (node) =>
        ts.isStringLiteralLike(node) ||
        ts.isTemplateExpression(node) ||
        ts.isJsxText(node),
    )
  ) {
    return true;
  }
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    document.getText(),
  );
  let token: ts.SyntaxKind;
  while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
    if (scanner.getTextPos() > offset) {
      return (
        token === ts.SyntaxKind.MultiLineCommentTrivia ||
        token === ts.SyntaxKind.SingleLineCommentTrivia
      );
    }
  }
  return false;
}

async function generateFromSource(
  editor: vscode.TextEditor,
  forceFile: boolean,
): Promise<void> {
  const document = editor.document;
  const version = document.version;
  const source = findSource(editor);
  const config = vscode.workspace.getConfiguration("autotype", document.uri);
  const toFile =
    forceFile ||
    config.get<string>("outputLocation", "currentFile") === "newFile" ||
    !inlineLanguages.has(document.languageId);
  const options = readOptions(document);
  if (
    !toFile ||
    (config.get("addImport", false) && inlineLanguages.has(document.languageId))
  ) {
    options.reservedNames = declaredNames(document);
  }
  if (!toFile && !source.topLevel) {
    options.exportTypes = false;
  }
  const suggested = generateTypes(
    source.input,
    suggestRootName(source.input, document.fileName),
    options,
  ).rootName;
  const finalName = await vscode.window.showInputBox({
    title: "AutoType: Name the generated type",
    prompt:
      "Confirm or change the suggested name (including any configured prefix/suffix).",
    value: suggested,
    validateInput: (value) =>
      !isTypeName(value)
        ? "Enter a valid TypeScript type name."
        : options.reservedNames.includes(value)
          ? "This name is already declared in the source file."
          : undefined,
  });
  if (finalName === undefined) {
    return;
  }
  // The prompt already includes the root decorations; nested names still receive them.
  const result = generateTypes(source.input, finalName, options, false);
  assertUnchanged(document, version);
  if (toFile) {
    await writeTypesFile(editor, result.code, finalName, version, options);
    return;
  }
  const eol = lineEnding(document);
  const line = document.lineAt(source.anchor.line).text;
  const before = line.slice(0, source.anchor.character);
  const indent = before.match(/^\s*/)?.[0] || "";
  const atLineStart = before.trim().length === 0;
  const position = atLineStart
    ? new vscode.Position(source.anchor.line, 0)
    : source.anchor;
  const code = formatCode(result.code, document, indent);
  const success = await editor.edit((edit) =>
    edit.insert(
      position,
      atLineStart
        ? `${code}${eol}${eol}`
        : `${eol}${code}${eol}${eol}${indent}`,
    ),
  );
  if (!success) {
    throw new Error("Could not insert the generated types. Please try again.");
  }
  vscode.window.setStatusBarMessage(
    `AutoType: Generated ${finalName}; original data preserved`,
    5000,
  );
}

function assertUnchanged(document: vscode.TextDocument, version: number): void {
  if (document.isClosed || document.version !== version) {
    throw new Error(
      "The source changed while the prompt was open. Run the command again.",
    );
  }
}

async function writeTypesFile(
  editor: vscode.TextEditor,
  code: string,
  rootName: string,
  version: number,
  options: GeneratorOptions,
): Promise<void> {
  const document = editor.document;
  const folder = document.isUntitled
    ? vscode.workspace.workspaceFolders?.[0]?.uri
    : document.uri.with({ path: path.posix.dirname(document.uri.path) });
  const fileName =
    rootName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + ".types.ts";
  const target = await vscode.window.showSaveDialog({
    title: "AutoType: Save generated types",
    defaultUri: folder ? vscode.Uri.joinPath(folder, fileName) : undefined,
    filters: { TypeScript: ["ts"] },
  });
  if (!target) {
    return;
  }
  assertUnchanged(document, version);
  if (target.toString() === document.uri.toString()) {
    throw new Error(
      "Choose a separate file so your original data is preserved.",
    );
  }
  if (!target.path.endsWith(".ts")) {
    throw new Error("Choose a TypeScript file ending in .ts.");
  }
  const addImport = vscode.workspace
    .getConfiguration("autotype", document.uri)
    .get("addImport", false);
  const importNames = declaredNames(document);
  if (
    addImport &&
    inlineLanguages.has(document.languageId) &&
    importNames.includes(rootName)
  ) {
    throw new Error(
      `Cannot import ${rootName}: that name is already declared in the source file.`,
    );
  }
  const text = formatCode(code, document) + lineEnding(document);
  const edit = new vscode.WorkspaceEdit();
  // A separate file is created atomically; existing files are never overwritten.
  edit.createFile(target, { overwrite: false, ignoreIfExists: false });
  edit.insert(target, new vscode.Position(0, 0), text);
  if (addImport && inlineLanguages.has(document.languageId)) {
    if (!options.exportTypes) {
      throw new Error(
        "Enable autotype.exportTypes to add an import automatically.",
      );
    }
    if (
      document.isUntitled ||
      document.uri.scheme !== target.scheme ||
      document.uri.authority !== target.authority
    ) {
      throw new Error(
        "Save the source file beside the target workspace before adding an import.",
      );
    }
    let modulePath = path.posix
      .relative(path.posix.dirname(document.uri.path), target.path)
      .replace(/\.ts$/, "");
    if (!modulePath.startsWith(".")) {
      modulePath = "./" + modulePath;
    }
    const source = documentSource(document);
    const imports = source.statements.filter(ts.isImportDeclaration);
    const directives: ts.Statement[] = [];
    for (const statement of source.statements) {
      if (
        !ts.isExpressionStatement(statement) ||
        !ts.isStringLiteral(statement.expression)
      ) {
        break;
      }
      directives.push(statement);
    }
    const after = imports.at(-1) || directives.at(-1);
    const position = after
      ? document.positionAt(after.getEnd())
      : document.positionAt(
          document.lineAt(0).text.startsWith("#!")
            ? document.offsetAt(document.lineAt(0).rangeIncludingLineBreak.end)
            : 0,
        );
    const eol = lineEnding(document);
    edit.insert(
      document.uri,
      position,
      `${after ? eol : ""}import type { ${rootName} } from ${JSON.stringify(modulePath)};${eol}`,
    );
  }
  assertUnchanged(document, version);
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error(
      "Could not create the types file. Choose a new filename; existing files are preserved.",
    );
  }
  const created = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(created, { preview: false });
  if (!(await created.save())) {
    throw new Error(
      "The types file was opened but could not be saved. Save it from the editor.",
    );
  }
  vscode.window.setStatusBarMessage(
    `AutoType: Created ${path.posix.basename(target.path)}`,
    5000,
  );
}
