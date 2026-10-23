// Start a repository, for an opened folder where neither the folder nor any folder directly inside it is
// one: a bar until Not now, and a button in the Folder panel's header for good.
import type { FolderSource } from '../sources/folder';
import { button, el, iconButton, notice } from '../ui/dom';
import type { DesktopDirectoryHandle } from './files';
import { git } from './git';

const dismissedKey = 'gittin-start-repository-dismissed';
function dismissed(): string[] {
  try { return JSON.parse(localStorage.getItem(dismissedKey) ?? '[]'); } catch { return []; }
}

export function offerRepository(source: FolderSource, panel: HTMLElement) {
  const folder = source.root as DesktopDirectoryHandle, header = panel.querySelector('.folder-header');
  void git.repositories(folder.path).then(repositories => {
    // The panel may have been drawn again meanwhile.
    if (!header?.isConnected || repositories.includes('')) return;
    const start = () => void git.init(folder.path).then(() => { bar.remove(); offer.remove(); }, notice);
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
