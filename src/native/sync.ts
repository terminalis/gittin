// Sync: the repository's commits go to GitHub and GitHub's come in, with one merge commit when both moved. It saves the
// repository's unsaved files first, settles files both sides changed on the same lines by the side the writer keeps,
// and says why when it stops, changing nothing. A repository with no remote offers Publish to GitHub instead.
import { compareFile, reshow, saveTools, unsavedFiles } from '../app';
import { decodeSource } from '../editor/source-projection';
import type { OpenDocument } from '../screens/workspace';
import type { FolderSource } from '../sources/folder';
import { ask, el, notice } from '../ui/dom';
import type { Action } from '../ui/menus';
import { incomingDialog } from './conflicts';
import { repositoryButton, repositorySection } from './folder';
import { git } from './git';
import { github, isFailure, type Choice, type Fetched, type Stop, type Synced } from './github';
import { publishDialog } from './publish';
import { placeOfDocument, repoOfDocument, repoOfFolder, type Repo } from './repositories';
import { committed, fallbackAuthor, saveAll, storedAuthor } from './save';
import { failureText, signIn, signedIn } from './sign-in';

const list = (paths: string[]) =>
  paths.length === 1 ? paths[0] : `${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`;
const stops: Record<Stop, (repo: Repo, paths: string[]) => string> = {
  detached: repo => `${repo.name} isn't on a branch.`,
  busy: repo => `another tool left a merge, rebase or cherry-pick part-way in ${repo.name}; finish it there.`,
  signs: repo => `${repo.name} signs its commits, which Gittin can't do, so merge GitHub's changes with git.`,
  filter: (_, paths) =>
    `GitHub's changes include ${list(paths)}, which git converts with a filter Gittin can't run, so sync with git.`,
  changed: (_, paths) => `${list(paths)} changed outside Gittin and ${paths.length === 1 ? "isn't" : "aren't"} `
    + `committed; commit or undo ${paths.length === 1 ? 'that change' : 'those changes'} with git.`,
  identity: repo => `git has no name and email for the merge commit in ${repo.name}.`,
};
const stopText = (repo: Repo, reason: Stop, paths: string[]) =>
  `Sync stopped, changing nothing: ${stops[reason](repo, paths)}`;

function syncedText(repo: Repo, fetched: Fetched, synced: Synced) {
  switch (synced.kind) {
    case 'done': {
      const text = synced.published ? `Published this branch of ${repo.name} to GitHub and linked the two.`
        : fetched.kind === 'upToDate' && !synced.pushed ? `${repo.name} is up to date with GitHub.`
        : `Synced ${repo.name} with GitHub.`;
      return synced.hooks ? `${text} Its git hooks did not run.` : text;
    }
    case 'moved': return `GitHub changed during the Sync. Run Sync again; the commits stay in ${repo.name}.`;
    case 'refused': return `GitHub refused the Sync: ${synced.message}. The commits stay in ${repo.name} for the next Sync.`;
    case 'stopped': return stopText(repo, synced.reason, synced.paths);
  }
}

/** Saves the repository's unsaved files through the save dialog; false when the writer cancels. */
async function saveFirst(repo: Repo) {
  const docs: OpenDocument[] = [];
  for (const doc of unsavedFiles()) if ((await placeOfDocument(doc))?.root === repo.root) docs.push(doc);
  return !docs.length || (await saveAll(docs, 'sync', saveTools)) === 'saved';
}

/** Diff of a conflicting file against GitHub's version; the writer runs Sync again to pick. */
async function compareWithGitHub(repo: Repo, fetched: string, path: string) {
  // A file GitHub deleted compares with nothing.
  const theirs = await git.show(repo.root, fetched, path).then(decodeSource, () => '');
  await compareFile(repo.source, repo.prefix + path, theirs, "GitHub's version");
  notice(`Diff shows ${path} against GitHub's version. Run Sync again to pick which to keep.`);
}

/** GitHub refused a workflow file: Allow workflow changes… signs in for it, then syncs again. */
async function offerWorkflow(repo: Repo, message: string) {
  const choice = await ask('GitHub refused the Sync', `${message}. The commits stay in ${repo.name}.`,
    [['Allow workflow changes…', 'allow']]);
  if (choice === 'allow' && (await signIn({ workflow: true }))) await sync(repo);
}

