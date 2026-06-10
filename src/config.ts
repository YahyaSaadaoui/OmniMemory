import * as path from 'path';
import * as vscode from 'vscode';

export interface OmniMemoryConfig {
  databasePath: string;
  memoryDirectory: string;
  defaultConversationTool: string;
  conversationImportMaxCharacters: number;
  memoryGeneratorProvider: 'heuristic' | 'openai' | 'command';
  memoryGeneratorOpenAIModel: string;
  memoryGeneratorOpenAIEndpoint: string;
  memoryGeneratorOpenAIApiKeyEnvVar: string;
  memoryGeneratorCommand: string;
  memoryGeneratorTimeoutMs: number;
  memoryGeneratorMaxInputCharacters: number;
  maxDiffCharacters: number;
  enableCommitDetection: boolean;
  commitDetectionIntervalSeconds: number;
  verificationCommand: string;
  maxVerificationOutputCharacters: number;
  enableDiagnosticSimilaritySearch: boolean;
  diagnosticSimilarityMinScore: number;
  diagnosticSimilarityDebounceMs: number;
}

export function getConfig(): OmniMemoryConfig {
  const config = vscode.workspace.getConfiguration('omniMemory');

  return {
    databasePath: config.get<string>('databasePath', '.omnimemory/omnimemory.sqlite'),
    memoryDirectory: config.get<string>('memoryDirectory', '.memory'),
    defaultConversationTool: config.get<string>('defaultConversationTool', 'manual'),
    conversationImportMaxCharacters: config.get<number>('conversationImportMaxCharacters', 120000),
    memoryGeneratorProvider: config.get<'heuristic' | 'openai' | 'command'>('memoryGeneratorProvider', 'heuristic'),
    memoryGeneratorOpenAIModel: config.get<string>('memoryGeneratorOpenAIModel', 'gpt-5.5'),
    memoryGeneratorOpenAIEndpoint: config.get<string>('memoryGeneratorOpenAIEndpoint', 'https://api.openai.com/v1/responses'),
    memoryGeneratorOpenAIApiKeyEnvVar: config.get<string>('memoryGeneratorOpenAIApiKeyEnvVar', 'OPENAI_API_KEY'),
    memoryGeneratorCommand: config.get<string>('memoryGeneratorCommand', ''),
    memoryGeneratorTimeoutMs: config.get<number>('memoryGeneratorTimeoutMs', 60000),
    memoryGeneratorMaxInputCharacters: config.get<number>('memoryGeneratorMaxInputCharacters', 120000),
    maxDiffCharacters: config.get<number>('maxDiffCharacters', 60000),
    enableCommitDetection: config.get<boolean>('enableCommitDetection', true),
    commitDetectionIntervalSeconds: config.get<number>('commitDetectionIntervalSeconds', 20),
    verificationCommand: config.get<string>('verificationCommand', 'npm test'),
    maxVerificationOutputCharacters: config.get<number>('maxVerificationOutputCharacters', 8000),
    enableDiagnosticSimilaritySearch: config.get<boolean>('enableDiagnosticSimilaritySearch', true),
    diagnosticSimilarityMinScore: config.get<number>('diagnosticSimilarityMinScore', 20),
    diagnosticSimilarityDebounceMs: config.get<number>('diagnosticSimilarityDebounceMs', 1500)
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
