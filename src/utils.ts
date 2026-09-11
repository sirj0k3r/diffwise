import { execFile } from 'child_process';
import * as vscode from 'vscode';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
export async function checkAuth(): Promise<AuthState> {
    const state = await probeAuth(claudePath());
    if (state !== 'missing') return state;

    // Same recovery the generation call gets: the binary may be installed but
    // out of reach of the PATH the extension host was launched with.
    const recovered = recoverFromEnoent();
    return recovered ? probeAuth(recovered) : 'missing';
}

function probeAuth(bin: string): Promise<AuthState> {
    return new Promise(resolve => {
        execFile(bin, ['auth', 'status', '--json'], { encoding: 'utf8' }, (err, stdout) => {
            if (err) return resolve(isNotFound(err) ? 'missing' : 'logged-out');
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
    term.sendText(`${shellQuote(claudePath())} auth login`);

    const sub = vscode.window.onDidCloseTerminal(async closed => {
        if (closed !== term) return;
        sub.dispose();
        if (await checkAuth() === 'ok') onSignedIn();
    });
}

/**
 * True for the one failure worth retrying: the process never started, so no
 * request was made and nothing was charged. Every other failure came from the
 * CLI itself and a second attempt would only repeat it.
 */
export function isNotFound(err: unknown): boolean {
    return (err as any)?.code === 'ENOENT';
}

/** The configured override, or undefined when the setting is blank. */
function configuredPath(): string | undefined {
    // Machine scope (see package.json): a workspace must not be able to decide
    // which executable we run.
    return vscode.workspace.getConfiguration('diffwise').get<string>('claudePath')?.trim() || undefined;
}

/**
 * Where the CLI usually ends up. Only consulted after a spawn failed, and only
 * because a VS Code started from the dock or Start menu never sees the PATH the
 * user's shell would have given it.
 */
function installLocations(): string[] {
    const home = os.homedir();
    return [
        path.join(home, '.claude', 'local', 'claude'),
        path.join(home, '.local', 'bin', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        path.join(home, '.bun', 'bin', 'claude'),
        path.join(home, '.volta', 'bin', 'claude')
    ];
}

let discovered: string | undefined;

/** Forgets a discovered path, so a changed setting takes effect immediately. */
export function resetClaudePath(): void {
    discovered = undefined;
}

/**
 * What to spawn. The setting wins whenever it is set - someone who filled it in
 * meant it, including to pick between two installs - then anything an earlier
 * recovery found, then plain PATH lookup.
 */
export function claudePath(): string {
    return configuredPath() ?? discovered ?? 'claude';
}

/**
 * Called after a spawn failed with ENOENT. Returns the first install location
 * that holds an executable, remembered for the rest of the session; undefined
 * means the user has to point at it themselves.
 */
export function recoverFromEnoent(): string | undefined {
    if (discovered) return discovered;
    // A configured path that does not resolve is a typo, not something to guess
    // past: silently running some other binary would hide the mistake.
    if (configuredPath()) return undefined;

    return discovered = installLocations().find(candidate => {
        // X_OK rather than existsSync: a path we cannot execute is no better
        // than a missing one, and skipping it keeps the search going.
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        }
        catch {
            return false;
        }
    });
}

/**
 * Quotes a path for the terminal's shell. Only needed for the sign-in flow,
 * which has to go through a shell to be interactive - every other call spawns
 * the binary directly and needs no quoting at all.
 */
function shellQuote(bin: string): string {
    if (/^[\w./-]+$/.test(bin)) return bin;

    // PowerShell treats a quoted string as a value, so a quoted path needs the
    // call operator to be run rather than echoed.
    return process.platform === 'win32'
        ? `& "${bin}"`
        : `'${bin.replace(/'/g, `'\\''`)}'`;
}
