import { test, expect } from '@playwright/test';
import { editor, expectDraftSaved, fileAction, home, newFile, rememberFolder, savedDraft, seedDrafts } from './kit';

test("Home's editor snippet sits well clear of the welcome words and buttons at every width", async ({
  page,
}) => {
  await home(page);
  // Decoration only: hidden from assistive technology, and coloured with the editor's own
  // syntax classes.
  await expect(page.locator('.home-art')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.home-snippet .syntax-string').first()).toBeAttached();
  for (const width of [1440, 1280, 955, 883, 800, 761, 760, 390])
    await test.step(`${width}px`, async () => {
      await page.setViewportSize({ width, height: 900 });
      const snippet = page.locator('.home-snippet');
      if (width <= 760) return expect(snippet).toBeHidden();
      await expect(snippet).toBeVisible();
      const layout = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const textRight = (el: Element) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getBoundingClientRect().right;
        };
        const copy = (selector: string) =>
          [...document.querySelectorAll(`.home-welcome-copy ${selector}`)];
        const rights = [
          ...copy('.reassurance').map(textRight),
          ...copy('button').map((button) => button.getBoundingClientRect().right),
        ];
        const snippet = box('.home-snippet');
        return {
          gap: snippet.left - Math.max(...rights),
          snippet,
          frameRight: box('.home-art').right,
          columnRight: box('.home-menu-trigger').right,
        };
      });
      expect(layout.gap).toBeGreaterThanOrEqual(64);
      // Cut off at the content column's right edge, where the menu button ends, not at the
      // window's.
      expect(Math.abs(layout.frameRight - layout.columnRight)).toBeLessThan(1);
      expect(layout.snippet.right).toBeGreaterThan(layout.frameRight);
      expect(layout.frameRight - layout.snippet.left).toBeGreaterThanOrEqual(100);
    });
});

test('a first visit to Home shows one empty note, not empty sections, and says things once', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await home(page);
  await expect(page.locator('.home-welcome-copy > :not(.document-actions)')).toHaveCount(1);
  await expect(page.locator('.home-welcome .reassurance')).toHaveText(
    'No account needed.',
  );
  await expect(page.locator('#folders, #favourites')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Recently worked on']);
  await expect(page.locator('#recent')).toContainText('Your recent files will appear here.');
  await expect(page.locator('#recent')).toContainText(
    'So will the folders you open and the files you star.',
  );
  await expect(
    page.getByText('Unsaved changes are kept in this browser', { exact: false }),
  ).toHaveCount(1);
  // The note sits under Recently worked on's heading, before the list whose states it explains.
  await expect(page.locator('.recent-section > h2 + .storage-note + #recent')).toHaveCount(1);
});

test('Recently worked on says when a file was last opened, with the time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await newFile(page);
  await expectDraftSaved(page);
  await home(page);
  await expect(page.locator('#recent .recent-when').first()).toHaveText(/^Today, /);
});

