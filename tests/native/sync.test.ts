// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { reshow, unsavedFiles } from '../../src/app';
import type { OpenDocument } from '../../src/screens/workspace';
import type { FolderSource } from '../../src/sources/folder';
import { addFolder } from '../../src/sources/registry';
import { DesktopDirectoryHandle } from '../../src/native/files';
import { useGit, type Git } from '../../src/native/git';
import { repoOfFolder } from '../../src/native/repositories';
import { committed, useDialogs } from '../../src/native/save';
import { sync, syncFooter } from '../../src/native/sync';
import { buttonNamed, noticeText, openDialog, useDom, useGitHubStand } from './stand-ins';

vi.mock('../../src/app', () => ({
  unsavedFiles: vi.fn(() => []),
  saveTools: { write: vi.fn(async () => true), report: vi.fn() },
  reshow: vi.fn(async () => {}),
  compareFile: vi.fn(async () => {}),
}));

let work: FolderSource;
const doc = (path: string) => ({
  title: path, session: { id: path, identity: { kind: 'source', sourceId: work.id, path }, current: { source: 'new', revision: 1 } },
  localBaseline: { source: 'old', revision: 0 },
}) as unknown as OpenDocument;
const field = (label: string) =>
  [...openDialog()!.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))!.querySelector('input')!;

beforeEach(async () => {
  useDom();
  vi.mocked(unsavedFiles).mockReturnValue([]);
  vi.mocked(reshow).mockClear();
  work = await addFolder(new DesktopDirectoryHandle('/work'));
  useGit({
    repositories: async (folder: string) => (folder === '/work' ? [''] : []),
    commit: async () => ({ kind: 'committed', hooks: false, leftOut: [] }),
  } as unknown as Git);
});

test('the footer counts saves not yet on GitHub, offers Publish without a remote, and follows commits', async () => {
  const stand = useGitHubStand({ remote: vi.fn(async () => ({ remotes: true, url: 'https://github.com/owner/work.git', github: true, ahead: 2 })) });
  // The workspace draws its footer before it joins the page.
  const footer = document.createElement('div');
  syncFooter(doc('notes.md'), footer);
  document.body.append(footer);
  await vi.waitFor(() => expect(footer.querySelector('button')?.title).toBe('Sync: 2 saves not yet on GitHub'));
  expect(footer.querySelector('button')!.textContent).toBe('2');
  vi.mocked(stand.remote).mockResolvedValue({ remotes: false, url: null, github: false, ahead: 0 });
  for (const listener of [...committed]) void listener();
  await vi.waitFor(() => expect(footer.querySelector('button')?.title).toBe('Publish to GitHub'));
  vi.mocked(stand.remote).mockResolvedValue({ remotes: true, url: 'https://gitlab.com/owner/work.git', github: false, ahead: 1 });
  for (const listener of [...committed]) void listener();
  await vi.waitFor(() => expect(footer.querySelector('button')).toBeNull());
});

test("Sync saves the repository's unsaved files first, and Cancel there stops it", async () => {
  const stand = useGitHubStand();
  vi.mocked(unsavedFiles).mockReturnValue([doc('notes.md')]);
  const reasons: string[] = [];
  useDialogs({ save: async (_groups, reason) => { reasons.push(reason); return 'cancel'; }, author: async () => null });
  await sync(repoOfFolder(work));
  expect(reasons).toEqual(['sync']);
  expect(stand.fetch).not.toHaveBeenCalled();
  useDialogs({ save: async groups => new Map([[groups[0].place!.root, 'Edit notes.md']]), author: async () => null });
  await sync(repoOfFolder(work));
  expect(stand.fetch).toHaveBeenCalledWith('/work');
  expect(noticeText()).toBe('work is up to date with GitHub.');
});

test('each conflicting file keeps the side picked, and Sync sends the picks', async () => {
  const stand = useGitHubStand({ fetch: vi.fn(async () => ({ kind: 'merge' as const, fetched: 'f1', conflicts: ['a.md', 'b.md'] })) });
  const syncing = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()?.textContent).toContain('b.md'));
  const go = buttonNamed('Sync', openDialog()!)!;
  const rows = openDialog()!.querySelectorAll('.version-row');
  expect(go.disabled).toBe(true);
  buttonNamed('Keep mine', rows[0])!.click();
  expect(go.disabled).toBe(true);
  buttonNamed("Keep GitHub's", rows[1])!.click();
  expect(go.disabled).toBe(false);
  go.click();
  await syncing;
  expect(stand.sync).toHaveBeenCalledWith('/work', 'f1', { 'a.md': 'mine', 'b.md': 'theirs' }, null);
  expect(reshow).toHaveBeenCalled();
  expect(noticeText()).toBe('Synced work with GitHub.');
});

test('Cancel in the conflict dialog leaves everything as it was', async () => {
  const stand = useGitHubStand({ fetch: vi.fn(async () => ({ kind: 'merge' as const, fetched: 'f1', conflicts: ['a.md'] })) });
  const syncing = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()?.textContent).toContain('a.md'));
  buttonNamed('Cancel', openDialog()!)!.click();
  await syncing;
  expect(stand.sync).not.toHaveBeenCalled();
});

test("when the push doesn't happen, the screen still shows GitHub's changes", async () => {
  useGitHubStand({
    fetch: vi.fn(async () => ({ kind: 'merge' as const, fetched: 'f1', conflicts: [] })),
    sync: vi.fn().mockRejectedValueOnce({ kind: 'signIn' }),
  });
  const syncing = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()).not.toBeNull());
  buttonNamed('Cancel', openDialog()!)!.click();
  await syncing;
  expect(reshow).toHaveBeenCalled();
  expect(noticeText()).toBe("GitHub's changes are in work; its commits go to GitHub at the next Sync.");
});

test('Sync says why it stopped', async () => {
  useGitHubStand({ fetch: vi.fn(async () => ({ kind: 'stopped' as const, reason: 'changed' as const, paths: ['notes.md'] })) });
  await sync(repoOfFolder(work));
  expect(noticeText()).toBe("Sync stopped, changing nothing: notes.md changed outside Gittin and isn't committed; "
    + 'commit or undo that change with git.');
});

test("Publish to GitHub names the repository after the folder, keeps it private, and shows GitHub's refusal", async () => {
  const stand = useGitHubStand({
    remote: vi.fn(async () => ({ remotes: false, url: null, github: false, ahead: 0 })),
    publish: vi.fn()
      .mockRejectedValueOnce({ kind: 'message', message: 'Repository creation failed: name already exists on this account' })
      .mockResolvedValueOnce({ kind: 'done', pushed: true, published: true, hooks: false }),
  });
  await sync(repoOfFolder(work));
  expect(field('Name').value).toBe('work');
  expect(field('Private').checked).toBe(true);
  buttonNamed('Publish', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('name already exists on this account'));
  field('Name').value = 'notes';
  buttonNamed('Publish', openDialog()!)!.click();
  await vi.waitFor(() => expect(noticeText()).toBe('Published work to GitHub.'));
  expect(stand.publish).toHaveBeenLastCalledWith('/work', 'notes', true);
});
