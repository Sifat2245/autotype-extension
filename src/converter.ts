import * as ts from "typescript";

export type StaticValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | StaticValue[]
  | { [key: string]: StaticValue };

export interface ParsedInput {
  value: StaticValue[] | { [key: string]: StaticValue };
  variableName?: string;
}

export interface GeneratorOptions {
  style: "interface" | "type";
  exportTypes: boolean;
  readonly: boolean;
  indent: string;
  namePrefix: string;
  nameSuffix: string;
  emptyArrayType: string;
  nullType: string;
  typeOverrides: Record<string, string>;
  reservedNames: string[];
}

export const defaultOptions: GeneratorOptions = {
  style: "interface",
  exportTypes: true,
  readonly: false,
  indent: "  ",
  namePrefix: "",
  nameSuffix: "",
  emptyArrayType: "unknown",
  nullType: "null",
  typeOverrides: {},
  reservedNames: [],
};

export function parseSource(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "input.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function assertSyntax(source: ts.SourceFile): void {
  const diagnostics = (
    source as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (diagnostics.length) {
    throw new Error(
      ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " "),
    );
  }
}

export function unwrapExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/** Read literal data without executing any of the supplied JavaScript. */
export function parseInput(text: string): ParsedInput {
  if (text.length > 1_000_000) {
    throw new Error("Select less than 1 MB of data at a time.");
  }
  const trimmed = text.trim().replace(/;\s*$/, "");
  let source = parseSource(trimmed);
  let expression: ts.Expression | undefined;
  let variableName: string | undefined;
  const statement = source.statements[0];
  if (statement && ts.isVariableStatement(statement)) {
    assertSyntax(source);
    if (
      source.statements.length !== 1 ||
      statement.declarationList.declarations.length !== 1
    ) {
      throw new Error(
        "Select one object or one variable declaration at a time.",
      );
    }
    const declaration = statement.declarationList.declarations[0];
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      throw new Error(
        "Select a named variable with an object or array initializer.",
      );
    }
    variableName = declaration.name.text;
    expression = declaration.initializer;
  } else {
    // Parentheses make a bare object an expression rather than a block statement.
    source = parseSource(`const __autotypeInput = (\n${trimmed}\n);`);
    assertSyntax(source);
    const wrapped = source.statements[0];
    if (
      source.statements.length !== 1 ||
      !ts.isVariableStatement(wrapped) ||
      wrapped.declarationList.declarations.length !== 1
    ) {
      throw new Error("Select a complete object or array literal.");
    }
    expression = wrapped.declarationList.declarations[0].initializer;
  }
  if (!expression) {
    throw new Error("Select an object or array literal.");
  }
  expression = unwrapExpression(expression);
  if (
    !ts.isObjectLiteralExpression(expression) &&
    !ts.isArrayLiteralExpression(expression)
  ) {
    throw new Error("The input must be an object or array literal.");
  }
  return {
    value: readValue(expression, "", 0) as ParsedInput["value"],
    variableName,
  };
}

function readValue(
  input: ts.Expression,
  path: string,
  depth: number,
): StaticValue {
  if (depth > 100) {
    throw new Error("The object is nested too deeply (maximum 100 levels).");
  }
  const node = unwrapExpression(input);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isNumericLiteral(node)) {
    return Number(node.text);
  }
  if (ts.isBigIntLiteral(node)) {
    return BigInt(node.text.slice(0, -1).replace(/_/g, ""));
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (node.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return null;
  }
  if (ts.isIdentifier(node) && node.text === "undefined") {
    return undefined;
  }
  if (
    ts.isPrefixUnaryExpression(node) &&
    (node.operator === ts.SyntaxKind.MinusToken ||
      node.operator === ts.SyntaxKind.PlusToken)
  ) {
    const operand = readValue(node.operand, path, depth + 1);
    if (typeof operand === "number") {
      return node.operator === ts.SyntaxKind.MinusToken ? -operand : operand;
    }
    if (
      typeof operand === "bigint" &&
      node.operator === ts.SyntaxKind.MinusToken
    ) {
      return -operand;
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) =>
      readValue(element, `${path}[]`, depth + 1),
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, StaticValue> = Object.create(null);
    for (const property of node.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        ts.isComputedPropertyName(property.name)
      ) {
        throw new Error(
          `Unsupported property at ${path || "the root"}. Use explicit literal values; spreads, shorthand, methods, and computed keys are not supported.`,
        );
      }
      const key =
        ts.isIdentifier(property.name) ||
        ts.isStringLiteral(property.name) ||
        ts.isNumericLiteral(property.name)
          ? property.name.text
          : undefined;
      if (key === undefined) {
        throw new Error(`Unsupported property name at ${path || "the root"}.`);
      }
      result[key] = readValue(
        property.initializer,
        path ? `${path}.${key}` : key,
        depth + 1,
      );
    }
    return result;
  }
  throw new Error(
    `Unsupported expression at ${path || "the root"}. Use literal data instead of variables, function calls, or executable expressions.`,
  );
}

