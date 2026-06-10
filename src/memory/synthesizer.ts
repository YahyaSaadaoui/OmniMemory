import { CapturedCommit, CapturedConversation, MemoryDraft } from '../types';
import { compactWhitespace, firstNonEmptyLine, uniqueStrings } from '../text';

type ParsedSections = Map<string, string>;

const sectionAliases = new Map<string, string>([
  ['title', 'title'],
  ['problem', 'problem'],
  ['symptoms', 'symptoms'],
  ['root cause', 'rootCause'],
  ['root_cause', 'rootCause'],
  ['cause', 'rootCause'],
  ['attempts', 'attempts'],
  ['attempted', 'attempts'],
  ['failed attempts', 'attempts'],
  ['final solution', 'solution'],
  ['solution', 'solution'],
  ['fix', 'solution'],
  ['files changed', 'filesChanged'],
  ['related pr', 'relatedPr'],
  ['related pull request', 'relatedPr'],
  ['lessons learned', 'lessons'],
  ['lessons', 'lessons'],
  ['tags', 'tags']
]);

const problemKeywords = ['bug', 'issue', 'problem', 'failure', 'failed', 'crash', 'exception', 'error', 'regression', 'broken'];
const rootCauseKeywords = ['root cause', 'caused by', 'because', 'due to', 'mismatch', 'race condition', 'incorrect', 'missing', 'null'];
const attemptKeywords = ['tried', 'attempt', 'failed', 'investigated', 'debugged', 'rolled back', 'reverted', 'checked'];
const solutionKeywords = ['fixed', 'solution', 'resolved', 'changed', 'updated', 'added', 'removed', 'patched'];

export function synthesizeMemory(conversation: CapturedConversation, commit: CapturedCommit): MemoryDraft {
  const sections = parseSections(conversation.content);
  const lines = meaningfulLines(conversation.content);
  const title = cleanTitle(
    readSection(sections, 'title')
    ?? firstCommitLine(commit.message)
    ?? findLine(lines, problemKeywords)
    ?? firstNonEmptyLine(conversation.content)
    ?? 'Engineering Memory'
  );
  const problem = readSection(sections, 'problem')
    ?? findLine(lines, problemKeywords)
    ?? firstCommitLine(commit.message)
    ?? 'Problem was not explicitly captured. Review the linked conversation and Git context.';
  const symptoms = readSection(sections, 'symptoms')
    ?? listMatchingLines(lines, ['error', 'exception', 'failed', 'crash', 'timeout', 'null', 'undefined', 'not working'])
    ?? 'Symptoms were not explicitly captured.';
  const rootCause = readSection(sections, 'rootCause')
    ?? findLine(lines, rootCauseKeywords)
    ?? 'Root cause was not explicit in the captured context.';
  const attempts = readSection(sections, 'attempts')
    ?? listMatchingLines(lines, attemptKeywords)
    ?? 'Prior attempts were not explicitly captured.';
  const solution = readSection(sections, 'solution')
    ?? findLine(lines, solutionKeywords)
    ?? solutionFromCommit(commit)
    ?? 'Final solution was not explicit in the captured context.';
  const lessons = readSection(sections, 'lessons')
    ?? inferLesson(rootCause, solution);
  const tags = uniqueStrings([
    ...splitTags(readSection(sections, 'tags')),
    ...tagsFromFiles(commit.filesChanged),
    ...tagsFromText(`${conversation.content}\n${commit.diffSummary}`)
  ]).slice(0, 12);

  return {
    title,
    problem: normalizeBlock(problem),
    symptoms: normalizeBlock(symptoms),
    rootCause: normalizeBlock(rootCause),
    attempts: normalizeBlock(attempts),
    solution: normalizeBlock(solution),
    filesChanged: commit.filesChanged,
    relatedPr: readSection(sections, 'relatedPr') ?? findRelatedPr(`${conversation.content}\n${commit.message ?? ''}`),
    lessons: normalizeBlock(lessons),
    confidence: calculateConfidence(sections, conversation, commit),
    status: 'Draft',
    tags,
    sourceCommitId: commit.id,
    sourceConversationId: conversation.id
  };
}

