import { basename } from './paths';
import type { FileSource, TreeEntry } from './types';
const skipped = new Set(['.git', 'node_modules']);
/** Every entry under `directory`, breadth first. `hide` leaves out .git and node_modules folders. */
async function* walk(source: FileSource, directory: string, hide: boolean): AsyncGenerator<TreeEntry> {
  const queue = [directory];
  while (queue.length)
    for (const entry of await source.list(queue.shift()!)) {
      if (entry.kind === 'directory') {
        if (hide && skipped.has(basename(entry.path))) continue;
        queue.push(entry.path);
      }
      yield entry;
    }
}
/** File-name search over a whole source, breadth first, stopping after `limit` files. */
export async function findFiles(source: FileSource, query: string, limit = 20_000) {
  const needle = query.toLowerCase(), paths: string[] = [];
  let seen = 0;
  for await (const entry of walk(source, '', true)) {
    if (entry.kind === 'directory') continue;
    if (++seen > limit) return { paths, limited: true };
    if (basename(entry.path).toLowerCase().includes(needle)) paths.push(entry.path);
  }
  return { paths, limited: false };
}
/** How many files a folder holds, hidden ones included. */
export async function countFiles(source: FileSource, directory: string) {
  let count = 0;
  for await (const entry of walk(source, directory, false)) if (entry.kind === 'file') count++;
  return count;
}
/** Every folder in a source, the root ('') first, breadth first, skipping .git and node_modules. */
export async function findFolders(source: FileSource) {
  const folders = [''];
  for await (const entry of walk(source, '', true)) if (entry.kind === 'directory') folders.push(entry.path);
  return folders;
}
