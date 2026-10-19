import { fileDescriptor, fileName, type FileType } from './file-types';
import { encodeSource } from '../editor/source-projection';
import { canPickSaveLocation, pickSaveLocation } from '../sources/pickers';
import { writeHandle } from '../sources/handle';
export function downloadMarkdown(name: string, source: string, fileType: FileType = 'markdown'): void {
  const url = URL.createObjectURL(
    new Blob([encodeSource(source)], { type: (fileDescriptor(fileType)?.mime ?? 'text/plain') + ';charset=utf-8' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(name || 'Untitled file', fileType);
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
/** Exports a copy: asks where to save it when the browser or app can, and downloads it otherwise.
 * The save picker opens at once, within the click; `contents` runs after it and returns null to cancel.
 * Resolves true once the copy is written or handed to the browser. */
export async function exportFile(name: string, fileType: FileType, contents: () => Promise<string | null>) {
  const picker = canPickSaveLocation() ? pickSaveLocation(name, fileType) : null;
  const source = await contents();
  const handle = picker && (await picker);
  if (source === null || (picker && !handle)) return false;
  if (handle) await writeHandle(handle, encodeSource(source), null);
  else downloadMarkdown(name, source, fileType);
  return true;
}
