import * as path from 'path';
import * as vscode from 'vscode';
import { detectConversationTool, normalizeImportedConversation } from './capture/importedConversation';
import { getConfig, getWorkspaceRoot, resolveWorkspacePath } from './config';
import { captureGitContext, getCurrentGitHead, GitCaptureMode } from './git/gitCapture';
import { createId } from './id';
import { generateMemoryDraft } from './memory/generator';
import { overwriteMemoryMarkdown, renderMemoryCardMarkdown, writeMemoryMarkdown } from './memory/markdown';
import { parseMemoryMarkdown } from './memory/markdownParser';
import { sanitizeEngineeringText } from './security/sanitizer';
import { SQLiteMemoryStore } from './storage/sqliteMemoryStore';
import { CapturedConversation, MemoryStatus, SearchResult } from './types';
import { buildRetrievalQuery } from './retrieval/contextQuery';
import { buildSimilaritySuggestionKey, shouldSuggestSimilarMemory } from './retrieval/similaritySuggestion';
import { runVerificationCommand } from './verification/commandVerifier';
import { MemoryExplorerProvider } from './views/memoryExplorer';

let store: SQLiteMemoryStore | undefined;
let memoryExplorerProvider: MemoryExplorerProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  memoryExplorerProvider = new MemoryExplorerProvider(() => getStore(context));

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('omniMemory.memories', memoryExplorerProvider),
    vscode.commands.registerCommand('omniMemory.generateFromCurrentContext', () => runCommand(context, generateFromCurrentContext)),
    vscode.commands.registerCommand('omniMemory.generateFromGitContext', () => runCommand(context, generateFromGitContext)),
    vscode.commands.registerCommand('omniMemory.generateFromLastCommit', () => runCommand(context, generateFromLastCommit)),
    vscode.commands.registerCommand('omniMemory.generateFromClipboard', () => runCommand(context, generateFromClipboard)),
    vscode.commands.registerCommand('omniMemory.importConversationTranscript', () => runCommand(context, importConversationTranscript)),
    vscode.commands.registerCommand('omniMemory.searchMemories', () => runCommand(context, searchMemories)),
    vscode.commands.registerCommand('omniMemory.findSimilarFromContext', () => runCommand(context, findSimilarFromContext)),
    vscode.commands.registerCommand('omniMemory.updateMemoryStatus', () => runCommand(context, updateMemoryStatus)),
    vscode.commands.registerCommand('omniMemory.verifyMemoryWithCommand', () => runCommand(context, verifyMemoryWithCommand)),
    vscode.commands.registerCommand('omniMemory.reviewMemoryQueue', () => runCommand(context, reviewMemoryQueue)),
    vscode.commands.registerCommand('omniMemory.syncActiveMemoryMarkdown', () => runCommand(context, syncActiveMemoryMarkdown)),
    vscode.commands.registerCommand('omniMemory.refreshRelatedMemories', () => runCommand(context, refreshRelatedMemories)),
    vscode.commands.registerCommand('omniMemory.openMemory', (input?: unknown) => runCommand(context, () => openMemoryCommand(context, input))),
    vscode.commands.registerCommand('omniMemory.refreshExplorer', () => refreshMemoryExplorer()),
    vscode.commands.registerCommand('omniMemory.openMemoryFolder', () => runCommand(context, openMemoryFolder))
  );

  startCommitDetection(context);
  startDiagnosticSimilaritySearch(context);
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

async function generateFromClipboard(context: vscode.ExtensionContext): Promise<void> {
  const config = getConfig();
  const clipboardText = normalizeImportedConversation(
    await vscode.env.clipboard.readText(),
    config.conversationImportMaxCharacters
  );

  if (!clipboardText) {
    await vscode.window.showWarningMessage('Clipboard does not contain conversation text.');
    return;
  }

  const tool = await chooseConversationTool(detectConversationTool(clipboardText));
  if (!tool) {
    return;
  }

  await generateMemory(
    context,
    clipboardText,
    'OmniMemory is generating a memory from clipboard',
    tool
  );
}

async function importConversationTranscript(context: vscode.ExtensionContext): Promise<void> {
  const config = getConfig();
  const uris = await vscode.window.showOpenDialog({
    title: 'Import OmniMemory Conversation Transcript',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      Conversations: ['md', 'txt', 'log', 'json', 'jsonl']
    }
  });
  const uri = uris?.[0];

  if (!uri) {
    return;
  }

  const bytes = await vscode.workspace.fs.readFile(uri);
  const content = normalizeImportedConversation(
    Buffer.from(bytes).toString('utf8'),
    config.conversationImportMaxCharacters
  );

  if (!content) {
    await vscode.window.showWarningMessage('Selected transcript file is empty.');
    return;
  }

  const tool = await chooseConversationTool(detectConversationTool(content, path.basename(uri.fsPath)));
  if (!tool) {
    return;
  }

  await generateMemory(
    context,
    content,
    'OmniMemory is importing a conversation transcript',
    tool
  );
}

