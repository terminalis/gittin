import './style.css';
import { DevicePreferences } from './preferences';
import { readRoute, writeRoute, type Route } from './router';
import { home } from './screens/home';
import type { OpenDocument, Workspace } from './screens/workspace';
import { DocumentSession } from './documents/session';
import {
  DraftAutosave, deleteDraft, deleteDraftsAt, findDraft, listRecent, loadDraft, moveDraft, saveDraft,
  type DraftRecord,
} from './documents/drafts';
import { downloadMarkdown } from './documents/files';
import { decodeSource, encodeSource } from './editor/source-projection';
import { headingAnchors } from './editor/heading-anchors';
import { fileName, fileTypeForName, type FileType } from './documents/file-types';
import { clearVersionsAt, moveVersions, recordVersion, versionKey } from './documents/versions';
import {
  addFile, addFolder, addReadOnlyFolder, isAt, loadSources, openSources, recentFolders, restoreSource,
  sourceFor,
} from './sources/registry';
import { FolderSource } from './sources/folder';
import { countFiles } from './sources/search';
import { basename, dirname } from './sources/paths';
import type { FileSource } from './sources/types';
import { canPickSaveLocation, chooseFile, chooseFolder, pickSaveLocation } from './sources/pickers';
import { conflictDialog } from './ui/disk-change';
import { openFolderDialog } from './ui/folder-panel';
import { ask, errorText, notice } from './ui/dom';
const root = document.querySelector<HTMLElement>('#app')!;
const prefs = new DevicePreferences();
const documents = new Map<string, OpenDocument>();
let workspace: Workspace | undefined,
  current: Route = readRoute(),
  // Startup holds navigation; a hash change meanwhile waits in pending.
  navigating = true,
  starting = true,
  pending: Route | undefined,
  fileSave: Promise<boolean> | undefined;
/** The landing page, handed in by the version of Gittin that has one. */
let landing: () => HTMLElement;
const input = document.createElement('input');
input.type = 'file';
// Accept any file: openPath validates UTF-8 and preserves unknown formats.
input.hidden = true;
input.setAttribute('aria-label', 'Open file');
document.body.append(input);
/** A new browser-only draft. */
function newDraft(
  { source = '', title = 'Untitled file', fileType = 'markdown' as FileType } = {}
): DraftRecord {
  const id = crypto.randomUUID();
  return { id, identity: { kind: 'local', id }, current: { source, revision: 0 }, title, fileType,
    favourite: false, localBaseline: null, lastOpened: Date.now(), storageRevision: 0 };
}
/** A browser-only copy of the document, titled "name (suffix).ext". */
function copyOf(doc: OpenDocument, suffix: string) {
  const dot = doc.title.lastIndexOf('.');
  const title = dot > 0
    ? `${doc.title.slice(0, dot)} (${suffix})${doc.title.slice(dot)}`
    : `${doc.title} (${suffix})`;
  return newDraft({ source: doc.session.current.source, title, fileType: doc.fileType });
}
/** What Home and the workspace ask of the app. */
const actions = {
  home: () => navigate({ screen: 'home' }),
  switch: (id: string) => navigate({ screen: 'editor', id }),
  new: newDocument,
  open: openFileCommand,
  openFolder: openFolderCommand,
  openRecentFolder: (id: string) => void openRecentFolder(id),
  remove: (id: string) => void removeRecent(id),
  createLocal: (source: string, title: string) =>
    openNew(() => newDraft({ source, title, fileType: 'yaml' })),
  makeCopy: (doc: OpenDocument) => openNew(() => copyOf(doc, 'copy')),
  openPath, createFile, createFolder, moveFile, deleteEntry, recovery, diskChoices,
  close: closeDocument,
  download: () => void download(),
  save: saveFile,
};
function retain(record: DraftRecord) {
  const existing = documents.get(record.id);
  if (existing) return existing;
  const session = new DocumentSession(record.current.source, {
    id: record.id,
    identity: record.identity,
    revision: record.current.revision,
  });
  const doc: OpenDocument = {
    session,
    autosave: new DraftAutosave(session, record),
    get title() { return this.autosave.metadata.title; },
    get fileType() { return this.autosave.metadata.fileType; },
    get favourite() { return this.autosave.metadata.favourite; },
    get localBaseline() { return this.autosave.metadata.localBaseline; },
    mode: 'markdown',
    fileStatus: '',
    diskChange: undefined,
  };
  documents.set(session.id, doc);
  return doc;
}
/** Close a document for good, with the workspace when it shows that document. */
function forget(doc: OpenDocument) {
  if (workspace?.document === doc) {
    workspace.dispose();
    workspace = undefined;
  }
  doc.autosave.dispose();
  documents.delete(doc.session.id);
}
/** Store every open document's draft. Resolves true when all of them are stored. */
async function flushAll() {
  const saved = await Promise.all([...documents.values()].map(doc => doc.autosave.flush()));
  return saved.every(Boolean);
}
async function settle() {
  if (workspace && !(await workspace.controller.settleForPersistence())) {
    notice('Finish composing text before leaving or exporting this document.');
    return false;
  }
  return true;
}
/** Runs one change of screen or document at a time, once composition has settled, a file save has
 * finished and the open draft is stored. `flush: false` skips storing the draft, for a recovery copy. */
