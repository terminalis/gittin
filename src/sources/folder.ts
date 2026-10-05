import { permission, readHandle, writeHandle, type DirectoryHandle, type FileHandle } from './handle';
import { dirname, basename, join } from './paths';
import { sortEntries, type FileSource, type TreeEntry } from './types';
/** A folder picked with showDirectoryPicker (Chromium). */
export class FolderSource implements FileSource {
  readonly kind = 'folder';
  readonly writable = true;
  constructor(readonly id: string, readonly root: DirectoryHandle) {}
  get label() { return this.root.name; }
  permission(ask: boolean) { return permission(this.root, ask); }
  private async directory(path: string) {
    let directory = this.root;
    for (const part of path.split('/').filter(Boolean)) directory = await directory.getDirectoryHandle(part);
    return directory;
  }
  private async file(path: string, create = false) {
    return (await this.directory(dirname(path))).getFileHandle(basename(path), { create });
  }
  private async allowed() {
    if ((await this.permission(true)) !== 'granted') throw Error(`Gittin needs permission to save in ${this.label}.`);
  }
  /** The file or folder beside `path` with the same name, ignoring case as Windows and macOS do,
   * other than `self`. */
  private async existing(path: string, self?: string) {
    const name = basename(path).toLowerCase(), entries = await this.list(dirname(path));
    return entries.find(entry => entry.path !== self && basename(entry.path).toLowerCase() === name);
  }
  async list(directory: string): Promise<TreeEntry[]> {
    const entries: TreeEntry[] = [];
    for await (const handle of (await this.directory(directory)).values())
      entries.push({ path: join(directory, handle.name!), kind: handle.kind === 'directory' ? 'directory' : 'file' });
    return sortEntries(entries);
  }
  async read(path: string) { return readHandle(await this.file(path)); }
  async write(path: string, bytes: Uint8Array, expected: string | null) {
    await this.allowed();
    return writeHandle(await this.file(path), bytes, expected);
  }
  /** `existing` is the file or folder already using the name, whose letter case may differ. */
  async create(path: string, bytes: Uint8Array) {
    const existing = await this.existing(path);
    if (existing) return { kind: 'exists', existing } as const;
    await this.allowed();
    const written = await writeHandle(await this.file(path, true), bytes, null);
    return { kind: 'created', version: written.version } as const;
  }
  async createFolder(path: string) {
    await this.allowed();
    if (await this.existing(path)) return 'exists' as const;
    await (await this.directory(dirname(path))).getDirectoryHandle(basename(path), { create: true });
    return 'created' as const;
  }
  /** Renames or moves a file (never a folder) within the folder. */
  async move(from: string, to: string) {
    await this.allowed();
    if (await this.existing(to, from)) return 'exists' as const;
    const handle = await this.file(from);
    if (!handle.move) throw Error('This browser cannot rename or move files.');
    await handle.move(await this.directory(dirname(to)), basename(to));
    return 'moved' as const;
  }
  /** Deletes a file, or a folder and all it holds: permanently, as browsers have no Recycle Bin. */
  async remove(path: string) {
    await this.allowed();
    await (await this.directory(dirname(path))).removeEntry(basename(path), { recursive: true });
  }
  /** The path of a picked file inside this folder, or null when it lies outside. */
  async locate(handle: FileHandle) {
    const parts = await this.root.resolve(handle);
    return parts ? parts.join('/') : null;
  }
}
