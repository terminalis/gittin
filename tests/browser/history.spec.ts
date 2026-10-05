import { test, expect } from '@playwright/test';
import { editor, mountEditor, readable, select, setMode, snapshot, source } from './kit';

test('Preview prevents keyboard mutation while Edit history survives visits and branches', async ({
  page,
}) => {
  await mountEditor(page, 'A');
  const md = editor(page);
  const preview = readable(page);
  for (const letter of ['B', 'C', 'D']) {
    await md.click();
    await md.press('ControlOrMeta+End');
    await md.pressSequentially(letter);
    const before = await snapshot(page);
    await setMode(page, 'preview');
    await expect(preview).toHaveAttribute('contenteditable', 'false');
    await preview.click();
    await preview.pressSequentially('bad');
    const keys = ['Backspace', 'Delete', 'Enter', 'ControlOrMeta+b', 'ControlOrMeta+k'];
    for (const key of [...keys, 'ControlOrMeta+z', 'ControlOrMeta+Shift+z']) await preview.press(key);
    expect(await snapshot(page)).toEqual(before);
    await expect(preview).toHaveText(before.source);
    await setMode(page, 'markdown');
  }
  for (const expected of ['ABC', 'AB', 'A']) {
    await md.click();
    await md.press('ControlOrMeta+z');
    expect(await source(page)).toBe(expected);
    await setMode(page, 'preview');
    await setMode(page, 'markdown');
  }
  for (const expected of ['AB', 'ABC', 'ABCD']) {
    await md.click();
    await md.press('ControlOrMeta+Shift+z');
    expect(await source(page)).toBe(expected);
  }
  await md.press('ControlOrMeta+z');
  await md.press('ControlOrMeta+End');
  await md.pressSequentially('X');
  await md.press('ControlOrMeta+Shift+z');
  expect(await source(page)).toBe('ABCX');
});

test('Preview prevents a drop without source or history changes', async ({ page }) => {
  const original =
    '\ufeff# Tasks\r\n\r\n- [ ] one\n\n```js\ncode\n```\n\n| A | B |\n| - | - |\n| C | D |';
  await mountEditor(page, original, { mode: 'preview' });
  const preview = readable(page);
  await expect(preview.locator('pre code')).toHaveText('code\n');
  await expect(preview).toHaveAttribute('contenteditable', 'false');
  const result = await preview.evaluate((el) => {
    const { session } = (window as any).fixture;
    const beforeHTML = el.innerHTML;
    const beforeStats = JSON.stringify(session.historyStats);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    el.dispatchEvent(drop);
    return {
      prevented: drop.defaultPrevented,
      current: session.current,
      statsEqual: beforeStats === JSON.stringify(session.historyStats),
      domEqual: beforeHTML === el.innerHTML,
    };
  });
  expect(result).toEqual({
    prevented: true,
    current: { source: original, revision: 0 },
    statsEqual: true,
    domEqual: true,
  });
  await setMode(page, 'markdown');
  await expect(editor(page)).toContainText('- [ ] one');
});

test('typing groups, committed composition and source-only marker undo', async ({ page }) => {
  await mountEditor(page, 'A');
  const md = editor(page);
  await md.click();
  await md.press('ControlOrMeta+End');
  await md.pressSequentially('BC');
  await md.press('ControlOrMeta+z');
  expect(await source(page)).toBe('A');
  await md.press('ControlOrMeta+Shift+z');
  expect(await source(page)).toBe('ABC');
  const composition = await md.evaluate((el) => {
    const { session, controller } = (window as any).fixture;
    const view = controller.markdown.view;
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    view.dispatch(view.state.tr.insertText('x', 4));
    view.dispatch(view.state.tr.insertText('漢', 4, 5));
    controller.setMode('preview');
    const result = { source: session.current.source, mode: controller.getMode() };
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '漢', bubbles: true }));
    return result;
  });
  expect(composition).toEqual({ source: 'ABC', mode: 'markdown' });
  await expect.poll(() => source(page)).toBe('ABC漢');
  expect(await page.evaluate(() => (window as any).fixture.controller.getMode())).toBe('preview');
  expect(await page.evaluate(() => (window as any).fixture.controller.execute('undo'))).toBe(false);
  await setMode(page, 'markdown');
  await page.evaluate(() => (window as any).fixture.controller.execute('undo'));
  expect(await source(page)).toBe('ABC');
  // Start the independent source-spelling scenario with a fresh browser editor.
  await mountEditor(page, '- item');
  await select(page, 0, 1);
  await md.pressSequentially('*');
  await expect.poll(() => source(page)).toBe('* item');
  await md.press('ControlOrMeta+z');
  expect(await source(page)).toBe('- item');
});

test('numeric-leading math renders in Preview with exact source available', async ({ page }) => {
  await mountEditor(page, '$2+2$\r\n\r\n$2x$', { mode: 'preview' });
  const restricted = page.locator('.gittin-unsupported');
  await expect(restricted).toBeVisible();
  await expect(readable(page).locator('.katex')).toHaveCount(2);
  await expect(restricted.locator('.view-notice')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).fixture.controller.getPreviewDescription()),
  ).not.toContain('math');
  const before = await snapshot(page);
  await setMode(page, 'markdown');
  expect(await snapshot(page)).toEqual(before);
  await expect(editor(page)).toBeVisible();
  expect(await source(page)).toBe('$2+2$\r\n\r\n$2x$');
});

test('Preview rendered links retain native Enter activation without changing source or history', async ({
  page,
}) => {
  const original = '# Navigation\r\n\r\n[Local link](#preview-target)';
  await mountEditor(page, original, { mode: 'preview' });
  const link = readable(page).locator('a');
  const before = await snapshot(page);
  await link.evaluate((anchor) => {
    (window as any).previewClicks = [];
    // Intercept a local link's native activation so the test does not leave its session.
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      (window as any).previewClicks.push(event.isTrusted);
    });
  });
  await link.focus();
  await link.press('Enter');
  expect(await page.evaluate(() => (window as any).previewClicks)).toEqual([true]);
  expect(await snapshot(page)).toEqual(before);
  await expect(readable(page)).toHaveAttribute('contenteditable', 'false');
  await setMode(page, 'markdown');
  await expect(editor(page)).toHaveText('# Navigation[Local link](#preview-target)');
  expect(await source(page)).toBe(original);
});
