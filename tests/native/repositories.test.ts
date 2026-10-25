import { expect, test } from 'vitest';
import { addFile, addFolder } from '../../src/sources/registry';
import { DesktopDirectoryHandle, DesktopFileHandle, diskPath, fileFolder, folderLine } from '../../src/native/files';
import { useGit, type Git } from '../../src/native/git';
import { placeOf } from '../../src/native/repositories';

/** A stand-in git whose only repositories are `found` inside every folder. */
const repositories = (found: string[]) => useGit({ repositories: async () => found } as unknown as Git);

test('a file in a repository folder, or in a repository directly inside the folder, has a place', async () => {
  const source = await addFolder(new DesktopDirectoryHandle('C:\\work'));
  repositories(['']);
  expect(await placeOf(source, 'notes/a.md')).toEqual({ root: 'C:\\work', name: 'work', path: 'notes/a.md' });
  repositories(['notes']);
  expect(await placeOf(source, 'notes/a.md')).toEqual({ root: 'C:\\work\\notes', name: 'notes', path: 'a.md' });
  expect(await placeOf(source, 'readme.md')).toBeNull();
  expect(await placeOf(source, 'notes')).toBeNull();
  repositories([]);
  expect(await placeOf(source, 'notes/a.md')).toBeNull();
  repositories(['', 'notes']);
  expect(await placeOf(source, 'notes/a.md')).toEqual({ root: 'C:\\work\\notes', name: 'notes', path: 'a.md' });
  expect(await placeOf(source, 'readme.md')).toEqual({ root: 'C:\\work', name: 'work', path: 'readme.md' });
});

test('a file opened on its own has no place', async () => {
  repositories(['']);
  const source = await addFile({ handle: new DesktopFileHandle('C:\\loose\\a.md') });
  expect(await placeOf(source, 'a.md')).toBeNull();
});

test("a file's full path on disk joins its folder's path with the folder's own separator", async () => {
  const folder = await addFolder(new DesktopDirectoryHandle('C:\\work'));
  expect(diskPath({ kind: 'source', sourceId: folder.id, path: 'notes/a.md' })).toBe('C:\\work\\notes\\a.md');
  const loose = await addFile({ handle: new DesktopFileHandle('C:\\loose\\a.md') });
  expect(diskPath({ kind: 'source', sourceId: loose.id, path: 'a.md' })).toBe('C:\\loose\\a.md');
  expect(diskPath({ kind: 'local', id: 'x' })).toBeNull();
});

test("Home names a file opened on its own by its folder, from the user folder when it's inside it", async () => {
  const home = 'C:\\Users\\sam';
  expect(folderLine(home, 'C:\\Users\\sam\\Documents\\notes\\a.md')).toBe('Documents › notes');
  expect(folderLine(home, 'c:\\users\\SAM\\Documents\\a.md')).toBe('Documents');
  expect(folderLine(home, 'C:\\Users\\sam\\a.md')).toBe('sam');
  expect(folderLine(home, 'D:\\Projects\\a.md')).toBe('D: › Projects');
  expect(folderLine(home, 'C:\\Users\\samantha\\a.md')).toBe('C: › Users › samantha');
  expect(folderLine('/home/sam', '/home/sam/notes/a.md')).toBe('notes');
  expect(folderLine('/home/sam', '/mnt/data/a.md')).toBe('mnt › data');
  const loose = await addFile({ handle: new DesktopFileHandle('C:\\Users\\sam\\Documents\\b.md') });
  expect(fileFolder(home, { kind: 'source', sourceId: loose.id, path: 'b.md' })).toBe('Documents');
  const folder = await addFolder(new DesktopDirectoryHandle('C:\\work'));
  expect(fileFolder(home, { kind: 'source', sourceId: folder.id, path: 'b.md' })).toBe('');
  expect(fileFolder(home, { kind: 'source', sourceId: 'forgotten', path: 'b.md' })).toBe('');
  expect(fileFolder(home, { kind: 'local', id: 'x' })).toBe('');
});
