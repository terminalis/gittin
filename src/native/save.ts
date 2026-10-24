// Saving in a repository writes the files and commits them, through the save dialog; renames, moves and
// deletions commit at once. Files outside repositories save as everywhere else.
import type { FileChange, SaveResult, SaveTools } from '../extensions';
import type { OpenDocument } from '../screens/workspace';
import type { FolderSource } from '../sources/folder';
import { basename, dirname } from '../sources/paths';
import { notice } from '../ui/dom';
import { git, type Author, type Outcome } from './git';
import { github } from './github';
import { commitMessage } from './messages';
import { placeOf, placeOfDocument, type Place } from './repositories';
import { askAuthor, saveDialog, type SaveGroup } from './save-dialog';

let ask = { save: saveDialog, author: askAuthor };
export const useDialogs = (stand: typeof ask) => { ask = stand; };

/** Files Gittin created for documents (images added beside them), committed with their repository's next save. */
const created = new Map<string, Set<string>>();
/** Told after each commit Gittin makes, so the footer's GitHub status and the Folder panel's count follow. */
export const committed = new Set<() => unknown>();

const authorKey = 'gittin-git-author';
export function storedAuthor(): Author | null {
  try { return JSON.parse(localStorage.getItem(authorKey) ?? 'null'); } catch { return null; }
}
function storeAuthor(author: Author) {
  try { localStorage.setItem(authorKey, JSON.stringify(author)); } catch {}
}

const reasons = {
  signs: "it signs its commits, which Gittin can't do, so commit with git",
  busy: 'another tool left a merge, rebase or cherry-pick part-way, so finish it there',
  detached: "it isn't on a branch",
  identity: 'git has no name and email for its commits',
};
const leftOutReasons = {
  lfs: 'stored in Git LFS; commit it with git',
  filter: 'which git converts as it commits; commit it with git',
  ignored: 'ignored by the repository',
  workflow: 'a workflow file, which GitHub takes only from a sign-in that allows workflow changes',
};
export function outcomeText(place: Place, outcome: Outcome): string {
  if (outcome.kind === 'refused') return `Saved, but not committed to ${place.name}: ${reasons[outcome.reason]}.`;
  const parts = outcome.kind === 'committed' && outcome.hooks ? [`${place.name}'s git hooks did not run.`] : [];
  for (const { path, reason } of outcome.leftOut) parts.push(`Not committed: ${path}, ${leftOutReasons[reason]}.`);
  return parts.join(' ');
}

/** Asks once for the name and email to use whenever git has none, and keeps them; null when the writer cancels. */
export async function fallbackAuthor(repository: string) {
  const author = await ask.author(repository);
  if (author) storeAuthor(author);
  return author;
}

/** Commits paths, asking once for a name and email when git has none. */
async function commit(place: Place, paths: string[], message: string): Promise<Outcome> {
  let outcome = await git.commit(place.root, paths, message, storedAuthor());
  if (outcome.kind === 'refused' && outcome.reason === 'identity') {
    const author = await fallbackAuthor(place.name);
    if (!author) return outcome;
    outcome = await git.commit(place.root, paths, message, author);
  }
  if (outcome.kind === 'committed') for (const listener of [...committed]) void listener();
  return outcome;
}

const isWorkflow = (path: string) => path.startsWith('.github/workflows/');
/** Whether GitHub would take a commit of workflow files from here: the remote isn't on GitHub, or the sign-in allows
 * workflow changes. Signed out counts as not allowing them. */
async function workflowAllowed(root: string) {
  const [state, account] = await Promise.all([github.remote(root), github.account()]);
  return !state.github || !!account?.scopes.includes('workflow');
}

/** The documents by repository, repositories first by name, files outside any last, each repository's
 * message described from what changed. */
