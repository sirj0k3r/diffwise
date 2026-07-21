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
  const cmd = vscode.commands.registerCommand('ai-commit.generate', async () => {
    const git = vscode.extensions.getExtension('vscode.git')?.exports.getAPI(1);
    const repo = git?.repositories[0];
    if (!repo) return;

    let diff = await repo.diff(true) || await repo.diff(false); // staged diff
    if (!diff) {
      const resources = repo.state.indexChanges.map((c: any) => c.uri.fsPath).join('\n');
      if (!resources) return vscode.window.showWarningMessage('No changes detected.');
      diff = `New files:\n${resources}`;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Generating commit message...',
      cancellable: false
    }, async () => {
      const timer = utils.Loader.startLoader(repo);
      let msg = '';
      try {
        msg = await callClaude(diff, repo.rootUri.fsPath);
      }
      catch (e) {
        vscode.window.showErrorMessage(`Failed to generate commit message: ${e}`);
      }
      finally {
        utils.Loader.stopLoader(timer);
        repo.inputBox.value = msg;
      }
    });
  });

  context.subscriptions.push(cmd);
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

function callClaude(diff: string, repoRoot: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--model', 'claude-haiku-4-5', '--system-prompt', getInstructions(repoRoot),
        'Generate a commit message for this diff. Only the commit message. Nothing else'],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => err ? reject(err) : resolve(stdout.trim())
    );
    child.stdin?.end(diff);
  });
}