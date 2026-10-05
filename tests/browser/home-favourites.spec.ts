import { test, expect } from '@playwright/test';
import { editor, noSidewaysScroll, outsideRequests, seedDrafts } from './kit';

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
    await page.goto('/#/home');
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
