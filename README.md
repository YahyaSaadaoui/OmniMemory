# OmniMemory

OmniMemory is an Engineering Memory Platform prototype for VS Code. It captures engineering conversations and Git context, synthesizes a structured memory card, stores it in local SQLite, and writes a Markdown artifact into `.memory/`.

## MVP Flow

1. Open a workspace in VS Code.
2. Put an AI conversation, debugging notes, incident writeup, or PR reasoning in the active editor.
3. Run `OmniMemory: Generate Memory From Current Context`.
4. OmniMemory reads the active text plus local Git branch, commit, changed files, and diff.
5. A memory card is saved to `.memory/` and indexed in `.omnimemory/omnimemory.sqlite`.

## Commands

- `OmniMemory: Generate Memory From Current Context`
- `OmniMemory: Search Memories`
- `OmniMemory: Update Memory Status`
- `OmniMemory: Open Memory Folder`

## Development

```bash
npm install
npm run compile
```

Then press `F5` in VS Code to launch an Extension Development Host.

## Local-First Storage

- Markdown memory cards: `.memory/`
- SQLite database: `.omnimemory/omnimemory.sqlite`

The database path and memory directory can be changed in VS Code settings.
