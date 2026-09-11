import * as vscode from 'vscode';
import { execFile } from 'child_process';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import * as utils from './utils';

const systemPrompt = `
You are a helpful assistant that generates concise and meaningful commit messages based on the changes in the code.
You shall NOT use any markdown formatting other than bullet points
You shall NOT generate anything other than the commit message
- Use the present tense ("Add feature" not "Added feature")

One important note: ensure you add 'Co-Authored-By claude <noreply@anthropic.com>' and 'Co-Authored-By sirj0k3r <info.ppf@sapo.pt>' at the end of the commit message\n
`;

export function activate(context: vscode.ExtensionContext) {
  let generating = false;

  // Make sure the global instructions folder exists so users can drop an
  // instructions.md in there without creating the folder tree by hand.
  // A failure here (read-only home, permissions) must never stop the command
  // from being registered, so it is logged and swallowed.
  try {
    fs.mkdirSync(globalInstructionsDir(), { recursive: true });
  }
  catch (e) {
    console.error(`diffwise: failed to create global instructions folder: ${e}`);
  }

  const cmd = vscode.commands.registerCommand('diffwise.generate', async () => {
    if (generating) return;

    const git = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
    const repo = git?.repositories[0];
    if (!repo) return;

    let diff = await repo.diff(true) || await repo.diff(false); // staged diff
    if (!diff) {
      const resources = repo.state.indexChanges.map((c: any) => c.uri.fsPath).join('\n');
      if (!resources) return vscode.window.showWarningMessage('No changes detected.');
      diff = `New files:\n${resources}`;
    }

    generating = true;
    await vscode.commands.executeCommand('setContext', 'diffwise.generating', true);

    const previous = repo.inputBox.value;
    const placeholder = repo.inputBox.placeholder;
    repo.inputBox.value = '';
    // Placeholder and enabled can't seem to be changed, but we'll keep the code for intent declaration purposes
    repo.inputBox.placeholder = 'Generating commit message...';
    repo.inputBox.enabled = false;

    let msg = previous;
    try {
      await utils.withGenerationProgress('Generating commit message...', async token => {
        msg = await callClaude(diff, repo.rootUri.fsPath, token);
      });
    }
    catch (e) {
      // Cancelling is a deliberate user action, not a failure worth reporting.
      if (!(e instanceof vscode.CancellationError)) {
        const reason = e instanceof Error ? e.message : String(e);
        // Not awaited: the finally below restores the input box, and it should
        // not wait on a notification the user may never click.
        void reportFailure(reason);
      }
    }
    finally {
      repo.inputBox.placeholder = placeholder;
      repo.inputBox.value = msg;
      repo.inputBox.enabled = true;
      generating = false;
      await vscode.commands.executeCommand('setContext', 'diffwise.generating', false);
    }
  });

  const selectModel = vscode.commands.registerCommand('diffwise.selectModel', async () => {
    // Scope the "current" marker to the repo in view, since the setting is per resource.
    const git = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
    const repoRoot = git?.repositories[0]?.rootUri.fsPath;
    const current = repoRoot ? utils.getModel(repoRoot) : utils.defaultModel;

    const picked = await vscode.window.showQuickPick(
      utils.models.map(model => ({
        label: model.id,
        detail: model.detail,
        description: model.id === current ? 'current' : undefined
      })),
      { placeHolder: 'Model used to generate commit messages' }
    );
    if (!picked) return;

    // Global: the choice follows the user between repos. A workspace that wants
    // something else can still override it in its own settings.json.
    await vscode.workspace.getConfiguration('diffwise')
      .update('model', picked.label, vscode.ConfigurationTarget.Global);
  });

  context.subscriptions.push(cmd, selectModel);
}


/**
 * Reports a failed generation. When the CLI turns out to be signed out, the
 * message becomes actionable instead of a dead end. The auth probe only runs on
 * this path, so a working setup never pays for the extra process.
 */
