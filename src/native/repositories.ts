// Which repository holds a file: the opened folder itself, or a folder directly inside it.
import { FolderSource } from '../sources/folder';
import { sourceFor } from '../sources/registry';
import type { FileSource } from '../sources/types';
import type { OpenDocument } from '../screens/workspace';
import type { DesktopDirectoryHandle } from './files';
import { git } from './git';

/** A repository holding a file: its folder on disk, the name Gittin shows for it, and the file's path in it. */
export interface Place { root: string; name: string; path: string }

export async function placeOf(source: FileSource | undefined, path: string): Promise<Place | null> {
  if (!(source instanceof FolderSource)) return null;
  const folder = source.root as DesktopDirectoryHandle, repositories = await git.repositories(folder.path);
  const [first, ...rest] = path.split('/');
  if (rest.length && repositories.includes(first))
    return { root: folder.child(first), name: first, path: rest.join('/') };
  return repositories.includes('') ? { root: folder.path, name: folder.name, path } : null;
}

export function placeOfDocument(doc: OpenDocument) {
  const identity = doc.session.identity;
  return identity.kind === 'source' ? placeOf(sourceFor(identity), identity.path) : Promise.resolve(null);
}
