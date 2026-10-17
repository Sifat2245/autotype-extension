# Change Log

All notable changes to AutoType are documented here.

## [1.1.0] - 2026-10-17

- Isolate local development from installed extensions to prevent duplicate AutoType commands from blocking activation.
- Match the publisher identity of the installed extension from this repository so the local copy replaces it during development.
- Add a debugger-free local launcher and tests that exercise commands in a real VS Code extension host.
- Support JavaScript/TypeScript object literals, initial state, and mock data alongside JSON.
- Add selection/cursor conversion that preserves source data, variable-based names, and custom naming prompts.
- Infer unions and optional properties from multiple samples, including nested objects and arrays.
- Add configurable empty-array/null fallbacks, property-path overrides, output styles, readonly generation, indentation, and naming options.
- Create separate types files with optional type-only imports; preserve existing files.
- Extend commands to JavaScript, JSX, JSON, and JSONC with TypeScript file output.
- Preserve automatic paste triggers, fix the edit guard, and keep following application code intact.
- Document commands, settings, supported inputs, and limits; add converter and editor workflow tests.

## [1.0.1]

- Automatic JSON conversion with named `type:` and `interface:` triggers.
