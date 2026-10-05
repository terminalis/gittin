import { button, el, fileDialog } from './dom';
export interface DiskChoices {
  compare?(): void; useDisk(): void; keepMine?(): void; saveAs?(): void; overwrite?(): void;
}
const message = (name: string) =>
  `${name} changed on disk since you opened it. Your unsaved changes are safe in this browser.`;
export function conflictDialog(name: string, choices: DiskChoices) {
  return fileDialog('File changed on disk', (body, close, footer) => {
    body.append(el('p', { textContent: message(name) }));
    const choose = (label: string, run?: () => void) =>
      run && footer.append(button(label, () => { close(); run(); }));
    choose('Compare', choices.compare);
    choose('Use disk version', choices.useDisk);
    choose('Save as…', choices.saveAs);
    choose('Overwrite', choices.overwrite);
  }, { closeLabel: 'Cancel' });
}
export function diskChangeBanner(name: string, choices: DiskChoices, done: () => void) {
  return el('div', { id: 'disk-change', role: 'status' }, el('p', { textContent: message(name) }),
    button('Compare', () => choices.compare?.()),
    button('Keep my changes', () => { choices.keepMine?.(); done(); }),
    button('Use disk version', () => { choices.useDisk(); done(); }));
}
