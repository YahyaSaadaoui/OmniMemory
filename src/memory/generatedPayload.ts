import { CapturedCommit, CapturedConversation, GeneratedMemoryPayload, MemoryDraft } from '../types';
import { truncate, uniqueStrings } from '../text';

export const generatedMemorySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'problem',
    'symptoms',
    'rootCause',
    'attempts',
    'solution',
    'relatedPr',
    'lessons',
    'confidence',
    'tags'
  ],
  properties: {
    title: { type: 'string' },
    problem: { type: 'string' },
    symptoms: { type: 'string' },
    rootCause: { type: 'string' },
    attempts: { type: 'string' },
    solution: { type: 'string' },
    relatedPr: { type: ['string', 'null'] },
    lessons: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    tags: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

export function buildGeneratorInput(
  conversation: CapturedConversation,
  commit: CapturedCommit,
  maxInputCharacters: number
): string {
  return truncate(JSON.stringify({
    conversation: {
      tool: conversation.tool,
      content: conversation.content,
      timestamp: conversation.timestamp
    },
    git: {
      hash: commit.hash,
      message: commit.message,
      author: commit.author,
      branch: commit.branch,
      filesChanged: commit.filesChanged,
      hasWorkingChanges: commit.hasWorkingChanges,
      diffSummary: commit.diffSummary,
      diff: commit.diff
    }
  }, null, 2), maxInputCharacters);
}

export function validateGeneratedMemoryPayload(value: unknown): GeneratedMemoryPayload {
  if (!isObject(value)) {
    throw new Error('Generator output must be a JSON object.');
  }

  return {
    title: requiredString(value, 'title'),
    problem: requiredString(value, 'problem'),
    symptoms: requiredString(value, 'symptoms'),
    rootCause: requiredString(value, 'rootCause'),
    attempts: requiredString(value, 'attempts'),
    solution: requiredString(value, 'solution'),
    relatedPr: nullableString(value.relatedPr),
    lessons: requiredString(value, 'lessons'),
    confidence: clampConfidence(value.confidence),
    tags: uniqueStrings(arrayOfStrings(value.tags)).slice(0, 12)
  };
}

export function payloadToMemoryDraft(
  payload: GeneratedMemoryPayload,
  conversation: CapturedConversation,
  commit: CapturedCommit
): MemoryDraft {
  return {
    title: payload.title,
    problem: payload.problem,
    symptoms: payload.symptoms,
    rootCause: payload.rootCause,
    attempts: payload.attempts,
    solution: payload.solution,
    filesChanged: commit.filesChanged,
    relatedPr: payload.relatedPr,
    lessons: payload.lessons,
    confidence: payload.confidence,
    status: 'Draft',
    tags: payload.tags,
    sourceCommitId: commit.id,
    sourceConversationId: conversation.id
  };
}

export function parseJsonPayload(raw: string): GeneratedMemoryPayload {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1] ?? trimmed;

  return validateGeneratedMemoryPayload(JSON.parse(jsonText));
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const field = value[key];

  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new Error(`Generator output is missing required string "${key}".`);
  }

  return field.trim();
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('Generator output "relatedPr" must be a string or null.');
  }

  const trimmed = value.trim();
  return trimmed && trimmed !== 'N/A' ? trimmed : null;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('Generator output "confidence" must be a number.');
  }

  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Generator output "tags" must be an array.');
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
