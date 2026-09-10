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

  const cmd = vscode.commands.registerCommand('ai-commit.generate', async () => {
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
        vscode.window.showErrorMessage(`Failed to generate commit message: ${e}`);
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


function getInstructions(repoRoot: string): string {
  let result = systemPrompt;

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(repoRoot))?.uri.fsPath;
  const candidates = [repoRoot, workspaceFolder]
    .filter((p): p is string => !!p)
    .map(dir => path.join(dir, '.vscode', 'diffwise', 'instructions.md'));
  candidates.push(path.join(os.homedir(), '.vscode', 'diffwise', 'instructions.md'));

  for (const instructionsPath of candidates) {
    if (fs.existsSync(instructionsPath)) {
      result += '\n' + fs.readFileSync(instructionsPath, 'utf8');
      break;
    }
  }

  return result;
}

function callClaude(diff: string, repoRoot: string, token: vscode.CancellationToken): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--model', utils.getModel(repoRoot), '--no-session-persistence', '--system-prompt', getInstructions(repoRoot),
        'Generate a commit message for this diff. Only the commit message. Nothing else'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(stdout.trim())
    );
    const cancel = token.onCancellationRequested(() => {
      child.kill();
      reject(new vscode.CancellationError());
    });
    child.on('close', () => cancel.dispose());
    child.stdin?.end(diff);
  });
}
