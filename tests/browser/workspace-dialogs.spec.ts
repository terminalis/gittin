import { test, expect } from '@playwright/test';
import { command, editor, newFile, palette, readable, tool } from './kit';

test('dialog actions stay reachable and cancellation preserves source at 1280px and 390px', async ({ page }) => {
  await newFile(page);
  await editor(page).pressSequentially('Draft preserved.');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 640 });
    for (const [label, title, dismiss] of [
      ['Rename…', 'Rename file', 'Close'],
      ['File statistics…', 'File statistics', 'Cancel'],
      ['Preferences…', 'Preferences', 'Close'],
      ['Compare files…', 'Compare files', 'Close'],
      ['Attributions…', 'Attributions', 'Close'],
      ['Keyboard shortcuts', 'Keyboard shortcuts', 'Close'],
      ['Insert link', 'Insert link', 'Cancel'],
      ['Insert table', 'Insert table', 'Cancel'],
    ]) {
      if (label === 'Insert link') await tool(page, 'addLink');
      else if (label === 'Insert table') await tool(page, 'addTable');
      else await command(page, label);
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
      for (const control of await dialog.locator('.dialog-actions button').all())
        await expect(control).toBeInViewport();
      if (title === 'Attributions') {
        await expect(dialog.getByLabel('Output format')).toBeFocused();
        const lastField = dialog.getByLabel('Modifications (optional)');
        await lastField.focus();
        await expect(lastField).toBeInViewport();
        await expect(
          dialog.getByRole('button', { name: 'Insert at cursor', exact: true }),
        ).toBeInViewport();
        expect(
          await dialog.locator('.dialog-body').evaluate(body => body.scrollTop),
        ).toBeGreaterThan(0);
      }
      await dialog.getByRole('button', { name: dismiss, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(editor(page)).toHaveText('Draft preserved.');
    }
  }
  await tool(page, 'heading');
  await page.getByRole('menuitemradio', { name: 'Heading 2', exact: true }).click();
  await expect(editor(page)).toHaveText('## Draft preserved.');
  await expect(editor(page)).toBeFocused();
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toHaveText('Draft preserved.');
});

test('commands run from Search the menus leave focus in the document', async ({ page }) => {
  await newFile(page);
  await editor(page).pressSequentially('Plain words');
  // View › Toolbar lists these too; the command itself is the result with a shortcut.
  const withShortcut = async (label: string) => {
    await page.keyboard.press('ControlOrMeta+Shift+p');
    await palette(page).getByRole('searchbox').fill(label);
    await palette(page)
      .getByRole('button', { name: label, exact: true })
      .filter({ has: page.locator('kbd') })
      .click();
  };
  await withShortcut('Bold');
  await expect(editor(page)).toBeFocused();
  // A dialog opened from search hands focus back to the document when it closes.
  await withShortcut('Insert link');
  const link = page.getByRole('dialog', { name: 'Insert link', exact: true });
  await link.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(link).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  // A mode switch replaces the document surface; focus follows it.
  await command(page, 'Preview view');
  await expect(readable(page)).toBeFocused();
  await command(page, 'Edit view');
  await expect(editor(page)).toBeFocused();
});

test('one Escape closes a search dialog with text in it', async ({ page }) => {
  await newFile(page);
  await editor(page).pressSequentially('Draft');
  await page.keyboard.press('ControlOrMeta+Shift+p');
  const search = palette(page);
  await search.getByRole('searchbox').fill('Bold');
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await search.getByRole('searchbox').fill('Symbols');
  await search.getByRole('button', { name: 'Symbols…', exact: true }).click();
  const symbols = page.getByRole('dialog', { name: 'Symbols', exact: true });
  await symbols.getByRole('searchbox').fill('rocket');
  await page.keyboard.press('Escape');
  await expect(symbols).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+p');
  await search.getByRole('searchbox').fill('Keyboard shortcuts');
  await search.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  await shortcuts.getByRole('searchbox').fill('Bold');
  await page.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test('Escape that closes a dialog, Find or link details keeps Focus mode', async ({ page }) => {
  await newFile(page);
  const workspace = page.locator('#workspace');
  await editor(page).pressSequentially('Draft [safe](https://example.com/a) ');
  await page.locator('#focus-toggle').click();
  await expect(workspace).toHaveClass(/focus-mode/);
  await editor(page).focus();
  await page.keyboard.press('ControlOrMeta+Shift+p');
  const search = palette(page);
  await search.getByRole('searchbox').fill('Bold');
  await page.keyboard.press('Escape');
  await expect(search).toHaveCount(0);
  await expect(workspace).toHaveClass(/focus-mode/);
  await command(page, 'Preferences…');
  const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
  await expect(preferences).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preferences).toHaveCount(0);
  await expect(workspace).toHaveClass(/focus-mode/);
  await page.keyboard.press('ControlOrMeta+f');
  const find = page.getByRole('searchbox', { name: 'Find in current document' });
  await expect(find).toBeFocused();
  await find.fill('Draft');
  await page.keyboard.press('Escape');
  await expect(find).toBeHidden();
  await expect(workspace).toHaveClass(/focus-mode/);
  const link = page.getByRole('link', { name: 'Link to https://example.com/a', exact: true });
  await link.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('link', { name: 'Open link', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('note', { name: 'Link details' })).toHaveCount(0);
  await expect(workspace).toHaveClass(/focus-mode/);
  await page.keyboard.press('Escape');
  await expect(workspace).not.toHaveClass(/focus-mode/);
});

test('insert dialogs show in Focus mode', async ({ page }) => {
  await newFile(page);
  const workspace = page.locator('#workspace');
  await editor(page).pressSequentially('Draft');
  await page.locator('#focus-toggle').click();
  await expect(workspace).toHaveClass(/focus-mode/);
  await editor(page).focus();
  await page.keyboard.press('ControlOrMeta+k');
  const link = page.getByRole('dialog', { name: 'Insert link', exact: true });
  await expect(link).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(link).toHaveCount(0);
  await expect(workspace).toHaveClass(/focus-mode/);
});
