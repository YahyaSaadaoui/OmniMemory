import * as fs from 'fs/promises';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { createId } from '../id';
import { evaluateMemoryQuality } from '../memory/quality';
import {
  CapturedCommit,
  CapturedConversation,
  MemoryCard,
  MemoryDraft,
  MemoryCardUpdate,
  MemoryStatus,
  SearchResult,
  VerificationEvent,
  VerificationEventDraft
} from '../types';

type Row = Record<string, unknown>;

interface SearchableMemoryRow extends SearchResult {
  symptoms: string;
  attempts: string;
  lessons: string;
  filesChanged: string[];
  tags: string[];
}

const searchStopWords = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'why',
  'are',
  'was',
  'were',
  'does',
  'did',
  'how',
  'what'
]);

export class SQLiteMemoryStore {
  private db: Database | undefined;

  constructor(
    private readonly dbPath: string,
    private readonly extensionPath: string
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    const SQL = await initSqlJs({
      locateFile: (file) => path.join(this.extensionPath, 'node_modules', 'sql.js', 'dist', file)
    });

    const bytes = await this.readExistingDatabase();
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.createSchema();
    await this.save();
  }

  async insertConversation(conversation: CapturedConversation): Promise<void> {
    this.database.run(
      `INSERT OR REPLACE INTO conversations (id, tool, content, timestamp)
       VALUES (?, ?, ?, ?)`,
      [conversation.id, conversation.tool, conversation.content, conversation.timestamp]
    );
    await this.save();
  }

  async insertCommit(commit: CapturedCommit): Promise<void> {
    this.database.run(
      `INSERT OR REPLACE INTO commits (id, hash, message, author, branch, files_changed, has_working_changes, diff_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        commit.id,
        commit.hash,
        commit.message,
        commit.author,
        commit.branch,
        JSON.stringify(commit.filesChanged),
        commit.hasWorkingChanges ? 1 : 0,
        commit.diffSummary,
        commit.createdAt
      ]
    );
    await this.save();
  }

  async insertMemoryCard(draft: MemoryDraft): Promise<MemoryCard> {
    const now = new Date().toISOString();
    const quality = evaluateMemoryQuality(draft);
    const card: MemoryCard = {
      id: createId('memory'),
      ...draft,
      qualityScore: quality.qualityScore,
      qualityWarnings: quality.qualityWarnings,
      createdAt: now,
      updatedAt: now,
      markdownPath: null,
      verificationEvents: []
    };

    this.database.run(
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
        quality_score,
        quality_warnings,
        status,
        tags,
        created_at,
        updated_at,
        source_commit_id,
        source_conversation_id,
        markdown_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.title,
        card.problem,
        card.symptoms,
        card.rootCause,
        card.attempts,
        card.solution,
        JSON.stringify(card.filesChanged),
        card.relatedPr,
        card.lessons,
        card.confidence,
        card.qualityScore,
        JSON.stringify(card.qualityWarnings),
        card.status,
        JSON.stringify(card.tags),
        card.createdAt,
        card.updatedAt,
        card.sourceCommitId,
        card.sourceConversationId,
        card.markdownPath
      ]
    );
    await this.save();

    return card;
  }

  async setMarkdownPath(id: string, markdownPath: string): Promise<void> {
    this.database.run(
      `UPDATE memory_cards
       SET markdown_path = ?, updated_at = ?
       WHERE id = ?`,
      [markdownPath, new Date().toISOString(), id]
    );
    await this.save();
  }

  async updateStatus(id: string, status: MemoryStatus): Promise<MemoryCard | undefined> {
    this.database.run(
      `UPDATE memory_cards
       SET status = ?, updated_at = ?
       WHERE id = ?`,
      [status, new Date().toISOString(), id]
    );
    await this.save();

    return this.getMemoryCard(id);
  }

  async updateMemoryCardContent(id: string, update: MemoryCardUpdate): Promise<MemoryCard | undefined> {
    const existing = this.getMemoryCard(id);
    if (!existing) {
      return undefined;
    }

    const quality = evaluateMemoryQuality({
      ...update,
      confidence: existing.confidence,
      sourceCommitId: existing.sourceCommitId,
      sourceConversationId: existing.sourceConversationId
    });

    this.database.run(
      `UPDATE memory_cards
       SET title = ?,
           problem = ?,
           symptoms = ?,
           root_cause = ?,
           attempts = ?,
           solution = ?,
           files_changed = ?,
           related_pr = ?,
           lessons = ?,
           quality_score = ?,
           quality_warnings = ?,
           status = ?,
           tags = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        update.title,
        update.problem,
        update.symptoms,
        update.rootCause,
        update.attempts,
        update.solution,
        JSON.stringify(update.filesChanged),
        update.relatedPr,
        update.lessons,
        quality.qualityScore,
        JSON.stringify(quality.qualityWarnings),
        update.status,
        JSON.stringify(update.tags),
        new Date().toISOString(),
        id
      ]
    );
    await this.save();

