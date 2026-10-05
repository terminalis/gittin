import { test, expect, type Locator } from '@playwright/test';
import {
  download,
  editor,
  expectDraftSaved,
  home,
  menu,
  newFile,
  noSidewaysScroll,
  openMenu,
  openText,
  readable,
  withoutPickers,
} from './kit';

const radius = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);

/** WCAG contrast ratio of two computed `rgb()`/`rgba()` colours (alpha ignored). */
function contrast(a: string, b: string) {
  const lum = (c: string) => {
    const [r, g, bl] = c
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('the file status stays in view anywhere in a long document', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openText(
    page,
    Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`).join('\n\n'),
    'long.md',
  );
  const column = page.locator('.writing-column');
  const status = page.locator('#save-state');
  await expect(status).not.toBeEmpty();
  for (const top of [0, 1500]) {
    await column.evaluate((el, top) => {
      el.scrollTop = top;
    }, top);
    const box = (await status.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(720);
  }
});

for (const width of [1280, 390])
  test(`a save report shares the status footer instead of adding a line below it (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await withoutPickers(page, 'save');
    await openText(page, '# Notes\n');
    const footer = page.locator('.editor-footer');
    const before = (await footer.boundingBox())!;
    await download(page, () => page.locator('#save-file').click());
    const report = page.locator('#file-status');
    await expect(report).toContainText('Downloaded notes.md.');
    const box = (await report.boundingBox())!;
    const after = (await footer.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(after.y);
    expect(box.y + box.height).toBeLessThanOrEqual(after.y + after.height);
    expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
  });

test('Save stays filled for a file that is only in this browser', async ({ page }) => {
  await newFile(page);
  await expect(page.locator('#save-state')).toHaveText('Only in this browser');
  await expect(page.locator('.save-split')).not.toHaveClass(/saved/);
});

test('Preview draws task items as read-only checkboxes without bullets', async ({ page }) => {
  await openText(page, '- [x] Done\n- [ ] Open\n', 'tasks.md');
  await page.locator('[data-mode="preview"]').click();
  const done = readable(page).locator('[role="checkbox"][aria-checked="true"]');
  await expect(done).toBeVisible();
  const look = await done.evaluate((el) => {
    const box = getComputedStyle(el);
    const item = getComputedStyle(el.closest('li')!);
    return {
      text: box.color,
      width: el.getBoundingClientRect().width,
      fill: box.backgroundColor,
      bullet: item.listStyleType,
    };
  });
  expect(look.bullet).toBe('none');
  expect(look.text).toBe('rgba(0, 0, 0, 0)');
  expect(look.width).toBeLessThan(20);
  expect(look.fill).toBe('rgb(41, 38, 35)'); // --ink in light appearance
  await expect(readable(page).locator('li').first()).toContainText('[x] Done');
});

test('at phone width Save shares the title row and the menus sit behind one button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newFile(page);
  const title = (await page.locator('#document-title').boundingBox())!;
  const save = (await page.locator('#save-file').boundingBox())!;
  expect(Math.abs(save.y + save.height / 2 - (title.y + title.height / 2))).toBeLessThan(12);
  const toggle = page.getByRole('button', { name: 'Menus', exact: true });
  const menus = page.locator('.workspace-header .menus');
  expect((await toggle.boundingBox())!.x).toBeGreaterThan(save.x);
  await expect(page.locator('.toolbar-menu-toggle')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(menus).toBeHidden();
  expect((await page.locator('.workspace-body').boundingBox())!.y).toBeLessThan(150);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menus).toBeVisible();
  await toggle.click();
  await expect(menus).toBeHidden();
  await toggle.click();
  await editor(page).click();
  await expect(menus).toBeHidden();
  await toggle.click();
  await menu(page, 'File', 'Location');
  await expect(page.getByRole('dialog', { name: 'File location', exact: true })).toBeVisible();
  await expect(menus).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('a saved "hide the menus" choice never hides Save on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await newFile(page);
  await page.keyboard.press('Control+Shift+F');
  await expect(page.locator('#save-file')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#save-file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menus', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#save-file')).toBeHidden();
});

test('between 600 and 760px the menus keep their own row and Save shares the title row', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await newFile(page);
  await expect(page.getByRole('button', { name: 'Menus', exact: true })).toBeHidden();
  await expect(page.locator('.workspace-header .menus')).toBeVisible();
  const title = (await page.locator('#document-title').boundingBox())!;
  const save = (await page.locator('#save-file').boundingBox())!;
  expect(Math.abs(save.y + save.height / 2 - (title.y + title.height / 2))).toBeLessThan(12);
  expect((await page.locator('.workspace-header .menus').boundingBox())!.height).toBeLessThan(34);
});

test('phone drawers dim the document, close when it is tapped, and use distinct icons', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newFile(page);
  const files = page.locator('#documents-toggle');
  const body = page.locator('.workspace-body');
  await expect(files.locator('[data-icon="files"]')).toBeVisible();
  await expect(files.locator('[data-icon="layout-sidebar-left-collapse"]')).toBeHidden();
  await expect(page.locator('#repository-toggle [data-icon="folder"]')).toBeVisible();
  await files.click();
  await expect(files).toHaveAttribute('aria-expanded', 'true');
  expect(await body.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('""');
  const firstFile = page.locator('#open-documents button').first();
  expect((await firstFile.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The pinned status footer sits under the overlay too, so tapping it closes the drawer.
  const footer = (await page.locator('.editor-footer').boundingBox())!;
  expect(
    await page.evaluate(([x, y]) => document.elementFromPoint(x, y)!.className, [
      360,
      footer.y + footer.height / 2,
    ]),
  ).toBe('workspace-body');
  await page.mouse.click(360, 600);
  await expect(files).toHaveAttribute('aria-expanded', 'false');
  expect(await body.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none');
});

test('desktop panel toggles size to their content', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await newFile(page);
  for (const id of ['#documents-toggle', '#repository-toggle'])
    expect((await page.locator(id).boundingBox())!.width).toBeLessThan(110);
});

test('the Find bar and Home notes use the interface face; Find controls share one height', async ({
  page,
}) => {
  await home(page);
  const face = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await face(page.locator('#recent .empty'))).toContain('Source Sans 3');
  await newFile(page);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+f');
  const bar = page.locator('.find-bar');
  await expect(bar).toBeVisible();
  for (const selector of ['strong', '.find-options label', 'output'])
    expect(await face(bar.locator(selector).first())).toContain('Source Sans 3');
  const controls = [
    'input[type=search]',
    '[data-action="previous"]',
    '[data-action="replace"]',
    '[data-action="close"]',
  ];
  const heights = await Promise.all(
    controls.map(async (selector) => {
      const box = (await bar.locator(selector).boundingBox())!;
      return Math.round(box.height);
    }),
  );
  expect(new Set(heights)).toEqual(new Set([32]));
});

test('File menu, View › Appearance and the Home menu theme switch have distinct icons', async ({
  page,
}) => {
  await newFile(page);
  await openMenu(page, 'File');
  const iconOf = (label: RegExp) =>
    page.locator('.menus .menu-items button').filter({ hasText: label }).locator('svg');
  await expect(iconOf(/^Make a copy$/)).toHaveAttribute('data-icon', 'copy');
  await expect(iconOf(/^Save as…$/)).toHaveAttribute('data-icon', 'file-export');
  await expect(iconOf(/^Download as PDF…$/)).toHaveAttribute('data-icon', 'file-type-pdf');
  await page.keyboard.press('Escape');
  await openMenu(page, 'View');
  await expect(
    page
      .locator('.submenu > summary')
      .filter({ hasText: /^Appearance$/ })
      .locator('svg')
      .first(),
  ).toHaveAttribute('data-icon', 'palette');
  await home(page);
  await page.getByRole('button', { name: 'Main menu' }).click();
  for (const [name, icon] of [
    ['Light', 'sun'],
    ['Dark', 'moon'],
    ['System', 'device-desktop'],
  ])
    await expect(page.getByRole('button', { name, exact: true }).locator('svg')).toHaveAttribute(
      'data-icon',
      icon,
    );
});

for (const scheme of ['light', 'dark'] as const)
  test(`text fields have a 3:1 edge and a close focus ring; the page stands out (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await newFile(page);
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+f');
    const field = page.locator('.find-bar input[type=search]');
    await expect(field).toBeFocused();
    const look = await field.evaluate((el) => ({
      edge: getComputedStyle(el).borderTopColor,
      ground: getComputedStyle(el.closest('.find-bar')!).backgroundColor,
      offset: getComputedStyle(el).outlineOffset,
    }));
    expect(contrast(look.edge, look.ground)).toBeGreaterThanOrEqual(3.5);
    expect(look.offset).toBe('0px');
    const background = (selector: string) =>
      page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor);
    const surface = await background('.writing-column');
    const surround = await background('.workspace-tools');
    if (scheme === 'dark') {
      expect(surface).toBe('rgb(43, 41, 38)');
      expect(surround).toBe('rgb(22, 21, 20)');
      expect(contrast(surface, surround)).toBeGreaterThanOrEqual(1.25);
    }
  });

test('buttons and dialogs share the app shape; Close is never the filled action', async ({
  page,
}) => {
  await newFile(page);
  expect(await radius(page.locator('#save-file'))).toBe('5px');
  expect(await radius(page.locator('.formatting-row'))).toBe('8px');
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+k');
  const link = page.getByRole('dialog', { name: 'Insert link', exact: true });
  await expect(link).toBeVisible();
  expect(await radius(link)).toBe('8px');
  for (const name of ['Cancel', 'Insert'])
    expect(await radius(link.getByRole('button', { name, exact: true }))).toBe('5px');
  await page.keyboard.press('Escape');
  await menu(page, 'File', 'Location');
  const location = page.getByRole('dialog', { name: 'File location', exact: true });
  const close = location.getByRole('button', { name: 'Close', exact: true });
  await expect(close).not.toHaveClass(/primary/);
  expect(await radius(close)).toBe('5px');
  await page.keyboard.press('Escape');
  await menu(page, 'Tools', 'Preferences…');
  const preferences = page.getByRole('dialog', { name: 'Preferences' });
  await expect(preferences.getByRole('button', { name: 'Close', exact: true })).not.toHaveClass(
    /primary/,
  );
});

test('confirmation dialogs fill the confirming choice only', async ({ page }) => {
  await newFile(page);
  await editor(page).fill('only here');
  await expectDraftSaved(page);
  await menu(page, 'File', 'Close file');
  const closing = page.getByRole('dialog', { name: 'Close Untitled file?', exact: true });
  const choice = (dialog: Locator, name: string) =>
    dialog.getByRole('button', { name, exact: true });
  await expect(choice(closing, 'Save')).toHaveClass(/primary/);
  await expect(choice(closing, 'Discard changes')).not.toHaveClass(/primary/);
  await expect(choice(closing, 'Cancel')).not.toHaveClass(/primary/);
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  await choice(closing, 'Cancel').click();
  // Close file runs as a transition that ignores hash changes until it ends and un-inerts the app.
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await home(page);
  await page.getByRole('button', { name: 'Remove Untitled file', exact: true }).click();
  const removing = page.getByRole('dialog', { name: 'Remove Untitled file?', exact: true });
  await expect(choice(removing, 'Remove')).toHaveClass(/primary/);
  await expect(choice(removing, 'Cancel')).not.toHaveClass(/primary/);
});

test('on a phone the title row gives a long title room; favourite and location stay in the File menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openText(page, 'text', 'Quarterly planning notes for the design team.md');
  await expect(page.locator('#favourite')).toBeHidden();
  await expect(page.locator('#location')).toBeHidden();
  // About 81px (five characters) with the two icons; 145px without them.
  expect((await page.locator('#document-title').boundingBox())!.width).toBeGreaterThanOrEqual(120);
  await page.getByRole('button', { name: 'Menus', exact: true }).click();
  await openMenu(page, 'File');
  const fileItem = (label: RegExp) =>
    page.locator('.menus .menu-items button').filter({ hasText: label });
  await expect(fileItem(/^Location$/)).toBeVisible();
  await expect(fileItem(/^Add\/remove favourite$/)).toBeVisible();
});
