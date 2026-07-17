import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
  vscode.window.showInformationMessage('ai-commit activated!')
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
      location: vscode.ProgressLocation.SourceControl,
      title: 'Generating commit message...'
    }, async () => {
      const msg = await callClaude(diff);
      repo.inputBox.value = msg;
    });
  });

  context.subscriptions.push(cmd);
}


async function callClaude(diff: string): Promise<string> {
  const trimmed = diff.slice(0, 4000);
  const { stdout } = await execAsync(
    `echo ${JSON.stringify(trimmed)} | claude -p --model claude-haiku-4-5 "Conventional commit message for this diff. One line only, no explanation and keep it simple. Commit message only"`,
    { encoding: 'utf8' }
  );
  return stdout.trim();
}