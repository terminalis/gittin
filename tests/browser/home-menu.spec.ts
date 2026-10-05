import { test, expect, type Page } from '@playwright/test';
import {
  homeMenu,
  noSidewaysScroll,
  pageErrors,
  rememberFolder,
  savedPreferences,
  seedDrafts,
} from './kit';

const trigger = (page: Page) => page.getByRole('button', { name: 'Main menu', exact: true });
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Main menu', exact: true });

test('drawer order, focus, Escape and backdrop at 1280px and 390px', async ({ page }) => {
  await page.goto('/#/home');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await trigger(page).focus();
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
    // The theme switch heads the menu in place of a second logo; its icon buttons keep their names.
    await expect(drawer(page).locator('.brand')).toHaveCount(0);
    const theme = drawer(page).locator('.home-drawer-header').getByRole('group', { name: 'Appearance', exact: true });
    for (const name of ['Light', 'Dark', 'System']) await expect(theme.getByRole('button', { name, exact: true })).toHaveAttribute('title', name);
    await expect(theme.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const nav = drawer(page).getByRole('navigation');
    await expect(nav.locator('.home-drawer-label')).toHaveText(['Settings', 'Drafts', 'Help']);
    await expect(nav.getByRole('group', { name: 'Drafts', exact: true }).getByRole('button')).toHaveText(['Export drafts', 'Restore drafts']);
    const settings = nav.getByRole('group', { name: 'Settings', exact: true });
    await expect(settings.getByRole('button')).toHaveText(['10', '25', 'All']);
    await expect(settings.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByRole('switch', { name: 'Show favourites', exact: true })).toBeChecked();
    await expect(settings.getByRole('switch', { name: 'Show recent folders', exact: true })).toBeChecked();
    await expect(nav.getByRole('group', { name: 'Help', exact: true }).getByRole('button')).toHaveText(['Help', 'Shortcuts']);
    await expect(drawer(page).locator('.home-drawer-footer a')).toHaveText(['Privacy Policy', 'Terms of Service', 'Third-party notices']);
    for (const [name, href] of [['Privacy Policy', '/privacy.html'], ['Terms of Service', '/terms.html']])
      await expect(drawer(page).getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    const close = drawer(page).getByRole('button', { name: 'Close main menu' });
    const notices = drawer(page).getByRole('link', { name: 'Third-party notices', exact: true });
    await expect(close).toHaveAttribute('title', 'Close main menu');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(theme.getByRole('button', { name: 'System', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    // Focus stays in the menu: past the last link it wraps to the first theme button, and back.
    await notices.focus();
    await page.keyboard.press('Tab');
    await expect(theme.getByRole('button', { name: 'Light', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(notices).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).not.toBeVisible();
    await expect(trigger(page)).toBeFocused();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
    await trigger(page).click();
    await expect(notices).toBeInViewport();
    expect(await noSidewaysScroll(page)).toBe(true);
    await page.mouse.click(10, 400);
    await expect(drawer(page)).not.toBeVisible();
    await expect(trigger(page)).toBeFocused();
    await trigger(page).click();
    await close.click();
    await expect(trigger(page)).toBeFocused();
  }
});

test('a click that starts in the drawer and ends outside it closes the drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto('/#/home');
  await trigger(page).click();
  // The drawer slides in; measure where it ends up.
  await drawer(page).evaluate(d => Promise.all(d.getAnimations().map(a => a.finished)));
  const nav = (await drawer(page).getByRole('navigation').boundingBox())!;
  await page.mouse.move(nav.x + nav.width / 2, nav.y + 10);
  await page.mouse.down();
  await page.mouse.move(10, 400);
  await page.mouse.up();
  await expect(drawer(page)).not.toBeVisible();
  await expect(trigger(page)).toBeFocused();
});

const settings = (page: Page) => drawer(page).getByRole('group', { name: 'Settings', exact: true });

test('appearance and Home options change in place and persist without creating a file', async ({ page }) => {
  await page.goto('/#/home');
  await trigger(page).click();
  const titleBarColour = page.locator('meta[name="theme-color"]');
  await drawer(page).getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(titleBarColour).toHaveAttribute('content', '#161514');
  await drawer(page).getByRole('button', { name: 'Light', exact: true }).click();
  await expect(titleBarColour).toHaveAttribute('content', '#f7f6f3');
  await drawer(page).getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(drawer(page).getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings(page).getByRole('switch', { name: 'Show favourites', exact: true }).uncheck();
  await settings(page).getByRole('switch', { name: 'Show recent folders', exact: true }).uncheck();
  await settings(page).getByRole('group', { name: 'Recent files shown', exact: true }).getByRole('button', { name: '10', exact: true }).click();
  await expect(drawer(page)).toBeVisible();
  // Each change is saved asynchronously; reloading before the last write lands drops it.
  await expect
    .poll(() => savedPreferences(page))
    .toMatchObject({ theme: 'dark', homeFavourites: false, homeFolders: false, homeRecentLimit: 10 });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await trigger(page).click();
  await expect(settings(page).getByRole('switch', { name: 'Show favourites', exact: true })).not.toBeChecked();
  await expect(settings(page).getByRole('switch', { name: 'Show recent folders', exact: true })).not.toBeChecked();
  await expect(settings(page).getByRole('button', { name: '10', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings(page).getByRole('button', { name: 'All', exact: true }).click();
  await expect.poll(async () => (await savedPreferences(page)).homeRecentLimit).toBe('all');
});

for (const [system, choice, label] of [['light', 'dark', 'Dark'], ['dark', 'light', 'Light']] as const) {
  test(`a saved ${choice} appearance is applied before the page loads under a ${system} system`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.goto('/#/home');
    await trigger(page).click();
    await drawer(page).getByRole('button', { name: label, exact: true }).click();
    await expect.poll(async () => (await savedPreferences(page)).theme).toBe(choice);
    await page.addInitScript(() => {
      const seen = ((window as any).themeSeen = {} as Record<string, string | undefined>);
      const at = (when: string) => { seen[when] = document.documentElement.dataset.theme; };
      // readystatechange to interactive fires after the head's classic scripts and before the deferred module scripts.
      document.addEventListener('readystatechange', () => { if (document.readyState === 'interactive') at('beforeModules'); });
      document.addEventListener('DOMContentLoaded', () => at('loaded'));
    });
    await page.reload();
    expect(await page.evaluate(() => (window as any).themeSeen)).toEqual({ beforeModules: choice, loaded: choice });
  });
}

test('Home options hide Favourites and recent folders and shorten Recently worked on', async ({ page }) => {
  await page.goto('/#/home');
  await seedDrafts(
    page,
    Array.from({ length: 12 }, (_, i) => ({
      id: 'note-' + i,
      title: `note-${i}.md`,
      source: '# Note ' + i,
      favourite: i === 0,
    })),
  );
  await rememberFolder(page);
  await page.reload();
  const rows = page.locator('#recent .recent-row');
  await expect(page.locator('#favourites .favourite-card')).toHaveCount(1);
  await expect(page.locator('#folders')).toBeVisible();
  await expect(rows.filter({ visible: true })).toHaveCount(12);
  await expect(page.locator('.recent-more')).toBeHidden();
  await trigger(page).click();
  await settings(page).getByRole('switch', { name: 'Show favourites', exact: true }).uncheck();
  await settings(page).getByRole('switch', { name: 'Show recent folders', exact: true }).uncheck();
  await settings(page).getByRole('button', { name: '10', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Favourites', exact: true })).toBeHidden();
  await expect(page.locator('#folders')).toBeHidden();
  await expect(rows.filter({ visible: true })).toHaveCount(10);
  await expect(page.locator('.recent-more')).toContainText('Showing 10 of 12');
  // Show all lists every file for this visit and moves focus to the first file it revealed; the setting stays.
  await page.getByRole('button', { name: 'Show all', exact: true }).click();
  await expect(rows.filter({ visible: true })).toHaveCount(12);
  await expect(page.locator('#recent').getByRole('button', { name: 'note-10.md', exact: true })).toBeFocused();
  await expect.poll(async () => (await savedPreferences(page)).homeRecentLimit).toBe(10);
  await page.reload();
  await expect(rows.filter({ visible: true })).toHaveCount(10);
  await expect(page.locator('#folders')).toBeHidden();
});

test('Help, searchable shortcuts and navigation cleanup', async ({ page }) => {
  const errors = pageErrors(page);
  await page.goto('/#/home');
  await homeMenu(page, 'Help');
  const help = page.getByRole('dialog', { name: 'Gittin Help', exact: true });
  await help.getByText('Saving and recovery', { exact: true }).click();
  await expect(help.getByText('Unsaved changes are kept in this browser', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await homeMenu(page, 'Shortcuts');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  // Home lists the same shortcuts as the editor.
  await expect(shortcuts).toContainText('Save — Ctrl + S');
  await expect(shortcuts).toContainText('Print — Ctrl + P');
  await shortcuts.getByRole('searchbox').fill('bold');
  await expect(shortcuts).toContainText('Bold — Ctrl + B');
  await expect(shortcuts).not.toContainText('Find and replace');
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(shortcuts).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Gittin' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
