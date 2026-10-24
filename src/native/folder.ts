// Start a repository, for an opened folder where neither the folder nor any folder directly inside it is
// one: a bar until Not now, and a button in the Folder panel's header for good. A folder with files lists them first,
// all ticked: the ticked ones become the repository's first commit, the others go into its .gitignore.
import { reshow } from '../app';
import type { FolderSource } from '../sources/folder';
import { basename } from '../sources/paths';
import type { TreeEntry } from '../sources/types';
import { button, checkbox, el, fileDialog, iconButton, notice } from '../ui/dom';
import type { DesktopDirectoryHandle } from './files';
import { git } from './git';
import { commitFirst } from './save';

const dismissedKey = 'gittin-start-repository-dismissed';
function dismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(dismissedKey) ?? '[]'); } catch { return []; }
}

/** The names of the entries to commit, all ticked to begin with; null when the writer cancels. */
function chooseEntries(entries: TreeEntry[]) {
  return new Promise<string[] | null>(resolve => {
    let chosen: string[] | null = null;
    fileDialog('Start a repository', (body, close, footer) => {
      body.append(el('p', { textContent: "These go into the repository's first commit. Untick anything to leave out; "
        + 'Gittin lists it in .gitignore.' }));
      const boxes = entries.map(entry => {
        const name = basename(entry.path);
        return [name, checkbox(entry.kind === 'directory' ? `${name}/` : name, true, 'dialog-option')] as const;
      });
      body.append(el('div', { className: 'start-entries' }, ...boxes.map(([, box]) => box.parentElement!)));
      footer.append(button('Start a repository', () => {
        chosen = boxes.filter(([, box]) => box.checked).map(([name]) => name);
        close();
      }, 'primary'));
    }, { closeLabel: 'Cancel', className: 'start-dialog', onClose: () => resolve(chosen) });
  });
}

/** Starts the repository: at once in an empty folder, otherwise with the entries the writer keeps as its first commit;
 * with none kept, empty. Resolves false when the writer cancels. */
async function startRepository(source: FolderSource) {
  const folder = source.root as DesktopDirectoryHandle, entries = await source.list('');
  if (!entries.length) {
    await git.init(folder.path, []);
    return true;
  }
  const kept = await chooseEntries(entries);
  if (!kept) return false;
  if (!kept.length) {
    await git.init(folder.path, []);
    return true;
  }
  await git.init(folder.path, entries.map(entry => basename(entry.path)).filter(name => !kept.includes(name)));
  await commitFirst({ root: folder.path, name: folder.name, path: '' }, await git.untracked(folder.path));
  return true;
}

export function offerRepository(source: FolderSource, panel: HTMLElement) {
  const folder = source.root as DesktopDirectoryHandle, header = panel.querySelector('.folder-header');
  void git.repositories(folder.path).then(repositories => {
    // The panel may have been drawn again meanwhile.
    if (!header?.isConnected || repositories.includes('')) return;
    const start = () => void startRepository(source).then(started => {
      if (!started) return;
      bar.remove();
      offer.remove();
      void reshow();
    }, notice);
    const offer = iconButton('git-branch', 'Start a repository', start);
    header.querySelector('.folder-tools')?.append(offer);
    const bar = el('div', { className: 'repository-offer', role: 'note' },
      el('p', { textContent: "Start a repository to keep this folder's history in git." }),
      button('Start a repository', start, 'primary'),
      button('Not now', () => {
        try { localStorage.setItem(dismissedKey, JSON.stringify([...dismissed(), folder.path])); } catch {}
        bar.remove();
      }));
    if (!repositories.length && !dismissed().includes(folder.path)) header.after(bar);
  }, () => {});
}
