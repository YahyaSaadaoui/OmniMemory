export type MemoryStatus = 'Draft' | 'Verified' | 'Production Verified' | 'Deprecated';

export interface CapturedConversation {
  id: string;
  tool: string;
  content: string;
  timestamp: string;
}

export interface CapturedCommit {
  id: string;
  hash: string | null;
  message: string | null;
  author: string | null;
  branch: string | null;
  filesChanged: string[];
  diffSummary: string;
  diff: string;
  createdAt: string;
}

export interface MemoryCard {
  id: string;
  title: string;
  problem: string;
  symptoms: string;
  rootCause: string;
  attempts: string;
  solution: string;
  filesChanged: string[];
  relatedPr: string | null;
  lessons: string;
  confidence: number;
  status: MemoryStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sourceCommitId: string | null;
  sourceConversationId: string | null;
  markdownPath: string | null;
}

export interface MemoryDraft {
  title: string;
  problem: string;
  symptoms: string;
  rootCause: string;
  attempts: string;
  solution: string;
  filesChanged: string[];
  relatedPr: string | null;
  lessons: string;
  confidence: number;
  status: MemoryStatus;
  tags: string[];
  sourceCommitId: string | null;
  sourceConversationId: string | null;
}

export interface SearchResult {
  id: string;
  title: string;
  problem: string;
  rootCause: string;
  solution: string;
  status: MemoryStatus;
  confidence: number;
  createdAt: string;
  markdownPath: string | null;
  score?: number;
  matchedFields?: string[];
}
