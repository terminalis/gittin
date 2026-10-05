import { icon, iconMarkup } from '../ui/icons';
import type { DevicePreferences } from '../preferences';
import type { DraftSummary } from '../documents/drafts';
import { whenLabel } from '../documents/labels';
import { recentFolder } from '../documents/save-state';
import { recentFolders, sourceInfo } from '../sources/registry';
import { brand, button, el, iconButton } from '../ui/dom';
import { fileTile } from '../ui/file-tile';
import { homeMenu } from '../ui/home-menu';
import { favouriteCard } from '../ui/favourite-card';
const stateLabels = { local: 'Only in this browser', unsaved: 'Unsaved changes', saved: 'Saved' };
// The welcome band's backdrop: a faint editor window describing Gittin in YAML, coloured with the editor's own
// syntax classes (comments, strings, true/false and numbers; keys and list items stay plain, as in the editor).
const snippetLines = [
  '<span class="syntax-comment"># Gittin: an IDE? A word processor? It\'s just plain text</span>',
  'name: <span class="syntax-string">"Gittin"</span>',
  'edits: <span class="syntax-string">"Markdown, notes, code and config files, in your browser"</span>',
  'saves: <span class="syntax-string">"straight back to the file you opened"</span>',
  'account: <span class="syntax-keyword">false</span>  <span class="syntax-comment"># no account needed to start</span>',
  'drafts: <span class="syntax-string">"kept in this browser until you save"</span>',
  'offline: <span class="syntax-keyword">true</span>  <span class="syntax-comment"># after its first visit</span>',
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
export function home(
  prefs: DevicePreferences,
  rows: DraftSummary[],
  actions: {
    new: () => void;
    open(): void;
    openFolder(): void;
    openRecentFolder(id: string): void;
    switch(id: string): void;
    home(): void;
    remove(id: string): void;
  },
  failed = false
) {
  const screen = el('div', { id: 'home' });
  const folders = recentFolders(), favourites = rows.filter(r => r.favourite);
  const returning = rows.length > 0 || folders.length > 0;
  // The welcome band carries the landing's warm colour and logo; empty sections are left out rather
  // than explained.
  const intro = returning ? 'Pick up where you left off.'
    : 'Start a new file, or open one from your computer.';
  const favouritesSection = favourites.length
    ? '<section class="home-favourites"><h2>Favourites</h2><div id="favourites"></div></section>'
    : '';
  screen.innerHTML = `<header class="home-header">${brand('#/')}`
    + '<button type="button" class="home-menu-trigger" aria-label="Main menu" title="Main menu">'
    + `${iconMarkup('menu-2')}</button></header>`
    + `<main><div class="home-welcome">${snippet}<div class="home-welcome-copy"><h1>Your files</h1>`
    + `<p class="home-welcome-sub">${intro}</p><div class="document-actions"></div></div></div>`
    + `<div class="home-content">${favouritesSection}`
    + '<section class="recent-section"><h2>Recently worked on</h2><div id="recent"></div></section>'
    + `<p class="storage-note">${iconMarkup('info-circle')}<span>Unsaved changes are kept in this `
    + 'browser, which you or the browser can clear. Save to keep them in a file.'
    + '<span class="offline-status"> Gittin can start offline on this device.</span></span></p>'
    + '</div></main>';
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
      const chip = button(row.label, () => actions.openRecentFolder(row.id));
      chip.prepend(icon('folder'));
      group.append(chip);
    }
    copy.append(group);
  } else if (!returning) copy.insertAdjacentHTML('beforeend', '<p class="reassurance">No account needed to start.</p>');
  const favouriteGrid = screen.querySelector('#favourites');
  for (const row of favourites) favouriteGrid!.append(favouriteCard(row, () => actions.switch(row.id)));
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
    recent.innerHTML = '<div class="recent-head" aria-hidden="true"><span>Name</span><span>State</span>'
      + '<span>Last opened</span></div><ul class="recent-list"></ul>';
    for (const row of rows) {
      const info = row.identity.kind === 'source' ? sourceInfo(row.identity.sourceId) : undefined;
      const state = row.identity.kind === 'local' ? 'local' : row.unsaved ? 'unsaved' : 'saved';
      const where = recentFolder(row.identity, info);
      // The name button stretches over the whole row, so the row opens the file; Remove sits above it.
      const name = el('span', { className: 'recent-name' },
        button(row.title, () => actions.switch(row.id), 'recent-open'));
      if (where)
        name.append(el('span', { className: 'recent-folder' },
          ...(info && info.kind !== 'file' ? [icon('folder')] : []), el('span', { textContent: where })));
      // State and time sit in their own columns on wide screens and share a line under the name on phones.
      const status = el('span', { className: 'recent-state' },
        el('span', { className: 'state-mark' }, ...(state === 'saved' ? [icon('check')] : [])),
        stateLabels[state]);
      status.dataset.state = state;
      const remove = iconButton('x', 'Remove ' + row.title, () => actions.remove(row.id),
        'recent-remove');
      remove.title = 'Remove from this list';
      recent.querySelector('.recent-list')!.append(el('li', { className: 'recent-row' },
        fileTile(row.fileType, row.title), name,
        el('span', { className: 'recent-details' }, status,
          el('span', { className: 'recent-when', textContent: whenLabel(row.lastOpened) })),
        remove));
    }
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
  screen.append(homeMenu(trigger, prefs, { refresh: actions.home, applyHomeOptions: applyOptions }));
  return screen;
}
