import { test, expect, type Page } from '@playwright/test';
import {
  EDITOR,
  commandIds,
  editor,
  expectDraftSaved,
  findField,
  findResult,
  home,
  menu,
  mountEditor,
  newFile,
  notice,
  openMenu,
  openText,
  readable,
  select,
  setMode,
  snapshot,
  source,
  withoutPickers,
} from './kit';

const mount = (page: Page, source: string, type = 'markdown') =>
  mountEditor(page, source, { type, find: true });
const clearComparison = (page: Page) =>
  page.getByRole('button', { name: 'Clear temporary comparison' }).click();

test('Diff uses exact opened/saved baselines and labelled temporary comparison with no source/history effects', async ({
  page,
}) => {
  await mount(page, 'current\r\n');
  const initial = await snapshot(page);
  await setMode(page, 'diff');
  await expect(notice(page)).toContainText('No baseline yet');
  await page.evaluate(() => {
    (window as any).fixture.controller.setBaseline({ source: 'opened\r\n', revision: 0 });
  });
  await expect(readable(page)).toContainText('opened');
  await expect(readable(page)).toContainText('current');
  await page.evaluate(() =>
    (window as any).fixture.controller.setComparison('temporary\n', 'Other file.md'),
  );
  await expect(notice(page)).toContainText('Temporary comparison: Other file.md');
  await expect(readable(page)).not.toContainText('opened');
  await clearComparison(page);
  await expect(readable(page)).toContainText('opened');
  await page.evaluate(() => {
    const { controller, session } = (window as any).fixture;
    controller.setBaseline({ ...session.current });
  });
  await expect(notice(page)).toHaveText('No changes since the file was opened or saved.');
  await expect(page.locator('.diff-skipped')).toHaveText('⋯1 unchanged line');
  await page.evaluate(() => {
    const { controller, session } = (window as any).fixture;
    controller.setComparison(session.current.source, 'Same file.md');
  });
  await expect(notice(page)).toContainText(
    'Temporary comparison: Same file.md versus current draft. ' +
      'Normal opened/saved baseline is retained. No changes.',
  );
  await clearComparison(page);
  await expect(notice(page)).toHaveText('No changes since the file was opened or saved.');
  expect(await snapshot(page)).toEqual(initial);
});

