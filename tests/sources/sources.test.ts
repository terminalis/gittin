import { expect, test } from 'vitest';
import { blobVersion } from '../../src/sources/version';
import { fragment, imageType, isWithin, relativePath, resolvePath } from '../../src/sources/paths';

const bytes = (text: string) => new TextEncoder().encode(text);

test('blob versions match Git', async () => {
  expect(await blobVersion(bytes(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  expect(await blobVersion(bytes('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
});

test('relative paths resolve against the document folder and never leave the root', () => {
  expect(resolvePath('docs/guide.md', 'img/a.png')).toBe('docs/img/a.png');
  expect(resolvePath('docs/guide.md', '../logo.svg')).toBe('logo.svg');
  expect(resolvePath('docs/guide.md', './a%20b.png?x#y')).toBe('docs/a b.png');
  expect(resolvePath('docs/guide.md', '/root.png')).toBe('root.png');
  expect(resolvePath('guide.md', '../outside.png')).toBeNull();
  expect(resolvePath('guide.md', 'https://example.com/a.png')).toBeNull();
  expect(resolvePath('guide.md', '//example.com/a.png')).toBeNull();
  expect(relativePath('docs/guide.md', 'docs/img/a.png')).toBe('img/a.png');
  expect(relativePath('docs/guide.md', 'logo.svg')).toBe('../logo.svg');
  expect(relativePath('guide.md', 'img/a.png')).toBe('img/a.png');
});
test('isWithin matches a path itself and anything under it, not lookalike siblings', () => {
  expect(isWithin('docs', 'docs')).toBe(true);
  expect(isWithin('docs/a.md', 'docs')).toBe(true);
  expect(isWithin('docs-old/a.md', 'docs')).toBe(false);
  expect(isWithin('a.md', 'docs')).toBe(false);
});

import { describe } from 'vitest';
import type { FileSource } from '../../src/sources/types';
import { FolderSource } from '../../src/sources/folder';
import { fakeDirectory } from './fake-directory';

const text = (value: Uint8Array) => new TextDecoder().decode(value);

/** Every source must pass this. `change` edits a file behind the source's back. */
export function describeFileSource(
  name: string,
  make: (files: Record<string, string>) => { source: FileSource; change(path: string, text: string): void }
) {
  describe(name, () => {
    test('lists one level, directories first, and reads with a version', async () => {
      const { source } = make({ 'b.md': 'B', 'a/x.md': 'X' });
      expect(await source.list('')).toEqual([
        { path: 'a', kind: 'directory' },
        { path: 'b.md', kind: 'file' },
      ]);
      expect(await source.list('a')).toEqual([{ path: 'a/x.md', kind: 'file' }]);
      const read = await source.read('a/x.md');
      expect(text(read.bytes)).toBe('X');
      expect(read.version).toBe(await blobVersion(bytes('X')));
    });
    test('writes when it says it is writable', async () => {
      const { source } = make({ 'a.md': 'A' });
      const { version } = await source.read('a.md');
      if (source.writable) expect((await source.write!('a.md', bytes('B'), version)).kind).toBe('written');
      else expect(source.write).toBeUndefined();
    });
  });
}

export function describeWritableSource(
  name: string,
  make: (files: Record<string, string>) =>
    { source: FolderSource; change(path: string, text: string): void; text(path: string): string | undefined }
) {
  describe(name + ' writes', () => {
    test('writes only when the expected version matches, and null overwrites', async () => {
      const { source, change, text: disk } = make({ 'a.md': 'one' });
      const { version } = await source.read('a.md');
      const written = await source.write('a.md', bytes('two'), version);
      expect(written).toEqual({ kind: 'written', version: await blobVersion(bytes('two')) });
      change('a.md', 'external');
      expect(await source.write('a.md', bytes('three'), version)).toEqual({ kind: 'conflict', version: await blobVersion(bytes('external')) });
      expect(disk('a.md')).toBe('external');
      expect((await source.write('a.md', bytes('forced'), null)).kind).toBe('written');
      expect(disk('a.md')).toBe('forced');
    });
    test('creates new files and reports existing ones', async () => {
      const { source, text: disk } = make({ 'a.md': 'A' });
      expect(await source.create('a.md', bytes('')))
        .toEqual({ kind: 'exists', existing: { path: 'a.md', kind: 'file' } });
      expect((await source.create('b.md', bytes('B'))).kind).toBe('created');
      expect(disk('b.md')).toBe('B');
    });
    test('a new file whose name differs only in case, from a file or folder, already exists', async () => {
      const { source, text: disk } = make({ 'notes.md': 'N', 'docs/a.md': 'A' });
      expect(await source.create('Notes.md', bytes('')))
        .toEqual({ kind: 'exists', existing: { path: 'notes.md', kind: 'file' } });
      expect(disk('notes.md')).toBe('N');
      expect(await source.create('Docs', bytes('')))
        .toEqual({ kind: 'exists', existing: { path: 'docs', kind: 'directory' } });
    });
  });
}

export function describeManagedSource(
  name: string,
  make: (files: Record<string, string>) => {
    source: FolderSource;
    text(path: string): string | undefined;
    kind(path: string): 'file' | 'directory' | undefined;
  }
) {
  describe(name + ' file management', () => {
    test('creates folders and reports names already in use', async () => {
      const { source, kind } = make({ 'a.md': 'A', 'docs/b.md': 'B' });
      expect(await source.createFolder('docs/img')).toBe('created');
      expect(kind('docs/img')).toBe('directory');
      expect(await source.createFolder('docs')).toBe('exists');
      expect(await source.createFolder('a.md')).toBe('exists');
    });
    test('renames and moves files, refusing a name already in use', async () => {
      const { source, text } = make({ 'a.md': 'A', 'b.md': 'B', 'docs/c.md': 'C', 'readme.md': 'R' });
      expect(await source.move('a.md', 'renamed.md')).toBe('moved');
      expect(text('renamed.md')).toBe('A');
      expect(text('a.md')).toBeUndefined();
      expect(await source.move('renamed.md', 'docs/renamed.md')).toBe('moved');
      expect(text('docs/renamed.md')).toBe('A');
      expect(await source.move('b.md', 'docs/c.md')).toBe('exists');
      expect(text('b.md')).toBe('B');
      expect(text('docs/c.md')).toBe('C');
      // File systems that ignore case would overwrite docs/c.md, so a differing case is still a clash.
      expect(await source.move('b.md', 'docs/C.md')).toBe('exists');
      expect(text('b.md')).toBe('B');
      expect(text('docs/c.md')).toBe('C');
      // A case-only rename of the file itself is not a clash.
      expect(await source.move('readme.md', 'README.md')).toBe('moved');
      expect(text('README.md')).toBe('R');
    });
    test('deletes a file, or a folder and everything in it', async () => {
      const { source, text, kind } = make({ 'a.md': 'A', 'docs/b.md': 'B', 'docs/img/c.png': 'C' });
      await source.remove('a.md');
      expect(text('a.md')).toBeUndefined();
      await source.remove('docs');
      expect(kind('docs')).toBeUndefined();
      expect(await source.list('')).toEqual([]);
    });
  });
}

const folder = (files: Record<string, string>) => {
  const fake = fakeDirectory('project', files);
  return { source: new FolderSource('folder-1', fake.handle), change: fake.put, text: fake.text, kind: fake.kind };
};
describeFileSource('FolderSource', folder);
describeWritableSource('FolderSource', folder);
describeManagedSource('FolderSource', folder);

import { ReadOnlyFolderSource } from '../../src/sources/readonly-folder';
import { SingleFileSource } from '../../src/sources/single-file';

// Browsers set webkitRelativePath on folder-input files; node's File does not, so define it.
const folderFile = (path: string, text: string) =>
  Object.defineProperty(new File([text], path.split('/').pop()!), 'webkitRelativePath', { value: path });
describeFileSource('ReadOnlyFolderSource', files => ({
  source: new ReadOnlyFolderSource('ro-1', Object.entries(files).map(([path, text]) => folderFile('project/' + path, text))),
  change: () => {},
}));
test('ReadOnlyFolderSource takes its label from the folder name', () => {
  expect(new ReadOnlyFolderSource('ro-2', [folderFile('notes/a.md', 'A')]).label).toBe('notes');
});

const single = (files: Record<string, string>) => {
  const fake = fakeDirectory('outside', files);
  const [path] = Object.keys(files);
  // Look the file up on every call: `change` replaces the stored file, as an external edit would.
  return {
    source: new SingleFileSource('file-1', {
      handle: {
        name: path,
        getFile: async () => (await fake.handle.getFileHandle(path)).getFile(),
        createWritable: async () => (await fake.handle.getFileHandle(path)).createWritable(),
      },
    }),
    change: fake.put,
    text: fake.text,
  };
};
test('SingleFileSource lists and reads its one file', async () => {
  const { source } = single({ 'a.md': 'A' });
  expect(await source.list('')).toEqual([{ path: 'a.md', kind: 'file' }]);
  expect(text((await source.read('a.md')).bytes)).toBe('A');
  expect(source.writable).toBe(true);
});
test('SingleFileSource writes with the version check', async () => {
  const { source, change, text: disk } = single({ 'a.md': 'one' });
  const { version } = await source.read('a.md');
  expect((await source.write('a.md', bytes('two'), version)).kind).toBe('written');
  change('a.md', 'external');
  expect((await source.write('a.md', bytes('three'), version)).kind).toBe('conflict');
  expect(disk('a.md')).toBe('external');
});
test('SingleFileSource without a handle is read only', async () => {
  const source = new SingleFileSource('file-2', { file: new File(['A'], 'a.md') });
  expect(source.writable).toBe(false);
  expect(text((await source.read('a.md')).bytes)).toBe('A');
  await expect(source.write('a.md', bytes('B'), null)).rejects.toThrow(/Save as/);
});

import { countFiles, findFiles, findFolders } from '../../src/sources/search';
test('file search skips .git and node_modules and reports its cap', async () => {
  const { source } = folder({ 'a/notes.md': '', '.git/notes.md': '', 'node_modules/x/notes.md': '', 'b.md': '', 'Notes.txt': '' });
  expect(await findFiles(source, 'notes')).toEqual({ paths: ['Notes.txt', 'a/notes.md'], limited: false });
  expect(await findFiles(source, 'notes', 1)).toEqual({ paths: [], limited: true });
});
test('countFiles counts everything under a folder, .git included', async () => {
  const { source } = folder({ 'docs/a.md': '', 'docs/.git/HEAD': '', 'docs/img/b.png': '', 'c.md': '' });
  expect(await countFiles(source, 'docs')).toBe(3);
});
test('findFolders lists the root first, then folders breadth first, skipping .git and node_modules', async () => {
  const { source } = folder({ 'docs/img/a.png': '', 'notes/b.md': '', '.git/HEAD': '', 'node_modules/x/y.js': '' });
  expect(await findFolders(source)).toEqual(['', 'docs', 'notes', 'docs/img']);
});

import { pruneVersions, type VersionMeta } from '../../src/documents/versions';
const meta = (key: string, savedAt: number, size: number): VersionMeta =>
  ({ id: key + savedAt, key, kind: 'saved', savedAt, version: 'v' + savedAt, size });
test('versions keep 20 per file, then the oldest go until the total fits the budget', () => {
  const many = Array.from({ length: 22 }, (_, i) => meta('a', i, 1));
  expect(pruneVersions(many, 20, 1000).map(v => v.savedAt)).toEqual([0, 1]);
  const big = [meta('a', 1, 40), meta('b', 2, 40), meta('a', 3, 40)];
  expect(pruneVersions(big, 20, 100).map(v => v.id)).toEqual(['a1']);
});
test('fragment returns what follows # in a reference, or nothing', () => {
  expect(fragment('setup.md#install')).toBe('install');
  expect(fragment('setup.md?x=1#caf%C3%A9')).toBe('caf%C3%A9');
  expect(fragment('setup.md')).toBe('');
});
test('imageType names known image extensions only, whatever their case', () => {
  expect(imageType('docs/Logo.SVG')).toBe('image/svg+xml');
  expect(imageType('a/b.png')).toBe('image/png');
  expect(imageType('page.html')).toBeUndefined();
  expect(imageType('notes')).toBeUndefined();
  // Names an object already has are not extensions.
  expect(imageType('x.constructor')).toBeUndefined();
  expect(imageType('x.__proto__')).toBeUndefined();
});
