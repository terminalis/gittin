import { test, expect, type Page } from '@playwright/test';
import { command, editor, findField, findMessage, findOption, holdModule, openText, readable } from './kit';
async function open(page: Page, source: string, mode = 'Edit') {
  await openText(page, source, 'find.md', { timeout: 30000 });
  if (mode === 'Preview') await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+f');
}
// A worker that never answers keeps a regex request pending until the one-second deadline. A real catastrophic
// pattern cannot be interrupted in WebKit, so it keeps a core busy after terminate() and starves parallel tests.
const stallSearchWorker = (page: Page) =>
  page.route('**/src/editor/find-worker.ts*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: 'self.onmessage=()=>{};' })
  );
test('Preview finds visible text across formatting and disables all replacements', async ({ page }) => {
  await open(page, 'hello **world** and hello world', 'Preview');
  await findField(page).fill('hello world');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 2');
  await expect(page.locator('.find-match')).not.toHaveCount(0);
  const chevron = page.getByRole('button', { name: 'Toggle Replace', exact: true });
  await expect(chevron).toBeDisabled();
  await expect(chevron).toHaveAttribute('title', 'Replace works in Edit');
  await expect(page.locator('.find-replace')).toBeHidden();
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.locator('.find-bar output')).toHaveText('2 of 2');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await findField(page).fill('hello');
  await chevron.click();
  await expect(page.getByRole('textbox', { name: 'Replace with' })).toHaveAttribute('placeholder', 'Replace with (as typed)');
  await page.getByRole('textbox', { name: 'Replace with' }).fill('greeting');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await expect(editor(page)).toHaveText('greeting **world** and greeting world');
  await page.getByRole('button', { name: 'Close find', exact: true }).click();
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toHaveText('hello **world** and hello world');
});
test('Markdown regex source ranges, invalid pattern, timeout and view invalidation', async ({
  page,
}) => {
  await open(page, '**one** **two**\n\naaa!');
  await findField(page).fill('\\*\\*');
  await findOption(page, 'Regular expression');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 4');
  await page.getByRole('button', { name: 'Toggle Replace', exact: true }).click();
  await findField(page).fill('[');
  await expect(findMessage(page)).toContainText(
    'Invalid regular expression'
  );
  await expect(
    page.getByRole('button', { name: 'Replace all', exact: true })
  ).toBeDisabled();
  await stallSearchWorker(page);
  await findField(page).fill('a');
  await expect(findMessage(page)).toContainText('longer than one second');
  await expect(
    page.getByRole('button', { name: 'Replace all', exact: true })
  ).toBeDisabled();
  await findField(page).fill('\\*\\*');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Find options', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Regular expression', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Toggle Replace', exact: true })).toBeDisabled();
  await expect(readable(page).locator('strong')).toHaveCount(2);
});
test('raw BOM/newline ranges stay reversible and Preview source fallback stays read-only', async ({
  page,
}) => {
  await open(page, '\ufeff---\r\na: value\r\n---\r\n\r\n# value');
  await findField(page).fill('value');
  await page.getByRole('button', { name: 'Toggle Replace', exact: true }).click();
  await page.getByRole('textbox', { name: 'Replace with' }).fill('changed');
  await page.getByRole('button', { name: 'Replace all', exact: true }).click();
  await page.getByRole('button', { name: 'Close find', exact: true }).click();
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toContainText('value');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+f');
  await findField(page).fill('value');
  await expect(page.locator('.find-bar output')).toHaveText(/^\d+ of \d+$/);
  await expect(page.getByRole('button', { name: 'Toggle Replace', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Replace all', exact: true })
  ).toBeEnabled();
});

test('pending regex cannot apply after document or revision changes', async ({
  page,
}) => {
  await stallSearchWorker(page);
  await open(page, 'aaa!');
  await findField(page).fill('a');
  await findOption(page, 'Regular expression');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await page.locator('input[type=file]').setInputFiles({
    name: 'different.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('untouched'),
  });
  await expect(page.locator('#document-title')).toHaveText('different.md');
  await page.keyboard.press('ControlOrMeta+f');
  await findField(page).fill('untouched');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 1');
  const md = editor(page);
  await md.click();
  await md.press('ControlOrMeta+a');
  await md.pressSequentially('revised');
  await expect(page.locator('.find-bar output')).toHaveText('No matches');
  await page.getByRole('button', { name: 'Toggle Replace', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Replace all', exact: true })
  ).toBeDisabled();
  await expect(md).toHaveText('revised');
});

test('a stalled advanced-search worker is terminated after one second without mutation', async ({
  page,
}) => {
  await page.route('**/src/editor/find-worker.ts*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'self.onmessage=()=>{while(true){}};',
    })
  );
  await open(page, 'unchanged text');
  await findField(page).fill('unchanged');
  const start = Date.now();
  await findOption(page, 'Regular expression');
  await expect(findMessage(page)).toContainText('longer than one second');
  expect(Date.now() - start).toBeLessThan(3000);
  await page.getByRole('button', { name: 'Toggle Replace', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Replace all', exact: true })
  ).toBeDisabled();
  await expect(editor(page)).toHaveText('unchanged text');
});

test('typing a regular expression starts one search after input pauses', async ({ page }) => {
  let workerRequests = 0;
  await page.route('**/src/editor/find-worker.ts*', (route) => {
    workerRequests++;
    return route.continue();
  });
  await open(page, 'abc abc');
  await findOption(page, 'Regular expression');
  await findField(page).pressSequentially('a.c');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 2');
  expect(workerRequests).toBe(1);
});

test('Enter scrolls the next Edit-mode match into view while Find keeps focus', async ({ page }) => {
  await open(page, `needle\n\n${'filler\n\n'.repeat(200)}needle`);
  await findField(page).fill('needle');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 2');
  await findField(page).press('Enter');
  await expect(page.locator('.find-bar output')).toHaveText('2 of 2');
  await expect(page.locator('.find-current')).toBeInViewport();
  await expect(findField(page)).toBeFocused();
});

test('Enter on a pending regular-expression search scrolls to the first match', async ({ page }) => {
  await open(page, `${'filler\n\n'.repeat(200)}needle`);
  await findOption(page, 'Regular expression');
  await findField(page).fill('needle');
  await findField(page).press('Enter');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 1');
  await expect(page.locator('.find-current')).toBeInViewport();
});

test('Shift+Enter on a pending regular-expression search goes to the last match', async ({ page }) => {
  await open(page, 'needle one\n\nneedle two\n\nneedle three');
  await findOption(page, 'Regular expression');
  await findField(page).fill('needle');
  await findField(page).press('Shift+Enter');
  await expect(page.locator('.find-bar output')).toHaveText('3 of 3');
});

test('Preview find stays on the right words after emoji finish rendering', async ({ page }) => {
  const release = await holdModule(page, '**/src/editor/preview-emoji.ts*');
  await open(page, ':smile: :smile: target', 'Preview');
  await findField(page).fill('target');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 1');
  release();
  await expect(readable(page)).toContainText('😄 😄 target');
  await findField(page).press('Enter');
  await expect(page.locator('.find-current')).toHaveText('target');
});

test('Shift+Enter while a regular-expression search runs goes to the last match when it finishes', async ({ page }) => {
  await open(page, 'needle one\n\nneedle two\n\nneedle three');
  const release = await holdModule(page, '**/src/editor/find-worker.ts*');
  await findOption(page, 'Regular expression');
  const started = page.waitForRequest('**/src/editor/find-worker.ts*');
  await findField(page).fill('needle');
  await started;
  await findField(page).press('Shift+Enter');
  release();
  await expect(page.locator('.find-bar output')).toHaveText('3 of 3');
});

test('Find in Preview stays on the right text after a rename changes the file type', async ({ page }) => {
  await open(page, '# Title\n\nalpha and alpha', 'Preview');
  await findField(page).fill('alpha');
  await expect(page.locator('.find-bar output')).toHaveText('1 of 2');
  await command(page, 'Rename…');
  const rename = page.getByRole('dialog', { name: 'Rename file' });
  await rename.getByLabel('File name').fill('find.txt');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(rename).toHaveCount(0);
  await findField(page).press('Enter');
  await expect(page.locator('.find-bar output')).toHaveText('2 of 2');
  await expect(page.locator('mark[data-find]')).toHaveText(['alpha', 'alpha']);
});

test('Find floats over the top centre of the text, its options a menu of ticks with a dot while one is on', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, 'alpha beta alpha');
  const card = page.locator('.find-card'), column = page.locator('.writing-column');
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!, area = (await column.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThan(2);
  expect(box.y - area.y).toBeLessThan(16);
  // The card floats over the text: the editor still starts at the top of the column.
  expect(Math.round((await page.locator('#editor').boundingBox())!.y)).toBe(Math.round(area.y));
  const row = card.locator('.find-row').first();
  const order = await row.locator(':scope > *').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-action') ?? item.className));
  expect(order).toEqual(['chevron', 'find-field', 'find-count', 'next', 'previous', 'options', 'close']);
  await findField(page).fill('alpha');
  await expect(page.locator('.find-count')).toHaveText('1 of 2');
  const options = page.getByRole('button', { name: 'Find options', exact: true });
  await expect(options).not.toHaveClass(/options-on/);
  await findOption(page, 'Match case');
  await expect(options).toHaveClass(/options-on/);
  await options.click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Match case', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Whole word', exact: true })).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('.find-replace')).toBeHidden();
  await page.getByRole('button', { name: 'Toggle Replace', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Replace with' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Toggle Replace', exact: true })).toHaveAttribute('aria-expanded', 'true');
});
