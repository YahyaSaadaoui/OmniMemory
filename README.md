# OmniMemory

OmniMemory is an Engineering Memory Platform prototype for VS Code. It captures engineering conversations and Git context, synthesizes a structured memory card, stores it in local SQLite, and writes a Markdown artifact into `.memory/`.

## MVP Flow

1. Open a workspace in VS Code.
2. Put an AI conversation, debugging notes, incident writeup, or PR reasoning in the active editor.
3. Run `OmniMemory: Generate Memory From Current Context`.
4. OmniMemory reads the active text plus local Git branch, commit, changed files, and diff.
5. A memory card is saved to `.memory/` and indexed in `.omnimemory/omnimemory.sqlite`.

If no editor text is available, OmniMemory asks for a short note and can fall back to Git context only.

When commit detection is enabled, OmniMemory watches the current Git `HEAD` and prompts to generate a memory after a new commit appears.

For clean commit captures, OmniMemory checks whether that commit already has a memory and offers to open the existing card instead of creating a duplicate.

## Commands

- `OmniMemory: Generate Memory From Current Context`
- `OmniMemory: Generate Memory From Git Context`
- `OmniMemory: Search Memories`
- `OmniMemory: Find Similar Memories From Context`
- `OmniMemory: Update Memory Status`
- `OmniMemory: Verify Memory With Command`
- `OmniMemory: Review Memory Queue`
- `OmniMemory: Sync Active Memory Markdown`
- `OmniMemory: Refresh Related Memories`
- `OmniMemory: Open Memory Folder`

Search ranks local memories by title, tags, files changed, root cause, solution, problem, symptoms, lessons, and attempts.

Context search uses the active selection, nearby diagnostics, current line, surrounding code, and file name to answer whether a similar issue has already been captured.

Related memory links are refreshed after generation or Markdown sync, and can be rebuilt manually with `OmniMemory: Refresh Related Memories`.

Verification can run a local workspace command, store the exit code and output as evidence, and mark the memory `Verified` when the command succeeds.

The review queue surfaces Drafts and low-quality memories with warnings for missing root cause, solution, symptoms, attempts, lessons, files, tags, or overly generic titles.

After editing a generated `.memory/*.md` card, run `OmniMemory: Sync Active Memory Markdown` to update the SQLite card and recompute quality warnings.

## Development

```bash
npm install
npm test
```

Then press `F5` in VS Code to launch an Extension Development Host.

## Local-First Storage

- Markdown memory cards: `.memory/`
- SQLite database: `.omnimemory/omnimemory.sqlite`

The database path and memory directory can be changed in VS Code settings.

## Settings

- `omniMemory.databasePath`
- `omniMemory.memoryDirectory`
- `omniMemory.defaultConversationTool`
- `omniMemory.maxDiffCharacters`
- `omniMemory.enableCommitDetection`
- `omniMemory.commitDetectionIntervalSeconds`
- `omniMemory.verificationCommand`
- `omniMemory.maxVerificationOutputCharacters`
