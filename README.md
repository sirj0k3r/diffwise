# Diffwise

Generate commit messages from staged changes using [Claude Code](https://claude.com/claude-code) — no Copilot required.

If you already use Claude Code in your terminal and don't want GitHub Copilot's commit message generation, this extension gives you the same "generate commit message" button in the Source Control panel, powered by the `claude` CLI instead.

## How it works

1. Click the chat-sparkle icon (💬✨) in the Source Control panel title bar (or run **Generate Commit Message** from the Command Palette).
2. The extension reads your staged diff (or, for new files with no diff, the list of staged paths).
3. It shells out to the `claude` CLI with the diff piped in and a system prompt instructing it to write a concise, present-tense commit message.
4. The generated message is written directly into the Source Control input box.

## Requirements

- [Claude Code CLI](https://claude.com/claude-code) installed and signed in (`claude auth login`).
  Diffwise looks for it on your `PATH`, then in the usual install locations. If it still cannot find it,
  the error offers **Locate claude...** to point at it once, which is stored in `diffwise.claudePath`.
- Git source control must be active in the workspace (uses VS Code's built-in `vscode.git` extension).

## Custom instructions

Drop an `instructions.md` file in either location to append extra instructions to the system prompt (e.g. house commit conventions, ticket-reference formats, scope naming):

| Scope | Path | Applies to |
| --- | --- | --- |
| Global | `~/.vscode/diffwise/instructions.md` | Every repository. Created for you on first activation. |
| Project | `<repo>/.vscode/diffwise/instructions.md` | That repository only. Also read from the workspace folder root when it differs from the repo root. |

Both are optional, and both are appended after the built-in prompt. They are **cumulative**: the project file does not replace the global one, it only takes precedence where the two conflict.

## Model selection

Run **Diffwise: Select Model** from the Command Palette (or the Source Control panel menu), or set `diffwise.model` in settings:

- `haiku` (default) — fast, cheap. Good for most diffs.
- `sonnet` — slower, better on large or subtle diffs.

The setting is `scope: resource`, so a workspace can override the global choice per repository.

### Claude CLI location

`diffwise.claudePath` overrides which executable is run. Leave it empty unless Diffwise reports the CLI
as missing, or you have more than one install and want to pin one. The setting is `scope: machine`, so a
workspace cannot decide which binary runs on your behalf.

## Notes

- By default, generated messages include a `Co-Authored-By` trailer. Adjust or remove this via an `instructions.md` if you don't want it.

*I and this extension's development are in no way, shape or form directly affiliated with Anthropic or Claude*

Feel free to leave a review or a rating. It helps a lot!
