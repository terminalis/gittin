import { blobVersion } from './version';
import type { WriteResult } from './types';
type Permission = { mode: 'readwrite' };
/** The File System Access members Gittin uses; declared here because TypeScript's DOM lib omits some. */
export interface FileHandle {
  readonly kind?: 'file';
  readonly name?: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  isSameEntry?(other: unknown): Promise<boolean>;
  queryPermission?(options: Permission): Promise<PermissionState>;
  requestPermission?(options: Permission): Promise<PermissionState>;
  /** Chromium: rename this file or move it into `parent`. */
  move?(parent: DirectoryHandle, name: string): Promise<void>;
}
export interface DirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterable<FileHandle | DirectoryHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  resolve(handle: FileHandle): Promise<string[] | null>;
  isSameEntry?(other: unknown): Promise<boolean>;
  queryPermission?(options: Permission): Promise<PermissionState>;
  requestPermission?(options: Permission): Promise<PermissionState>;
}
/** Current state without prompting, or ask (must run within a user gesture). */
export async function permission(handle: FileHandle | DirectoryHandle, ask: boolean): Promise<PermissionState> {
  const mode: Permission = { mode: 'readwrite' };
  const state = (await handle.queryPermission?.(mode)) ?? 'granted';
  return state === 'granted' || !ask ? state : ((await handle.requestPermission?.(mode)) ?? 'granted');
}
/** A file's bytes and their version. */
export async function readFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, version: await blobVersion(bytes) };
}
export const readHandle = async (handle: FileHandle) => readFile(await handle.getFile());
export async function writeHandle(handle: FileHandle, bytes: Uint8Array, expected: string | null): Promise<WriteResult> {
  let writable: Awaited<ReturnType<FileHandle['createWritable']>> | undefined;
  try {
    if ((await permission(handle, true)) !== 'granted') throw Error('File permission was denied. Use Save as to keep a copy.');
    if (expected !== null) {
      const disk = await readHandle(handle);
      if (disk.version !== expected) return { kind: 'conflict', version: disk.version };
    }
    writable = await handle.createWritable();
    await writable.write(new Blob([bytes as BlobPart]));
    await writable.close();
    return { kind: 'written', version: await blobVersion(bytes) };
  } catch (error) {
    if (writable) try { await writable.abort(); } catch {}
    throw error;
  }
}
