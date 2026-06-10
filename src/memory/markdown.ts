import * as fs from 'fs/promises';
import * as path from 'path';
import { MemoryCard } from '../types';
import { slugify } from '../text';

export async function writeMemoryMarkdown(memoryDirectory: string, card: MemoryCard): Promise<string> {
  await fs.mkdir(memoryDirectory, { recursive: true });

  const fileName = `${slugify(card.title)}-${card.id.slice(-8)}.md`;
  const filePath = path.join(memoryDirectory, fileName);
  await fs.writeFile(filePath, renderMemoryCardMarkdown(card), 'utf8');

  return filePath;
}

export async function overwriteMemoryMarkdown(filePath: string, card: MemoryCard): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, renderMemoryCardMarkdown(card), 'utf8');
}

export function renderMemoryCardMarkdown(card: MemoryCard): string {
  return `# ${card.title}

Status: ${card.status}
Confidence: ${Math.round(card.confidence * 100)}%
Quality: ${card.qualityScore}/100
Created: ${card.createdAt}
Updated: ${card.updatedAt}
Related PR: ${card.relatedPr ?? 'N/A'}

## Problem

${card.problem}

## Symptoms

${card.symptoms}

## Root Cause

${card.rootCause}

## Attempts

${card.attempts}

## Final Solution

${card.solution}

## Files Changed

${formatList(card.filesChanged)}

## Lessons Learned

${card.lessons}

## Tags

${formatInlineTags(card.tags)}

## Related Memories

${formatRelatedMemories(card)}

## Verification

${formatVerification(card)}

## Quality Review

${formatQualityReview(card)}

## Source

- Memory ID: ${card.id}
- Commit Capture ID: ${card.sourceCommitId ?? 'N/A'}
- Conversation Capture ID: ${card.sourceConversationId ?? 'N/A'}
`;
}

function formatList(values: string[]): string {
  if (values.length === 0) {
    return 'N/A';
  }

  return values.map((value) => `- ${value}`).join('\n');
}

function formatInlineTags(tags: string[]): string {
  if (tags.length === 0) {
    return 'N/A';
  }

  return tags.map((tag) => `\`${tag}\``).join(' ');
}

function formatRelatedMemories(card: MemoryCard): string {
  if (card.relatedMemories.length === 0) {
    return 'No related memories linked yet.';
  }

  return card.relatedMemories
    .map((link) => {
      const reasons = link.reasons.length > 0 ? ` · ${link.reasons.join(', ')}` : '';
      const path = link.markdownPath ? ` · ${link.markdownPath}` : '';
      return `- ${link.title} (${link.status}, score ${link.score}${reasons}${path})`;
    })
    .join('\n');
}

function formatVerification(card: MemoryCard): string {
  if (card.verificationEvents.length === 0) {
    return 'No verification evidence recorded yet.';
  }

  return card.verificationEvents
    .map((event) => {
      const status = event.exitCode === 0 ? 'Passed' : 'Failed';
      const output = event.output.trim()
        ? `\n\n\`\`\`text\n${event.output.trim()}\n\`\`\``
        : '';

      return `### ${status}: ${event.command}

- Type: ${event.kind}
- Exit Code: ${event.exitCode}
- Recorded: ${event.createdAt}${output}`;
    })
    .join('\n\n');
}

function formatQualityReview(card: MemoryCard): string {
  if (card.qualityWarnings.length === 0) {
    return 'No quality warnings.';
  }

  return card.qualityWarnings.map((warning) => `- ${warning}`).join('\n');
}
