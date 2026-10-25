// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { accountButton } from '../../src/native/account';
import { buttonNamed, octocat, openDialog, useDom, useGitHubStand } from './stand-ins';

let home: HTMLElement, workspace: HTMLElement;
beforeEach(() => {
  useDom();
  home = document.createElement('header');
  workspace = document.createElement('div');
  document.body.append(home, workspace);
});

test("signed out, Home and the workspace show GitHub's mark, which opens the sign-in", async () => {
  useGitHubStand({ deviceWait: vi.fn(() => new Promise<never>(() => {})) });
  accountButton(home);
  accountButton(workspace);
  await vi.waitFor(() => expect(buttonNamed('Sign in to GitHub…', home)).toBeTruthy());
  await vi.waitFor(() => expect(buttonNamed('Sign in to GitHub…', workspace)).toBeTruthy());
  buttonNamed('Sign in to GitHub…', workspace)!.click();
  await vi.waitFor(() => expect(openDialog()?.querySelector('h2')?.textContent).toBe('Sign in to GitHub'));
});

test('signed in, both show the avatar, whose menu names the account and disconnects it', async () => {
  const stand = useGitHubStand({ account: vi.fn(async () => octocat) });
  accountButton(home);
  accountButton(workspace);
  await vi.waitFor(() => expect(home.querySelector('img')?.getAttribute('src')).toBe(octocat.avatar));
  await vi.waitFor(() => expect(workspace.querySelector('img')).toBeTruthy());
  buttonNamed('GitHub account: octocat', home)!.click();
  const menu = home.querySelector<HTMLElement>('.account-menu')!;
  expect(menu.hidden).toBe(false);
  expect(menu.textContent).toContain('Signed in as octocat');
  expect(buttonNamed('Switch account', menu)).toBeTruthy();
  buttonNamed('Disconnect GitHub', menu)!.click();
  await vi.waitFor(() => expect(openDialog()?.textContent).toContain(
    "GitHub still lists applications as allowed until you revoke them in GitHub's Settings › Applications."));
  expect(openDialog()!.querySelector('h2')!.textContent).toBe('Disconnected');
  expect([...openDialog()!.querySelectorAll('button')].map(button => button.ariaLabel ?? button.textContent))
    .toEqual(['Close']);
  expect(stand.signOut).toHaveBeenCalled();
  expect(buttonNamed('Sign in to GitHub…', home)).toBeTruthy();
  expect(workspace.querySelector('img')).toBeNull();
  expect(buttonNamed('Sign in to GitHub…', workspace)).toBeTruthy();
});
