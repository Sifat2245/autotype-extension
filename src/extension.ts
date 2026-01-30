import JsonToTS from "json-to-ts";
import * as vscode from "vscode";

export const activate = (context: vscode.ExtensionContext) => {
  let isApplyingEdit = false;

  const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
    // If the change is not in the active editor, do nothing
    if (event.contentChanges.length === 0) {
      return;
    }

    const change = event.contentChanges[0];
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) {
      return;
    }

    if (
      change.text.length > 20 ||
      change.text.includes("\n") ||
      change.range.start.line !== change.range.end.line
    ) {
      tryConvertAfterTrigger(editor, isApplyingEdit);
    }
  });

  context.subscriptions.push(disposable);

  //register a command for manual testing
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand("typesnap.convert", (editor) => {
      tryConvertAfterTrigger(editor, isApplyingEdit);
    }),
  );
};

const tryConvertAfterTrigger = (
  editor: vscode.TextEditor,
  isApplyingEdit: boolean,
) => {
  if (isApplyingEdit) {
    return;
  }

  const doc = editor.document;
  const cursorPos = editor.selection.active;

  let triggerLine = -1;
  let triggerType: "type" | "interface" | null = null;
  let customName: string | null = null;

  // Look for the trigger line
  for (let i = cursorPos.line; i >= Math.max(0, cursorPos.line - 30); i--) {
    const line = doc.lineAt(i).text.trim();

    const typeMatch = line.match(/^(type)\s*([A-Za-z0-9_]+)?\s*:\s*$/);
    const ifaceMatch = line.match(/^(interface)\s*([A-Za-z0-9_]+)?\s*:\s*$/);

    // If we find a match, set the trigger line
    if (typeMatch) {
      triggerLine = i;
      triggerType = "type";
      customName = typeMatch[2] || null;
      break;
    }
    if (ifaceMatch) {
      triggerLine = i;
      triggerType = "interface";
      customName = ifaceMatch[2] || null;
      break;
    }
  }

  if (triggerLine === -1 || !triggerType) {
    return;
  }

  const jsonStringLine = triggerLine + 1;
  const jsonBlock = extractJsonBlock(doc, jsonStringLine);

  if (!jsonBlock) {
    return;
  }

  try {
    const json = JSON.parse(jsonBlock.text);
    const rootName = customName || inferRootName(doc.fileName);

    const options = {
      rootName,
      useTypeAlias: triggerType === "type",
      indentStyle: "space",
      indentSize: 2,
      optionalFields: true,
      addComments: false,
      prefix: "",
    };

    // Convert JSON to TS
    let tsLines = JsonToTS(json, options);
    tsLines = tsLines.map((line) => {
      if (line.startsWith("interface ") || line.startsWith("type ")) {
        return "export " + line;
      }
      return line;
    });
    const generatedCode = tsLines.join("\n\n");

    isApplyingEdit = true;

    // Apply the edit
    editor
      .edit((editBuilder) => {
        const replaceRange = new vscode.Range(
          triggerLine,
          0,
          jsonBlock.endLine + 1,
          0,
        );
        editBuilder.replace(replaceRange, generatedCode + "\n");
      })
      .then((success) => {
        isApplyingEdit = false;
        if (success) {
          vscode.window.setStatusBarMessage(
            `TypeSnap: Converted to ${triggerType} ${rootName} (Ctrl+Z to undo)`,
            8000,
          );
        } else {
          vscode.window.showErrorMessage("TypeSnap: Could not apply edit");
        }
      });
  } catch (err) {
    vscode.window.showWarningMessage(
      "TypeSnap: Invalid JSON – skipping conversion",
    );
  }
};

const extractJsonBlock = (
  doc: vscode.TextDocument,
  startLine: number,
): { text: string; endLine: number } | null => {
  let accumulated = "";
  let endLine = -1;

  for (let i = startLine; i < doc.lineCount && i < startLine + 500; i++) {
    const lineText = doc.lineAt(i).text;
    accumulated += lineText + "\n";

    try {
      JSON.parse(accumulated.trim());
      endLine = i;
      break;
    } catch {
      // continue
    }
  }
  if (endLine === -1) {
    return null;
  }
  return { text: accumulated.trim(), endLine };
};

function inferRootName(filePath: string): string {
  const file = filePath.split("/").pop() || "Root";
  const base = file.replace(/\.(ts|tsx)$/, "");
  const name = base.split("-")[0];
  return capitalize(name);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}