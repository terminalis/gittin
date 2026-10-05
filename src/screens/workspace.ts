import { icon } from '../ui/icons';
import {
  fileStatistics, openStatistics, openComparison, openResources, openAttributions, openEmail,
  type FolderLinks,
} from '../ui/tools-dialogs';
import { workspaceHelpDialog, gettingStarted, whatsNew, keyboardShortcuts } from '../ui/help';
import { defaultDisplay, type DisplaySettings } from '../editor/display';
import { headingAnchors } from '../editor/heading-anchors';
import { fileTypes, fileTypeForName, type FileType } from '../documents/file-types';
import { GittinController } from '../editor/controller';
import { openPreferences } from '../ui/preferences-dialog';
import { keysFor, pressed, shortcutHint, shortcuts } from '../ui/shortcuts';
import { EditorControls, toolbarGroups, toolbarLabel } from '../editor/controls/controls';
import { documentZoom } from '../editor/controls/toolbar';
import type { DocumentSession } from '../documents/session';
import type { DraftAutosave, DraftStatus } from '../documents/drafts';
import type { DevicePreferences } from '../preferences';
import type { Mode, SavedBaseline } from '../documents/types';
import type { FileSource } from '../sources/types';
import { diskChangeBanner, type DiskChoices } from '../ui/disk-change';
import { hasUnsavedChanges, locationText, saveState } from '../documents/save-state';
import { versionKey } from '../documents/versions';
import { isAt, sourceFor, sourceInfoFor } from '../sources/registry';
import { FolderSource } from '../sources/folder';
import { renderFolderPanel, imageFromFolderDialog } from '../ui/folder-panel';
import {
  detailsDialog, locationDialog, moveDialog, nameDialog, renameDialog,
} from '../ui/file-actions';
import { versionHistoryButton, openVersionHistory } from '../ui/version-history';
import { basename, fragment, relativePath, resolvePath, imageType } from '../sources/paths';
import { FindBar } from '../ui/find-bar';
import { Menus, editorActions, type Action } from '../ui/menus';
import {
  brand, button, el, iconButton, legalPages, markUnsaved, narrow, notice, onDocumentClick, segmented,
} from '../ui/dom';
export interface OpenDocument {
  session: DocumentSession;
  autosave: DraftAutosave;
  readonly title: string;
  readonly fileType: FileType;
  readonly favourite: boolean;
  readonly localBaseline: SavedBaseline | null;
  mode: Mode;
  fileStatus: string;
  /** The revision the file status describes; the status footer drops it once the text changes. */
  fileStatusRevision?: number;
  scrollTop?: number;
  /** Disk contents found on reopening that differ from both the draft and its saved baseline. */
  diskChange?: { source: string; version: string };
}
/** What the workspace asks of the app. */
export interface WorkspaceActions {
  home(): void;
  createLocal(source: string, title: string): void;
  new: (type?: FileType) => void;
  open(): void;
  openFolder(): void;
  openPath(source: FileSource, path: string, section?: string): Promise<string | null>;
  createFile(source: FolderSource, path: string): void;
  createFolder(source: FolderSource, path: string): Promise<string | null>;
  moveFile(source: FolderSource, from: string, to: string): Promise<string | null>;
  deleteEntry(source: FolderSource, path: string, kind: 'file' | 'directory'): void;
  switch(id: string): void;
  close(id: string): void;
  download(): void;
  save(saveAs: boolean): void;
  makeCopy(doc: OpenDocument): void;
  recovery(): void;
  diskChoices(doc: OpenDocument): DiskChoices;
}
/** Whether a file opened from a source has changes its file lacks. */
const unsaved = ({ session, localBaseline }: OpenDocument) =>
  hasUnsavedChanges(session.identity, session.current, localBaseline);
