// What a version of Gittin adds to the shared app through start(): the desktop app's git and GitHub. The web app adds none.
import type { OpenDocument } from './screens/workspace';
import type { FolderSource } from './sources/folder';
import type { Use } from './ui/version-history';

/** A change Gittin made to a folder's files: an image it added, a file it saved for the first time, a rename or
 * move, or a deletion. */
export type FileChange =
  | { kind: 'create'; path: string }
  | { kind: 'add'; path: string }
  | { kind: 'move'; from: string; to: string }
  | { kind: 'delete'; path: string };
/** What saving needs from Gittin itself: writing a document to its file, and the file status line. */
export interface SaveTools {
  write(doc: OpenDocument): Promise<boolean>;
  report(doc: OpenDocument, text: string): void;
}
export type SaveResult = 'saved' | 'discarded' | 'cancelled';
export interface Extensions {
  /** Saves documents that need more than writing, such as committing them. Resolves null when none of them
   * does, and Gittin saves as usual. When closing, the writer can also discard. */
  save?(docs: OpenDocument[], reason: 'save' | 'close', tools: SaveTools): Promise<SaveResult | null>;
  /** Told once Gittin has changed a folder's files. */
  changed?(source: FolderSource, change: FileChange): Promise<void>;
  /** Shows a file's history its own way; resolves false to leave it to Version history. */
  history?(doc: OpenDocument, use: Use): Promise<boolean>;
  /** Adds to the Folder panel of a folder Gittin can write to, each time the panel is drawn. */
  folder?(source: FolderSource, panel: HTMLElement): void;
  /** Adds to Home: `header` is its header, `actions` the row of New file, Open file and Open folder. */
  home?(header: HTMLElement, actions: HTMLElement): void;
  /** Adds to a document's workspace: `header` holds the header's buttons, `footer` the status footer's items. */
  workspace?(doc: OpenDocument, header: HTMLElement, footer: HTMLElement): void;
}
export let extensions: Extensions = {};
export const extend = (added: Extensions) => { extensions = added; };
