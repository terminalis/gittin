// Clone repository: from an HTTPS address, or one of the signed-in account's repositories, into a new folder named
// after it inside a folder the writer picks. The clone then opens as a folder, on the repository's default branch.
import { open } from '@tauri-apps/plugin-dialog';
import { openFolderHandle } from '../app';
import { button, el, field, fileDialog, notice, textField } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Action } from '../ui/menus';
import { DesktopDirectoryHandle } from './files';
import { github, type Cloned, type Listed, type Step } from './github';
import { failureText, signIn, signedIn } from './sign-in';

const percent = ({ done, total }: Step) => `${Math.floor((100 * done) / Math.max(total, 1))}%`;
const stepText = (step: Step) =>
  step.phase === 'receiving' ? `Downloading… ${percent(step)}` : `Writing files… ${percent(step)}`;
const named = (paths: string[]) =>
  paths.length <= 5 ? paths.join(', ') : `${paths.slice(0, 5).join(', ')} and ${paths.length - 5} more`;

/** Home's Clone repository, beside Open file and Open folder. */
export function cloneButton(actions: HTMLElement) {
  const clone = button('Clone repository', openClone);
  clone.prepend(icon('download'));
  actions.append(clone);
}
export const cloneCommand: Action = { id: 'clone', menu: 'File/Open', label: 'Clone repository…', run: openClone };

export function openClone() {
  let cloning = false;
  fileDialog('Clone repository', (body, close, footer) => {
    const address = textField(body, 'Repository address',
      { type: 'text', placeholder: 'https://github.com/owner/repository', required: true, autocomplete: 'off' });
    const yours = el('div', { className: 'clone-repositories' });
    const place = el('p', { textContent: 'Choose the folder to clone into.' });
    const status = el('p', { role: 'status' });
    let folder: string | null = null;
    const pick = async () => {
      const path = await open({ directory: true, recursive: true });
      if (typeof path !== 'string') return;
      folder = path;
      place.textContent = `Clones into a new folder in ${path}.`;
    };
    const choose = button('Choose folder…', () => void pick());
    body.append(yours, el('div', { className: 'clone-folder' }, place, choose), status);
    const start = button('Clone', () => void run(), 'primary');
    footer.append(start);
    const run = async () => {
      address.value = address.value.trim();
      if (!address.reportValidity()) return;
      if (!folder) { status.textContent = 'Choose the folder to clone into.'; return; }
      start.disabled = cloning = true;
      status.textContent = 'Starting…';
      let cloned: Cloned | null = null;
      try {
        cloned = await signedIn(() => github.clone(address.value, folder!, step => { status.textContent = stepText(step); }));
        if (!cloned) status.textContent = '';
      } catch (error) {
        if (cloning) status.textContent = failureText(error);
      }
      // Cancel closed the dialog meanwhile.
      const cancelled = !cloning;
      start.disabled = cloning = false;
      if (cancelled || !cloned) return;
      close();
      await openFolderHandle(new DesktopDirectoryHandle(cloned.folder));
      if (cloned.filtered.length)
        notice(`These files arrived in their stored form, because git converts them with a filter Gittin can't run, `
          + `such as Git LFS: ${named(cloned.filtered)}.`);
    };
    address.onkeydown = event => { if (event.key === 'Enter' && !cloning) { event.preventDefault(); void run(); } };
    void showRepositories(yours, url => { address.value = url; choose.focus(); });
  }, {
    closeLabel: 'Cancel', className: 'clone-dialog',
    onClose: () => { if (cloning) { cloning = false; void github.cancelClone(); } },
  });
}

/** The account's repositories, every page of them, with a filter; signed out, the way to sign in. */
async function showRepositories(host: HTMLElement, picked: (url: string) => void): Promise<void> {
  const account = await github.account().catch(() => null);
  if (!host.isConnected) return;
  if (!account) {
    host.replaceChildren(el('p', { textContent: 'Sign in to GitHub to pick one of your repositories.' }),
      button('Sign in to GitHub…', () => void signIn().then(signed => signed && showRepositories(host, picked))));
    return;
  }
  host.replaceChildren(el('p', { textContent: 'Loading your repositories…' }));
  let all: Listed[] | null;
  try {
    all = await signedIn(async () => {
      const found: Listed[] = [];
      for (let page = 1; ; page++) {
        const listed = await github.repositories(page);
        found.push(...listed);
        if (listed.length < 100) return found;
      }
    });
  } catch (error) {
    host.replaceChildren(el('p', { textContent: failureText(error) }));
    return;
  }
  if (!all) return void showRepositories(host, picked);
  const repositories = all;
  const filter = el('input', { type: 'search', placeholder: 'Filter', autocomplete: 'off' });
  const list = el('ul', { className: 'clone-list' });
  const draw = () => {
    const words = filter.value.trim().toLowerCase();
    list.replaceChildren(...repositories.filter(item => item.fullName.toLowerCase().includes(words)).map(item =>
      el('li', {}, button(item.private ? `${item.fullName} (private)` : item.fullName, () => picked(item.cloneUrl)))));
  };
  filter.oninput = draw;
  draw();
  host.replaceChildren(field('Your repositories', filter), list);
}