/** One command: its menu, id, label and action, then any other fields of Action. */
type Row = [menu: string, id: string, label: string, run: () => void, more?: Partial<Action>];
/** Each view's name: its button reads "Preview", its command "Preview view". */
const modeNames: Record<Mode, string> = { markdown: 'Edit', preview: 'Preview', diff: 'Diff' };
/** What #draft-status says for each autosave state but an error, which names its cause. */
const draftStatusText: Record<Exclude<DraftStatus['kind'], 'error'>, string> = {
  saved: 'Draft saved on this device',
  saving: 'Saving draft on this device…',
  pending: 'Draft changes waiting to save on this device.',
  conflict: 'A newer draft is stored on this device. '
    + 'Download your work or save a recovery copy to keep both versions.',
};
/** Sets attributes that reflect no string property: aria-controls and the like. */
const attrs = <T extends Element>(element: T, values: Record<string, string>) => {
  for (const [name, value] of Object.entries(values)) element.setAttribute(name, value);
  return element;
};
const dataURL = (blob: Blob) => new Promise<string>((done, fail) => {
  const reader = new FileReader();
  reader.onload = () => done(reader.result as string);
  reader.onerror = () => fail(reader.error);
  reader.readAsDataURL(blob);
});
export class Workspace {
  readonly element = el('section', { id: 'workspace' });
  readonly controller = new GittinController();
  readonly document: OpenDocument;
  private controls: EditorControls;
  private find: FindBar;
  private menus: Menus;
  private subscriptions: (() => void)[] = [];
  private abort = new AbortController();
  private outlineTimer?: ReturnType<typeof setTimeout>;
  private left = !narrow.matches;
  private right = this.left;
  private focus = false;
  private printing = false;
  // Set for a file opened from a folder, so Linked resources can open relative targets.
  private folderLinks?: FolderLinks;
  constructor(
    doc: OpenDocument,
    private readonly documents: OpenDocument[],
    private readonly prefs: DevicePreferences,
    private readonly actions: WorkspaceActions
  ) {
    this.document = doc;
    this.element.append(...this.markup());
    this.controller.mount(this.part('#editor'), doc.session, 'markdown', doc.fileType);
    this.find = new FindBar(this.controller);
    this.controls = new EditorControls(this.controller, () => this.find.open(),
      () => this.toggleMenus(), percent => { void prefs.save({ documentZoom: percent }); });
    this.part('#controls').append(this.controls.element);
    this.part('.writing-column').prepend(this.find.element);
    this.applyDisplay();
    // Diagrams take the appearance's colours; most preference changes leave it as it was.
    let appearance = prefs.appearance;
    this.subscriptions.push(prefs.subscribe(() => {
      this.applyPreferences();
      if (prefs.appearance === appearance) return;
      appearance = prefs.appearance;
      void this.controller.redrawDiagrams();
    }));
    // Menus calls this before running any command, so the phone menu row closes once one is chosen.
    const commands = [...this.catalogue(), ...editorActions(this.controller, this.controls)];
    const chosen = () => { this.showPhoneMenus(false); this.controller.focusDocument(); };
    this.menus = new Menus(commands, chosen);
    this.menus.element.id = 'workspace-menus';
    this.part('.document-identity').append(this.menus.element);
    this.subscriptions.push(
      // A tap outside the header closes the phone menu row, as menus and drawers already dismiss.
      onDocumentClick([this.part('.workspace-header')], () => this.showPhoneMenus(false)),
      this.controller.subscribeMode(mode => { doc.mode = mode; this.find.changed(); this.update(); }),
      this.controller.subscribeToolbar(() => { this.updateCaret(); this.centreCaret(); }),
      this.controller.subscribeNotice(notice),
      doc.session.subscribe(() => { this.update(); this.find.changed(); }),
      doc.autosave.subscribe(status => this.showDraftStatus(status))
    );
    narrow.addEventListener('change', () => {
      if (narrow.matches) this.left = this.right = false;
      this.layout();
    }, { signal: this.abort.signal });
    this.listenForPrint();
    this.showDiskChange();
    this.wireFolder();
    doc.session.endGroup();
    this.renderDocuments();
    this.update();
    // The outline waits for typing to pause; a file that has just opened shows its outline at once.
    clearTimeout(this.outlineTimer);
    this.updateOutline();
    this.layout();
    window.addEventListener('keydown', e => this.onKeyDown(e), { signal: this.abort.signal });
  }
  private part<T extends HTMLElement = HTMLElement>(selector: string) {
    return this.element.querySelector<T>(selector)!;
  }
  private get identity() { return this.document.session.identity; }
  /** The open file's path in its source; empty for a file only in this browser. */
  private path() { const id = this.identity; return id.kind === 'source' ? id.path : ''; }
  private info() { return sourceInfoFor(this.identity); }
  private source() { return sourceFor(this.identity) ?? null; }
  /** The open file's folder, when Gittin can rename, move and delete files in it. */
  private managed() {
    const source = this.source();
    return source instanceof FolderSource ? source : null;
  }
  /** The header, tools row, side panels, writing column and recovery bar, wired to their commands. */
  private markup() {
    const doc = this.document, actions = this.actions, identity = this.identity;
    const title = Object.assign(button(doc.title, () => this.rename()),
      { id: 'document-title', title: 'Rename file' });
    const favourite = Object.assign(iconButton('star', 'Add favourite', () => this.toggleFavourite()),
      { id: 'favourite' });
    const location = Object.assign(
      iconButton('folder', 'File location', () => locationDialog(this.identity)), { id: 'location' });
    const history = versionHistoryButton(identity.kind === 'source', () => this.openHistory());
    const save = Object.assign(button('Save', () => actions.save(false), 'primary'),
      { id: 'save-file', title: `Save (${shortcutHint(keysFor('save')!)})` });
    const flipMenus = () =>
      this.showPhoneMenus(!this.part('.workspace-header').classList.contains('menus-open'));
    const menusToggle = Object.assign(iconButton('menu-2', 'Menus', flipMenus),
      { id: 'menus-toggle', ariaExpanded: 'false' });
    attrs(menusToggle, { 'aria-controls': 'workspace-menus' });
    const header = el('header',
      { id: 'workspace-header', className: 'workspace-header', innerHTML: brand('#/home', true) },
      el('div', { className: 'document-identity' },
        el('div', { className: 'document-title-row' }, title, favourite, location)),
      el('div', { className: 'workspace-header-actions' }, history,
        el('div', { className: 'save-split' }, save),
        menusToggle));

    const label = (text: string) => el('span', { className: 'panel-label', textContent: text });
    const files = Object.assign(iconButton('files', 'Files', () => this.toggle('left')),
      { id: 'documents-toggle' });
    files.prepend(icon('layout-sidebar-left-collapse'));
    files.append(' ', label('Files'));
    const folder = Object.assign(iconButton('folder', 'Folder', () => this.toggle('right')),
      { id: 'repository-toggle' });
    folder.prepend(label('Folder'), ' ');
    folder.append(icon('layout-sidebar-right-collapse'));
    attrs(files, { 'aria-controls': 'documents-panel' });
    attrs(folder, { 'aria-controls': 'repository-panel' });
    const modes = Object.entries(modeNames) as [Mode, string][];
    const view = segmented('Document view', modes, () => this.controller.getMode(),
      mode => this.controller.setMode(mode));
    modes.forEach(([mode], i) => { (view.children[i] as HTMLElement).dataset.mode = mode; });
    const preview = view.querySelector('[data-mode="preview"]')!;
    for (const event of ['mouseenter', 'focus'])
      preview.addEventListener(event, () => this.updatePreviewTooltip());
    const tools = el('div', { className: 'workspace-tools' }, files, view, folder);

    const documents = el('aside', { id: 'documents-panel', ariaLabel: 'Open Files' },
      el('h2', { textContent: 'Open Files' }), el('div', { id: 'open-documents' }),
      el('h2', { textContent: 'Outline' }),
      el('nav', { id: 'outline', ariaLabel: 'Document outline' }));
    const status = el('div', { className: 'editor-status' },
      el('span', { id: 'file-stats', hidden: true }), el('span', { id: 'caret-status', hidden: true }),
      el('span', { id: 'save-state' }), el('span', { id: 'view-status' }),
      el('span', { id: 'file-status', role: 'status' }));
    const focus = Object.assign(button('', () => this.toggle('focus')), { id: 'focus-toggle' });
    const column = el('main', { className: 'writing-column' },
      el('div', { id: 'access-bar', hidden: true }), el('div', { id: 'disk-change-host' }),
      el('div', { id: 'editor' }), el('footer', { className: 'editor-footer' }, status, focus));
    const body = el('div', { className: 'workspace-body' }, documents, column,
      el('aside', { id: 'repository-panel', ariaLabel: 'Folder' }));
    // On narrow screens the dimmed area behind an open drawer is .workspace-body's own ::after overlay.
    body.addEventListener('click', event => {
      if (!narrow.matches || event.target !== event.currentTarget || !(this.left || this.right)) return;
      this.left = this.right = false;
      this.layout();
    });

    const recovery = el('div', { className: 'recovery-actions', hidden: true },
      el('p', { id: 'draft-status', role: 'status' }),
      Object.assign(button('Retry', () => void doc.autosave.flush()), { id: 'retry', hidden: true }),
      Object.assign(button('Save recovery copy', actions.recovery), { id: 'recovery-copy' }),
      Object.assign(button('Download recovery copy', actions.download), { id: 'status-download' }));
    const formatting = el('div', { className: 'formatting-row' }, el('div', { id: 'controls' }));
    return [header, formatting, tools, body, recovery];
  }
  /** The File, View, Tools and Help commands, in command search order; editorActions adds the rest. */
  private catalogue(): Action[] {
    const doc = this.document, actions = this.actions, prefs = this.prefs;
    const managed = { state: () => ({ disabled: !this.managed() }) };
    const selected = (on: () => boolean) => ({ state: () => ({ selected: on() }) });
    const [privacy, terms, notices] = legalPages;
    const page = (id: string, [label, url]: readonly [string, string]): Row =>
      ['Help', id, label, () => void window.open(url, '_blank', 'noopener,noreferrer')];
    const display = ([
      ['showComments', 'Show comments'],
      ['syntaxHighlighting', 'Syntax highlighting'],
      ['whitespace', 'Show whitespace'],
      ['wordWrap', 'Word wrap'],
    ] as const).map(([key, label]): Row => ['View', key, label, () => this.toggleDisplay(key),
      selected(() => prefs.value[key] ?? defaultDisplay[key])]);
    const groups = () => prefs.value.toolbarGroups ?? {}, items = () => prefs.value.toolbarItems ?? {};
    const toolbar = toolbarGroups.flatMap(({ id: group, label, items: ids }): Row[] => [
      ['View/Toolbar/' + label, 'toolbar-group-' + group, 'Show ' + label,
        () => void prefs.save({ toolbarGroups: { ...groups(), [group]: groups()[group] === false } }),
        selected(() => groups()[group] !== false)],
      ...ids.map((id): Row => ['View/Toolbar/' + label, 'toolbar-item-' + id, toolbarLabel(id),
        () => void prefs.save({ toolbarItems: { ...items(), [id]: items()[id] === false } }),
        selected(() => items()[id] !== false)]),
    ]);
    const about = 'Gittin has no accounts. Your files stay on your device. '
      + 'Save writes back to the file you opened; Save as writes a new file. '
      + 'Unsaved changes are kept in this browser, which you or the browser can clear. '
      + 'After its first visit, Gittin can start offline on this device.';
    const rows: Row[] = [
      ['File', 'home', 'Home', actions.home],
      ['File/New', 'new', 'File', () => actions.new()],
      ...fileTypes.map((type): Row => ['File/New', 'new-' + type.id,
        `${type.label} (${type.extensions.join(', ')})`, () => actions.new(type.id)]),
      ['File/Open', 'open', 'Open file…', actions.open],
      ['File/Open', 'open-folder', 'Open folder…', actions.openFolder],
      ['File', 'make-copy', 'Make a copy', () => actions.makeCopy(doc)],
      ['File/Email', 'email-file', 'Email this file',
        () => doc.localBaseline && openEmail(doc.title, doc.localBaseline.source, false),
        { state: () => ({ disabled: !doc.localBaseline }) }],
      ['File/Email', 'email-draft', 'Email this draft',
        () => openEmail(doc.title, doc.session.current.source, true)],
      ['File', 'save', 'Save', () => actions.save(false)],
      ['File', 'save-as', 'Save as…', () => actions.save(true)],
      // The header's Version history button runs this too; the ellipsis keeps their names apart.
      ['File', 'version-history', 'Version history…', () => this.openHistory(),
        { state: () => ({ disabled: this.identity.kind !== 'source' }) }],
      ['File', 'rename', 'Rename…', () => this.rename()],
      ['File', 'move', 'Move to…', () => this.move(), managed],
      ['File', 'delete-file', 'Delete file…', () => {
        const folder = this.managed();
        if (folder) actions.deleteEntry(folder, this.path(), 'file');
      }, managed],
      ['File', 'location', 'Location', () => locationDialog(this.identity)],
      ['File', 'favourite', 'Add/remove favourite', () => this.toggleFavourite(),
        selected(() => doc.favourite)],
      ['File', 'details', 'Details', () => this.details()],
      ['File', 'print', 'Print', () => void this.print()],
      ['File', 'download-pdf', 'Download as PDF…', () => void this.print(true)],
      ['File', 'close', 'Close file', () => actions.close(doc.session.id)],
      ['Edit', 'find', 'Find and replace', () => this.find.open()],
      ['Help', 'commands', 'Search the menus', () => this.menus.search()],
      ['View', 'line-numbers', 'Line numbers',
        () => void prefs.save({ lineNumbers: prefs.value.lineNumbers === false }),
        selected(() => prefs.value.lineNumbers !== false)],
      ...display,
      ['View', 'fullscreen', 'Full screen', () => void this.fullscreen(),
        selected(() => document.fullscreenElement === this.element)],
      ['View', 'focus', 'Focus mode', () => this.toggle('focus'), selected(() => this.focus)],
      ...(Object.keys(modeNames) as Mode[]).map((mode): Row => ['View/Mode', mode,
        modeNames[mode] + ' view', () => this.controller.setMode(mode),
        selected(() => this.controller.getMode() === mode)]),
      ...(['light', 'dark', 'system'] as const).map((theme): Row => ['View/Appearance', theme,
        theme[0].toUpperCase() + theme.slice(1) + ' appearance', () => void prefs.save({ theme }),
        selected(() => prefs.value.theme === theme)]),
      ['Tools', 'statistics', 'File statistics…',
        () => openStatistics(doc.session.current.source, prefs)],
      ['Tools', 'compare-files', 'Compare files…', () => openComparison(this.controller)],
      ['Tools', 'attributions', 'Attributions…',
        () => openAttributions(this.controller, actions.createLocal),
        { state: () => ({ disabled: !this.controller.isEditable() }) }],
      ['Tools', 'linked-resources', 'Linked resources…',
        () => openResources(this.controller, doc.session.current.source, this.folderLinks)],
      ['Tools', 'preferences', 'Preferences…', () => openPreferences(prefs, this.controller)],
      ...toolbar,
      ['View/Toolbar', 'reset-toolbar', 'Reset toolbar',
        () => void prefs.save({ toolbarGroups: {}, toolbarItems: {} })],
      ['Help', 'gittin-help', 'Gittin Help',
        () => workspaceHelpDialog(this.part('.workspace-body'), this.abort.signal)],
      ['Help', 'getting-started', 'Getting Started', gettingStarted],
      ['Help', 'whats-new', "What's new", whatsNew],
      page('feedback', ['Send feedback…', 'https://github.com/terminalis/gittin/issues/new']),
      page('privacy', privacy),
      page('terms', terms),
      ['Help', 'shortcuts', 'Keyboard shortcuts', () => keyboardShortcuts()],
      ['Help', 'about', 'About drafts and files', () => notice(about)],
      page('notices', notices),
    ];
    return rows.map(([menu, id, label, run, more]) => ({ id, label, menu, run, ...more }));
  }
  // In a managed folder Rename renames the file on disk; elsewhere it names the title used for Save as
  // and downloads.
  private rename() {
    const folder = this.managed();
    if (folder) renameDialog(this.path(), (from, to) => this.actions.moveFile(folder, from, to));
    else nameDialog('Rename file', 'File name', 'Rename', this.document.title, async title => {
      const doc = this.document;
      const fileType = /\.[^.]+$/.test(title) ? fileTypeForName(title) : doc.fileType;
      this.controller.setFileType(fileType);
      return await doc.autosave.updateMetadata({ title, fileType }) ? null
        : 'Rename is kept in this session, but recovery storage could not be updated. '
          + 'Use the device status actions.';
    });
  }
  private move() {
    const folder = this.managed();
    if (folder) moveDialog(folder, this.path(), (from, to) => this.actions.moveFile(folder, from, to));
  }
  private toggleFavourite() {
    void this.document.autosave.updateMetadata({ favourite: !this.document.favourite });
  }
  private details() {
    const doc = this.document;
    detailsDialog(doc.fileType, doc.session.current.source, this.identity, [
      this.part('#draft-status').textContent,
      doc.fileStatus || 'No device-file save acknowledged in this session.',
      doc.localBaseline ? 'Comparison baseline available.' : 'No comparison baseline yet.',
    ].join(' '));
  }
  private openHistory() {
    const identity = this.identity;
    if (identity.kind !== 'source') return;
    openVersionHistory(versionKey(identity.sourceId, identity.path), {
      compare: (text, label) => this.controller.setComparison(text, label),
      restore: text => this.controller.replaceSource(text),
    });
  }
  /** Phones (600px and narrower): the menu row is hidden behind the Menus button until opened. */
  private showPhoneMenus(open: boolean) {
    this.part('.workspace-header').classList.toggle('menus-open', open);
    this.part('#menus-toggle').setAttribute('aria-expanded', String(open));
  }
  /** Comments, syntax colours, whitespace and wrapping, from the saved preferences. */
  private applyDisplay() {
    this.controller.setDisplaySettings(Object.fromEntries(Object.entries(defaultDisplay)
      .map(([key, value]) => [key, this.prefs.value[key as keyof DisplaySettings] ?? value])));
    this.find.changed();
  }
  private toggleDisplay(key: keyof DisplaySettings) {
    void this.prefs.save({ [key]: !(this.prefs.value[key] ?? defaultDisplay[key]) });
    this.applyDisplay();
  }
  private applyPreferences() {
    const prefs = this.prefs.value, header = this.part('.workspace-header');
    this.controller.setPreferences(prefs);
    this.controls.setVisibility(prefs);
    this.element.classList.toggle('hide-line-numbers', prefs.lineNumbers === false);
    const zoom = documentZoom(prefs.documentZoom);
    this.part('#editor').style.setProperty('--document-zoom', String(zoom / 100));
    this.controls.setZoom(zoom);
    const hidden = prefs.menusHidden === true;
    const moveFocus = hidden && header.contains(document.activeElement);
    header.classList.toggle('menus-hidden', hidden);
    this.controls.setMenusHidden(hidden);
    if (moveFocus) this.part('.toolbar-menu-toggle').focus();
    this.updateStatistics();
  }
  private showDraftStatus(status: DraftStatus) {
    const doc = this.document, title = this.part('#document-title'), star = this.part('#favourite');
    this.controller.setBaseline(doc.localBaseline);
    // A new title also renames the file in Open Files.
    if (title.textContent !== doc.title) { title.textContent = doc.title; this.renderDocuments(); }
    title.setAttribute('aria-label', 'Rename ' + doc.title);
    document.title = doc.title + ' — Gittin';
    const favourite = doc.favourite ? 'Remove favourite' : 'Add favourite';
    star.replaceChildren(icon(doc.favourite ? 'star-filled' : 'star'));
    Object.assign(star, { ariaLabel: favourite, ariaPressed: `${doc.favourite}`, title: favourite });
    this.part('#draft-status').textContent = status.kind === 'error'
      ? 'Draft could not be saved on this device. ' + status.message : draftStatusText[status.kind];
    this.part('.recovery-actions').hidden = status.kind !== 'error' && status.kind !== 'conflict';
    this.part('#retry').hidden = status.kind !== 'error';
    this.updateSaveState();
    if (!doc.diskChange) this.element.querySelector('#disk-change')?.remove();
  }
  private showDiskChange() {
    const host = this.part('#disk-change-host'), doc = this.document, identity = this.identity;
    host.replaceChildren();
    if (doc.diskChange && identity.kind === 'source')
      host.append(diskChangeBanner(basename(identity.path), this.actions.diskChoices(doc),
        () => this.showDiskChange()));
  }
  /** The Folder panel, its access bar, Insert › Image › From folder…, images and relative links. */
  private wireFolder() {
    const actions = this.actions, access = this.part('#access-bar');
    // A single file has no folder to show: the panel offers Open folder… instead.
    const single = this.source()?.kind === 'file', folder = single ? null : this.source();
    const managed = this.managed();
    const renderPanel = (needsAccess: boolean) => {
      const identity = this.identity, info = this.info();
      renderFolderPanel(this.part('#repository-panel'), {
        source: needsAccess ? null : folder,
        label: identity.kind === 'source' && !single ? info?.label ?? null : null,
        current: identity.kind === 'source' ? identity.path : null,
        unavailable: needsAccess ? `Allow access to ${folder?.label} to see its files.`
          : single ? 'This file was opened on its own, not from a folder.'
          : identity.kind === 'source' && !folder ? locationText(identity, info) : null,
        open: path => actions.openPath(folder!, path),
        openFolder: actions.openFolder,
        // Only a folder Gittin can write to offers new files and folders, and the ⋯ menus.
        ...(managed && {
          newFile: (path: string) => actions.createFile(managed, path),
          createFolder: (path: string) => actions.createFolder(managed, path),
          move: (from: string, to: string) => actions.moveFile(managed, from, to),
          remove: (path: string, kind: 'file' | 'directory') =>
            actions.deleteEntry(managed, path, kind),
        }),
        grant: needsAccess ? grant : undefined,
        // Rows are shown only with a folder.
        unsaved: path =>
          this.documents.some(d => isAt(d.session.identity, folder!.id, path) && unsaved(d)),
        signal: this.abort.signal,
      });
    };
    const grant = async () => {
      if (folder instanceof FolderSource && (await folder.permission(true)) === 'granted') {
        access.hidden = true;
        renderPanel(false);
      }
    };
    if (folder instanceof FolderSource) void folder.permission(false).then(state => {
      const needs = state !== 'granted';
      access.hidden = !needs;
      access.replaceChildren(button(`Allow access to ${folder.label}`, () => void grant()));
      renderPanel(needs);
    });
    else renderPanel(false);
    // Left unset outside a folder, which disables Insert › Image › From folder….
    this.controls.onFolderImage = folder ? () => imageFromFolderDialog(folder, this.path(),
      path => { this.controller.insertElement({ kind: 'image', url: path, text: '' }); }, relativePath)
      : undefined;
    if (folder) {
      const urls = new Map<string, Promise<string | null>>();
      const resolve = (reference: string) => resolvePath(this.path(), reference);
      const image = (src: string) => {
        const path = resolve(src);
        if (path === null) return Promise.resolve(null);
        let url = urls.get(path);
        // An SVG, or a file whose extension isn't a known image type, gets a data: address, not a blob:
        // one: the browser's Open image in new tab loads a blob: address as a page in Gittin's origin
        // (WebKit sniffs an untyped one as HTML), where a script would run as Gittin; a data: page has
        // an origin of its own. Known raster types stay blob: URLs.
        if (!url) urls.set(path, (url = folder.read(path).then(({ bytes }) => {
          const blob = new Blob([bytes as BlobPart], { type: imageType(path) });
          return blob.type && blob.type !== 'image/svg+xml' ? URL.createObjectURL(blob) : dataURL(blob);
        }).catch(() => { urls.delete(path); return null; })));
        return url;
      };
      this.controller.setImageResolver(image);
      const open = (path: string, section?: string) => actions.openPath(folder, path, section);
      this.folderLinks = { resolve, open, image };
      this.subscriptions.push(() =>
        urls.forEach(url => void url.then(u => u && URL.revokeObjectURL(u))));
    }
    // Preview and link details hand relative links here rather than letting the browser load them
    // from the Gittin host.
    this.controller.setLinkOpener(href => {
      const path = this.folderLinks?.resolve(href) ?? null;
      if (!this.folderLinks) notice('Target unavailable without a file opened from a folder.');
      else if (path === null) notice('Target is outside this folder.');
      else void this.folderLinks.open(path, fragment(href));
    });
  }
  /** Save, Print, hide menus, Find, command search, and Escape out of Focus mode. */
  private onKeyDown(e: KeyboardEvent) {
    if (e.altKey || e.getModifierState('AltGraph') || e.isComposing) return;
    const run: Record<string, () => void> = {
      save: () => this.actions.save(false), print: () => void this.print(),
      menus: () => this.toggleMenus(), find: () => this.find.open(), commands: () => this.menus.search(),
    };
    // A modal dialog keeps the menus as they are.
    const shortcut = shortcuts.find(({ id, keys }) => id in run && pressed(e, keys)
      && !(id === 'menus' && document.querySelector('dialog:modal')));
    if (shortcut) {
      e.preventDefault();
      if (!e.repeat) run[shortcut.id]();
      return;
    }
    const inDialog = e.target instanceof Element && e.target.closest('dialog');
    if (e.key === 'Escape' && this.focus && !this.element.querySelector('dialog[open]') && !inDialog)
      this.toggle('focus');
  }
  private renderDocuments() {
    this.part('#open-documents').replaceChildren(...this.documents.map(doc => {
      const b = button(doc.title, () => this.actions.switch(doc.session.id));
      b.setAttribute('aria-current', String(doc === this.document));
      const identity = doc.session.identity;
      b.title = identity.kind === 'source' ? identity.path : 'Only in this browser';
      markUnsaved(b, unsaved(doc));
      return el('div', { className: 'open-document' }, b,
        iconButton('x', 'Close ' + doc.title, () => this.actions.close(doc.session.id)));
    }));
  }
  private updatePreviewTooltip() {
    const button = this.part('[data-mode="preview"]');
    const description = this.controller.getPreviewDescription();
    button.title = description;
    button.setAttribute('aria-description', description);
  }
  private update() {
    const mode = this.controller.getMode();
    for (const b of this.element.querySelectorAll<HTMLElement>('[data-mode]'))
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    if (mode === 'preview') this.updatePreviewTooltip();
    this.controls.refresh();
    this.updateStatistics();
    this.updateCaret();
    this.part('#view-status').textContent =
      modeNames[mode] + (mode === 'markdown' ? '' : ' · read-only');
    clearTimeout(this.outlineTimer);
    this.outlineTimer = setTimeout(() => this.updateOutline(), 150);
    const current = this.document.fileStatusRevision === this.document.session.current.revision;
    this.part('#file-status').textContent = current ? this.document.fileStatus : '';
    this.updateSaveState();
  }
  private updateSaveState() {
    const doc = this.document;
    const state = saveState(this.identity, doc.session.current, doc.localBaseline, this.info());
    this.part('#save-state').textContent = state;
    // Save stays enabled; it is only quieter once the file on disk matches.
    this.part('.save-split').classList.toggle('saved', state === 'Saved');
    const rows = this.element.querySelectorAll<HTMLElement>(
      '#open-documents button[aria-current="true"], #repository-panel .folder-row[aria-current="true"]'
    );
    for (const row of rows) markUnsaved(row, unsaved(doc));
  }
  private updateStatistics() {
    const output = this.part('#file-stats');
    output.hidden = !this.prefs.value.showStatsWhileTyping;
    if (output.hidden) return;
    const stats = fileStatistics(this.document.session.current.source);
    output.textContent = `${stats.words} words · ${stats.characters} characters · `
      + `${stats.lines} lines · ${stats.bytes} bytes`;
  }
  private updateCaret() {
    const caret = this.controller.caretPosition();
    const output = this.part('#caret-status');
    output.hidden = !caret;
    output.textContent = caret ? `Ln ${caret.line}, Col ${caret.column}` : '';
  }
  /** Typewriter scrolling: in Focus mode the typing line stays in the middle of the writing column. */
  private centreCaret() {
    if (!this.focus) return;
    const top = this.controller.caretTop();
    if (top === null) return;
    const column = this.part('.writing-column');
    const bounds = column.getBoundingClientRect();
    column.scrollTop += top - (bounds.top + bounds.height / 2);
  }
  private updateOutline() {
    const outline = this.part('#outline');
    outline.replaceChildren();
    if (this.document.fileType !== 'markdown') {
      outline.textContent = 'Outline is available for Markdown files.';
      return;
    }
    const headings = headingAnchors(this.document.session.current.source);
    if (!headings.length) outline.textContent = 'Headings in this file appear here.';
    for (const heading of headings) {
      const b = button(heading.text, () => this.controller.goToSource(heading.from));
      b.style.paddingLeft = `${8 + (heading.level - 1) * 12}px`;
      b.dataset.headingId = heading.id;
      outline.append(b);
    }
  }
  private async fullscreen() {
    try {
      if (document.fullscreenElement === this.element) await document.exitFullscreen();
      else if (this.element.requestFullscreen) await this.element.requestFullscreen();
      else notice('Full screen is unavailable in this browser. Focus mode remains available.');
    } catch {
      notice('The browser declined full screen. Use its full-screen control or Focus mode.');
    }
  }
  /** Browser-menu Print enters through beforeprint; app print paths have already rendered #print-file. */
  private listenForPrint() {
    const signal = this.abort.signal, rendered = () => document.querySelector('#print-file');
    window.addEventListener('beforeprint', () => {
      if (!rendered()) void this.preparePrint();
    }, { signal });
    window.addEventListener('afterprint', () => rendered()?.remove(), { signal });
  }
  private async print(asPdf = false) {
    // A second request while the first still loads its libraries would open a second dialog.
    if (this.printing) return;
    this.printing = true;
    try { await this.printOnce(asPdf); } finally { this.printing = false; }
  }
  private async printOnce(asPdf: boolean) {
    if (!(await this.controller.settleForPersistence())) {
      notice('Finish composing text before printing.');
      return;
    }
    await this.preparePrint();
    if (asPdf) {
      // Browsers name the saved PDF after the page title.
      const title = document.title;
      document.title = this.document.title.replace(/\.[^.]+$/, '');
      window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
      notice('Choose Save as PDF as the destination in the print dialog.');
    }
    window.print();
  }
  /** Native beforeprint is synchronous: the text renders at once; maths, diagrams and emoji finish later. */
  private async preparePrint() {
    const markdown = this.document.fileType === 'markdown';
    const source = this.document.session.current.source;
    // Paper uses Preview's document styles.
    const kind = markdown ? 'document-markdown' : 'document-source';
    const print = el('article', { id: 'print-file', className: 'ProseMirror ' + kind });
    print.dataset.readable = '';
    document.querySelector('#print-file')?.remove();
    document.body.append(print);
    if (markdown) await this.controller.renderReadOnly(source, print);
    else print.append(el('pre', { textContent: source }));
  }
  fileStatus(text: string) {
    this.document.fileStatus = text;
    this.part('#file-status').textContent = text;
  }
  private toggleMenus() {
    this.menus.closeMenus();
    void this.prefs.save({ menusHidden: !this.prefs.value.menusHidden });
  }
  private toggle(which: 'left' | 'right' | 'focus') {
    this[which] = !this[which];
    if (narrow.matches && which !== 'focus' && this[which])
      this[which === 'left' ? 'right' : 'left'] = false;
    this.layout();
  }
  private layout() {
    this.element.classList.toggle('hide-documents', !this.left);
    this.element.classList.toggle('hide-repository', !this.right);
    this.element.classList.toggle('focus-mode', this.focus);
    this.part('#documents-toggle').setAttribute('aria-expanded', String(this.left && !this.focus));
    this.part('#repository-toggle').setAttribute('aria-expanded', String(this.right && !this.focus));
    this.part('#focus-toggle').replaceChildren(icon(this.focus ? 'minimize' : 'focus-2'),
      this.focus ? 'Exit focus' : 'Focus');
    this.centreCaret();
  }
  restoreScroll() { this.part('.writing-column').scrollTop = this.document.scrollTop ?? 0; }
  dispose() {
    document.querySelector('#print-file')?.remove();
    this.document.scrollTop = this.part('.writing-column').scrollTop;
    clearTimeout(this.outlineTimer);
    this.abort.abort();
    this.subscriptions.forEach((fn) => fn());
    this.find.dispose();
    this.menus.dispose();
    this.controls.dispose();
    this.controller.dispose();
    this.element.remove();
  }
}
