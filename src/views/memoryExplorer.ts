import * as vscode from 'vscode';
import { SQLiteMemoryStore } from '../storage/sqliteMemoryStore';
import { SearchResult } from '../types';

type MemoryExplorerNode = MemoryGroupNode | MemoryCardNode | EmptyNode;

interface MemoryGroupNode {
  kind: 'group';
  id: string;
  label: string;
  description: string;
}

interface MemoryCardNode {
  kind: 'memory';
  result: SearchResult;
}

interface EmptyNode {
  kind: 'empty';
  label: string;
}

export class MemoryExplorerProvider implements vscode.TreeDataProvider<MemoryExplorerNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MemoryExplorerNode | undefined | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly getStore: () => Promise<SQLiteMemoryStore>) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: MemoryExplorerNode): vscode.TreeItem {
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.description = element.description;
      item.contextValue = 'omniMemoryGroup';
      item.iconPath = new vscode.ThemeIcon('folder-library');
      return item;
    }

    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'omniMemoryEmpty';
      item.iconPath = new vscode.ThemeIcon('circle-slash');
      return item;
    }

    const result = element.result;
    const item = new vscode.TreeItem(result.title, vscode.TreeItemCollapsibleState.None);
    item.id = result.id;
    item.description = formatMemoryDescription(result);
    item.tooltip = formatMemoryTooltip(result);
    item.contextValue = 'omniMemoryCard';
    item.iconPath = new vscode.ThemeIcon(iconForStatus(result.status));
    item.command = {
      command: 'omniMemory.openMemory',
      title: 'Open Memory',
      arguments: [result.id]
    };

    return item;
  }

  async getChildren(element?: MemoryExplorerNode): Promise<MemoryExplorerNode[]> {
    if (!element) {
      return [
        {
          kind: 'group',
          id: 'omniMemory.reviewQueue',
          label: 'Review Queue',
          description: 'Drafts and low-quality memories'
        },
        {
          kind: 'group',
          id: 'omniMemory.recentMemories',
          label: 'Recent Memories',
          description: 'Latest captured cards'
        }
      ];
    }

    if (element.kind !== 'group') {
      return [];
    }

    const db = await this.getStore();
    const results = element.id === 'omniMemory.reviewQueue'
      ? db.listReviewQueue(25)
      : db.listRecentMemories(25);

    return results.length > 0
      ? results.map((result) => ({ kind: 'memory', result }))
      : [{ kind: 'empty', label: element.id === 'omniMemory.reviewQueue' ? 'No memories need review' : 'No memories captured yet' }];
  }
}

function formatMemoryDescription(result: SearchResult): string {
  const parts = [
    result.status,
    `${Math.round(result.confidence * 100)}%`
  ];

  if (result.qualityScore !== undefined) {
    parts.push(`quality ${result.qualityScore}`);
  }

  return parts.join(' · ');
}

function formatMemoryTooltip(result: SearchResult): string {
  const warnings = result.qualityWarnings?.length
    ? `\n\nQuality warnings:\n${result.qualityWarnings.map((warning) => `- ${warning}`).join('\n')}`
    : '';

  return `${result.title}

Problem:
${result.problem}

Root Cause:
${result.rootCause}

Solution:
${result.solution}${warnings}`;
}

function iconForStatus(status: string): string {
  switch (status) {
    case 'Verified':
      return 'verified-filled';
    case 'Production Verified':
      return 'shield';
    case 'Deprecated':
      return 'trash';
    default:
      return 'note';
  }
}
