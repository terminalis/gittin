// A repository file's Version history: its commits, newest first, with Version history's Compare and Restore.
import type { OpenDocument } from '../screens/workspace';
import { whenLabel } from '../documents/labels';
import { decodeSource } from '../editor/source-projection';
import { button, el, fileDialog, listRow, notice } from '../ui/dom';
import type { Use } from '../ui/version-history';
import { git } from './git';
import { placeOfDocument } from './repositories';

const page = 50;

export async function openHistory(doc: OpenDocument, use: Use): Promise<boolean> {
  const place = await placeOfDocument(doc);
  if (!place) return false;
  fileDialog('Version history', (body, close) => {
    const list = el('ul', { className: 'version-list' });
    const older = button('Show older commits', () => void more().catch(notice));
    body.append(el('p', { textContent: `Commits that changed ${place.path} in ${place.name}.` }), list);
    let shown = 0;
    const more = async () => {
      older.remove();
      const entries = await git.log(place.root, place.path, shown, page);
      shown += entries.length;
      for (const entry of entries) {
        const when = whenLabel(entry.time * 1000);
        const load = (then: (source: string) => void) => () =>
          void git.show(place.root, entry.id, place.path).then(bytes => { close(); then(decodeSource(bytes)); }, notice);
        list.append(listRow(
          el('span', { className: 'version-label' }, el('strong', { textContent: entry.message }),
            el('small', { textContent: `${entry.author}, ${when}` })),
          el('span', { className: 'version-actions' },
            button('Compare', load(source => use.compare(source, `${entry.message} (${when})`))),
            button('Restore', load(use.restore)))));
      }
      if (!shown) list.textContent = 'No commits yet.';
      if (entries.length === page) list.after(older);
    };
    void more().catch(notice);
  }, { info: true });
  return true;
}