export async function sync(repo: Repo): Promise<void> {
  const state = await github.remote(repo.root);
  if (!state.remotes) {
    if (!(await saveFirst(repo))) return;
    // A repository with nothing committed has nothing to publish: say so before asking for a name.
    await github.publishable(repo.root);
    publishDialog(repo);
    return;
  }
  if (!state.github)
    return notice(`Gittin can't sync ${repo.name} with ${state.url ?? 'its remote'} yet: it syncs only with GitHub, over HTTPS.`);
  if (!(await saveFirst(repo))) return;
  const fetched = await signedIn(() => github.fetch(repo.root));
  if (!fetched) return;
  if (fetched.kind === 'stopped') return notice(stopText(repo, fetched.reason, fetched.paths));
  const id = fetched.kind === 'publish' ? null : fetched.fetched;
  let choices: Record<string, Choice> = {};
  if (fetched.kind === 'fastForward' || fetched.kind === 'merge') {
    const picked = await incomingDialog(repo.name, fetched.incoming, fetched.kind === 'merge' ? fetched.conflicts : [],
      path => void compareWithGitHub(repo, fetched.fetched, path).catch(notice));
    if (!picked) return;
    choices = picked;
  }
  let synced: Synced | null;
  try {
    synced = await signedIn(() => github.sync(repo.root, id, choices, storedAuthor()));
    if (synced?.kind === 'stopped' && synced.reason === 'identity') {
      const author = await fallbackAuthor(repo.name);
      if (!author) return;
      synced = await signedIn(() => github.sync(repo.root, id, choices, author));
    }
  } finally {
    // GitHub's changes reach the folder before the push, so the screen follows them even when the push doesn't happen.
    await reshow();
  }
  if (!synced) {
    if (fetched.kind === 'merge')
      notice(`GitHub's changes are in ${repo.name}; its commits go to GitHub at the next Sync.`);
    return;
  }
  if (synced.kind === 'refused' && /\bworkflow\b/.test(synced.message)) return offerWorkflow(repo, synced.message);
  notice(syncedText(repo, fetched, synced));
}

/** The repositories a Sync is running in, so a second click does nothing until the first ends. */
const syncing = new Set<string>();

/** Runs Sync from a button or the menu, saying what went wrong. */
function run(repo: Repo) {
  if (syncing.has(repo.root)) return;
  syncing.add(repo.root);
  void sync(repo).catch(error => notice(isFailure(error) && error.kind === 'offline'
    ? `Gittin can't reach GitHub. The commits stay in ${repo.name} until the next Sync.` : failureText(error)))
    .finally(() => syncing.delete(repo.root));
}

const edited = (count: number) => !count ? 'All edited files on GitHub'
  : `${count} edited ${count === 1 ? 'file' : 'files'} not on GitHub yet`;

/** The Repository section's line counting a repository's edited files not yet on GitHub, following commits until the
 * panel is drawn again. */
function unsentCount(repo: Repo, count: number) {
  const line = el('p', { className: 'unsent-count', role: 'status', textContent: edited(count) });
  const draw = async () => {
    const state = await github.remote(repo.root);
    if (line.isConnected) line.textContent = edited(state.unsent.length);
  };
  const follow = () => (line.isConnected ? draw().catch(() => {}) : committed.delete(follow));
  committed.add(follow);
  return line;
}

/** The Folder panel's Repository section, for an opened folder that is itself a repository: Sync, with a line counting
 * the edited files not yet on GitHub for one there; Publish to GitHub, saying it isn't there yet, without a remote. */
export function syncInFolder(source: FolderSource, panel: HTMLElement) {
  const repo = repoOfFolder(source), header = panel.querySelector('.folder-header');
  void git.repositories(repo.root).then(async repositories => {
    if (!repositories.includes('')) return;
    const state = await github.remote(repo.root);
    // The panel may have been drawn again meanwhile.
    if (!header?.isConnected) return;
    const line = state.github ? [unsentCount(repo, state.unsent.length)]
      : state.remotes ? [] : [el('p', { textContent: "This repository isn't on GitHub yet." })];
    repositorySection(panel).append(...line, state.remotes ? repositoryButton('Sync', 'arrows-up-down', () => run(repo))
      : repositoryButton('Publish to GitHub', 'cloud-upload', () => run(repo)));
  }).catch(() => {});
}

/** Whether a file's saved version is on GitHub, for a file the branch's last commit has in a repository on GitHub;
 * empty otherwise. */
async function fileOnGitHub(doc: OpenDocument) {
  const place = await placeOfDocument(doc);
  if (!place) return '';
  const state = await github.remote(place.root);
  if (!state.github) return '';
  if (state.unsent.includes(place.path)) return 'Not on GitHub yet';
  return (await git.tracked(place.root, place.path)) ? 'On GitHub' : '';
}

/** The status footer's word on whether the file is on GitHub, as plain status. */
export function githubStatus(doc: OpenDocument, footer: HTMLElement) {
  const slot = el('span', { className: 'github-status' });
  footer.append(slot);
  const draw = async () => {
    const text = await fileOnGitHub(doc);
    // The workspace may have gone meanwhile.
    if (slot.isConnected) slot.textContent = text;
  };
  // The workspace draws its footer before it joins the page, so the status follows commits until the slot leaves it.
  const follow = () => (slot.isConnected ? draw().catch(() => {}) : committed.delete(follow));
  committed.add(follow);
  void draw().catch(() => {});
}

/** File › Sync for the current file's repository; Publish to GitHub, with its cloud, when it has no remote. */
export function syncCommand(doc: OpenDocument): Action {
  let publish = false, repo: Repo | null = null;
  void repoOfDocument(doc).then(async found => {
    repo = found;
    if (found) publish = !(await github.remote(found.root)).remotes;
  }).catch(() => {});
  return {
    id: 'sync', menu: 'File',
    get label() { return publish ? 'Publish to GitHub' : 'Sync'; },
    get icon() { return publish ? 'cloud-upload' as const : undefined; },
    run: () => { if (repo) run(repo); },
    state: () => ({ disabled: !repo }),
  };
}
