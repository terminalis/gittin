import { button, el, fileDialog, iconButton, markUnsaved, unreadable } from './dom';
import { basename, dirname, imageType, join } from '../sources/paths';
import { findFiles } from '../sources/search';
import type { FileSource, TreeEntry } from '../sources/types';
import { moveDialog, nameDialog, renameDialog, row } from './file-actions';
import { icon, type IconName } from './icons';
import { PopupMenu } from './popup-menu';
import { place } from '../platform';
export interface FolderPanelOptions {
  source: FileSource | null;
  label: string | null;
  current: string | null;
  /** Shown instead of the tree when there is no usable source. */
  unavailable: string | null;
  open(path: string): Promise<string | null>;
  openFolder(): void;
  /** File management, given only for a folder Gittin can write to. */
  newFile?(path: string): void;
  /** Resolves with a failure reason to show, or null once the folder exists. */
  createFolder?(path: string): Promise<string | null>;
  /** Rename or move a file; resolves with a failure reason, or null. Rows get a ⋯ menu only when
   * `move`, `remove` and `createFolder` are given. */
  move?(from: string, to: string): Promise<string | null>;
  /** Delete a file or folder; the caller asks first. */
  remove?(path: string, kind: TreeEntry['kind']): void;
  grant?(): void;
  /** True when an open document at this path has unsaved changes. */
  unsaved?(path: string): boolean;
  signal: AbortSignal;
}
export function renderFolderPanel(panel: HTMLElement, o: FolderPanelOptions) {
  // "Current Folder" heads the panel as "Open Files" heads the Files panel; the folder's name and its buttons follow.
  const header = el('div', { className: 'folder-header' }, el('h2', { textContent: 'Current Folder' }));
  if (o.label) header.append(el('p', { className: 'folder-name', textContent: o.label, title: o.label }));
  panel.replaceChildren(header);
  const source = o.source;
  if (!source) {
    panel.append(el('p', { textContent: o.unavailable ?? `This file is only in ${place}.` }),
      o.grant ? button(`Allow access to ${o.label}`, o.grant) : button('Open folder…', o.openFolder));
    return;
  }
  const expanded = new Set(o.current ? ancestors(o.current) : []);
  const search = el('input',
    { type: 'search', placeholder: 'Find a file…', ariaLabel: 'Find a file in this folder' });
  const tools = el('div', { className: 'folder-tools' });
  // New files and folders go beside the current file.
  const here = () => (o.current ? dirname(o.current) : '');
  const { newFile, createFolder } = o;
  if (newFile)
    tools.append(iconButton('file-plus', 'New file here', () =>
      nameDialog('New file', 'File name', 'Create', '', async name => {
        newFile(join(here(), name));
        return null;
      })));
  if (createFolder)
    tools.append(iconButton('folder-plus', 'New folder', () =>
      nameDialog('New folder', 'Folder name', 'Create', '', async name => {
        const reason = await createFolder(join(here(), name));
        if (reason === null) refresh();
        return reason;
      })));
  header.append(tools);
  const tree = el('ul', { className: 'folder-tree' });
  const results = el('div', { className: 'folder-tree' });
  const manage = o.move && o.remove && o.createFolder
    ? { move: o.move, remove: o.remove, createFolder: o.createFolder } : null;
  const menu = manage ? new PopupMenu('File actions', 'folder-row-menu', { alignEnd: true }) : null;
  if (menu) o.signal.addEventListener('abort', () => menu.dispose(), { once: true });
  /** The ⋯ menu's items for a row. */
  const menuItems = (path: string, kind: TreeEntry['kind']): [string, IconName, () => void][] =>
    !manage ? [] : kind === 'file' ? [
      ['Rename…', 'pencil', () => renameDialog(path, manage.move)],
      ['Move to…', 'folder-share', () => moveDialog(source, path, manage.move, async folder => {
        const reason = await manage.createFolder(folder);
        if (reason === null) refresh();
        return reason;
      })],
      ['Delete…', 'trash', () => manage.remove(path, 'file')],
    ] : [['Delete…', 'trash', () => manage.remove(path, 'directory')]];
  const more = (item: HTMLElement, path: string, kind: TreeEntry['kind']) => {
    if (!menu) return;
    const toggle = iconButton('dots-vertical', `Actions for ${basename(path)}`, () => {
      if (toggle.getAttribute('aria-expanded') === 'true') return menu.close(true);
      menu.element.setAttribute('aria-label', `Actions for ${basename(path)}`);
      menu.element.replaceChildren(...menuItems(path, kind).map(([label, name, run]) => {
        // Focus goes back to ⋯ first, so the dialog that follows returns focus there.
        const item = Object.assign(button(label, () => { menu.close(true); run(); }), { role: 'menuitem' });
        item.prepend(icon(name));
        return item;
      }));
      menu.open(toggle);
    });
    Object.assign(toggle,
      { className: 'folder-row-more', ariaHasPopup: 'menu', ariaExpanded: 'false' });
    // A folder's ⋯ comes before its children in tab order.
    item.insertBefore(toggle, item.querySelector(':scope > details'));
  };
  const fileButton = (path: string, detail = '') => {
    const b = row(button('', async () => {
      const failure = await o.open(path);
      if (failure) { b.disabled = true; b.title = failure; }
    }), ['file-text'], basename(path), detail);
    b.title = path;
    b.setAttribute('aria-current', String(path === o.current));
    markUnsaved(b, o.unsaved?.(path) ?? false);
    return b;
  };
  const fill = async (list: HTMLElement, directory: string) => {
    let entries;
    try { entries = await source.list(directory); }
    catch (error) { list.textContent = unreadable(error); return; }
    list.replaceChildren(...entries.map(entry => {
      const item = el('li');
      if (entry.kind === 'file') item.append(fileButton(entry.path));
      else {
        const children = el('ul');
        const summary = row(el('summary'), ['chevron-right', 'folder'], basename(entry.path));
        const details = el('details', {}, summary, children);
        details.ontoggle = () => {
          if (details.open) { expanded.add(entry.path); void fill(children, entry.path); }
          else expanded.delete(entry.path);
        };
        details.open = expanded.has(entry.path);
        item.append(details);
      }
      more(item, entry.path, entry.kind);
      return item;
    }));
  };
  const refresh = () => void fill(tree, '');
  tools.append(iconButton('refresh', 'Refresh', refresh));
  let timer: ReturnType<typeof setTimeout> | undefined, searches = 0;
  search.oninput = () => {
    clearTimeout(timer);
    const run = ++searches;
    timer = setTimeout(async () => {
      const query = search.value.trim();
      tree.hidden = !!query;
      results.replaceChildren();
      if (!query) return;
      let found;
      try { found = await findFiles(source, query); }
      catch (error) { if (run === searches) results.textContent = unreadable(error); return; }
      if (run !== searches) return;
      results.append(...found.paths.map(path => fileButton(path, dirname(path))));
      if (found.limited)
        results.append(el('p', { textContent: 'Showing matches from the first 20,000 files.' }));
      if (!found.paths.length && !found.limited) results.textContent = 'No matching files.';
    }, 200);
  };
  panel.append(search, results, tree, ...(menu ? [menu.element] : []));
  refresh();
  window.addEventListener('focus', refresh, { signal: o.signal });
}
const ancestors = (path: string) =>
  path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));
