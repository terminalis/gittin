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
import { githubStatus, sync, syncCommand, syncInFolder } from '../../src/native/sync';
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

const onGitHub = (unsent: string[]) => ({ remotes: true, url: 'https://github.com/owner/work.git', github: true, unsent });
const commit = () => { for (const listener of [...committed]) void listener(); };

test("the footer says whether the file is on GitHub, and nothing for a file git doesn't track or a repository elsewhere", async () => {
  const stand = useGitHubStand({ remote: vi.fn(async () => onGitHub(['notes.md'])) });
  const tracked = vi.fn(async () => true);
  useGit({ repositories: async (folder: string) => (folder === '/work' ? [''] : []), tracked } as unknown as Git);
  // The workspace draws its footer before it joins the page.
  const footer = document.createElement('div');
  githubStatus(doc('notes.md'), footer);
  document.body.append(footer);
  await vi.waitFor(() => expect(footer.textContent).toBe('Not on GitHub yet'));
  vi.mocked(stand.remote).mockResolvedValue(onGitHub([]));
  commit();
  await vi.waitFor(() => expect(footer.textContent).toBe('On GitHub'));
  tracked.mockResolvedValue(false);
  commit();
  await vi.waitFor(() => expect(footer.textContent).toBe(''));
  tracked.mockResolvedValue(true);
  commit();
  await vi.waitFor(() => expect(footer.textContent).toBe('On GitHub'));
  vi.mocked(stand.remote).mockResolvedValue({ remotes: true, url: 'https://gitlab.com/owner/work.git', github: false, unsent: [] });
  commit();
  await vi.waitFor(() => expect(footer.textContent).toBe(''));
  expect(footer.querySelector('button')).toBeNull();
});

test('the Folder panel counts the edited files not yet on GitHub under its buttons, following commits', async () => {
  const stand = useGitHubStand({ remote: vi.fn(async () => onGitHub(['a.md', 'b.md', 'c.md'])) });
  const panel = document.createElement('aside');
  panel.innerHTML = '<div class="folder-header"><h2>Current Folder</h2><div class="folder-tools"></div></div>';
  document.body.append(panel);
  syncInFolder(work, panel);
  const count = () => panel.querySelector('.unsent-count')?.textContent;
  await vi.waitFor(() => expect(count()).toBe('3 edited files not on GitHub yet'));
  expect(panel.querySelector('.folder-header')!.nextElementSibling!.className).toBe('unsent-count');
  expect(buttonNamed('Sync', panel)).toBeTruthy();
  vi.mocked(stand.remote).mockResolvedValue(onGitHub(['a.md']));
  commit();
  await vi.waitFor(() => expect(count()).toBe('1 edited file not on GitHub yet'));
  vi.mocked(stand.remote).mockResolvedValue(onGitHub([]));
  commit();
  await vi.waitFor(() => expect(count()).toBe('All edited files on GitHub'));
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

test("Sync lists GitHub's changes before bringing them in, and Cancel there changes nothing", async () => {
  const stand = useGitHubStand({ fetch: vi.fn(async () => ({ kind: 'fastForward' as const, fetched: 'f1', incoming: ['b.md', 'c.md'] })) });
  const syncing = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()?.textContent).toContain('GitHub has changes to 2 files. Sync brings them into work.'));
  expect([...openDialog()!.querySelectorAll('.version-row strong')].map(item => item.textContent)).toEqual(['b.md', 'c.md']);
  buttonNamed('Cancel', openDialog()!)!.click();
  await syncing;
  expect(stand.sync).not.toHaveBeenCalled();
  const again = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()).not.toBeNull());
  buttonNamed('Sync', openDialog()!)!.click();
  await again;
  expect(stand.sync).toHaveBeenCalledWith('/work', 'f1', {}, null);
});

