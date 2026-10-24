// The browser's file API, as much of it as Gittin uses (src/sources/handle.ts and pickers.ts), backed by
// Tauri's file dialogs and file access. Gittin's own file code then runs unchanged in the desktop app.
import { open, save } from '@tauri-apps/plugin-dialog';
import * as fs from '@tauri-apps/plugin-fs';
import type { Identity } from '../documents/types';
import { FolderSource } from '../sources/folder';
import type { DirectoryHandle, FileHandle } from '../sources/handle';
import { sourceFor } from '../sources/registry';
import { SingleFileSource } from '../sources/single-file';

/** The file calls the handles make: Tauri's file plugin, or a stand-in in tests. */
export interface Disk {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readDir(path: string): Promise<{ name: string; isDirectory: boolean; isSymlink?: boolean }[]>;
  stat(path: string): Promise<{ isDirectory: boolean }>;
  mkdir(path: string): Promise<void>;
  remove(path: string, options: { recursive: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
let disk: Disk = fs;
export const useDisk = (stand: Disk) => { disk = stand; };

const notFound = (path: string) => new DOMException(`${path} was not found.`, 'NotFoundError');
const closed = () => new DOMException('The dialog was closed.', 'AbortError');
const kindAt = (path: string) =>
  disk.stat(path).then(info => (info.isDirectory ? 'directory' : 'file'), () => null);

/** A handle keeps only its path, kind and name, so IndexedDB can store it; `revive` brings back the rest. */
abstract class DesktopHandle {
  readonly name: string;
  constructor(readonly path: string) {
    // A drive or `/` has no last segment, so it is named by its path.
    this.name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) || path;
  }
  async isSameEntry(other: unknown) { return other instanceof DesktopHandle && other.path === this.path; }
}
export class DesktopFileHandle extends DesktopHandle implements FileHandle {
  readonly kind = 'file';
  async getFile() { return new File([(await disk.readFile(this.path)) as BlobPart], this.name); }
  async createWritable() {
    let bytes = new Uint8Array();
    return {
      write: async (data: Blob) => { bytes = new Uint8Array(await data.arrayBuffer()); },
      close: () => disk.writeFile(this.path, bytes),
      abort: async () => {},
    };
  }
  async move(parent: DirectoryHandle, name: string) {
    await disk.rename(this.path, (parent as DesktopDirectoryHandle).child(name));
  }
}
export class DesktopDirectoryHandle extends DesktopHandle implements DirectoryHandle {
  readonly kind = 'directory';
  /** A path inside this folder, written with the separator the system gave this folder's path. */
  child(name: string) {
    return this.path.replace(/[\\/]$/, '') + (this.path.includes('\\') ? '\\' : '/') + name;
  }
  async *values() {
    for (const entry of await disk.readDir(this.path)) {
      // Git's own folder isn't one of the writer's files: the Folder panel, search and Move to… skip it.
      if (entry.name === '.git') continue;
      const path = this.child(entry.name);
      // The directory listing calls a link to a folder a link, not a folder; `stat` follows it.
      const directory = entry.isDirectory || (entry.isSymlink && (await kindAt(path)) === 'directory');
      yield directory ? new DesktopDirectoryHandle(path) : new DesktopFileHandle(path);
    }
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const path = this.child(name), kind = await kindAt(path);
    if (!kind && options?.create) await disk.mkdir(path);
    else if (kind !== 'directory') throw notFound(path);
    return new DesktopDirectoryHandle(path);
  }
  async getFileHandle(name: string, options?: { create?: boolean }) {
    const path = this.child(name), kind = await kindAt(path);
    if (!kind && options?.create) await disk.writeFile(path, new Uint8Array());
    else if (kind !== 'file') throw notFound(path);
    return new DesktopFileHandle(path);
  }
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    await disk.remove(this.child(name), { recursive: !!options?.recursive });
  }
  async resolve(handle: FileHandle) {
    const path = (handle as DesktopFileHandle).path, prefix = this.child('');
    return path.startsWith(prefix) ? path.slice(prefix.length).split(/[\\/]/) : null;
  }
}

type SaveOptions = { suggestedName: string; types?: { description: string; accept: Record<string, readonly string[]> }[] };
/** Gives the window the browser's file pickers, which open the system's file dialogs. As in the browser,
 * saving creates the file if it is new. */
export function installPickers() {
  Object.assign(window, {
    showOpenFilePicker: async () => {
      const path = await open({ multiple: false, directory: false });
      if (typeof path !== 'string') throw closed();
      return [new DesktopFileHandle(path)];
    },
    showDirectoryPicker: async () => {
      // Recursive, or the folder's own subfolders stay outside the scope the dialog grants.
      const path = await open({ directory: true, recursive: true });
      if (typeof path !== 'string') throw closed();
      return new DesktopDirectoryHandle(path);
    },
    showSaveFilePicker: async ({ suggestedName, types = [] }: SaveOptions) => {
      const filters = types.map(type => ({
        name: type.description,
        extensions: Object.values(type.accept).flat().map(extension => extension.slice(1)),
      }));
      const path = await save({ defaultPath: suggestedName, filters });
      if (typeof path !== 'string') throw closed();
      if (!(await kindAt(path))) await disk.writeFile(path, new Uint8Array());
      return new DesktopFileHandle(path);
    },
  });
}
/** A handle IndexedDB stored, with its methods back. */
export function revive(stored: DirectoryHandle | FileHandle): DirectoryHandle | FileHandle {
  const { path } = stored as unknown as { path: string };
  return stored.kind === 'directory' ? new DesktopDirectoryHandle(path) : new DesktopFileHandle(path);
}
/** A file's full path on disk: its folder's path joined with its path in the folder, with the folder's own
 * separator, or the path of a file opened on its own. */
export function diskPath(identity: Identity) {
  if (identity.kind !== 'source') return null;
  const source = sourceFor(identity);
  if (source instanceof FolderSource)
    return identity.path.split('/').reduce((path, part) => new DesktopDirectoryHandle(path).child(part),
      (source.root as DesktopDirectoryHandle).path);
  return source instanceof SingleFileSource ? (source.handle as DesktopFileHandle | null)?.path ?? null : null;
}
