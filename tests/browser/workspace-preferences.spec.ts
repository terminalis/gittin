import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  EDITOR,
  command,
  editor,
  mountWorkspace,
  newFile,
  readable,
  savedPreferences,
  select,
  setMode,
  source,
  sourceSelection,
} from './kit';

async function openPreferences(page: Page) {
  await command(page, 'Preferences…');
  return page.getByRole('dialog', { name: 'Preferences', exact: true });
}
const closeDialog = (dialog: Locator) =>
  dialog.getByRole('button', { name: 'Close', exact: true }).click();

test('toolbar choices retain hidden-group choices, Find and menu access, persistence and reset', async ({
  page,
}) => {
  await newFile(page);
  for (const id of ['undo', 'bold', 'italic', 'strike', 'code', 'ins', 'sup', 'sub', 'mark'])
    await expect(page.locator('[data-command="' + id + '"]')).toBeVisible();
  await expect(page.locator('#find-file')).toBeVisible();
  await page.locator('.menus > details > summary').filter({ hasText: /^View$/ }).click();
  await page.locator('.submenu > summary').filter({ hasText: /^Toolbar$/ }).click();
  await page.locator('.submenu > summary').filter({ hasText: /^Text formatting$/ }).click();
  await page.locator('.menus').getByRole('button', { name: 'Bold', exact: true }).click();
  await expect(page.locator('[data-command=bold]')).toBeHidden();
  await command(page, 'Show Text formatting');
  await expect(page.locator('[data-toolbar-group=text]')).toBeHidden();
  await command(page, 'Show Text formatting');
  await expect(page.locator('[data-command=italic]')).toBeVisible();
  await expect(page.locator('[data-command=bold]')).toBeHidden();
  await command(page, 'Find in current file');
  await expect(page.locator('#find-file')).toBeHidden();
  await expect.poll(async () => (await savedPreferences(page)).toolbarItems?.find).toBe(false);
  await editor(page).click();
  await editor(page).pressSequentially('alpha');
  await editor(page).press('ControlOrMeta+a');
  await editor(page).press('ControlOrMeta+b');
  await expect(editor(page)).toHaveText('**alpha**');
  await editor(page).press('ControlOrMeta+z');
  await expect(editor(page)).toHaveText('alpha');
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('[data-command=bold]')).toBeHidden();
  await expect(page.locator('#find-file')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await command(page, 'Reset toolbar');
  await expect(page.locator('[data-command=bold]')).toBeVisible();
  await expect(page.locator('#find-file')).toBeVisible();
  await page.locator('#find-file').click();
  await expect(page.getByRole('searchbox', { name: 'Find in current document' })).toBeVisible();
});

test('Preferences is empty by default, persists exact rules, validates conflicts, enables and deletes', async ({
  page,
}) => {
  await newFile(page);
  let dialog = await openPreferences(page);
  await expect(dialog.getByLabel('Automatically capitalise words')).not.toBeChecked();
  await expect(dialog.getByLabel('Use smart quotes')).not.toBeChecked();
  await expect(dialog.getByLabel('Continue lists when pressing Enter')).toBeChecked();
  await expect(dialog.getByLabel('Show link details')).toBeChecked();
  await expect(dialog).not.toContainText('Appearance');
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  await expect(dialog).toContainText('No substitution rules.');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog.getByRole('alert')).toContainText('literal');
  await dialog.getByLabel('Replace', { exact: true }).fill('alpha');
  await dialog.getByLabel('With', { exact: true }).fill('beta');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByLabel('Replace', { exact: true }).fill('alpha');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await expect(dialog.getByRole('alert')).toContainText('unique');
  await dialog.getByLabel('Replace', { exact: true }).fill('beta');
  await dialog.getByLabel('With', { exact: true }).fill('gamma');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await dialog.getByRole('checkbox', { name: 'Enable rule 1' }).uncheck();
  await dialog.getByRole('button', { name: 'Delete rule 2' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Enable rule 1' })).not.toBeChecked();
  await expect
    .poll(async () => (await savedPreferences(page)).substitutions?.[0].enabled)
    .toBe(false);
  await closeDialog(dialog);
  await editor(page).click();
  await editor(page).pressSequentially('alpha');
  await expect(editor(page)).toHaveText('alpha');
  await page.reload();
  await expect(editor(page)).toBeVisible();
  dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Enable rule 1' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Delete rule 1' }).click();
  await expect(dialog).toContainText('No substitution rules.');
  await expect.poll(async () => (await savedPreferences(page)).substitutions).toEqual([]);
});

