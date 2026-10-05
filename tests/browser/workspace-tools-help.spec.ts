import { test, expect, type Page } from '@playwright/test';
import {
  command,
  download,
  editor,
  expectDraftSaved,
  findField,
  holdModule,
  mountWorkspace,
  newFile,
  noSidewaysScroll,
  openText,
  palette,
  readable,
  savedDraft,
  savedPreferences,
  setMode,
  source,
  withoutPickers,
} from './kit';

const bytes = async (page: Page) => (await download(page, () => command(page, 'Save'))).bytes;
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const close = (page: Page, name: string) =>
  dialog(page, name).getByRole('button', { name: 'Close', exact: true }).click();
async function attribution(page: Page) {
  await command(page, 'Attributions…');
  const d = dialog(page, 'Attributions');
  await d.getByLabel('Project or work title').fill('Supplied project');
  await d.getByLabel('Author / project or organisation name').fill('Supplied Team');
  await d.getByLabel('Source URL (optional)').fill('https://example.com/source');
  await d.getByLabel('Licence information / SPDX expression').fill('MIT');
  await d.getByLabel('Copyright text and years (SPDX)').fill('2026 Supplied Owner');
  return d;
}
async function openFile(page: Page, text: string, name = 'source.md') {
  await withoutPickers(page, 'save');
  await openText(page, text, name, { type: 'text/plain' });
  await expectDraftSaved(page);
}
async function createFile(page: Page) {
  await withoutPickers(page, 'save');
  await newFile(page);
}

test('statistics and temporary Compare preserve exact source and saved baseline', async ({
  page,
}) => {
  const original = '\ufeffone 😀\r\ntwo\n';
  await openFile(page, original);
  await command(page, 'File statistics…');
  await expect(dialog(page, 'File statistics').getByRole('row')).toHaveText([
    'Words3',
    'Characters12',
    'Lines3',
    'File size17 bytes',
  ]);
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'File statistics')).toHaveCount(0);
  await command(page, 'Compare files…');
  await dialog(page, 'Compare files')
    .getByLabel('Comparison file')
    .setInputFiles({ name: 'other.md', mimeType: 'text/markdown', buffer: Buffer.from('other\r\n') });
  await expect(page.getByRole('button', { name: 'Diff', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.view-notice')).toContainText('Temporary comparison: other.md');
  await expect(page.locator('[data-command=bold]')).toBeDisabled();
  await expect(readable(page)).toContainText('other');
  await page.getByRole('button', { name: 'Clear temporary comparison' }).click();
  await expect(page.locator('.view-notice')).toHaveText(
    'No changes since the file was opened or saved.',
  );
  expect(await bytes(page)).toEqual(Buffer.from(original));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await bytes(page)).toEqual(Buffer.from(original));
});

test('live statistics save with OK, update while typing, persist and discard cancelled changes', async ({
  page,
}) => {
  await createFile(page);
  await editor(page).pressSequentially('one');
  const stats = page.locator('#file-stats');
  await expect(stats).toBeHidden();
  await command(page, 'File statistics…');
  let d = dialog(page, 'File statistics');
  await expect(
    d.getByRole('checkbox', { name: 'Display stats while typing', exact: true }),
  ).not.toBeChecked();
  await d.getByRole('checkbox').check();
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(stats).toBeHidden();
  await command(page, 'File statistics…');
  d = dialog(page, 'File statistics');
  await expect(d.getByRole('checkbox')).not.toBeChecked();
  await d.getByRole('checkbox').check();
  await page.keyboard.press('Escape');
  await expect(d).toHaveCount(0);
  await expect(stats).toBeHidden();
  await command(page, 'File statistics…');
  d = dialog(page, 'File statistics');
  await expect(d.getByRole('checkbox')).not.toBeChecked();
  await d.getByRole('checkbox').check();
  await d.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(stats).toBeVisible();
  await expect(stats).toHaveText('1 words · 3 characters · 1 lines · 3 bytes');
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially(' two');
  await expect(stats).toHaveText('2 words · 7 characters · 1 lines · 7 bytes');
  // The status can read "saved" from before the typing; wait for the stored text and choice.
  await expect.poll(async () => (await savedDraft(page))?.current.source).toBe('one two');
  await expect.poll(async () => (await savedPreferences(page)).showStatsWhileTyping).toBe(true);
  await page.reload();
  await expect(stats).toBeVisible();
  await expect(stats).toHaveText('2 words · 7 characters · 1 lines · 7 bytes');
  await page.setViewportSize({ width: 390, height: 844 });
  await command(page, 'File statistics…');
  d = dialog(page, 'File statistics');
  await expect(d.getByRole('checkbox')).toBeChecked();
  const bounds = await d.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await d.getByRole('checkbox').uncheck();
  await d.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(stats).toBeVisible();
  await command(page, 'File statistics…');
  d = dialog(page, 'File statistics');
  await expect(d.getByRole('checkbox')).toBeChecked();
  await d.getByRole('checkbox').uncheck();
  await d.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(stats).toBeHidden();
  await expect(page.locator('#view-status')).toHaveText('Edit');
  await expect.poll(async () => (await savedPreferences(page)).showStatsWhileTyping).toBe(false);
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(stats).toBeHidden();
  expect(await bytes(page)).toEqual(Buffer.from('one two'));
});

