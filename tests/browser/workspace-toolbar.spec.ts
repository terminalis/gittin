import { test, expect, type Page } from '@playwright/test';
import {
  command,
  editor,
  home,
  mountEditor,
  newFile,
  noSidewaysScroll,
  openText,
  preferences,
  readable,
  savedDraft,
  savedPreferences,
  tool,
} from './kit';

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Editing tools' });

test('heading dropdown applies immediately, preserves selection, supports keyboard and Undo; Preview disables formatting', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 760 });
  await newFile(page);
  await editor(page).pressSequentially('First\nSecond');
  await editor(page).press('Home');
  const trigger = toolbar(page).getByRole('button', { name: 'Heading', exact: true });
  await trigger.press('ArrowDown');
  const menu = page.getByRole('menu', { name: 'Paragraph style' });
  await expect(menu.getByRole('menuitemradio', { name: 'Paragraph', exact: true })).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { name: 'Paragraph', exact: true })).toBeChecked();
  const anchor = await trigger.boundingBox(), bounds = await menu.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(editor(page)).toHaveText('First## Second');
  await expect(editor(page)).toBeFocused();
  await expect(trigger.locator('.toolbar-button-label')).toBeHidden();
  await trigger.click();
  await expect(menu.getByRole('menuitemradio', { name: 'Heading 2', exact: true })).toBeChecked();
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await tool(page, 'undo'); await expect(editor(page)).toHaveText('FirstSecond');
  await trigger.click(); await editor(page).click(); await expect(menu).toBeHidden();
  await tool(page, 'redo'); await expect(editor(page)).toHaveText('First## Second');
  await editor(page).press('ControlOrMeta+End'); await expect(trigger).toHaveAttribute('aria-pressed', 'true');
  const formatting = [trigger, ...['Bold', 'Bulleted list'].map(name => toolbar(page).getByRole('button', { name, exact: true }))];
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  for (const control of formatting) await expect(control).toBeDisabled();
  await expect(trigger).not.toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  for (const control of formatting) await expect(control).toBeEnabled();
});

test('a YAML comment never shows as a selected Markdown heading', async ({ page }) => {
  const heading = toolbar(page).locator('[data-command="heading"]');
  for (const [name, pressed, label] of [
    ['site.md', 'true', 'Heading 1'],
    ['site.yaml', 'false', 'Paragraph'],
  ]) {
    await openText(page, '# Site settings\ntitle: "Field notes"\n', name);
    // The caret line is shown by the same refresh that sets the toolbar state.
    await editor(page).click();
    await editor(page).press('ControlOrMeta+End');
    await expect(page.locator('#caret-status')).toHaveText(/^Ln 3,/);
    await editor(page).press('ControlOrMeta+Home');
    await expect(page.locator('#caret-status')).toHaveText('Ln 1, Col 1');
    await expect(heading).toHaveAttribute('aria-pressed', pressed);
    await expect(heading.locator('.toolbar-button-label')).toHaveText(label);
  }
  await expect(heading).toBeDisabled();
});

test('the toolbar shows the state of what was just typed', async ({ page }) => {
  await mountEditor(page, '', { controls: true });
  await editor(page).click();
  await editor(page).pressSequentially('**b**');
  await expect(toolbar(page).locator('[data-command="bold"]')).toHaveAttribute('aria-pressed', 'true');
  await editor(page).press('Enter');
  await editor(page).pressSequentially('# H');
  const heading = toolbar(page).locator('[data-command="heading"]');
  await expect(heading).toHaveAttribute('aria-pressed', 'true');
  await expect(heading.locator('.toolbar-button-label')).toHaveText('Heading 1');
});

