import { DocumentSession } from '../../src/documents/session';
const mark = (n: number, mode: 'preview' | 'markdown' = 'markdown') => ({
  mode,
  anchor: n,
  head: n,
  sourceAnchor: n,
  scrollTop: 21,
});
it('one timeline across views, stable redo and branching', () => {
  const s = new DocumentSession('A');
  for (const [i, text] of ['AB', 'ABC', 'ABCD'].entries())
    s.applyWriteSource(text, 'command', mark(i + 2, i % 2 ? 'preview' : 'markdown'));
  for (const text of ['ABC', 'AB', 'A']) {
    expect(s.undo()).toBe(true);
    expect(s.current.source).toBe(text);
    s.endGroup();
  }
  for (const text of ['AB', 'ABC', 'ABCD']) {
    expect(s.redo()).toBe(true);
    expect(s.current.source).toBe(text);
  }
  s.undo();
  s.applyWriteSource('ABCX', 'typing', mark(4));
  expect(s.redo()).toBe(false);
});
it('typing idle, relocation and paste boundaries restore bookmarks', () => {
  let time = 0;
  const s = new DocumentSession('A', { now: () => time });
  s.setBookmark(mark(1));
  s.applyWriteSource('AB', 'typing', mark(2));
  time = 100;
  s.setBookmark(mark(2));
  s.applyWriteSource('ABC', 'typing', mark(3));
  time = 601;
  s.applyWriteSource('ABCD', 'typing', mark(4));
  s.undo();
  expect(s.current.source).toBe('ABC');
  s.undo();
  expect(s.current.source).toBe('A');
  s.redo();
  expect(s.bookmark).toEqual(mark(3));
  s.setBookmark(mark(0));
  s.applyWriteSource('XABC', 'typing', mark(1));
  s.applyWriteSource('paste', 'paste', mark(5));
  s.undo();
  expect(s.current.source).toBe('XABC');
  s.undo();
  expect(s.current.source).toBe('ABC');
});
it('composition commits once without temporary revisions', () => {
  const s = new DocumentSession('A');
  s.beginComposition();
  s.applyWriteSource('Ax', 'composition', mark(2));
  s.applyWriteSource('A漢', 'composition', mark(2));
  expect(s.current.source).toBe('A');
  s.endComposition();
  expect(s.current.source).toBe('A漢');
  expect(s.current.revision).toBe(1);
  s.undo();
  expect(s.current.source).toBe('A');
});
it('budgets retain latest complete oversized step and cap groups', () => {
  const s = new DocumentSession('a'.repeat(100), { maxBytes: 20, maxGroups: 2 });
  s.applyWriteSource('b'.repeat(100), 'paste', mark(1));
  s.applyWriteSource('c', 'replace', mark(1));
  expect(s.historyStats.undoGroups).toBe(1);
  expect(s.historyStats.payloadBytes).toBe(200);
  s.undo();
  expect(s.current.source).toBe('b'.repeat(100));
  expect(s.undo()).toBe(false);
  const t = new DocumentSession('0', { maxGroups: 2 });
  for (const v of ['1', '2', '3']) t.applyWriteSource(v, 'command', mark(1));
  expect(t.historyStats.undoGroups).toBe(2);
});

it('undoing an oversized current source preserves the last undo target and trims its redo', () => {
  const s = new DocumentSession('a', { maxBytes: 20 });
  s.applyWriteSource('bb', 'command', mark(2));
  s.applyWriteSource('x'.repeat(100), 'command', mark(100));
  expect(s.historyStats.payloadBytes).toBe(6);
  s.undo();
  expect(s.current.source).toBe('bb');
  expect(s.historyStats).toEqual({ undoGroups: 1, redoGroups: 0, payloadBytes: 2 });
  expect(s.redo()).toBe(false);
  expect(s.undo()).toBe(true);
  expect(s.current.source).toBe('a');
  expect(s.redo()).toBe(true);
  expect(s.current.source).toBe('bb');
});
it('deletions in opposite selection directions end a typing group', () => {
  const s = new DocumentSession('abcd');
  s.setBookmark(mark(4));
  s.applyWriteSource('abc', 'delete', mark(3));
  s.applyWriteSource('ab', 'delete', mark(2));
  s.setBookmark(mark(0));
  s.applyWriteSource('b', 'delete', mark(0));
  s.undo();
  expect(s.current.source).toBe('ab');
  s.undo();
  expect(s.current.source).toBe('abcd');
});
