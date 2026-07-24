import * as vscode from 'vscode';

export function outputInfo(
  output: vscode.OutputChannel,
  message: string
): void {
  output.appendLine(`[info] ${message}`);
}

export function outputWarning(
  output: vscode.OutputChannel,
  message: string
): void {
  output.appendLine(`[warning] ${message}`);
}

export function outputError(
  output: vscode.OutputChannel,
  message: string
): void {
  output.appendLine(`[error] ${message}`);
}
