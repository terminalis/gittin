import { test, expect, type Page } from '@playwright/test';
import {
  EDITOR,
  editor,
  menuAction,
  mountEditor,
  readable,
  select,
  setMode,
  source,
  sourceSelection,
} from './kit';

const mount = (page: Page, text: string, type = 'markdown') =>
  mountEditor(page, text, { type, controls: true, menus: true });
const undo = (page: Page) => page.locator('[data-command="undo"]').click();
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

test('Ctrl K creates and updates both link fields through one undoable raw source transaction', async ({
  page,
}) => {
  const original = '\ufefflabel\r\nother\n';
  await mount(page, original);
  await select(page, 1, 6);
  await editor(page).press('ControlOrMeta+k');
  let d = dialog(page, 'Insert link');
  await expect(d.getByLabel('Link text')).toHaveValue('label');
  await d.getByLabel('URL', { exact: true }).fill('https://x/a(b)');
  await d.getByLabel('Link text').fill('a [b]');
  await d.getByRole('button', { name: 'Insert', exact: true }).click();
  expect(await source(page)).toBe('\ufeff[a \\[b\\]](<https://x/a(b)>)\r\nother\n');
  await expect(editor(page)).toBeFocused();
  await undo(page);
  expect(await source(page)).toBe(original);
  await mount(page, 'before [old [label]](https://x/a(b) "title") after');
  await page.evaluate(() => (window as any).fixture.controller.goToSource(12));
  expect(await sourceSelection(page)).toEqual({ anchor: 12, head: 12 });
  await editor(page).press('ControlOrMeta+k');
  d = dialog(page, 'Insert link');
  await expect(d.getByLabel('Link text')).toBeEnabled();
  await expect(d.getByLabel('URL', { exact: true })).toHaveValue('https://x/a(b)');
  await d.getByLabel('Link text').fill('new');
  await d.getByLabel('URL', { exact: true }).fill('#section');
  await d.getByRole('button', { name: 'Update link' }).click();
  expect(await source(page)).toBe('before [new](<#section>) after');
  await undo(page);
  expect(await source(page)).toBe('before [old [label]](https://x/a(b) "title") after');
});

test('URL validation, stale dialog guards, cancellation, and read-only modes preserve source', async ({
  page,
}) => {
  await mount(page, 'alpha');
  await select(page, 2);
  await menuAction(page, 'From URL…');
  let d = dialog(page, 'Insert image');
  await d.getByLabel('Image URL').fill('javascript:alert(1)');
  await d.getByRole('button', { name: 'Insert', exact: true }).click();
  await expect(d.getByRole('alert')).toContainText('supported');
  expect(await source(page)).toBe('alpha');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor(page)).toBeFocused();
  expect(await sourceSelection(page)).toEqual({ anchor: 2, head: 2 });
  for (const change of ['revision', 'mode', 'type', 'selection']) {
    await page.evaluate(() => {
      const { controller } = (window as any).fixture;
      controller.setMode('markdown');
      controller.setFileType('markdown');
    });
    await select(page, 2);
    await menuAction(page, 'Insert link');
    d = dialog(page, 'Insert link');
    await d.getByLabel('URL', { exact: true }).fill('https://x');
    await page.evaluate((change) => {
      const { session, controller } = (window as any).fixture;
      if (change === 'revision')
        session.applyWriteSource(session.current.source + '!', 'command', controller.getSelection());
      else if (change === 'mode') {
        controller.setMode('preview');
        controller.setMode('markdown');
      } else if (change === 'selection') controller.goToSource(session.current.source.length);
      else {
        controller.setFileType('text');
        controller.setFileType('markdown');
      }
    }, change);
    const before = await source(page);
    await d.getByRole('button', { name: 'Insert', exact: true }).click();
    await expect(d.getByRole('alert')).toContainText('changed');
    expect(await source(page)).toBe(before);
    await d.getByRole('button', { name: 'Cancel' }).click();
  }
  for (const mode of ['preview', 'diff']) {
    const result = await page.evaluate((mode) => {
      const { controller } = (window as any).fixture;
      controller.setMode(mode);
      return [
        controller.insertElement({ kind: 'symbol', text: '✓' }),
        controller.transformImage({ width: 100 }),
        controller.transformTable('removeTable'),
      ];
    }, mode);
    expect(result).toEqual([false, false, false]);
    const before = await source(page);
    await readable(page).focus();
    await readable(page).press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await source(page)).toBe(before);
  }
});

