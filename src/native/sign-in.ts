// Signing in to GitHub through the device flow, once per computer: the dialog showing GitHub's code, the account it
// ends with, and running a GitHub action again once the writer has signed in.
import { button, el, errorText, fileDialog } from '../ui/dom';
import { github, isFailure, type Account } from './github';

const watchers = new Set<(account: Account | null) => void>();
/** Calls `show` whenever the account changes, while `host` is on the page. */
export function onAccountChange(show: (account: Account | null) => void, host: Element) {
  const watcher = (account: Account | null) => (host.isConnected ? show(account) : watchers.delete(watcher));
  watchers.add(watcher);
}
export function accountChanged(account: Account | null) {
  for (const watcher of [...watchers]) watcher(account);
}

/** What went wrong with a GitHub action, in words. */
export function failureText(error: unknown) {
  if (!isFailure(error)) return errorText(error);
  switch (error.kind) {
    case 'offline': return "Gittin can't reach GitHub. Check the connection and try again.";
    case 'signIn': return 'GitHub asks for a sign-in to do this.';
    case 'refused': return 'GitHub no longer accepts this sign-in.';
    case 'message': return error.message;
  }
}

interface SignInOptions {
  /** Asks for the `workflow` scope beside `repo`: Allow workflow changes…. */
  workflow?: boolean;
  /** Why the sign-in is needed, shown above the code. */
  reason?: string;
}
/** Signs in to GitHub; resolves with the account, or null when the writer stops. */
export function signIn({ workflow = false, reason = '' }: SignInOptions = {}) {
  return new Promise<Account | null>(resolve => {
    let account: Account | null = null, closed = false;
    fileDialog(workflow ? 'Allow workflow changes' : 'Sign in to GitHub', (body, close, footer) => {
      const why = el('p', { textContent: reason, hidden: !reason });
      const code = el('output', { className: 'sign-in-code' });
      const status = el('p', { role: 'status' });
      const open = button('Copy & Open GitHub', () => {}, 'primary');
      const again = button('Get a new code', () => void ask());
      body.append(why, code, status);
      footer.append(open, again);
      const stop = (text: string, retry: boolean) => {
        code.textContent = '';
        status.textContent = text;
        open.hidden = true;
        again.hidden = !retry;
      };
      const ask = async () => {
        stop('Asking GitHub for a code…', false);
        try {
          const device = await github.deviceCode(workflow);
          if (closed) return void github.cancelSignIn();
          code.textContent = device.userCode;
          status.textContent = 'Choose Copy & Open GitHub, paste the code there and authorise Gittin. '
            + `The code lasts ${Math.round(device.expiresIn / 60)} minutes.`;
          // The copy finishes before GitHub opens, which takes the focus a copy needs. Without the clipboard, the
          // code stays shown to type.
          open.onclick = () => void (navigator.clipboard?.writeText(device.userCode) ?? Promise.resolve())
            .catch(() => {})
            .then(() => window.open(device.verificationUri, '_blank', 'noopener,noreferrer'));
          open.hidden = false;
          const end = await github.deviceWait();
          if (closed) { if (end.kind === 'signedIn') accountChanged(end.account); return; }
          if (end.kind === 'signedIn') {
            account = end.account;
            accountChanged(account);
            if (end.remembered) return close();
            stop(`Signed in as ${account.login}. This computer can't keep the sign-in, so Gittin will ask for it `
              + 'again the next time it starts.', false);
            footer.lastElementChild!.textContent = 'Close';
          } else if (end.kind === 'expired') stop('This code expired before it was used.', true);
          else if (end.kind === 'declined') stop('The sign-in was declined on GitHub.', true);
        } catch (error) {
          stop(failureText(error), true);
        }
      };
      void ask();
    }, {
      closeLabel: 'Cancel', className: 'sign-in-dialog',
      onClose: () => { closed = true; if (!account) void github.cancelSignIn(); resolve(account); },
    });
  });
}

/** Runs a GitHub action. When GitHub asks for a sign-in, or refuses the one Gittin had (which Gittin then forgets),
 * signs in and runs it again. Resolves null when the writer doesn't sign in. */
export async function signedIn<T>(run: () => Promise<T>): Promise<T | null> {
  for (;;) {
    try {
      return await run();
    } catch (error) {
      if (!isFailure(error) || (error.kind !== 'signIn' && error.kind !== 'refused')) throw error;
      if (error.kind === 'refused') accountChanged(null);
      const reason = error.kind === 'refused'
        ? 'GitHub no longer accepts the sign-in Gittin had, so Gittin has forgotten it. Sign in again to carry on.'
        : 'GitHub asks for a sign-in to carry on.';
      if (!(await signIn({ reason }))) return null;
    }
  }
}
