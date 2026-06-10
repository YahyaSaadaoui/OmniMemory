import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, getWorkspaceRoot, resolveWorkspacePath } from './config';
import { captureGitContext } from './git/gitCapture';
import { createId } from './id';
import { overwriteMemoryMarkdown, renderMemoryCardMarkdown, writeMemoryMarkdown } from './memory/markdown';
import { synthesizeMemory } from './memory/synthesizer';
import { sanitizeEngineeringText } from './security/sanitizer';
import { SQLiteMemoryStore } from './storage/sqliteMemoryStore';
import { CapturedConversation, MemoryStatus, SearchResult } from './types';

let store: SQLiteMemoryStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('omniMemory.generateFromCurrentContext', () => runCommand(context, generateFromCurrentContext)),
    vscode.commands.registerCommand('omniMemory.searchMemories', () => runCommand(context, searchMemories)),
    vscode.commands.registerCommand('omniMemory.updateMemoryStatus', () => runCommand(context, updateMemoryStatus)),
    vscode.commands.registerCommand('omniMemory.openMemoryFolder', () => runCommand(context, openMemoryFolder))
  );
}

export function deactivate(): void {
  store?.close();
}

async function runCommand(
  context: vscode.ExtensionContext,
  command: (context: vscode.ExtensionContext) => Promise<void>
): Promise<void> {
  try {
    await command(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`OmniMemory failed: ${message}`);
  }
}

async function generateFromCurrentContext(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const config = getConfig();
  const activeText = readActiveEditorText();

  if (!activeText.trim()) {
    await vscode.window.showWarningMessage('Open an editor with conversation text, debugging notes, or selected reasoning before generating a memory.');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'OmniMemory is generating an engineering memory',
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: 'Capturing conversation and Git context...' });

      const conversation: CapturedConversation = {
        id: createId('conversation'),
        tool: config.defaultConversationTool,
        content: sanitizeEngineeringText(activeText),
        timestamp: new Date().toISOString()
      };
      const capturedCommit = await captureGitContext(root, config.maxDiffCharacters);
      const commit = {
        ...capturedCommit,
        diff: sanitizeEngineeringText(capturedCommit.diff),
        diffSummary: sanitizeEngineeringText(capturedCommit.diffSummary)
      };
      const db = await getStore(context);

      progress.report({ message: 'Synthesizing memory card...' });
      const draft = synthesizeMemory(conversation, commit);
      await db.insertConversation(conversation);
      await db.insertCommit(commit);
      const card = await db.insertMemoryCard(draft);

      progress.report({ message: 'Writing local memory artifacts...' });
      const memoryDirectory = resolveWorkspacePath(root, config.memoryDirectory);
      const markdownPath = await writeMemoryMarkdown(memoryDirectory, card);
      await db.setMarkdownPath(card.id, path.relative(root, markdownPath));
      const savedCard = db.getMemoryCard(card.id) ?? card;

      const action = await vscode.window.showInformationMessage(
        `OmniMemory saved "${savedCard.title}".`,
        'Open Memory Card',
        'Search Memories'
      );

      if (action === 'Open Memory Card') {
        await vscode.window.showTextDocument(vscode.Uri.file(markdownPath));
      } else if (action === 'Search Memories') {
        await searchMemories(context);
      }
    }
  );
}

async function searchMemories(context: vscode.ExtensionContext): Promise<void> {
  const query = await vscode.window.showInputBox({
    title: 'Search OmniMemory',
    prompt: 'Search for a problem, root cause, file, technology, or fix.',
    ignoreFocusOut: true
  });

  if (!query) {
    return;
  }

  const db = await getStore(context);
  const results = db.searchMemories(query);

  if (results.length === 0) {
    await vscode.window.showInformationMessage('No OmniMemory cards matched that search.');
    return;
  }

  const picked = await pickMemory(results, 'Open a memory card');
  if (!picked) {
    return;
  }

  await openMemory(context, picked.id);
}

async function updateMemoryStatus(context: vscode.ExtensionContext): Promise<void> {
  const db = await getStore(context);
  const results = db.listRecentMemories();

  if (results.length === 0) {
    await vscode.window.showInformationMessage('No OmniMemory cards exist yet.');
    return;
  }

  const picked = await pickMemory(results, 'Choose a memory card to update');
  if (!picked) {
    return;
  }

  const pickedStatus = await vscode.window.showQuickPick(
    (['Draft', 'Verified', 'Production Verified', 'Deprecated'] as MemoryStatus[]).map((status) => ({
      label: status,
      status
    })),
    {
      title: 'Set OmniMemory status',
      placeHolder: 'Verification status'
    }
  );

  if (!pickedStatus) {
    return;
  }

  const status = pickedStatus.status;
  const updated = await db.updateStatus(picked.id, status);
  if (!updated) {
    await vscode.window.showWarningMessage('That memory card no longer exists.');
    return;
  }

  const root = getWorkspaceRoot();
  if (updated.markdownPath) {
    await overwriteMemoryMarkdown(path.resolve(root, updated.markdownPath), updated);
  }

  await vscode.window.showInformationMessage(`OmniMemory marked "${updated.title}" as ${status}.`);
}

async function openMemoryFolder(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const config = getConfig();
  const memoryDirectory = resolveWorkspacePath(root, config.memoryDirectory);

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(memoryDirectory));
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(memoryDirectory));
}

async function openMemory(context: vscode.ExtensionContext, id: string): Promise<void> {
  const root = getWorkspaceRoot();
  const db = await getStore(context);
  const card = db.getMemoryCard(id);

  if (!card) {
    await vscode.window.showWarningMessage('That memory card no longer exists.');
    return;
  }

  if (card.markdownPath) {
    const absolutePath = path.resolve(root, card.markdownPath);
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(absolutePath));
      return;
    } catch {
      // Fall back to a virtual document if the Markdown artifact was moved.
    }
  }

  const document = await vscode.workspace.openTextDocument({
    content: renderMemoryCardMarkdown(card),
    language: 'markdown'
  });
  await vscode.window.showTextDocument(document);
}

async function getStore(context: vscode.ExtensionContext): Promise<SQLiteMemoryStore> {
  if (store) {
    return store;
  }

  const root = getWorkspaceRoot();
  const config = getConfig();
  store = new SQLiteMemoryStore(resolveWorkspacePath(root, config.databasePath), context.extensionPath);
  await store.init();

  return store;
}

function readActiveEditorText(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return '';
  }

  const selection = editor.selection;
  if (!selection.isEmpty) {
    return editor.document.getText(selection);
  }

  return editor.document.getText();
}

async function pickMemory(results: SearchResult[], title: string): Promise<SearchResult | undefined> {
  const items = results.map((result) => ({
    label: result.title,
    description: `${result.status} · ${Math.round(result.confidence * 100)}%`,
    detail: result.problem,
    result
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title,
    matchOnDescription: true,
    matchOnDetail: true
  });

  return picked?.result;
}
