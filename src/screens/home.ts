import { icon, iconMarkup, type IconName } from '../ui/icons';
import type { DevicePreferences, Preferences } from '../preferences';
import type { DraftSummary } from '../documents/drafts';
import { whenLabel } from '../documents/labels';
import { recentFolder } from '../documents/save-state';
import { homeFolders, sourceInfo } from '../sources/registry';
import { brand, button, el, iconButton } from '../ui/dom';
import { fileTile } from '../ui/file-tile';
import { homeMenu } from '../ui/home-menu';
import { favouriteCard } from '../ui/favourite-card';
import { PopupMenu } from '../ui/popup-menu';
import { desktop, place } from '../platform';
import { extensions } from '../extensions';
const stateLabels = { local: 'Not saved yet', unsaved: 'Unsaved changes', saved: 'Saved' };
const recentListMarkup = '<div class="recent-head" aria-hidden="true"><span>Name</span><span>State</span>'
  + '<span>Last opened</span></div><ul class="recent-list"></ul>';
/** A Recently worked on row, which Favourites' list view shares: the whole row opens the file, and `more` is its ⋯. */
function recentRow(row: DraftSummary, open: () => void, more: HTMLElement) {
  const info = row.identity.kind === 'source' ? sourceInfo(row.identity.sourceId) : undefined;
  const state = row.identity.kind === 'local' ? 'local' : row.unsaved ? 'unsaved' : 'saved';
  const where = recentFolder(row.identity, info) || (extensions.fileFolder?.(row.identity) ?? '');
  // The name button stretches over the whole row, so the row opens the file; ⋯ sits above it.
  const name = el('span', { className: 'recent-name' }, button(row.title, open, 'recent-open'));
  if (where) name.append(el('span', { className: 'recent-folder' }, icon('folder'), el('span', { textContent: where })));
  // State and time sit in their own columns on wide screens and share a line under the name on phones.
  const status = el('span', { className: 'recent-state' },
    el('span', { className: 'state-mark' }, ...(state === 'saved' ? [icon('check')] : [])),
    stateLabels[state]);
  status.dataset.state = state;
  return el('li', { className: 'recent-row' }, fileTile(row.fileType, row.title), name,
    el('span', { className: 'recent-details' }, status,
      el('span', { className: 'recent-when', textContent: whenLabel(row.lastOpened) })), more);
}
/** Where focus goes when Home is redrawn: back to the control that had it or, when its file has left that list, to the
 * ⋯ of the file after it, else the one before. */
export function focusTargets(active: Element | null) {
  const item = active?.closest('.recent-row, .favourite-card');
  const near = [item?.nextElementSibling, item?.previousElementSibling]
    .map(next => next?.querySelector('.file-more')?.id);
  return [active?.id, ...near].filter((id): id is string => !!id);
}
type FavouritesSort = NonNullable<Preferences['homeFavouritesSort']>;
const favouriteSorts: [FavouritesSort, string][] = [
  ['title-asc', 'Title, A to Z'], ['title-desc', 'Title, Z to A'],
  ['opened-desc', 'Last opened, newest first'], ['opened-asc', 'Last opened, oldest first'],
];
const byTitle = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;
function sortFavourites(rows: DraftSummary[], order: FavouritesSort) {
  const sorted = [...rows].sort((a, b) => order.startsWith('title') ? byTitle(a.title, b.title) : a.lastOpened - b.lastOpened);
  return order.endsWith('desc') ? sorted.reverse() : sorted;
}
// The welcome band's backdrop: a faint editor window describing Gittin in YAML, coloured with the editor's own
// syntax classes (comments, strings, true/false and numbers; keys and list items stay plain, as in the editor).
const snippetLines = [
  '<span class="syntax-comment"># Gittin: an IDE? A word processor? It\'s just plain text</span>',
  'name: <span class="syntax-string">"Gittin"</span>',
  `edits: <span class="syntax-string">"Markdown, notes, code and config files${desktop ? '' : ', in your browser'}"</span>`,
  'saves: <span class="syntax-string">"straight back to the file you opened"</span>',
  'account: <span class="syntax-keyword">false</span>  <span class="syntax-comment"># no account needed</span>',
  `drafts: <span class="syntax-string">"kept in ${place} until you save"</span>`,
  'offline: <span class="syntax-keyword">true</span>' + (desktop ? '' : '  <span class="syntax-comment"># after its first visit</span>'),
  'history: <span class="syntax-number">20</span>  <span class="syntax-comment"># recent saves of each file</span>',
  'languages:',
  '  - Markdown',
  '  - plain text',
  '  - JSON',
  '  - YAML',
  '  - CSS',
];
const snippet = '<div class="home-art" aria-hidden="true"><div class="home-snippet">'
  + '<div class="home-snippet-bar"><span class="file-tile">YAML</span>gittin.yaml</div><pre>'
  + snippetLines.map((line, i) => `<span class="home-snippet-number">${i + 1}</span>${line}`).join('\n')
  + '</pre></div></div>';