    return this.getMemoryCard(id);
  }

  async addVerificationEvent(draft: VerificationEventDraft): Promise<VerificationEvent> {
    const event: VerificationEvent = {
      id: createId('verification'),
      createdAt: new Date().toISOString(),
      ...draft
    };

    this.database.run(
      `INSERT INTO verification_events (id, memory_id, kind, command, exit_code, output, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.memoryId,
        event.kind,
        event.command,
        event.exitCode,
        event.output,
        event.createdAt
      ]
    );
    await this.save();

    return event;
  }

  getMemoryCard(id: string): MemoryCard | undefined {
    const statement = this.database.prepare(
      `SELECT *
       FROM memory_cards
       WHERE id = ?`
    );

    try {
      statement.bind([id]);
      if (!statement.step()) {
        return undefined;
      }

      const card = rowToMemoryCard(statement.getAsObject() as Row);
      return {
        ...card,
        verificationEvents: this.listVerificationEvents(card.id)
      };
    } finally {
      statement.free();
    }
  }

  listVerificationEvents(memoryId: string): VerificationEvent[] {
    const statement = this.database.prepare(
      `SELECT *
       FROM verification_events
       WHERE memory_id = ?
       ORDER BY created_at DESC`
    );
    const results: VerificationEvent[] = [];

    try {
      statement.bind([memoryId]);
      while (statement.step()) {
        results.push(rowToVerificationEvent(statement.getAsObject() as Row));
      }
    } finally {
      statement.free();
    }

    return results;
  }

  findMemoryByCommitHash(hash: string): SearchResult | undefined {
    const statement = this.database.prepare(
      `SELECT mc.id, mc.title, mc.problem, mc.root_cause, mc.solution, mc.status, mc.confidence, mc.created_at, mc.markdown_path
       FROM memory_cards mc
       INNER JOIN commits c ON c.id = mc.source_commit_id
       WHERE c.hash = ?
         AND c.has_working_changes = 0
       ORDER BY mc.created_at DESC
       LIMIT 1`
    );

    try {
      statement.bind([hash]);
      if (!statement.step()) {
        return undefined;
      }

      return rowToSearchResult(statement.getAsObject() as Row);
    } finally {
      statement.free();
    }
  }

  searchMemories(query: string, limit = 20): SearchResult[] {
    const tokens = tokenizeQuery(query);
    if (tokens.length === 0) {
      return this.listRecentMemories(limit);
    }

    const statement = this.database.prepare(
      `SELECT id, title, problem, symptoms, root_cause, attempts, solution, files_changed, lessons, tags, status, confidence, created_at, markdown_path
       FROM memory_cards
       ORDER BY created_at DESC
       LIMIT 1000`
    );

    const rows: SearchableMemoryRow[] = [];

    try {
      while (statement.step()) {
        rows.push(rowToSearchableResult(statement.getAsObject() as Row));
      }
    } finally {
      statement.free();
    }

    return rows
      .map((row) => {
        const score = scoreSearchRow(query, tokens, row);
        return { row, score };
      })
      .filter((result) => result.score.score > 0)
      .sort((a, b) => {
        if (b.score.score !== a.score.score) {
          return b.score.score - a.score.score;
        }

        return b.row.createdAt.localeCompare(a.row.createdAt);
      })
      .slice(0, limit)
      .map(({ row, score }) => ({
        id: row.id,
        title: row.title,
        problem: row.problem,
        rootCause: row.rootCause,
        solution: row.solution,
        status: row.status,
        confidence: row.confidence,
        createdAt: row.createdAt,
        markdownPath: row.markdownPath,
        score: score.score,
        matchedFields: score.matchedFields
      }));
  }

  listRecentMemories(limit = 50): SearchResult[] {
    const statement = this.database.prepare(
      `SELECT id, title, problem, root_cause, solution, status, confidence, created_at, markdown_path
       FROM memory_cards
       ORDER BY created_at DESC
       LIMIT ?`
    );
    const results: SearchResult[] = [];

    try {
      statement.bind([limit]);
      while (statement.step()) {
        results.push(rowToSearchResult(statement.getAsObject() as Row));
      }
    } finally {
      statement.free();
    }

    return results;
  }

  listReviewQueue(limit = 50): SearchResult[] {
    const statement = this.database.prepare(
      `SELECT id, title, problem, root_cause, solution, status, confidence, quality_score, quality_warnings, created_at, markdown_path
       FROM memory_cards
       WHERE status = 'Draft'
          OR confidence < 0.65
          OR quality_score < 70
          OR quality_warnings != '[]'
       ORDER BY quality_score ASC, created_at DESC
       LIMIT ?`
    );
    const results: SearchResult[] = [];

    try {
      statement.bind([limit]);
      while (statement.step()) {
        results.push(rowToSearchResult(statement.getAsObject() as Row));
      }
    } finally {
      statement.free();
    }

    return results;
  }

  close(): void {
    this.db?.close();
    this.db = undefined;
  }

  private get database(): Database {
    if (!this.db) {
      throw new Error('OmniMemory database has not been initialized.');
    }

    return this.db;
  }

  private async readExistingDatabase(): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await fs.readFile(this.dbPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }

      throw error;
    }
  }

  private createSchema(): void {
    this.database.run(`
      CREATE TABLE IF NOT EXISTS memory_cards (
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
        quality_score INTEGER NOT NULL DEFAULT 0,
        quality_warnings TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_commit_id TEXT,
        source_conversation_id TEXT,
        markdown_path TEXT
      );

      CREATE TABLE IF NOT EXISTS commits (
        id TEXT PRIMARY KEY,
        hash TEXT,
        message TEXT,
        author TEXT,
        branch TEXT,
        files_changed TEXT NOT NULL DEFAULT '[]',
        has_working_changes INTEGER NOT NULL DEFAULT 0,
        diff_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        tool TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        vector TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES memory_cards(id)
      );

      CREATE TABLE IF NOT EXISTS verification_events (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        command TEXT NOT NULL,
        exit_code INTEGER NOT NULL,
        output TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        FOREIGN KEY(memory_id) REFERENCES memory_cards(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_cards_status ON memory_cards(status);
      CREATE INDEX IF NOT EXISTS idx_memory_cards_created_at ON memory_cards(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_cards_title ON memory_cards(title);
      CREATE INDEX IF NOT EXISTS idx_verification_events_memory_id ON verification_events(memory_id);
    `);
    this.runMigration('ALTER TABLE commits ADD COLUMN has_working_changes INTEGER NOT NULL DEFAULT 0');
    this.runMigration('ALTER TABLE memory_cards ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 0');
    this.runMigration('ALTER TABLE memory_cards ADD COLUMN quality_warnings TEXT NOT NULL DEFAULT \'[]\'');
    this.database.run('CREATE INDEX IF NOT EXISTS idx_memory_cards_quality_score ON memory_cards(quality_score)');
  }

  private async save(): Promise<void> {
    const data = this.database.export();
    await fs.writeFile(this.dbPath, Buffer.from(data));
  }

  private runMigration(sql: string): void {
    try {
      this.database.run(sql);
    } catch {
      // SQLite has no ADD COLUMN IF NOT EXISTS; repeated migrations are harmless here.
    }
  }
}

function rowToMemoryCard(row: Row): MemoryCard {
  return {
    id: asString(row.id),
    title: asString(row.title),
    problem: asString(row.problem),
    symptoms: asString(row.symptoms),
    rootCause: asString(row.root_cause),
    attempts: asString(row.attempts),
    solution: asString(row.solution),
    filesChanged: parseJsonArray(row.files_changed),
    relatedPr: nullableString(row.related_pr),
    lessons: asString(row.lessons),
    confidence: Number(row.confidence),
    qualityScore: Number(row.quality_score),
    qualityWarnings: parseJsonArray(row.quality_warnings),
    status: asString(row.status) as MemoryStatus,
    tags: parseJsonArray(row.tags),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    sourceCommitId: nullableString(row.source_commit_id),
    sourceConversationId: nullableString(row.source_conversation_id),
    markdownPath: nullableString(row.markdown_path),
    verificationEvents: []
  };
}

function rowToSearchResult(row: Row): SearchResult {
  return {
    id: asString(row.id),
    title: asString(row.title),
    problem: asString(row.problem),
    rootCause: asString(row.root_cause),
    solution: asString(row.solution),
    status: asString(row.status) as MemoryStatus,
    confidence: Number(row.confidence),
    createdAt: asString(row.created_at),
    markdownPath: nullableString(row.markdown_path),
    qualityScore: typeof row.quality_score === 'number' ? Number(row.quality_score) : undefined,
    qualityWarnings: typeof row.quality_warnings === 'string' ? parseJsonArray(row.quality_warnings) : undefined
  };
}

function rowToSearchableResult(row: Row): SearchableMemoryRow {
  return {
    ...rowToSearchResult(row),
    symptoms: asString(row.symptoms),
    attempts: asString(row.attempts),
    lessons: asString(row.lessons),
    filesChanged: parseJsonArray(row.files_changed),
    tags: parseJsonArray(row.tags)
  };
}

function rowToVerificationEvent(row: Row): VerificationEvent {
  return {
    id: asString(row.id),
    memoryId: asString(row.memory_id),
    kind: 'command',
    command: asString(row.command),
    exitCode: Number(row.exit_code),
    output: asString(row.output),
    createdAt: asString(row.created_at)
  };
}

function tokenizeQuery(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !searchStopWords.has(token));

  return [...new Set(tokens)];
}

function scoreSearchRow(
  query: string,
  tokens: string[],
  row: SearchableMemoryRow
): { score: number; matchedFields: string[] } {
  const fields = [
    { name: 'title', value: row.title, weight: 10 },
    { name: 'tags', value: row.tags.join(' '), weight: 9 },
    { name: 'files', value: row.filesChanged.join(' '), weight: 8 },
    { name: 'root cause', value: row.rootCause, weight: 7 },
    { name: 'solution', value: row.solution, weight: 6 },
    { name: 'problem', value: row.problem, weight: 5 },
    { name: 'symptoms', value: row.symptoms, weight: 4 },
    { name: 'lessons', value: row.lessons, weight: 3 },
    { name: 'attempts', value: row.attempts, weight: 2 }
  ];
  const phrase = query.toLowerCase().trim();
  const matchedFields = new Set<string>();
  let score = 0;

  for (const field of fields) {
    const lower = field.value.toLowerCase();
    if (!lower) {
      continue;
    }

    if (phrase.length >= 3 && lower.includes(phrase)) {
      score += field.weight * 4;
      matchedFields.add(field.name);
    }

    for (const token of tokens) {
      if (lower.includes(token)) {
        score += field.weight;
        matchedFields.add(field.name);
      }
    }
  }

  for (const tag of row.tags) {
    if (tokens.includes(tag.toLowerCase())) {
      score += 12;
      matchedFields.add('tags');
    }
  }

  return {
    score,
    matchedFields: [...matchedFields]
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function nullableString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  return value;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