function parseSections(content: string): ParsedSections {
  const sections: ParsedSections = new Map();
  let currentKey: string | undefined;
  let currentValue: string[] = [];

  const flush = () => {
    if (currentKey) {
      const value = currentValue.join('\n').trim();
      if (value) {
        sections.set(currentKey, value);
      }
    }
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = line.match(/^(?:#{1,6}\s*)?([A-Za-z][A-Za-z0-9 _/-]{1,40})(?:\s*:\s*(.*)|\s*)$/);
    const alias = match ? sectionAliases.get(match[1].toLowerCase().trim()) : undefined;

    if (alias) {
      flush();
      currentKey = alias;
      currentValue = match?.[2] ? [match[2]] : [];
      continue;
    }

    if (currentKey) {
      currentValue.push(rawLine);
    }
  }

  flush();
  return sections;
}

function readSection(sections: ParsedSections, key: string): string | undefined {
  const value = sections.get(key)?.trim();
  return value || undefined;
}

function meaningfulLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length >= 8 && !line.startsWith('```'));
}

function findLine(lines: string[], keywords: string[]): string | undefined {
  return lines.find((line) => containsAny(line, keywords));
}

function listMatchingLines(lines: string[], keywords: string[]): string | undefined {
  const matches = uniqueStrings(lines.filter((line) => containsAny(line, keywords))).slice(0, 6);

  if (matches.length === 0) {
    return undefined;
  }

  return matches.map((line) => `- ${line}`).join('\n');
}

function containsAny(value: string, keywords: string[]): boolean {
  const lower = value.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function cleanTitle(value: string): string {
  const line = compactWhitespace(value.split(/\r?\n/)[0] ?? value);
  const withoutMarkdown = line.replace(/^[-#*\s]+/, '').replace(/[`*_]/g, '');
  return withoutMarkdown.slice(0, 90) || 'Engineering Memory';
}

function firstCommitLine(message: string | null): string | undefined {
  if (!message) {
    return undefined;
  }

  return firstNonEmptyLine(message);
}

function solutionFromCommit(commit: CapturedCommit): string | undefined {
  const subject = firstCommitLine(commit.message);

  if (!subject && commit.filesChanged.length === 0) {
    return undefined;
  }

  const files = commit.filesChanged.length > 0
    ? `Changed files: ${commit.filesChanged.slice(0, 12).join(', ')}.`
    : undefined;

  return [subject, files].filter(Boolean).join('\n');
}

function inferLesson(rootCause: string, solution: string): string {
  if (!rootCause.includes('not explicit') && !solution.includes('not explicit')) {
    return 'Preserve the root cause and final fix with the code change so future debugging starts from the verified path.';
  }

  return 'Capture explicit root cause, failed attempts, and verification evidence before promoting this memory beyond Draft.';
}

function splitTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,#\n]/)
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
}

function tagsFromFiles(files: string[]): string[] {
  const tags: string[] = [];

  for (const file of files) {
    const lower = file.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
      tags.push('typescript');
    }
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) {
      tags.push('javascript');
    }
    if (lower.endsWith('.py')) {
      tags.push('python');
    }
    if (lower.endsWith('.sql') || lower.includes('migration')) {
      tags.push('database');
    }
    if (lower.includes('test') || lower.includes('spec')) {
      tags.push('tests');
    }
    if (lower.includes('auth')) {
      tags.push('auth');
    }
    if (lower.includes('payment')) {
      tags.push('payments');
    }
  }

  return tags;
}

function tagsFromText(value: string): string[] {
  const lower = value.toLowerCase();
  const tags: string[] = [];
  const knownTerms = [
    'kafka',
    'redis',
    'postgres',
    'sqlite',
    'graphql',
    'rest',
    'api',
    'react',
    'node',
    'docker',
    'kubernetes',
    'ci',
    'deployment',
    'incident',
    'memory',
    'vscode'
  ];

  for (const term of knownTerms) {
    if (lower.includes(term)) {
      tags.push(term);
    }
  }

  return tags;
}

function findRelatedPr(value: string): string | null {
  const url = value.match(/https?:\/\/[^\s)]+\/pull\/\d+/i);
  if (url) {
    return url[0];
  }

  const pr = value.match(/\b(?:PR|pull request)\s*#?(\d+)\b/i);
  return pr ? `PR #${pr[1]}` : null;
}

function calculateConfidence(sections: ParsedSections, conversation: CapturedConversation, commit: CapturedCommit): number {
  let confidence = 0.42;

  if (sections.has('problem')) {
    confidence += 0.12;
  }
  if (sections.has('rootCause')) {
    confidence += 0.16;
  }
  if (sections.has('solution')) {
    confidence += 0.14;
  }
  if (sections.has('lessons')) {
    confidence += 0.08;
  }
  if (commit.diff || commit.filesChanged.length > 0) {
    confidence += 0.08;
  }
  if (conversation.content.length > 800) {
    confidence += 0.05;
  }

  return Math.min(0.95, Number(confidence.toFixed(2)));
}

function normalizeBlock(value: string): string {
  return value.trim().replace(/\n{3,}/g, '\n\n');
}
