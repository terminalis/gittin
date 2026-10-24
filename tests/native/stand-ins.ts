// What the desktop page's tests share: the modal dialogs and notice host jsdom lacks, and a GitHub stand-in.
import { vi } from 'vitest';
import { useGitHub, type Account, type GitHub } from '../../src/native/github';

export const octocat: Account = { login: 'octocat', avatar: 'https://avatars.githubusercontent.com/u/583231', scopes: ['repo'] };

/** Opens and closes dialogs as an attribute, gives notices their host and the clipboard a stand-in. */
export function useDom() {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  document.body.innerHTML = '<div id="notice"></div>';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
}
export const openDialog = () => document.querySelector<HTMLDialogElement>('dialog[open]');
/** The button with this text, tooltip or name, inside `within`. Icon buttons carry their name as a tooltip too, and
 * jsdom doesn't turn an `ariaLabel` set as a property into the attribute. */
export const buttonNamed = (name: string, within: ParentNode = document) =>
  [...within.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === name || button.title === name || button.getAttribute('aria-label') === name);
export const noticeText = () => document.querySelector('#notice span')?.textContent ?? '';

/** GitHub signed out, with nothing to fetch, until a test says otherwise. */
export function useGitHubStand(overrides: Partial<GitHub> = {}) {
  const stand: GitHub = {
    deviceCode: vi.fn(async () => ({ userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900 })),
    deviceWait: vi.fn(async () => ({ kind: 'cancelled' as const })),
    cancelSignIn: vi.fn(async () => {}),
    account: vi.fn(async () => null),
    signOut: vi.fn(async () => {}),
    repositories: vi.fn(async () => []),
    clone: vi.fn(async () => ({ folder: '/work/notes', filtered: [] })),
    cancelClone: vi.fn(async () => {}),
    remote: vi.fn(async () => ({ remotes: true, url: 'https://github.com/owner/notes.git', github: true, unsent: [] as string[] })),
    fetch: vi.fn(async () => ({ kind: 'upToDate' as const, fetched: 'abc123', ahead: 0 })),
    sync: vi.fn(async () => ({ kind: 'done' as const, pushed: false, published: false, hooks: false })),
    publish: vi.fn(async () => ({ kind: 'done' as const, pushed: true, published: true, hooks: false })),
    publishable: vi.fn(async () => {}),
    ...overrides,
  };
  useGitHub(stand);
  return stand;
}
