// The desktop app: the shared app in a Tauri window, with the browser's file API provided by Tauri.
// It has no landing page and no offline copy.
import { start } from '../app';
import { installPickers, revive } from './files';

installPickers();
void start({ revive });
