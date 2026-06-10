import { execFile } from 'child_process';
import { promisify } from 'util';
import { createId } from '../id';
import { CapturedCommit } from '../types';
import { truncate, uniqueStrings } from '../text';

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 15 * 1024 * 1024
    });

    return result.stdout.trimEnd();
  } catch {
    return null;
  }
}

export async function getCurrentGitHead(workspaceRoot: string): Promise<string | null> {
  const gitRoot = await runGit(['rev-parse', '--show-toplevel'], workspaceRoot);
  if (!gitRoot) {
    return null;
  }

  return runGit(['rev-parse', 'HEAD'], gitRoot);
}

function splitLines(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function collectWorkingDiff(gitRoot: string): Promise<{ diff: string; summary: string; files: string[] }> {
  const stagedDiff = await runGit(['diff', '--cached', '--no-ext-diff'], gitRoot);
  const unstagedDiff = await runGit(['diff', '--no-ext-diff'], gitRoot);
  const status = await runGit(['status', '--short'], gitRoot);
  const stagedStat = await runGit(['diff', '--cached', '--stat'], gitRoot);
  const unstagedStat = await runGit(['diff', '--stat'], gitRoot);
  const stagedFiles = await runGit(['diff', '--cached', '--name-only'], gitRoot);
  const unstagedFiles = await runGit(['diff', '--name-only'], gitRoot);
  const untrackedFiles = await runGit(['ls-files', '--others', '--exclude-standard'], gitRoot);

  return {
    diff: [stagedDiff, unstagedDiff].filter(Boolean).join('\n\n'),
    summary: [status, stagedStat, unstagedStat].filter(Boolean).join('\n\n'),
    files: uniqueStrings([
      ...splitLines(stagedFiles),
      ...splitLines(unstagedFiles),
      ...splitLines(untrackedFiles)
    ])
  };
}

async function collectLastCommitDiff(gitRoot: string, hash: string | null): Promise<{ diff: string; summary: string; files: string[] }> {
  if (!hash) {
    return { diff: '', summary: '', files: [] };
  }

  const diff = await runGit(['show', '--format=', '--no-ext-diff', '--unified=80', hash], gitRoot);
  const summary = await runGit(['show', '--stat', '--oneline', hash], gitRoot);
  const files = await runGit(['show', '--format=', '--name-only', hash], gitRoot);

  return {
    diff: diff ?? '',
    summary: summary ?? '',
    files: splitLines(files)
  };
}

export async function captureGitContext(workspaceRoot: string, maxDiffCharacters: number): Promise<CapturedCommit> {
  const gitRoot = await runGit(['rev-parse', '--show-toplevel'], workspaceRoot);
  const now = new Date().toISOString();

  if (!gitRoot) {
    return {
      id: createId('commit'),
      hash: null,
      message: null,
      author: null,
      branch: null,
      filesChanged: [],
      hasWorkingChanges: false,
      diffSummary: 'Workspace is not inside a Git repository.',
      diff: '',
      createdAt: now
    };
  }

  const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot);
  const hash = await runGit(['rev-parse', 'HEAD'], gitRoot);
  const message = await runGit(['log', '-1', '--pretty=%B'], gitRoot);
  const author = await runGit(['log', '-1', '--pretty=%an <%ae>'], gitRoot);
  const working = await collectWorkingDiff(gitRoot);
  const hasWorkingChanges = Boolean(working.diff || working.files.length > 0);
  const lastCommit = working.diff || working.files.length > 0
    ? { diff: '', summary: '', files: [] }
    : await collectLastCommitDiff(gitRoot, hash);
  const diff = working.diff || lastCommit.diff;
  const summary = [working.summary, lastCommit.summary].filter(Boolean).join('\n\n');
  const files = uniqueStrings([...working.files, ...lastCommit.files]);

  return {
    id: createId('commit'),
    hash,
    message,
    author,
    branch,
    filesChanged: files,
    hasWorkingChanges,
    diffSummary: summary || 'No Git diff or recent commit context was available.',
    diff: truncate(diff, maxDiffCharacters),
    createdAt: now
  };
}
