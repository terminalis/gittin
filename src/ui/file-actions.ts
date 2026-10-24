import { button, copyText, el, field, fileDialog, iconButton, unreadable } from './dom';
import { icon, type IconName } from './icons';
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
/** Ask for a file or folder name. `submit` resolves with a failure reason to show, or null when done. */
export function nameDialog(title: string, label: string, action: string, value: string,
  submit: (name: string) => Promise<string | null>, note = '') {
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
  });
}
/** What File details shows about the open file. */
export interface FileFacts {
  type: FileType;
  source: string;
  /** Where it is: its full path on disk where Gittin knows it, else its folder and path. */
  location: string;
  /** What Copy path copies; null for a file with no path. */
  path: string | null;
  state: string;
  draft: string;
  /** Whether Diff has the file as it was opened or last saved. */
  baseline: boolean;
}
/** The open file's type, size, location, save state, draft and what Diff compares it with, laid out as File
 * statistics. */
export function detailsDialog(facts: FileFacts) {
  fileDialog('File details', body => {
    const table = el('table', { ariaLabel: 'File details' });
    const row = (label: string, ...value: (Node | string)[]) =>
      table.insertRow().append(el('th', { scope: 'row', textContent: label }), el('td', {}, ...value));
    row('Type', fileDescriptor(facts.type)?.label ?? 'Unknown UTF-8 file (readable source)');
    row('Size', sizeLabel(new TextEncoder().encode(facts.source).length));
    const path = facts.path;
    row('Location', el('span', { textContent: facts.location }), ...(path === null ? [] : [iconButton('copy',
      'Copy path', () => copyText(path, 'Path copied.', 'Select the path and copy it with your device shortcut.'))]));
    row('State', facts.state);
    row('Draft', facts.draft);
    row('Diff compares with', facts.baseline ? 'The file as you opened or last saved it' : 'Nothing yet');
    body.append(table);
  }, { className: 'details-dialog', info: true });
}
/** Rename a file where it is. Links to and from it are not rewritten. */
export function renameDialog(path: string, move: Move) {
  const name = basename(path);
  nameDialog('Rename file', 'File name', 'Rename', name, next => move(path, join(dirname(path), next)),
    `Links to and from ${name} are not updated.`);
}
/** Choose the folder to move a file into. Links to and from it are not rewritten. */
export function moveDialog(source: FileSource, path: string, move: Move) {
  const name = basename(path);
  fileDialog(`Move ${name}`, async (body, close) => {
    const text = el('p', { textContent: 'Looking for folders…' });
    const list = el('div', { className: 'folder-tree' }), failure = failureLine();
    body.append(text, failure.line, list);
    let found;
    try { found = await findFolders(source); }
    catch (error) { text.textContent = unreadable(error); return; }
    const folders = found.filter(directory => directory !== dirname(path));
    text.textContent = folders.length ? `Choose a folder. Links to and from ${name} are not updated.`
      : 'There are no other folders.';
    for (const directory of folders) {
      const choice = row(button('', async () => {
        choice.disabled = true;
        const reason = await move(path, join(directory, name));
        if (reason === null) close();
        else { choice.disabled = false; failure.show(reason); }
      }), ['folder'], directory || source.label);
      list.append(choice);
    }
  });
}
