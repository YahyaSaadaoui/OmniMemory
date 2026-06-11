import { MemoryCard } from '../types';

export interface MemoryBundle {
  schemaVersion: 1;
  exportedAt: string;
  memoryCount: number;
  memories: MemoryCard[];
}

export function createMemoryBundle(memories: MemoryCard[], exportedAt = new Date().toISOString()): MemoryBundle {
  return {
    schemaVersion: 1,
    exportedAt,
    memoryCount: memories.length,
    memories
  };
}

export function renderMemoryBundleJson(memories: MemoryCard[], exportedAt?: string): string {
  return `${JSON.stringify(createMemoryBundle(memories, exportedAt), null, 2)}\n`;
}

export function renderMemoryBundleMarkdown(memories: MemoryCard[], exportedAt = new Date().toISOString()): string {
  const body = memories.map(renderMemorySummary).join('\n\n---\n\n');

  return `# OmniMemory Export

Exported: ${exportedAt}
Memories: ${memories.length}

${body || 'No memories exported.'}
`;
}

function renderMemorySummary(memory: MemoryCard): string {
  return `## ${memory.title}

- Status: ${memory.status}
- Confidence: ${Math.round(memory.confidence * 100)}%
- Quality: ${memory.qualityScore}/100
- Created: ${memory.createdAt}
- Updated: ${memory.updatedAt}
- Files: ${memory.filesChanged.length > 0 ? memory.filesChanged.join(', ') : 'N/A'}
- Tags: ${memory.tags.length > 0 ? memory.tags.join(', ') : 'N/A'}

### Problem

${memory.problem}

### Root Cause

${memory.rootCause}

### Final Solution

${memory.solution}

### Lessons Learned

${memory.lessons}

### Verification

${memory.verificationEvents.length > 0
  ? memory.verificationEvents.map((event) => `- ${event.exitCode === 0 ? 'Passed' : 'Failed'}: ${event.command} (${event.createdAt})`).join('\n')
  : 'No verification evidence recorded.'}

### Security Review

${memory.redactionEvents.length > 0
  ? memory.redactionEvents.map((event) => `- ${event.source}: ${event.label} x${event.count}`).join('\n')
  : 'No sensitive values were redacted.'}

### Source

- Memory ID: ${memory.id}
- Markdown Path: ${memory.markdownPath ?? 'N/A'}`;
}