test('resources list links and images, preserve relative references and navigate source/heading safely', async ({
  page,
}) => {
  const original =
    '# Héading\n\n[safe](https://example.com/path) [relative](../file.md) [jump](#héading) ' +
    '![image](https://example.com/image.png) [bad](javascript:alert(1))';
  await openFile(page, original);
  await command(page, 'Linked resources…');
  let d = dialog(page, 'Linked resources');
  await expect(d.getByRole('button', { name: 'Jump to reference' })).toHaveCount(5);
  await expect(d.getByRole('link', { name: 'Open target' })).toHaveCount(2);
  await expect(d).toContainText('Target unavailable without a file opened from a folder.');
  await expect(d).toContainText('Unsafe or unsupported target.');
  await expect(d.getByRole('link', { name: 'Open target' }).first()).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
  await d.getByRole('button', { name: 'Jump to reference' }).nth(1).click();
  await expect(editor(page)).toBeFocused();
  expect(await bytes(page)).toEqual(Buffer.from(original));
  await command(page, 'Linked resources…');
  d = dialog(page, 'Linked resources');
  await d.getByRole('button', { name: 'Open target' }).click();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await bytes(page)).toEqual(Buffer.from(original));
  await openFile(
    page,
    '<a href="https://example.com/?a=1&amp;b=2">HTML</a><img src="https://example.com/raw.png">' +
      '<!-- <img src="https://example.com/hidden.png"> -->',
    'file.html',
  );
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://example.com')) requests.push(request.url());
  });
  await command(page, 'Linked resources…');
  d = dialog(page, 'Linked resources');
  await expect(d.getByRole('button', { name: 'Jump to reference' })).toHaveCount(2);
  await expect(d.getByRole('link', { name: 'Open target' }).first()).toHaveAttribute(
    'href',
    'https://example.com/?a=1&b=2',
  );
  expect(requests).toEqual([]);
});

test('attribution previews all supplied outputs, inserts with one Undo and creates a local YAML CFF file', async ({
  page,
}) => {
  const original = '\ufefforiginal\r\ntail\n';
  await openFile(page, original);
  await editor(page).press('ControlOrMeta+End');
  let d = await attribution(page);
  await expect(d.locator('pre')).toContainText('Credit: Supplied project by Supplied Team');
  await d.getByLabel('Output format').selectOption('Source comment');
  await expect(d.locator('pre')).toContainText('<!--');
  await d.getByLabel('Output format').selectOption('SPDX/REUSE header');
  await expect(d.locator('pre')).toContainText('SPDX-License-Identifier: MIT');
  await d.getByRole('button', { name: 'Insert at cursor' }).click();
  expect((await bytes(page)).toString()).toContain('SPDX-FileCopyrightText: 2026 Supplied Owner');
  await page.locator('[data-command=undo]').click();
  expect(await bytes(page)).toEqual(Buffer.from(original));
  d = await attribution(page);
  await d.getByLabel('Output format').selectOption('CITATION.cff');
  await d.getByLabel('CFF author kind').selectOption('Project or organisation');
  const expected = await d.locator('pre').textContent();
  await d.getByRole('button', { name: 'Create local CITATION.cff' }).click();
  await expect(page.locator('#document-title')).toHaveText('CITATION.cff');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await bytes(page)).toString()).toBe(expected);
  await expectDraftSaved(page);
  await page.reload();
  await expect(page.locator('#document-title')).toHaveText('CITATION.cff');
  await command(page, 'Details');
  await expect(dialog(page, 'File details')).toContainText('YAML');
  await close(page, 'File details');
  await openFile(page, '{"key":true}', 'file.json');
  d = await attribution(page);
  await d.getByLabel('Output format').selectOption('Source comment');
  await expect(d.getByRole('button', { name: 'Insert at cursor' })).toBeDisabled();
  await expect(d.getByRole('alert')).toContainText('does not support');
});

