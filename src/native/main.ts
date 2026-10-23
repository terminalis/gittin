// The desktop app: the shared app in a Tauri window, with the browser's file API provided by Tauri, the
// files the system asks Gittin to open, and git and GitHub for repository folders. It has no landing page and no
// offline copy.
import './git.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openHandles, start } from '../app';
import type { Extensions } from '../extensions';
import { notice } from '../ui/dom';
import { accountButton } from './account';
import { cloneButton, cloneCommand } from './clone';
import { DesktopFileHandle, installPickers, revive } from './files';
import { offerRepository } from './folder';
import { openHistory } from './history';
import { askBeforeQuitting } from './quit';
import { changed, saveAll } from './save';
import { syncCommand, syncFooter, syncInFolder } from './sync';

installPickers();
/** Opens the files handed to Gittin that are waiting. */
const openFiles = async () => {
  const paths = await invoke<string[]>('opened_files');
  if (paths.length) await openHandles(paths.map(path => new DesktopFileHandle(path)));
};
/** The window frame takes Gittin's background and text colours, and its light or dark appearance. */
const colourFrame = () => {
  const root = document.documentElement, style = getComputedStyle(root);
  void invoke('set_frame', {
    dark: root.dataset.theme === 'dark',
    background: style.getPropertyValue('--bg').trim(),
    text: style.getPropertyValue('--ink').trim(),
  }).catch(() => {});
};
const extensions: Extensions = {
  save: saveAll, changed, history: openHistory,
  folder: (source, panel) => { offerRepository(source, panel); syncInFolder(source, panel); },
  home: (header, actions) => { accountButton(header, 'home'); cloneButton(actions); },
  workspace: (doc, header, footer) => { accountButton(header, 'workspace'); syncFooter(doc, footer); },
  commands: doc => [cloneCommand, syncCommand(doc)],
};
void start({ revive, extensions }).then(async () => {
  colourFrame();
  new MutationObserver(colourFrame).observe(document.documentElement, { attributeFilter: ['data-theme'] });
  await askBeforeQuitting();
  // Files handed over before the page listens wait in the app, so take them after listening starts.
  await listen('open-files', () => void openFiles().catch(notice));
  await openFiles().catch(notice);
});
