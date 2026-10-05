export type SourceKind = 'folder' | 'folder-readonly' | 'file';
export interface TreeEntry { path: string; kind: 'file' | 'directory' }
export type WriteResult = { kind: 'written'; version: string } | { kind: 'conflict'; version: string };
/** A repository-shaped place documents come from. Sources never open dialogs. Only a FolderSource
 * creates, moves and deletes files. */
export interface FileSource {
  readonly id: string;
  readonly kind: SourceKind;
  readonly label: string;
  /** Whether Save can write a file back in place, through `write`. */
  readonly writable: boolean;
  /** Whether Gittin may read and write the files on disk, asking first when `ask` is true. */
  permission(ask: boolean): Promise<PermissionState>;
  list(directory: string): Promise<TreeEntry[]>;
  read(path: string): Promise<{ bytes: Uint8Array; version: string }>;
  /** `expectedVersion` null overwrites without checking. */
  write?(path: string, bytes: Uint8Array, expectedVersion: string | null): Promise<WriteResult>;
}
export const sortEntries = (entries: TreeEntry[]) =>
  entries.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'directory' ? -1 : 1));
