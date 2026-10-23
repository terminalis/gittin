import { beforeEach, expect, test, vi } from 'vitest';
import type { OpenDocument } from '../../src/screens/workspace';
import { addFile, addFolder } from '../../src/sources/registry';
import type { FolderSource } from '../../src/sources/folder';
import { DesktopDirectoryHandle, DesktopFileHandle } from '../../src/native/files';
import { useGit, type Git, type Outcome } from '../../src/native/git';
import { changed, outcomeText, saveAll, useDialogs } from '../../src/native/save';
import type { SaveAnswer, SaveGroup } from '../../src/native/save-dialog';

let work: FolderSource, loose: string;
const commits: [string, string[], string][] = [];
let outcomes: Outcome[] = [];
const doc = (sourceId: string, path: string, before: string, after: string) => ({
  title: path, session: { id: path, identity: { kind: 'source', sourceId, path }, current: { source: after, revision: 1 } },
  localBaseline: { source: before, revision: 0 },
}) as unknown as OpenDocument;
const tools = (written = true) => ({ write: vi.fn(async () => written), report: vi.fn() });
let shown: SaveGroup[][] = [];
const answer = (value: (groups: SaveGroup[]) => SaveAnswer) =>
  useDialogs({ save: async groups => { shown.push(groups); return value(groups); }, author: async () => ({ name: 'Asked', email: 'asked@example.com' }) });

beforeEach(async () => {
  work = await addFolder(new DesktopDirectoryHandle('/work'));
  loose = (await addFile({ handle: new DesktopFileHandle('/loose/b.md') })).id;
  commits.length = 0;
  shown = [];
  outcomes = [];
  useGit({
    repositories: async (folder: string) => (folder === '/work' ? [''] : []),
    commit: async (root: string, paths: string[], message: string) => {
      commits.push([root, paths, message]);
      return outcomes.shift() ?? { kind: 'committed', hooks: false, leftOut: [] };
    },
  } as unknown as Git);
});

test('saving a file outside any repository is left to Gittin', async () => {
  answer(() => 'cancel');
  expect(await saveAll([doc(loose, 'b.md', 'a', 'b')], 'save', tools())).toBeNull();
  expect(shown).toEqual([]);
});

test('saving a repository file writes it and commits it with the message from the dialog', async () => {
  answer(groups => new Map([[groups[0].place!.root, 'My words']]));
  const t = tools();
  const notes = doc(work.id, 'notes.md', '# Intro\nold\n', '# Intro\nnew\n');
  expect(await saveAll([notes], 'save', t)).toBe('saved');
  expect(shown[0][0].message).toBe('Edit Intro in notes.md');
  expect(t.write).toHaveBeenCalledWith(notes);
  expect(commits).toEqual([['/work', ['notes.md'], 'My words']]);
  expect(t.report).toHaveBeenCalledWith(notes, 'Saved and committed to work.');
});

test('an emptied message falls back to the described one, and added images go with the next save', async () => {
  await changed(work, { kind: 'create', path: 'img/a.png' });
  answer(groups => new Map([[groups[0].place!.root, '']]));
  await saveAll([doc(work.id, 'notes.md', 'x\n', 'y\n')], 'save', tools());
  expect(commits).toEqual([['/work', ['notes.md', 'img/a.png'], 'Edit notes.md; add img/a.png']]);
});

test('when git has no author, Gittin asks once and commits again with the answer', async () => {
  outcomes = [{ kind: 'refused', reason: 'identity' }];
  answer(groups => new Map([[groups[0].place!.root, 'Edit']]));
  const t = tools();
  await saveAll([doc(work.id, 'notes.md', 'x', 'y')], 'save', t);
  expect(commits).toHaveLength(2);
  expect(t.report).toHaveBeenCalledWith(expect.anything(), 'Saved and committed to work.');
});

test('quitting asks about repository and other files together; Don\'t save writes nothing', async () => {
  answer(() => 'discard');
  const t = tools();
  const result = await saveAll([doc(loose, 'b.md', 'a', 'b'), doc(work.id, 'notes.md', 'x', 'y')], 'quit', t);
  expect(result).toBe('discarded');
  expect(shown[0].map(group => group.place?.name ?? 'Other files')).toEqual(['work', 'Other files']);
  expect(t.write).not.toHaveBeenCalled();
});

test('a file that could not be written is not committed, and the save counts as cancelled', async () => {
  answer(groups => new Map([[groups[0].place!.root, 'Edit']]));
  expect(await saveAll([doc(work.id, 'notes.md', 'x', 'y')], 'save', tools(false))).toBe('cancelled');
  expect(commits).toEqual([]);
});

test('renames and deletions in a repository commit at once', async () => {
  await changed(work, { kind: 'move', from: 'a.md', to: 'b.md' });
  await changed(work, { kind: 'move', from: 'b.md', to: 'old/b.md' });
  await changed(work, { kind: 'delete', path: 'old/b.md' });
  expect(commits).toEqual([
    ['/work', ['a.md', 'b.md'], 'Rename a.md to b.md'],
    ['/work', ['b.md', 'old/b.md'], 'Move b.md to old/b.md'],
    ['/work', ['old/b.md'], 'Delete old/b.md'],
  ]);
});

test('a file saved for the first time commits at once', async () => {
  await changed(work, { kind: 'add', path: 'new.md' });
  expect(commits).toEqual([['/work', ['new.md'], 'Add new.md']]);
});

test('an image waiting for its document\'s save stays out of a rename and goes with the next save', async () => {
  await changed(work, { kind: 'create', path: 'img/a.png' });
  await changed(work, { kind: 'move', from: 'a.md', to: 'b.md' });
  expect(commits).toEqual([['/work', ['a.md', 'b.md'], 'Rename a.md to b.md']]);
  answer(groups => new Map([[groups[0].place!.root, 'Edit']]));
  await saveAll([doc(work.id, 'notes.md', 'x', 'y')], 'save', tools());
  expect(commits[1]).toEqual(['/work', ['notes.md', 'img/a.png'], 'Edit']);
});

test('a move out of a repository commits the removal there', async () => {
  const both = await addFolder(new DesktopDirectoryHandle('/both'));
  useGit({
    repositories: async () => ['notes'],
    commit: async (root: string, paths: string[], message: string) => {
      commits.push([root, paths, message]);
      return { kind: 'committed', hooks: false, leftOut: [] };
    },
  } as unknown as Git);
  await changed(both, { kind: 'move', from: 'notes/a.md', to: 'plain/a.md' });
  expect(commits).toEqual([['/both/notes', ['a.md'], 'Delete a.md']]);
});

test('the outcome says what happened', () => {
  const place = { root: '/work', name: 'work', path: 'a.md' };
  expect(outcomeText(place, { kind: 'committed', hooks: true, leftOut: [{ path: 'a.png', reason: 'lfs' }] }))
    .toBe('Saved and committed to work. Its git hooks did not run. Not committed: a.png, stored in Git LFS; commit it with git.');
  expect(outcomeText(place, { kind: 'unchanged', leftOut: [] })).toBe('Saved. Nothing new to commit.');
  expect(outcomeText(place, { kind: 'unchanged', leftOut: [{ path: 'secret.md', reason: 'filter' }] }))
    .toBe('Saved. Nothing new to commit. Not committed: secret.md, which git converts as it commits; commit it with git.');
  expect(outcomeText(place, { kind: 'refused', reason: 'signs' }))
    .toBe("Saved, but not committed to work: it signs its commits, which Gittin can't do, so commit with git.");
});