export const reservedTypeNames = ["Array", "ReadonlyArray", "Record"];

const forbiddenNames = new Set([
  "any",
  "unknown",
  "never",
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "object",
  "undefined",
  "null",
  "void",
]);

export function isTypeName(name: string): boolean {
  if (!/^[$A-Z_a-z][$\w]*$/.test(name) || forbiddenNames.has(name)) {
    return false;
  }
  const source = parseSource(`type ${name} = unknown;`);
  try {
    assertSyntax(source);
    return (
      source.statements.length === 1 &&
      ts.isTypeAliasDeclaration(source.statements[0]) &&
      source.statements[0].name.text === name
    );
  } catch {
    return false;
  }
}

export function toTypeName(text: string): string {
  const name =
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9_$]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join("") || "Root";
  return /^\d/.test(name) ? `Type${name}` : name;
}

export function singularize(name: string): string {
  const irregular: Record<string, string> = {
    people: "person",
    children: "child",
    data: "data",
  };
  const lower = name.toLowerCase();
  if (irregular[lower]) {
    return irregular[lower];
  }
  if (/ies$/i.test(name)) {
    return name.slice(0, -3) + "y";
  }
  if (/(sses|shes|ches|xes|zes)$/i.test(name)) {
    return name.slice(0, -2);
  }
  return /s$/i.test(name) && !/(ss|us|is)$/i.test(name)
    ? name.slice(0, -1)
    : name;
}

export function validateTypeExpression(value: string): boolean {
  if (!value.trim()) {
    return false;
  }
  try {
    const source = parseSource(`type __AutoType = ${value};`);
    assertSyntax(source);
    return (
      source.statements.length === 1 &&
      ts.isTypeAliasDeclaration(source.statements[0])
    );
  } catch {
    return false;
  }
}

export function suggestRootName(input: ParsedInput, fileName: string): string {
  const base =
    input.variableName ||
    fileName
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") ||
    "Root";
  return toTypeName(Array.isArray(input.value) ? singularize(base) : base);
}

interface Declaration {
  name: string;
  fields?: { name: string; optional: boolean; type: string }[];
  type?: string;
}