async function reportFailure(reason: string): Promise<void> {
  if (await utils.checkAuth() !== 'logged-out') {
    // 'missing' lands here too: its own message already says the CLI is not on
    // PATH, which is the actual problem and is not fixed by signing in.
    vscode.window.showErrorMessage(`Failed to generate commit message: ${reason}`);
    return;
  }

  const pick = await vscode.window.showErrorMessage(
    'Diffwise: the Claude CLI is not signed in.', 'Sign in');
  if (pick !== 'Sign in') return;

  utils.startSignIn(async () => {
    const retry = await vscode.window.showInformationMessage(
      'Diffwise: Claude CLI signed in.', 'Generate commit message');
    if (retry) vscode.commands.executeCommand('diffwise.generate');
  });
}

function globalInstructionsDir(): string {
  return path.join(os.homedir(), '.vscode', 'diffwise');
}

/**
 * Builds the system prompt: the built-in prompt first as the outermost
 * baseline, then the global instructions, then the project ones. Both blocks
 * are cumulative - the project block does not replace the global one, it only
 * takes precedence on conflict, and the wrapper says so explicitly.
 */
function getInstructions(repoRoot: string): string {
  let result = systemPrompt;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(repoRoot))?.uri.fsPath;
  // Repo root and workspace folder often resolve to the same directory, so
  // dedupe before reading or the same file gets injected twice.
  const projectPaths = [...new Set([repoRoot, workspaceFolder].filter((p): p is string => !!p))]
    .map(dir => path.join(dir, '.vscode', 'diffwise', 'instructions.md'));
  const globalPaths = [path.join(globalInstructionsDir(), 'instructions.md')];

  const read = (paths: string[]) => paths
    .filter(p => fs.existsSync(p))
    .map(p => fs.readFileSync(p, 'utf8'))
    .join('\n');

  const globalText = read(globalPaths);
  if (globalText) {
    result += '\n<global instructions - baseline, may be overridden>\n'
      + globalText
      + '\n</global instructions>\n';
  }

  const projectText = read(projectPaths);
  if (projectText) {
    result += '\n<project instructions - AUTHORITATIVE, override the global instructions on any conflict>\n'
      + projectText
      + '\n</project instructions>\n';
  }

  return result;
}

/** First sentence of `text`, period included, or the whole thing if it has none. */
function firstSentence(text: string | undefined): string {
  const trimmed = (text || '').trim();
  const end = trimmed.indexOf('.');
  return end === -1 ? trimmed : trimmed.slice(0, end + 1);
}

/**
 * Turns an execFile failure into something readable: the CLI's own output when
 * it said anything, otherwise a short description of how the process ended.
 * Never includes the spawned argv, which holds the entire system prompt.
 */
function claudeError(err: any, stdout: string, stderr: string): string {
  // claude prints the short user-facing reason on stdout and its longer
  // diagnostics on stderr, so lead with stdout. Only the first sentence goes
  // in the notification - the rest is paragraphs of remediation advice.
  const output = firstSentence([stdout, stderr]
    .map(s => (s || '').trim())
    .find(Boolean));

  const status = err.code === 'ENOENT'
    ? "'claude' CLI not found on PATH"
    : err.signal ? `claude terminated by ${err.signal}`
    : typeof err.code === 'number' ? `claude exited with code ${err.code}`
    : 'claude failed';

  return output ? `${status}\n${output}` : status;
}

function callClaude(diff: string, repoRoot: string, token: vscode.CancellationToken): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--model', utils.getModel(repoRoot), '--no-session-persistence', '--system-prompt', getInstructions(repoRoot),
        'Generate a commit message for this diff. Only the commit message. Nothing else'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.trim());
        // err.message is "Command failed: <argv>", and the argv carries the
        // whole system prompt, so it buries the reason the CLI actually gave.
        // Prefer what claude wrote to stderr/stdout and keep only the exit
        // status from the error itself.
        reject(new Error(claudeError(err, stdout, stderr)));
      }
    );
    const cancel = token.onCancellationRequested(() => {
      child.kill();
      reject(new vscode.CancellationError());
    });
    child.on('close', () => cancel.dispose());
    child.stdin?.end(diff);
  });
}
