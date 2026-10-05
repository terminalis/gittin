import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  command, editor, menu, newFile, noSidewaysScroll, openMenu, openText, palette, readable,
} from './kit';

const rootMenu = (page: Page, name: string) => page.locator('.menus > details').filter({ has: page.locator(':scope > summary', { hasText: new RegExp(`^${name}$`) }) });
const submenu = (page: Page, name: string) => page.locator('.submenu').filter({ has: page.locator(':scope > summary', { hasText: new RegExp(`^${name}$`) }) });
/** An open menu's rows, grouped between its rules: command and submenu names. */
const sections = (root: Locator) =>
  root.locator(':scope > .menu-items').evaluate(panel => {
    const groups: string[][] = [[]];
    for (const row of panel.children) {
      if (row.tagName === 'HR') groups.push([]);
      else groups.at(-1)!.push(row.getAttribute('aria-label') ?? row.querySelector('summary')!.textContent!);
    }
    return groups;
  });

test.beforeEach(async ({ page }) => {
  await newFile(page);
  await expect(page.locator('#document-title')).toHaveText('Untitled file');
});

test('every command is available through its menu, and menus separate their sections with rules', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+Shift+p');
  const catalogue = await palette(page)
    .locator('.command-results button')
    .evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!).sort());
  await page.keyboard.press('Escape');
  const menuCommands: string[] = [];
  for (const group of ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help']) {
    const root = rootMenu(page, group);
    await root.locator(':scope > summary').press('Enter');
    menuCommands.push(...await root.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!)));
    await expect(root.locator(':scope > .menu-items > hr').first()).toBeVisible();
    if (group === 'Edit')
      expect(await sections(root)).toEqual([
        ['Undo', 'Redo'],
        ['Cut', 'Copy', 'Paste'],
        ['Select all', 'Delete selection', 'Lines'],
        ['Find and replace'],
      ]);
    await root.locator(':scope > summary').press('Escape');
  }
  expect(menuCommands.sort()).toEqual(catalogue);
});

test('File keeps file moves with Rename, PDF after Print, and Version history… after Save as', async ({
  page,
}) => {
  const file = rootMenu(page, 'File');
  await file.locator(':scope > summary').click();
  expect(await sections(file)).toEqual([
    ['Home', 'New', 'Open', 'Make a copy'],
    ['Email'],
    ['Save', 'Save as…', 'Version history…'],
    ['Rename…', 'Move to…', 'Delete file…', 'Location', 'Add/remove favourite'],
    ['Details', 'Print', 'Download as PDF…', 'Close file'],
  ]);
  // A file only in this browser has no saves to list.
  await expect(file.getByRole('button', { name: 'Version history…', exact: true })).toBeDisabled();
  await openText(page, '# Saved', 'saved.md');
  await command(page, 'Version history…');
  await expect(page.getByRole('dialog', { name: 'Version history', exact: true })).toBeVisible();
});

test('desktop hover opens adjacent panels without shifting rows and switches branches', async ({ page }) => {
  const file = rootMenu(page, 'File'), newMenu = submenu(page, 'New'), openMenu = submenu(page, 'Open');
  await file.locator(':scope > summary').click();
  const panel = file.locator(':scope > .menu-items');
  const before = await panel.boundingBox();
  const rowBefore = await openMenu.locator(':scope > summary').boundingBox();
  await newMenu.locator(':scope > summary').hover();
  await expect(newMenu).toHaveAttribute('open', '');
  const child = newMenu.locator(':scope > .submenu-items');
  const bounds = await child.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(before!.x + before!.width - 2);
  expect(await panel.boundingBox()).toEqual(before);
  expect(await openMenu.locator(':scope > summary').boundingBox()).toEqual(rowBefore);
  await child.getByRole('button', { name: 'File', exact: true }).hover();
  await expect(newMenu).toHaveAttribute('open', '');
  await openMenu.locator(':scope > summary').hover();
  await expect(openMenu).toHaveAttribute('open', '');
  await expect(newMenu).not.toHaveAttribute('open', '');
  await file.getByRole('button', { name: 'Make a copy', exact: true }).hover();
  await expect(openMenu).not.toHaveAttribute('open', '');
  await rootMenu(page, 'Edit').locator(':scope > summary').hover();
  await expect(rootMenu(page, 'Edit')).toHaveAttribute('open', '');
  await expect(file).not.toHaveAttribute('open', '');
});

