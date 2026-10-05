import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

// Modules loaded at runtime by the helpers below.
const DRAFTS = '/src/documents/drafts.ts';
const PREFERENCES = '/src/preferences.ts';
const COMMANDS = '/src/editor/commands.ts';

/** The Edit surface. Use EDITOR inside page.evaluate, where locators can't go. */
export const EDITOR = '.md-mode .ProseMirror';
export const editor = (page: Page) => page.locator(EDITOR);
/** The Preview surface. Scoped, because printed output also carries data-readable. */
export const readable = (page: Page) => page.locator('.gittin-unsupported [data-readable]');
/** The note above Preview and Diff, such as "No changes since the file was opened or saved." */
export const notice = (page: Page) => page.locator('.view-notice');
/** The Find bar's search field and its match count. */
export const findField = (page: Page) =>
  page.getByRole('searchbox', { name: 'Find in current document' });
export const findResult = (page: Page) => page.locator('.find-bar output');

/** Collects uncaught page errors; expect it to be empty at the end of a test. */
export function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Collects requests; the result lists those to other hosts. Call it while the app is shown. */
export function outsideRequests(page: Page) {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return () => {
    const origin = new URL(page.url()).origin;
    return urls.filter((url) => /^https?:/.test(url) && !url.startsWith(origin + '/'));
  };
}

export const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const pickerNames = {
  open: 'showOpenFilePicker',
  save: 'showSaveFilePicker',
  directory: 'showDirectoryPicker',
};
/** Makes the app use its file-input and download fallbacks from the next navigation on. */
export async function withoutPickers(page: Page, ...pickers: (keyof typeof pickerNames)[]) {
  const names = pickers.map((picker) => pickerNames[picker]);
  await page.addInitScript((names) => {
    for (const name of names) (window as any)[name] = undefined;
  }, names);
}

/** Skips the enclosing describe outside Chromium, the only browser with folder access. */
export const chromiumOnly = () =>
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'showDirectoryPicker is Chromium only',
  );

export async function home(page: Page) {
  // Going to the address Home already has reloads in WebKit and drops the open documents.
  if (!page.url().endsWith('#/home')) await page.goto('/#/home');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open file', exact: true })).toBeEnabled();
}

