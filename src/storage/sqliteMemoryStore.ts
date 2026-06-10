import * as fs from 'fs/promises';
import * as path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { createId } from '../id';
import { CapturedCommit, CapturedConversation, MemoryCard, MemoryDraft, MemoryStatus, SearchResult } from '../types';

type Row = Record<string, unknown>;

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
      `INSERT OR REPLACE INTO commits (id, hash, message, author, branch, files_changed, diff_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        commit.id,
        commit.hash,
        commit.message,
        commit.author,
        commit.branch,
        JSON.stringify(commit.filesChanged),
        commit.diffSummary,
        commit.createdAt
      ]
    );
    await this.save();
  }

  async insertMemoryCard(draft: MemoryDraft): Promise<MemoryCard> {
    const now = new Date().toISOString();
    const card: MemoryCard = {
      id: createId('memory'),
      ...draft,
      createdAt: now,
      updatedAt: now,
      markdownPath: null
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
        status,
        tags,
        created_at,
        updated_at,
        source_commit_id,
        source_conversation_id,
        markdown_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

      return rowToMemoryCard(statement.getAsObject() as Row);
    } finally {
      statement.free();
    }
  }

  searchMemories(query: string, limit = 20): SearchResult[] {
    const statement = this.database.prepare(
      `SELECT id, title, problem, root_cause, solution, status, confidence, created_at, markdown_path
       FROM memory_cards
       WHERE lower(title) LIKE ?
          OR lower(problem) LIKE ?
          OR lower(symptoms) LIKE ?
          OR lower(root_cause) LIKE ?
          OR lower(attempts) LIKE ?
          OR lower(solution) LIKE ?
          OR lower(lessons) LIKE ?
          OR lower(tags) LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`
    );

    const needle = `%${query.toLowerCase()}%`;
    const results: SearchResult[] = [];

    try {
      statement.bind([needle, needle, needle, needle, needle, needle, needle, needle, limit]);
      while (statement.step()) {
        results.push(rowToSearchResult(statement.getAsObject() as Row));
      }
    } finally {
      statement.free();
    }

    return results;
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

      CREATE INDEX IF NOT EXISTS idx_memory_cards_status ON memory_cards(status);
      CREATE INDEX IF NOT EXISTS idx_memory_cards_created_at ON memory_cards(created_at);
      CREATE INDEX IF NOT EXISTS idx_memory_cards_title ON memory_cards(title);
    `);
  }

  private async save(): Promise<void> {
    const data = this.database.export();
    await fs.writeFile(this.dbPath, Buffer.from(data));
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
    status: asString(row.status) as MemoryStatus,
    tags: parseJsonArray(row.tags),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
    sourceCommitId: nullableString(row.source_commit_id),
    sourceConversationId: nullableString(row.source_conversation_id),
    markdownPath: nullableString(row.markdown_path)
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
    markdownPath: nullableString(row.markdown_path)
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