async function transition(action: () => Promise<void>, { flush = true } = {}) {
  if (navigating) return;
  navigating = true;
  try {
    if (!(await settle())) return;
    root.inert = true;
    // A native write owns its autosave through the persisted baseline acknowledgement.
    await fileSave;
    if (flush && workspace && !(await workspace.document.autosave.flush())) return;
    await action();
  } catch (e) {
    notice(e);
  } finally {
    root.inert = false;
    navigating = false;
  }
}
/** Removes the screen, with every dialog it opened. */
function clear() {
  document.querySelectorAll('dialog').forEach(dialog => dialog.remove());
  workspace?.dispose();
  workspace = undefined;
  root.replaceChildren();
}
/** `checked` skips the disk check when openPath has just made it. */
async function show(route: Route, checked = false) {
  if (route.screen === 'editor') {
    const existing = documents.get(route.id),
      record = existing ? null : await loadDraft(route.id);
    if (!existing && !record)
      throw Error(
        'This document is no longer available on this device. Open a file or choose recent work.'
      );
    const doc = existing ?? retain(record!);
    doc.mode = 'markdown';
    if (doc.session.identity.kind === 'source') {
      const { sourceId, path } = doc.session.identity, source = await restoreSource(sourceId);
      // Reopening checks the disk before the workspace renders, so its banner shows; never prompts.
      if (source && !checked && (await source.permission(false)) === 'granted') {
        const disk = await readDisk(source, path).catch(() => null);
        if (disk) await reconcile(doc, disk);
      }
    }
    // The editor loads with its first document, so the landing page and Home start lighter.
    const { Workspace } = await import('./screens/workspace');
    clear();
    // The workspace sets the window title to its document's name.
    workspace = new Workspace(doc, [...documents.values()], prefs, actions);
    root.append(workspace.element);
    workspace.restoreScroll();
  } else {
    let rows: Awaited<ReturnType<typeof listRecent>> = [],
      failed = false;
    if (route.screen === 'home')
      try {
        rows = await listRecent();
      } catch (e) {
        failed = true;
        notice(e);
      }
    clear();
    document.title = 'Gittin';
    root.append(route.screen === 'landing' ? landing() : home(prefs, rows, actions, failed));
  }
  window.scrollTo(0, 0);
  current = route;
  writeRoute(route);
}
function navigate(route: Route, checked = false, section = '') {
  void transition(() => show(route, checked)).then(() => {
    writeRoute(current);
    if (section && route.screen === 'editor') goToSection(route.id, section);
  });
}
/** Runs once the page is no longer inert, which an editor needs to take focus and scroll. */
function goToSection(id: string, section: string) {
  if (workspace?.document.session.id !== id) return;
  const heading = headingAnchors(workspace.document.session.current.source)
    .find(h => h.id === section || encodeURIComponent(h.id) === section);
  if (heading) workspace.controller.goToSource(heading.from);
}
/** Opens a new browser-only draft, made once the open one is stored. */
function openNew(draft: () => DraftRecord) {
  void transition(() => show({ screen: 'editor', id: retain(draft()).session.id }));
}
function newDocument(fileType: FileType = 'markdown') {
  openNew(() => newDraft({ fileType }));
}
/** Saves the open document as a new draft and shows that instead, when its own draft can't be stored. */
function recovery() {
  void transition(async () => {
    if (!workspace) return;
    const old = workspace.document, copy = copyOf(old, 'recovery copy');
    const result = await saveDraft(copy, 0);
    if (result.kind !== 'saved')
      throw Error(result.kind === 'error' ? result.message : 'Recovery copy could not be saved.');
    retain({ ...copy, storageRevision: result.storageRevision });
    forget(old);
    await show({ screen: 'editor', id: copy.id });
  }, { flush: false });
}
function closeDocument(id: string) {
  void transition(async () => {
    const doc = documents.get(id);
    if (!doc) return;
    if (!(await doc.autosave.flush())) {
      notice('This document could not be closed because its draft has not been saved.');
      return;
    }
    let discard = false;
    if (doc.session.identity.kind === 'local' || doc.localBaseline?.source !== doc.session.current.source) {
      const local = doc.session.identity.kind === 'local';
      const choice = await ask(`Close ${doc.title}?`,
        local
          ? 'This file is only in this browser. Discarding deletes it.'
          : 'It has unsaved changes kept in this browser.',
        [['Save', 'save'], ['Discard changes', 'discard']]);
      if (choice === 'cancel') return;
      if (choice === 'save' && !(await writeFile(doc, false))) return;
      discard = choice === 'discard';
    }
    const active = workspace?.document === doc;
    forget(doc);
    if (discard) await deleteDraft(id);
    await show(active ? { screen: 'home' } : current);
  });
}
async function removeRecent(id: string) {
  const row = (await listRecent()).find(r => r.id === id);
  if (!row) return;
  if (row.unsaved) {
    const choice = await ask(`Remove ${row.title}?`,
      "This deletes the unsaved changes kept in this browser. This can't be undone.", [['Remove', 'remove']]);
    if (choice !== 'remove') return;
  }
  const open = documents.get(id);
  if (open) forget(open);
  await deleteDraft(id);
  navigate({ screen: 'home' });
}
function openFileCommand() {
  void chooseFile().then(async choice => {
    if (choice === 'input') input.click();
    else if (choice) { const source = await addFile({ handle: choice }); await openPath(source, source.label); }
  }).catch(notice);
}
input.onchange = () => {
  const file = input.files?.[0];
  input.value = '';
  if (file) void addFile({ file }).then(source => openPath(source, source.label)).catch(notice);
};
let folderInput: HTMLInputElement | undefined;
function openFolderCommand() {
  void chooseFolder().then(async choice => {
    if (choice === 'input') {
      // Created on demand so pages keep a single file input for Open file.
      folderInput ??= Object.assign(document.createElement('input'),
        { type: 'file', hidden: true, webkitdirectory: true });
      folderInput.setAttribute('aria-label', 'Open folder');
      document.body.append(folderInput);
      folderInput.onchange = () => {
        const files = [...(folderInput!.files ?? [])];
        folderInput!.value = '';
        if (files.length) void addReadOnlyFolder(files).then(showFolder, notice);
      };
      folderInput.click();
    } else if (choice) showFolder(await addFolder(choice));
  }).catch(notice);
}
function showFolder(source: FileSource) {
  openFolderDialog(source, path => openPath(source, path));
}
async function openRecentFolder(id: string) {
  // Home lists only remembered folders, and those always reopen as folders.
  const source = (await restoreSource(id))!;
  if ((await source.permission(true)) !== 'granted') return notice(`Gittin needs permission to open ${source.label}.`);
  showFolder(source);
}
/** The single entry for opening a source file. Returns an error reason for the folder panel, or null. */
async function openPath(source: FileSource, path: string, section = ''): Promise<string | null> {
  let disk: Disk;
  try {
    disk = await readDisk(source, path);
  } catch (error) {
    const failure = reason(error, source, path);
    notice(failure);
    return failure;
  }
  // A document still open in memory, or a stored draft, is checked against the disk the same way.
  const known = [...documents.values()].find(doc => isAt(doc.session.identity, source.id, path));
  const record = known ? null : await findDraft(source.id, path);
  let doc: OpenDocument;
  if (known || record) {
    doc = known ?? retain(record!);
    await reconcile(doc, disk);
  } else {
    doc = retain({
      ...newDraft({ source: disk.source, title: basename(path), fileType: fileTypeForName(path) }),
      identity: { kind: 'source', sourceId: source.id, path },
      localBaseline: { source: disk.source, revision: 0, version: disk.version },
    });
    await recordVersion(versionKey(source.id, path), 'opened', disk.source, disk.version);
  }
  navigate({ screen: 'editor', id: doc.session.id }, true, section);
  return null;
}
type Disk = { source: string; version: string };
async function readDisk(source: FileSource, path: string): Promise<Disk> {
  const read = await source.read(path);
  try {
    return { source: decodeSource(read.bytes), version: read.version };
  } catch {
    throw Error(`${basename(path)} is not a UTF-8 text file, so Gittin can't open it.`);
  }
}
/** Takes the file on disk as the saved version; `replace` also puts its text in the document. */
async function adopt(doc: OpenDocument, disk: Disk, replace: boolean) {
  if (replace) doc.session.applyWriteSource(disk.source, 'replace', doc.session.bookmark);
  const { source, version } = disk, { revision } = doc.session.current;
  await doc.autosave.updateMetadata({ localBaseline: { source, revision, version } });
}
/** A draft without unsaved changes follows the disk quietly (undoable); an edited one gets the banner. */
async function reconcile(doc: OpenDocument, disk: Disk) {
  doc.diskChange = undefined;
  if (doc.localBaseline?.version === disk.version) return;
  if (doc.localBaseline?.source === doc.session.current.source) await adopt(doc, disk, true);
  else doc.diskChange = disk;
}
const taken = (source: FileSource, path: string) =>
  `${basename(path)} already exists in ${dirname(path) || source.label}.`;
