import * as vscode from 'vscode';

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