function isObject(value: StaticValue): value is Record<string, StaticValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function generateTypes(
  input: ParsedInput,
  rootName: string,
  overrides: Partial<GeneratorOptions> = {},
  decorateRootName = true,
): { code: string; rootName: string; names: string[] } {
  const options = { ...defaultOptions, ...overrides };
  if (!isTypeName(rootName)) {
    throw new Error(`Invalid type name: ${rootName}`);
  }
  for (const [label, value] of Object.entries({
    emptyArrayType: options.emptyArrayType,
    nullType: options.nullType,
    ...options.typeOverrides,
  })) {
    if (typeof value !== "string" || !validateTypeExpression(value)) {
      throw new Error(`Invalid type expression for ${label}.`);
    }
  }
  const declarations: Declaration[] = [];
  const usedNames = new Set([...reservedTypeNames, ...options.reservedNames]);

  function allocate(base: string, decorate = true): string {
    const desired = decorate
      ? `${options.namePrefix}${toTypeName(base)}${options.nameSuffix}`
      : base;
    if (!isTypeName(desired)) {
      throw new Error(
        `The configured prefix/suffix produces an invalid name: ${desired}`,
      );
    }
    let name = desired;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${desired}${suffix++}`;
    }
    usedNames.add(name);
    return name;
  }

  function objectType(
    values: Record<string, StaticValue>[],
    suggested: string,
    path: string,
    existing?: Declaration,
  ): string {
    const declaration = existing || { name: allocate(suggested) };
    if (!existing) {
      declarations.push(declaration);
    }
    const keys = [...new Set(values.flatMap((value) => Object.keys(value)))];
    declaration.fields = keys.map((key) => {
      const present = values.filter((value) => Object.hasOwn(value, key));
      return {
        name: key,
        optional: present.length !== values.length,
        type: infer(
          present.map((value) => value[key]),
          toTypeName(key),
          path ? `${path}.${key}` : key,
        ),
      };
    });
    return declaration.name;
  }

  function arrayOf(element: string): string {
    const alias = parseSource(`type Element = ${element};`)
      .statements[0] as ts.TypeAliasDeclaration;
    const type = alias.type;
    const needsParens =
      ts.isUnionTypeNode(type) ||
      ts.isIntersectionTypeNode(type) ||
      ts.isFunctionTypeNode(type) ||
      ts.isConstructorTypeNode(type) ||
      ts.isConditionalTypeNode(type) ||
      ts.isTypeOperatorNode(type);
    const wrapped = needsParens ? `(${element})` : element;
    return options.readonly ? `ReadonlyArray<${element}>` : `${wrapped}[]`;
  }

  function infer(
    values: StaticValue[],
    suggested: string,
    path: string,
  ): string {
    if (Object.hasOwn(options.typeOverrides, path)) {
      return options.typeOverrides[path];
    }
    const types: string[] = [];
    const objects = values.filter(isObject);
    if (objects.length) {
      types.push(objectType(objects, suggested, path));
    }
    const arrays = values.filter((value): value is StaticValue[] =>
      Array.isArray(value),
    );
    if (arrays.length) {
      const elements = arrays.flat();
      const elementType = elements.length
        ? infer(elements, toTypeName(singularize(suggested)), `${path}[]`)
        : options.typeOverrides[`${path}[]`] || options.emptyArrayType;
      types.push(arrayOf(elementType));
    }
    for (const value of values) {
      if (value === null) {
        types.push(options.nullType);
      } else if (typeof value !== "object") {
        types.push(typeof value);
      }
    }
    return [...new Set(types)].join(" | ") || "unknown";
  }

  const root: Declaration = { name: allocate(rootName, decorateRootName) };
  declarations.push(root);
  if (isObject(input.value)) {
    objectType([input.value], rootName, "", root);
  } else if (input.value.length && input.value.every(isObject)) {
    objectType(input.value, rootName, "", root);
  } else {
    root.type = infer([input.value], `${rootName}Item`, "");
  }
  const exported = options.exportTypes ? "export " : "";
  const code = declarations
    .map((declaration) => {
      if (!declaration.fields) {
        return `${exported}type ${declaration.name} = ${declaration.type};`;
      }
      const fields = declaration.fields
        .map((field) => {
          const key = /^[$A-Z_a-z][$\w]*$/.test(field.name)
            ? field.name
            : JSON.stringify(field.name);
          return `${options.indent}${options.readonly ? "readonly " : ""}${key}${field.optional ? "?" : ""}: ${field.type};`;
        })
        .join("\n");
      const objectBody = fields ? `{\n${fields}\n}` : "{}";
      return options.style === "type"
        ? `${exported}type ${declaration.name} = ${objectBody};`
        : `${exported}interface ${declaration.name} ${objectBody}`;
    })
    .join("\n\n");
  return {
    code,
    rootName: root.name,
    names: declarations.map((declaration) => declaration.name),
  };
}
