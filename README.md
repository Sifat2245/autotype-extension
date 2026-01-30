# TypeSnap - JSON to TypeScript Types

Automatically convert JSON objects to TypeScript types or interfaces in VS Code.

## Features

- Type `type:` or `interface:` on a line
- Paste JSON right below it
- Automatically converts to clean, extracted TypeScript code
- Supports custom names: `type UserResponse:` or `interface ApiError:`
- Undo with Ctrl+Z
- Status bar feedback on success

## Usage

1. In a `.ts` or `.tsx` file
2. Write `type:` (or `type User:`) on its own line
3. Press Enter
4. Paste your JSON response
5. Wait ~0.5 seconds → it auto-replaces with TypeScript code

## Requirements

- VS Code 1.93.0 or higher