test('Diff draws each change with three lines of context and one marker row per skipped run', async ({
  page,
}) => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}\n`);
  await mount(page, [...lines.slice(0, 19), 'changed\n', ...lines.slice(20)].join(''));
  await page.evaluate((source) => {
    const { controller } = (window as any).fixture;
    controller.setBaseline({ source, revision: 0 });
    controller.setMode('diff');
  }, lines.join(''));
  // Each row reads old number, new number, sign, then text.
  await expect(page.locator('.diff-line')).toHaveText([
    '⋯16 unchanged lines',
    '1717line 17',
    '1818line 18',
    '1919line 19',
    '20−line 20',
    '20+changed',
    '2121line 21',
    '2222line 22',
    '2323line 23',
    '⋯17 unchanged lines',
  ]);
  await expect(page.locator('.diff-line:not(.diff-skipped) .diff-old-number')).toHaveText([
    '17',
    '18',
    '19',
    '20',
    '',
    '21',
    '22',
    '23',
  ]);
  await expect(notice(page)).toHaveCount(0);
});

test('Diff Find, Select all and Copy target displayed old/new text; all mutations reject', async ({
  page,
}) => {
  await mount(page, 'new');
  await page.evaluate(() => {
    const { controller, find } = (window as any).fixture;
    controller.setBaseline({ source: 'old', revision: 0 });
    controller.setMode('diff');
    find.open();
  });
  await findField(page).fill('old');
  await expect(findResult(page)).toHaveText('1 of 1 matches');
  await expect(page.getByRole('button', { name: 'Replace all', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close find' }).click();
  await readable(page).focus();
  await readable(page).press('ControlOrMeta+a');
  const copied = await page.evaluate(async () => {
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    await (window as any).fixture.controller.clipboard('copy');
    return copied;
  });
  expect(copied).toContain('old');
  expect(copied).toContain('new');
  const before = await snapshot(page);
  await readable(page).press('Backspace');
  await readable(page).press('ControlOrMeta+b');
  await readable(page).press('ControlOrMeta+z');
  const ids = (await commandIds(page)).filter((id) => !['copy', 'selectAll'].includes(id));
  const results = await page.evaluate(
    (ids) => ids.map((id) => (window as any).fixture.controller.execute(id)),
    ids,
  );
  expect(results.every((result: unknown) => !result)).toBe(true);
  expect(await snapshot(page)).toEqual(before);
});

test('comments, whitespace, colors and wrap are display-only with exact native Edit copy', async ({
  page,
}) => {
  const source =
    'const url="https://x/*literal*/";\r\n/* secret\r\ncontinued */\r\nlet x = "value";\r\n';
  await mount(page, source, 'javascript');
  const initial = await snapshot(page);
  const display = (settings: object) =>
    page.evaluate(
      (settings) => (window as any).fixture.controller.setDisplaySettings(settings),
      settings,
    );
  await display({ showComments: false, whitespace: true, wordWrap: false });
  await expect(page.locator('.hidden-comment').first()).toBeHidden();
  await expect(page.locator('.visible-space').first()).toBeVisible();
  await expect(page.locator('#editor')).toHaveClass(/wrap-off/);
  await page.evaluate(() => (window as any).fixture.controller.execute('selectAll'));
  const copied = await page.evaluate((selector) => {
    const data = new DataTransfer();
    const event = { bubbles: true, cancelable: true, clipboardData: data };
    document.querySelector(selector)!.dispatchEvent(new ClipboardEvent('copy', event));
    return data.getData('text/plain');
  }, EDITOR);
  expect(copied).toBe(source);
  await setMode(page, 'preview');
  await expect(readable(page)).not.toContainText('secret');
  await expect(readable(page)).toContainText('https://x/*literal*/');
  await expect(readable(page).locator('.syntax-string')).toHaveCount(2);
  await page.evaluate(() => {
    const { controller } = (window as any).fixture;
    controller.setBaseline({ source: '/* baseline\nsecret */\nold', revision: 0 });
    controller.setMode('diff');
  });
  await expect(readable(page)).not.toContainText('secret');
  await display({ showComments: true, syntaxHighlighting: false });
  await expect(readable(page)).toContainText('secret');
  await expect(readable(page).locator('[class^="syntax-"]')).toHaveCount(0);
  await setMode(page, 'markdown');
  expect(await snapshot(page)).toEqual(initial);
});

test('shown whitespace keeps every line one row high and a blank line takes typing', async ({
  page,
}) => {
  await mount(page, 'one\n\nsee [x](https://x.y)\nlast');
  const lines = page.locator(`${EDITOR} > div`);
  const heights = () =>
    lines.evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().height));
  const plain = await heights();
  await page.evaluate(() =>
    (window as any).fixture.controller.setDisplaySettings({ whitespace: true }),
  );
  await expect(page.locator('.visible-newline')).toHaveCount(3);
  // A line that grew would push every later line, and its number, off the text's rows.
  const shown = await heights();
  expect(shown).toEqual(plain);
  expect(shown[1]).toBe(shown[0]);
  await lines.nth(1).click();
  await page.keyboard.type('two');
  expect(await source(page)).toBe('one\ntwo\nsee [x](https://x.y)\nlast');
});

test('Edit cut puts the exact source on the clipboard and one Undo restores it', async ({ page }) => {
  const original = 'one\r\ntwo\r\nthree';
  await mount(page, original);
  await select(page, 2, 8);
  const cut = await page.evaluate((selector) => {
    const data = new DataTransfer();
    const event = { bubbles: true, cancelable: true, clipboardData: data };
    document.querySelector(selector)!.dispatchEvent(new ClipboardEvent('cut', event));
    return data.getData('text/plain');
  }, EDITOR);
  expect(cut).toBe('e\r\ntwo');
  expect(await source(page)).toBe('on\r\nthree');
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe(original);
});

test('workspace persists display preferences; a declined Full screen is reported and does not start Focus mode', async ({
  page,
}) => {
  await newFile(page);
  await editor(page).fill('hello <!-- comment -->');
  await menu(page, 'View', 'Show comments');
  await menu(page, 'View', 'Show whitespace');
  await menu(page, 'View', 'Word wrap');
  await menu(page, 'View', 'Syntax highlighting');
  await page.locator('[data-mode="diff"]').click();
  await expect(notice(page)).toContainText('No baseline');
  await expectDraftSaved(page);
  await page.reload();
  await expect(page.locator('[data-mode="markdown"]')).toHaveAttribute('aria-pressed', 'true');
  await openMenu(page, 'View');
  await expect(
    page.locator('.menus').getByRole('button', { name: 'Show comments', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#editor')).toHaveClass(/syntax-off/);
  await expect(page.locator('#editor')).toHaveClass(/wrap-off/);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#workspace')!.requestFullscreen = () =>
      Promise.reject(Error('denied'));
  });
  await menu(page, 'View', 'Full screen');
  await expect(
    page.getByRole('status').filter({ hasText: 'The browser declined full screen' }),
  ).toBeVisible();
  await expect(page.locator('#workspace')).not.toHaveClass(/focus-mode/);
});

test('explicit save completion refreshes mounted Diff with captured version; autosave and reload retain it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const device = { release: null as null | (() => void), source: '' };
    (window as any).device = device;
    (window as any).showSaveFilePicker = async () => ({
      getFile: async () => new File([device.source], 'test.md'),
      createWritable: async () => {
        let next = '';
        return {
          write: async (blob: Blob) => {
            next = await blob.text();
          },
          close: async () => {
            await new Promise<void>((resolve) => (device.release = resolve));
            device.source = next;
          },
          abort: async () => {},
        };
      },
    });
  });
  await newFile(page);
  await editor(page).fill('captured');
  await menu(page, 'File', 'Save');
  await expect.poll(() => page.evaluate(() => !!(window as any).device.release)).toBe(true);
  await editor(page).fill('later');
  await page.locator('[data-mode="diff"]').click();
  await expect(notice(page)).toContainText('No baseline');
  await page.evaluate(() => (window as any).device.release());
  // A first save rebuilds the workspace for the new file location (Version history becomes
  // available); Diff stays.
  await expect(page.locator('#version-history')).toBeEnabled();
  await expect(page.locator('[data-mode="diff"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.diff-remove')).toContainText('captured');
  await expect(page.locator('.diff-add')).toContainText('later');
  await expectDraftSaved(page);
  await page.reload();
  await expect(editor(page)).toHaveText('later');
  await page.locator('[data-mode="diff"]').click();
  await expect(page.locator('.diff-remove')).toContainText('captured');
});

test('coarse Diff retains full versions with bounded DOM and reports newline-only changes', async ({
  page,
}) => {
  await mount(page, 'a\n');
  await page.evaluate(() => {
    const { controller } = (window as any).fixture;
    controller.setBaseline({ source: 'a\r\n', revision: 0 });
    controller.setMode('diff');
  });
  await expect(notice(page)).toHaveCount(0);
  await expect(page.locator('.diff-remove')).toHaveCount(1);
  await expect(page.locator('.diff-add')).toHaveCount(1);
  await page.evaluate(() => {
    const { controller } = (window as any).fixture;
    controller.setComparison('old\n'.repeat(11000), 'Large baseline');
  });
  await expect(notice(page)).toContainText('Coarse comparison');
  await expect(readable(page).locator('pre')).toHaveCount(2);
  await expect(readable(page).locator('pre').first()).toHaveText('old\n'.repeat(11000));
});

test('the Outline is drawn as soon as a file opens', async ({ page }) => {
  await withoutPickers(page, 'open');
  for (const [name, source, outline] of [
    [
      'site.yaml',
      '# Site settings\ntitle: "Field notes"\n',
      'Outline is available for Markdown files.',
    ],
    ['guide.md', '# Guide\n\n## Getting started\n', 'GuideGetting started'],
    ['notes.md', 'No headings yet.\n', 'Headings in this file appear here.'],
  ]) {
    await home(page);
    // Records the Outline when the workspace first appears, before any timer can fill it in.
    await page.evaluate(() => {
      (window as any).outlineAtOpen = new Promise((resolve) =>
        new MutationObserver((_, observer) => {
          const element = document.querySelector('#outline');
          if (element) {
            observer.disconnect();
            resolve(element.textContent);
          }
        }).observe(document.body, { childList: true, subtree: true }),
      );
    });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open file', exact: true }).click();
    await (await chooser).setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(source) });
    expect(await page.evaluate(() => (window as any).outlineAtOpen)).toBe(outline);
  }
});

test('the view switch and View › Mode read Edit, Preview, Diff', async ({ page }) => {
  await newFile(page);
  await expect(page.locator('.segmented [data-mode]')).toHaveText(['Edit', 'Preview', 'Diff']);
  await openMenu(page, 'View', 'Mode');
  await expect(page.locator('.submenu[open] .submenu-items .menu-label')).toHaveText([
    'Edit view',
    'Preview view',
    'Diff view',
  ]);
});

test('Diff shows Markdown without syntax colours, like Edit; code files keep theirs', async ({
  page,
}) => {
  await openText(page, '# Title\n\nSee [guide](docs/guide.md) and `code`.\n');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially('More.');
  await page.locator('[data-mode="diff"]').click();
  await expect(page.locator('.diff-line').first()).toBeVisible();
  await expect(page.locator('.diff-line code [class^="syntax-"]')).toHaveCount(0);
  await openText(page, 'const answer = 42;\n', 'app.js');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially('let more = 1;');
  await page.locator('[data-mode="diff"]').click();
  await expect(page.locator('.diff-line code .syntax-keyword').first()).toBeVisible();
});