/** Choose a file from a just-opened folder. */
export function openFolderDialog(source: FileSource, open: (path: string) => Promise<string | null>) {
  const controller = new AbortController();
  fileDialog(`Open a file in ${source.label}`, (body, close) => {
    body.classList.add('folder-chooser');
    renderFolderPanel(body, {
      source, label: source.label, current: null, unavailable: null,
      open: async path => { const failure = await open(path); if (!failure) close(); return failure; },
      openFolder: () => {}, signal: controller.signal,
    });
    body.querySelector('.folder-header')?.remove();
  }, { onClose: () => controller.abort() });
}
/** Insert › Image › From folder…: the folder's images as thumbnails under their folders' names, with a search once
 * there are many; picking one inserts its path relative to `current`. `thumbnail` gives an image's address. */
export function imageFromFolderDialog(
  source: FileSource,
  current: string,
  insert: (path: string) => void,
  relative: (from: string, to: string) => string,
  thumbnail: (reference: string) => Promise<string | null>
) {
  fileDialog('Image from folder', async (body, close) => {
    const text = el('p', { textContent: 'Looking for images…' });
    body.append(text);
    let found;
    try { found = await findFiles(source, ''); }
    catch (error) { text.textContent = unreadable(error); return; }
    const { paths, limited } = found;
    const images = paths.filter(path => imageType(path));
    text.textContent = !images.length ? 'No images in this folder.'
      : limited ? 'Showing images from the first 20,000 files.' : '';
    const groups = el('div', { className: 'image-groups' });
    const draw = (query: string) => {
      const shown = images.filter(path => path.toLowerCase().includes(query.toLowerCase()));
      groups.replaceChildren(...[...new Set(shown.map(dirname))].flatMap(folder => {
        const grid = el('div', { className: 'image-grid' });
        for (const path of shown.filter(image => dirname(image) === folder)) {
          const reference = relative(current, path), picture = el('img', { alt: '' });
          void thumbnail(reference).then(url => { if (url) picture.src = url; });
          const choice = button('', () => { close(); insert(reference); }, 'image-choice');
          choice.append(picture, el('span', { textContent: basename(path) }));
          choice.setAttribute('aria-label', reference);
          choice.title = reference;
          grid.append(choice);
        }
        return [el('h3', { textContent: folder || source.label }), grid];
      }));
    };
    if (images.length > 24) {
      const search = el('input', { type: 'search', placeholder: 'Find an image…', ariaLabel: 'Find an image' });
      search.oninput = () => draw(search.value);
      body.append(search);
    }
    body.append(groups);
    draw('');
  }, { className: 'image-dialog' });
}
