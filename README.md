# AI Commit

Generate commit messages from staged changes using [Claude Code](https://claude.com/claude-code) — no Copilot required.

If you already use Claude Code in your terminal and don't want GitHub Copilot's commit message generation, this extension gives you the same "generate commit message" button in the Source Control panel, powered by the `claude` CLI instead.

## How it works

1. Click the chat-sparkle icon (💬✨) in the Source Control panel title bar (or run **Generate Commit Message** from the Command Palette).
2. The extension reads your staged diff (or, for new files with no diff, the list of staged paths).
3. It shells out to the `claude` CLI (`claude -p --model claude-haiku-4-5`) with the diff piped in and a system prompt instructing it to write a concise, present-tense commit message.
4. The generated message is written directly into the Source Control input box.

## Requirements

- [Claude Code CLI](https://claude.com/claude-code) installed and available on your `PATH` as `claude`.
- The CLI must be authenticated (`claude` should already work from your terminal).
- Git source control must be active in the workspace (uses VS Code's built-in `vscode.git` extension).

## Custom instructions

Drop a `.vscode/diffwise/instructions.md` file in your workspace to append extra instructions to the system prompt (e.g. house commit conventions, ticket-reference formats, scope naming). Its contents are appended verbatim after the default prompt on every generation.

## Notes

- By default, generated messages include a `Co-Authored-By` trailer. Adjust or remove this via `.vscode/diffwise/instructions.md` if you don't want it.
- Uses `claude-haiku-4-5` for fast, low-cost generation. Model is currently hardcoded in `src/extension.ts`.

*I and this extension's development are in no way, shape or form directly affiliated with Anthropic or Claude*

Feel free to leave a review or a rating. It helps a lot!