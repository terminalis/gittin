import { test, expect } from '@playwright/test';
import { editor, expectDraftSaved, home, newFile, rememberFolder } from './kit';

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
          ...copy(':is(h1, .home-welcome-sub, .reassurance)').map(textRight),
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
  await expect(page.locator('.home-welcome-sub')).toHaveText(
    'Start a new file, or open one from your computer.',
  );
  await expect(page.locator('.home-welcome .reassurance')).toHaveText(
    'No account needed to start.',
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
});

test('Recently worked on says when a file was last opened, with the time', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await newFile(page);
  await expectDraftSaved(page);
  await home(page);
  await expect(page.locator('.home-welcome-sub')).toHaveText('Pick up where you left off.');
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
    await expect(row.locator('.recent-state')).toHaveText('Only in this browser');
    await expect(row.locator('.recent-folder')).toHaveCount(0);
    const remove = row.getByRole('button', { name: 'Remove Untitled file', exact: true });
    const box = (await row.boundingBox())!;
    const removeBox = (await remove.boundingBox())!;
    const smallest = Math.min(removeBox.width, removeBox.height);
    expect(smallest).toBeGreaterThanOrEqual(width < 600 ? 44 : 40);
    expect(box.height).toBeGreaterThanOrEqual(60);
    await row.click({ position: { x: removeBox.x - box.x - 40, y: box.height / 2 } });
    await expect(page.locator('#document-title')).toHaveText('Untitled file');
  });

test('recent folders show a folder icon', async ({ page }) => {
  await home(page);
  await rememberFolder(page);
  await page.reload();
  await expect(
    page.locator('#folders button').first().locator('[data-icon="folder"]'),
  ).toBeVisible();
});

test('the landing page and Home load no editor code until a file opens', async ({ page }) => {
  const editorCode: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('prosemirror')) editorCode.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Gittin', exact: true })).toBeVisible();
  await home(page);
  expect(editorCode).toEqual([]);
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  expect(editorCode).not.toEqual([]);
});