test('keyboard stays in the current panel and restores its parent on Left and Escape', async ({ page }) => {
  const format = rootMenu(page, 'Format'), text = submenu(page, 'Text');
  await format.locator(':scope > summary').focus();
  await page.keyboard.press('ArrowDown');
  await expect(text.locator(':scope > summary')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(text.getByRole('button', { name: 'Bold', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(text.getByRole('button', { name: 'Italic', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(text.getByRole('button', { name: 'Highlight', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(text.locator(':scope > summary')).toBeFocused();
  await expect(text).not.toHaveAttribute('open', '');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  await expect(text.locator(':scope > summary')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(submenu(page, 'Paragraph styles').locator(':scope > summary')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(format).not.toHaveAttribute('open', '');
  await expect(format.locator(':scope > summary')).toBeFocused();
});

test('deep desktop flyouts flip at the edge and retain working toolbar actions', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 500 });
  await rootMenu(page, 'View').locator(':scope > summary').click();
  const toolbar = submenu(page, 'Toolbar'), formatting = submenu(page, 'Text formatting');
  await toolbar.locator(':scope > summary').hover();
  await expect(toolbar).toHaveAttribute('open', '');
  await formatting.locator(':scope > summary').hover();
  await expect(formatting).toHaveAttribute('open', '');
  const parent = await toolbar.locator(':scope > .submenu-items').boundingBox();
  const child = await formatting.locator(':scope > .submenu-items').boundingBox();
  expect(child!.x).toBeLessThan(parent!.x);
  expect(child!.x).toBeGreaterThanOrEqual(8);
  expect(child!.y).toBeGreaterThanOrEqual(8);
  expect(child!.x + child!.width).toBeLessThanOrEqual(812);
  expect(child!.y + child!.height).toBeLessThanOrEqual(492);
  await formatting.getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(page.locator('[data-command=bold]')).toBeHidden();
  await expect(page.locator('.menus details[open]')).toHaveCount(0);
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('narrow menus expand inline and preserve selected settings and dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  const view = rootMenu(page, 'View');
  await view.locator(':scope > summary').click();
  const mode = submenu(page, 'Mode');
  await mode.locator(':scope > summary').click();
  const trigger = await mode.locator(':scope > summary').boundingBox();
  const panel = await mode.locator(':scope > .submenu-items').boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(trigger!.y + trigger!.height);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(390);
  await expect(mode.getByRole('button', { name: 'Edit view', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await mode.getByRole('button', { name: 'Preview view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.menus details[open]')).toHaveCount(0);
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('Version history sits before Save; it and Insert › Image › From folder… are disabled for browser-only files', async ({
  page,
}) => {
  const history = page.locator('.workspace-header-actions #version-history');
  await expect(history).toBeVisible();
  await expect(history).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Version history', exact: true })).toHaveAttribute('id', 'version-history');
  await expect(history).toHaveAttribute('title', 'Save this file to start its version history.');
  await expect(page.locator('.workspace-header-actions > #version-history + .save-split > #save-file')).toBeVisible();
  await openMenu(page, 'Insert', 'Image');
  await expect(page.getByRole('button', { name: 'From folder…', exact: true })).toBeDisabled();
});

test('icon-only buttons show their name as a tooltip', async ({ page }) => {
  await page.keyboard.press('ControlOrMeta+f');
  const untitled = await page
    .locator('#workspace button:visible')
    .evaluateAll(buttons => buttons
      .filter(b => !b.textContent!.trim() && !b.getAttribute('title'))
      .map(b => b.outerHTML));
  expect(untitled).toEqual([]);
  for (const name of ['Close find', 'Close Untitled file'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('title', name);
});

test('menu commands return focus to the document unless they open a dialog', async ({ page }) => {
  await editor(page).click();
  await page.keyboard.type('first');
  await menu(page, 'Edit', 'Undo');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('Z');
  await expect(editor(page)).toContainText('Z');
  await page.keyboard.press('ControlOrMeta+a');
  await menu(page, 'Format', 'Text', 'Bold');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('Y');
  await expect(editor(page)).toContainText('Y');
  await menu(page, 'Tools', 'File statistics…');
  await expect(page.locator('.statistics-dialog')).toBeVisible();
  await expect(page.locator('.statistics-dialog').locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.statistics-dialog')).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('W');
  await expect(editor(page)).toContainText('W');
});

test('menu commands that swap the document surface leave the new surface focused', async ({ page }) => {
  await page.locator('[data-mode="preview"]').click();
  await expect(readable(page)).toBeVisible();
  await rootMenu(page, 'View').locator(':scope > summary').click();
  await rootMenu(page, 'View').getByRole('button', { name: 'Word wrap', exact: true }).click();
  await expect(readable(page)).toBeFocused();
  await rootMenu(page, 'View').locator(':scope > summary').click();
  await submenu(page, 'Mode').locator(':scope > summary').click();
  await rootMenu(page, 'View').getByRole('button', { name: 'Edit view', exact: true }).click();
  await expect(editor(page)).toBeFocused();
  await page.keyboard.type('M');
  await expect(editor(page)).toContainText('M');
});
