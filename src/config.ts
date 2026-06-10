import * as path from 'path';
import * as vscode from 'vscode';

export interface OmniMemoryConfig {
  databasePath: string;
  memoryDirectory: string;
  defaultConversationTool: string;
  maxDiffCharacters: number;
}

export function getConfig(): OmniMemoryConfig {
  const config = vscode.workspace.getConfiguration('omniMemory');

  return {
    databasePath: config.get<string>('databasePath', '.omnimemory/omnimemory.sqlite'),
    memoryDirectory: config.get<string>('memoryDirectory', '.memory'),
    defaultConversationTool: config.get<string>('defaultConversationTool', 'manual'),
    maxDiffCharacters: config.get<number>('maxDiffCharacters', 60000)
  };
}

export function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) {
    throw new Error('Open a workspace folder before using OmniMemory.');
  }

  return folder.uri.fsPath;
}

export function resolveWorkspacePath(root: string, configuredPath: string): string {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.join(root, configuredPath);
}