export async function newFile(page: Page) {
  await home(page);
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

/** Opens text through Open file (no file handle) and waits for its title. */
export async function openText(
  page: Page,
  source: string | Buffer,
  name = 'notes.md',
  { type = 'text/markdown', timeout }: { type?: string; timeout?: number } = {},
) {
  await withoutPickers(page, 'open');
  await home(page);
  // home() doesn't navigate when Home is already shown, so the init script hasn't run yet.
  await page.evaluate(() => {
    (window as any).showOpenFilePicker = undefined;
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  const buffer = typeof source === 'string' ? Buffer.from(source) : source;
  await (await chooser).setFiles({ name, mimeType: type, buffer });
  await expect(page.locator('#document-title')).toHaveText(name, { timeout });
}

export const expectDraftSaved = (page: Page) =>
  expect(page.locator('#draft-status')).toHaveText('Draft saved on this device');

export const palette = (page: Page) =>
  page.getByRole('dialog', { name: 'Search commands and settings' });

/** Runs a command from command search (Ctrl+Shift+P). */
export async function command(page: Page, label: string, query = label) {
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await expect(palette(page).getByRole('searchbox')).toBeFocused();
  await palette(page).getByRole('searchbox').fill(query);
  await palette(page).getByRole('button', { name: label, exact: true }).click();
}

const exactly = (text: string) =>
  new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** Opens a menu and the submenus below it: openMenu(page, 'Format', 'Text'). */
export async function openMenu(page: Page, root: string, ...submenus: string[]) {
  await page.locator('.menus > details > summary').filter({ hasText: exactly(root) }).click();
  for (const name of submenus)
    await page.locator('.submenu > summary').filter({ hasText: exactly(name) }).click();
}

/** Clicks through the menus: menu(page, 'Format', 'Text', 'Bold'). */
export async function menu(page: Page, ...path: string[]) {
  const label = path.pop()!;
  const [root, ...submenus] = path;
  await openMenu(page, root, ...submenus);
  await page.locator('.menus').getByRole('button', { name: label, exact: true }).click();
}

/** Runs a mounted fixture's menu action, finding its menu from window.fixture.menus. */
export async function menuAction(page: Page, label: string) {
  const path = await page.evaluate((label) => {
    const action = (window as any).fixture.menus.actions.find((a: any) => a.label === label);
    return action.menu.split('/') as string[];
  }, label);
  await menu(page, ...path, label);
}

export async function homeMenu(page: Page, label: string) {
  const drawer = page.getByRole('dialog', { name: 'Main menu', exact: true });
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await drawer.getByRole('button', { name: label, exact: true }).click();
  await expect(drawer).not.toBeVisible();
}

/** Clicks a toolbar control, through the overflow menu when it doesn't fit. */
export async function tool(page: Page, id: string) {
  const toolbar = page.getByRole('toolbar', { name: 'Editing tools' });
  const control = toolbar.locator(`[data-command=${id}]`);
  if (!(await control.isVisible()))
    await toolbar.getByRole('button', { name: 'More toolbar controls' }).click();
  await control.click();
}

/** Starts waiting for a download, runs trigger, and returns the downloaded file. */
export async function download(page: Page, trigger: () => Promise<unknown>) {
  const event = page.waitForEvent('download');
  await trigger();
  const file = await event;
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

/** Holds back a module's download until the returned function is called. */
export async function holdModule(page: Page, glob: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(glob, async (route) => {
    await held;
    await route.continue();
  });
  return release;
}

/** Chromium: an origin-private folder named "project" stands in for the folder picker. */
export async function useFolder(page: Page, files: Record<string, string | number[]>) {
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('project', { create: true });
  });
  await home(page);
  await page.evaluate(async (files) => {
    const storage = await navigator.storage.getDirectory();
    const root = await storage.getDirectoryHandle('project', { create: true });
    for (const [path, content] of Object.entries(files)) {
      const parts = path.split('/');
      const name = parts.pop()!;
      let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(typeof content === 'string' ? content : new Uint8Array(content));
      await writable.close();
    }
  }, files);
}

export async function openFromFolder(page: Page, path: string) {
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: 'project', exact: true });
  for (const part of path.split('/').slice(0, -1))
    await chooser.locator('summary', { hasText: part }).click();
  await chooser.getByRole('button', { name: path.split('/').pop()!, exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

function onDisk(page: Page, op: 'read' | 'write' | 'kind' | 'remove', path: string, text = '') {
  return page.evaluate(
    async ([op, path, text]) => {
      const storage = await navigator.storage.getDirectory();
      let dir = await storage.getDirectoryHandle('project');
      const parts = path.split('/');
      const name = parts.pop()!;
      for (const part of parts) dir = await dir.getDirectoryHandle(part);
      if (op === 'kind') {
        for await (const [entry, handle] of (dir as any).entries())
          if (entry === name) return handle.kind as string;
        return null;
      }
      if (op === 'remove') return void (await dir.removeEntry(name, { recursive: true }));
      const file = await dir.getFileHandle(name);
      if (op === 'read') return (await file.getFile()).text();
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
    },
    [op, path, text] as const,
  );
}
/** The "project" folder of useFolder. */
export const disk = {
  read: (page: Page, path: string) => onDisk(page, 'read', path) as Promise<string>,
  write: (page: Page, path: string, text: string) => onDisk(page, 'write', path, text),
  kind: (page: Page, path: string) =>
    onDisk(page, 'kind', path) as Promise<'file' | 'directory' | null>,
  remove: (page: Page, path: string) => onDisk(page, 'remove', path),
};

/** A real folder opened through the file-input fallback: read-only, and Save downloads. */
export async function useReadOnlyFolder(
  page: Page,
  info: TestInfo,
  files: Record<string, string>,
  name = 'notes',
) {
  await withoutPickers(page, 'directory', 'save');
  await home(page);
  const root = info.outputPath(name);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await (await chooser).setFiles(root);
  return page.getByRole('dialog', { name, exact: true });
}

/** Stores a remembered folder; Home lists it without reading its stand-in locator. */
export const rememberFolder = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('gittin-local');
        request.onsuccess = () => {
          const tx = request.result.transaction('sources', 'readwrite');
          tx.objectStore('sources').put({
            id: 'folder-1',
            kind: 'folder',
            label: 'project',
            locator: { kind: 'directory', name: 'project' },
            lastOpened: 1,
          });
          tx.oncomplete = () => (request.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

/** Calls a function of the drafts module in the page. */
export const drafts = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    async ([path, name, args]) => (await import(path))[name](...args),
    [DRAFTS, name, args] as const,
  );

/** Calls a function of the preferences store in the page. */
export const preferences = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    async ([path, name, args]) => (await import(path))[name](...args),
    [PREFERENCES, name, args] as const,
  );

export const savedPreferences = (page: Page) => preferences(page, 'loadPreferences');

/** The stored draft with this id; by default, the open document's (from the address). */
export async function savedDraft(page: Page, id?: string) {
  id ??= await page.evaluate(() => location.hash.split('/').at(-1)!);
  return drafts(page, 'loadDraft', id);
}

/** The current text of every stored draft, sorted. */
export const savedSources = (page: Page) =>
  page.evaluate(async (path) => {
    const drafts = await import(path);
    const recent = await drafts.listRecent();
    const sources = await Promise.all(
      recent.map(async (row: any) => (await drafts.loadDraft(row.id)).current.source),
    );
    return (sources as string[]).sort();
  }, DRAFTS);

type Seed = {
  title: string;
  source: string;
  id?: string;
  fileType?: string;
  favourite?: boolean;
  revision?: number;
  lastOpened?: number;
};
/** Stores browser-only drafts, newest first, and returns their ids. */
export const seedDrafts = (page: Page, seeds: Seed[]) =>
  page.evaluate(
    async ([path, seeds]) => {
      const { saveDraft } = await import(path);
      const ids: string[] = [];
      for (const [i, seed] of seeds.entries()) {
        const id = seed.id ?? crypto.randomUUID();
        const record = {
          id,
          title: seed.title,
          fileType: seed.fileType ?? 'markdown',
          favourite: seed.favourite ?? false,
          localBaseline: null,
          identity: { kind: 'local', id },
          current: { source: seed.source, revision: seed.revision ?? 0 },
          lastOpened: seed.lastOpened ?? Date.now() - i * 1000,
          storageRevision: 0,
        };
        await saveDraft(record, 0);
        ids.push(id);
      }
      return ids;
    },
    [DRAFTS, seeds] as const,
  );

/** The id of every command in the editor's registry. */
export const commandIds = (page: Page) =>
  page.evaluate(
    async (path) => Object.keys((await import(path)).commandRegistry) as string[],
    COMMANDS,
  );

let fixtures = 0;
async function freshPage(page: Page) {
  // A new query string forces a real load, so modules start from scratch.
  await page.goto(`/?fixture=${++fixtures}#/home`);
  await expect(page.getByRole('button', { name: 'New file', exact: true })).toBeVisible();
}

/**
 * Replaces the page with a bare controller in div#editor, plus controls, menus or a find bar,
 * as window.fixture { session, controller, controls?, menus?, find? }.
 */
export async function mountEditor(
  page: Page,
  source: string,
  { type = 'markdown', mode = 'markdown', controls = false, menus = false, find = false } = {},
) {
  await freshPage(page);
  await page.evaluate(
    async ({ source, type, mode, controls, menus, find }) => {
      const load = (path: string) => import(path);
      const [{ GittinController }, { DocumentSession }, controlsModule, menusModule, findModule] =
        await Promise.all([
          load('/src/editor/controller.ts'),
          load('/src/documents/session.ts'),
          controls || menus ? load('/src/editor/controls/controls.ts') : null,
          menus ? load('/src/ui/menus.ts') : null,
          find ? load('/src/ui/find-bar.ts') : null,
        ]);
      const host = document.createElement('main');
      const editor = document.createElement('div');
      editor.id = 'editor';
      host.append(editor);
      document.body.replaceChildren(host);
      const session = new DocumentSession(source);
      const controller = new GittinController();
      controller.mount(editor, session, mode, type);
      const fixture: any = { session, controller };
      if (controls || menus) fixture.controls = new controlsModule.EditorControls(controller);
      if (menus)
        fixture.menus = new menusModule.Menus(
          menusModule.editorActions(controller, fixture.controls),
          () => controller.focusDocument(),
        );
      if (find) {
        fixture.find = new findModule.FindBar(controller);
        controller.subscribeMode(() => fixture.find.changed());
      }
      const parts = [fixture.menus, fixture.controls, fixture.find].filter(Boolean);
      host.prepend(...parts.map((part: any) => part.element));
      (window as any).fixture = fixture;
    },
    { source, type, mode, controls, menus, find },
  );
}

/**
 * Replaces the page with a Workspace on no-op actions,
 * as window.fixture { session, workspace, prefs }.
 */
export async function mountWorkspace(page: Page, source: string, type = 'markdown') {
  await freshPage(page);
  await page.evaluate(
    async ({ source, type }) => {
      const load = (path: string) => import(path);
      const [{ Workspace }, { DocumentSession }, { DraftAutosave }, { DevicePreferences }] =
        await Promise.all([
          load('/src/screens/workspace.ts'),
          load('/src/documents/session.ts'),
          load('/src/documents/drafts.ts'),
          load('/src/preferences.ts'),
        ]);
      const session = new DocumentSession(source);
      const autosave = new DraftAutosave(session, {
        title: 'fixture.md',
        fileType: type,
        favourite: false,
        localBaseline: null,
        storageRevision: 0,
      });
      const prefs = new DevicePreferences();
      await prefs.load();
      const doc = {
        session,
        autosave,
        title: 'fixture.md',
        fileType: type,
        favourite: false,
        localBaseline: null,
        mode: 'markdown',
        fileStatus: '',
      };
      const noop = () => {};
      const actions = {
        home: noop, new: noop, open: noop, openFolder: noop, openPath: async () => null,
        createFile: noop, makeCopy: noop, download: noop, save: noop, close: noop, switch: noop,
        recovery: noop, createLocal: noop, diskChoices: () => ({}),
      };
      const workspace = new Workspace(doc, [doc], prefs, actions);
      const notice = document.createElement('p');
      notice.id = 'notice';
      document.body.replaceChildren(notice, workspace.element);
      (window as any).fixture = { session, workspace, prefs };
    },
    { source, type },
  );
}

export const source = (page: Page) =>
  page.evaluate(() => (window as any).fixture.session.current.source as string);

/** The fixture session's text, revision and undo statistics. */
export const snapshot = (page: Page) =>
  page.evaluate(() => {
    const { session } = (window as any).fixture;
    return {
      source: session.current.source as string,
      revision: session.current.revision as number,
      history: session.historyStats,
    };
  });

export const setMode = (page: Page, mode: string) =>
  page.evaluate((mode) => {
    const fixture = (window as any).fixture;
    (fixture.controller ?? fixture.workspace.controller).setMode(mode);
  }, mode);

/** The fixture editor's selection as raw source offsets, { anchor, head }. */
export const sourceSelection = (page: Page) =>
  page.evaluate(() => {
    const fixture = (window as any).fixture;
    return (fixture.controller ?? fixture.workspace.controller).getSourceSelection() as {
      anchor: number;
      head: number;
    };
  });

/** Selects raw source offsets in the fixture's editor, then waits until the editor reports them. */
export async function select(page: Page, anchor: number, head = anchor) {
  await page.evaluate(
    ([anchor, head]) => {
      const fixture = (window as any).fixture;
      (fixture.controller ?? fixture.workspace.controller).selectSource(anchor, head);
    },
    [anchor, head],
  );
  await expect.poll(() => sourceSelection(page)).toEqual({ anchor, head });
}
