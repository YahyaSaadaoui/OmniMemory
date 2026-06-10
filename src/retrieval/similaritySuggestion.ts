import { SearchResult } from '../types';

export interface SimilaritySuggestionInput {
  uri: string;
  diagnosticMessages: string[];
  result: SearchResult;
  minScore: number;
}

export function shouldSuggestSimilarMemory(input: SimilaritySuggestionInput): boolean {
  return (input.result.score ?? 0) >= input.minScore;
}

export function buildSimilaritySuggestionKey(input: SimilaritySuggestionInput): string {
  const diagnosticKey = input.diagnosticMessages
    .map((message) => message.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3)
    .join('|');

  return `${input.uri}:${input.result.id}:${diagnosticKey}`;
}