test('customized groups stay fixed for prose and code files and retain individual choices', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 760 });
  await newFile(page);
  const labels = ['Find & history', 'Paragraph', 'Text formatting', 'Code', 'Lists', 'Indentation', 'Line editing', 'Insert'];
  for (const label of labels) await expect(toolbar(page).getByRole('group', { name: label, exact: true })).toBeVisible();
  await expect(toolbar(page).getByRole('button', { name: 'Print', exact: true })).toHaveCount(0);
  await expect(toolbar(page).locator('[data-mode]')).toHaveCount(0);
  await expect(toolbar(page).getByRole('button', { name: 'Fenced code block' })).toBeVisible();
  await command(page, 'Inline code', 'Inline code View Toolbar');
  await expect(toolbar(page).locator('[data-command=code]')).toBeHidden();
  await command(page, 'Show Code');
  await expect(toolbar(page).getByRole('group', { name: 'Code', exact: true })).toBeHidden();
  await command(page, 'Show Code');
  await expect(toolbar(page).locator('[data-command=codeBlock]')).toBeVisible();
  await expect(toolbar(page).locator('[data-command=code]')).toBeHidden();
  await command(page, 'Rename…');
  const rename = page.getByRole('dialog', { name: 'Rename file' });
  await rename.getByLabel('File name').fill('example.js'); await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  for (const label of labels) await expect(toolbar(page).getByRole('group', { name: label, exact: true })).toBeVisible();
  await expect(toolbar(page).locator('[data-command=bold]')).toBeDisabled();
  await expect(toolbar(page).locator('[data-command=indent]')).toBeEnabled();
  await editor(page).pressSequentially('const value = 1;'); await editor(page).press('ControlOrMeta+a');
  await tool(page, 'convertToComment'); await expect(editor(page)).toHaveText('/*const value = 1;*/');
  await tool(page, 'convertToText'); await expect(editor(page)).toHaveText('const value = 1;');
  await tool(page, 'duplicateLines'); await expect(editor(page)).toHaveText('const value = 1;const value = 1;');
  await tool(page, 'undo'); await expect(editor(page)).toHaveText('const value = 1;');
  await page.reload(); await expect(editor(page)).toBeVisible();
  await expect(toolbar(page).locator('[data-command=code]')).toBeHidden();
  await expect(toolbar(page).locator('[data-command=codeBlock]')).toBeVisible();
  await command(page, 'Reset toolbar'); await expect(toolbar(page).locator('[data-command=code]')).toBeVisible();
});

test('narrow overflow preserves selection, stays in the viewport and restores controls after resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await newFile(page);
  await editor(page).pressSequentially('draft'); await editor(page).press('ControlOrMeta+a');
  const more = toolbar(page).getByRole('button', { name: 'More toolbar controls' });
  await expect(more).toBeVisible();
  await expect(more).toHaveText('');
  await expect(more.locator('[data-icon=dots-vertical]')).toBeVisible();
  await more.press('ArrowDown');
  const overflow = toolbar(page).getByRole('toolbar', { name: 'More toolbar controls' });
  await expect(overflow).toBeVisible();
  const bounds = await overflow.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(760);
  const bold = overflow.getByRole('button', { name: 'Bold', exact: true });
  const italic = overflow.getByRole('button', { name: 'Italic', exact: true });
  await expect(bold.locator('.toolbar-button-label')).toBeHidden();
  expect((await italic.boundingBox())!.y).toBe((await bold.boundingBox())!.y);
  expect((await italic.boundingBox())!.x).toBeGreaterThan((await bold.boundingBox())!.x);
  await bold.focus(); await page.keyboard.press('ArrowRight'); await expect(italic).toBeFocused();
  await page.keyboard.press('ArrowLeft'); await expect(bold).toBeFocused();
  await bold.click();
  await expect(editor(page)).toHaveText('**draft**'); await expect(overflow).toBeHidden();
  await expect(editor(page)).toBeFocused(); await tool(page, 'undo');
  await expect(editor(page)).toHaveText('draft');
  await more.click(); await page.keyboard.press('End');
  await expect(overflow.getByRole('button', { name: 'Insert table', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(more).toBeFocused();
  await tool(page, 'heading');
  await page.getByRole('menuitemradio', { name: 'Heading 3', exact: true }).click();
  await expect(editor(page)).toHaveText('### draft');
  await tool(page, 'undo');
  await tool(page, 'codeBlock');
  const code = page.getByRole('dialog', { name: 'Code block', exact: true });
  await expect(code).toBeVisible(); await code.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor(page)).toHaveText('draft');
  await more.click(); await page.setViewportSize({ width: 1600, height: 760 });
  await expect(overflow).toBeHidden(); await expect(more).toBeHidden();
  await expect(toolbar(page).getByRole('button', { name: 'Insert table', exact: true })).toBeVisible();
  await expect.poll(() => noSidewaysScroll(page)).toBe(true);
});

test('document zoom scales every view, retains source and selection, and persists across reloads and files', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await home(page);
  const source = '# Zoom notes\n\nA small draft.\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'zoom.md', mimeType: 'text/markdown', buffer: Buffer.from(source) });
  await expect(editor(page)).toBeVisible();
  const savedVersion = async () => (await savedDraft(page))?.current;
  await expect.poll(async () => (await savedVersion())?.source).toBe(source);
  const before = await savedVersion();
  const zoom = toolbar(page).getByRole('button', { name: 'Document zoom', exact: true });
  const menu = page.getByRole('menu', { name: 'Document zoom', exact: true });
  const lineHeight = (await editor(page).locator(':scope > div').first().boundingBox())!.height;
  const toolbarHeight = (await toolbar(page).boundingBox())!.height;
  await editor(page).press('ControlOrMeta+a');
  await zoom.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: '100%', exact: true })).toBeFocused();
  await expect(menu.getByRole('menuitemradio', { name: '100%', exact: true })).toBeChecked();
  await menu.getByRole('menuitemradio', { name: '150%', exact: true }).click();
  await expect(zoom).toHaveText('150%');
  await expect(zoom).toBeFocused();
  await expect(editor(page)).toHaveCSS('zoom', '1.5');
  expect((await editor(page).locator(':scope > div').first().boundingBox())!.height).toBeCloseTo(lineHeight * 1.5, 1);
  expect((await toolbar(page).boundingBox())!.height).toBe(toolbarHeight);
  expect(await savedVersion()).toEqual(before);
  await tool(page, 'bold');
  await expect(editor(page)).toContainText('**');
  await tool(page, 'undo');
  await expect(editor(page)).toHaveText('# Zoom notesA small draft.');
  await page.getByRole('button', { name: 'Diff', exact: true }).click();
  await expect(readable(page)).toHaveCSS('zoom', '1.5');
  expect((await page.locator('.diff-line').first().boundingBox())!.height).toBeCloseTo(lineHeight * 1.5, 1);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(readable(page)).toHaveCSS('zoom', '1.5');
  const previewHeading = readable(page).locator('h1');
  expect((await previewHeading.boundingBox())!.height).toBeGreaterThan(60);
  await zoom.click(); await menu.getByRole('menuitemradio', { name: '100%', exact: true }).click();
  await expect(readable(page)).toHaveCSS('zoom', '1');
  await zoom.click(); await menu.getByRole('menuitemradio', { name: '150%', exact: true }).click();
  await expect.poll(async () => (await savedPreferences(page)).documentZoom).toBe(150);
  await expect.poll(async () => (await savedVersion())?.source).toBe(before.source);
  await page.reload();
  await expect(zoom).toHaveText('150%');
  await expect(editor(page)).toHaveCSS('zoom', '1.5');
  await page.getByRole('link', { name: 'Gittin home', exact: true }).click();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await expect(zoom).toHaveText('150%');
  await expect(editor(page)).toHaveCSS('zoom', '1.5');
});

