import { MemoryCardUpdate, MemoryStatus } from '../types';

export interface ParsedMemoryMarkdown {
  memoryId: string;
  update: MemoryCardUpdate;
}

const validStatuses = new Set<MemoryStatus>([
  'Draft',
  'Verified',
  'Production Verified',
  'Deprecated'
]);

export function parseMemoryMarkdown(content: string): ParsedMemoryMarkdown {
  const title = parseTitle(content);
  const sections = parseSections(content);
  const source = readRequiredSection(sections, 'Source');
  const memoryId = parseMemoryId(source);
  const status = parseStatus(content);

  return {
    memoryId,
    update: {
      title,
      problem: readRequiredSection(sections, 'Problem'),
      symptoms: readOptionalSection(sections, 'Symptoms') || 'Symptoms were not explicitly captured.',
      rootCause: readRequiredSection(sections, 'Root Cause'),
      attempts: readOptionalSection(sections, 'Attempts') || 'Prior attempts were not explicitly captured.',
      solution: readRequiredSection(sections, 'Final Solution'),
      filesChanged: parseList(readOptionalSection(sections, 'Files Changed')),
      relatedPr: parseRelatedPr(content),
      lessons: readOptionalSection(sections, 'Lessons Learned') || 'Lessons learned were not explicitly captured.',
      status,
      tags: parseTags(readOptionalSection(sections, 'Tags'))
    }
  };
}

function parseTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim();

  if (!title) {
    throw new Error('Memory Markdown is missing a top-level title.');
  }

  return title;
}

function parseStatus(content: string): MemoryStatus {
  const match = content.match(/^Status:\s*(.+)$/m);
  const status = match?.[1]?.trim() as MemoryStatus | undefined;

  if (!status || !validStatuses.has(status)) {
    return 'Draft';
  }

  return status;
}

function parseRelatedPr(content: string): string | null {
  const match = content.match(/^Related PR:\s*(.+)$/m);
  const value = match?.[1]?.trim();

  if (!value || value === 'N/A') {
    return null;
  }

  return value;
}

function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = [...content.matchAll(/^##\s+(.+)$/gm)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const name = match[1].trim();
    const start = (match.index ?? 0) + match[0].length;
    const end = nextMatch?.index ?? content.length;
    sections.set(name, content.slice(start, end).trim());
  }

  return sections;
}

function readRequiredSection(sections: Map<string, string>, name: string): string {
  const value = readOptionalSection(sections, name);

  if (!value) {
    throw new Error(`Memory Markdown is missing the "${name}" section.`);
  }

  return value;
}

function readOptionalSection(sections: Map<string, string>, name: string): string {
  const value = sections.get(name)?.trim();
  return value && value !== 'N/A' ? value : '';
}

function parseMemoryId(source: string): string {
  const match = source.match(/Memory ID:\s*([^\s]+)/);
  const memoryId = match?.[1]?.trim();

  if (!memoryId) {
    throw new Error('Memory Markdown source is missing Memory ID.');
  }

  return memoryId;
}

function parseList(value: string): string[] {
  if (!value || value === 'N/A') {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s+/, ''))
    .filter((line) => line && line !== 'N/A');
}

function parseTags(value: string): string[] {
  if (!value || value === 'N/A') {
    return [];
  }

  const backtickTags = [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim());
  if (backtickTags.length > 0) {
    return backtickTags.filter(Boolean);
  }

  return value
    .split(/[\s,#]+/)
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter((tag) => tag && tag !== 'N/A');
}