test('email previews exact saved and draft snapshots and long copy fallback without truncation', async ({
  page,
}) => {
  const baseline = '\ufeffsaved\r\ntext\n';
  await openFile(page, baseline);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('new draft');
  await command(page, 'Email this file');
  await expect(dialog(page, 'Email this file').locator('pre')).toHaveJSProperty(
    'textContent',
    baseline,
  );
  await expect(
    dialog(page, 'Email this file').getByRole('button', { name: 'Open email draft' }),
  ).toBeEnabled();
  await close(page, 'Email this file');
  await command(page, 'Email this draft');
  await expect(dialog(page, 'Email this draft').locator('pre')).toHaveJSProperty(
    'textContent',
    baseline + 'new draft',
  );
  await close(page, 'Email this draft');
  const long = '\ufeff' + 'complete 😀 source\r\n'.repeat(120);
  await openFile(page, long);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copied = text;
        },
      },
    });
  });
  await command(page, 'Email this draft');
  const d = dialog(page, 'Email this draft');
  await expect(d.locator('pre')).toHaveJSProperty('textContent', long);
  await expect(d.getByRole('button', { name: 'Open email draft' })).toBeDisabled();
  await expect(d).toContainText('Nothing has been truncated');
  await d.getByRole('button', { name: 'Copy preview text' }).click();
  expect(await page.evaluate(() => (window as any).copied)).toBe(long);
  await close(page, 'Email this draft');
  expect(await bytes(page)).toEqual(Buffer.from(long));
  await createFile(page);
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await palette(page).getByRole('searchbox').fill('Email this file');
  await expect(
    palette(page).getByRole('button', { name: 'Email this file', exact: true }),
  ).toBeDisabled();
});

test('Download as PDF prints the rendered file under its own name', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      window.dispatchEvent(new Event('beforeprint'));
      (window as any).printed = {
        title: document.title,
        text: document.querySelector('#print-file')?.textContent,
      };
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await openFile(page, '# Report\n\nBody :smile:', 'report.md');
  await command(page, 'Download as PDF…');
  await expect
    .poll(() => page.evaluate(() => (window as any).printed))
    .toEqual({ title: 'report', text: expect.stringContaining('Body 😄') });
  await expect(page).toHaveTitle('report.md — Gittin');
});

test('pressing Print twice while maths loads opens one print dialog', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      (window as any).prints = ((window as any).prints ?? 0) + 1;
    };
  });
  const release = await holdModule(page, '**/src/editor/preview-math.ts*');
  await openFile(page, 'Sum $x + 1$');
  await editor(page).press('ControlOrMeta+p');
  await editor(page).press('ControlOrMeta+p');
  release();
  await expect.poll(() => page.evaluate(() => (window as any).prints)).toBe(1);
  // The check is that nothing more happens, so there is no event to wait for: give a late
  // second print time to show up.
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).prints)).toBe(1);
});

