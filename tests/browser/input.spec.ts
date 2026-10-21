import { test, expect } from '@playwright/test';
import { editor, mountEditor, newFile, openText, select, source, sourceSelection } from './kit';
test('search and dialog fields retain native undo while document shortcuts use registry', async ({
  page,
}) => {
  await newFile(page);
  const md = editor(page);
  await md.click();
  await md.pressSequentially('original');
  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByRole('searchbox', {
    name: 'Find in current document',
  });
  await find.pressSequentially('needle');
  await find.press('ControlOrMeta+z');
  await expect(find).not.toHaveValue('needle');
  await expect(md).toHaveText('original');
  await page.getByRole('button', { name: 'Close find', exact: true }).click();
  await md.press('ControlOrMeta+k');
  const url = page.getByRole('textbox', { name: 'URL', exact: true });
  await url.pressSequentially('https://example.com');
  await url.press('ControlOrMeta+z');
  await expect(url).not.toHaveValue('https://example.com');
  await expect(md).toHaveText('original');
  await page.keyboard.press('Escape');
  await md.press('ControlOrMeta+z');
  await expect(md).toHaveText('');
});

test('Tab and Shift+Tab indent and outdent a Markdown line by two spaces, one Undo each', async ({
  page,
}) => {
  await mountEditor(page, '- a');
  await select(page, 3);
  await editor(page).press('Tab');
  expect(await source(page)).toBe('  - a');
  await editor(page).press('Shift+Tab');
  expect(await source(page)).toBe('- a');
  await editor(page).press('Tab');
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe('- a');
});

test('Tab and Shift+Tab in a table row select the next and previous cell', async ({ page }) => {
  const table = '| a | b |\n| - | - |\n| c | d |';
  await mountEditor(page, table);
  await select(page, 2);
  for (const [key, cell] of [['Tab', 'b'], ['Tab', 'c'], ['Shift+Tab', 'b']]) {
    await editor(page).press(key);
    const at = table.lastIndexOf(cell);
    await expect.poll(() => sourceSelection(page)).toEqual({ anchor: at, head: at + 1 });
  }
  expect(await source(page)).toBe(table);
});

test('Ctrl+D deletes lines and Alt+arrows move them, one Undo each; Ctrl+Shift+D does nothing', async ({
  page,
}) => {
  await mountEditor(page, 'one\ntwo\nthree');
  await select(page, 0);
  await editor(page).press('ControlOrMeta+d');
  expect(await source(page)).toBe('two\nthree');
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe('one\ntwo\nthree');
  await select(page, 0);
  await editor(page).press('Alt+ArrowDown');
  expect(await source(page)).toBe('two\none\nthree');
  await editor(page).press('Alt+ArrowUp');
  expect(await source(page)).toBe('one\ntwo\nthree');
  await editor(page).press('ControlOrMeta+Shift+d');
  expect(await source(page)).toBe('one\ntwo\nthree');
});

test('Enter continues lists only: after a quote it starts a plain line', async ({ page }) => {
  await mountEditor(page, '> q');
  await select(page, 3);
  await editor(page).press('Enter');
  expect(await source(page)).toBe('> q\n');
});

test('Enter in a code file is typing: one Undo removes the new line and the text typed after it', async ({
  page,
}) => {
  await mountEditor(page, 'let a;', { type: 'javascript' });
  await select(page, 6);
  await editor(page).press('Enter');
  await editor(page).pressSequentially('x');
  expect(await source(page)).toBe('let a;\nx');
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe('let a;');
});

test('Alt+Down, Undo and Tab to the next table row scroll the caret into view', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 });
  const rows = Array.from({ length: 120 }, (_, i) => `| r${i + 1} | s${i + 1} |`).join('\n');
  await openText(page, `| a | b |\n| - | - |\n${rows}\n`);
  const line = (n: number) => editor(page).locator('> div').nth(n - 1);
  // Scrolls so line n sits exactly at the bottom edge of the writing column.
  const toBottom = (n: number) => line(n).evaluate((el) => {
    const column = document.querySelector('.writing-column')!;
    column.scrollTop += el.getBoundingClientRect().bottom - column.getBoundingClientRect().bottom;
  });
  const caretInView = () => page.evaluate(() => {
    const node = getSelection()!.focusNode!;
    const row = (node.nodeType === 1 ? node as Element : node.parentElement!).closest('.ProseMirror > div')!;
    const box = row.getBoundingClientRect(), column = document.querySelector('.writing-column')!.getBoundingClientRect();
    return box.top >= column.top - 1 && box.bottom <= column.bottom + 1;
  });
  await line(40).click();
  await page.keyboard.press('End');
  await toBottom(40);
  await page.keyboard.press('Alt+ArrowDown');
  await expect.poll(caretInView).toBe(true);
  await page.evaluate(() => { document.querySelector('.writing-column')!.scrollTop = 0; });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(caretInView).toBe(true);
  await toBottom(40);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect.poll(caretInView).toBe(true);
});
