// Start a repository, for an opened folder that isn't one: the Folder panel's Repository section offers it. A folder
// with files lists them first, all ticked: the ticked ones become the repository's first commit, the others go into its
// .gitignore.
import { reshow } from '../app';
import type { FolderSource } from '../sources/folder';
import { basename } from '../sources/paths';
import type { TreeEntry } from '../sources/types';
import { button, checkbox, el, fileDialog, notice } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';
import type { DesktopDirectoryHandle } from './files';
import { git } from './git';
import { commitFirst } from './save';

/** The Folder panel's Repository section, under the files, made on first use. */
export function repositorySection(panel: HTMLElement) {
  return panel.querySelector<HTMLElement>(':scope > .repository-section') ?? panel.appendChild(
    el('section', { className: 'repository-section' }, el('h2', { textContent: 'Repository' })));
}
/** A Repository section button: its icon, then its label. */
export function repositoryButton(label: string, name: IconName, action: () => void) {
  const b = button(label, action);
  b.prepend(icon(name));
  return b;
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
    const section = repositorySection(panel);
    section.append(el('p', { textContent: "This folder isn't a repository." }),
      repositoryButton('Start a repository', 'git-branch', () => void startRepository(source).then(started => {
        if (!started) return;
        section.remove();
        void reshow();
      }, notice)));
  }, () => {});
}