test('the table grid and its validation insert a table that Preview draws readably', async ({ page }) => {
  await mount(page, '');
  await menuAction(page, 'Insert table');
  const d = dialog(page, 'Insert table');
  await d.getByLabel('Rows (including header)').fill('1');
  await d.getByRole('button', { name: 'Insert', exact: true }).click();
  expect(await source(page)).toBe('');
  await d.getByRole('button', { name: '3 rows, 3 columns' }).click();
  await expect(d.locator('output')).toHaveText('3 rows × 3 columns');
  await d.getByRole('button', { name: 'Insert', exact: true }).click();
  expect(await source(page)).toBe(
    '| Header | Header | Header |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |',
  );
  await setMode(page, 'preview');
  const cell = readable(page).locator('th').first();
  await expect(cell).toHaveCSS('border-top-width', '1px');
  await expect(cell).toHaveCSS('padding-top', '8.8px');
  await expect(readable(page).locator('table')).toHaveCSS('overflow-x', 'auto');
});

test('the image Size dialog sets a width and keeps natural proportions', async ({ page }) => {
  const original = 'a ![a "b"](https://x/a.png) z\r\n';
  await mount(page, original);
  await select(page, 8);
  await menuAction(page, 'Size…');
  const d = dialog(page, 'Image size');
  await expect(d).toContainText('natural proportions');
  await d.getByLabel('Width (pixels)').fill('120');
  await d.getByLabel('Height (pixels)').fill('50');
  await d.getByRole('button', { name: 'Apply' }).click();
  expect(await source(page)).toBe(
    'a <img src="https://x/a.png" alt="a &quot;b&quot;" width="120"> z\r\n',
  );
  await undo(page);
  expect(await source(page)).toBe(original);
});

test('heading links, symbols, element dialogs and snippets insert through their dialogs', async ({ page }) => {
  const original = '# Héllo\r\n## Héllo\nlabel';
  await mount(page, original);
  await select(page, original.length - 5, original.length);
  await menuAction(page, 'Link to heading…');
  let d = dialog(page, 'Link to heading');
  await expect(d.getByLabel('Heading').locator('option').nth(1)).toHaveText(
    '  Héllo (Heading 2)',
  );
  await d.getByLabel('Heading').selectOption('1');
  await d.getByRole('button', { name: 'Insert', exact: true }).click();
  expect(await source(page)).toBe('# Héllo\r\n## Héllo\n[label](<#héllo-1>)');
  await undo(page);
  await menuAction(page, 'Symbols…');
  d = dialog(page, 'Symbols');
  await d.getByLabel('Search symbols and emoji').fill('rocket');
  await d.getByRole('button', { name: 'rocket emoji' }).click();
  await d.getByRole('button', { name: 'Insert', exact: true }).click();
  expect(await source(page)).toContain('🚀');
  for (const [label, title, hint] of [
    ['Math…', 'Math', 'Preview typesets it.'],
    ['Diagram…', 'Diagram', 'Preview draws it as a diagram.'],
  ] as const) {
    await menuAction(page, label);
    d = page.getByRole('dialog', { name: title, exact: true });
    await expect(d).toContainText(hint);
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
  }
  await mount(page, '', 'typescript');
  await menuAction(page, 'Function (typescript)');
  await dialog(page, 'Insert snippet')
    .getByRole('button', { name: 'Insert', exact: true })
    .click();
  expect(await source(page)).toContain('function example(): void');
  await page.locator('.menus > details > summary').filter({ hasText: /^Insert$/ }).click();
  await page.locator('.submenu > summary').filter({ hasText: /^Image$/ }).click();
  await expect(page.getByRole('button', { name: 'From folder…', exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'GitHub references…', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('From device', { exact: false })).toHaveCount(0);
});

test('captured insertion context rejects disposal, remount and composition without stale restoration', async ({
  page,
}) => {
  await mount(page, 'old');
  const result = await page.evaluate((selector) => {
    const { controller, session } = (window as any).fixture;
    const before = session.current.source;
    const captured = controller.captureSourceContext();
    const el = document.querySelector(selector)!;
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const during = controller.insertElement({ kind: 'symbol', text: '✓' });
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    controller.dispose();
    const late = (source: any, selection: any) => ({ source: 'late', selection });
    const afterDispose = captured.apply(late);
    captured.restore();
    // Another fixture DocumentSession, built without importing app code.
    const next = new session.constructor('next');
    const host = document.createElement('div');
    document.body.append(host);
    controller.mount(host, next, 'markdown');
    const afterRemount = captured.apply(late);
    captured.restore();
    return {
      during,
      afterDispose,
      afterRemount,
      before,
      old: session.current.source,
      next: next.current.source,
    };
  }, EDITOR);
  expect(result).toEqual({
    during: false,
    afterDispose: false,
    afterRemount: false,
    before: 'old',
    old: 'old',
    next: 'next',
  });
});

test('Preview header cells keep their explicit column alignment', async ({ page }) => {
  await mount(page, '| Left | Centre | Right |\n| :--- | :---: | ---: |\n| a | b | c |');
  await setMode(page, 'preview');
  const headers = readable(page).locator('th');
  await expect(headers.nth(0)).toHaveCSS('text-align', 'left');
  await expect(headers.nth(1)).toHaveCSS('text-align', 'center');
  await expect(headers.nth(2)).toHaveCSS('text-align', 'right');
});
