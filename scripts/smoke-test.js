const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const initSqlJs = require('sql.js');
const { detectConversationTool, normalizeImportedConversation } = require('../out/capture/importedConversation');
const { captureGitContext } = require('../out/git/gitCapture');
const { generateMemoryDraft } = require('../out/memory/generator');
const { SQLiteMemoryStore } = require('../out/storage/sqliteMemoryStore');
const { renderMemoryCardMarkdown, writeMemoryMarkdown } = require('../out/memory/markdown');
const { parseMemoryMarkdown } = require('../out/memory/markdownParser');
const { synthesizeMemory } = require('../out/memory/synthesizer');
const { localEmbeddingDimensions } = require('../out/retrieval/localEmbedding');
const { buildRetrievalQuery } = require('../out/retrieval/contextQuery');
const { buildSimilaritySuggestionKey, shouldSuggestSimilarMemory } = require('../out/retrieval/similaritySuggestion');

async function main() {
  assertExtensionManifest();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimemory-smoke-'));
  const dbPath = path.join(tempRoot, 'omnimemory.sqlite');
  const memoryDir = path.join(tempRoot, '.memory');
  const store = new SQLiteMemoryStore(dbPath, process.cwd());

  await store.init();

  const conversation = {
    id: 'conversation_smoke',
    tool: 'manual',
    content: [
      '# Kafka Consumer Deserialization Failure',
      '## Problem',
      'Consumer crashed when receiving schema v2 messages.',
      '## Root Cause',
      'Schema compatibility mismatch between producer and consumer.',
      '## Final Solution',
      'Updated compatibility strategy and validated schema evolution.',
      '## Lessons Learned',
      'Validate schema changes against existing consumers before deploy.'
    ].join('\n'),
    timestamp: new Date().toISOString()
  };
  const commit = {
    id: 'commit_smoke',
    hash: 'abc123',
    message: 'fix kafka schema compatibility',
    author: 'Smoke Test <test@example.com>',
    branch: 'main',
    filesChanged: ['src/kafka/consumer.ts'],
    hasWorkingChanges: false,
    diffSummary: 'src/kafka/consumer.ts | 8 +++++---',
    diff: '',
    createdAt: new Date().toISOString()
  };

  await store.insertConversation(conversation);
  await store.insertCommit(commit);

  const card = await store.insertMemoryCard(synthesizeMemory(conversation, commit));
  const markdownPath = await writeMemoryMarkdown(memoryDir, card);
  await store.setMarkdownPath(card.id, path.relative(tempRoot, markdownPath));
  await store.addVerificationEvent({
    memoryId: card.id,
    kind: 'command',
    command: 'npm test',
    exitCode: 0,
    output: 'tests passed'
  });
  const verified = await store.updateStatus(card.id, 'Verified');
  const cardEmbedding = store.getMemoryEmbedding(card.id);

  const schemaResults = store.searchMemories('schema mismatch');
  const fileResults = store.searchMemories('consumer.ts');
  const tagResults = store.searchMemories('kafka');
  const verificationEvents = store.listVerificationEvents(card.id);
  const duplicate = store.findMemoryByCommitHash('abc123');
  const weakConversation = {
    id: 'conversation_weak',
    tool: 'manual',
    content: 'No conversation text was captured. Synthesize this memory from Git context only.',
    timestamp: new Date().toISOString()
  };
  const weakCommit = {
    id: 'commit_weak',
    hash: 'def456',
    message: 'fix bug',
    author: 'Smoke Test <test@example.com>',
    branch: 'main',
    filesChanged: [],
    hasWorkingChanges: false,
    diffSummary: '',
    diff: '',
    createdAt: new Date().toISOString()
  };
  await store.insertConversation(weakConversation);
  await store.insertCommit(weakCommit);
  const weakCard = await store.insertMemoryCard(synthesizeMemory(weakConversation, weakCommit));
  const previousPaymentConversation = {
    id: 'conversation_payment_previous',
    tool: 'manual',
    content: [
      '# Payment Callback Null Provider Response',
      '## Problem',
      'Payment callback reconciliation crashed when the provider returned a null response.',
      '## Root Cause',
      'Provider response validation did not reject null callback payloads before retry state changed.',
      '## Final Solution',
      'Added provider response validation before callback retry state transitions.',
      '## Lessons Learned',
      'Validate payment provider responses before mutating callback retry state.'
    ].join('\n'),
    timestamp: new Date().toISOString()
  };
  const previousPaymentCommit = {
    id: 'commit_payment_previous',
    hash: 'pay789',
    message: 'validate payment callback provider response',
    author: 'Smoke Test <test@example.com>',
    branch: 'main',
    filesChanged: ['src/payments/callback.ts'],
    hasWorkingChanges: false,
    diffSummary: 'src/payments/callback.ts | 12 ++++++++++--',
    diff: '',
    createdAt: new Date().toISOString()
  };
  await store.insertConversation(previousPaymentConversation);
  await store.insertCommit(previousPaymentCommit);
  const previousPaymentCard = await store.insertMemoryCard(synthesizeMemory(previousPaymentConversation, previousPaymentCommit));
  const reviewQueue = store.listReviewQueue();
  const editedMarkdown = renderMemoryCardMarkdown(weakCard)
    .replace('fix bug', 'Payment Callback Retry Regression')
    .replace('Symptoms were not explicitly captured.', 'Callbacks were retried indefinitely after transient provider failures.')
    .replace('Root cause was not explicit in the captured context.', 'Retry state was reset before callback reconciliation completed.')
    .replace('Prior attempts were not explicitly captured.', 'Checked provider payloads, replayed callbacks, and ruled out queue delivery loss.')
    .replace('Final solution was not explicit in the captured context.', 'Persisted retry state until callback reconciliation completed and added regression coverage.')
    .replace('Capture explicit root cause, failed attempts, and verification evidence before promoting this memory beyond Draft.', 'Keep retry state transitions durable until external callback reconciliation is complete.')
    .replace('## Files Changed\n\nN/A', '## Files Changed\n\n- src/payments/callback.ts')
    .replace('## Tags\n\nN/A', '## Tags\n\n`payments` `typescript`');
  const parsedMarkdown = parseMemoryMarkdown(editedMarkdown);
  const syncedCard = await store.updateMemoryCardContent(parsedMarkdown.memoryId, parsedMarkdown.update);
  const syncedEmbedding = store.getMemoryEmbedding(syncedCard.id);
  await store.refreshSimilarMemoryLinks(syncedCard.id);
  const syncedWithLinks = store.getMemoryCard(syncedCard.id);
  const relatedMarkdown = renderMemoryCardMarkdown(syncedWithLinks);
  const contextQuery = buildRetrievalQuery({
    selectedText: 'Null provider response caused payment callback retries to loop.',
    diagnosticMessages: ['TypeError: Cannot read properties of null'],
    currentLine: 'validatePaymentProviderResponse(response)',
    surroundingText: 'payment callback reconciliation failed after provider timeout',
    fileName: 'callback.ts'
  });
  const contextResults = store.searchMemories(contextQuery);
  const suggestionInput = {
    uri: 'file:///workspace/src/payments/callback.ts',
    diagnosticMessages: ['TypeError: Cannot read properties of null'],
    result: contextResults[0],
    minScore: 20
  };
  const suggestionKey = buildSimilaritySuggestionKey(suggestionInput);
  const importedConversation = normalizeImportedConversation('\u0000ChatGPT\r\nProblem: payment retry loop\r\n'.repeat(200), 120);
  const detectedTool = detectConversationTool(importedConversation, 'chatgpt-export.md');
  const generatorScript = path.join(tempRoot, 'generator.js');
  fs.writeFileSync(generatorScript, `
process.stdin.resume();
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    title: 'LLM Generated Kafka Memory',
    problem: 'Kafka consumer failed on schema v2 messages.',
    symptoms: 'Consumer crashed while reading messages.',
    rootCause: 'Schema compatibility mismatch.',
    attempts: 'Checked serializer and topic configuration.',
    solution: 'Updated compatibility strategy.',
    relatedPr: null,
    lessons: 'Validate schema evolution before deployment.',
    confidence: 0.91,
    tags: ['kafka', 'schema']
  }));
});
`);
  const commandGeneration = await generateMemoryDraft(conversation, commit, {
    provider: 'command',
    openAIModel: 'unused',
    openAIEndpoint: 'https://api.openai.com/v1/responses',
    openAIApiKeyEnvVar: 'OMNIMEMORY_UNUSED',
    command: `"${process.execPath}" "${generatorScript}"`,
    timeoutMs: 10000,
    maxInputCharacters: 50000
  });
  const fallbackGeneration = await generateMemoryDraft(conversation, commit, {
    provider: 'openai',
    openAIModel: 'gpt-5.5',
    openAIEndpoint: 'https://api.openai.com/v1/responses',
    openAIApiKeyEnvVar: 'OMNIMEMORY_MISSING_TEST_KEY',
    command: '',
    timeoutMs: 1000,
    maxInputCharacters: 50000
  });

  assert(card.rootCause === 'Schema compatibility mismatch between producer and consumer.', 'root cause was not synthesized');
  assert(card.qualityScore >= 70, 'complete memory was scored too low');
  assert(cardEmbedding && cardEmbedding.length === localEmbeddingDimensions, 'memory embedding was not stored');
  assert(verified && verified.status === 'Verified', 'memory was not marked verified');
  assert(verificationEvents.length === 1, 'verification event was not stored');
  assert(duplicate && duplicate.id === card.id, 'commit duplicate lookup did not find the memory');
  assert(weakCard.qualityScore < 70, 'weak memory was not scored low');
  assert(weakCard.qualityWarnings.length > 0, 'weak memory has no quality warnings');
  assert(reviewQueue.some((result) => result.id === weakCard.id), 'review queue did not include weak memory');
  assert(syncedCard && syncedCard.title === 'Payment Callback Retry Regression', 'Markdown sync did not update title');
  assert(syncedCard && syncedCard.qualityScore > weakCard.qualityScore, 'Markdown sync did not recompute quality');
  assert(syncedEmbedding && syncedEmbedding.length === localEmbeddingDimensions, 'synced memory embedding was not refreshed');
  assert(syncedWithLinks.relatedMemories.some((link) => link.targetMemoryId === previousPaymentCard.id), 'similar memory link was not created');
  assert(relatedMarkdown.includes(previousPaymentCard.title), 'related memory was not rendered');
  assert(contextQuery.includes('Null provider response'), 'context query did not include selected text');
  assert(contextResults.some((result) => result.id === weakCard.id), 'context search did not find synced memory');
  assert(contextResults.some((result) => result.id === weakCard.id && result.matchedFields.includes('embedding')), 'context search did not use embeddings');
  assert(shouldSuggestSimilarMemory(suggestionInput), 'diagnostic similarity threshold rejected a good match');
  assert(suggestionKey.includes(contextResults[0].id), 'diagnostic suggestion key did not include result id');
  assert(importedConversation.length <= 120, 'imported conversation was not truncated');
  assert(!importedConversation.includes('\u0000'), 'imported conversation was not normalized');
  assert(detectedTool === 'ChatGPT', 'conversation source was not detected');
  assert(commandGeneration.provider === 'command', 'command generator was not used');
  assert(commandGeneration.draft.title === 'LLM Generated Kafka Memory', 'command generator output was not parsed');
  assert(fallbackGeneration.provider === 'heuristic', 'OpenAI failure did not fall back to heuristic');
  assert(Boolean(fallbackGeneration.fallbackReason), 'OpenAI fallback did not report a reason');
  assert(schemaResults.length === 1, 'schema search did not find the memory');
  assert(fileResults.length === 1, 'file search did not find the memory');
  assert(tagResults.length === 1, 'tag search did not find the memory');
  assert(fs.existsSync(markdownPath), 'memory markdown was not written');

  store.close();
  await assertLegacyDatabaseMigration(tempRoot);
  await assertLastCommitCaptureMode(tempRoot);
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log('OmniMemory smoke test passed');
}

function assertExtensionManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const commands = new Set(manifest.contributes.commands.map((command) => command.command));
  const activationEvents = new Set(manifest.activationEvents);
  const explorerViews = manifest.contributes.views?.explorer ?? [];
  const titleMenus = manifest.contributes.menus?.['view/title'] ?? [];
  const itemMenus = manifest.contributes.menus?.['view/item/context'] ?? [];

  assert(commands.has('omniMemory.openMemory'), 'manifest is missing open memory command');
  assert(commands.has('omniMemory.refreshExplorer'), 'manifest is missing refresh explorer command');
  assert(activationEvents.has('onView:omniMemory.memories'), 'manifest is missing OmniMemory view activation');
  assert(explorerViews.some((view) => view.id === 'omniMemory.memories'), 'manifest is missing OmniMemory Explorer view');
  assert(titleMenus.some((menu) => menu.command === 'omniMemory.refreshExplorer'), 'manifest is missing Explorer refresh menu');
  assert(itemMenus.some((menu) => menu.command === 'omniMemory.openMemory'), 'manifest is missing Explorer open menu');
}

async function assertLegacyDatabaseMigration(tempRoot) {
  const legacyDbPath = path.join(tempRoot, 'legacy.sqlite');
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file)
  });
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE memory_cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      problem TEXT NOT NULL,
      symptoms TEXT NOT NULL DEFAULT '',
      root_cause TEXT NOT NULL,
      attempts TEXT NOT NULL DEFAULT '',
      solution TEXT NOT NULL,
      files_changed TEXT NOT NULL DEFAULT '[]',
      related_pr TEXT,
      lessons TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      source_commit_id TEXT,
      source_conversation_id TEXT,
      markdown_path TEXT
    );

    CREATE TABLE commits (
      id TEXT PRIMARY KEY,
      hash TEXT,
      message TEXT,
      author TEXT,
      branch TEXT,
      files_changed TEXT NOT NULL DEFAULT '[]',
      diff_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO memory_cards (
      id,
      title,
      problem,
      symptoms,
      root_cause,
      attempts,
      solution,
      files_changed,
      related_pr,
      lessons,
      confidence,
      status,
      tags,
      created_at,
      updated_at,
      source_commit_id,
      source_conversation_id,
      markdown_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'memory_legacy',
      'Legacy Payment Timeout',
      'Payment timeout handling failed.',
      'Requests timed out during provider callbacks.',
      'Timeout errors were not mapped to retryable provider failures.',
      'Checked provider status and network retries.',
      'Mapped timeout responses to retryable failures.',
      JSON.stringify(['src/payments/provider.ts']),
      null,
      'Preserve retry state for external provider timeouts.',
      0.8,
      'Draft',
      JSON.stringify(['payments', 'timeouts']),
      now,
      now,
      null,
      null,
      null
    ]
  );

  fs.writeFileSync(legacyDbPath, Buffer.from(db.export()));
  db.close();

  const store = new SQLiteMemoryStore(legacyDbPath, process.cwd());
  await store.init();
  const legacyEmbedding = store.getMemoryEmbedding('memory_legacy');
  assert(legacyEmbedding && legacyEmbedding.length === localEmbeddingDimensions, 'legacy memory embedding was not backfilled');
  await store.insertCommit({
    id: 'commit_legacy',
    hash: 'legacy123',
    message: 'legacy migration check',
    author: 'Smoke Test <test@example.com>',
    branch: 'main',
    filesChanged: [],
    hasWorkingChanges: false,
    diffSummary: '',
    diff: '',
    createdAt: new Date().toISOString()
  });
  store.close();
}

