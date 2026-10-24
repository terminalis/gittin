import { button, copyText, el, fileDialog, iconButton, legalRel, listRow } from '../ui/dom';

const flatpakref = 'https://terminalis.github.io/packages/flatpak/gittin.flatpakref';
const command = `flatpak install --user ${flatpakref}`;
const manual = 'Select the command and copy it using your device shortcut.';
/** The browser's offer to install the web version, which only Chromium browsers make; prompt() works once. */
type InstallOffer = Event & { prompt(): Promise<unknown> };
let offer: InstallOffer | undefined;

/** Keeps the browser's offer for the Install dialog. It isn't cancelled, so the browser's own install offers stay. */
export function watchInstallOffer() {
  addEventListener('beforeinstallprompt', event => { offer = event as InstallOffer; });
  addEventListener('appinstalled', () => { offer = undefined; });
}

// Rows laid out like Version history's: the platform and what it gets on the left, its action on the right.
const row = (name: string, what: string, action: HTMLElement) => listRow(
  el('span', { className: 'version-label' }, el('strong', { textContent: name }), el('small', { textContent: what })),
  el('span', { className: 'version-actions' }, action));
const newTab = (text: string, href: string) =>
  el('a', { className: 'action', href, target: '_blank', rel: legalRel, textContent: text });

/** Every way to install Gittin: this browser when it offers to, and the desktop apps. */
export function install() {
  fileDialog('Install Gittin', body => {
    const linux = row('Linux', 'Desktop app', newTab('Download Flatpak', flatpakref));
    const copy = iconButton('copy', 'Copy command', () => copyText(command, 'Command copied.', manual));
    // The command wraps inside its box, after a slash of the address rather than inside a name, the copy button in
    // the box's top corner.
    const parts = command.split(/(?<=[^/]\/)(?=[^/])/).flatMap((part, i) => i ? [el('wbr'), part] : [part]);
    linux.append(el('div', { className: 'install-terminal' }, el('small', { textContent: 'Or in a terminal:' }),
      el('div', { className: 'install-command' }, el('code', { tabIndex: 0 }, ...parts), copy)));
    const list = el('ul', { className: 'version-list' },
      row('Windows', 'Desktop app', newTab('Open Microsoft Store', 'https://apps.microsoft.com/detail/9NDJ4HR0FF1H')),
      linux);
    // The installed window is the web version already.
    if (offer && !matchMedia('(display-mode: standalone)').matches) {
      const thisBrowser = row('This browser', 'Gittin in its own window', button('Install', () => {
        void offer?.prompt();
        offer = undefined;
        thisBrowser.remove();
        list.querySelector('a')!.focus();
      }));
      list.prepend(thisBrowser);
    }
    body.append(list);
  }, { className: 'install-dialog', info: true });
}
