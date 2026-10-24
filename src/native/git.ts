// The git commands of the desktop app's Rust side (src-tauri/src/git.rs), typed, with a stand-in for tests.
import { invoke } from '@tauri-apps/api/core';

export interface Author { name: string; email: string }
export interface LogEntry { id: string; message: string; author: string; time: number }
export interface LeftOut { path: string; reason: 'lfs' | 'filter' | 'ignored' | 'workflow' }
export type Outcome =
  | { kind: 'committed'; hooks: boolean; leftOut: LeftOut[] }
  | { kind: 'unchanged'; leftOut: LeftOut[] }
  | { kind: 'refused'; reason: 'signs' | 'busy' | 'detached' | 'identity' };
export interface Git {
  /** The repositories at a folder and directly inside it, relative to it ('' for the folder itself). */
  repositories(folder: string): Promise<string[]>;
  /** Starts a repository; `leaveOut` names entries directly inside the folder for its `.gitignore`. */
  init(folder: string, leaveOut: string[]): Promise<void>;
  /** The files a first commit takes: everything git doesn't ignore. */
  untracked(root: string): Promise<string[]>;
  /** Commits paths relative to the repository's folder, as they are on disk. */
  commit(root: string, paths: string[], message: string, author: Author | null): Promise<Outcome>;
  log(root: string, path: string, skip: number, take: number): Promise<LogEntry[]>;
  show(root: string, commit: string, path: string): Promise<Uint8Array>;
  /** Whether the branch's last commit has the file. */
  tracked(root: string, path: string): Promise<boolean>;
}
const tauri: Git = {
  repositories: folder => invoke('git_repositories', { folder }),
  init: (folder, leaveOut) => invoke('git_init', { folder, leaveOut }),
  untracked: root => invoke('git_untracked', { root }),
  commit: (root, paths, message, author) => invoke('git_commit', { root, paths, message, author }),
  log: (root, path, skip, take) => invoke('git_log', { root, path, skip, take }),
  show: async (root, commit, path) => new Uint8Array(await invoke<ArrayBuffer>('git_show', { root, commit, path })),
  tracked: (root, path) => invoke('git_tracked', { root, path }),
};
export let git: Git = tauri;
export const useGit = (stand: Git) => { git = stand; };