test('conflicting files come first, each keeps the side picked, and Sync sends the picks', async () => {
  const stand = useGitHubStand({
    fetch: vi.fn(async () => ({ kind: 'merge' as const, fetched: 'f1', incoming: ['a.md', 'b.md', 'c.md'], conflicts: ['b.md', 'c.md'] })),
  });
  const syncing = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()?.textContent).toContain('both changed the same lines of 2 of them'));
  const rows = openDialog()!.querySelectorAll('.version-row');
  expect([...rows].map(row => row.querySelector('strong')!.textContent)).toEqual(['b.md', 'c.md', 'a.md']);
  expect(buttonNamed('Keep mine', rows[2])).toBeUndefined();
  const go = buttonNamed('Sync', openDialog()!)!;
  expect(go.disabled).toBe(true);
  buttonNamed('Keep mine', rows[0])!.click();
  expect(go.disabled).toBe(true);
  buttonNamed("Keep GitHub's", rows[1])!.click();
  expect(go.disabled).toBe(false);
  go.click();
  await syncing;
  expect(stand.sync).toHaveBeenCalledWith('/work', 'f1', { 'b.md': 'mine', 'c.md': 'theirs' }, null);
  expect(reshow).toHaveBeenCalled();
  expect(noticeText()).toBe('Synced work with GitHub.');
});

test("when the push doesn't happen, the screen still shows GitHub's changes", async () => {
  useGitHubStand({
    fetch: vi.fn(async () => ({ kind: 'merge' as const, fetched: 'f1', incoming: ['b.md'], conflicts: [] })),
    sync: vi.fn().mockRejectedValueOnce({ kind: 'signIn' }),
  });
  const syncing = sync(repoOfFolder(work));
  await vi.waitFor(() => expect(openDialog()?.textContent).toContain('GitHub has changes'));
  buttonNamed('Sync', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()?.textContent).not.toContain('GitHub has changes'));
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
    remote: vi.fn(async () => ({ remotes: false, url: null, github: false, unsent: [] })),
    publish: vi.fn()
      .mockRejectedValueOnce({ kind: 'message', message: 'Repository creation failed: name already exists on this account' })
      .mockResolvedValueOnce({ kind: 'done', pushed: true, published: true, hooks: false }),
  });
  await sync(repoOfFolder(work));
  expect(field('Name').value).toBe('work');
  expect(field('Private').checked).toBe(true);
  expect(field('Private').closest('label')!.className).toBe('dialog-option');
  buttonNamed('Publish', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('name already exists on this account'));
  field('Name').value = 'notes';
  buttonNamed('Publish', openDialog()!)!.click();
  await vi.waitFor(() => expect(noticeText()).toBe('Published work to GitHub.'));
  expect(stand.publish).toHaveBeenLastCalledWith('/work', 'notes', true);
});

const nowhere = { remotes: false, url: null, github: false, unsent: [] as string[] };

test('Publish has a cloud in the Folder panel and in File, and says there is nothing to publish before the first commit', async () => {
  useGitHubStand({
    remote: vi.fn(async () => nowhere),
    publishable: vi.fn(async () => {
      throw { kind: 'message', message: "There's nothing to publish yet: save a file in this repository first." };
    }),
  });
  const panel = document.createElement('aside');
  panel.innerHTML = '<div class="folder-header"><h2>Current Folder</h2><div class="folder-tools"></div></div>';
  document.body.append(panel);
  syncInFolder(work, panel);
  await vi.waitFor(() => expect(buttonNamed('Publish to GitHub', panel)).toBeTruthy());
  expect(buttonNamed('Publish to GitHub', panel)!.querySelector('[data-icon="cloud-upload"]')).toBeTruthy();
  buttonNamed('Publish to GitHub', panel)!.click();
  await vi.waitFor(() => expect(noticeText()).toBe("There's nothing to publish yet: save a file in this repository first."));
  expect(openDialog()).toBeNull();
  const command = syncCommand(doc('notes.md'));
  await vi.waitFor(() => expect(command.label).toBe('Publish to GitHub'));
  expect(command.icon).toBe('cloud-upload');
});
