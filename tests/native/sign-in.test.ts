// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { DeviceCode, SignInEnd } from '../../src/native/github';
import { signIn, signedIn } from '../../src/native/sign-in';
import { buttonNamed, octocat, openDialog, useDom, useGitHubStand } from './stand-ins';

beforeEach(useDom);
const code = () => document.querySelector('.sign-in-code')?.textContent;

test("the sign-in dialog shows GitHub's code, copies it, and closes once signed in", async () => {
  let finish!: (end: SignInEnd) => void;
  const stand = useGitHubStand({ deviceWait: vi.fn(() => new Promise<SignInEnd>(resolve => { finish = resolve; })) });
  const signing = signIn();
  await vi.waitFor(() => expect(code()).toBe('WDJB-MJHT'));
  expect(stand.deviceCode).toHaveBeenCalledWith(false);
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('WDJB-MJHT');
  expect(buttonNamed('Open GitHub', openDialog()!)).toBeTruthy();
  finish({ kind: 'signedIn', account: octocat, remembered: true });
  expect(await signing).toEqual(octocat);
  expect(openDialog()).toBeNull();
});

test('an expired code offers a new one, and a declined sign-in says so', async () => {
  const ends: SignInEnd[] = [{ kind: 'expired' }, { kind: 'declined' }];
  const stand = useGitHubStand({ deviceWait: vi.fn(async () => ends.shift()!) });
  void signIn();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('This code expired before it was used.'));
  buttonNamed('Get a new code', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('The sign-in was declined on GitHub.'));
  expect(stand.deviceCode).toHaveBeenCalledTimes(2);
});

test("a sign-in this computer can't keep says it will be asked for again", async () => {
  useGitHubStand({ deviceWait: vi.fn(async () => ({ kind: 'signedIn' as const, account: octocat, remembered: false })) });
  const signing = signIn();
  await vi.waitFor(() => expect(openDialog()!.textContent).toContain('the next time it starts'));
  buttonNamed('Close', openDialog()!)!.click();
  expect(await signing).toEqual(octocat);
});

test('Cancel stops the sign-in', async () => {
  const stand = useGitHubStand({ deviceWait: vi.fn(() => new Promise<SignInEnd>(() => {})) });
  const signing = signIn({ workflow: true });
  await vi.waitFor(() => expect(code()).toBe('WDJB-MJHT'));
  expect(stand.deviceCode).toHaveBeenCalledWith(true);
  buttonNamed('Cancel', openDialog()!)!.click();
  expect(await signing).toBeNull();
  expect(stand.cancelSignIn).toHaveBeenCalled();
});

test('a code that arrives after Cancel is given up, neither copied nor waited on', async () => {
  let give!: (device: DeviceCode) => void;
  const stand = useGitHubStand({ deviceCode: vi.fn(() => new Promise<DeviceCode>(resolve => { give = resolve; })) });
  const signing = signIn();
  buttonNamed('Cancel', openDialog()!)!.click();
  expect(await signing).toBeNull();
  give({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900 });
  await vi.waitFor(() => expect(stand.cancelSignIn).toHaveBeenCalledTimes(2));
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  expect(stand.deviceWait).not.toHaveBeenCalled();
});

test('an action GitHub wanted a sign-in for carries on once the writer is signed in', async () => {
  let finish!: (end: SignInEnd) => void;
  useGitHubStand({ deviceWait: vi.fn(() => new Promise<SignInEnd>(resolve => { finish = resolve; })) });
  const run = vi.fn().mockRejectedValueOnce({ kind: 'refused' }).mockResolvedValueOnce('pushed');
  const done = signedIn(run);
  await vi.waitFor(() => expect(document.body.textContent).toContain('GitHub no longer accepts'));
  finish({ kind: 'signedIn', account: octocat, remembered: true });
  expect(await done).toBe('pushed');
  expect(run).toHaveBeenCalledTimes(2);
});
