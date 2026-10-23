// Closing Gittin's window asks about every file with unsaved changes, as desktop editors do.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { discardChanges, saveDrafts, saveTools, unsavedFiles } from '../app';
import { saveAll } from './save';

export function askBeforeQuitting() {
  return getCurrentWindow().onCloseRequested(async event => {
    await saveDrafts();
    const docs = unsavedFiles();
    if (!docs.length) return;
    const result = await saveAll(docs, 'quit', saveTools);
    if (result === 'cancelled') event.preventDefault();
    else if (result === 'discarded') for (const doc of docs) await discardChanges(doc);
  });
}
