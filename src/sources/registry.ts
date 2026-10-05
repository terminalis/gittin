import { change, getAll } from '../documents/database';
import type { SourceInfo } from '../documents/save-state';
import type { Identity } from '../documents/types';
import { FolderSource } from './folder';
import type { DirectoryHandle, FileHandle } from './handle';
import { isWithin } from './paths';
import { ReadOnlyFolderSource } from './readonly-folder';
import { SingleFileSource } from './single-file';
import type { FileSource, SourceKind } from './types';
/** A source as remembered across reloads. `locator` is the browser handle that reopens it. */
interface SourceRecord { id: string; kind: SourceKind; label: string; locator: DirectoryHandle | FileHandle | null; lastOpened: number }
const records = new Map<string, SourceRecord>();
const open = new Map<string, FileSource>();
export async function loadSources() {
  for (const row of await getAll<SourceRecord>('sources')) records.set(row.id, row);
}
export const openSource = (id: string) => open.get(id);
export const openSources = () => [...open.values()];
export const recentFolders = () =>
  [...records.values()].filter(row => row.kind === 'folder' && row.locator).sort((a, b) => b.lastOpened - a.lastOpened);
export function sourceInfo(id: string): SourceInfo | undefined {
  const row = records.get(id);
  // A remembered handle can be restored, so the source counts as open before the editor restores it.
  return row && { kind: row.kind, label: row.label, open: open.has(id) || !!row.locator };
}
/** True when the document is the file at `path`, or inside the folder at `path`. */
export function isAt(identity: Identity, sourceId: string, path: string): boolean {
  return identity.kind === 'source' && identity.sourceId === sourceId && isWithin(identity.path, path);
}
export function sourceFor(identity: Identity): FileSource | undefined {
  return identity.kind === 'source' ? open.get(identity.sourceId) : undefined;
}
export function sourceInfoFor(identity: Identity): SourceInfo | undefined {
  return identity.kind === 'source' ? sourceInfo(identity.sourceId) : undefined;
}
async function remember(source: FileSource, locator: SourceRecord['locator']) {
  const row = { id: source.id, kind: source.kind, label: source.label, locator, lastOpened: Date.now() };
  records.set(row.id, row);
  open.set(source.id, source);
  // Best effort: a handle IndexedDB cannot store still works for this session.
  try { await change(['sources'], tx => tx.objectStore('sources').put(row)); }
  catch { try { await change(['sources'], tx => tx.objectStore('sources').put({ ...row, locator: null })); } catch {} }
}
async function existing(kind: SourceKind, handle: DirectoryHandle | FileHandle) {
  for (const row of records.values())
    if (row.kind === kind && row.locator && (await (row.locator.isSameEntry?.(handle) ?? Promise.resolve(false)).catch(() => false))) return row.id;
}
export async function addFolder(handle: DirectoryHandle) {
  const source = new FolderSource((await existing('folder', handle)) ?? crypto.randomUUID(), handle);
  await remember(source, handle);
  return source;
}
export async function addReadOnlyFolder(files: File[]) {
  const source = new ReadOnlyFolderSource(crypto.randomUUID(), files);
  await remember(source, null);
  return source;
}
export async function addFile(target: { handle: FileHandle; name?: string } | { file: File }) {
  const id = ('handle' in target && (await existing('file', target.handle))) || crypto.randomUUID();
  const source = new SingleFileSource(id, target);
  await remember(source, 'handle' in target ? target.handle : null);
  return source;
}
/** Recreate a remembered source from its handle without prompting. Undefined when it cannot be restored. */
export async function restoreSource(id: string): Promise<FileSource | undefined> {
  if (open.has(id)) return open.get(id);
  const row = records.get(id);
  if (!row?.locator) return undefined;
  const source = row.kind === 'folder'
    ? new FolderSource(id, row.locator as DirectoryHandle)
    : new SingleFileSource(id, { handle: row.locator as FileHandle, name: row.label });
  open.set(id, source);
  return source;
}
