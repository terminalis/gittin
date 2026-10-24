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

/** A repository Sync works on: the opened folder that holds it, its folder on disk, the name Gittin shows for it, and
 * the prefix of its files' paths in the opened folder ('' when it is the opened folder itself). */
export interface Repo { source: FolderSource; root: string; name: string; prefix: string }

export function repoOfFolder(source: FolderSource): Repo {
  const folder = source.root as DesktopDirectoryHandle;
  return { source, root: folder.path, name: folder.name, prefix: '' };
}

/** The repository holding a document's file, if any. */
export async function repoOfDocument(doc: OpenDocument): Promise<Repo | null> {
  const identity = doc.session.identity;
  const source = identity.kind === 'source' ? sourceFor(identity) : undefined;
  const place = await placeOfDocument(doc);
  if (!place || !(source instanceof FolderSource)) return null;
  const top = (source.root as DesktopDirectoryHandle).path;
  return { source, root: place.root, name: place.name, prefix: place.root === top ? '' : `${place.name}/` };
}
