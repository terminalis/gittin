// The account button, at the right end of Home's header and the workspace's: GitHub's mark while signed out, which
// opens the sign-in; the account's avatar once signed in, with Switch account and Disconnect
// GitHub in its menu. The avatar is GitHub's public image; no token is involved in loading it.
import { button, el, fileDialog, iconButton, notice } from '../ui/dom';
import { icon } from '../ui/icons';
import { PopupMenu } from '../ui/popup-menu';
import { github, type Account } from './github';
import { accountChanged, onAccountChange, signIn } from './sign-in';

export function accountButton(host: HTMLElement) {
  const slot = el('div', { className: 'account' });
  host.append(slot);
  let menu: PopupMenu | undefined;
  // The mark and the avatar share an id, so a dialog opened from one returns focus to the other.
  const id = 'github-account';
  const show = (account: Account | null) => {
    menu?.dispose();
    slot.replaceChildren();
    if (!account) {
      slot.append(Object.assign(iconButton('brand-github', 'Sign in to GitHub…', () => void signIn()), { id }));
      return;
    }
    const name = `GitHub account: ${account.login}`;
    const popup = new PopupMenu('GitHub account', 'account-menu', { alignEnd: true });
    menu = popup;
    const avatar = el('img', { src: account.avatar, alt: '', width: 28, height: 28 });
    avatar.onerror = () => avatar.replaceWith(icon('brand-github'));
    const trigger = el('button', { type: 'button', id, className: 'account-trigger', ariaLabel: name, title: name },
      avatar);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.onclick = () => (popup.element.hidden ? popup.open(trigger) : popup.close());
    const item = (label: string, run: () => Promise<unknown>) => Object.assign(
      button(label, () => { popup.close(true); void run().catch(notice); }), { role: 'menuitem' });
    // Each dialog opens before the avatar goes, so it has the avatar to return focus to.
    popup.element.append(
      el('p', { className: 'account-name', textContent: `Signed in as ${account.login}` }),
      item('Switch account', async () => {
        await github.signOut();
        const signing = signIn();
        accountChanged(null);
        await signing;
      }),
      item('Disconnect GitHub', async () => { await github.signOut(); disconnected(); accountChanged(null); }));
    slot.append(trigger, popup.element);
  };
  onAccountChange(show, slot);
  void github.account().then(show, () => show(null));
}

/** Gittin can only forget its sign-in: revoking it on GitHub needs the client secret, which Gittin doesn't have. */
function disconnected() {
  fileDialog('Disconnected', body => {
    body.append(el('p', {
      textContent: "GitHub still lists applications as allowed until you revoke them in GitHub's Settings › Applications.",
    }));
  }, { info: true });
}
