import { test, expect } from '@playwright/test';
import { editor, noSidewaysScroll, outsideRequests, savedPreferences, seedDrafts } from './kit';

const noteSource = [
  '# Launch plan',
  'A **clear** next step.',
  '- Review the draft\n- Ship the update',
  '[Open](https://example.com)',
  '![Remote image](https://thumbnail-media.invalid/image.png)',
  '<script>alert(1)</script><iframe src="https://thumbnail-media.invalid/frame"></iframe>',
  '<div id="home" style="color:red" onclick="alert(1)">Untrusted markup</div>',
].join('\n\n');

for (const width of [1280, 390]) {
  test(`Home shows safe, clickable favourite thumbnails at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const outside = outsideRequests(page);
    await page.goto('/use/#/home');
    await seedDrafts(page, [
      { id: 'note-preview', title: 'Project notes', favourite: true, source: noteSource },
      {
        id: 'code-preview',
        title: 'app.js',
        fileType: 'javascript',
        favourite: true,
        source: 'const html = "<button>Literal source</button>";\n' + 'long line '.repeat(400),
      },
      { id: 'empty-preview', title: 'Empty notes', favourite: true, source: '' },
      { id: 'recent-only', title: 'Recent only', fileType: 'text', source: 'Not a favourite' },
    ]);
    await page.reload();
    const favourites = page.locator('#favourites');
    await expect(favourites.locator('.favourite-card')).toHaveCount(3);
    await expect(page.getByText('Recently updated repositories', { exact: true })).toHaveCount(0);
    await expect(favourites).not.toContainText('Recent only');
    const note = favourites.locator('.favourite-card').filter({ has: page.getByRole('button', { name: 'Project notes', exact: true }) });
    await expect(note.locator('.favourite-preview h1')).toHaveText('Launch plan');
    await expect(note.locator('.favourite-preview strong')).toHaveText('clear');
    await expect(note.locator('.favourite-preview li')).toHaveCount(2);
    await expect(favourites.locator('.favourite-preview :is(a, img, iframe, script, input, button, [style], [id], [onclick])')).toHaveCount(0);
    expect(outside()).toEqual([]);
    const code = favourites.locator('.favourite-card').filter({ hasText: 'app.js' });
    await expect(code.locator('pre')).toContainText('<button>Literal source</button>');
    expect((await code.locator('pre').textContent())!.length).toBe(2000);
    const codeStyle = await code.locator('pre').evaluate(el => window.getComputedStyle(el).fontFamily);
    expect(codeStyle.startsWith('ui-monospace')).toBe(true);
    await expect(favourites).toContainText('Empty file');
    expect(await noSidewaysScroll(page)).toBe(true);
    // A phone's narrow card gives the type tile's room to ⋯, a full touch target.
    const actions = (await note.getByRole('button', { name: 'Actions for Project notes', exact: true }).boundingBox())!;
    expect(Math.min(actions.width, actions.height)).toBeGreaterThanOrEqual(width < 600 ? 44 : 40);
    await expect(note.locator('.favourite-caption .file-tile')).toBeVisible({ visible: width >= 600 });

    // The thumbnail surface opens the same file as its accessible title button.
    await note.click({ position: { x: 20, y: 20 } });
    await expect(page.locator('#document-title')).toHaveText('Project notes');
    await editor(page).fill('# Updated plan\n\nSaved changes appear in the thumbnail.');
    await page.getByRole('link', { name: 'Gittin home', exact: true }).click();
    await expect(note.locator('.favourite-preview h1')).toHaveText('Updated plan');
    const title = note.getByRole('button', { name: 'Project notes', exact: true });
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#document-title')).toHaveText('Project notes');
  });
}

test('Favourites switch between cards and rows, sort four ways and keep both choices', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/use/#/home');
  const now = Date.now();
  await seedDrafts(page, [
    { title: 'Recent only', source: 'R', lastOpened: now },
    { title: 'note 10', favourite: true, source: 'B', lastOpened: now - 1000 },
    { title: 'apple', favourite: true, source: 'C', lastOpened: now - 2000 },
    { title: 'Note 2', favourite: true, source: 'A', lastOpened: now - 3000 },
  ]);
  await page.reload();
  const section = page.locator('.home-favourites'), favourites = page.locator('#favourites');
  const names = favourites.locator(':is(.favourite-open, .recent-open)');
  // Cards, last opened first, until chosen otherwise.
  await expect(favourites.locator('.favourite-card')).toHaveCount(3);
  await expect(names).toHaveText(['note 10', 'apple', 'Note 2']);
  await section.getByRole('button', { name: 'Show as list', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(favourites.locator('.recent-row')).toHaveCount(3);
  await expect(favourites.locator('.recent-row .recent-when').first()).toHaveText(/^Today, /);
  await expect(favourites.locator('.file-more')).toHaveCount(3);
  await expect(section.getByRole('button', { name: 'Show as grid', exact: true })).toBeFocused();
  // Recently worked on keeps every file, newest first.
  await expect(page.locator('#recent .recent-open')).toHaveText(['Recent only', 'note 10', 'apple', 'Note 2']);
  await expect(page.locator('#recent .file-more')).toHaveCount(4);

  const sort = section.getByRole('button', { name: 'Sort favourites', exact: true });
  const menu = page.getByRole('menu', { name: 'Sort favourites', exact: true });
  for (const [order, expected] of [
    ['Title, A to Z', ['apple', 'Note 2', 'note 10']],
    ['Title, Z to A', ['note 10', 'Note 2', 'apple']],
    ['Last opened, oldest first', ['Note 2', 'apple', 'note 10']],
    ['Last opened, newest first', ['note 10', 'apple', 'Note 2']],
  ] as const) {
    await sort.click();
    await expect(sort).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.getByRole('menuitemradio')).toHaveCount(4);
    await expect(menu.getByRole('menuitemradio', { checked: true })).toBeFocused();
    await menu.getByRole('menuitemradio', { name: order, exact: true }).click();
    await expect(menu).toBeHidden();
    await expect(sort).toBeFocused();
    await expect(names).toHaveText([...expected]);
  }

  await sort.click();
  await menu.getByRole('menuitemradio', { name: 'Title, A to Z', exact: true }).click();
  // Each choice is saved asynchronously; reloading before the last write lands drops it.
  await expect.poll(() => savedPreferences(page))
    .toMatchObject({ homeFavouritesView: 'list', homeFavouritesSort: 'title-asc' });
  await page.reload();
  await expect(favourites.locator('.recent-row')).toHaveCount(3);
  await expect(names).toHaveText(['apple', 'Note 2', 'note 10']);
  await sort.click();
  await expect(menu.getByRole('menuitemradio', { name: 'Title, A to Z', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(sort).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await noSidewaysScroll(page)).toBe(true);
  await section.getByRole('button', { name: 'Show as grid', exact: true }).click();
  await expect(favourites.locator('.favourite-card')).toHaveCount(3);
  await expect(names).toHaveText(['apple', 'Note 2', 'note 10']);
});
