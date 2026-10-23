// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { openFolderHandle } from '../../src/app';
import { openClone } from '../../src/native/clone';
import type { Cloned, Listed } from '../../src/native/github';
import { buttonNamed, noticeText, octocat, openDialog, useDom, useGitHubStand } from './stand-ins';

vi.mock('../../src/app', () => ({ openFolderHandle: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => '/work') }));
beforeEach(() => { useDom(); vi.mocked(openFolderHandle).mockClear(); });

const field = (label: string) =>
  [...openDialog()!.querySelectorAll('label')].find(item => item.textContent?.startsWith(label))!.querySelector('input')!;
const repository = (n: number): Listed =>
  ({ fullName: `octocat/notes-${n}`, cloneUrl: `https://github.com/octocat/notes-${n}.git`, private: n === 100 });

test('signed out, the list offers the sign-in', async () => {
  useGitHubStand();
  openClone();
  await vi.waitFor(() => expect(buttonNamed('Sign in to GitHub…', openDialog()!)).toBeTruthy());
});

test("signed in, every page of the account's repositories is listed, filtered, and fills the address", async () => {
  const pages = [Array.from({ length: 100 }, (_, n) => repository(n + 1)), [repository(101)]];
  const stand = useGitHubStand({ account: vi.fn(async () => octocat), repositories: vi.fn(async (page: number) => pages[page - 1]) });
  openClone();
  await vi.waitFor(() => expect(openDialog()!.querySelectorAll('.clone-list li')).toHaveLength(101));
  expect(stand.repositories).toHaveBeenCalledTimes(2);
  const filter = field('Your repositories');
  filter.value = 'notes-10';
  filter.dispatchEvent(new Event('input'));
  expect([...openDialog()!.querySelectorAll('.clone-list button')].map(b => b.textContent))
    .toEqual(['octocat/notes-10', 'octocat/notes-100 (private)', 'octocat/notes-101']);
  buttonNamed('octocat/notes-101', openDialog()!)!.click();
  expect(field('Repository address').value).toBe('https://github.com/octocat/notes-101.git');
});

test("Clone shows Gittin's refusal, then clones, opens the folder and names files it couldn't convert", async () => {
  const stand = useGitHubStand({
    clone: vi.fn()
      .mockRejectedValueOnce({ kind: 'message', message: 'Gittin clones from https:// addresses. On GitHub, copy the HTTPS address from the Code button.' })
      .mockImplementationOnce(async (_url: string, _folder: string, progress: (step: { phase: 'receiving'; done: number; total: number }) => void) => {
        progress({ phase: 'receiving', done: 5, total: 10 });
        return { folder: '/work/notes', filtered: ['big.bin'] };
      }),
  });
  openClone();
  buttonNamed('Choose folder…', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('/work'));
  field('Repository address').value = 'git@github.com:owner/notes.git';
  buttonNamed('Clone', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('copy the HTTPS address from the Code button'));
  field('Repository address').value = 'https://github.com/owner/notes.git';
  buttonNamed('Clone', openDialog()!)!.click();
  await vi.waitFor(() => expect(openFolderHandle).toHaveBeenCalled());
  expect(stand.clone).toHaveBeenLastCalledWith('https://github.com/owner/notes.git', '/work', expect.any(Function));
  expect(vi.mocked(openFolderHandle).mock.calls[0][0]).toMatchObject({ path: '/work/notes' });
  expect(openDialog()).toBeNull();
  expect(noticeText()).toContain('big.bin');
});

test('Cancel during a clone stops it', async () => {
  let finish = (_cloned: Cloned) => {};
  const stand = useGitHubStand({ clone: vi.fn(() => new Promise<Cloned>(resolve => { finish = resolve; })) });
  openClone();
  buttonNamed('Choose folder…', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('/work'));
  field('Repository address').value = 'https://github.com/owner/notes.git';
  buttonNamed('Clone', openDialog()!)!.click();
  await vi.waitFor(() => expect(stand.clone).toHaveBeenCalled());
  buttonNamed('Cancel', openDialog()!)!.click();
  expect(stand.cancelClone).toHaveBeenCalled();
  finish({ folder: '/work/notes', filtered: ['big.bin'] });
  await new Promise(resolve => setTimeout(resolve));
  expect(openFolderHandle).not.toHaveBeenCalled();
  expect(noticeText()).toBe('');
});
