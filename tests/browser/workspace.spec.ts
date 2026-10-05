import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  command,
  download,
  drafts,
  editor,
  expectDraftSaved,
  home,
  homeMenu,
  newFile,
  noSidewaysScroll,
  openText,
  outsideRequests,
  pageErrors,
  palette,
  preferences,
  savedDraft,
  savedPreferences,
  savedSources,
  seedDrafts,
  withoutPickers,
} from './kit';

/** A browser-only draft for saveDraft, as first stored (storage revision 0). */
const localDraft = (id: string, source: string, revision = 0) => ({
  id,
  title: 'a.md',
  fileType: 'markdown',
  favourite: false,
  localBaseline: null,
  identity: { kind: 'local', id },
  current: { source, revision },
  lastOpened: 1,
  storageRevision: 0,
});

test('immediate Home actions, themes, recent work and open histories', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const outside = outsideRequests(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Gittin', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Open Gittin' }).first().click();
  await expect(page.getByRole('button', { name: 'New file' })).toBeEnabled();
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await page.emulateMedia({colorScheme:'light'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.emulateMedia({colorScheme:'dark'});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Close main menu', exact: true }).click();
  await openText(page, '# First\n\nalpha', 'First.md');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially(' one');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await openText(page, '# Second\n\nbeta', 'Second.md');
  await page.getByRole('button', { name: 'First.md', exact: true }).click();
  await expect(editor(page)).toContainText('alpha one');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).not.toContainText('one');
  await page.getByRole('button', { name: 'Second.md', exact: true }).click();
  await expect(editor(page)).toContainText('beta');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#recent .recent-row').filter({ hasText: 'First.md' }).locator('.recent-state')).toHaveText('Saved');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(errors).toEqual([]);
  expect(outside()).toEqual([]);
});
test('direct document URL opens Edit', async ({
  page,
}) => {
  await page.goto('/');
  const [id] = await seedDrafts(page, [{ title: 'Intent.md', source: '# Intended', revision: 7 }]);
  await page.goto('/#/document/' + id);
  await expect(editor(page)).toHaveText('# Intended');
  await expect(page).toHaveURL(new RegExp(id));
  await page.reload();
  await expect(editor(page)).toHaveText('# Intended');
});
test('independent panels, keyboard menus/settings/link dialog', async ({
  page,
}) => {
  await openText(page, '# Notes\n\nHello **world**');
  await page.getByRole('button', { name: 'Files' }).click();
  await expect(
    page.getByRole('complementary', { name: 'Open Files' })
  ).not.toBeVisible();
  await expect(
    page.getByRole('complementary', { name: 'Folder', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Folder', exact: true })
  ).not.toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await palette(page).getByRole('searchbox').fill('Dark');
  await palette(page).getByRole('button', { name: 'Dark appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).press('ControlOrMeta+k');
  await expect(page.getByRole('dialog', { name: 'Insert link' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('a failed draft save keeps the text in memory, downloads the exact bytes, names the cause and recovers on retry', async ({
  page,
}) => {
  await withoutPickers(page, 'save');
  await openText(page, '\ufeffA\r\nB\n', 'bytes.md');
  await expectDraftSaved(page);
  await expect(page.getByLabel('Device recovery status', { exact: true })).toHaveCount(0);
  await expect(page.locator('.recovery-actions')).toBeHidden();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => (IDBObjectStore.prototype.put = put);
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === 'documents')
        throw new DOMException(
          'Storage full: requested record exceeds quota',
          'QuotaExceededError'
        );
      return put.apply(this, args as any);
    };
  });
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially('current');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#draft-status')).toContainText(
    'Storage full: requested record exceeds quota'
  );
  await expect(page.locator('.recovery-actions')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Save recovery copy', exact: true })).toBeInViewport();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(editor(page)).toBeVisible();
  const saved = await download(page, () => page.locator('#save-file').click());
  expect(saved.bytes).toEqual(Buffer.from('\ufeffA\r\nB\ncurrent'));
  await page.evaluate(() => (window as any).restorePut());
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expectDraftSaved(page);
  await expect(page.locator('.recovery-actions')).toBeHidden();
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#home')).toBeVisible();
});
test('a draft changed in another window is kept beside a recovery copy, and Close asks before discarding the copy', async ({
  page,
}) => {
  await openText(page, 'base', 'conflict.md');
  await expectDraftSaved(page);
  const [{ id }] = await drafts(page, 'listRecent');
  const record = await drafts(page, 'loadDraft', id);
  await drafts(
    page,
    'saveDraft',
    { ...record, current: { source: 'other window', revision: 8 } },
    record.storageRevision,
  );
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially(' mine');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#draft-status')).toContainText('newer draft');
  await expect(page.locator('.recovery-actions')).toBeVisible();
  await page.getByRole('button', { name: 'Save recovery copy', exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText('conflict (recovery copy).md');
  await expectDraftSaved(page);
  await expect(page.locator('.recovery-actions')).toBeHidden();
  await page
    .getByRole('button', {
      name: 'Close conflict (recovery copy).md',
      exact: true,
    })
    .click();
  const closing = page.getByRole('dialog', { name: 'Close conflict (recovery copy).md?' });
  await expect(closing).toContainText('This file is only in this browser. Discarding deletes it.');
  await closing.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText('conflict (recovery copy).md');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#home')).toBeVisible();
  expect(await savedSources(page)).toEqual(['base mine', 'other window']);
});

test('backs up all drafts to one file and restores them in an empty browser', async ({
  page,
  browser,
}) => {
  await openText(page, '# Kept\n\nBody', 'kept.md');
  await expectDraftSaved(page);
  await home(page);
  await homeMenu(page, 'Export drafts');
  const backup = await download(page, () =>
    page
      .getByRole('dialog', { name: 'Export drafts' })
      .getByRole('button', { name: 'Download backup' })
      .click(),
  );
  expect(backup.name).toMatch(/^gittin-drafts-\d{4}-\d{2}-\d{2}\.json$/);
  expect(
    JSON.parse(backup.bytes.toString()).drafts.map((draft: { title: string }) => draft.title),
  ).toEqual(['kept.md']);

  // A context made here has no base URL, so the address is spelled out.
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(new URL(page.url()).origin + '/#/home');
  const restore = async () => {
    await homeMenu(other, 'Restore drafts');
    await other
      .getByRole('dialog', { name: 'Restore drafts' })
      .getByLabel('Backup file')
      .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup.bytes });
  };
  await restore();
  await expect(other.locator('#notice')).toContainText(
    'Restored 1 draft. 0 already on this device were kept unchanged.',
  );
  await expect(other.locator('#recent')).toContainText('kept.md');
  await restore();
  await expect(other.locator('#notice')).toContainText(
    'Restored 0 drafts. 1 already on this device was kept unchanged.',
  );
  await context.close();
});

test('desktop-to-narrow resize reveals writing and narrow drawers are mutually exclusive', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openText(page, '# Visible writing\n\nA document that stays reachable.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#documents-panel')).not.toBeVisible();
  await expect(page.locator('#repository-panel')).not.toBeVisible();
  const heading = page.locator('#editor h1');
  await expect(heading).toBeVisible();
  expect(
    await heading.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(
        document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      );
    })
  ).toBe(true);
  await page.getByRole('button', { name: 'Files' }).click();
  await expect(page.locator('#documents-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await expect(page.locator('#documents-panel')).not.toBeVisible();
  await expect(page.locator('#repository-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  await expect(heading).toBeVisible();
});

test('keyboard menu arrows and retained outer reading position', async ({ page }) => {
  await openText(page, '# Long\n\n' + 'A paragraph for scrolling.\n\n'.repeat(70), 'Long.md');
  const column = page.locator('.writing-column');
  await column.evaluate((el) => (el.scrollTop = 800));
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#home')).toBeVisible();
  await page.getByRole('button', { name: 'Long.md', exact: true }).click();
  await expect(column).toBeVisible();
  await expect.poll(() => column.evaluate((el) => el.scrollTop)).toBeGreaterThan(700);
  const file = page.locator('.menus summary').filter({ hasText: /^File$/ });
  await file.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Home', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(file).toBeFocused();
});

test('optional line numbers are searchable, persisted, and do not edit source', async ({
  page,
}) => {
  await openText(page, '# Unchanged\n\nsource');
  await expectDraftSaved(page);
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await palette(page).getByRole('searchbox').fill('Line numbers');
  await expect(palette(page).getByRole('button', { name: 'Line numbers' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await palette(page).getByRole('button', { name: 'Line numbers' }).click();
  await expect(page.locator('#workspace')).toHaveClass(/hide-line-numbers/);
  expect(
    await editor(page)
      .locator(':scope > div')
      .first()
      .evaluate((el) => getComputedStyle(el, '::before').content)
  ).toBe('none');
  await page.reload();
  await expect(page.locator('#workspace')).toHaveClass(/hide-line-numbers/);
  expect((await savedDraft(page)).current).toEqual({
    source: '# Unchanged\n\nsource',
    revision: 0,
  });
});

test('status bar shows the caret line and column in Edit only', async ({ page }) => {
  await openText(page, 'first\nsecond line\n');
  await expectDraftSaved(page);
  // ProseMirror writes its selection back to the DOM 20 ms after focus; in WebKit that can undo a
  // key pressed sooner. A 20 ms page timer set after focusing fires after ProseMirror's.
  await editor(page).focus();
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 20)));
  await editor(page).press('ControlOrMeta+Home');
  await editor(page).press('ArrowDown');
  await editor(page).press('End');
  await expect(page.locator('#caret-status')).toHaveText('Ln 2, Col 12');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#caret-status')).toBeHidden();
  await expect(page.locator('#view-status')).toHaveText('Preview · read-only');
});

test('Focus mode keeps the typing line centred', async ({ page }) => {
  await openText(page, Array.from({ length: 80 }, (_, i) => 'line ' + (i + 1)).join('\n'));
  await expectDraftSaved(page);
  await command(page, 'Focus mode');
  await editor(page).press('ControlOrMeta+Home');
  for (let i = 0; i < 40; i++) await editor(page).press('ArrowDown');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const column = document.querySelector('.writing-column')!.getBoundingClientRect();
        const range = getSelection()!.getRangeAt(0);
        const caret = range.getClientRects()[0] ?? range.getBoundingClientRect();
        return Math.abs((caret.top + caret.bottom) / 2 - (column.top + column.height / 2));
      }),
    )
    .toBeLessThan(30);
});

test('ten open documents keep separate sessions and undo histories', async ({ page }) => {
  test.setTimeout(60000);
  for (let i = 0; i < 10; i++) {
    await openText(page, 'Document ' + i, `Open-${i}.md`);
    await editor(page).click();
    await editor(page).press('ControlOrMeta+End');
    await editor(page).pressSequentially(' edited');
    await page.getByRole('link', { name: 'Gittin home' }).click();
    await expect(page.locator('#home')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Open-0.md', exact: true }).click();
  await expect(page.locator('#open-documents .open-document')).toHaveCount(10);
  await editor(page).click();
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toHaveText('Document 0');
  await page.getByRole('button', { name: 'Open-9.md', exact: true }).click();
  await expect(editor(page)).toHaveText('Document 9 edited');
});

test('every document opens in Edit and retains drafts and other preferences', async ({
  page,
}) => {
  await home(page);
  await preferences(page, 'savePreferences', { theme: 'dark', lineNumbers: false });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('#workspace')).toHaveClass(/hide-line-numbers/);
  await editor(page).click();
  await editor(page).pressSequentially('first');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await openText(page, 'second', 'Second.md');
  await expect(editor(page)).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Untitled file', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveText('first');
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toHaveText('');
  await editor(page).press('ControlOrMeta+Shift+z');
  await expect(editor(page)).toHaveText('first');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const url = page.url();
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveText('first');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(page.locator('#home')).toBeVisible();
  await page.getByRole('button', { name: 'Untitled file', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await page.goto(url);
  await expect(editor(page)).toBeVisible();
  await expect(editor(page)).toHaveText('first');
  expect(await savedSources(page)).toEqual(['first', 'second']);
});

test('files with the same name stay separate in recent work, each keeping its own edits', async ({
  page,
}) => {
  await openText(page, 'one', 'same.md');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await openText(page, 'two', 'same.md');
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially(' changed');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  const rows = page.locator('#recent .recent-row');
  await expect(rows).toHaveCount(2);
  await rows.first().getByRole('button', { name: 'same.md', exact: true }).click();
  await expect(editor(page)).toHaveText('two changed');
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await rows.nth(1).getByRole('button', { name: 'same.md', exact: true }).click();
  await expect(editor(page)).toHaveText('one');
});

test('an aborted draft write is not acknowledged, and a stale revision cannot win', async ({
  page,
}) => {
  await home(page);
  const id = randomUUID();
  expect(await drafts(page, 'saveDraft', localDraft(id, 'old'), 0)).toMatchObject({
    kind: 'saved',
    storageRevision: 1,
  });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restorePut = () => (IDBObjectStore.prototype.put = put);
    IDBObjectStore.prototype.put = function (...args: any[]) {
      const request = put.apply(this, args as any);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  });
  expect((await drafts(page, 'saveDraft', localDraft(id, 'aborted', 1), 1)).kind).toBe('error');
  await page.evaluate(() => (window as any).restorePut());
  expect((await savedDraft(page, id)).current.source).toBe('old');
  expect(await drafts(page, 'saveDraft', localDraft(id, 'newer', 2), 1)).toMatchObject({
    kind: 'saved',
    storageRevision: 2,
  });
  expect((await drafts(page, 'saveDraft', localDraft(id, 'stale', 3), 1)).kind).toBe('conflict');
  expect((await savedDraft(page, id)).current.source).toBe('newer');
});

test('two writers starting from the same stored revision have only one winner', async ({
  page,
}) => {
  await home(page);
  const id = randomUUID();
  const writes = await Promise.all([
    drafts(page, 'saveDraft', localDraft(id, 'one'), 0),
    drafts(page, 'saveDraft', localDraft(id, 'two', 1), 0),
  ]);
  expect(writes.map((write) => write.kind).sort()).toEqual(['conflict', 'saved']);
  expect((await savedDraft(page, id)).storageRevision).toBe(1);
});

test('an ended composition settles before leaving the file captures the draft', async ({
  page,
}) => {
  await openText(page, 'base');
  await expectDraftSaved(page);
  await editor(page).evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.textContent = 'committed';
    el.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertCompositionText',
        data: 'committed',
        isComposing: true,
      }),
    );
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'committed' }));
    document.querySelector<HTMLElement>('a[aria-label="Gittin home"]')!.click();
  });
  await expect(page.locator('#home')).toBeVisible();
  await page.locator('#recent').getByRole('button', { name: 'notes.md', exact: true }).click();
  await expect(editor(page)).toHaveText('committed');
});