async function createFile(source: FolderSource, path: string) {
  try {
    const created = await source.create(path, new Uint8Array());
    if (created.kind === 'exists') {
      // The name in use may differ in letter case, or belong to a folder, which can't be opened.
      const { existing } = created, text = taken(source, existing.path);
      if (existing.kind === 'directory') return notice(text);
      if ((await ask('File already exists', text, [['Open it', 'open']])) !== 'open') return;
      path = existing.path;
    }
    await openPath(source, path);
  } catch (error) { notice(error); }
}
/** Why a file operation failed. A missing file reads the same from every source;
 * the browser's own wording names no file. */
const reason = (error: unknown, source?: FileSource, path?: string) =>
  error instanceof DOMException && error.name === 'NotFoundError' && source && path
    ? `${path} is not in ${source.label}.` : errorText(error);
/** Resolves with a failure reason for the dialog, or null once the folder exists. */
async function createFolder(source: FolderSource, path: string): Promise<string | null> {
  try {
    return (await source.createFolder(path)) === 'exists' ? taken(source, path) : null;
  } catch (error) { return reason(error); }
}
/** Rename or move a file in a folder. Its draft, version history and favourite follow it;
 * links are not rewritten. Resolves with a failure reason, or null. */
async function moveFile(source: FolderSource, from: string, to: string): Promise<string | null> {
  // Rename with the name unchanged.
  if (from === to) return null;
  try {
    if ((await source.move(from, to)) === 'exists') return taken(source, to);
  } catch (error) { return reason(error, source, from); }
  const open = [...documents.values()].find(doc => isAt(doc.session.identity, source.id, from));
  if (open) {
    open.session.identity = { kind: 'source', sourceId: source.id, path: to };
    // A save report names the old file.
    open.fileStatus = '';
    await open.autosave.updateMetadata({ title: basename(to), fileType: fileTypeForName(to) });
  } else await moveDraft(source.id, from, to).catch(notice);
  await moveVersions(versionKey(source.id, from), versionKey(source.id, to));
  if (workspace) { await transition(rebuild); refocus(); }
  return null;
}
/** Rebuild the workspace for a changed file location. A save or move is not an open, so keep the current view. */
async function rebuild() {
  if (!workspace) return;
  const doc = workspace.document, mode = doc.mode;
  await show({ screen: 'editor', id: doc.session.id });
  if (mode !== 'markdown' && workspace?.document === doc) workspace.controller.setMode(mode);
}
/** A rebuild replaces the control that had focus. Unless something else has taken it, the document
 * gets focus. Call after the transition: an inert page cannot take focus. */
