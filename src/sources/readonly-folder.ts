import { readFile } from './handle';
import { sortEntries, type FileSource, type TreeEntry } from './types';
/** A folder chosen through a folder input: the browser supplies copies, so it cannot write or be restored. */
export class ReadOnlyFolderSource implements FileSource {
  readonly kind = 'folder-readonly';
  readonly writable = false;
  readonly label: string;
  private files = new Map<string, File>();
  constructor(readonly id: string, files: File[]) {
    this.label = files[0]?.webkitRelativePath.split('/')[0] || 'Folder';
    for (const file of files) this.files.set(file.webkitRelativePath.split('/').slice(1).join('/'), file);
  }
  async list(directory: string) {
    const prefix = directory ? directory + '/' : '', entries = new Map<string, TreeEntry>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const [name, ...rest] = path.slice(prefix.length).split('/');
      entries.set(name, { path: prefix + name, kind: rest.length ? 'directory' : 'file' });
    }
    return sortEntries([...entries.values()]);
  }
  async read(path: string) {
    const file = this.files.get(path);
    if (!file) throw new DOMException(`${path} is not in ${this.label}.`, 'NotFoundError');
    return readFile(file);
  }
  async permission() { return 'denied' as const; }
}