test('Help opens as a dialog, guides separate, shortcuts assigned/platform-specific and policies and feedback open in new tabs', async ({
  page,
  context,
}) => {
  await createFile(page);
  await command(page, 'Gittin Help');
  const panel = page.getByRole('dialog', { name: 'Gittin Help' });
  await expect(panel).toBeVisible();
  await expect(editor(page)).toBeVisible();
  await panel.getByRole('button', { name: 'Preview and Diff' }).click();
  await expect(panel).toContainText('read-only');
  await panel.getByRole('button', { name: 'Preview and Diff' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await command(page, 'Getting Started');
  await expect(dialog(page, 'Getting Started').locator('li')).toHaveCount(5);
  await close(page, 'Getting Started');
  await command(page, "What's new");
  await expect(dialog(page, "What's new")).toContainText('27 September 2026');
  await close(page, "What's new");
  await command(page, 'Keyboard shortcuts');
  let d = dialog(page, 'Keyboard shortcuts');
  await expect(d.locator('h3')).toHaveCount(0);
  await expect(d).toContainText('Search the menus — Ctrl + Shift + P');
  await expect(d).toContainText('Hide or show the menus — Ctrl + Shift + F');
  await expect(d).toContainText('Print — Ctrl + P');
  await d.getByRole('searchbox').fill('Bold');
  await expect(d).toContainText('Bold — Ctrl + B');
  await expect(d).not.toContainText('Search the menus');
  await close(page, 'Keyboard shortcuts');
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' }),
  );
  await command(page, 'Keyboard shortcuts');
  d = dialog(page, 'Keyboard shortcuts');
  await expect(d).toContainText('Search the menus — ⌘ + ⇧ + P');
  await close(page, 'Keyboard shortcuts');
  // Letter keys read as capitals wherever a shortcut is shown.
  await expect(page.locator('[data-command="bold"]')).toHaveAttribute('title', /\(Ctrl\/⌘-B\)$/);
  await page.keyboard.press('ControlOrMeta+Shift+p');
  d = palette(page);
  await d.getByRole('searchbox').fill('Bold');
  await expect(d.locator('kbd')).toHaveText('Ctrl/⌘-B');
  await d.getByRole('searchbox').fill('Print');
  await expect(d.getByRole('button', { name: 'Print', exact: true }).locator('kbd')).toHaveText('Ctrl/⌘-P');
  await close(page, 'Search commands and settings');
  await expect(d).toHaveCount(0);
  for (const [label, path] of [
    ['Privacy Policy', 'privacy.html'],
    ['Terms of Service', 'terms.html'],
  ]) {
    const event = context.waitForEvent('page');
    await command(page, label);
    const policy = await event;
    await expect(policy).toHaveURL(new RegExp('/' + path + '$'));
    await expect(policy.locator('h1')).toContainText(label);
    expect(await policy.evaluate(() => window.opener)).toBeNull();
    await policy.close();
  }
  await context.route('https://github.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>GitHub</title>' }),
  );
  const feedbackEvent = context.waitForEvent('page');
  await command(page, 'Send feedback…');
  const feedback = await feedbackEvent;
  await expect(feedback).toHaveURL('https://github.com/terminalis/gittin/issues/new');
  expect(await feedback.evaluate(() => window.opener)).toBeNull();
  await feedback.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await command(page, 'Gittin Help');
  await expect(page.getByRole('button', { name: 'Close Help' })).toBeInViewport();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('Help can move by pointer and keyboard without resizing the editor or leaving the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await createFile(page);
  const editorBounds = await editor(page).boundingBox();
  await command(page, 'Gittin Help');
  const help = dialog(page, 'Gittin Help');
  await expect(help).toBeVisible();
  expect(await editor(page).boundingBox()).toEqual(editorBounds);
  const heading = help.getByRole('heading', { name: 'Gittin Help' });
  const before = (await help.boundingBox())!;
  const handle = (await heading.boundingBox())!;
  await page.mouse.move(handle.x + 30, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(handle.x + 150, handle.y + 75, { steps: 6 });
  await page.mouse.up();
  const moved = (await help.boundingBox())!;
  expect(moved.x - before.x).toBeCloseTo(120, 0);
  expect(moved.y - before.y).toBeCloseTo(60, 0);
  await heading.press('ArrowLeft');
  expect((await help.boundingBox())!.x).toBeLessThan(moved.x);
  await editor(page).fill('Editing stays available.');
  await expect(help).toBeVisible();
  await expect(editor(page)).toHaveText('Editing stays available.');
  await command(page, 'Gittin Help');
  await expect(help).toHaveCount(1);
  for (let step = 0; step < 15; step++) await heading.press('Shift+ArrowDown');
  await help.getByRole('button', { name: 'Saving and recovery', exact: true }).click();
  const expanded = (await help.boundingBox())!;
  expect(expanded.y + expanded.height).toBeLessThanOrEqual(800);
  await page.setViewportSize({ width: 390, height: 640 });
  await expect
    .poll(async () => {
      const bounds = (await help.boundingBox())!;
      return bounds.x + bounds.width;
    })
    .toBeLessThanOrEqual(390);
  const small = (await help.boundingBox())!;
  expect(small.x).toBeGreaterThanOrEqual(0);
  expect(small.y).toBeGreaterThanOrEqual(0);
  expect(small.x + small.width).toBeLessThanOrEqual(390);
  expect(small.y + small.height).toBeLessThanOrEqual(640);
  await expect(help.getByRole('button', { name: 'Close Help' })).toBeInViewport();
  await heading.press('Escape');
  await expect(help).toHaveCount(0);
  // At 390px the menu row is folded behind the Menus button, so focus returns there.
  await expect(page.getByRole('button', { name: 'Menus', exact: true })).toBeFocused();
  await command(page, 'Gittin Help');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(help).toHaveCount(0);
});

test('Help has a Markdown cheat sheet', async ({ page }) => {
  await openFile(page, '# Help check');
  await command(page, 'Gittin Help');
  const help = dialog(page, 'Gittin Help');
  await help.getByRole('button', { name: 'Markdown syntax', exact: true }).click();
  await expect(help.getByRole('row', { name: /Task list/ })).toContainText('- [ ] to do');
  await expect(help.getByRole('row', { name: /Maths/ })).toContainText('$E = mc^2$');
  await help.getByRole('button', { name: 'Editing', exact: true }).click();
  await expect(help.getByRole('table')).toHaveCount(0);
});

test('About drafts and files can be dismissed and reopened without changing the document', async ({
  page,
}) => {
  await createFile(page);
  await editor(page).fill('Keep this draft.');
  for (const dismiss of ['click', 'keyboard']) {
    await command(page, 'About drafts and files');
    const notice = page.locator('#notice');
    await expect(notice).toContainText('Gittin has no accounts');
    const closeButton = notice.getByRole('button', { name: 'Dismiss notice' });
    if (dismiss === 'click') await closeButton.click();
    else await closeButton.press('Enter');
    await expect(notice).toBeHidden();
    await expect(editor(page)).toHaveText('Keep this draft.');
    await expect(editor(page)).toBeFocused();
  }
});

test('attribution application rejects a changed source or read-only mode', async ({ page }) => {
  await mountWorkspace(page, 'original');
  let d = await attribution(page);
  await page.evaluate(() => {
    const { session } = (window as any).fixture;
    session.applyWriteSource('changed', 'command', session.bookmark);
  });
  await d.getByRole('button', { name: 'Insert at cursor' }).click();
  await expect(d.getByRole('alert')).toContainText('changed');
  expect(await source(page)).toBe('changed');
  await close(page, 'Attributions');
  d = await attribution(page);
  await setMode(page, 'preview');
  await d.getByRole('button', { name: 'Insert at cursor' }).click();
  await expect(d.getByRole('alert')).toContainText('changed');
  expect(await source(page)).toBe('changed');
});

test('Ctrl+Shift+F toggles the menus while non-modal Help is open but not under a modal dialog', async ({
  page,
}) => {
  await createFile(page);
  const header = page.locator('.workspace-header');
  await expect(header).toBeVisible();
  await command(page, 'Gittin Help');
  await expect(dialog(page, 'Gittin Help')).toBeVisible();
  await page.keyboard.press('Control+Shift+f');
  await expect(header).toBeHidden();
  await page.keyboard.press('Control+Shift+f');
  await expect(header).toBeVisible();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: 'Preview and Diff' })
    .focus();
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'Gittin Help')).toHaveCount(0);
  await command(page, 'File statistics…');
  await expect(dialog(page, 'File statistics')).toBeVisible();
  await page.keyboard.press('Control+Shift+f');
  await expect(header).toBeVisible();
});

