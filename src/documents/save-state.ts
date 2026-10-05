import type { Identity, SavedBaseline, SourceVersion } from './types';
import type { SourceKind } from '../sources/types';
/** What the registry knows about a document's source; `open` is false when it could not be restored. */
export interface SourceInfo { kind: SourceKind; label: string; open: boolean }
/** Status wording for a draft that differs from its file on disk. */
const UNSAVED = 'Unsaved changes (kept in this browser)';
/** Whether a file's text differs from the file it came from, whatever the status says; a browser-only file has none. */
export function hasUnsavedChanges(identity: Identity, current: SourceVersion, baseline: SavedBaseline | null): boolean {
  return identity.kind === 'source' && baseline?.source !== current.source;
}
export function saveState(identity: Identity, current: SourceVersion, baseline: SavedBaseline | null, source: SourceInfo | undefined): string {
  if (identity.kind === 'local') return 'Only in this browser';
  if (source && !source.open && source.kind !== 'folder') return `Only in this browser (from ${source.label})`;
  if (source?.kind === 'folder-readonly') return 'Read-only folder: Save downloads a copy';
  return hasUnsavedChanges(identity, current, baseline) ? UNSAVED : 'Saved';
}
export function locationText(identity: Identity, source: SourceInfo | undefined): string {
  if (identity.kind === 'local') return 'Only in this browser';
  if (!source) return 'Only in this browser';
  if (!source.open) return source.kind === 'folder' ? `Folder unavailable: ${source.label} › ${identity.path}` : `Only in this browser (from ${source.label})`;
  // Browsers never reveal a single file's folder, and its name is already shown beside this.
  return source.kind === 'file' ? 'Opened on its own' : `In ${source.label} › ${identity.path}`;
}
/** Home's line under a recent file's name: its folder and subfolders, since the name is already shown. Browser-only files have none. */
export function recentFolder(identity: Identity, source: SourceInfo | undefined): string {
  if (identity.kind === 'local') return '';
  if (!source || source.kind === 'file' || (!source.open && source.kind !== 'folder')) return locationText(identity, source);
  const folder = [source.label, ...identity.path.split('/').slice(0, -1)].join(' › ');
  return source.open ? folder : `Folder unavailable: ${folder}`;
}
