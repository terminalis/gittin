// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { reshow } from '../../src/app';
import type { FolderSource } from '../../src/sources/folder';
import { addFolder } from '../../src/sources/registry';
import { DesktopDirectoryHandle } from '../../src/native/files';
import { offerRepository } from '../../src/native/folder';
import { useGit, type Git, type Outcome } from '../../src/native/git';
import { buttonNamed, noticeText, openDialog, useDom, useGitHubStand } from './stand-ins';

vi.mock('../../src/app', () => ({ reshow: vi.fn(async () => {}) }));

let work: FolderSource, panel: HTMLElement, outcome: Outcome;
const calls: unknown[][] = [];
beforeEach(async () => {
  useDom();
  useGitHubStand();
  calls.length = 0;
  outcome = { kind: 'committed', hooks: false, leftOut: [] };
  vi.mocked(reshow).mockClear();
  work = await addFolder(new DesktopDirectoryHandle('/work'));
  panel = document.createElement('aside');
  panel.innerHTML = '<div class="folder-header"><h2>Current Folder</h2></div>';
  document.body.append(panel);
  useGit({
    repositories: async () => [],
    init: async (folder: string, leaveOut: string[]) => { calls.push(['init', folder, leaveOut]); },
    untracked: async () => ['notes.md', 'drafts/a.md'],
    commit: async (root: string, paths: string[], message: string) => { calls.push(['commit', root, paths, message]); return outcome; },
  } as unknown as Git);
});
const start = async () => {
  await vi.waitFor(() => expect(buttonNamed('Start a repository', panel)).toBeTruthy());
  buttonNamed('Start a repository', panel)!.click();
};
const boxes = () => [...openDialog()!.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];

test("an empty folder starts at once, with nothing but git's folder", async () => {
  vi.spyOn(work, 'list').mockResolvedValue([]);
  offerRepository(work, panel);
  await vi.waitFor(() => expect(panel.lastElementChild!.className).toBe('repository-section'));
  expect(panel.lastElementChild!.textContent).toBe("RepositoryThis folder isn't a repository.Start a repository");
  await start();
  await vi.waitFor(() => expect(reshow).toHaveBeenCalled());
  expect(openDialog()).toBeNull();
  expect(calls).toEqual([['init', '/work', []]]);
  expect(panel.querySelector('.repository-section')).toBeNull();
});

test('a folder that is a repository is offered no start; one holding a repository is', async () => {
  useGit({ repositories: async () => [''] } as unknown as Git);
  offerRepository(work, panel);
  await new Promise(resolve => setTimeout(resolve));
  expect(panel.querySelector('.repository-section')).toBeNull();
  useGit({ repositories: async () => ['notes'] } as unknown as Git);
  offerRepository(work, panel);
  await vi.waitFor(() => expect(buttonNamed('Start a repository', panel)).toBeTruthy());
});

test("the folder's files are listed ticked; unticked ones go into .gitignore and the rest are the first commit", async () => {
  vi.spyOn(work, 'list').mockResolvedValue(
    [{ path: 'drafts', kind: 'directory' }, { path: 'big.bin', kind: 'file' }, { path: 'notes.md', kind: 'file' }]);
  offerRepository(work, panel);
  await start();
  await vi.waitFor(() => expect(boxes()).toHaveLength(3));
  expect(boxes().every(box => box.checked)).toBe(true);
  expect(openDialog()!.textContent).toContain('drafts/');
  boxes()[1].checked = false;
  buttonNamed('Start a repository', openDialog()!)!.click();
  await vi.waitFor(() => expect(reshow).toHaveBeenCalled());
  expect(calls).toEqual([['init', '/work', ['big.bin']], ['commit', '/work', ['notes.md', 'drafts/a.md'], 'Initial commit']]);
});

test('Cancel starts nothing, and unticking everything starts the repository empty', async () => {
  vi.spyOn(work, 'list').mockResolvedValue([{ path: 'notes.md', kind: 'file' }]);
  offerRepository(work, panel);
  await start();
  await vi.waitFor(() => expect(openDialog()).not.toBeNull());
  buttonNamed('Cancel', openDialog()!)!.click();
  await new Promise(resolve => setTimeout(resolve));
  expect(calls).toEqual([]);
  await start();
  await vi.waitFor(() => expect(openDialog()).not.toBeNull());
  boxes()[0].checked = false;
  buttonNamed('Start a repository', openDialog()!)!.click();
  await vi.waitFor(() => expect(reshow).toHaveBeenCalled());
  expect(calls).toEqual([['init', '/work', []]]);
});

test('files the first commit leaves out are named', async () => {
  outcome = { kind: 'committed', hooks: false, leftOut: [{ path: 'big.bin', reason: 'lfs' }] };
  vi.spyOn(work, 'list').mockResolvedValue([{ path: 'big.bin', kind: 'file' }]);
  offerRepository(work, panel);
  await start();
  await vi.waitFor(() => expect(openDialog()).not.toBeNull());
  buttonNamed('Start a repository', openDialog()!)!.click();
  await vi.waitFor(() =>
    expect(noticeText()).toBe('Started a repository in work. Not committed: big.bin, stored in Git LFS; commit it with git.'));
});
