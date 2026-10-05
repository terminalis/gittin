import { permission, readFile, readHandle, writeHandle, type FileHandle } from './handle';
import type { FileSource } from './types';
/** One individually opened or saved file. Writable only when the browser gave a handle. */
export class SingleFileSource implements FileSource {
  readonly kind = 'file';
  readonly writable: boolean;
  readonly label: string;
  constructor(readonly id: string, private readonly target: { handle: FileHandle; name?: string } | { file: File }) {
    this.writable = 'handle' in target;
    this.label = 'handle' in target ? (target.name ?? target.handle.name ?? 'Untitled file') : target.file.name;
  }
  get handle() { return 'handle' in this.target ? this.target.handle : null; }
  async list(_directory?: string) { return [{ path: this.label, kind: 'file' as const }]; }
  /** A copy the browser handed over can never be read from disk again. */
  async permission(ask: boolean) { return this.handle ? permission(this.handle, ask) : 'denied'; }
  async read(_path?: string) {
    return 'handle' in this.target ? readHandle(this.target.handle) : readFile(this.target.file);
  }
  async write(_path: string, bytes: Uint8Array, expected: string | null) {
    if (!('handle' in this.target)) throw Error('This browser opened a copy of the file. Use Save as.');
    return writeHandle(this.target.handle, bytes, expected);
  }
}
