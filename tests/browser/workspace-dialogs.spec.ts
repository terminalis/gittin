import { test, expect } from '@playwright/test';
import { command, editor, newFile, openText, palette, readable, tool } from './kit';

test('dialog actions stay reachable and cancellation preserves source at 1280px and 390px', async ({ page }) => {
  await newFile(page);
  await editor(page).pressSequentially('Draft preserved.');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 640 });
    for (const [label, title, dismiss] of [
      ['Rename…', 'Rename file', 'Close'],
      ['Details', 'File details', 'Close'],
      ['Preferences…', 'Preferences', 'Close'],
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
      if (title === 'Rename file') expect(bounds!.width).toBe(Math.min(360, width - 32));
      if (title === 'Attributions') expect(bounds!.width).toBe(Math.min(460, width - 32));
      for (const control of await dialog.locator('.dialog-actions button, .dialog-close').all())
        await expect(control).toBeInViewport();
      // Dialogs that only show information close with ✕ and have no footer.
      if (['File details', 'Keyboard shortcuts'].includes(title)) {
        await expect(dialog.locator('.dialog-title .dialog-close')).toBeVisible();
        await expect(dialog.locator('.dialog-actions')).toBeHidden();
      }
      if (title === 'Attributions') {
        await expect(dialog.getByRole('button', { name: 'Credit line', exact: true })).toBeFocused();
        await dialog.getByRole('button', { name: 'Citation file', exact: true }).click();
        const lastField = dialog.getByLabel('Your changes (optional)', { exact: true });
        await lastField.focus();
        await expect(lastField).toBeInViewport();
        await expect(dialog.getByRole('button', { name: 'Create CITATION.cff', exact: true })).toBeInViewport();
        expect(await dialog.locator('.dialog-body').evaluate(body => body.scrollTop)).toBeGreaterThan(0);
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

test('only the topmost dialog dims the page, and a phone panel leaves the dimming to the dialog', async ({ page }) => {
  const dialog = (title: string) => page.getByRole('dialog', { name: title, exact: true });
  const backdrop = (title: string) => dialog(title).evaluate(element => getComputedStyle(element, '::backdrop').backgroundColor);
  await openText(page, '# Saved', 'saved.md');
  await command(page, 'Version history…');
  await dialog('Version history').getByRole('button', { name: 'Clear history for this file', exact: true }).click();
  await expect(dialog('Clear version history?')).toBeVisible();
  expect(await backdrop('Version history')).toBe('rgba(0, 0, 0, 0)');
  expect(await backdrop('Clear version history?')).not.toBe('rgba(0, 0, 0, 0)');
  await dialog('Clear version history?').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await backdrop('Version history')).not.toBe('rgba(0, 0, 0, 0)');
  await dialog('Version history').getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const scrim = () => page.locator('.workspace-body').evaluate(body => getComputedStyle(body, '::after').content);
  await page.locator('#documents-toggle').click();
  await expect.poll(scrim).not.toBe('none');
  await page.getByRole('button', { name: 'Actions for saved.md', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename…', exact: true }).click();
  await expect(dialog('Rename file')).toBeVisible();
  expect(await scrim()).toBe('none');
  await dialog('Rename file').getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(scrim).not.toBe('none');
});
