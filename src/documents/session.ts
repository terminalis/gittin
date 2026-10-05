import type {
  Bookmark,
  EditKind,
  Identity,
  SourceEdit,
  SourceVersion,
  Snapshot,
  DocumentSession as Session,
} from './types';
import { SourceHistory, type HistoryOptions } from './history';
import { signal } from '../signal';
const initialBookmark: Bookmark = { mode: 'markdown', anchor: 1, head: 1, sourceAnchor: 0, scrollTop: 0 };
export class DocumentSession implements Session {
  readonly id: string;
  identity: Identity;
  current: SourceVersion;
  private history: SourceHistory;
  private changed = signal<SourceVersion>();
  private composing = false;
  private pending?: Snapshot;
  constructor(
    source = '',
    options: HistoryOptions & { id?: string; identity?: Identity; revision?: number } = {}
  ) {
    this.identity = options.identity ?? { kind: 'local', id: options.id ?? crypto.randomUUID() };
    this.id = options.id ?? (this.identity.kind === 'local' ? this.identity.id : crypto.randomUUID());
    this.current = { source, revision: options.revision ?? 0 };
    this.history = new SourceHistory({ source, selection: { ...initialBookmark } }, options);
  }
  get bookmark() {
    return this.history.current.selection;
  }
  get historyStats() {
    return this.history.stats;
  }
  setBookmark(selection: Bookmark) {
    if (!this.composing) this.history.bookmark(selection);
  }
  endGroup() {
    this.history.endGroup();
  }
  beginComposition() {
    this.endGroup();
    this.composing = true;
  }
  cancelComposition() {
    this.composing = false;
    this.pending = undefined;
    this.endGroup();
  }
  endComposition() {
    this.composing = false;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) this.applyWriteSource(pending.source, 'composition', pending.selection);
    this.endGroup();
  }
  private publish() {
    this.current = { revision: this.current.revision + 1, source: this.history.current.source };
    this.changed.emit(this.current);
  }
  undo() {
    if (this.composing || !this.history.move(-1)) return false;
    this.publish();
    return true;
  }
  redo() {
    if (this.composing || !this.history.move(1)) return false;
    this.publish();
    return true;
  }
  applySourceEdit(edit: SourceEdit, kind: EditKind, selection: Bookmark) {
    const source = this.pending?.source ?? this.current.source;
    if (
      !Number.isInteger(edit.from) ||
      !Number.isInteger(edit.to) ||
      edit.from < 0 ||
      edit.to < edit.from ||
      edit.to > source.length
    )
      throw Error('Invalid source range');
    this.applyWriteSource(
      source.slice(0, edit.from) + edit.insert + source.slice(edit.to),
      kind,
      selection
    );
  }
  applyWriteSource(source: string, kind: EditKind, selection: Bookmark) {
    const next = { source, selection: { ...selection } };
    if (this.composing) {
      this.pending = next;
      return;
    }
    if (this.history.push(next, kind)) this.publish();
  }
  subscribe(listener: (version: SourceVersion) => void) {
    return this.changed.on(listener);
  }
}