async function generateFromGitContext(context: vscode.ExtensionContext): Promise<void> {
  await generateMemory(
    context,
    'No conversation text was captured. Synthesize this memory from Git context only.',
    'OmniMemory is generating a memory from Git context'
  );
}

async function generateFromLastCommit(context: vscode.ExtensionContext): Promise<void> {
  const activeText = readActiveEditorText();
  const conversationText = activeText.trim()
    ? activeText
    : await askForConversationFallback();

  if (conversationText === undefined) {
    return;
  }

  await generateMemory(
    context,
    conversationText,
    'OmniMemory is generating a memory from the last Git commit',
    undefined,
    'last-commit'
  );
}

async function generateMemory(
  context: vscode.ExtensionContext,
  rawConversationText: string,
  progressTitle: string,
  conversationTool?: string,
  gitCaptureMode: GitCaptureMode = 'auto'
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
        tool: conversationTool ?? config.defaultConversationTool,
        content: sanitizeEngineeringText(rawConversationText.trim() || 'No conversation text was captured.'),
        timestamp: new Date().toISOString()
      };
      const capturedCommit = await captureGitContext(root, config.maxDiffCharacters, gitCaptureMode);
      const commit = {
        ...capturedCommit,
        diff: sanitizeEngineeringText(capturedCommit.diff),
        diffSummary: sanitizeEngineeringText(capturedCommit.diffSummary)
      };
      const db = await getStore(context);

      if (await shouldSkipDuplicateCleanCommit(context, db, commit)) {
        return;
      }

      progress.report({ message: 'Synthesizing memory card...' });
      const generation = await generateMemoryDraft(conversation, commit, {
        provider: config.memoryGeneratorProvider,
        openAIModel: config.memoryGeneratorOpenAIModel,
        openAIEndpoint: config.memoryGeneratorOpenAIEndpoint,
        openAIApiKeyEnvVar: config.memoryGeneratorOpenAIApiKeyEnvVar,
        command: config.memoryGeneratorCommand,
        timeoutMs: config.memoryGeneratorTimeoutMs,
        maxInputCharacters: config.memoryGeneratorMaxInputCharacters
      });
      await db.insertConversation(conversation);
      await db.insertCommit(commit);
      const card = await db.insertMemoryCard(generation.draft);

      progress.report({ message: 'Writing local memory artifacts...' });
      const memoryDirectory = resolveWorkspacePath(root, config.memoryDirectory);
      const markdownPath = await writeMemoryMarkdown(memoryDirectory, card);
      await db.setMarkdownPath(card.id, path.relative(root, markdownPath));
      await db.refreshSimilarMemoryLinks(card.id);
      const savedCard = db.getMemoryCard(card.id) ?? card;
      await overwriteMemoryMarkdown(markdownPath, savedCard);
      refreshMemoryExplorer();

      if (generation.fallbackReason) {
        await vscode.window.showWarningMessage(`OmniMemory used heuristic generation after ${config.memoryGeneratorProvider} failed: ${generation.fallbackReason}`);
      }

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

async function findSimilarFromContext(context: vscode.ExtensionContext): Promise<void> {
  const query = buildQueryFromActiveEditor();

  if (!query) {
    await vscode.window.showWarningMessage('Select an error, log, stack trace, or code path before searching OmniMemory.');
    return;
  }

  const db = await getStore(context);
  const results = db.searchMemories(query, 10);

  if (results.length === 0) {
    const action = await vscode.window.showInformationMessage(
      'No similar OmniMemory cards matched the active context.',
      'Generate Memory'
    );

    if (action === 'Generate Memory') {
      await generateFromCurrentContext(context);
    }
    return;
  }

  const picked = await pickMemory(results, 'Similar OmniMemory cards');
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

  refreshMemoryExplorer();
  await vscode.window.showInformationMessage(`OmniMemory marked "${updated.title}" as ${status}.`);
}

async function reviewMemoryQueue(context: vscode.ExtensionContext): Promise<void> {
  const db = await getStore(context);
  const results = db.listReviewQueue();

  if (results.length === 0) {
    await vscode.window.showInformationMessage('No OmniMemory cards need review.');
    return;
  }

  const picked = await pickMemory(results, 'Review low-confidence or Draft memories');
  if (!picked) {
    return;
  }

  await openMemory(context, picked.id);
}