async function assertLastCommitCaptureMode(tempRoot) {
  const repo = fs.mkdtempSync(path.join(tempRoot, 'git-capture-'));
  runGit(['init'], repo);
  runGit(['config', 'user.email', 'smoke@example.com'], repo);
  runGit(['config', 'user.name', 'Smoke Test'], repo);

  fs.writeFileSync(
    path.join(repo, 'committed.txt'),
    'committed provider validation\n',
    'utf8'
  );
  runGit(['add', 'committed.txt'], repo);
  runGit(['commit', '-m', 'add committed provider validation'], repo);

  fs.writeFileSync(
    path.join(repo, 'working.txt'),
    'unrelated working tree change\n',
    'utf8'
  );

  const automaticCapture = await captureGitContext(repo, 50000);
  const lastCommitCapture = await captureGitContext(repo, 50000, 'last-commit');

  assert(automaticCapture.hasWorkingChanges, 'automatic Git capture did not detect working changes');
  assert(automaticCapture.filesChanged.includes('working.txt'), 'automatic Git capture did not include working file');
  assert(!lastCommitCapture.hasWorkingChanges, 'last commit capture was marked as working changes');
  assert(lastCommitCapture.filesChanged.includes('committed.txt'), 'last commit capture did not include committed file');
  assert(!lastCommitCapture.filesChanged.includes('working.txt'), 'last commit capture included unrelated working file');
  assert(lastCommitCapture.diff.includes('committed provider validation'), 'last commit capture did not include committed diff');
}

function runGit(args, cwd) {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe'
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
