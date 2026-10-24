// Sync's question before GitHub's changes reach the folder: the files they touch, and for each file both sides changed
// on the same lines, which version to keep, in the shape of the changed-on-disk dialog. The side not kept stays a
// commit in Version history.
import { button, el, fileDialog, listRow, segmented } from '../ui/dom';
import type { Choice } from './github';

/** Resolves with the side picked for each conflicting path, or null when the writer cancels. `diff` shows a file against
 * GitHub's version, closing the dialog first, as the changed-on-disk dialog's Compare does. */
export function incomingDialog(repository: string, incoming: string[], conflicts: string[], diff: (path: string) => void) {
  return new Promise<Record<string, Choice> | null>(resolve => {
    const picked: Record<string, Choice> = {};
    let result: Record<string, Choice> | null = null;
    const files = [...conflicts, ...incoming.filter(path => !conflicts.includes(path))];
    fileDialog('Sync with GitHub', (body, close, footer) => {
      const go = button('Sync', () => { result = { ...picked }; close(); }, 'primary');
      go.disabled = conflicts.length > 0;
      const sides: [Choice, string][] = [['mine', 'Keep mine'], ['theirs', "Keep GitHub's"]];
      body.append(el('p', { textContent: `GitHub has changes to ${files.length} ${files.length === 1 ? 'file' : 'files'}. `
        + `Sync brings them into ${repository}.` }));
      if (conflicts.length) body.append(el('p', { textContent: `GitHub and ${repository} both changed the same lines of `
        + `${conflicts.length} of them. Keep one version of each; the other stays in Version history.` }));
      body.append(el('ul', { className: 'version-list' }, ...files.map(path => listRow(
        el('span', { className: 'version-label' }, el('strong', { textContent: path })),
        ...(conflicts.includes(path) ? [el('span', { className: 'version-actions' },
          segmented(`Version of ${path} to keep`, sides, () => picked[path], choice => {
            picked[path] = choice;
            go.disabled = conflicts.some(other => !picked[other]);
          }),
          button('Diff', () => { close(); diff(path); }))] : [])))));
      footer.append(go);
    }, { closeLabel: 'Cancel', className: 'conflict-dialog', onClose: () => resolve(result) });
  });
}