test('closing Help after hiding the menus moves focus to the menu toggle', async ({ page }) => {
  await createFile(page);
  await command(page, 'Gittin Help');
  await expect(dialog(page, 'Gittin Help')).toBeVisible();
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('.workspace-header')).toBeHidden();
  await dialog(page, 'Gittin Help').getByRole('button', { name: 'Close Help' }).click();
  await expect(dialog(page, 'Gittin Help')).toHaveCount(0);
  await expect(page.locator('.toolbar-menu-toggle')).toBeFocused();
});

test('holding Ctrl+F or Ctrl+Shift+P does not repeat them', async ({ page }) => {
  await createFile(page);
  // A held key sends further keydowns marked as repeats; they are still kept from the browser.
  const held = (key: string, shiftKey = false) => page.evaluate(([key, shiftKey]) =>
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',
      { key, ctrlKey: true, shiftKey, repeat: true, bubbles: true, cancelable: true })),
    [key, shiftKey] as const);
  await page.keyboard.press('ControlOrMeta+f');
  await expect(findField(page)).toBeFocused();
  await editor(page).focus();
  expect(await held('f')).toBe(false);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await palette(page).getByRole('searchbox').fill('Bold');
  expect(await held('P', true)).toBe(false);
  await expect(palette(page).getByRole('searchbox')).toHaveValue('Bold');
});
