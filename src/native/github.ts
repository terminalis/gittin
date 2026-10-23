// The desktop app's GitHub and network git commands (src-tauri/src/github.rs and git.rs), typed, with a stand-in for
// tests. The token stays on the Rust side: none of these hands it to the page.
import { Channel, invoke } from '@tauri-apps/api/core';
import type { Author } from './git';

export interface Account { login: string; avatar: string; scopes: string[] }
export interface DeviceCode { userCode: string; verificationUri: string; expiresIn: number }
export type SignInEnd =
  | { kind: 'signedIn'; account: Account; remembered: boolean }
  | { kind: 'expired' } | { kind: 'declined' } | { kind: 'cancelled' };
/** One of the account's repositories, for Clone's list. */
export interface Listed { fullName: string; cloneUrl: string; private: boolean }
export interface Step { phase: 'receiving' | 'writing'; done: number; total: number }
export interface Cloned { folder: string; filtered: string[] }
/** What Sync needs to know, as of the last fetch: any remote at all, the one Sync uses, and saves not yet there. */
export interface RemoteState { remotes: boolean; url: string | null; github: boolean; ahead: number }
export type Stop = 'detached' | 'busy' | 'signs' | 'filter' | 'changed' | 'identity';
export type Fetched =
  | { kind: 'upToDate'; fetched: string; ahead: number }
  | { kind: 'fastForward'; fetched: string }
  | { kind: 'merge'; fetched: string; conflicts: string[] }
  | { kind: 'publish' }
  | { kind: 'stopped'; reason: Stop; paths: string[] };
export type Synced =
  | { kind: 'done'; pushed: boolean; published: boolean; hooks: boolean }
  | { kind: 'moved' }
  | { kind: 'refused'; message: string }
  | { kind: 'stopped'; reason: Stop; paths: string[] };
/** The side kept of a conflicting file. */
export type Choice = 'mine' | 'theirs';
/** Why a network command ended without its result; the commands reject with it. */
export type Failure = { kind: 'signIn' } | { kind: 'refused' } | { kind: 'offline' } | { kind: 'message'; message: string };
const failures = ['signIn', 'refused', 'offline', 'message'];
export const isFailure = (error: unknown): error is Failure =>
  typeof error === 'object' && error !== null && failures.includes((error as { kind?: string }).kind ?? '');

export interface GitHub {
  /** Starts a sign-in for `repo`, and `workflow` when asked. */
  deviceCode(workflow: boolean): Promise<DeviceCode>;
  /** Waits until the writer authorises the code, declines it or lets it expire, or the sign-in is cancelled. */
  deviceWait(): Promise<SignInEnd>;
  cancelSignIn(): Promise<void>;
  account(): Promise<Account | null>;
  /** Forgets the sign-in on this computer. */
  signOut(): Promise<void>;
  /** The account's repositories, most recently pushed first, 100 to a page. */
  repositories(page: number): Promise<Listed[]>;
  clone(url: string, folder: string, progress: (step: Step) => void): Promise<Cloned>;
  cancelClone(): Promise<void>;
  remote(repository: string): Promise<RemoteState>;
  fetch(repository: string): Promise<Fetched>;
  /** Brings in `fetched` with a side picked for each conflicting path, and pushes; with no `fetched`, publishes the branch. */
  sync(repository: string, fetched: string | null, choices: Record<string, Choice>, author: Author | null): Promise<Synced>;
  publish(repository: string, name: string, isPrivate: boolean): Promise<Synced>;
}
const tauri: GitHub = {
  deviceCode: workflow => invoke('github_device_code', { workflow }),
  deviceWait: () => invoke('github_device_wait'),
  cancelSignIn: () => invoke('github_cancel_sign_in'),
  account: () => invoke('github_account'),
  signOut: () => invoke('github_sign_out'),
  repositories: page => invoke('github_repositories', { page }),
  clone: (url, folder, progress) => {
    const channel = new Channel<Step>();
    channel.onmessage = progress;
    return invoke('git_clone', { url, folder, progress: channel });
  },
  cancelClone: () => invoke('git_cancel_clone'),
  remote: repository => invoke('git_remote', { repository }),
  fetch: repository => invoke('git_fetch', { repository }),
  sync: (repository, fetched, choices, author) => invoke('git_sync', { repository, fetched, choices, author }),
  publish: (repository, name, isPrivate) => invoke('github_publish', { repository, name, private: isPrivate }),
};
export let github: GitHub = tauri;
export const useGitHub = (stand: GitHub) => { github = stand; };
