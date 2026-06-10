import { MemoryDraft } from '../types';

export interface MemoryQualityResult {
  qualityScore: number;
  qualityWarnings: string[];
}

export function evaluateMemoryQuality(draft: MemoryDraft): MemoryQualityResult {
  const warnings: string[] = [];
  let score = Math.round(draft.confidence * 100);

  if (isGenericTitle(draft.title)) {
    warnings.push('Title is generic or too short.');
    score -= 10;
  }
  if (isMissing(draft.problem)) {
    warnings.push('Problem statement is missing or inferred.');
    score -= 12;
  }
  if (isMissing(draft.rootCause)) {
    warnings.push('Root cause is missing or inferred.');
    score -= 20;
  }
  if (isMissing(draft.solution)) {
    warnings.push('Final solution is missing or inferred.');
    score -= 18;
  }
  if (isMissing(draft.symptoms)) {
    warnings.push('Symptoms are missing.');
    score -= 8;
  }
  if (isMissing(draft.attempts)) {
    warnings.push('Failed or investigated attempts are missing.');
    score -= 6;
  }
  if (isMissing(draft.lessons)) {
    warnings.push('Lessons learned are missing.');
    score -= 8;
  }
  if (draft.filesChanged.length === 0) {
    warnings.push('No changed files were captured.');
    score -= 8;
  }
  if (draft.tags.length === 0) {
    warnings.push('No tags were inferred.');
    score -= 4;
  }

  return {
    qualityScore: clamp(score, 0, 100),
    qualityWarnings: warnings
  };
}

function isMissing(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized.length === 0
    || normalized.includes('not explicit')
    || normalized.includes('not explicitly captured')
    || normalized.includes('no conversation text was captured');
}

function isGenericTitle(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized.length < 12
    || normalized === 'engineering memory'
    || normalized === 'fix'
    || normalized === 'bug'
    || normalized === 'issue';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
