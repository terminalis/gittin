import { test, expect } from '@playwright/test';
import {
  command,
  download,
  editor,
  expectDraftSaved,
  home,
  newFile,
  noSidewaysScroll,
  openText,
  readable,
  savedDraft,
  savedSources,
  withoutPickers,
} from './kit';

test('new title/type, rename and favourite survive recovery', async ({ page }) => {
  await newFile(page);
  await expect(page.locator('#document-title')).toHaveText('Untitled file');
  await expect.poll(async () => (await savedDraft(page))?.fileType).toBe('markdown');
  await page.locator('#document-title').click();
  const dialog = page.getByRole('dialog', { name: 'Rename file' });
  // A title is a file name, so slashes are refused.
  await dialog.getByLabel('File name').fill('daily/notes');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#document-title')).toHaveText('Untitled file');
  await dialog.getByLabel('File name').fill('Daily notes');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('button', { name: 'Add favourite', exact: true }).click();
  await expect.poll(async () => (await savedDraft(page))?.favourite).toBe(true);
  await page.reload();
  await expect(page.locator('#document-title')).toHaveText('Daily notes');
  await expect(page.getByRole('button', { name: 'Remove favourite' })).toBeVisible();
  expect((await savedDraft(page)).localBaseline).toBeNull();
  await page.goto('/#/home');
  await expect(page.locator('#favourites')).toContainText('Daily notes');
  await page.locator('#favourites').getByRole('button', { name: 'Daily notes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('nested New is keyboard reachable, header identity is logo-only, Find searches file', async ({ page }) => {
  await newFile(page);
  await expect(page.locator('.workspace-header .brand strong')).toHaveCount(0);
  await expect(page.locator('#command-search')).toHaveCount(0);
  await expect(page.locator('.menus > details > summary')).toHaveText(['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help']);
  const file = page.locator('.menus > details > summary').filter({ hasText: /^File$/ });
  await file.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await expect(page.locator('.submenu > summary').filter({ hasText: /^New$/ })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect.poll(async () => (await savedDraft(page))?.fileType).toBe('text');
  await page.getByRole('button', { name: 'Find in current file' }).click();
  await expect(page.locator('.find-bar')).toBeVisible();
  await expect(page.locator('[data-command="undo"]')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await file.click();
  await page.locator('.submenu > summary').filter({ hasText: /^New$/ }).click();
  await expect(page.getByRole('button', { name: 'File', exact: true })).toBeInViewport();
  expect(await noSidewaysScroll(page)).toBe(true);
});

for (const width of [1280, 390]) {
  test(`menus dismiss outside at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await newFile(page);
    if (width === 390) await page.getByRole('button', { name: 'Menus', exact: true }).click();
    const file = page.locator('.menus > details').filter({ has: page.locator('summary', { hasText: /^File$/ }) });
    if (width === 1280) await file.locator(':scope > summary').click();
    // Also exercise keyboard activation of File.
    else await file.locator(':scope > summary').press('Enter');
    const submenu = (name: string) => file.locator('.submenu').filter({ has: page.locator('summary', { hasText: new RegExp(`^${name}$`) }) });
    const newMenu = submenu('New'), openMenu = submenu('Open');
    await newMenu.locator(':scope > summary').click();
    await expect(file).toHaveAttribute('open', '');
    await expect(newMenu).toHaveAttribute('open', '');
    await openMenu.locator(':scope > summary').click();
    await expect(newMenu).not.toHaveAttribute('open', '');
    await expect(openMenu).toHaveAttribute('open', '');
    // At 390px the open menu covers the tools row, so the click lands on the header's Menus button.
    await page.getByRole('button', { name: width === 1280 ? 'Folder' : 'Menus', exact: true }).click();
    await expect(file).not.toHaveAttribute('open', '');
    await expect(openMenu).not.toHaveAttribute('open', '');
  });
}

test('unknown imports retain exact bytes and baseline, working copy has no baseline, code Preview is escaped', async ({ page }) => {
  await withoutPickers(page, 'save');
  const source = '\ufeff<script>window.bad = true</script>\r\n# Literal\n';
  await openText(page, source, 'source.custom', { type: 'text/plain' });
  await expect.poll(async () => (await savedDraft(page))?.localBaseline?.source).toBe(source);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(readable(page).locator('pre')).toHaveText(source);
  expect(await page.evaluate(() => (window as any).bad)).toBeUndefined();
  const saved = await download(page, () => page.locator('#save-file').click());
  expect(saved.name).toBe('source.custom');
  expect(saved.bytes).toEqual(Buffer.from(source));
  expect((await savedDraft(page)).localBaseline.source).toBe(source);
  await command(page, 'Make a copy');
  await expect(page.locator('#document-title')).toHaveText('source (copy).custom');
  await expect.poll(async () => (await savedDraft(page))?.fileType).toBe('unknown');
  expect((await savedDraft(page)).localBaseline).toBeNull();
  expect((await savedDraft(page)).current.source).toBe(source);
});

test('save completion captures the baseline, later typing stays unsaved, Save as retargets', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { files: ['', ''], picks: 0, release: null as null | (() => void) };
    (window as any).device = state;
    (window as any).showSaveFilePicker = async () => {
      const index = state.picks++;
      return {
        getFile: async () => new File([state.files[index]], 'file.md'),
        createWritable: async () => {
          let next = '';
          return { write: async (blob: Blob) => { next = await blob.text(); }, close: async () => {
            if (index === 0 && !state.files[0]) await new Promise<void>(resolve => { state.release = resolve; });
            state.files[index] = next;
          }, abort: async () => {} };
        },
      };
    };
  });
  await newFile(page);
  await editor(page).fill('captured');
  await command(page, 'Save');
  await expect.poll(() => page.evaluate(() => !!(window as any).device.release)).toBe(true);
  // Replace through the editor's keyboard path while the device save is pending.
  await editor(page).click();
  await editor(page).press('ControlOrMeta+a');
  await editor(page).press('Backspace');
  await editor(page).pressSequentially('later');
  await expect(editor(page)).toHaveText('later');
  await page.evaluate(() => (window as any).device.release());
  await expect(page.locator('#file-status')).toContainText('Later edits are not saved yet.');
  await expect.poll(async () => (await savedDraft(page))?.localBaseline?.source).toBe('captured');
  expect((await savedDraft(page)).current.source).toBe('later');
  await command(page, 'Save as…');
  await expect(page.locator('#file-status')).toContainText('Saved as');
  await expect.poll(async () => (await savedDraft(page))?.localBaseline?.source).toBe('later');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+a');
  await editor(page).press('Backspace');
  await editor(page).pressSequentially('next');
  await expect(editor(page)).toHaveText('next');
  await command(page, 'Save');
  await expect.poll(() => page.evaluate(() => (window as any).device.files)).toEqual(['captured', 'next']);
});

test('unsupported save offers download without baseline or saved acknowledgement; print leaves source unchanged', async ({ page }) => {
  await withoutPickers(page, 'save');
  await page.addInitScript(() => {
    window.print = () => {
      (window as any).printed = document.querySelector('#print-file')?.textContent;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await newFile(page);
  await editor(page).fill('# Print me');
  await download(page, () => command(page, 'Save'));
  await expect(page.locator('#file-status')).toContainText('This browser cannot write files');
  await command(page, 'Print');
  await expect.poll(() => page.evaluate(() => (window as any).printed)).toContain('Print me');
  await expect.poll(async () => (await savedDraft(page))?.current?.source).toBe('# Print me');
  expect((await savedDraft(page)).localBaseline).toBeNull();
});

test('a save report clears once the text changes after it', async ({ page }) => {
  await withoutPickers(page, 'save');
  await openText(page, '# Notes\n');
  await download(page, () => page.locator('#save-file').click());
  const report = page.locator('#file-status');
  await expect(report).toContainText('Downloaded notes.md.');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially('More');
  await expect(editor(page)).toContainText('More');
  await expect(report).toBeHidden();
});

test('Save reports no download while text is still being composed', async ({ page }) => {
  await withoutPickers(page, 'save');
  await newFile(page);
  await editor(page).pressSequentially('a');
  await editor(page).evaluate((el) =>
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })),
  );
  let downloaded = false;
  page.on('download', () => (downloaded = true));
  await page.locator('#save-file').click();
  await expect(page.locator('#notice')).toContainText('Finish composing text');
  await page.waitForTimeout(1000);
  expect(downloaded).toBe(false);
  await expect(page.locator('#file-status')).not.toContainText('Downloaded');
});

test('close waits for the captured file save, then asks about later changes', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { source: '', release: null as null | (() => void) };
    (window as any).delayedSave = state;
    (window as any).showSaveFilePicker = async () => ({
      getFile: async () => new File([state.source], 'file.md'),
      createWritable: async () => {
        let source = '';
        return {
          write: async (blob: Blob) => { source = await blob.text(); },
          close: async () => {
            await new Promise<void>(resolve => { state.release = resolve; });
            state.source = source;
          },
          abort: async () => {},
        };
      },
    });
  });
  await newFile(page);
  await editor(page).fill('saved version');
  await command(page, 'Save');
  await expect.poll(() => page.evaluate(() => !!(window as any).delayedSave.release)).toBe(true);
  await editor(page).fill('later draft');
  await page.getByRole('button', { name: 'Close Untitled file', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await expect(editor(page)).toBeVisible();
  await page.evaluate(() => (window as any).delayedSave.release());
  await page.getByRole('dialog', { name: 'Close Untitled file.md?' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor(page)).toHaveText('later draft');
  await expect.poll(async () => (await savedDraft(page))?.localBaseline?.source).toBe('saved version');
});

test('native beforeprint prepares readable Markdown and code and releases its artifact after print/navigation', async ({ page }) => {
  await newFile(page);
  await editor(page).fill('# Native print');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-file h1')).toHaveText('Native print');
  // Paper uses Preview's document styles, and the light palette even when the app is dark.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(page.locator('#print-file h1')).toHaveCSS('font-family', /Mona Sans/);
  await expect(page.locator('#print-file')).toHaveCSS('white-space', 'normal');
  await expect(page.locator('#print-file')).toHaveAttribute('data-readable', '');
  await expect(page.locator('#print-file h1')).toHaveCSS('border-bottom-color', 'rgb(222, 219, 213)');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await expect(page.locator('#print-file')).toBeVisible();
  await expect(page.locator('#app')).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#print-file')).toHaveCount(0);
  await expect(page.locator('#app')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#home')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('#print-file')).toHaveCount(0);
  const source = '<script>window.printExecuted = true</script>';
  await page.locator('input[type=file]').setInputFiles({ name: 'native.html', mimeType: 'text/html', buffer: Buffer.from(source) });
  await expect(page.locator('#document-title')).toHaveText('native.html');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-file pre')).toHaveText(source);
  await expect(page.locator('#print-file')).toHaveClass(/document-source/);
  await expect(page.locator('#print-file script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).printExecuted)).toBeUndefined();
  await expect.poll(async () => (await savedDraft(page))?.current?.source).toBe(source);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#print-file')).toHaveCount(0);
});

test('a download captures a copy while later edits continue', async ({ page }) => {
  await withoutPickers(page, 'save');
  await openText(page, 'exported');
  await expectDraftSaved(page);
  const saved = await download(page, async () => {
    await page.locator('#save-file').click();
    await editor(page).click();
    await editor(page).press('ControlOrMeta+End');
    await editor(page).pressSequentially(' later');
  });
  expect(saved.bytes).toEqual(Buffer.from('exported'));
  await expect(editor(page)).toHaveText('exported later');
});

test('a file that is not UTF-8 is refused by name and stores no draft', async ({ page }) => {
  await withoutPickers(page, 'open');
  await home(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open file', exact: true }).click();
  await (await chooser).setFiles({
    name: 'bad.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from([255]),
  });
  await expect(page.locator('#notice')).toContainText(
    "bad.md is not a UTF-8 text file, so Gittin can't open it.",
  );
  expect(await savedSources(page)).toEqual([]);
});
