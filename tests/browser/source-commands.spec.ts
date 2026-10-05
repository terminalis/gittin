import { test, expect, type Page } from '@playwright/test';
import {
  EDITOR,
  commandIds,
  editor,
  menuAction,
  mountEditor,
  newFile,
  select,
  source,
  sourceSelection,
} from './kit';

const mount = (page: Page, text: string, type = 'markdown') =>
  mountEditor(page, text, { type, controls: true, menus: true, find: true });
// Native selection keys reach editor state asynchronously; wait for it before the next key or
// menu action reads it.
const selectionIs = (page: Page, anchor: number, head: number) =>
  expect.poll(() => sourceSelection(page)).toEqual({ anchor, head });
async function all(page: Page) {
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).press('ControlOrMeta+Shift+Home');
  await selectionIs(page, (await source(page)).length, 0);
}

test('a toolbar style transforms the reversed source selection and undoes once with BOM and CRLF', async ({
  page,
}) => {
  const original = '\ufeffalpha\r\n';
  await mount(page, original);
  await select(page, 6, 1);
  await page.locator('[data-command="bold"]').click();
  expect(await source(page)).toBe('\ufeff**alpha**\r\n');
  const selection = await sourceSelection(page);
  expect(selection.anchor).toBeGreaterThan(selection.head);
  await page.locator('[data-command="undo"]').click();
  expect(await source(page)).toBe(original);
});

test('line, comment, paragraph, list and alignment menus use the shared timeline', async ({
  page,
}) => {
  await mount(page, 'one\r\ntwo\n');
  const cases = [
    ['Indent', '  one\r\n  two\n'],
    ['Heading 3', '### one\r\n### two\n'],
    ['Task list', '- [ ] one\r\n- [ ] two\n'],
    ['Convert selection to comment', '<!--one\r\ntwo\n-->'],
    ['Centre', '<div align="center">one\r\ntwo</div>\n'],
    ['Delete selection', ''],
  ] as const;
  for (const [label, expected] of cases) {
    await all(page);
    await menuAction(page, label);
    expect(await source(page)).toBe(expected);
    await page.locator('[data-command="undo"]').click();
    expect(await source(page)).toBe('one\r\ntwo\n');
  }
  // Menu Undo restores the editor selection without focus, so a native Ctrl+Home can find the
  // DOM caret already at the start and never sync editor state: select through the editor.
  await editor(page).click();
  await select(page, 0);
  await menuAction(page, 'Duplicate line/selection');
  expect(await source(page)).toBe('one\r\none\r\ntwo\n');
  await menuAction(page, 'Undo');
  await select(page, 0);
  await menuAction(page, 'Move lines down');
  expect(await source(page)).toBe('two\r\none\n');
  await menuAction(page, 'Undo');
  await select(page, 5);
  await menuAction(page, 'Move lines up');
  expect(await source(page)).toBe('two\r\none\n');
  await menuAction(page, 'Undo');
  await select(page, 0);
  await menuAction(page, 'Delete lines');
  expect(await source(page)).toBe('two\n');
  await menuAction(page, 'Undo');
});

test('code comments and all mutations are gated in Preview and during composition', async ({
  page,
}) => {
  await mount(page, 'const url="https://x";\r\nnext', 'javascript');
  await all(page);
  await menuAction(page, 'Convert selection to comment');
  expect(await source(page)).toBe('/*const url="https://x";\r\nnext*/');
  await menuAction(page, 'Undo');
  await expect(page.locator('[data-command="bold"]')).toBeDisabled();
  const before = await source(page);
  const ids = (await commandIds(page)).filter((id) => !['copy', 'selectAll'].includes(id));
  const results = await page.evaluate((ids) => {
    const { controller } = (window as any).fixture;
    controller.setMode('preview');
    return ids.map((id) => controller.execute(id));
  }, ids);
  expect(results.every((result: unknown) => !result)).toBe(true);
  expect(await source(page)).toBe(before);
  await page.evaluate((selector) => {
    const { controller } = (window as any).fixture;
    controller.setMode('markdown');
    document
      .querySelector(selector)!
      .dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  }, EDITOR);
  expect(
    await page.evaluate(() => (window as any).fixture.controller.applySourceCommand('deleteLines')),
  ).toBe(false);
  expect(await source(page)).toBe(before);
});

test('clipboard denial and stale async completion preserve source; plain-text paste is undoable', async ({
  page,
}) => {
  await mount(page, 'alpha');
  await menuAction(page, 'Select all');
  expect(await sourceSelection(page)).toEqual({ anchor: 0, head: 5 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(Error('denied')),
        readText: () => Promise.resolve('<b>plain</b>\r\n'),
      },
    });
  });
  expect(await page.evaluate(() => (window as any).fixture.controller.clipboard('cut'))).toBe(false);
  expect(await source(page)).toBe('alpha');
  expect(await page.evaluate(() => (window as any).fixture.controller.clipboard('paste'))).toBe(true);
  expect(await source(page)).toBe('<b>plain</b>\r\n');
  await menuAction(page, 'Undo');
  await menuAction(page, 'Select all');
  await page.evaluate(() => {
    let complete: any;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: () => new Promise((resolve) => (complete = resolve)) },
    });
    const { controller } = (window as any).fixture;
    (window as any).paste = controller.clipboard('paste');
    controller.setMode('preview');
    controller.setMode('markdown');
    complete('late');
  });
  expect(await page.evaluate(() => (window as any).paste)).toBe(false);
  expect(await source(page)).toBe('alpha');
});

