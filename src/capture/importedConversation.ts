import { truncate } from '../text';

export function normalizeImportedConversation(content: string, maxCharacters: number): string {
  return truncate(
    content
      .replace(/\u0000/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim(),
    maxCharacters
  );
}

export function detectConversationTool(content: string, fileName = ''): string {
  const value = `${fileName}\n${content.slice(0, 4000)}`.toLowerCase();

  if (value.includes('claude code') || value.includes('anthropic') || value.includes('claude')) {
    return 'Claude Code';
  }
  if (value.includes('chatgpt') || value.includes('openai')) {
    return 'ChatGPT';
  }
  if (value.includes('cursor')) {
    return 'Cursor';
  }
  if (value.includes('copilot')) {
    return 'GitHub Copilot';
  }

  return 'manual';
}
