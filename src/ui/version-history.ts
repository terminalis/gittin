import { icon } from './icons';
import { ask, button, el, fileDialog, iconButton, listRow, notice } from './dom';
import { clearVersions, listVersions, versionSource } from '../documents/versions';
import { sizeLabel, whenLabel } from '../documents/labels';
export function versionHistoryButton(enabled: boolean, open: () => void) {
  const b = iconButton('history', 'Version history', open);
  b.id = 'version-history';
  b.disabled = !enabled;
  if (!enabled) b.title = 'Save this file to start its version history.';
  return b;
}
type Use = { compare(source: string, label: string): void; restore(source: string): void };
export function openVersionHistory(key: string, use: Use) {
  fileDialog('Version history', (body, close, footer) => {
    const note = el('p', { textContent: 'Versions of saves made in Gittin on this browser. '
      + 'Clearing browser data removes them.' });
    const list = el('ul', { className: 'version-list' });
    body.append(note, list);
    // Clear sits at the left of the footer, apart from Close, and asks first: it cannot be undone.
    const confirm = () => ask('Clear version history?',
      "The file itself is not changed. This can't be undone.", [['Clear', 'clear']]);
    const clear = button('Clear history for this file', () => void confirm()
      .then(choice => choice === 'clear' ? clearVersions(key).then(close) : undefined)
      .catch(notice), 'danger');
    clear.disabled = true;
    clear.prepend(icon('trash'));
    footer.prepend(clear);
    void listVersions(key).then(versions => {
      clear.disabled = !versions.length;
      if (!versions.length) list.textContent = 'No versions yet.';
      if (versions.some(v => v.trimmed)) note.append(' Older versions were removed to save space.');
      for (const v of versions) {
        const label = `${v.kind === 'opened' ? 'Opened' : 'Saved'} ${whenLabel(v.savedAt)}`;
        const load = (then: (source: string) => void) => () =>
          void versionSource(v.id).then(source => { close(); then(source); }, notice);
        const compare = button('Compare', load(source => use.compare(source, label)));
        list.append(listRow(
          el('span', { className: 'version-label' }, el('strong', { textContent: label }),
            el('small', { textContent: sizeLabel(v.size) })),
          el('span', { className: 'version-actions' }, compare, button('Restore', load(use.restore)))));
      }
    }, notice);
  });
}
