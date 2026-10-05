import { test, expect } from '@playwright/test';
import {
  editor,
  findField,
  findResult,
  mountEditor,
  notice,
  openText,
  readable,
  setMode,
  snapshot,
} from './kit';

test('Preview hover and focus describe current rendering limitations without a document banner', async ({
  page,
}) => {
  const source =
    '# Preview notes\n\nMath $x^2$.\n\n[[Wiki]]\n\n```mermaid\ngraph TD; A-->B\n```\n';
  await openText(page, source, 'preview-notes.md');
  await expect(editor(page)).toBeVisible();
  const button = page.getByRole('button', { name: 'Preview', exact: true });
  await button.hover();
  await expect(button).toHaveAttribute('title', /wiki links remains visible source/);
  await expect(button).not.toHaveAttribute('title', /mermaid|math/);
  const description = await button.getAttribute('title');
  await button.focus();
  await expect(button).toHaveAccessibleDescription(description!);
  await expect(editor(page)).toBeVisible();
  await button.click();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator('#editor')).not.toContainText('Preview qualification');
  await expect(readable(page).locator('.katex')).toHaveCount(1);
  await expect(readable(page)).toContainText('graph TD; A-->B');
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(notice(page)).toHaveText(
    'No changes since the file was opened or saved.',
  );
  await button.focus();
  await expect(button).toHaveAttribute('title', description!);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor(page).press('ControlOrMeta+a');
  await editor(page).pressSequentially('Plain text');
  await button.hover();
  await expect(button).toHaveAttribute('title', 'Preview is read-only.');
  await button.click();
  await expect(readable(page)).toHaveText('Plain text');
  await expect(notice(page)).toHaveCount(0);
});

