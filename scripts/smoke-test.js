const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const { SQLiteMemoryStore } = require('../out/storage/sqliteMemoryStore');
const { renderMemoryCardMarkdown, writeMemoryMarkdown } = require('../out/memory/markdown');
const { parseMemoryMarkdown } = require('../out/memory/markdownParser');
const { synthesizeMemory } = require('../out/memory/synthesizer');
const { buildRetrievalQuery } = require('../out/retrieval/contextQuery');

async function main() {
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
  const contextQuery = buildRetrievalQuery({
    selectedText: 'Null provider response caused payment callback retries to loop.',
    diagnosticMessages: ['TypeError: Cannot read properties of null'],
    currentLine: 'validatePaymentProviderResponse(response)',
    surroundingText: 'payment callback reconciliation failed after provider timeout',
    fileName: 'callback.ts'
  });
  const contextResults = store.searchMemories(contextQuery);

  assert(card.rootCause === 'Schema compatibility mismatch between producer and consumer.', 'root cause was not synthesized');
  assert(card.qualityScore >= 70, 'complete memory was scored too low');
  assert(verified && verified.status === 'Verified', 'memory was not marked verified');
  assert(verificationEvents.length === 1, 'verification event was not stored');
  assert(duplicate && duplicate.id === card.id, 'commit duplicate lookup did not find the memory');
  assert(weakCard.qualityScore < 70, 'weak memory was not scored low');
  assert(weakCard.qualityWarnings.length > 0, 'weak memory has no quality warnings');
  assert(reviewQueue.some((result) => result.id === weakCard.id), 'review queue did not include weak memory');
  assert(syncedCard && syncedCard.title === 'Payment Callback Retry Regression', 'Markdown sync did not update title');
  assert(syncedCard && syncedCard.qualityScore > weakCard.qualityScore, 'Markdown sync did not recompute quality');
  assert(contextQuery.includes('Null provider response'), 'context query did not include selected text');
  assert(contextResults.some((result) => result.id === weakCard.id), 'context search did not find synced memory');
  assert(schemaResults.length === 1, 'schema search did not find the memory');
  assert(fileResults.length === 1, 'file search did not find the memory');
  assert(tagResults.length === 1, 'tag search did not find the memory');
  assert(fs.existsSync(markdownPath), 'memory markdown was not written');

  store.close();
  await assertLegacyDatabaseMigration(tempRoot);
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log('OmniMemory smoke test passed');
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

  fs.writeFileSync(legacyDbPath, Buffer.from(db.export()));
  db.close();

  const store = new SQLiteMemoryStore(legacyDbPath, process.cwd());
  await store.init();
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
