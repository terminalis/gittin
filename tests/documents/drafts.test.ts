import { afterEach, expect, test, vi } from 'vitest';
import {
  DraftAutosave,
  type SaveResult,
  type DraftRecord,
} from '../../src/documents/drafts';
import { DocumentSession } from '../../src/documents/session';
import { decodeSource } from '../../src/editor/source-projection';
import { locationText, recentFolder, saveState } from '../../src/documents/save-state';
afterEach(() => vi.useRealTimers());
const edit = (s: DocumentSession, text: string) =>
  s.applyWriteSource(text, 'typing', s.bookmark);
/** A new draft's metadata, before it was first stored. */
const draft = {
  title: 'a.md',
  fileType: 'markdown',
  favourite: false,
  localBaseline: null,
  storageRevision: 0,
} as const;
test('revision 4 acknowledgement cannot mark revision 5 saved; pending writes coalesce and serialize', async () => {
  const s = new DocumentSession('0');
  const pending: {
    record: DraftRecord;
    expected: number;
    done: (r: SaveResult) => void;
  }[] = [];
  const a = new DraftAutosave(
    s,
    draft,
    (record, expected) => new Promise((done) => pending.push({ record, expected, done }))
  );
  for (const text of ['1', '2', '3', '4']) edit(s, text);
  const flushing = a.flush();
  expect(pending[0].record.current).toEqual({ revision: 4, source: '4' });
  edit(s, '5');
  pending[0].done({ kind: 'saved', storageRevision: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(a.status.kind).not.toBe('saved');
  expect(pending).toHaveLength(2);
  expect(pending[1].expected).toBe(1);
  expect(pending[1].record.current).toEqual({ revision: 5, source: '5' });
  pending[1].done({ kind: 'saved', storageRevision: 2 });
  expect(await flushing).toBe(true);
  expect(a.status).toMatchObject({ kind: 'saved', revision: 5 });
  a.dispose();
});
test('initial unedited source saves; accepted changes debounce at 500ms with a 2s maximum', async () => {
  vi.useFakeTimers();
  const s = new DocumentSession('initial'),
    sources: string[] = [];
  const a = new DraftAutosave(s, draft, async (record) => {
    sources.push(record.current.source);
    return { kind: 'saved', storageRevision: sources.length };
  });
  await vi.advanceTimersByTimeAsync(499);
  expect(sources).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(sources).toEqual(['initial']);
  for (let i = 0; i < 6; i++) {
    edit(s, String(i));
    await vi.advanceTimersByTimeAsync(350);
  }
  expect(sources).toEqual(['initial', '5']);
  a.dispose();
});
test('a failed save retains work and retries; provisional composition is never scheduled', async () => {
  vi.useFakeTimers();
  const s = new DocumentSession('base');
  let fail = true;
  const a = new DraftAutosave(s, draft, async () =>
    fail
      ? { kind: 'error', message: 'Quota exceeded' }
      : { kind: 'saved', storageRevision: 1 }
  );
  s.beginComposition();
  edit(s, 'candidate');
  await vi.advanceTimersByTimeAsync(500);
  expect(s.current.source).toBe('base');
  expect(a.status).toMatchObject({ kind: 'error', message: 'Quota exceeded' });
  s.endComposition();
  expect(s.current.source).toBe('candidate');
  fail = false;
  expect(await a.flush()).toBe(true);
  expect(a.status).toMatchObject({ kind: 'saved', revision: 1 });
  a.dispose();
});
test('stale conflict stops writes and retains both versions for explicit recovery', async () => {
  const s = new DocumentSession('mine');
  const newer = {
    id: s.id,
    identity: s.identity,
    title: 'a.md',
    fileType: 'markdown' as const,
    favourite: false,
    localBaseline: null,
    current: { source: 'theirs', revision: 8 },
    lastOpened: 1,
    storageRevision: 4,
  };
  const a = new DraftAutosave(s, draft, async () => ({
    kind: 'conflict',
    stored: newer,
  }));
  expect(await a.flush()).toBe(false);
  expect(a.status).toMatchObject({ kind: 'conflict', stored: newer });
  expect(s.current.source).toBe('mine');
  a.dispose();
});
test('valid UTF-8 retains BOM/mixed newlines and invalid UTF-8 is rejected', () => {
  expect(decodeSource(new Uint8Array([239, 187, 191, 65, 13, 10, 66, 10]))).toBe('\ufeffA\r\nB\n');
  expect(() => decodeSource(new Uint8Array([255]))).toThrow(/UTF-8/);
});
test('recovery preserves the stored content revision with a fresh undo history', async () => {
  const session = new DocumentSession('recovered', { revision: 7 });
  expect(session.current).toEqual({ source: 'recovered', revision: 7 });
  expect(session.undo()).toBe(false);
  edit(session, 'next');
  expect(session.current).toEqual({ source: 'next', revision: 8 });
});
test('a document keeps its id when its identity moves to a file', () => {
  const s = new DocumentSession('text', { id: 'doc-1', identity: { kind: 'local', id: 'doc-1' } });
  s.identity = { kind: 'source', sourceId: 'folder-1', path: 'notes/a.md' };
  expect(s.id).toBe('doc-1');
  expect(new DocumentSession('x', { identity: { kind: 'source', sourceId: 'f', path: 'a.md' } }).id).toMatch(/^[0-9a-f-]{36}$/);
});
test('save state says whether a file is saved, unsaved, read-only or only in this browser', () => {
  const current = { source: 'a', revision: 2 };
  expect(saveState({ kind: 'local', id: 'x' }, current, null, undefined)).toBe('Only in this browser');
  const identity = { kind: 'source', sourceId: 'f', path: 'a.md' } as const;
  expect(saveState(identity, current, { source: 'a', revision: 1, version: 'v' }, { kind: 'folder', label: 'project', open: true })).toBe('Saved');
  expect(saveState(identity, current, { source: 'b', revision: 1, version: 'v' }, { kind: 'folder', label: 'project', open: true })).toBe('Unsaved changes (kept in this browser)');
  expect(saveState(identity, current, null, { kind: 'folder-readonly', label: 'project', open: true })).toBe('Read-only folder: Save downloads a copy');
  expect(saveState(identity, current, null, { kind: 'folder-readonly', label: 'project', open: false })).toBe('Only in this browser (from project)');
});
test('location names the folder; a single file was opened on its own', () => {
  expect(locationText({ kind: 'local', id: 'x' }, undefined)).toBe('Only in this browser');
  expect(locationText({ kind: 'source', sourceId: 'f', path: 'notes/a.md' }, { kind: 'folder', label: 'project', open: true })).toBe('In project › notes/a.md');
  expect(locationText({ kind: 'source', sourceId: 'f', path: 'a.md' }, { kind: 'file', label: 'a.md', open: true })).toBe('Opened on its own');
});
test('Home names the folder under a recent file without repeating the file name', () => {
  expect(recentFolder({ kind: 'local', id: 'x' }, undefined)).toBe('');
  expect(recentFolder({ kind: 'source', sourceId: 'f', path: 'a.md' }, { kind: 'folder', label: 'project', open: true })).toBe('project');
  expect(recentFolder({ kind: 'source', sourceId: 'f', path: 'notes/a.md' }, { kind: 'folder', label: 'project', open: true })).toBe('project › notes');
  expect(recentFolder({ kind: 'source', sourceId: 'f', path: 'notes/a.md' }, { kind: 'folder', label: 'project', open: false })).toBe('Folder unavailable: project › notes');
  expect(recentFolder({ kind: 'source', sourceId: 'f', path: 'a.md' }, { kind: 'file', label: 'a.md', open: true })).toBe('Opened on its own');
});
