import { expect, test } from 'vitest';
import { DraftAutosave, type DraftRecord, type SaveResult } from '../../src/documents/drafts';
import { DocumentSession } from '../../src/documents/session';
import { fileTypes, fileTypeForName, fileName } from '../../src/documents/file-types';

/** A new draft's metadata, before it was first stored. */
const draft = (title: string) =>
  ({ title, fileType: 'markdown', favourite: false, localBaseline: null, storageRevision: 0 }) as const;

test('file types follow the name, and a file name adds the type extension to the title', () => {
  expect(fileTypes.map(t => t.id)).toHaveLength(8);
  expect(fileTypeForName('UPPER.YAML')).toBe('yaml');
  expect(fileName('Untitled file', 'typescript')).toBe('Untitled file.ts');
  expect(fileName('custom.xyz', 'unknown')).toBe('custom.xyz');
  expect(fileName('extensionless', 'unknown')).toBe('extensionless');
});

test('metadata changes racing autosave drain after older writes without losing source, baseline or revision', async () => {
  const session = new DocumentSession('opened');
  const pending: { record: DraftRecord; expected: number; done(result: SaveResult): void }[] = [];
  const autosave = new DraftAutosave(session, draft('Untitled file'),
    (record, expected) => new Promise(done => pending.push({ record, expected, done })));
  const flush = autosave.flush();
  const baseline = { revision: 0, source: 'opened' };
  const metadata = autosave.updateMetadata({ title: 'Renamed', fileType: 'javascript', favourite: true, localBaseline: baseline });
  session.applyWriteSource('later typing', 'typing', session.bookmark);
  pending[0].done({ kind: 'saved', storageRevision: 1 });
  await Promise.resolve(); await Promise.resolve();
  expect(pending[1].expected).toBe(1);
  expect(pending[1].record).toMatchObject({ title: 'Renamed', fileType: 'javascript', favourite: true, localBaseline: baseline, current: { revision: 1, source: 'later typing' } });
  pending[1].done({ kind: 'saved', storageRevision: 2 });
  expect(await flush).toBe(true); expect(await metadata).toBe(true);
  expect(autosave.status).toEqual({ kind: 'saved', revision: 1 });
  const restored = autosave.updateMetadata({ favourite: false });
  pending[2].done({ kind: 'saved', storageRevision: 3 });
  expect(await restored).toBe(true);
  expect(autosave.metadata).toMatchObject({ localBaseline: baseline, favourite: false });
  autosave.dispose();
});

test('metadata conflicts preserve the newer stored record and can never claim saved', async () => {
  const session = new DocumentSession('my draft');
  const stored: DraftRecord = {
    id: session.id, identity: session.identity, current: { revision: 9, source: 'newer' },
    title: 'Other window', fileType: 'text', favourite: true, localBaseline: null, lastOpened: 1, storageRevision: 4,
  };
  const autosave = new DraftAutosave(session, draft('Mine'), async () => ({ kind: 'conflict', stored }));
  expect(await autosave.updateMetadata({ title: 'Rename' })).toBe(false);
  expect(autosave.status).toMatchObject({ kind: 'conflict', stored });
  expect(session.current.source).toBe('my draft');
  autosave.dispose();
});