async function syncActiveMemoryMarkdown(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage('Open an OmniMemory Markdown card before syncing.');
    return;
  }

  if (editor.document.uri.scheme === 'file' && editor.document.isDirty) {
    const saved = await editor.document.save();
    if (!saved) {
      await vscode.window.showWarningMessage('Save the active Markdown card before syncing it.');
      return;
    }
  }

  const root = getWorkspaceRoot();
  const db = await getStore(context);
  const parsed = parseMemoryMarkdown(editor.document.getText());
  const updated = await db.updateMemoryCardContent(parsed.memoryId, parsed.update);

  if (!updated) {
    await vscode.window.showWarningMessage('No OmniMemory card matched the active Markdown Memory ID.');
    return;
  }

  let targetPath = updated.markdownPath ? path.resolve(root, updated.markdownPath) : undefined;

  if (editor.document.uri.scheme === 'file') {
    targetPath = editor.document.uri.fsPath;
    await db.setMarkdownPath(updated.id, path.relative(root, targetPath));
  }

  await db.refreshSimilarMemoryLinks(updated.id);
  const savedCard = db.getMemoryCard(updated.id) ?? updated;
  if (targetPath) {
    await overwriteMemoryMarkdown(targetPath, savedCard);
  }

  refreshMemoryExplorer();
  await vscode.window.showInformationMessage(`OmniMemory synced "${savedCard.title}".`);
}

async function refreshRelatedMemories(context: vscode.ExtensionContext): Promise<void> {
  const root = getWorkspaceRoot();
  const db = await getStore(context);
  const memoryId = await resolveMemoryIdFromActiveMarkdownOrPick(context, db);

  if (!memoryId) {
    return;
  }

  const links = await db.refreshSimilarMemoryLinks(memoryId);
  const card = db.getMemoryCard(memoryId);

  if (!card) {
    await vscode.window.showWarningMessage('That memory card no longer exists.');
    return;
  }

  if (card.markdownPath) {
    await overwriteMemoryMarkdown(path.resolve(root, card.markdownPath), card);
  }

  refreshMemoryExplorer();
  await vscode.window.showInformationMessage(`OmniMemory linked ${links.length} related memories for "${card.title}".`);
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

      refreshMemoryExplorer();
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
    const db = await getStore(context);
    if (db.findMemoryByCommitHash(currentHead)) {
      return;
    }

    promptInFlight = true;
    try {
      const action = await vscode.window.showInformationMessage(
        'OmniMemory detected a new Git commit.',
        'Generate Memory',
        'Ignore'
      );

      if (action === 'Generate Memory') {
        await generateFromLastCommit(context);
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

function startDiagnosticSimilaritySearch(context: vscode.ExtensionContext): void {
  const config = getConfig();
  if (!config.enableDiagnosticSimilaritySearch || !vscode.workspace.workspaceFolders?.length) {
    return;
  }

  const promptedKeys = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let searchInFlight = false;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      checkDiagnostics().catch(() => undefined);
    }, Math.max(250, config.diagnosticSimilarityDebounceMs));
  };

  const checkDiagnostics = async () => {
    if (searchInFlight) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const diagnostics = vscode.languages
      .getDiagnostics(editor.document.uri)
      .filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error || diagnostic.severity === vscode.DiagnosticSeverity.Warning)
      .slice(0, 5);

    if (diagnostics.length === 0) {
      return;
    }

    const query = buildQueryFromDiagnostics(editor, diagnostics);
    if (!query) {
      return;
    }

    searchInFlight = true;
    try {
      const db = await getStore(context);
      const [topResult] = db.searchMemories(query, 1);
      if (!topResult) {
        return;
      }

      const diagnosticMessages = diagnostics.map((diagnostic) => diagnostic.message);
      const suggestionInput = {
        uri: editor.document.uri.toString(),
        diagnosticMessages,
        result: topResult,
        minScore: config.diagnosticSimilarityMinScore
      };

      if (!shouldSuggestSimilarMemory(suggestionInput)) {
        return;
      }

      const key = buildSimilaritySuggestionKey(suggestionInput);
      if (promptedKeys.has(key)) {
        return;
      }

      promptedKeys.add(key);
      if (promptedKeys.size > 200) {
        promptedKeys.clear();
        promptedKeys.add(key);
      }

      const action = await vscode.window.showInformationMessage(
        `OmniMemory found a similar memory: "${topResult.title}".`,
        'Open Memory',
        'Ignore'
      );

      if (action === 'Open Memory') {
        await openMemory(context, topResult.id);
      }
    } finally {
      searchInFlight = false;
    }
  };

  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
      if (!activeUri || event.uris.some((uri) => uri.toString() === activeUri)) {
        schedule();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => schedule()),
    {
      dispose: () => {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }
  );

  schedule();
}

