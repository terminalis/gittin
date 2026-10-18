import { beforeEach, expect, test, vi } from 'vitest';
import type { FileHandle } from '../../src/sources/handle';
import type { DraftRecord } from '../../src/documents/drafts';
import { fakeDirectory } from './fake-directory';

/** IndexedDB stand-in: each store holds rows by id, and requests answer once the transaction's work has run. */
const memory = vi.hoisted(() => {
  const stores = new Map<string, Map<string, { id: string }>>();
  const store = (name: string) => stores.get(name) ?? stores.set(name, new Map()).get(name)!;
  const all = (name: string) => ({ result: [...store(name).values()], onsuccess: undefined as undefined | (() => void) });
  return {
    stores,
    getAll: async (name: string) => [...store(name).values()],
    get: async (name: string, id: string) => store(name).get(id),
    change: async (_names: string[], work: (tx: unknown) => void) => {
      work({
        objectStore: (name: string) => ({
          put: (row: { id: string }) => store(name).set(row.id, row),
          delete: (id: string) => store(name).delete(id),
          getAll: () => { const request = all(name); queueMicrotask(() => request.onsuccess?.()); return request; },
        }),
      });
      await new Promise(resolve => setTimeout(resolve));
    },
  };
});
vi.mock('../../src/documents/database', () => ({ getAll: memory.getAll, get: memory.get, change: memory.change }));

let registry: typeof import('../../src/sources/registry');
let drafts: typeof import('../../src/documents/drafts');
beforeEach(async () => {
  memory.stores.clear();
  vi.resetModules();
  registry = await import('../../src/sources/registry');
  drafts = await import('../../src/documents/drafts');
});

const fileIn = async (folder: ReturnType<typeof fakeDirectory>, path: string): Promise<FileHandle> => {
  const parts = path.split('/'), name = parts.pop()!;
  let directory = folder.handle;
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  return directory.getFileHandle(name);
};

test('folderHolding finds a file in a remembered folder and names its path there', async () => {
  const project = fakeDirectory('project', { 'docs/a.md': 'A' });
  const folder = await registry.addFolder(project.handle);
  const held = await registry.folderHolding(await fileIn(project, 'docs/a.md'));
  expect(held?.source).toBe(folder);
  expect(held?.path).toBe('docs/a.md');
});
test('folderHolding makes a folder remembered from an earlier visit live, and only when it holds the file', async () => {
  const project = fakeDirectory('project', { 'a.md': 'A' });
  memory.stores.set('sources', new Map([['folder-1', { id: 'folder-1', kind: 'folder', label: 'project', locator: project.handle, lastOpened: 1 }]]));
  await registry.loadSources();
  expect(registry.openSource('folder-1')).toBeUndefined();
  expect(await registry.folderHolding(await fileIn(fakeDirectory('other', { 'a.md': 'A' }), 'a.md'))).toBeNull();
  expect(registry.openSource('folder-1')).toBeUndefined();
  const held = await registry.folderHolding(await fileIn(project, 'a.md'));
  expect(held?.source.id).toBe('folder-1');
  expect(registry.openSource('folder-1')).toBe(held?.source);
});
test('folderHolding skips a folder that would have to ask for permission', async () => {
  const project = fakeDirectory('project', { 'a.md': 'A' });
  const requestPermission = vi.fn(async () => 'granted' as PermissionState);
  await registry.addFolder({ ...project.handle, queryPermission: async () => 'prompt', requestPermission });
  expect(await registry.folderHolding(await fileIn(project, 'a.md'))).toBeNull();
  expect(requestPermission).not.toHaveBeenCalled();
});
test('folderHolding is null for a file outside every remembered folder', async () => {
  await registry.addFolder(fakeDirectory('project', { 'a.md': 'A' }).handle);
  expect(await registry.folderHolding(await fileIn(fakeDirectory('elsewhere', { 'a.md': 'A' }), 'a.md'))).toBeNull();
});

const stored = (id: string, sourceId: string, path: string): DraftRecord => ({
  id, identity: { kind: 'source', sourceId, path }, current: { source: id, revision: 0 }, title: path, fileType: 'markdown',
  favourite: false, localBaseline: null, lastOpened: 1, storageRevision: 3,
});
test('moveDraft can point a stored draft at a path in another source, and keeps the source otherwise', async () => {
  const documents = new Map<string, { id: string }>(
    [stored('one', 'file-1', 'a.md'), stored('two', 'file-2', 'a.md')].map(draft => [draft.id, draft]));
  memory.stores.set('documents', documents);
  await drafts.moveDraft('file-1', 'a.md', 'docs/a.md', 'folder-1');
  expect(await drafts.findDraft('file-1', 'a.md')).toBeNull();
  expect(await drafts.findDraft('folder-1', 'docs/a.md')).toMatchObject({
    id: 'one', title: 'a.md', storageRevision: 4, current: { source: 'one' },
  });
  expect(await drafts.findDraft('file-2', 'a.md')).toMatchObject({ id: 'two', storageRevision: 3 });
  await drafts.moveDraft('folder-1', 'docs/a.md', 'b.md');
  expect(await drafts.findDraft('folder-1', 'b.md')).toMatchObject({ id: 'one', storageRevision: 5 });
});
