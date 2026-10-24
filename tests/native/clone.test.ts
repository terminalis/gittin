// @vitest-environment jsdom
import { open } from '@tauri-apps/plugin-dialog';
import { beforeEach, expect, test, vi } from 'vitest';
import { openFolderHandle } from '../../src/app';
import { openClone } from '../../src/native/clone';
import type { Cloned, Listed } from '../../src/native/github';
import { buttonNamed, noticeText, octocat, openDialog, useDom, useGitHubStand } from './stand-ins';

vi.mock('../../src/app', () => ({ openFolderHandle: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => '/work') }));
beforeEach(() => {
  useDom();
  vi.mocked(openFolderHandle).mockClear();
  vi.mocked(open).mockClear();
  localStorage.removeItem('gittin-clone-folder');
});

const field = (label: string) =>
  [...openDialog()!.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))!.querySelector('input')!;
const repository = (n: number): Listed =>
  ({ fullName: `octocat/notes-${n}`, cloneUrl: `https://github.com/octocat/notes-${n}.git`, private: n === 100 });
const area = () => openDialog()!.querySelector('.clone-repositories')!;

test('signed out, the repositories area is one row offering the sign-in', async () => {
  useGitHubStand();
  openClone();
  await vi.waitFor(() => expect(buttonNamed('Sign in to GitHub…', area())).toBeTruthy());
  expect(area().classList.contains('listing')).toBe(false);
  expect(buttonNamed('Choose folder…', openDialog()!)).toBeUndefined();
});

test("signed in, the area has the list's height while loading, and every page is listed, filtered and fills the address", async () => {
  let release = () => {};
  const pages = [Array.from({ length: 100 }, (_, n) => repository(n + 1)), [repository(101)]];
  const stand = useGitHubStand({
    account: vi.fn(async () => octocat),
    repositories: vi.fn(async (page: number) => {
      if (page === 1) await new Promise<void>(resolve => { release = resolve; });
      return pages[page - 1];
    }),
  });
  openClone();
  await vi.waitFor(() => expect(area().textContent).toBe('Loading your repositories…'));
  expect(area().classList.contains('listing')).toBe(true);
  release();
  await vi.waitFor(() => expect(openDialog()!.querySelectorAll('.clone-list li')).toHaveLength(101));
  expect(stand.repositories).toHaveBeenCalledTimes(2);
  const filter = field('Your repositories');
  filter.value = 'notes-10';
  filter.dispatchEvent(new Event('input'));
  expect([...openDialog()!.querySelectorAll('.clone-list button')].map(b => b.textContent))
    .toEqual(['octocat/notes-10', 'octocat/notes-100 (private)', 'octocat/notes-101']);
  buttonNamed('octocat/notes-101', openDialog()!)!.click();
  expect(field('Repository address').value).toBe('https://github.com/octocat/notes-101.git');
  expect(document.activeElement).toBe(buttonNamed('Clone…', openDialog()!));
});

test("an address that isn't https:// is refused before the picker; Clone… picks the folder, clones and opens it", async () => {
  const stand = useGitHubStand({
    clone: vi.fn(async (_url: string, _folder: string, progress: (step: { phase: 'receiving'; done: number; total: number }) => void) => {
      progress({ phase: 'receiving', done: 5, total: 10 });
      return { folder: '/work/notes', filtered: ['big.bin'] };
    }),
  });
  openClone();
  field('Repository address').value = 'git@github.com:owner/notes.git';
  buttonNamed('Clone…', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('copy the HTTPS address from the Code button'));
  expect(open).not.toHaveBeenCalled();
  field('Repository address').value = 'https://github.com/owner/notes.git';
  buttonNamed('Clone…', openDialog()!)!.click();
  await vi.waitFor(() => expect(openFolderHandle).toHaveBeenCalled());
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, defaultPath: undefined, title: 'Clone into' }));
  expect(stand.clone).toHaveBeenLastCalledWith('https://github.com/owner/notes.git', '/work', expect.any(Function));
  expect(vi.mocked(openFolderHandle).mock.calls[0][0]).toMatchObject({ path: '/work/notes' });
  expect(openDialog()).toBeNull();
  expect(noticeText()).toContain('big.bin');
});

test('a cancelled picker clones nothing, and the next Clone… starts where the last clone went', async () => {
  const stand = useGitHubStand();
  vi.mocked(open).mockResolvedValueOnce(null);
  openClone();
  field('Repository address').value = 'https://github.com/owner/notes.git';
  buttonNamed('Clone…', openDialog()!)!.click();
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  await new Promise(resolve => setTimeout(resolve));
  expect(stand.clone).not.toHaveBeenCalled();
  expect(buttonNamed('Clone…', openDialog()!)!.disabled).toBe(false);
  buttonNamed('Clone…', openDialog()!)!.click();
  await vi.waitFor(() => expect(openFolderHandle).toHaveBeenCalled());
  openClone();
  field('Repository address').value = 'https://github.com/owner/other.git';
  buttonNamed('Clone…', openDialog()!)!.click();
  await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(3));
  expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ defaultPath: '/work' }));
});

test('Cancel during a clone stops it', async () => {
  let finish = (_cloned: Cloned) => {};
  const stand = useGitHubStand({ clone: vi.fn(() => new Promise<Cloned>(resolve => { finish = resolve; })) });
  openClone();
  field('Repository address').value = 'https://github.com/owner/notes.git';
  buttonNamed('Clone…', openDialog()!)!.click();
  await vi.waitFor(() => expect(stand.clone).toHaveBeenCalled());
  buttonNamed('Cancel', openDialog()!)!.click();
  expect(stand.cancelClone).toHaveBeenCalled();
  finish({ folder: '/work/notes', filtered: ['big.bin'] });
  await new Promise(resolve => setTimeout(resolve));
  expect(openFolderHandle).not.toHaveBeenCalled();
  expect(noticeText()).toBe('');
});
