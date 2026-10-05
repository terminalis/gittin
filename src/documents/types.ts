export type Mode = 'preview' | 'markdown' | 'diff';
export type Theme = 'light' | 'dark' | 'system';
type DocumentId = string;
type Revision = number;
export type Identity =
  | { kind: 'local'; id: string }
  | { kind: 'source'; sourceId: string; path: string };
export type SourceEdit = { from: number; to: number; insert: string };
export type Bookmark = {
  mode: Mode;
  anchor: number;
  head: number;
  sourceAnchor: number;
  scrollTop: number;
};
export type EditKind = 'typing' | 'delete' | 'composition' | 'paste' | 'command' | 'replace';
export type Snapshot = { source: string; selection: Bookmark };
export type SourceVersion = { revision: Revision; source: string };
/** The file on disk as of the last open or save; `version` is its Git blob SHA. */
export type SavedBaseline = SourceVersion & { version?: string };
export interface DocumentSession {
  id: DocumentId;
  identity: Identity;
  current: SourceVersion;
  undo(): boolean;
  redo(): boolean;
  applySourceEdit(edit: SourceEdit, kind: EditKind, selection: Bookmark): void;
  applyWriteSource(source: string, kind: EditKind, selection: Bookmark): void;
  readonly historyStats: { undoGroups: number; redoGroups: number };
  readonly bookmark: Bookmark;
  setBookmark(selection: Bookmark): void;
  endGroup(): void;
  beginComposition(): void;
  endComposition(): void;
  cancelComposition(): void;
  subscribe(listener: (version: SourceVersion) => void): () => void;
}
export type SyntaxIssue = { from: number; to: number; reason: string };
export type WriteEligibility = { editable: true } | { editable: false; issues: SyntaxIssue[] };
