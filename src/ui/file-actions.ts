import { button, el, field, fileDialog, unreadable } from './dom';
import { icon, type IconName } from './icons';
import { fileStatistics } from './tools-dialogs';
import { fileDescriptor, type FileType } from '../documents/file-types';
import { sizeLabel } from '../documents/labels';
import { basename, dirname, join } from '../sources/paths';
import { findFolders } from '../sources/search';
import type { FileSource } from '../sources/types';
/** A tree row: icons, then the name, then optional faint detail. */
export function row<T extends HTMLElement>(element: T, icons: IconName[], name: string, detail = ''): T {
  element.classList.add('folder-row');
  element.append(...icons.map(icon), el('span', { textContent: name }));
  if (detail) element.append(el('span', { className: 'folder-row-detail', textContent: detail }));
  return element;
}
/** A hidden alert line that says why a file operation failed. */
function failureLine() {
  const line = el('p', { hidden: true, role: 'alert' });
  return { line, show(text: string) { line.textContent = text; line.hidden = false; } };
}
/** Moves or renames a file; resolves with a failure reason to show, or null when done. */
type Move = (from: string, to: string) => Promise<string | null>;
/** Ask for a file or folder name. `submit` resolves with a failure reason to show, or null when done; `onClose` runs
 * once the dialog has closed and returned focus. */
export function nameDialog(title: string, label: string, action: string, value: string,
  submit: (name: string) => Promise<string | null>, note = '', onClose?: () => void) {
  fileDialog(title, (body, close, footer) => {
    const input = el('input', { required: true, value }), failure = failureLine();
    body.append(field(label, input));
    if (note) body.append(el('p', { textContent: note }));
    body.append(failure.line);
    const confirm = button(action, () => void go(), 'primary');
    const go = async () => {
      const name = input.value.trim();
      if (!name || /[\\/]/.test(name)) {
        input.setCustomValidity('Enter a name without slashes.'); input.reportValidity(); return;
      }
      confirm.disabled = true;
      const reason = await submit(name);
      confirm.disabled = false;
      if (reason === null) close();
      else failure.show(reason);
    };
    input.oninput = () => input.setCustomValidity('');
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); void go(); } };
    footer.append(confirm);
  }, { onClose });
}
/** What File details shows about the open file. */
export interface FileFacts {
  type: FileType;
  source: string;
  /** Where it is: its full path on disk where Gittin knows it, else its folder and path. */
  location: string;
  state: string;
}
/** The open file's type, location and save state, then its counts and size. */
export function detailsDialog(facts: FileFacts) {
  fileDialog('File details', body => {
    const table = el('table', { ariaLabel: 'File details' });
    table.setAttribute('aria-describedby', 'details-help');
    const row = (label: string, value: Node | string, description?: string) =>
      table.insertRow().append(el('th', { scope: 'row', textContent: label, ...description && { title: description } }),
        el('td', {}, value));
    const stats = fileStatistics(facts.source), count = (n: number) => n.toLocaleString('en-GB');
    row('Type', fileDescriptor(facts.type)?.label ?? 'Unknown UTF-8 file (readable source)');
    // Each folder in the path is one unbreakable piece, so the path wraps only after a separator.
    row('Location', el('span', { className: 'details-path' },
      ...facts.location.split(/(?<=[\\/])/).map(part => el('span', { textContent: part }))));
    row('State', facts.state);
    row('Words', count(stats.words), 'Whitespace-separated words in the current source.');
    row('Characters', count(stats.characters), 'Unicode characters, including line endings and any BOM.');
    row('Lines', count(stats.lines), 'Source lines, including a trailing empty line.');
    row('Size', sizeLabel(stats.bytes), 'UTF-8 encoded size, including any BOM.');
    body.append(table, el('p', { id: 'details-help', className: 'details-help',
      textContent: 'Counts use the full source text. File size is measured in UTF-8 bytes.' }));
  }, { className: 'details-dialog', info: true });
}
/** Rename a file where it is. Links to and from it are not rewritten. */
export function renameDialog(path: string, move: Move, onClose?: () => void) {
  const name = basename(path);
  nameDialog('Rename file', 'File name', 'Rename', name, next => move(path, join(dirname(path), next)),
    `Links to and from ${name} are not updated.`, onClose);
}
/** Choose the folder to move a file into, from the folder's folders drawn as a tree with the file's own folder marked.
 * New folder… makes one beside the file, to pick next. Links to and from it are not rewritten. */
export function moveDialog(source: FileSource, path: string, move: Move,
  createFolder: (path: string) => Promise<string | null>) {
  const name = basename(path), here = dirname(path);
  fileDialog(`Move ${name}`, (body, close, footer) => {
    const text = el('p', { textContent: 'Looking for folders…' });
    const tree = el('ul', { className: 'folder-tree' }), failure = failureLine();
    body.append(text, failure.line, tree);
    const draw = async (focus?: string) => {
      let folders;
      try { folders = await findFolders(source); }
      catch (error) { text.textContent = unreadable(error); return; }
      text.textContent = `Choose a folder. Links to and from ${name} are not updated.`;
      const lists = new Map<string, HTMLElement>();
      tree.replaceChildren();
      // Sorted, a folder comes before the folders in it.
      for (const directory of folders.sort()) {
        const current = directory === here;
        const choice = row(button('', async () => {
          choice.disabled = true;
          const reason = await move(path, join(directory, name));
          if (reason === null) close();
          else { choice.disabled = false; failure.show(reason); }
        }), ['folder'], directory ? basename(directory) : source.label, current ? 'Current folder' : '');
        choice.disabled = current;
        choice.setAttribute('aria-current', String(current));
        const children = el('ul');
        lists.set(directory, children);
        (directory ? lists.get(dirname(directory))! : tree).append(el('li', {}, choice, children));
        if (directory === focus) choice.focus();
      }
    };
    footer.append(button('New folder…', () => nameDialog('New folder', 'Folder name', 'Create', '', async folder => {
      const made = join(here, folder), reason = await createFolder(made);
      if (reason === null) void draw(made);
      return reason;
    }), 'apart'));
    void draw();
  });
}