function refocus() {
  if (workspace && document.activeElement === document.body) workspace.controller.focusDocument();
}
/** Delete a file, or a folder and everything in it, after asking.
 * Browsers cannot use the Recycle Bin, so this is permanent. */
function deleteEntry(source: FolderSource, path: string, kind: 'file' | 'directory') {
  void transition(async () => {
    const name = basename(path), count = kind === 'directory' ? await countFiles(source, path) : 0;
    let text = kind === 'file'
      ? `${name} is deleted permanently and does not go to the Recycle Bin.`
      : `${name} holds ${count === 1 ? '1 file' : `${count} files`}. ` +
        'The folder and everything in it are deleted permanently and do not go to the Recycle Bin.';
    // The transition has just stored the open file's draft, so stored drafts say what is unsaved.
    if ((await listRecent()).some(row => row.unsaved && isAt(row.identity, source.id, path)))
      text += ' Unsaved changes kept in this browser are deleted too.';
    if ((await ask(`Delete ${name}?`, text, [['Delete', 'delete']])) !== 'delete') return;
    try { await source.remove(path); } catch (error) { notice(reason(error, source, path)); return; }
    const affected = [...documents.values()].filter(doc => isAt(doc.session.identity, source.id, path));
    const active = !!workspace && affected.includes(workspace.document);
    affected.forEach(forget);
    await deleteDraftsAt(source.id, path).catch(notice);
    await clearVersionsAt(source.id, path);
    await (active ? show({ screen: 'home' }) : rebuild());
  }).then(refocus);
}
/** Resolves true once the browser has been given the file to download. */
async function download(doc = workspace?.document) {
  if (!doc || (workspace?.document === doc && !(await settle()))) return false;
  downloadMarkdown(doc.title, doc.session.current.source, doc.fileType);
  return true;
}
/** Starts writing the document to its file, unless a write is already under way. */
function startSave(doc: OpenDocument, saveAs: boolean, overwrite = false) {
  fileSave ??= writeFile(doc, saveAs, overwrite).finally(() => { fileSave = undefined; });
}
function saveFile(saveAs: boolean) {
  // writeFile opens the save picker immediately, within the user gesture.
  if (workspace && !navigating) startSave(workspace.document, saveAs);
}
function report(doc: OpenDocument, text: string) {
  doc.fileStatus = text;
  doc.fileStatusRevision = doc.session.current.revision;
  if (workspace?.document === doc) workspace.fileStatus(text);
}
/** Save the document to its file (or a new one). Resolves true once the file on disk holds this version. */
async function writeFile(doc: OpenDocument, saveAs: boolean, overwrite = false): Promise<boolean> {
  const identity = doc.session.identity, source = sourceFor(identity);
  const inPlace = !saveAs && identity.kind === 'source' && !!source?.writable;
  if (!inPlace && !canPickSaveLocation()) {
    if (await download(doc))
      report(doc, `Downloaded ${fileName(doc.title, doc.fileType)}. This browser cannot write files, ` +
        'so later edits stay in this browser until you save again.');
    return false;
  }
  const picker = inPlace ? null : pickSaveLocation(doc.title, doc.fileType);
  try {
    if (workspace?.document === doc && !(await settle())) { await picker; return false; }
    const version = { ...doc.session.current }, bytes = encodeSource(version.source);
    let target: { source: FileSource; path: string };
    if (picker) {
      const handle = await picker;
      if (!handle) { report(doc, 'Save canceled. Your changes are still kept in this browser.'); return false; }
      let folderPath: string | null = null, folder: FolderSource | undefined;
      for (const open of openSources()) {
        if (!(open instanceof FolderSource)) continue;
        folderPath = await open.locate(handle).catch(() => null);
        if (folderPath !== null) { folder = open; break; }
      }
      if (folder) target = { source: folder, path: folderPath! };
      else {
        // Test doubles and some browsers give nameless handles: fall back to the suggested name.
        const file = await addFile({ handle, name: handle.name ?? fileName(doc.title, doc.fileType) });
        target = { source: file, path: file.label };
      }
    } else target = { source: source!, path: (identity as { path: string }).path };
    const expected = picker || overwrite ? null : doc.localBaseline?.version ?? null;
    // A writable source, or the folder or file just picked, can write.
    const result = await target.source.write!(target.path, bytes, expected);
    if (result.kind === 'conflict') { showConflict(doc); return false; }
    doc.diskChange = undefined;
    if (picker) doc.session.identity = { kind: 'source', sourceId: target.source.id, path: target.path };
    const stored = await doc.autosave.updateMetadata({
      localBaseline: { ...version, version: result.version },
      ...(picker ? { title: basename(target.path), fileType: fileTypeForName(target.path) } : {}),
    });
    await recordVersion(versionKey(target.source.id, target.path), 'saved', version.source, result.version);
    const later = doc.session.current.revision === version.revision ? '' : ' Later edits are not saved yet.';
    const unrecorded = stored ? ''
      : ' The saved state could not be recorded in this browser; use the device status actions.';
    report(doc, `${picker ? 'Saved as' : 'Saved to'} ${basename(target.path)}.${later}${unrecorded}`);
    if (picker && workspace?.document === doc) { await rebuild(); refocus(); }
    return true;
  } catch (error) {
    report(doc, errorText(error));
    return false;
  }
}
function diskChoices(doc: OpenDocument) {
  const read = async () => {
    const identity = doc.session.identity, source = sourceFor(identity);
    if (!source || identity.kind !== 'source') throw Error('The file is unavailable.');
    return readDisk(source, identity.path);
  };
  const disk = () => (doc.diskChange ? Promise.resolve(doc.diskChange) : read());
  // Taken synchronously so the banner hides at once and later choices read the disk afresh.
  const take = () => { const d = doc.diskChange; doc.diskChange = undefined; return d ? Promise.resolve(d) : read(); };
  return {
    // Comparison shows in the editor, so it only applies to the active document.
    compare: () => void disk().then(d => {
      if (workspace?.document === doc) workspace.controller.setComparison(d.source, 'Version on disk');
    }, notice),
    useDisk: () => void take().then(d => adopt(doc, d, true), notice),
    keepMine: () => void take().then(d => adopt(doc, d, false), notice),
    saveAs: () => startSave(doc, true),
    overwrite: () => startSave(doc, false, true),
  };
}
function showConflict(doc: OpenDocument) {
  const identity = doc.session.identity;
  doc.diskChange = undefined;
  const choices = diskChoices(doc);
  const name = identity.kind === 'source' ? basename(identity.path) : doc.title;
  conflictDialog(name, workspace?.document === doc ? choices : { ...choices, compare: undefined });
}
/** The bare address opens Home for someone with recent work on this browser (files, folders or
 * unsaved work); `#/` always shows the landing page. */
