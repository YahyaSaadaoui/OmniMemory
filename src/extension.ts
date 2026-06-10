import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig, getWorkspaceRoot, resolveWorkspacePath } from './config';
import { captureGitContext, getCurrentGitHead } from './git/gitCapture';
import { createId } from './id';
import { overwriteMemoryMarkdown, renderMemoryCardMarkdown, writeMemoryMarkdown } from './memory/markdown';
import { synthesizeMemory } from './memory/synthesizer';
import { sanitizeEngineeringText } from './security/sanitizer';
import { SQLiteMemoryStore } from './storage/sqliteMemoryStore';
import { CapturedConversation, MemoryStatus, SearchResult } from './types';
import { runVerificationCommand } from './verification/commandVerifier';

let store: SQLiteMemoryStore | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('omniMemory.generateFromCurrentContext', () => runCommand(context, generateFromCurrentContext)),
    vscode.commands.registerCommand('omniMemory.generateFromGitContext', () => runCommand(context, generateFromGitContext)),
    vscode.commands.registerCommand('omniMemory.searchMemories', () => runCommand(context, searchMemories)),
    vscode.commands.registerCommand('omniMemory.updateMemoryStatus', () => runCommand(context, updateMemoryStatus)),
    vscode.commands.registerCommand('omniMemory.verifyMemoryWithCommand', () => runCommand(context, verifyMemoryWithCommand)),
    vscode.commands.registerCommand('omniMemory.openMemoryFolder', () => runCommand(context, openMemoryFolder))
  );

  startCommitDetection(context);
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
  const activeText = readActiveEditorText();
  const conversationText = activeText.trim()
    ? activeText
    : await askForConversationFallback();

  if (conversationText === undefined) {
    return;
  }

  await generateMemory(context, conversationText, 'OmniMemory is generating an engineering memory');
}

async function generateFromGitContext(context: vscode.ExtensionContext): Promise<void> {
  await generateMemory(
    context,
    'No conversation text was captured. Synthesize this memory from Git context only.',
    'OmniMemory is generating a memory from Git context'
  );
}

async function generateMemory(
  context: vscode.ExtensionContext,
  rawConversationText: string,
  progressTitle: string
): Promise<void> {
  const root = getWorkspaceRoot();
  const config = getConfig();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle,
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: 'Capturing conversation and Git context...' });

      const conversation: CapturedConversation = {
        id: createId('conversation'),
        tool: config.defaultConversationTool,
        content: sanitizeEngineeringText(rawConversationText.trim() || 'No conversation text was captured.'),
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

async function verifyMemoryWithCommand(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const config = getConfig();
  const db = await getStore(context);
  const results = db.listRecentMemories();

  if (results.length === 0) {
    await vscode.window.showInformationMessage('No OmniMemory cards exist yet.');
    return;
  }

  const picked = await pickMemory(results, 'Choose a memory card to verify');
  if (!picked) {
    return;
  }

  const command = await vscode.window.showInputBox({
    title: 'Verify OmniMemory',
    prompt: 'Run a local command and attach the result as verification evidence.',
    value: config.verificationCommand,
    ignoreFocusOut: true
  });

  if (!command?.trim()) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'OmniMemory is verifying memory evidence',
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: command });

      const result = await runVerificationCommand(command, root, config.maxVerificationOutputCharacters);
      await db.addVerificationEvent({
        memoryId: picked.id,
        kind: 'command',
        command,
        exitCode: result.exitCode,
        output: result.output
      });

      const updated = result.exitCode === 0
        ? await db.updateStatus(picked.id, 'Verified')
        : db.getMemoryCard(picked.id);

      if (!updated) {
        await vscode.window.showWarningMessage('That memory card no longer exists.');
        return;
      }

      if (updated.markdownPath) {
        await overwriteMemoryMarkdown(path.resolve(root, updated.markdownPath), updated);
      }

      const message = result.exitCode === 0
        ? `OmniMemory verified "${updated.title}".`
        : `OmniMemory recorded failed verification for "${updated.title}".`;
      const action = await vscode.window.showInformationMessage(message, 'Open Memory Card');

      if (action === 'Open Memory Card') {
        await openMemory(context, updated.id);
      }
    }
  );
}

async function openMemoryFolder(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const config = getConfig();
  const memoryDirectory = resolveWorkspacePath(root, config.memoryDirectory);

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(memoryDirectory));
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(memoryDirectory));
}

function startCommitDetection(context: vscode.ExtensionContext): void {
  const config = getConfig();
  if (!config.enableCommitDetection || !vscode.workspace.workspaceFolders?.length) {
    return;
  }

  let lastSeenHead: string | null | undefined;
  let promptInFlight = false;

  const checkHead = async () => {
    const root = getWorkspaceRoot();
    const currentHead = await getCurrentGitHead(root);

    if (!currentHead) {
      lastSeenHead = null;
      return;
    }

    if (lastSeenHead === undefined) {
      lastSeenHead = currentHead;
      return;
    }

    if (lastSeenHead === currentHead || promptInFlight) {
      return;
    }

    lastSeenHead = currentHead;
    promptInFlight = true;
    try {
      const action = await vscode.window.showInformationMessage(
        'OmniMemory detected a new Git commit.',
        'Generate Memory',
        'Ignore'
      );

      if (action === 'Generate Memory') {
        await generateFromCurrentContext(context);
      }
    } finally {
      promptInFlight = false;
    }
  };

  checkHead().catch(() => undefined);

  const intervalMs = Math.max(5, config.commitDetectionIntervalSeconds) * 1000;
  const timer = setInterval(() => {
    checkHead().catch(() => undefined);
  }, intervalMs);

  context.subscriptions.push({
    dispose: () => clearInterval(timer)
  });
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

async function askForConversationFallback(): Promise<string | undefined> {
  const note = await vscode.window.showInputBox({
    title: 'Capture OmniMemory Context',
    prompt: 'Add a short problem, root cause, or fix note. Leave empty to use Git context only.',
    ignoreFocusOut: true
  });

  if (note === undefined) {
    return undefined;
  }

  return note.trim() || 'No conversation text was captured. Synthesize this memory from Git context only.';
}

async function pickMemory(results: SearchResult[], title: string): Promise<SearchResult | undefined> {
  const items = results.map((result) => ({
    label: result.title,
    description: formatSearchDescription(result),
    detail: result.matchedFields?.length
      ? `${result.problem} · Matched: ${result.matchedFields.join(', ')}`
      : result.problem,
    result
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title,
    matchOnDescription: true,
    matchOnDetail: true
  });

  return picked?.result;
}

function formatSearchDescription(result: SearchResult): string {
  const parts = [
    result.status,
    `${Math.round(result.confidence * 100)}%`
  ];

  if (result.score !== undefined) {
    parts.push(`score ${result.score}`);
  }

  return parts.join(' · ');
}
