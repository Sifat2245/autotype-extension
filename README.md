# AutoType

Generate TypeScript types and interfaces from JSON, JavaScript objects, initial state, and dummy data inside VS Code.

Select an existing object to generate types while keeping your data, or paste data below a `type:` / `interface:` trigger for automatic conversion.

## Features

- **JSON and JavaScript/TypeScript object support:** unquoted keys, single quotes, comments, trailing commas, and literal variable declarations.
- **Selection and cursor commands:** generate from a selected object or declaration, or place your cursor inside an existing variable's value.
- **Preserve original data:** insert declarations above your object without replacing its values.
- **Empty-state controls:** configurable defaults for empty arrays and `null`, plus property-specific type overrides.
- **Automatic names:** infer names from variables, object properties, or the current filename; confirm or rename before inserting.
- **Multiple-sample inference:** combine array samples, infer unions, and mark missing properties as optional.
- **Output preferences:** choose interfaces or type aliases, exports, readonly properties, indentation, and naming prefixes/suffixes.
- **Separate types files:** create a `.ts` file with an optional type-only import in the source.
- **Automatic paste conversion:** keep using `type:` and `interface:` triggers, including custom names.

## Requirements

- VS Code **1.93.0 or newer**.
- Insert types directly in TypeScript (`.ts`) and TypeScript React (`.tsx`) files.
- Commands also work in JavaScript, JavaScript React, JSON, and JSONC editors. Their output goes into a separate TypeScript file.

## Quick start: generate from an existing object

Given this code in a `.ts` or `.tsx` file:

```ts
const initialState = {
  name: '',
  count: 0,
  loading: false,
};
```

1. Select the object or the complete variable declaration. You can also place your cursor inside the variable's value.
2. Right-click and choose **AutoType: Generate Type (Keep Original)**.
3. Confirm the suggested name, `InitialState`, or enter another name.

AutoType inserts the declaration above the original code:

```ts
export interface InitialState {
  name: string;
  count: number;
  loading: boolean;
}

const initialState = {
  name: '',
  count: 0,
  loading: false,
};
```

The original object stays intact. AutoType does not add a type annotation to your variable; you can add `: InitialState` yourself when needed. Types inserted inside a function or block stay local and omit `export`.

## Automatic paste conversion

In a `.ts` or `.tsx` file, write a trigger on its own line, press Enter, and paste an object or array immediately below it:

```ts
interface User:
{
  id: 1,
  name: 'Sifat',
  tags: ['typescript', 'vscode'],
  address: {
    city: 'Dhaka',
  },
}
```

After a short pause, AutoType replaces the trigger and pasted data with:

```ts
export interface User {
  id: number;
  name: string;
  tags: string[];
  address: Address;
}

export interface Address {
  city: string;
}
```

Supported triggers:

```text
interface:
interface UserResponse:
type:
type ProductDto:
```

An explicit trigger chooses the declaration style, regardless of `autotype.defaultStyle`. Without a custom name, AutoType uses the pasted variable name, if present, or the current filename. Unlike the selection commands, triggers replace the input. Undo restores it. Incomplete or unsupported input is left in place.

## Commands and shortcut

Open the Command Palette and search for **AutoType**, or use the editor context menu.

| Command | Behavior |
| --- | --- |
| **AutoType: Convert JSON / Object to TypeScript** | Convert a nearby trigger when there is no selection; otherwise generate from the selection or the object at the cursor. |
| **AutoType: Generate Type (Keep Original)** | Generate from existing data, following the configured output destination. |
| **AutoType: Generate Types File** | Generate into a separate TypeScript file and leave the original data in place. |

**Windows/Linux:** `Ctrl+Alt+T` · **macOS:** `Cmd+Alt+T` runs the Convert command.

For JSON/JSONC, a command uses the selection, or the entire document when nothing is selected. For JavaScript/TypeScript, select one complete object, array, or variable declaration. With no selection, place the cursor inside a variable's initializer or a literal object/array.

## Empty arrays, null, and custom types

Empty values do not reveal their intended future types:

```ts
const initialState = {
  users: [],
  selectedUser: null,
};
```

By default, AutoType generates:

```ts
export interface InitialState {
  users: unknown[];
  selectedUser: null;
}
```

To supply the intended types, add overrides to your VS Code settings:

```json
{
  "autotype.typeOverrides": {
    "users": "User[]",
    "selectedUser": "User | null"
  }
}
```

Now those fields become `users: User[]` and `selectedUser: User | null`. Define or import `User` in the destination file yourself; AutoType does not resolve custom type references.

Use dot paths for nested properties and `[]` for array elements:

