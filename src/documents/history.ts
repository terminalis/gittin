import type { Bookmark, EditKind, Snapshot } from './types';
export type HistoryOptions = { maxGroups?: number; maxBytes?: number; now?: () => number };
export class SourceHistory {
  private states: Snapshot[];
  private cursor = 0;
  private group?: { kind: EditKind; mode: Bookmark['mode']; time: number; direction: number };
  constructor(
    initial: Snapshot,
    private options: HistoryOptions = {}
  ) {
    this.states = [initial];
  }
  get current() {
    return this.states[this.cursor];
  }
  get stats() {
    return {
      undoGroups: this.cursor,
      redoGroups: this.states.length - this.cursor - 1,
      payloadBytes: this.states.reduce(
        (n, s, i) => n + (i === this.cursor ? 0 : s.source.length * 2),
        0
      ),
    };
  }
  endGroup() {
    this.group = undefined;
  }
  bookmark(selection: Bookmark) {
    const old = this.current.selection;
    if (
      old.mode !== selection.mode ||
      old.anchor !== selection.anchor ||
      old.head !== selection.head
    )
      this.endGroup();
    this.current.selection = { ...selection };
  }
  push(next: Snapshot, kind: EditKind) {
    if (next.source === this.current.source) return false;
    const time = (this.options.now ?? Date.now)();
    const direction = Math.sign(
      next.selection.sourceAnchor - this.current.selection.sourceAnchor
    );
    const groupable = kind === 'typing' || kind === 'delete';
    const join =
      this.cursor === this.states.length - 1 &&
      groupable &&
      this.group?.kind === kind &&
      this.group.mode === next.selection.mode &&
      this.group.direction === direction &&
      time - this.group.time < 500;
    this.states.length = this.cursor + 1;
    if (join) this.states[this.cursor] = next;
    else {
      this.states.push(next);
      this.cursor++;
    }
    this.group = groupable ? { kind, mode: next.selection.mode, time, direction } : undefined;
    this.trim();
    return true;
  }
  private trim() {
    // The excluded current payload changes when moving the cursor too. Keep the
    // most recent complete undo step even if its predecessor is oversized.
    // Older undo states go first, then farthest redo; never remove that predecessor.
    while (
      this.states.length > 2 &&
      (this.states.length - 1 > (this.options.maxGroups ?? 100) ||
        this.stats.payloadBytes > (this.options.maxBytes ?? 16 * 1024 * 1024))
    ) {
      if (this.cursor > 1) {
        this.states.shift();
        this.cursor--;
      } else this.states.pop();
    }
  }
  move(direction: -1 | 1) {
    this.endGroup();
    const next = this.cursor + direction;
    if (next < 0 || next >= this.states.length) return false;
    this.cursor = next;
    this.trim();
    return true;
  }
}