async function shouldSkipDuplicateCleanCommit(
  context: vscode.ExtensionContext,
  db: SQLiteMemoryStore,
  commit: { hash: string | null; hasWorkingChanges: boolean }
): Promise<boolean> {
  if (!commit.hash || commit.hasWorkingChanges) {
    return false;
  }

  const existing = db.findMemoryByCommitHash(commit.hash);
  if (!existing) {
    return false;
  }

  const action = await vscode.window.showInformationMessage(
    `OmniMemory already has a memory for commit ${commit.hash.slice(0, 7)}.`,
    'Open Existing',
    'Generate Anyway'
  );

  if (action === 'Open Existing') {
    await openMemory(context, existing.id);
    return true;
  }

  return action !== 'Generate Anyway';
}

async function openMemoryCommand(context: vscode.ExtensionContext, input?: unknown): Promise<void> {
  const id = resolveMemoryIdArgument(input);

  if (id) {
    await openMemory(context, id);
    return;
  }

  const db = await getStore(context);
  const picked = await pickMemory(db.listRecentMemories(), 'Open a memory card');
  if (!picked) {
    return;
  }

  await openMemory(context, picked.id);
}

function resolveMemoryIdArgument(input: unknown): string | undefined {
  if (typeof input === 'string') {
    return input;
  }

  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const candidate = input as { id?: unknown; result?: { id?: unknown } };
  if (typeof candidate.id === 'string') {
    return candidate.id;
  }

  if (typeof candidate.result?.id === 'string') {
    return candidate.result.id;
  }

  return undefined;
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

async function resolveMemoryIdFromActiveMarkdownOrPick(
  context: vscode.ExtensionContext,
  db: SQLiteMemoryStore
): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;

  if (editor?.document.languageId === 'markdown') {
    try {
      return parseMemoryMarkdown(editor.document.getText()).memoryId;
    } catch {
      // Fall back to picker if the active Markdown file is not an OmniMemory card.
    }
  }

  const picked = await pickMemory(db.listRecentMemories(), 'Choose a memory card');
  return picked?.id;
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

function buildQueryFromActiveEditor(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return '';
  }

  const document = editor.document;
  const selection = editor.selection;
  const selectedText = selection.isEmpty ? '' : document.getText(selection);
  const currentLine = document.lineAt(selection.active.line).text;
  const startLine = Math.max(0, selection.active.line - 3);
  const endLine = Math.min(document.lineCount - 1, selection.active.line + 3);
  const surroundingText = document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length));
  const diagnosticMessages = vscode.languages
    .getDiagnostics(document.uri)
    .filter((diagnostic) => diagnostic.range.intersection(selection) || diagnostic.range.start.line === selection.active.line)
    .slice(0, 5)
    .map((diagnostic) => diagnostic.message);

  return buildRetrievalQuery({
    selectedText,
    diagnosticMessages,
    currentLine,
    surroundingText,
    fileName: path.basename(document.fileName)
  });
}

function buildQueryFromDiagnostics(editor: vscode.TextEditor, diagnostics: vscode.Diagnostic[]): string {
  const document = editor.document;
  const primaryDiagnostic = diagnostics[0];
  const line = primaryDiagnostic.range.start.line;
  const startLine = Math.max(0, line - 3);
  const endLine = Math.min(document.lineCount - 1, line + 3);

  return buildRetrievalQuery({
    diagnosticMessages: diagnostics.map((diagnostic) => diagnostic.message),
    currentLine: document.lineAt(line).text,
    surroundingText: document.getText(new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length)),
    fileName: path.basename(document.fileName)
  });
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

async function chooseConversationTool(detectedTool: string): Promise<string | undefined> {
  const options = ['manual', 'ChatGPT', 'Cursor', 'Claude Code', 'GitHub Copilot', 'VS Code'];
  const uniqueOptions = [detectedTool, ...options]
    .map((tool) => tool.trim())
    .filter((tool, index, values) => tool && values.indexOf(tool) === index);
  const picked = await vscode.window.showQuickPick(
    uniqueOptions.map((tool) => ({
      label: tool,
      tool
    })),
    {
      title: 'Conversation Source',
      placeHolder: 'Which tool produced this transcript?'
    }
  );

  return picked?.tool;
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

  if (result.qualityScore !== undefined) {
    parts.push(`quality ${result.qualityScore}`);
  }

  if (result.score !== undefined) {
    parts.push(`score ${result.score}`);
  }

  return parts.join(' · ');
}

function refreshMemoryExplorer(): void {
  memoryExplorerProvider?.refresh();
}
