// The desktop app: the shared app in a Tauri window, with the browser's file API provided by Tauri, and
// the files the system asks Gittin to open. It has no landing page and no offline copy.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openHandles, start } from '../app';
import { notice } from '../ui/dom';
import { DesktopFileHandle, installPickers, revive } from './files';

installPickers();
/** Opens the files handed to Gittin that are waiting. */
const openFiles = async () => {
  const paths = await invoke<string[]>('opened_files');
  if (paths.length) await openHandles(paths.map(path => new DesktopFileHandle(path)));
};
void start({ revive }).then(async () => {
  // Files handed over before the page listens wait in the app, so take them after listening starts.
  await listen('open-files', () => void openFiles().catch(notice));
  await openFiles().catch(notice);
});