test('a new empty file recovers after a reload, and concurrent preference writes merge', async ({
  page,
}) => {
  await newFile(page);
  await expectDraftSaved(page);
  await Promise.all([
    preferences(page, 'savePreferences', { theme: 'dark' }),
    preferences(page, 'savePreferences', { lineNumbers: false }),
  ]);
  expect(await savedPreferences(page)).toMatchObject({ theme: 'dark', lineNumbers: false });
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expectDraftSaved(page);
  expect((await savedDraft(page)).current.source).toBe('');
});

test('unavailable storage still allows writing and downloading, and keeps the file open', async ({
  page,
}) => {
  await withoutPickers(page, 'save');
  await page.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException('Local storage unavailable', 'SecurityError');
    };
  });
  await newFile(page);
  await editor(page).click();
  await editor(page).pressSequentially('keep this');
  await expect(page.locator('#draft-status')).toContainText('could not');
  const saved = await download(page, () => page.locator('#save-file').click());
  expect(saved.bytes).toEqual(Buffer.from('keep this'));
  await page.getByRole('link', { name: 'Gittin home' }).click();
  await expect(editor(page)).toHaveText('keep this');
});

test('a persisted pagehide keeps the editing session usable on return', async ({ page }) => {
  await withoutPickers(page, 'save');
  await openText(page, 'before');
  await expectDraftSaved(page);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })),
  );
  await expect(editor(page)).toBeVisible();
  await editor(page).click();
  await editor(page).press('ControlOrMeta+End');
  await editor(page).pressSequentially(' after');
  await expect.poll(async () => (await savedDraft(page)).current.source).toBe('before after');
  const saved = await download(page, () => page.locator('#save-file').click());
  expect(saved.bytes).toEqual(Buffer.from('before after'));
});
