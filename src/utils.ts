import { execFile } from 'child_process';
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

/** What a `claude auth status` probe can tell us about the CLI. */
export type AuthState = 'ok' | 'logged-out' | 'missing';

/**
 * Probes the CLI's sign-in state. This spawns a second `claude` process, so it
 * is meant to run after a failure rather than before every generation.
 * 'missing' and 'logged-out' are kept apart on purpose: a CLI that is not on
 * PATH also fails the status call, and offering it a sign-in button would send
 * the user to a terminal that cannot run the login command either.
 */
export function checkAuth(): Promise<AuthState> {
    return new Promise(resolve => {
        execFile('claude', ['auth', 'status', '--json'], { encoding: 'utf8' }, (err, stdout) => {
            if (err) return resolve((err as any).code === 'ENOENT' ? 'missing' : 'logged-out');
            try {
                return resolve(JSON.parse(stdout).loggedIn ? 'ok' : 'logged-out');
            }
            catch {
                // Unparseable output from a zero exit: assume the CLI is fine and
                // let the real call report whatever is actually wrong with it.
                return resolve('ok');
            }
        });
    });
}

const loginTerminalName = 'Claude login';

/**
 * Opens a terminal running `claude auth login`. The flow is interactive (it
 * opens a browser and waits for a paste-back), so the terminal is the only
 * place it can run - but we watch for it closing and call `onSignedIn` once the
 * probe agrees, so the user does not have to find the button again afterwards.
 */
export function startSignIn(onSignedIn: () => void): void {
    // A leftover terminal from an abandoned attempt still has a prompt waiting
    // for input, so replace it instead of typing a second command into it.
    vscode.window.terminals.find(t => t.name === loginTerminalName)?.dispose();

    const term = vscode.window.createTerminal(loginTerminalName);
    term.show();
    term.sendText('claude auth login');

    const sub = vscode.window.onDidCloseTerminal(async closed => {
        if (closed !== term) return;
        sub.dispose();
        if (await checkAuth() === 'ok') onSignedIn();
    });
}
