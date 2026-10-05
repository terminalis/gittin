import { test, expect, type Page } from '@playwright/test';
import {
  chromiumOnly,
  command,
  disk,
  download,
  editor,
  expectDraftSaved,
  home,
  menu,
  newFile,
  openFromFolder,
  readable,
  useFolder,
  useReadOnlyFolder,
} from './kit';

const folderPanel = (page: Page) => page.getByRole('complementary', { name: 'Folder', exact: true });
const save = (page: Page) => page.locator('#save-file').click();

/** Opens a.md from the folder, saves each of the texts in turn, and opens its Version history. */
async function openHistory(page: Page, ...saves: string[]) {
  await useFolder(page, { 'a.md': 'first' });
  await openFromFolder(page, 'a.md');
  for (const text of saves) {
    await editor(page).fill(text);
    await save(page);
    await expect(page.locator('#save-state')).toHaveText('Saved');
  }
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  return page.getByRole('dialog', { name: 'Version history', exact: true });
}

test.describe('writable folders', () => {
  chromiumOnly();

  test('open a folder file, edit, Save writes the bytes and reports Saved', async ({ page }) => {
    await useFolder(page, { 'docs/guide.md': '# Guide\n' });
    await openFromFolder(page, 'docs/guide.md');
    await expect(page.locator('#document-title')).toHaveText('guide.md');
    await expect(page.locator('#save-state')).toHaveText('Saved');
    await editor(page).click();
    await editor(page).press('ControlOrMeta+End');
    await editor(page).pressSequentially('More.');
    await expect(page.locator('#save-state')).toHaveText('Unsaved changes (kept in this browser)');
    await save(page);
    await expect(page.locator('#save-state')).toHaveText('Saved');
    expect(await disk.read(page, 'docs/guide.md')).toBe('# Guide\nMore.');
  });

  test('Open Files, the folder tree and Save show unsaved changes', async ({ page }) => {
    await useFolder(page, { 'a.md': 'one\n', 'b.md': 'two\n' });
    await openFromFolder(page, 'a.md');
    const openRow = page.locator('#open-documents button[aria-current="true"]');
    const treeRow = (name: string) =>
      page.locator(`#repository-panel button.folder-row[title="${name}"]`);
    const saveButton = page.locator('#save-file');
    await expect(treeRow('a.md')).toBeVisible();
    await expect(openRow).not.toHaveAttribute('data-unsaved');
    await expect(treeRow('a.md')).not.toHaveAttribute('data-unsaved');
    await expect(saveButton).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await editor(page).click();
    await editor(page).press('ControlOrMeta+End');
    await editor(page).pressSequentially('more');
    await expect(openRow).toHaveAttribute('data-unsaved', '');
    await expect(openRow).toHaveAccessibleName('a.md');
    await expect(openRow).toHaveAccessibleDescription('Unsaved changes');
    await expect(treeRow('a.md')).toHaveAttribute('data-unsaved', '');
    await expect(saveButton).toHaveCSS('background-color', 'rgb(196, 62, 44)');

    await save(page);
    await expect(page.locator('#save-state')).toHaveText('Saved');
    await expect(openRow).not.toHaveAttribute('data-unsaved');
    await expect(treeRow('a.md')).not.toHaveAttribute('data-unsaved');
    await page.mouse.move(0, 0); // the pointer is still over Save, which tints it on hover
    await expect(saveButton).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await editor(page).pressSequentially(' again');
    await treeRow('b.md').click();
    await expect(page.locator('#document-title')).toHaveText('b.md');
    await expect(treeRow('a.md')).toHaveAttribute('data-unsaved', '');
    await expect(
      page.locator('#open-documents button').filter({ hasText: /^a\.md$/ }),
    ).toHaveAttribute('data-unsaved', '');
    await expect(treeRow('b.md')).not.toHaveAttribute('data-unsaved');
  });

  test('a disk change makes Save show the conflict dialog; each choice behaves', async ({ page }) => {
    await useFolder(page, { 'a.md': 'one' });
    await openFromFolder(page, 'a.md');
    await editor(page).fill('mine');
    await disk.write(page, 'a.md', 'theirs');
    await save(page);
    const dialog = page.getByRole('dialog', { name: 'File changed on disk', exact: true });
    await expect(dialog).toContainText('a.md changed on disk since you opened it. Your unsaved changes are safe in this browser.');
    await dialog.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.view-notice')).toContainText('Temporary comparison: Version on disk');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await save(page);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await disk.read(page, 'a.md')).toBe('theirs');
    await save(page);
    await dialog.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(page.locator('#save-state')).toHaveText('Saved');
    expect(await disk.read(page, 'a.md')).toBe('mine');
    await editor(page).fill('mine again');
    await disk.write(page, 'a.md', 'theirs again');
    await save(page);
    await dialog.getByRole('button', { name: 'Use disk version', exact: true }).click();
    await expect(editor(page)).toHaveText('theirs again');
    await expect(page.locator('#save-state')).toHaveText('Saved');
    await editor(page).press('ControlOrMeta+z');
    await expect(editor(page)).toHaveText('mine again');
  });

  test('Save as inside the folder moves the document; the original file is untouched', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A' });
    await page.addInitScript(() => {
      (window as any).showSaveFilePicker = async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('project');
        return dir.getFileHandle('b.md', { create: true });
      };
    });
    await page.reload();
    await openFromFolder(page, 'a.md');
    await editor(page).fill('B text');
    await menu(page, 'File', 'Save as…');
    await expect(page.locator('#document-title')).toHaveText('b.md');
    await expect(page.locator('#save-state')).toHaveText('Saved');
    // The workspace was rebuilt for the new file; the document has focus again.
    await expect(editor(page)).toBeFocused();
    expect(await disk.read(page, 'b.md')).toBe('B text');
    expect(await disk.read(page, 'a.md')).toBe('A');
  });

  test('reopening a file whose draft and disk both changed shows the banner', async ({ page }) => {
    await useFolder(page, { 'a.md': 'one' });
    await openFromFolder(page, 'a.md');
    await editor(page).fill('mine');
    await expectDraftSaved(page);
    await disk.write(page, 'a.md', 'theirs');
    await page.goto('/#/home');
    await openFromFolder(page, 'a.md');
    await expect(editor(page)).toHaveText('mine');
    const banner = page.locator('#disk-change');
    await expect(banner).toContainText('a.md changed on disk');
    await banner.getByRole('button', { name: 'Keep my changes', exact: true }).click();
    await expect(banner).toBeHidden();
    await save(page);
    await expect(page.locator('#save-state')).toHaveText('Saved');
    expect(await disk.read(page, 'a.md')).toBe('mine');
  });

  test('reopening from Home checks the disk; after a reload Home keeps folder files available', async ({ page }) => {
    await useFolder(page, { 'a.md': 'one', 'b.md': 'one' });
    await openFromFolder(page, 'a.md');
    await page.goto('/#/home');
    await openFromFolder(page, 'b.md');
    await editor(page).fill('mine');
    await expectDraftSaved(page);
    await page.goto('/#/home');
    await disk.write(page, 'a.md', 'theirs');
    await disk.write(page, 'b.md', 'theirs');
    const recent = page.locator('#recent');
    await recent.getByRole('button', { name: 'a.md', exact: true }).click();
    await expect(editor(page)).toHaveText('theirs');
    await page.goto('/#/home');
    await recent.getByRole('button', { name: 'b.md', exact: true }).click();
    await expect(editor(page)).toHaveText('mine');
    await expect(page.locator('#disk-change')).toContainText('b.md changed on disk');
    // Test browsers close the page when reading a stored folder handle back, so a stand-in replaces it.
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('gittin-local');
      request.onsuccess = () => {
        const tx = request.result.transaction('sources', 'readwrite'), store = tx.objectStore('sources'), keys = store.getAllKeys();
        keys.onsuccess = () => { for (const id of keys.result) store.put({ id, kind: 'folder', label: 'project', locator: { kind: 'directory', name: 'project' }, lastOpened: 1 }); };
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.goto('/#/home');
    await page.reload();
    const row = recent.locator('.recent-row').filter({ hasText: 'a.md' });
    await expect(row.locator('.recent-folder')).toHaveText('project');
    await expect(row.locator('.recent-state')).toHaveText('Saved');
  });

  test('Close with unsaved changes asks; Discard removes the draft but not the file', async ({ page }) => {
    await useFolder(page, { 'a.md': 'one' });
    await openFromFolder(page, 'a.md');
    await editor(page).fill('changed');
    await page.getByRole('button', { name: 'Close a.md', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Close a.md?', exact: true });
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#recent')).not.toContainText('a.md');
    expect(await disk.read(page, 'a.md')).toBe('one');
  });

  test('Folder panel shows the tree, finds files and creates new ones', async ({ page }) => {
    await useFolder(page, { 'docs/guide.md': 'G', 'docs/img/a.png': 'x', 'readme.md': 'R', '.git/HEAD': 'ref' });
    await openFromFolder(page, 'docs/guide.md');
    const panel = page.getByRole('complementary', { name: 'Folder', exact: true });
    await expect(panel.getByRole('button', { name: 'guide.md', exact: true })).toHaveAttribute('aria-current', 'true');
    await panel.getByRole('searchbox', { name: 'Find a file in this folder' }).fill('read');
    await expect(panel.getByRole('button', { name: 'readme.md', exact: true })).toBeVisible();
    await panel.getByRole('searchbox').fill('');
    await panel.getByRole('button', { name: 'New file here', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New file', exact: true });
    await dialog.getByLabel('File name').fill('notes.md');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('notes.md');
    expect(await disk.read(page, 'docs/notes.md')).toBe('');
  });

  test('New folder creates a folder beside the current file and refuses a name in use', async ({ page }) => {
    await useFolder(page, { 'docs/guide.md': 'G' });
    await openFromFolder(page, 'docs/guide.md');
    const panel = folderPanel(page);
    await panel.getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New folder', exact: true });
    await dialog.getByLabel('Folder name').fill('img');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.locator('summary', { hasText: 'img' })).toBeVisible();
    expect(await disk.kind(page, 'docs/img')).toBe('directory');
    await panel.getByRole('button', { name: 'New folder', exact: true }).click();
    await dialog.getByLabel('Folder name').fill('img');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('img already exists in docs.');
  });

  test('Rename… in the Folder panel renames the file on disk; its draft, history and favourite follow', async ({ page }) => {
    await useFolder(page, { 'docs/a.md': 'one', 'docs/b.md': 'B' });
    await openFromFolder(page, 'docs/a.md');
    await page.getByRole('button', { name: 'Add favourite', exact: true }).click();
    await editor(page).fill('unsaved');
    await expectDraftSaved(page);
    const panel = folderPanel(page);
    await panel.getByRole('button', { name: 'Actions for a.md', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename file', exact: true });
    await expect(dialog).toContainText('Links to and from a.md are not updated.');
    await dialog.getByLabel('File name').fill('b.md');
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('b.md already exists in docs.');
    await dialog.getByLabel('File name').fill('c.md');
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('c.md');
    await expect(editor(page)).toHaveText('unsaved');
    await expect(panel.getByRole('button', { name: 'c.md', exact: true })).toHaveAttribute('aria-current', 'true');
    expect(await disk.read(page, 'docs/c.md')).toBe('one');
    expect(await disk.kind(page, 'docs/a.md')).toBeNull();
    await expect(page.getByRole('button', { name: 'Remove favourite', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Version history', exact: true })).toContainText('Opened');
    await page.goto('/#/home');
    await expect(page.locator('#recent')).toContainText('c.md');
    await expect(page.locator('#recent')).not.toContainText('a.md');
  });

  test('File › Rename… and the title rename a folder file on disk', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A' });
    await openFromFolder(page, 'a.md');
    await page.locator('#document-title').click();
    const dialog = page.getByRole('dialog', { name: 'Rename file', exact: true });
    await dialog.getByLabel('File name').fill('notes.txt');
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('notes.txt');
    await expect(page.locator('#document-title')).toBeFocused();
    expect(await disk.read(page, 'notes.txt')).toBe('A');
    expect(await disk.kind(page, 'a.md')).toBeNull();
    await command(page, 'Rename…');
    await dialog.getByLabel('File name').fill('notes.md');
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('notes.md');
    await expect(editor(page)).toBeFocused();
    expect(await disk.read(page, 'notes.md')).toBe('A');
  });

  test('Move to… moves files into another folder; a closed file keeps its draft and history', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A', 'b.md': 'B', 'docs/c.md': 'C' });
    await openFromFolder(page, 'b.md');
    // Closing a file without changes keeps its draft (its recent entry) but leaves it closed.
    await page.getByRole('button', { name: 'Close b.md', exact: true }).click();
    await openFromFolder(page, 'a.md');
    const panel = folderPanel(page);
    await panel.getByRole('button', { name: 'Actions for b.md', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Move b.md', exact: true });
    await expect(dialog).toContainText('Links to and from b.md are not updated.');
    // The file's own folder is not offered.
    await expect(dialog.getByRole('button', { name: 'project', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'docs', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    expect(await disk.read(page, 'docs/b.md')).toBe('B');
    expect(await disk.kind(page, 'b.md')).toBeNull();
    // The open file moves through the File menu.
    await command(page, 'Move to…');
    const moveOpen = page.getByRole('dialog', { name: 'Move a.md', exact: true });
    await moveOpen.getByRole('button', { name: 'docs', exact: true }).click();
    await expect(moveOpen).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'a.md', exact: true })).toHaveAttribute('title', 'docs/a.md');
    expect(await disk.read(page, 'docs/a.md')).toBe('A');
    await page.goto('/#/home');
    const row = page.locator('#recent .recent-row').filter({ hasText: 'b.md' });
    await expect(row.locator('.recent-folder')).toHaveText('project › docs');
    await page.locator('#recent').getByRole('button', { name: 'b.md', exact: true }).click();
    await page.getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Version history', exact: true })).toContainText('Opened');
  });

  test('Delete… asks first, then deletes the file and its draft for good', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A', 'b.md': 'B' });
    await openFromFolder(page, 'b.md');
    await editor(page).fill('changed');
    await expectDraftSaved(page);
    await folderPanel(page).getByRole('button', { name: 'Actions for b.md', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete b.md?', exact: true });
    await expect(dialog).toContainText('b.md is deleted permanently and does not go to the Recycle Bin. Unsaved changes kept in this browser are deleted too.');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await disk.read(page, 'b.md')).toBe('B');
    await command(page, 'Delete file…');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('#home')).toBeVisible();
    expect(await disk.kind(page, 'b.md')).toBeNull();
    await expect(page.locator('#recent')).not.toContainText('b.md');
  });

  test('Rename, Move and Delete name a file that was removed outside Gittin', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A', 'b.md': 'B', 'docs/c.md': 'C' });
    await openFromFolder(page, 'a.md');
    // Removed behind Gittin's back: the Folder panel still lists it until it refreshes.
    await disk.remove(page, 'b.md');
    const panel = folderPanel(page), gone = 'b.md is not in project.';
    await panel.getByRole('button', { name: 'Actions for b.md', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename file', exact: true });
    await rename.getByLabel('File name').fill('c.md');
    await rename.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(rename.getByRole('alert')).toHaveText(gone);
    await rename.getByRole('button', { name: 'Close', exact: true }).click();
    await panel.getByRole('button', { name: 'Actions for b.md', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Move to…', exact: true }).click();
    const move = page.getByRole('dialog', { name: 'Move b.md', exact: true });
    await move.getByRole('button', { name: 'docs', exact: true }).click();
    await expect(move.getByRole('alert')).toHaveText(gone);
    await move.getByRole('button', { name: 'Close', exact: true }).click();
    await panel.getByRole('button', { name: 'Actions for b.md', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Delete b.md?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('#notice')).toContainText(gone);
  });

  test('deleting a folder says how many files it holds and closes their tabs', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A', 'docs/b.md': 'B', 'docs/img/c.png': 'C' });
    await openFromFolder(page, 'docs/b.md');
    await page.goto('/#/home');
    await openFromFolder(page, 'a.md');
    const panel = folderPanel(page);
    await panel.getByRole('button', { name: 'Actions for docs', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete docs?', exact: true });
    await expect(dialog).toContainText('docs holds 2 files. The folder and everything in it are deleted permanently and do not go to the Recycle Bin.');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('a.md');
    await expect(page.getByRole('button', { name: 'Close b.md', exact: true })).toHaveCount(0);
    await expect(panel.locator('summary', { hasText: 'docs' })).toHaveCount(0);
    await expect(editor(page)).toBeFocused();
    expect(await disk.kind(page, 'docs')).toBeNull();
  });

  test('Preview shows images by relative path and Insert › From folder… writes a relative path', async ({ page }) => {
    const png = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')];
    await useFolder(page, { 'docs/guide.md': '![dot](img/dot.png)\n', 'docs/img/dot.png': png });
    await openFromFolder(page, 'docs/guide.md');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(readable(page).locator('img')).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => readable(page).locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await editor(page).click();
    await editor(page).press('ControlOrMeta+End');
    await page.locator('.menus > details > summary').filter({ hasText: /^Insert$/ }).click();
    await page.locator('.submenu > summary').filter({ hasText: /^Image$/ }).click();
    await page.getByRole('button', { name: 'From folder…', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Image from folder', exact: true });
    await dialog.getByRole('button', { name: 'img/dot.png', exact: true }).click();
    await expect(editor(page)).toContainText('![](<img/dot.png>)');
  });

  test('Linked resources opens relative links and images from the folder', async ({ page }) => {
    const png = [...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')];
    await useFolder(page, {
      'docs/guide.md': '[Setup](setup.md) [Readme](../readme.md#top) [Gone](gone.md) [Up](../../x.md) ![dot](img/dot.png)\n',
      'docs/setup.md': '# Setup\n', 'readme.md': '# Readme\n', 'docs/img/dot.png': png,
    });
    await openFromFolder(page, 'docs/guide.md');
    await command(page, 'Linked resources…');
    const dialog = page.getByRole('dialog', { name: 'Linked resources', exact: true });
    await expect(dialog).toContainText('Relative targets open from this file’s folder.');
    await expect(dialog).toContainText('Target is outside this folder.');
    await expect(dialog.getByRole('link', { name: 'Open target' })).toHaveAttribute('href', /^blob:/);
    // A missing file keeps the dialog open and says so; the other links still open.
    await dialog.getByRole('button', { name: 'Open target' }).nth(2).click();
    await expect(dialog).toContainText('docs/gone.md is not in project.');
    await expect(dialog.getByRole('button', { name: 'Jump to reference' }).nth(2)).toBeFocused();
    await dialog.getByRole('button', { name: 'Open target' }).nth(1).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#document-title')).toHaveText('readme.md');
    await expect(editor(page)).toContainText('# Readme');
  });

  test('Linked resources opens a folder image as a picture, so a script in the file never runs as Gittin', async ({ page }) => {
    await useFolder(page, {
      'docs/note.md': '![logo](logo.svg) ![page](page.html)\n',
      'docs/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/><script>localStorage.setItem("svg-ran","1")</script></svg>',
      'docs/page.html': '<script>localStorage.setItem("html-ran","1")</script>',
    });
    await openFromFolder(page, 'docs/note.md');
    await command(page, 'Linked resources…');
    const dialog = page.getByRole('dialog', { name: 'Linked resources', exact: true });
    const targets = dialog.getByRole('link', { name: 'Open target' });
    await expect(targets).toHaveCount(2);
    for (const index of [0, 1]) {
      const opened = page.context().waitForEvent('page');
      await targets.nth(index).click();
      const tab = await opened;
      await tab.waitForLoadState('load');
      await expect(tab.locator('img')).toHaveCount(1);
      // The picture shows when the file is an image; a file that is not one is only a broken picture.
      if (index === 0) await expect.poll(() => tab.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await tab.close();
    }
    expect(await page.evaluate(() => localStorage.getItem('svg-ran'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('html-ran'))).toBeNull();
  });

  test('Open image in new tab on a folder SVG or non-image file does not run it as Gittin', async ({ page }) => {
    await useFolder(page, {
      'docs/note.md': '![logo](logo.svg) ![page](page.html)\n',
      'docs/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/><script>localStorage.setItem("svg-ran","1")</script></svg>',
      'docs/page.html': '<p>page</p>',
    });
    await openFromFolder(page, 'docs/note.md');
    // The browser's Open image in new tab opens the picture's own address as a page; a new tab here stands in for it.
    const originOf = async (src: string) => {
      const tab = await page.context().newPage();
      await tab.goto(src);
      const found = await tab.evaluate(() => origin);
      await tab.close();
      return found;
    };
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const logo = readable(page).locator('img[alt="logo"]');
    await expect(logo).toHaveAttribute('src', /^data:image\/svg\+xml/);
    expect(await originOf((await logo.getAttribute('src'))!)).toBe('null');
    expect(await page.evaluate(() => localStorage.getItem('svg-ran'))).toBeNull();
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    // A file whose extension isn't an image type is untyped, which WebKit would sniff as a page; it gets a data: address too.
    await expect(readable(page).locator('img[alt="page"]')).toHaveAttribute('src', /^data:/);
    await command(page, 'Linked resources…');
    const opened = page.context().waitForEvent('page');
    await page.getByRole('dialog', { name: 'Linked resources', exact: true }).getByRole('link', { name: 'Open target' }).first().click();
    const tab = await opened;
    await expect(tab.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    expect(await originOf((await tab.locator('img').getAttribute('src'))!)).toBe('null');
    expect(await page.evaluate(() => localStorage.getItem('svg-ran'))).toBeNull();
    await expect.poll(() => tab.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  });

  test('relative links in Preview and link details open from the folder, not the Gittin host', async ({ page }) => {
    await useFolder(page, { 'docs/guide.md': '[Setup](setup.md) and [Out](../../x.md)\n', 'docs/setup.md': '# Setup\n' });
    await openFromFolder(page, 'docs/guide.md');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = readable(page), address = page.url();
    // Link details' Open link is caught too: a link above the folder stays put and says why.
    await preview.getByRole('link', { name: 'Out', exact: true }).hover();
    await page.getByRole('link', { name: 'Open link', exact: true }).click();
    await expect(page.locator('#notice')).toContainText('Target is outside this folder.');
    expect(page.url()).toBe(address);
    await preview.getByRole('link', { name: 'Setup', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('setup.md');
    await expect(editor(page)).toContainText('# Setup');
  });

  test('a relative link with a #section opens its file at that heading', async ({ page }) => {
    const filler = Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`).join('\n\n');
    await useFolder(page, {
      'guide.md': '[Install](setup.md#install)\n',
      'setup.md': `# Setup\n\n${filler}\n\n## Install\n\nSteps.\n`,
    });
    await openFromFolder(page, 'guide.md');
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await readable(page).getByRole('link', { name: 'Install', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('setup.md');
    await expect(editor(page).getByText('## Install', { exact: true })).toBeInViewport();
  });

  test('version history lists opened and saved versions, compares and restores', async ({ page }) => {
    const dialog = await openHistory(page, 'second', 'third');
    await expect(dialog.locator('li')).toHaveCount(3);
    await expect(dialog.locator('li').last()).toContainText('Opened');
    await expect(dialog).toContainText('Versions of saves made in Gittin on this browser. Clearing browser data removes them.');
    await dialog.locator('li').last().getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.locator('.view-notice')).toContainText('Temporary comparison');
    await page.getByRole('button', { name: 'Version history', exact: true }).click();
    await dialog.locator('li').last().getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(editor(page)).toHaveText('first');
    await expect(page.locator('#save-state')).toHaveText('Unsaved changes (kept in this browser)');
    await editor(page).press('ControlOrMeta+z');
    await expect(editor(page)).toHaveText('third');
  });

  test('version history rows keep their actions together; Clear is separate and confirmed, and Close is secondary', async ({
    page,
  }) => {
    const dialog = await openHistory(page, 'second');
    const rows = dialog.locator('li.version-row');
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await expect(rows).toHaveCount(2);
    await expect(close).toBeFocused();
    await expect(dialog.locator('.version-label strong').first()).toHaveText(/^Saved Today, /);
    await expect(dialog.locator('.version-label small').first()).toHaveText('6 bytes');
    const row = rows.first();
    const rowButton = (name: string) => row.getByRole('button', { name, exact: true });
    const compare = (await rowButton('Compare').boundingBox())!;
    const restore = (await rowButton('Restore').boundingBox())!;
    expect(Math.abs(compare.y - restore.y)).toBeLessThan(2);
    await expect(dialog.locator('.dialog-actions > button')).toHaveText([
      'Clear history for this file',
      'Close',
    ]);
    await expect(close).not.toHaveClass(/primary/);
    const clear = dialog.getByRole('button', { name: 'Clear history for this file', exact: true });
    await expect(clear).toHaveClass(/danger/);

    await clear.click();
    const confirm = page.getByRole('dialog', { name: 'Clear version history?', exact: true });
    await expect(confirm).toContainText("The file itself is not changed. This can't be undone.");
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(rows).toHaveCount(2);
    await clear.click();
    await confirm.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('button', { name: 'Version history', exact: true }).click();
    await expect(dialog).toContainText('No versions yet.');
  });

  test('Save as cancel and permission denial leave changes in the browser', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).showSaveFilePicker = async () => { throw new DOMException('Canceled', 'AbortError'); };
    });
    await useFolder(page, { 'a.md': 'one' });
    await openFromFolder(page, 'a.md');
    await editor(page).fill('two');
    await menu(page, 'File', 'Save as…');
    await expect(page.locator('#file-status')).toHaveText('Save canceled. Your changes are still kept in this browser.');
    await page.evaluate(() => { const proto = FileSystemDirectoryHandle.prototype as any; proto.requestPermission = async () => 'denied'; proto.queryPermission = async () => 'prompt'; });
    await save(page);
    await expect(page.locator('#file-status')).toHaveText('Gittin needs permission to save in project.');
    expect(await disk.read(page, 'a.md')).toBe('one');
    await expect(page.locator('#save-state')).toHaveText('Unsaved changes (kept in this browser)');
  });

  test('the Allow access bar shows when the folder needs permission, and Allow access shows the tree', async ({ page }) => {
    // Headless browsers crash reading a stored folder handle after a reload, so the folder reports that it needs permission instead.
    await page.addInitScript(() => {
      const proto = FileSystemDirectoryHandle.prototype as any;
      proto.queryPermission = async () => ((window as any).needsPermission ? 'prompt' : 'granted');
      proto.requestPermission = async () => { (window as any).needsPermission = false; return 'granted'; };
    });
    await useFolder(page, { 'a.md': 'A' });
    await openFromFolder(page, 'a.md');
    await page.goto('/#/home');
    await page.evaluate(() => { (window as any).needsPermission = true; });
    await page.locator('#recent').getByRole('button', { name: 'a.md', exact: true }).click();
    const bar = page.locator('#access-bar'), panel = folderPanel(page);
    await expect(panel).toContainText('Allow access to project to see its files.');
    await bar.getByRole('button', { name: 'Allow access to project', exact: true }).click();
    await expect(bar).toBeHidden();
    await expect(panel.getByRole('button', { name: 'a.md', exact: true })).toHaveAttribute('aria-current', 'true');
  });

  test('a remembered folder without permission asks for it by name', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A' });
    await openFromFolder(page, 'a.md');
    await page.goto('/#/home');
    await page.evaluate(() => {
      const handle = FileSystemDirectoryHandle.prototype as any;
      handle.queryPermission = async () => 'prompt';
      handle.requestPermission = async () => 'denied';
    });
    await page
      .getByRole('group', { name: 'Recent folders' })
      .getByRole('button', { name: 'project', exact: true })
      .click();
    await expect(page.locator('#notice')).toContainText('Gittin needs permission to open project.');
  });

  test('New file here with a name in use, in any letter case, offers to open that file', async ({ page }) => {
    await useFolder(page, { 'a.md': 'A', 'b.md': 'B' });
    await openFromFolder(page, 'a.md');
    await folderPanel(page).getByRole('button', { name: 'New file here', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New file', exact: true });
    await dialog.getByLabel('File name').fill('B.md');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    const exists = page.getByRole('dialog', { name: 'File already exists', exact: true });
    await expect(exists).toContainText('b.md already exists in project.');
    await exists.getByRole('button', { name: 'Open it', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('b.md');
    await expect(editor(page)).toHaveText('B');
    expect(await disk.read(page, 'b.md')).toBe('B');
  });

  test('Save as… in the File changed on disk dialog writes a new file and leaves the changed one', async ({ page }) => {
    await useFolder(page, { 'a.md': 'one' });
    await page.addInitScript(() => {
      (window as any).showSaveFilePicker = async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('project');
        return dir.getFileHandle('copy.md', { create: true });
      };
    });
    await page.reload();
    await openFromFolder(page, 'a.md');
    await editor(page).fill('mine');
    await disk.write(page, 'a.md', 'theirs');
    await save(page);
    const dialog = page.getByRole('dialog', { name: 'File changed on disk', exact: true });
    await dialog.getByRole('button', { name: 'Save as…', exact: true }).click();
    await expect(page.locator('#document-title')).toHaveText('copy.md');
    await expect(page.locator('#save-state')).toHaveText('Saved');
    expect(await disk.read(page, 'copy.md')).toBe('mine');
    expect(await disk.read(page, 'a.md')).toBe('theirs');
  });

  test('one Escape closes the folder chooser with text in its search box', async ({ page }) => {
    await useFolder(page, { 'readme.md': '# Readme' });
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    const chooser = page.getByRole('dialog', { name: 'project', exact: true });
    await chooser.getByRole('searchbox', { name: 'Find a file in this folder' }).fill('read');
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
  });
});

test('Remove from recent warns for browser-only files and deletes the draft', async ({ page }) => {
  await newFile(page);
  await editor(page).fill('only here');
  await expectDraftSaved(page);
  await page.goto('/#/home');
  await expect(page.locator('#recent .recent-row').filter({ hasText: 'Untitled file' }).locator('.recent-state')).toHaveText('Only in this browser');
  await page.getByRole('button', { name: 'Remove Untitled file', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Remove Untitled file?', exact: true });
  await expect(dialog).toContainText("This deletes the unsaved changes kept in this browser. This can't be undone.");
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#recent')).not.toContainText('Untitled file');
});

test('a relative link in Preview stays in Gittin for a file opened on its own', async ({ page }) => {
  await home(page);
  await page.locator('body > input[type=file]').setInputFiles({ name: 'notes.md', mimeType: 'text/plain', buffer: Buffer.from('[Setup](setup.md)\n') });
  await expect(editor(page)).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const address = page.url();
  await readable(page).getByRole('link', { name: 'Setup', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Target unavailable without a file opened from a folder.');
  expect(page.url()).toBe(address);
});

test('no Git or GitHub wording appears in the web app', async ({ page }) => {
  const banned = /\bcommit|github|repositor/i;
  await page.goto('/');
  expect(await page.locator('body').innerText()).not.toMatch(banned);
  await page.goto('/#/home');
  await expect(page.locator('#home')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(banned);
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  expect(await page.locator('#home-menu').innerText()).not.toMatch(banned);
  await page.keyboard.press('Escape');
  await newFile(page);
  const texts = await page.evaluate(() => [...document.querySelectorAll('#workspace button, #workspace summary, #workspace [title], #workspace [aria-label]')]
    .map(el => [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label')].join(' ')));
  expect(texts.filter(text => banned.test(text))).toEqual([]);
  for (const topic of ['Gittin Help', 'About drafts and files', 'Getting Started', "What's new"]) {
    await command(page, topic);
    expect(await page.locator('body').innerText()).not.toMatch(banned);
    await page.keyboard.press('Escape');
  }
  for (const legal of ['/privacy.html', '/terms.html']) {
    await page.goto(legal);
    expect(await page.locator('body').innerText()).not.toMatch(banned);
  }
});

test('without a folder picker, a folder opens read-only, Save downloads and edits count as unsaved', async ({ page }, testInfo) => {
  const dialog = await useReadOnlyFolder(page, testInfo, { 'sub/a.md': 'from disk' });
  await dialog.locator('summary', { hasText: 'sub' }).click();
  await dialog.getByRole('button', { name: 'a.md', exact: true }).click();
  await expect(editor(page)).toHaveText('from disk');
  await expect(page.locator('#save-state')).toHaveText('Read-only folder: Save downloads a copy');
  const saved = await download(page, () => page.locator('#save-file').click());
  expect(saved.name).toBe('a.md');
  // A read-only folder file with changes still gets the unsaved marks.
  const openRow = page.locator('#open-documents button[aria-current="true"]');
  const treeRow = page.locator('#repository-panel button.folder-row[title="sub/a.md"]');
  await expect(treeRow).toBeVisible();
  // Gittin cannot write here, so the panel offers no new files or folders and no ⋯ menus.
  const panel = page.locator('#repository-panel');
  for (const name of ['New file here', 'New folder', 'Actions for a.md'])
    await expect(panel.getByRole('button', { name })).toHaveCount(0);
  await expect(openRow).not.toHaveAttribute('data-unsaved');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially(' edited');
  await expect(openRow).toHaveAttribute('data-unsaved', '');
  await expect(treeRow).toHaveAttribute('data-unsaved', '');
});