const storageNote = desktop ? 'Unsaved changes are kept in this app. Save to keep them in a file.'
  : 'Unsaved changes are kept in this browser, which you or the browser can clear. Save to keep them in a file.'
    + '<span class="offline-status"> Gittin can start offline on this device.</span>';
export function home(
  prefs: DevicePreferences,
  rows: DraftSummary[],
  actions: {
    new: () => void;
    open(): void;
    openFolder(): void;
    openRecentFolder(id: string): void;
    removeFolder(id: string): void;
    switch(id: string): void;
    home(): void;
    remove(id: string): void;
    favourite(id: string, favourite: boolean): void;
    rename(id: string): void;
    deleteFile(id: string): void;
    install?(): void;
  },
  failed = false
) {
  const screen = el('div', { id: 'home' });
  // One ⋯ menu serves every file on Home, filled for the file whose ⋯ opens it. Delete… is offered only in a folder
  // Gittin can write to: it cannot delete a file opened on its own, and Remove deletes one kept only in Gittin.
  const fileMenu = new PopupMenu('File actions', 'file-menu', { alignEnd: true });
  const actionsButton = (row: DraftSummary, list: 'favourite' | 'recent') => {
    const label = `Actions for ${row.title}`;
    const toggle = iconButton('dots-vertical', label, () => {
      if (toggle.getAttribute('aria-expanded') === 'true') return fileMenu.close(true);
      // Focus goes back to ⋯ first, so a dialog that follows returns focus there.
      const item = (text: string, name: IconName, run: () => void) => {
        const entry = button(text, () => { fileMenu.close(true); run(); });
        entry.prepend(icon(name));
        return Object.assign(entry, { role: 'menuitem' });
      };
      const favourite = Object.assign(item('Favourite', 'star', () => actions.favourite(row.id, !row.favourite)),
        { role: 'menuitemcheckbox' });
      favourite.setAttribute('aria-checked', String(row.favourite));
      favourite.append(el('span', { className: 'menu-switch', ariaHidden: 'true' }));
      const info = row.identity.kind === 'source' ? sourceInfo(row.identity.sourceId) : undefined;
      fileMenu.element.setAttribute('aria-label', label);
      fileMenu.element.replaceChildren(favourite, item('Rename…', 'pencil', () => actions.rename(row.id)),
        item('Remove', 'x', () => actions.remove(row.id)),
        ...(info?.kind === 'folder' && info.open ? [item('Delete…', 'trash', () => actions.deleteFile(row.id))] : []));
      fileMenu.open(toggle);
    }, 'file-more');
    Object.assign(toggle, { id: `${list}-actions-${row.id}`, ariaHasPopup: 'menu', ariaExpanded: 'false' });
    return toggle;
  };
  const folders = homeFolders(), favourites = rows.filter(r => r.favourite);
  const returning = rows.length > 0 || folders.length > 0;
  // The welcome band carries the landing's warm colour and logo; empty sections are left out rather
  // than explained.
  const favouritesSection = favourites.length
    ? '<section class="home-favourites"><div class="favourites-head"><h2>Favourites</h2></div>'
      + '<div id="favourites"></div></section>'
    : '';
  screen.innerHTML = `<header class="home-header">${brand('#/')}`
    + '<button type="button" class="home-menu-trigger" aria-label="Main menu" title="Main menu">'
    + `${iconMarkup('menu-2')}</button></header>`
    + `<main><div class="home-welcome">${snippet}<div class="home-welcome-copy">`
    + '<div class="document-actions"></div></div></div>'
    + `<div class="home-content">${favouritesSection}`
    + '<section class="recent-section"><h2>Recently worked on</h2>'
    + `<p class="storage-note">${iconMarkup('info-circle')}<span>${storageNote}</span></p><div id="recent"></div>`
    + '</section></div></main>';
  const create = button('New file', () => actions.new(), 'primary'),
    open = button('Open file', actions.open),
    folder = button('Open folder', actions.openFolder);
  create.prepend(icon('plus'));
  open.prepend(icon('file-text'));
  folder.prepend(icon('folder'));
  screen.querySelector('.document-actions')!.append(create, open, folder);
  const copy = screen.querySelector('.home-welcome-copy')!;
  if (folders.length) {
    const label = el('span', { id: 'folders-label', textContent: 'Recent folders' });
    const group = el('div', { id: 'folders', role: 'group' }, label);
    group.setAttribute('aria-labelledby', 'folders-label');
    for (const row of folders) {
      const chip = button(row.label, () => actions.openRecentFolder(row.id), 'folder-open');
      chip.prepend(icon('folder'));
      group.append(el('span', { className: 'folder-chip' }, chip,
        iconButton('x', `Remove ${row.label} from Home`, () => actions.removeFolder(row.id), 'folder-remove')));
    }
    copy.append(group);
  } else if (!returning) copy.insertAdjacentHTML('beforeend', '<p class="reassurance">No account needed.</p>');
  const favouriteList = screen.querySelector<HTMLElement>('#favourites');
  if (favouriteList) {
    // Cards, or Recently worked on's rows, in the order chosen from Sort; this device keeps both.
    const showFavourites = () => {
      const { homeFavouritesView = 'grid', homeFavouritesSort = 'opened-desc' } = prefs.value;
      const sorted = sortFavourites(favourites, homeFavouritesSort), list = homeFavouritesView === 'list';
      if (list) {
        favouriteList.className = '';
        favouriteList.innerHTML = recentListMarkup;
        favouriteList.querySelector('.recent-list')!.append(...sorted.map(row =>
          recentRow(row, () => actions.switch(row.id), actionsButton(row, 'favourite'))));
      } else {
        favouriteList.className = 'favourite-grid';
        favouriteList.replaceChildren(...sorted.map(row =>
          favouriteCard(row, () => actions.switch(row.id), actionsButton(row, 'favourite'))));
      }
      const label = list ? 'Show as grid' : 'Show as list';
      viewButton.replaceChildren(icon(list ? 'layout-grid' : 'list'));
      Object.assign(viewButton, { ariaLabel: label, title: label });
    };
    const viewButton = iconButton('list', '', () => {
      void prefs.save({ homeFavouritesView: prefs.value.homeFavouritesView === 'list' ? 'grid' : 'list' });
      showFavourites();
    }, 'favourite-view');
    const sortMenu = new PopupMenu('Sort favourites', 'favourite-sort-menu', { alignEnd: true });
    const sortButton = iconButton('arrows-up-down', 'Sort favourites', () => {
      if (!sortMenu.element.hidden) return sortMenu.close(true);
      const current = prefs.value.homeFavouritesSort ?? 'opened-desc';
      const items = favouriteSorts.map(([order, label]) => {
        const item = el('button', { type: 'button', role: 'menuitemradio', onclick: () => {
          sortMenu.close(true);
          void prefs.save({ homeFavouritesSort: order });
          showFavourites();
        } }, el('span', { className: 'toolbar-menu-check' }, ...(order === current ? [icon('check')] : [])), label);
        item.setAttribute('aria-checked', String(order === current));
        return item;
      });
      sortMenu.element.replaceChildren(...items);
      sortMenu.open(sortButton, items[favouriteSorts.findIndex(([order]) => order === current)]);
    }, 'favourite-sort');
    sortButton.setAttribute('aria-haspopup', 'menu');
    sortButton.setAttribute('aria-expanded', 'false');
    screen.querySelector('.favourites-head')!.append(
      el('div', { className: 'favourite-tools' }, viewButton, sortButton, sortMenu.element));
    showFavourites();
  }
  const recent = screen.querySelector('#recent')!;
  if (failed) {
    recent.textContent = 'Recent work could not be loaded.';
    recent.append(button('Refresh recent work', actions.home));
  } else if (!rows.length)
    recent.innerHTML = `<div class="empty">${iconMarkup('files')}`
      + '<strong>Your recent files will appear here.</strong>'
      + (folders.length ? '' : '<span>So will the folders you open and the files you star.</span>')
      + '</div>';
  else {
    recent.innerHTML = recentListMarkup;
    recent.querySelector('.recent-list')!.append(...rows.map(row =>
      recentRow(row, () => actions.switch(row.id), actionsButton(row, 'recent'))));
  }
  // Home options from the main menu hide parts in place, so a change shows at once and the menu stays open.
  const listed = [...recent.querySelectorAll<HTMLElement>('.recent-row')];
  const count = el('span');
  let expanded = false;
  const more = el('p', { className: 'recent-more' }, count, button('Show all', () => {
    const revealed = listed.findIndex(row => row.hidden);
    expanded = true;
    applyOptions();
    listed[revealed]?.querySelector<HTMLButtonElement>('.recent-open')?.focus();
  }));
  if (listed.length) recent.append(more);
  const applyOptions = () => {
    const { homeFavourites, homeFolders, homeRecentLimit = 'all' } = prefs.value;
    screen.querySelector('.home-favourites')?.toggleAttribute('hidden', homeFavourites === false);
    screen.querySelector('#folders')?.toggleAttribute('hidden', homeFolders === false);
    const shown = expanded || homeRecentLimit === 'all'
      ? listed.length
      : Math.min(homeRecentLimit, listed.length);
    listed.forEach((row, i) => { row.hidden = i >= shown; });
    count.textContent = `Showing ${shown} of ${listed.length}`;
    more.hidden = shown === listed.length;
  };
  applyOptions();
  const trigger = screen.querySelector<HTMLButtonElement>('.home-menu-trigger')!;
  if (actions.install) trigger.before(button('Install', actions.install, 'home-install'));
  screen.append(homeMenu(trigger, prefs, { refresh: actions.home, applyHomeOptions: applyOptions }), fileMenu.element);
  extensions.home?.(screen.querySelector<HTMLElement>('.home-header')!, screen.querySelector<HTMLElement>('.document-actions')!);
  return screen;
}
