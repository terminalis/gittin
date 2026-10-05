import { test, expect } from '@playwright/test';
import { editor, expectDraftSaved, openText, pageErrors, readable } from './kit';

test('a 1 MiB file opens, edits, undoes, previews and refuses an unbounded search', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = pageErrors(page);
  // Paragraphs of typical length; many short lines take WebKit far longer to show.
  const paragraph = 'a '.repeat(400) + '\n\n';
  const source = '# Large file\n\n' + paragraph.repeat(Math.ceil(2 ** 20 / paragraph.length));
  await openText(page, source, 'large.md', { timeout: 30_000 });

  const firstLine = editor(page).locator(':scope > *').first();
  await firstLine.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(firstLine).toHaveText('# Large file!');
  await expectDraftSaved(page);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(firstLine).toHaveText('# Large file');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(readable(page).locator('h1')).toHaveText('Large file');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();

  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('searchbox', { name: 'Find in current document' }).fill('a');
  await expect(page.locator('.find-bar output')).toContainText('Narrow your search');
  await page.getByLabel('Regular expression (Markdown)').check();
  await expect(page.locator('.find-bar output')).toContainText('Narrow your search');
  await expect(page.getByRole('button', { name: 'Replace all', exact: true })).toBeDisabled();
  await expect(page.locator('.find-match,.find-current')).toHaveCount(0);
  expect(errors).toEqual([]);
});