test('zoom remains reachable on narrow screens and its keyboard menu stays inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await newFile(page);
  await editor(page).pressSequentially('A small draft');
  const zoom = toolbar(page).getByRole('button', { name: 'Document zoom', exact: true });
  const more = toolbar(page).getByRole('button', { name: 'More toolbar controls' });
  const menu = page.getByRole('menu', { name: 'Document zoom', exact: true });
  // At phone width the Menus button in the header replaces the toolbar's ^ toggle.
  for (const control of [zoom, more, page.getByRole('button', { name: 'Menus', exact: true })]) {
    await expect(control).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
  await zoom.press('ArrowDown');
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(760);
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(zoom).toHaveText('200%');
  await expect(editor(page)).toHaveCSS('zoom', '2');
  await zoom.press('ArrowDown');
  await expect(menu.getByRole('menuitemradio', { name: '200%', exact: true })).toBeFocused();
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await expect(zoom).toHaveText('50%');
  await zoom.click(); await page.keyboard.press('Escape');
  await expect(menu).toBeHidden(); await expect(zoom).toBeFocused();
  await more.click(); await expect(page.getByRole('toolbar', { name: 'More toolbar controls' })).toBeVisible();
  await zoom.click();
  await expect(page.getByRole('toolbar', { name: 'More toolbar controls' })).toBeHidden();
  await expect(menu).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(menu).toBeHidden();
  await more.click();
  await expect(page.getByRole('toolbar', { name: 'More toolbar controls' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'More toolbar controls' })).toBeHidden();
  await expect(more).toBeFocused();
  await expect.poll(() => noSidewaysScroll(page)).toBe(true);
});

