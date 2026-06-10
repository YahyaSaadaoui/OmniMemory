const fs = require('fs');
const os = require('os');
const path = require('path');
const { SQLiteMemoryStore } = require('../out/storage/sqliteMemoryStore');
const { writeMemoryMarkdown } = require('../out/memory/markdown');
const { synthesizeMemory } = require('../out/memory/synthesizer');

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

  assert(card.rootCause === 'Schema compatibility mismatch between producer and consumer.', 'root cause was not synthesized');
  assert(verified && verified.status === 'Verified', 'memory was not marked verified');
  assert(verificationEvents.length === 1, 'verification event was not stored');
  assert(schemaResults.length === 1, 'schema search did not find the memory');
  assert(fileResults.length === 1, 'file search did not find the memory');
  assert(tagResults.length === 1, 'tag search did not find the memory');
  assert(fs.existsSync(markdownPath), 'memory markdown was not written');

  store.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log('OmniMemory smoke test passed');
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
