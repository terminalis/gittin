// The conflict dialog: files GitHub and the repository both changed on the same lines, each settled by keeping one
// side, in the shape of the changed-on-disk dialog. The side not kept stays a commit in Version history.
import { button, el, fileDialog, listRow, segmented } from '../ui/dom';
import type { Choice } from './github';

/** Resolves with the side picked for each path, or null when the writer cancels. `diff` shows a file against
 * GitHub's version, closing the dialog first, as the changed-on-disk dialog's Compare does. */
export function conflictDialog(repository: string, paths: string[], diff: (path: string) => void) {
  return new Promise<Record<string, Choice> | null>(resolve => {
    const picked: Record<string, Choice> = {};
    let result: Record<string, Choice> | null = null;
    fileDialog('Keep which version?', (body, close, footer) => {
      const go = button('Sync', () => { result = { ...picked }; close(); }, 'primary');
      go.disabled = true;
      const sides: [Choice, string][] = [['mine', 'Keep mine'], ['theirs', "Keep GitHub's"]];
      body.append(
        el('p', { textContent: `GitHub and ${repository} both changed the same lines of `
          + `${paths.length === 1 ? 'this file' : 'these files'}. Keep one version of each; the other stays in Version history.` }),
        el('ul', { className: 'version-list' }, ...paths.map(path => listRow(
          el('span', { className: 'version-label' }, el('strong', { textContent: path })),
          el('span', { className: 'version-actions' },
            segmented(`Version of ${path} to keep`, sides, () => picked[path], choice => {
              picked[path] = choice;
              go.disabled = paths.some(other => !picked[other]);
            }),
            button('Diff', () => { close(); diff(path); }))))));
      footer.append(go);
    }, { closeLabel: 'Cancel', className: 'conflict-dialog', onClose: () => resolve(result) });
  });
}
