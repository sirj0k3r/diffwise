import * as vscode from 'vscode';

/**
 * The model aliases we accept. Aliases rather than dated model ids on purpose:
 * an alias keeps working across Claude CLI upgrades, a dated id does not.
 */
export const models = [
    { id: 'haiku', detail: 'Fast, cheap. Good for most diffs.' },
    { id: 'sonnet', detail: 'Slower, better on large or subtle diffs.' }
] as const;

export const defaultModel = models[0].id;

/**
 * Resolves `diffwise.model` for a repository. The setting is `scope: resource`,
 * so the repo root decides which workspace folder's value applies. Anything we
 * don't recognise (a hand-edited settings.json, an enum value dropped by an
 * upgrade) falls back to the default instead of reaching the CLI.
 */
export function getModel(repoRoot: string): string {
    const configured = vscode.workspace
        .getConfiguration('diffwise', vscode.Uri.file(repoRoot))
        .get<string>('model');

    return models.some(m => m.id === configured) ? configured! : defaultModel;
}

/**
 * Runs `task` behind the source control viewlet's progress bar (the same
 * indicator git uses while it refreshes) plus a cancellable notification.
 * ProgressLocation.SourceControl supports no cancellation of its own, so the
 * notification carries the cancel button and the token.
 */
export function withGenerationProgress<T>(
    title: string,
    task: (token: vscode.CancellationToken) => Promise<T>
): Thenable<T> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl },
        () => vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title, cancellable: true },
            (_progress, token) => task(token)
        )
    );
}