for (const width of [1280, 390])
  test(`a Recently worked on row opens its file from anywhere along it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await newFile(page);
    await expectDraftSaved(page);
    await home(page);
    const row = page.locator('#recent .recent-row').filter({ hasText: 'Untitled file' });
    await expect(row.locator('.file-tile')).toHaveText('MD');
    await expect(row.locator('.recent-state')).toHaveText('Not saved yet');
    await expect(row.locator('.recent-folder')).toHaveCount(0);
    const actions = row.getByRole('button', { name: 'Actions for Untitled file', exact: true });
    const box = (await row.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const smallest = Math.min(actionsBox.width, actionsBox.height);
    expect(smallest).toBeGreaterThanOrEqual(width < 600 ? 44 : 40);
    expect(box.height).toBeGreaterThanOrEqual(60);
    await row.click({ position: { x: actionsBox.x - box.x - 40, y: box.height / 2 } });
    await expect(page.locator('#document-title')).toHaveText('Untitled file');
  });

test('recent folders sit under their label, with a folder icon', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await home(page);
  await rememberFolder(page);
  await page.reload();
  await expect(
    page.locator('#folders button').first().locator('[data-icon="folder"]'),
  ).toBeVisible();
  const label = (await page.locator('#folders-label').boundingBox())!;
  const chip = (await page.locator('#folders .folder-chip').first().boundingBox())!;
  expect(chip.y).toBeGreaterThanOrEqual(label.y + label.height);
  expect(Math.abs(chip.x - label.x)).toBeLessThan(1);
});

test('a recent folder can be taken off Home', async ({ page }) => {
  await home(page);
  await rememberFolder(page);
  await page.reload();
  await page.getByRole('button', { name: 'Remove project from Home', exact: true }).click();
  await expect(page.locator('#folders')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#folders')).toHaveCount(0);
});

test('Home loads no editor code until a file opens', async ({ page }) => {
  const editorCode: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('prosemirror')) editorCode.push(request.url());
  });
  await home(page);
  expect(editorCode).toEqual([]);
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  expect(editorCode).not.toEqual([]);
});

test("a file's ⋯ favourites it in place: the file stays put on screen and its ⋯ keeps focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/use/#/home');
  const now = Date.now();
  await seedDrafts(page, Array.from({ length: 12 }, (_, i) =>
    ({ title: `File ${i + 1}`, source: String(i), lastOpened: now - i * 1000 })));
  await page.reload();
  const actions = page.locator('#recent').getByRole('button', { name: 'Actions for File 10', exact: true });
  await actions.scrollIntoViewIfNeeded();
  const before = (await actions.boundingBox())!.y;
  await actions.click();
  const menu = page.getByRole('menu', { name: 'Actions for File 10', exact: true });
  // Delete… is only for files in a folder.
  await expect(menu.locator('button')).toHaveText(['Favourite', 'Rename…', 'Remove']);
  expect(await menu.locator('[data-icon]').evaluateAll(icons => icons.map(icon => icon.getAttribute('data-icon'))))
    .toEqual(['star', 'pencil', 'x']);
  const favourite = menu.getByRole('menuitemcheckbox', { name: 'Favourite', exact: true });
  await expect(favourite).toHaveAttribute('aria-checked', 'false');
  await favourite.click();
  await expect(page.locator('#favourites')).toContainText('File 10');
  await expect(actions).toBeFocused();
  expect(Math.abs((await actions.boundingBox())!.y - before)).toBeLessThan(2);
  const card = page.locator('#favourites').getByRole('button', { name: 'Actions for File 10', exact: true });
  await card.click();
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Favourite', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await fileAction(page, 'File 10', 'Favourite', page.locator('#favourites'));
  await expect(page.locator('#favourites')).toHaveCount(0);
});

test('Rename… on Home renames a file kept only in Gittin, and its type follows the new name', async ({ page }) => {
  await page.goto('/use/#/home');
  const [id] = await seedDrafts(page, [{ title: 'notes', source: 'Notes' }]);
  await page.reload();
  await fileAction(page, 'notes', 'Rename…');
  const dialog = page.getByRole('dialog', { name: 'Rename file', exact: true });
  await expect(dialog.getByLabel('File name')).toHaveValue('notes');
  await dialog.getByLabel('File name').fill('notes.txt');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#recent .recent-row').filter({ hasText: 'notes.txt' }).locator('.file-tile')).toHaveText('TXT');
  await expect(page.locator(`#recent-actions-${id}`)).toBeFocused();
  expect(await savedDraft(page, id)).toMatchObject({ title: 'notes.txt', fileType: 'text' });
});

test('Remove on Home warns that a file kept only in Gittin is deleted, then focuses the next file', async ({ page }) => {
  await page.goto('/use/#/home');
  const now = Date.now();
  await seedDrafts(page, [
    { title: 'One', source: '1', lastOpened: now },
    { title: 'Two', source: '2', lastOpened: now - 1000 },
    { title: 'Three', source: '3', lastOpened: now - 2000 },
  ]);
  await page.reload();
  await fileAction(page, 'Two', 'Remove');
  const dialog = page.getByRole('dialog', { name: 'Remove Two?', exact: true });
  await expect(dialog).toContainText("This file is only in this browser. Removing it deletes it. This can't be undone.");
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#recent .recent-open')).toHaveText(['One', 'Three']);
  await expect(page.locator('#recent').getByRole('button', { name: 'Actions for Three', exact: true })).toBeFocused();
});

test("Home's Install link goes to the website's install page, and phones leave it out", async ({ page }) => {
  for (const [width, shown] of [[1280, true], [601, true], [600, false], [390, false]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await home(page);
    await expect(page.locator('.home-install'), `${width}px`).toBeVisible({ visible: shown });
    await expect(page.locator('.home-install')).toHaveText('Install');
    await expect(page.locator('.home-install')).toHaveAttribute('href', '/install/');
  }
  await expect(page.locator('.home-header .brand')).toHaveAttribute('href', '/');
});
