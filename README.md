# OmniMemory

OmniMemory is an Engineering Memory Platform prototype for VS Code. It captures engineering conversations and Git context, synthesizes a structured memory card, stores it in local SQLite, and writes a Markdown artifact into `.memory/`.

## MVP Flow

1. Open a workspace in VS Code.
2. Put an AI conversation, debugging notes, incident writeup, or PR reasoning in the active editor.
3. Run `OmniMemory: Generate Memory From Current Context`.
4. OmniMemory reads the active text plus local Git branch, commit, changed files, and diff.
5. A memory card is saved to `.memory/` and indexed in `.omnimemory/omnimemory.sqlite`.

If no editor text is available, OmniMemory asks for a short note and can fall back to Git context only.

Clipboard and transcript imports support copied AI conversations from ChatGPT, Cursor, Claude Code, GitHub Copilot, or plain text files while keeping processing local.

Memory generation defaults to the offline heuristic generator. For higher-quality synthesis, set `omniMemory.memoryGeneratorProvider` to `openai` or `command`; failed LLM generations fall back to the heuristic generator.

The `command` provider receives conversation and Git context as JSON on stdin and must output JSON with: `title`, `problem`, `symptoms`, `rootCause`, `attempts`, `solution`, `relatedPr`, `lessons`, `confidence`, and `tags`.

When commit detection is enabled, OmniMemory watches the current Git `HEAD` and prompts to generate a memory after a new commit appears.

For clean commit captures, OmniMemory checks whether that commit already has a memory and offers to open the existing card instead of creating a duplicate.

## Commands

- `OmniMemory: Generate Memory From Current Context`
- `OmniMemory: Generate Memory From Git Context`
- `OmniMemory: Generate Memory From Clipboard`
- `OmniMemory: Import Conversation Transcript`
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

When diagnostic similarity search is enabled, OmniMemory watches active editor errors and warnings and suggests the best matching prior memory above the configured score threshold.

Related memory links are refreshed after generation or Markdown sync, and can be rebuilt manually with `OmniMemory: Refresh Related Memories`.

Verification can run a local workspace command, store the exit code and output as evidence, and mark the memory `Verified` when the command succeeds.

The review queue surfaces Drafts and low-quality memories with warnings for missing root cause, solution, symptoms, attempts, lessons, files, tags, or overly generic titles.

After editing a generated `.memory/*.md` card, run `OmniMemory: Sync Active Memory Markdown` to update the SQLite card and recompute quality warnings.

## Development

```bash
npm install
npm test
npm run package:vsix
```

Then press `F5` in VS Code to launch an Extension Development Host.

Install the generated VSIX locally with:

```bash
code --install-extension omnimemory-0.1.0.vsix
```

## Local-First Storage

- Markdown memory cards: `.memory/`
- SQLite database: `.omnimemory/omnimemory.sqlite`

The database path and memory directory can be changed in VS Code settings.

## Settings

- `omniMemory.databasePath`
- `omniMemory.memoryDirectory`
- `omniMemory.defaultConversationTool`
- `omniMemory.conversationImportMaxCharacters`
- `omniMemory.memoryGeneratorProvider`
- `omniMemory.memoryGeneratorOpenAIModel`
- `omniMemory.memoryGeneratorOpenAIEndpoint`
- `omniMemory.memoryGeneratorOpenAIApiKeyEnvVar`
- `omniMemory.memoryGeneratorCommand`
- `omniMemory.memoryGeneratorTimeoutMs`
- `omniMemory.memoryGeneratorMaxInputCharacters`
- `omniMemory.maxDiffCharacters`
- `omniMemory.enableCommitDetection`
- `omniMemory.commitDetectionIntervalSeconds`
- `omniMemory.verificationCommand`
- `omniMemory.maxVerificationOutputCharacters`
- `omniMemory.enableDiagnosticSimilaritySearch`
- `omniMemory.diagnosticSimilarityMinScore`
- `omniMemory.diagnosticSimilarityDebounceMs`