async function startRoute(): Promise<Route> {
  const route = readRoute();
  if (route.screen !== 'landing' || location.hash !== '') return route;
  if (recentFolders().length || (await listRecent().catch(() => [])).length) return { screen: 'home' };
  return route;
}
window.addEventListener('hashchange', () => {
  if (location.hash === '#story') return;
  if (starting) pending = readRoute();
  else navigate(readRoute());
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void settle().then(ok => ok && flushAll());
});
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) workspace?.controller.dispose();
  void flushAll();
});
/** Starts Gittin. Each version hands in what only it has: the web app, its landing page. */
export function start(screens: { landing: () => HTMLElement }) {
  landing = screens.landing;
  void (async () => {
    root.inert = true;
    await prefs.load();
    await loadSources().catch(() => {});
    // The hash already holds any change made while loading.
    pending = undefined;
    try {
      await show(await startRoute());
    } catch (e) {
      notice(e);
      await show({ screen: 'home' });
    } finally {
      root.inert = false;
      navigating = starting = false;
    }
    if (pending) navigate(pending);
  })();
}
/** Before an update reloads Gittin: settles the editor and stores every open draft. False when one can't be stored. */
export async function saveDrafts() {
  if (!(await settle())) return false;
  if (await flushAll()) return true;
  notice('Some drafts could not be saved. Download them before updating Gittin.');
  return false;
}