test('substitution settings leave existing selected text unchanged and expose no manual Apply action', async ({
  page,
}) => {
  const original =
    '\ufeffalpha ab `alpha` [alpha](https://x/alpha) <ins>alpha</ins>\r\n```\nalpha\n```\rtail';
  await mountWorkspace(page, original);
  await select(page, 1, original.length - 4);
  let dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  await expect(dialog.getByRole('button', { name: /Apply substitutions/ })).toHaveCount(0);
  await expect(dialog).not.toContainText('Select Markdown text');
  await dialog.getByLabel('Replace', { exact: true }).fill('alpha');
  await dialog.getByLabel('With', { exact: true }).fill('beta');
  await dialog.getByRole('button', { name: 'Add rule' }).click();
  await closeDialog(dialog);
  expect(await source(page)).toBe(original);
  await expect
    .poll(() => sourceSelection(page))
    .toEqual({ anchor: 1, head: original.length - 4 });
  await page.locator('.menus > details > summary').filter({ hasText: /^Tools$/ }).click();
  await expect(
    page.locator('.menus').getByRole('button', { name: /Apply substitutions/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+Shift+p');
  const search = page.getByRole('dialog', { name: 'Search commands and settings' });
  await expect(search.getByRole('button', { name: /Apply substitutions/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const mode of ['preview', 'diff']) {
    await setMode(page, mode);
    dialog = await openPreferences(page);
    await dialog.getByRole('tab', { name: 'Substitutions' }).click();
    const automatic = dialog.getByRole('checkbox', { name: 'Automatic substitution', exact: true });
    await automatic.uncheck();
    await automatic.check();
    await closeDialog(dialog);
    expect(await source(page)).toBe(original);
  }
});

test('typing preferences, list-only Enter and remembered category spellcheck update immediately', async ({
  page,
}) => {
  await mountWorkspace(page, '');
  let dialog = await openPreferences(page);
  await dialog.getByLabel('Automatically capitalise words').check();
  await dialog.getByLabel('Use smart quotes').check();
  await closeDialog(dialog);
  await editor(page).pressSequentially('hello. world "quoted"');
  expect(await source(page)).toBe('Hello. World \u201cquoted\u201d');
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe('');
  const typeAtEnd = (text: string) =>
    page.evaluate((text) => {
      const { workspace, session } = (window as any).fixture;
      session.applyWriteSource(text, 'command', workspace.controller.getSelection());
      workspace.controller.goToSource(session.current.source.length);
    }, text);
  await typeAtEnd('- [x] item');
  await editor(page).press('Enter');
  expect(await source(page)).toBe('- [x] item\n- [ ] ');
  await editor(page).press('Enter');
  expect(await source(page)).toBe('- [x] item\n\n');
  dialog = await openPreferences(page);
  await dialog.getByLabel('Continue lists when pressing Enter').uncheck();
  await closeDialog(dialog);
  await typeAtEnd('- item');
  await editor(page).press('Enter');
  expect(await source(page)).toBe('- item\n');
  await page.locator('.menus > details > summary').filter({ hasText: /^Tools$/ }).click();
  await expect(
    page.locator('.menus').getByRole('button', { name: 'Spellcheck', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  const spellcheck = (dialog: Locator) =>
    dialog.getByRole('checkbox', { name: 'Spellcheck', exact: true });
  await expect(editor(page)).toHaveAttribute('spellcheck', 'true');
  dialog = await openPreferences(page);
  await expect(spellcheck(dialog)).toBeChecked();
  await spellcheck(dialog).uncheck();
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false');
  await closeDialog(dialog);
  await page.evaluate(() => (window as any).fixture.workspace.controller.setFileType('typescript'));
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false');
  dialog = await openPreferences(page);
  await expect(spellcheck(dialog)).not.toBeChecked();
  await spellcheck(dialog).check();
  await expect(editor(page)).toHaveAttribute('spellcheck', 'true');
  await closeDialog(dialog);
  await page.evaluate(() => (window as any).fixture.workspace.controller.setFileType('markdown'));
  await expect(editor(page)).toHaveAttribute('spellcheck', 'false');
  dialog = await openPreferences(page);
  await expect(spellcheck(dialog)).not.toBeChecked();
  await closeDialog(dialog);
  await page.evaluate(() => {
    const { workspace, session } = (window as any).fixture;
    workspace.controller.setFileType('typescript');
    session.applyWriteSource('- item', 'command', workspace.controller.getSelection());
    workspace.controller.goToSource(session.current.source.length);
  });
  await editor(page).press('Enter');
  await editor(page).pressSequentially('word "raw"');
  expect(await source(page)).toBe('- item\nword "raw"');
  await expect
    .poll(async () => (await savedPreferences(page)).spellcheck)
    .toEqual({ markdown: false, code: true });
});

test('substitution rules expand automatically while typing, undo independently, and respect saved switches', async ({
  page,
}) => {
  await mountWorkspace(page, '');
  let dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  const automatic = (dialog: Locator) =>
    dialog.getByRole('checkbox', { name: 'Automatic substitution', exact: true });
  await expect(automatic(dialog)).toBeChecked();
  await dialog.getByLabel('Replace', { exact: true }).fill('teh');
  await dialog.getByLabel('With', { exact: true }).fill('the');
  await dialog.getByRole('button', { name: 'Add rule', exact: true }).click();
  await closeDialog(dialog);
  await editor(page).pressSequentially('teh');
  expect(await source(page)).toBe('teh');
  await editor(page).press('Space');
  expect(await source(page)).toBe('the ');
  expect(await sourceSelection(page)).toEqual({ anchor: 4, head: 4 });
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe('teh ');
  await editor(page).press('ControlOrMeta+Shift+z');
  expect(await source(page)).toBe('the ');
  dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  await automatic(dialog).uncheck();
  await closeDialog(dialog);
  await editor(page).pressSequentially('teh ');
  expect(await source(page)).toBe('the teh ');
  await expect
    .poll(async () => (await savedPreferences(page)).automaticSubstitution)
    .toBe(false);
  dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  await expect(automatic(dialog)).not.toBeChecked();
  await automatic(dialog).check();
  await dialog.getByRole('checkbox', { name: 'Enable rule 1' }).uncheck();
  await closeDialog(dialog);
  await editor(page).pressSequentially('teh ');
  expect(await source(page)).toBe('the teh teh ');
  dialog = await openPreferences(page);
  await dialog.getByRole('tab', { name: 'Substitutions' }).click();
  await dialog.getByRole('checkbox', { name: 'Enable rule 1' }).check();
  await closeDialog(dialog);
  await editor(page).pressSequentially('teh,');
  expect(await source(page)).toBe('the teh teh the,');
});

test('automatic substitutions preserve raw endings, list continuation, literals, pasted text and composition', async ({
  page,
}) => {
  await mountWorkspace(page, '');
  await page.evaluate(() =>
    (window as any).fixture.prefs.save({
      substitutions: [
        { replace: 'teh', with: 'the', enabled: true },
        { replace: 'the', with: 'other', enabled: true },
      ],
    }),
  );
  const reset = async (text: string, type = 'markdown', caret = text.length) => {
    await page.evaluate(
      ({ text, type, caret }) => {
        const { session, workspace } = (window as any).fixture;
        workspace.controller.setFileType(type);
        session.applyWriteSource(text, 'command', workspace.controller.getSelection());
        workspace.controller.goToSource(caret);
      },
      { text, type, caret },
    );
  };
  await reset('\ufeffBefore\r\n- teh');
  await editor(page).press('Enter');
  expect(await source(page)).toBe('\ufeffBefore\r\n- the\r\n- ');
  await editor(page).press('ControlOrMeta+z');
  expect(await source(page)).toBe('\ufeffBefore\r\n- teh\r\n- ');
  await reset('teh tail', 'markdown', 3);
  await editor(page).press('Space');
  expect(await source(page)).toBe('the  tail');
  for (const literal of ['`teh', '```js\nteh', '[label](https://x/teh', '<ins>teh', '<!-- teh']) {
    await reset(literal);
    await editor(page).press('Space');
    expect(await source(page)).toBe(literal + ' ');
  }
  await reset('teh', 'typescript');
  await editor(page).press('Space');
  expect(await source(page)).toBe('teh ');
  await reset('');
  await page.evaluate((selector) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'teh ');
    document
      .querySelector(selector)!
      .dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  }, EDITOR);
  expect(await source(page)).toBe('teh ');
  await reset('');
  await page.evaluate((selector) => {
    const el = document.querySelector(selector)!;
    const view = (window as any).fixture.workspace.controller.markdown.view;
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    view.dispatch(view.state.tr.insertText('teh '));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'teh ' }));
  }, EDITOR);
  await expect.poll(() => source(page)).toBe('teh ');
});

test('known safe link details work on hover and keyboard focus in Edit/Preview and can be disabled', async ({
  page,
}) => {
  const original = '[safe](https://example.com/a) [bad](javascript:alert(1)) `literal`';
  await mountWorkspace(page, original);
  const link = page.getByRole('link', { name: 'Link to https://example.com/a', exact: true });
  const details = page.getByRole('note', { name: 'Link details' });
  const openLink = page.getByRole('link', { name: 'Open link', exact: true });
  await expect(link).toHaveCount(1);
  await editor(page).locator('[data-link-url]').filter({ hasText: 'safe' }).first().hover();
  await expect(details).toContainText('https://example.com/a');
  await expect(openLink).toHaveAttribute('href', 'https://example.com/a');
  await expect(editor(page).locator('[spellcheck=false]')).not.toHaveCount(0);
  await link.focus();
  await page.keyboard.press('ArrowDown');
  await expect(openLink).toBeFocused();
  expect(await source(page)).toBe(original);
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
  await command(page, 'Preview view');
  const previewLink = readable(page).locator('a[href="https://example.com/a"]');
  await previewLink.focus();
  await expect(details).toContainText('https://example.com/a');
  await openLink.focus();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(readable(page)).toBeFocused();
  const dialog = await openPreferences(page);
  await dialog.getByLabel('Show link details').uncheck();
  await closeDialog(dialog);
  await previewLink.hover();
  await expect(details).toHaveCount(0);
  expect(await source(page)).toBe(original);
});
