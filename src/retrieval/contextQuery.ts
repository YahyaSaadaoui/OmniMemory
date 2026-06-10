import { compactWhitespace, truncate } from '../text';

export interface RetrievalContextInput {
  selectedText?: string;
  diagnosticMessages?: string[];
  currentLine?: string;
  surroundingText?: string;
  fileName?: string;
  maxCharacters?: number;
}

export function buildRetrievalQuery(input: RetrievalContextInput): string {
  const maxCharacters = input.maxCharacters ?? 4000;
  const parts = [
    input.selectedText,
    ...(input.diagnosticMessages ?? []),
    input.currentLine,
    input.surroundingText,
    input.fileName
  ]
    .map((part) => normalizeQueryPart(part))
    .filter(Boolean);

  return truncate(uniqueParts(parts).join('\n'), maxCharacters).trim();
}

function normalizeQueryPart(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const withoutAnsi = value.replace(/\u001b\[[0-9;]*m/g, '');
  const withoutStackNoise = withoutAnsi
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.match(/^\s*at\s+.+\(.+\)$/))
    .join('\n');

  return compactWhitespace(withoutStackNoise);
}

function uniqueParts(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
}
