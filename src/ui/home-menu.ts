import type { DevicePreferences, Preferences } from '../preferences';
import { exportDraftsArchive, importDrafts, readBackup } from '../documents/drafts';
import { exportFile } from '../documents/files';
import {
  button, el, errorText, fileDialog, iconButton, legalPages, legalRel, notice, segmented,
} from './dom';
import { helpDialog, keyboardShortcuts } from './help';
import { icon, type IconName } from './icons';
import { desktop, place } from '../platform';

export function homeMenu(
  trigger: HTMLButtonElement,
  prefs: DevicePreferences,
  actions: { refresh(): void; applyHomeOptions(): void }
) {
  const drawer = el('dialog', { id: 'home-menu', className: 'home-drawer', ariaLabel: 'Main menu' });
  trigger.setAttribute('aria-controls', drawer.id);
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');

  const close = () => {
    drawer.close();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  };
  // The theme switch (shared by every screen) heads the menu; Home's logo and name already sit
  // beside the menu button.
  const theme = segmented('Appearance',
    [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'device-desktop']],
    () => prefs.value.theme ?? 'system', choice => void prefs.save({ theme: choice }));
  const dismiss = iconButton('x', 'Close main menu', close, 'home-drawer-close');
  const header = el('header', { className: 'home-drawer-header' }, theme, dismiss);

  const nav = el('nav', { ariaLabel: 'Gittin' });
  // Each group is labelled, so assistive technology names the part of the menu it enters.
  const group = (label: string) => {
    const id = 'home-menu-' + label.toLowerCase();
    const section = el('div', { role: 'group' },
      el('p', { className: 'home-drawer-label', id, textContent: label }));
    section.setAttribute('aria-labelledby', id);
    nav.append(section);
    return section;
  };
  const add = (to: HTMLElement, label: string, name: IconName, open: () => void, tip = '') => {
    const item = button(label, () => { close(); open(); }, 'home-drawer-item');
    item.prepend(icon(name));
    if (tip) item.title = tip;
    to.append(item);
  };
  // Settings that belong to Home: what it lists. Editor settings stay in the editor.
  const settings = group('Settings');
  const save = (patch: Preferences) => { void prefs.save(patch); actions.applyHomeOptions(); };
  const switches = [
    ['Show favourites', 'homeFavourites'], ['Show recent folders', 'homeFolders'],
  ] as const;
  for (const [label, key] of switches) {
    const checked = prefs.value[key] !== false;
    const input = el('input', { type: 'checkbox', className: 'home-switch', checked, role: 'switch' });
    input.onchange = () => save({ [key]: input.checked });
    settings.append(el('label', { className: 'home-option' }, label, input));
  }
  const limit = () => String(prefs.value.homeRecentLimit ?? 'all') as '10' | '25' | 'all';
  const limits = segmented('Recent files shown', [['10', '10'], ['25', '25'], ['all', 'All']], limit,
    value => save({ homeRecentLimit: value === 'all' ? 'all' : Number(value) as 10 | 25 }));
  settings.append(el('div', { className: 'home-option' },
    el('span', { id: 'home-menu-recent-limit', textContent: 'Recent files shown' }), limits));
  const drafts = group('Drafts');
  add(drafts, 'Export drafts', 'download', () => fileDialog('Export drafts', (body, close, footer) => {
    const text = el('p', { textContent: `Every draft in ${place}, saved as one .zip file.`
      + (desktop ? '' : ' Keep it somewhere safe: browser storage can be cleared.') });
    body.append(text);
    footer.append(button('Export backup', () => {
      const name = `gittin-drafts-${new Date().toISOString().slice(0, 10)}.zip`;
      void exportFile(name, 'zip', exportDraftsArchive)
        .then(done => { if (done) close(); })
        .catch(error => { text.textContent = 'The backup could not be made. ' + errorText(error); });
    }, 'primary'));
  }));
  add(drafts, 'Restore drafts', 'history', () => {
    const input = el('input', { type: 'file', accept: '.zip,.json,application/zip,application/json' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { restored, kept } = await importDrafts(await readBackup(file));
        notice(`Restored ${restored} draft${restored === 1 ? '' : 's'}. `
          + `${kept} already on this device ${kept === 1 ? 'was' : 'were'} kept unchanged.`);
        actions.refresh();
      } catch (error) {
        notice(errorText(error));
      }
    };
    input.click();
  }, 'Restore drafts from a backup file. Drafts already on this device are kept unchanged.');
  const help = group('Help');
  add(help, 'Help', 'help', helpDialog);
  add(help, 'Shortcuts', 'keyboard', () => keyboardShortcuts());
  const footer = el('footer', { className: 'home-drawer-footer' }, ...legalPages.map(([text, href]) =>
    el('a', { href, target: '_blank', rel: legalRel, textContent: text })));
  drawer.append(header, nav, footer);

  trigger.onclick = () => {
    drawer.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    dismiss.focus({ preventScroll: true });
  };
  drawer.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // A click outside the drawer lands on the drawer itself, whose backdrop it is; so does one that
  // starts on a control and ends outside. Clicks from the keyboard land on the control.
  drawer.addEventListener('click', event => {
    const bounds = drawer.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX >= bounds.right
      || event.clientY < bounds.top || event.clientY >= bounds.bottom;
    if (event.target === drawer && outside) close();
  });
  drawer.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll<HTMLElement>('button, input, a[href]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  });
  return drawer;
}
