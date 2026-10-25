// The install page: the visitor's platform picks the leading card, the browser's own install offer becomes a button,
// and Copy command copies the Flatpak command.
import './site.css';
import { hint, lead } from './platform';

/** What Chromium browsers hand over when Gittin can be installed; prompt() shows their install prompt, once. */
type Offer = Event & { prompt(): Promise<unknown> };

const visitor = {
  userAgent: navigator.userAgent,
  platform: (navigator as Navigator & { userAgentData?: { platform: string } }).userAgentData?.platform,
  touch: navigator.maxTouchPoints > 1,
};
const cards = document.querySelector<HTMLElement>('.install-cards')!;
const web = cards.querySelector<HTMLElement>('[data-card="web"]')!;
const installButton = web.querySelector<HTMLButtonElement>('.web-install')!;
const useInBrowser = web.querySelector<HTMLAnchorElement>('[data-main]')!;

// The leading card comes first and holds the page's one primary button. With no platform to go on, the page's own
// order stands: Windows, Linux, web version.
const leading = lead(visitor);
if (leading) {
  const card = cards.querySelector<HTMLElement>(`[data-card="${leading}"]`)!;
  cards.prepend(card);
  cards.querySelector('.primary')!.classList.remove('primary');
  card.querySelector('[data-main]')!.classList.add('primary');
  if (leading === 'web') web.querySelector<HTMLElement>('.install-lead-note')!.hidden = false;
}
const shown = hint(visitor);
if (shown) web.querySelector<HTMLElement>(`[data-hint="${shown}"]`)!.hidden = false;

/** While the browser offers installation, Install web app takes Use in browser's place; leading with the web version,
 * it is the primary button. */
function offering(on: boolean) {
  installButton.hidden = !on;
  useInBrowser.hidden = on;
  if (leading !== 'web') return;
  installButton.classList.toggle('primary', on);
  useInBrowser.classList.toggle('primary', !on);
}
let offer: Offer | undefined;
// The event isn't cancelled, so the browser's own install offers stay. Inside the installed app there is nothing to offer.
addEventListener('beforeinstallprompt', event => {
  offer = event as Offer;
  if (!matchMedia('(display-mode: standalone)').matches) offering(true);
});
addEventListener('appinstalled', () => {
  offer = undefined;
  offering(false);
});
installButton.addEventListener('click', () => {
  void offer?.prompt();
  offer = undefined;
  offering(false);
  useInBrowser.focus();
});

const manual = 'Select the command and copy it using your device shortcut.';
const status = document.querySelector<HTMLElement>('.install-status')!;
document.querySelector('.install-copy')!.addEventListener('click', () => {
  const command = document.querySelector('.install-command code')!.textContent!;
  if (!navigator.clipboard) {
    status.textContent = manual;
    return;
  }
  navigator.clipboard.writeText(command).then(
    () => { status.textContent = 'Command copied.'; },
    () => { status.textContent = 'Clipboard access was declined. ' + manual; });
});
