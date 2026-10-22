import { fileDescriptor, fileName, type ExportType } from './file-types';
import { encodeSource } from '../editor/source-projection';
import { canPickSaveLocation, pickSaveLocation } from '../sources/pickers';
import { writeHandle } from '../sources/handle';
export function downloadFile(name: string, contents: string | Uint8Array, type: ExportType = 'markdown'): void {
  const mime = fileDescriptor(type)?.mime ?? 'text/plain';
  const url = URL.createObjectURL(typeof contents === 'string'
    ? new Blob([encodeSource(contents)], { type: mime + ';charset=utf-8' })
    : new Blob([contents as BlobPart], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName(name || 'Untitled file', type);
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
export async function exportFile(name: string, type: ExportType, contents: () => Promise<string | Uint8Array | null>) {
  const picker = canPickSaveLocation() ? pickSaveLocation(name, type) : null;
  const data = await contents();
  const handle = picker && (await picker);
  if (data === null || (picker && !handle)) return false;
  if (handle) await writeHandle(handle, typeof data === 'string' ? encodeSource(data) : data, null);
  else downloadFile(name, data, type);
  return true;
}