test('Preview renders safe HTML, alerts, footnotes, unique heading navigation and honest unsupported source', async ({
  page,
}) => {
  const source =
    [
      '# **Hello**, `world`!',
      '# Hello world',
      '[Jump](#hello-world-1)',
      '<ins>under</ins> <sup>up</sup> <sub>down</sub> <mark>marked</mark>',
      '<div align="center">Centre</div>',
      '<details><summary>More</summary>inside</details>',
      '<img src="https://example.invalid/i.png" width="120" height="40" alt="image">',
      '> [!NOTE]\n> Pay attention',
      'Text[^n].',
      '[^n]: A **strong** note.\n    Continuation.',
      '<script>window.untrusted=true</script>',
      '<span style="position:fixed">unsafe CSS</span>',
      '```mermaid\ngraph TD; A-->B\n```',
      '$$x$$',
    ].join('\n\n') + '\n';
  await mountEditor(page, source);
  const initial = await snapshot(page);
  await setMode(page, 'preview');
  await expect(readable(page).locator('ins')).toHaveText('under');
  await expect(readable(page).locator('mark')).toHaveText('marked');
  await expect(readable(page).locator('[align="center"]')).toHaveText('Centre');
  await expect(readable(page).locator('img')).toHaveAttribute('width', '120');
  await readable(page).locator('summary').click();
  await expect(readable(page).locator('details')).toHaveAttribute('open', '');
  await expect(readable(page).locator('.preview-alert')).toContainText('NOTE');
  await expect(readable(page).getByRole('region', { name: 'Footnotes' })).toContainText(
    'Continuation.',
  );
  await readable(page).getByRole('link', { name: 'Footnote 1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(readable(page).locator('#footnote-1')).toBeFocused();
  await readable(page).getByRole('link', { name: 'Jump', exact: true }).click();
  await expect(readable(page).locator('#hello-world-1')).toBeFocused();
  await expect(
    readable(page).locator('script,[style]:not(.katex *):not(.preview-diagram *)'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).untrusted)).toBeUndefined();
  await expect(notice(page)).toHaveCount(0);
  await expect(readable(page).locator('.preview-diagram svg')).toBeVisible();
  await expect(readable(page).locator('.katex-display')).toBeVisible();
  await expect(readable(page)).toContainText('window.untrusted=true');
  expect(await snapshot(page)).toEqual(initial);
});

test('HTML and unknown file previews never execute or infer Markdown rendering', async ({
  page,
}) => {
  await mountEditor(page, '<script>window.untrusted=true</script><b>plain</b>', { type: 'html' });
  await setMode(page, 'preview');
  await expect(readable(page)).toHaveText('<script>window.untrusted=true</script><b>plain</b>');
  await expect(readable(page).locator('script,b')).toHaveCount(0);
  await page.evaluate(() => (window as any).fixture.controller.setFileType('unknown'));
  expect(
    await page.evaluate(() => (window as any).fixture.controller.getPreviewDescription()),
  ).toContain('Unknown language');
});

test('task list states are static and details Find only searches currently visible content', async ({
  page,
}) => {
  await mountEditor(
    page,
    '- [x] Done\n- [ ] Pending\n\n<details><summary>Summary</summary>hiddenneedle</details>\n\n' +
      'Inline \\(x\\) math.',
    { find: true },
  );
  const initial = await snapshot(page);
  await setMode(page, 'preview');
  const done = readable(page).getByRole('checkbox', { name: 'Completed', exact: true });
  await expect(done).toHaveAttribute('aria-checked', 'true');
  await expect(
    readable(page).getByRole('checkbox', { name: 'Not completed', exact: true }),
  ).toHaveAttribute('aria-checked', 'false');
  await done.click();
  expect(await snapshot(page)).toEqual(initial);
  await page.evaluate(() => (window as any).fixture.find.open());
  await findField(page).fill('hiddenneedle');
  await expect(findResult(page)).toHaveText('No matches');
  await readable(page).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(findResult(page)).toHaveText('1 of 1 matches');
  await readable(page).locator('summary').click();
  await expect(findResult(page)).toHaveText('No matches');
  expect((await readable(page).textContent())?.match(/\\\(x\\\)/g)).toHaveLength(1);
});

test('hidden comments with unsupported markers never leak through Preview fallback, Find or Copy', async ({
  page,
}) => {
  const source = [
    'Before',
    '<!-- secretMath $x$ -->',
    '<!-- secretFootnote [^private] -->',
    '<!--\n::: secretDirective\n-->',
    'After',
    '\\[ before\n<!-- secretMixed [^n] -->\nafter \\]',
    '`<!-- literal $code$ -->`',
    '[URL](https://example.test/<!--literal-->)',
  ].join('\r\n\r\n');
  await mountEditor(page, source, { find: true });
  const before = await snapshot(page);
  await page.evaluate(() => {
    const { controller, find } = (window as any).fixture;
    controller.setDisplaySettings({ showComments: false });
    controller.setMode('preview');
    find.open();
  });
  await expect(readable(page)).not.toContainText('secret');
  await expect(readable(page)).toContainText('before');
  await expect(readable(page)).toContainText('after');
  await expect(readable(page)).toContainText('<!-- literal $code$ -->');
  await expect(readable(page).getByRole('link', { name: 'URL' })).toHaveAttribute(
    'href',
    /literal/,
  );
  await findField(page).fill('secret');
  await expect(findResult(page)).toHaveText('No matches');
  await page.getByRole('button', { name: 'Close find' }).click();
  const copy = () =>
    page.evaluate(async () => {
      const { controller } = (window as any).fixture;
      let text = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            text = value;
          },
        },
      });
      controller.execute('selectAll');
      await controller.clipboard('copy');
      return text;
    });
  expect(await copy()).not.toContain('secret');
  await page.evaluate(() =>
    (window as any).fixture.controller.setDisplaySettings({ showComments: true }),
  );
  await expect(readable(page)).toContainText('secretMath');
  await expect(readable(page)).toContainText('secretFootnote');
  await expect(readable(page)).toContainText('secretDirective');
  expect(await copy()).toContain('secretMixed');
  await setMode(page, 'markdown');
  expect(await copy()).toBe(source);
  expect(await snapshot(page)).toEqual(before);
});

test('Preview draws Mermaid diagrams and keeps invalid diagrams as source', async ({ page }) => {
  await openText(
    page,
    '```mermaid\ngraph LR\n  A --> B\n```\n\n```mermaid\nnot a diagram ((\n```\n',
    'diagrams.md',
  );
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const figures = readable(page).locator('.preview-diagram');
  await expect(figures.nth(0).locator('svg')).toBeVisible();
  await expect(figures.nth(1)).toContainText('not a diagram ((');
  await expect(figures.nth(1).locator('svg')).toHaveCount(0);
  await expect(page.locator('body > [id^="dgittin-diagram"]')).toHaveCount(0);
});

test('Preview redraws diagrams when the system appearance changes', async ({ page }) => {
  await openText(page, '```mermaid\ngraph LR\n  A --> B\n```\n', 'diagrams.md');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const style = readable(page).locator('.preview-diagram svg style').first();
  await expect(style).toContainText(/#ECECFF/i);
  await readable(page).evaluate((element) => {
    element.dataset.kept = '1';
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(style).toContainText(/#1f2020/i);
  await expect(readable(page)).toHaveAttribute('data-kept', '1');
});