async function group(docs: OpenDocument[]): Promise<SaveGroup[]> {
  const groups = new Map<string, SaveGroup>();
  for (const doc of docs) {
    const place = await placeOfDocument(doc), identity = doc.session.identity;
    const path = place?.path ?? (identity.kind === 'source' ? identity.path : doc.title);
    let group = groups.get(place?.root ?? '');
    if (!group) groups.set(place?.root ?? '', group = { place, docs: [], message: '', workflow: [] });
    group.docs.push({ doc, path });
  }
  for (const group of groups.values()) {
    if (!group.place) continue;
    const added = [...(created.get(group.place.root) ?? [])].filter(path => !group.docs.some(d => d.path === path));
    group.message = commitMessage([
      ...group.docs.map(({ doc, path }) =>
        ({ path, before: doc.localBaseline?.source ?? null, after: doc.session.current.source })),
      ...added.map(path => ({ path, before: null, after: '' })),
    ]);
    const workflows = group.docs.map(item => item.path).filter(isWorkflow);
    if (workflows.length && !(await workflowAllowed(group.place.root))) group.workflow = workflows;
  }
  return [...groups.values()].sort((a, b) =>
    Number(!a.place) - Number(!b.place) || (a.place?.name ?? '').localeCompare(b.place?.name ?? ''));
}

/** Saves documents through the save dialog, committing each repository's. Resolves null when saving or
 * closing involves no repository, so Gittin saves as usual; quitting and syncing always ask. */
export async function saveAll(docs: OpenDocument[], reason: 'save' | 'close' | 'quit' | 'sync', tools: SaveTools):
  Promise<SaveResult | null> {
  const groups = await group(docs);
  if (reason !== 'quit' && !groups.some(group => group.place)) return null;
  const answer = await ask.save(groups, reason);
  if (answer === 'cancel') return 'cancelled';
  if (answer === 'discard') return 'discarded';
  let saved = true;
  for (const group of groups) {
    const written: SaveGroup['docs'] = [];
    for (const item of group.docs) if (await tools.write(item.doc)) written.push(item); else saved = false;
    if (!group.place || !written.length) continue;
    const root = group.place.root;
    const leftOut = group.workflow.filter(path => written.some(item => item.path === path))
      .map(path => ({ path, reason: 'workflow' as const }));
    const paths = [...new Set([...written.map(item => item.path), ...(created.get(root) ?? [])])]
      .filter(path => !group.workflow.includes(path));
    const outcome: Outcome = paths.length
      ? await commit(group.place, paths, answer.get(root) || group.message) : { kind: 'unchanged', leftOut: [] };
    if (outcome.kind !== 'refused') created.delete(root);
    const text = outcomeText(group.place,
      outcome.kind === 'refused' ? outcome : { ...outcome, leftOut: [...outcome.leftOut, ...leftOut] });
    for (const { doc } of written) tools.report(doc, text);
    // Closing removes the file status, so a commit that couldn't be made says why here.
    if (reason === 'close' && outcome.kind === 'refused') notice(text);
  }
  return saved ? 'saved' : 'cancelled';
}

/** Commits a file operation at once, saying so if it can't be. */
async function commitNow(place: Place, paths: string[], message: string) {
  if (paths.some(isWorkflow) && !(await workflowAllowed(place.root))) return notice(`${message} wasn't committed to `
    + `${place.name}: GitHub takes changes to workflow files only from a sign-in that allows them.`);
  const outcome = await commit(place, paths, message);
  if (outcome.kind === 'refused') notice(`${message} wasn't committed to ${place.name}: ${reasons[outcome.reason]}.`);
}

/** After Gittin changes a folder's files: an added image waits for its document's save; a file saved for the
 * first time, a rename, move or deletion in a repository commits at once, in each repository it touches. */
export async function changed(source: FolderSource, change: FileChange) {
  if (change.kind === 'create') {
    const place = await placeOf(source, change.path);
    if (place) created.set(place.root, (created.get(place.root) ?? new Set()).add(place.path));
    return;
  }
  if (change.kind === 'add' || change.kind === 'delete') {
    const place = await placeOf(source, change.path);
    if (place) await commitNow(place, [place.path], `${change.kind === 'add' ? 'Add' : 'Delete'} ${place.path}`);
    return;
  }
  const from = await placeOf(source, change.from), to = await placeOf(source, change.to);
  if (from && to && from.root === to.root) {
    const message = dirname(from.path) === dirname(to.path)
      ? `Rename ${from.path} to ${basename(to.path)}` : `Move ${from.path} to ${to.path}`;
    return commitNow(to, [from.path, to.path], message);
  }
  // Out of one repository, into another or none.
  if (from) await commitNow(from, [from.path], `Delete ${from.path}`);
  if (to) await commitNow(to, [to.path], `Add ${to.path}`);
}