```json
{
  "autotype.typeOverrides": {
    "profile.tags": "string[]",
    "users[].id": "string",
    "items[]": "Product"
  }
}
```

Paths start at the input object's properties. When the root input is an array of object samples, paths start at each sample's properties. Overrides apply to matching paths in each conversion and take precedence over inferred types. Scope them to your workspace when appropriate.

For a general fallback, `autotype.emptyArrayType` sets the **element** type: `"string"` produces `string[]`. `autotype.nullType` sets the type contributed by a `null` value. The defaults are `"unknown"` and `"null"`.

## Inference from multiple samples

AutoType examines every object in an array:

```ts
const users = [
  { id: 1, name: 'Sifat', email: 'sifat@example.com' },
  { id: '2', name: 'Alex' },
];
```

Generated output:

```ts
export interface User {
  id: number | string;
  name: string;
  email?: string;
}
```

- Mixed sample values become unions, such as `number | string`.
- A property is optional when it is absent from at least one object sample.
- An explicitly present `null` or `undefined` remains part of the property's type; it does not make the property optional.
- Nested object samples are combined too. An empty array uses nonempty sibling samples when available.
- A root array of objects describes a single element type, such as `User`, for use as `User[]`.
- Empty, primitive, or mixed root arrays produce an array type alias, even when the preferred style is `interface`.
- Literal values widen to their basic types: `''` becomes `string`, `0` becomes `number`, and `false` becomes `boolean`.

## Create a separate types file

1. Select your data or place the cursor inside it.
2. Run **AutoType: Generate Types File**.
3. Confirm the type name.
4. Choose a new `.ts` filename, such as `user.types.ts`.

AutoType creates and opens the file. Existing files are never overwritten; choose a new filename if the target already exists. Cancel either prompt to leave your source unchanged.

Enable `autotype.addImport` to add an import to a saved `.ts`/`.tsx` source:

```ts
import type { User } from './user.types';
```

Automatic imports require `autotype.exportTypes: true`. They import the generated root type only. JavaScript and JSON sources remain unchanged. Set `autotype.outputLocation` to `"newFile"` to make separate files the default for selection commands.

## Settings

Search for **AutoType** in Settings, or edit `settings.json`.

| Setting | Default | Purpose |
| --- | --- | --- |
| `autotype.defaultStyle` | `"interface"` | Use `"interface"` or `"type"` for commands. |
| `autotype.exportTypes` | `true` | Export generated declarations at the top level. |
| `autotype.readonly` | `false` | Add readonly properties and use `ReadonlyArray<T>`. Explicit overrides remain as written. |
| `autotype.indentStyle` | `"spaces"` | Use `"spaces"` or `"tabs"`. |
| `autotype.indentSize` | `2` | Number of spaces per level, from 1 to 8. |
| `autotype.namePrefix` | `""` | Prefix inferred names, for example `I`. |
| `autotype.nameSuffix` | `""` | Suffix inferred names, for example `Dto`. |
| `autotype.emptyArrayType` | `"unknown"` | Fallback element type for empty arrays. |
| `autotype.nullType` | `"null"` | Type inferred from null values. |
| `autotype.typeOverrides` | `{}` | Full types for individual property paths. |
| `autotype.outputLocation` | `"currentFile"` | Use `"currentFile"` or `"newFile"` for commands. |
| `autotype.addImport` | `false` | Add a root type import when creating a file from saved TypeScript source. |

Prefixes and suffixes apply to inferred root and nested names. Explicit trigger names and names confirmed in the input box are used as written. Generated names receive numeric suffixes when necessary to avoid declaration conflicts. Paste triggers always replace the pasted input, independently of `outputLocation`.

Example preferences:

```json
{
  "autotype.defaultStyle": "type",
  "autotype.readonly": true,
  "autotype.nameSuffix": "Dto",
  "autotype.outputLocation": "newFile",
  "autotype.addImport": true
}
```

## Supported input and limits

AutoType reads literal data without executing your code. It supports objects, arrays, strings, numbers, booleans, bigint literals, `null`, and `undefined`, including comments and trailing commas. Single variable declarations using `const`, `let`, or `var` are accepted, including exported declarations and TypeScript annotations. Parentheses, `as const`, and `satisfies` wrappers are supported.

Variables used as values, shorthand properties, spreads, computed keys, methods, function calls, `new Date()`, interpolated templates, and other executable expressions are unsupported. Replace them with representative literal values before converting. Type annotations and assertions do not supply inference data; AutoType infers from the literal values.

Selections must contain one complete value or variable declaration. Each conversion accepts up to 1 MB of input and 100 levels of nesting. Custom type expressions are checked for syntax, but referenced types must be available in your project.

## License

[MIT](LICENSE.md)