test('hide menus preserves editing, persists, and restores through the button or shortcut', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 760 });
  await newFile(page);
  await editor(page).pressSequentially('draft'); await editor(page).press('ControlOrMeta+a');
  const header = page.locator('.workspace-header');
  const toggle = toolbar(page).locator('.toolbar-menu-toggle');
  await expect(toggle).toHaveAccessibleName('Hide the menus');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(header).toBeHidden();
  await expect(toggle).toHaveAccessibleName('Show the menus');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('group', { name: 'Document view' })).toBeVisible();
  await expect(page.locator('#documents-panel')).toBeVisible();
  await expect(page.locator('#repository-panel')).toBeVisible();
  await tool(page, 'bold'); await expect(editor(page)).toHaveText('**draft**');
  await tool(page, 'undo'); await expect(editor(page)).toHaveText('draft');
  await page.keyboard.press('Control+Shift+f'); await expect(header).toBeVisible();
  await page.locator('.menus > details > summary').filter({ hasText: /^File$/ }).click();
  await page.keyboard.press('Control+Shift+f');
  await expect(header).toBeHidden(); await expect(toggle).toBeFocused();
  await toggle.press('Enter'); await expect(header).toBeVisible();
  await expect(page.locator('.menus > details[open]')).toHaveCount(0);
  await toggle.click();
  await command(page, 'Focus mode'); await expect(toolbar(page)).toBeHidden();
  await page.keyboard.press('Escape'); await expect(toggle).toBeVisible(); await expect(header).toBeHidden();
  await expect.poll(async () => ({
    saved: !!(await savedDraft(page)),
    hidden: (await savedPreferences(page)).menusHidden,
  })).toEqual({ saved: true, hidden: true });
  await page.reload(); await expect(editor(page)).toBeVisible();
  await expect(header).toBeHidden(); await expect(toggle).toHaveAccessibleName('Show the menus');
  for (const mode of ['diff', 'preview', 'markdown']) {
    await page.locator(`[data-mode="${mode}"]`).click(); await expect(toggle).toBeEnabled();
  }
  await toggle.click(); await expect(header).toBeVisible();
  await command(page, 'Rename…');
  await page.keyboard.press('Control+Shift+f'); await expect(header).toBeVisible();
  await page.keyboard.press('Escape');
});

// 700px still has the toolbar's ^ toggle; at 600px and narrower the header's Menus button replaces it.
test('menu toggle stays reachable on narrow screens even when all toolbar groups are hidden', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 760 });
  await newFile(page);
  const toggle = toolbar(page).locator('.toolbar-menu-toggle');
  const more = toolbar(page).getByRole('button', { name: 'More toolbar controls' });
  await expect(toggle).toBeVisible(); await expect(more).toBeVisible();
  const bounds = await toggle.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(700);
  expect(bounds!.x).toBeGreaterThan((await more.boundingBox())!.x);
  await toggle.click(); await expect(page.locator('.workspace-header')).toBeHidden();
  for (const group of ['Find & history', 'Paragraph', 'Text formatting', 'Code', 'Lists', 'Indentation', 'Line editing', 'Insert'])
    await command(page, 'Show ' + group);
  await expect(toolbar(page).locator('[data-command]:visible')).toHaveCount(0);
  await expect(toggle).toBeVisible(); await expect(more).toBeHidden();
  await toggle.press('Enter'); await expect(page.locator('.workspace-header')).toBeVisible();
  await command(page, 'Reset toolbar'); await expect(more).toBeVisible();
  await expect.poll(() => noSidewaysScroll(page)).toBe(true);
});

test('toolbar groups and tools can be customized independently', async ({ page }) => {
  await home(page);
  await preferences(page, 'savePreferences', {
    toolbarGroups: { indentation: false },
    toolbarItems: { code: false, bold: false, addImage: false },
  });
  await page.reload();
  await newFile(page);
  await expect(toolbar(page).locator('[data-command=code]')).toBeHidden();
  await expect(toolbar(page).locator('[data-command=indent]')).toBeHidden();
  await command(page, 'Show Indentation'); await expect(toolbar(page).locator('[data-command=indent]')).toBeVisible();
  await command(page, 'Inline code', 'Inline code View Toolbar'); await expect(toolbar(page).locator('[data-command=code]')).toBeVisible();
  await expect.poll(async () => {
    const saved = await savedPreferences(page);
    return {
      saved: !!(await savedDraft(page)),
      code: saved.toolbarItems?.code,
      indentation: saved.toolbarGroups?.indentation,
    };
  }).toEqual({ saved: true, code: true, indentation: true });
  await page.reload(); await expect(editor(page)).toBeVisible();
  await expect(toolbar(page).locator('[data-command=code]')).toBeVisible();
  await expect(toolbar(page).locator('[data-command=indent]')).toBeVisible();
  await expect(toolbar(page).locator('[data-command=addImage]')).toBeHidden();
  await expect(toolbar(page).locator('[data-command=bold]')).toBeHidden();
});
