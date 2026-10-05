import { fileDescriptor, fileName, type FileType } from '../documents/file-types';
import type { DirectoryHandle, FileHandle } from './handle';
type PickerWindow = Window & {
  showDirectoryPicker?(options?: { mode?: 'readwrite' }): Promise<DirectoryHandle>;
  showOpenFilePicker?(): Promise<FileHandle[]>;
  showSaveFilePicker?(options: unknown): Promise<FileHandle>;
};
const pickers = () => window as PickerWindow;
/** What the picker returns, or null when the person cancels it. Opens the picker synchronously. */
async function pick<T>(open: () => Promise<T>): Promise<T | null> {
  try {
    return await open();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
/** 'input' means this browser has no picker: the caller clicks its file input instead. */
export async function chooseFile(): Promise<FileHandle | null | 'input'> {
  const picker = pickers().showOpenFilePicker;
  return picker ? ((await pick(() => picker.call(window)))?.[0] ?? null) : 'input';
}
export async function chooseFolder(): Promise<DirectoryHandle | null | 'input'> {
  const picker = pickers().showDirectoryPicker;
  return picker ? pick(() => picker.call(window, { mode: 'readwrite' })) : 'input';
}
export const canPickSaveLocation = () => typeof pickers().showSaveFilePicker === 'function';
/** Call directly from the click handler, before other asynchronous work. */
export function pickSaveLocation(name: string, fileType: FileType): Promise<FileHandle | null> {
  const descriptor = fileDescriptor(fileType);
  const types = descriptor
    ? [{ description: descriptor.label, accept: { [descriptor.mime]: [...descriptor.extensions] } }]
    : undefined;
  const options = { suggestedName: fileName(name, fileType), ...(types ? { types } : {}) };
  return pick(() => pickers().showSaveFilePicker!.call(window, options));
}