test('whole word source/visible-text and regex retain literal replacement and read-only rules', async ({
  page,
}) => {
  await mount(page, 'cat scatter cat_cat Cat **cat**');
  await page.evaluate(() => (window as any).fixture.find.open());
  const find = page.getByRole('searchbox', { name: 'Find in current document' });
  const matches = page.locator('.find-bar output');
  await find.fill('cat');
  await page.getByLabel('Whole word').check();
  await expect(matches).toHaveText('1 of 3 matches');
  await page.getByLabel('Match case').check();
  await expect(matches).toHaveText('1 of 2 matches');
  await page.getByLabel('Regular expression (Markdown)').check();
  await find.fill('c.t');
  await expect(matches).toHaveText('1 of 2 matches');
  await page.getByRole('textbox', { name: 'Replace with' }).fill('$1');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  expect(await source(page)).toBe('$1 scatter cat_cat Cat **$1**');
  await page.evaluate(() => {
    const { controller } = (window as any).fixture;
    controller.execute('undo');
    controller.setMode('preview');
  });
  await find.fill('cat');
  await expect(matches).toHaveText('1 of 2 matches');
  await expect(page.getByRole('button', { name: 'Replace all', exact: true })).toBeDisabled();
});

test('recognized, removed and unknown extensions refresh commands without changing source or history', async ({
  page,
}) => {
  await newFile(page);
  await editor(page).click();
  await editor(page).pressSequentially('alpha');
  const bold = page.locator('[data-command="bold"]');
  const rename = async (title: string) => {
    await page.locator('#document-title').click();
    const dialog = page.getByRole('dialog', { name: 'Rename file' });
    await dialog.getByLabel('File name').fill(title);
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await rename('notes.js');
  await expect(bold).toBeDisabled();
  await expect(editor(page)).toHaveText('alpha');
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toHaveText('');
  await editor(page).press('ControlOrMeta+Shift+z');
  await expect(editor(page)).toHaveText('alpha');
  await rename('notes');
  await expect(bold).toBeDisabled();
  await rename('notes.md');
  await expect(bold).toBeEnabled();
  await rename('notes.xyz');
  await expect(bold).toBeDisabled();
});

test('clear formatting preserves link destinations and literal blocks; code Enter inserts no Markdown prefix', async ({
  page,
}) => {
  await mount(page, '[**label**](https://x/**literal**) and <mark>text</mark>');
  await menuAction(page, 'Select all');
  await menuAction(page, 'Clear text formatting');
  expect(await source(page)).toBe('[label](https://x/**literal**) and text');
  await menuAction(page, 'Undo');
  await page.evaluate(() => (window as any).fixture.controller.setFileType('javascript'));
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  const end = (await source(page)).length;
  await selectionIs(page, end, end);
  await editor(page).press('Enter');
  expect(await source(page)).toBe(
    '[**label**](https://x/**literal**) and <mark>text</mark>\n',
  );
});

test('Format comment conversions are directional and share Undo', async ({ page }) => {
  await mount(page, 'abc');
  const format = page
    .locator('.menus > details')
    .filter({ has: page.locator(':scope > summary', { hasText: /^Format$/ }) });
  const convert = format.getByRole('button', {
    name: 'Convert selection to comment',
    exact: true,
  });
  const restore = format.getByRole('button', {
    name: 'Convert comment to ordinary text',
    exact: true,
  });
  await format.locator(':scope > summary').click();
  await expect(convert).toBeDisabled();
  await expect(restore).toBeDisabled();
  await format.locator(':scope > summary').click();
  for (const selection of ['forward', 'reversed']) {
    if (selection === 'forward') await menuAction(page, 'Select all');
    else {
      await editor(page).click();
      await editor(page).press('ControlOrMeta+Home');
      await editor(page).press('End');
      await editor(page).press('Shift+Home');
      await selectionIs(page, 3, 0);
    }
    await menuAction(page, 'Convert selection to comment');
    const commented = await source(page);
    expect(commented).toBe('<!--abc-->');
    await format.locator(':scope > summary').click();
    await expect(convert).toBeDisabled();
    await expect(restore).toBeEnabled();
    await restore.click();
    expect(await source(page)).toBe('abc');
    await format.locator(':scope > summary').click();
    await expect(restore).toBeDisabled();
    await format.locator(':scope > summary').click();
    await menuAction(page, 'Undo');
    expect(await source(page)).toBe(commented);
    await menuAction(page, 'Undo');
    expect(await source(page)).toBe('abc');
  }
  await menuAction(page, 'Select all');
  await menuAction(page, 'Convert selection to comment');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+Home');
  for (let i = 0; i < 2; i++) await editor(page).press('ArrowRight');
  await menuAction(page, 'Convert comment to ordinary text');
  expect(await source(page)).toBe('abc');
  await page.locator('.menus > details > summary').filter({ hasText: /^Edit$/ }).click();
  await expect(
    page.locator('.menus .submenu > summary').filter({ hasText: /^Comments$/ }),
  ).toHaveCount(0);
});
