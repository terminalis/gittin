import { test, expect, type Page } from '@playwright/test';
import { home } from './kit';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Install Gittin' });
const browserRow = (page: Page) => dialog(page).getByRole('button', { name: 'Install', exact: true });
const flatpakref = 'https://terminalis.github.io/packages/flatpak/gittin.flatpakref';

/** What Chromium does when Gittin can be installed: the event's prompt() opens the browser's own install prompt. */
const offerInstall = (page: Page) =>
  page.evaluate(() => {
    const offer = Object.assign(new Event('beforeinstallprompt'), {
      prompt: async () => {
        (window as any).prompted = ((window as any).prompted ?? 0) + 1;
        return { outcome: 'accepted' };
      },
    });
    window.dispatchEvent(offer);
  });

async function expectDialogThenClose(page: Page) {
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
}

test('the Install dialog opens from the opening screen, the bar, the FAQ and Home', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.locator('.doorway').getByRole('button', { name: 'Install', exact: true }).click();
  await expectDialogThenClose(page);
  await page.evaluate(() =>
    window.scrollTo(0, document.querySelector('.doorway')!.getBoundingClientRect().height + 200));
  await page.locator('.landing-bar').getByRole('button', { name: 'Install', exact: true }).click();
  await expectDialogThenClose(page);
  await page.locator('.landing-faq').getByRole('button', { name: 'install the desktop app', exact: true }).click();
  await expectDialogThenClose(page);
  await home(page);
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  await expectDialogThenClose(page);
});

test('the dialog links to the Microsoft Store and the Flatpak, with the command as text', async ({ page }) => {
  await home(page);
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  const store = dialog(page).getByRole('link', { name: 'Open Microsoft Store', exact: true });
  const flatpak = dialog(page).getByRole('link', { name: 'Download Flatpak', exact: true });
  await expect(store).toHaveAttribute('href', 'https://apps.microsoft.com/detail/9NDJ4HR0FF1H');
  await expect(flatpak).toHaveAttribute('href', flatpakref);
  for (const link of [store, flatpak]) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(dialog(page).locator('.version-label')).toHaveText(['WindowsThe desktop app', 'LinuxThe desktop app']);
  await expect(dialog(page).getByText('Or in a terminal:', { exact: true })).toBeVisible();
  await expect(dialog(page).locator('code')).toHaveText(`flatpak install --user ${flatpakref}`);
  // The command wraps inside its box, with no sideways scroll, and Copy sits in the box's top corner.
  const code = dialog(page).locator('code');
  expect(await code.evaluate(code => code.scrollWidth <= code.clientWidth)).toBe(true);
  expect((await code.boundingBox())!.height).toBeGreaterThan(30);
  const box = (await dialog(page).locator('.install-command').boundingBox())!;
  const copy = (await dialog(page).getByRole('button', { name: 'Copy command', exact: true }).boundingBox())!;
  expect(box.x + box.width - (copy.x + copy.width)).toBeLessThan(8);
  expect(copy.y - box.y).toBeLessThan(8);
  // The address breaks after a slash, not inside the file's name.
  expect(await code.evaluate(code => {
    const name = 'gittin.flatpakref';
    const text = [...code.childNodes].find(node => node.textContent!.includes(name))!;
    const range = document.createRange(), at = text.textContent!.indexOf(name);
    range.setStart(text, at);
    range.setEnd(text, at + name.length);
    return range.getClientRects().length;
  })).toBe(1);
  await expect(browserRow(page)).toHaveCount(0);
});

test('the copy button copies the Flatpak command', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => { (window as any).copied = text; } },
    });
  });
  await home(page);
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Copy command', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe(`flatpak install --user ${flatpakref}`);
  await expect(page.locator('#notice')).toContainText('Command copied.');
});

test('once the browser offers installation, the dialog prompts once and the offer goes', async ({ page }) => {
  await home(page);
  await offerInstall(page);
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog(page).locator('.version-label').first()).toHaveText('This browserGittin in its own window');
  await browserRow(page).click();
  await expect.poll(() => page.evaluate(() => (window as any).prompted)).toBe(1);
  await expect(browserRow(page)).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  await expect(browserRow(page)).toHaveCount(0);
});

test('an install made elsewhere drops the offer', async ({ page }) => {
  await home(page);
  await offerInstall(page);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(browserRow(page)).toHaveCount(0);
});

test('the installed window offers only the desktop apps', async ({ page }) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query =>
      query === '(display-mode: standalone)' ? { ...matchMedia(query), matches: true } : matchMedia(query);
  });
  await home(page);
  await offerInstall(page);
  await page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }).click();
  await expect(dialog(page).getByRole('link', { name: 'Open Microsoft Store', exact: true })).toBeVisible();
  await expect(browserRow(page)).toHaveCount(0);
});

test('Install sits in the bar and Home only on screens wider than a phone', async ({ page }) => {
  for (const [width, shown] of [[1280, true], [601, true], [600, false], [390, false]] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/#/');
    await expect(page.locator('.doorway')).toBeVisible();
    await page.evaluate(() =>
      window.scrollTo(0, document.querySelector('.doorway')!.getBoundingClientRect().height + 200));
    const bar = page.locator('.landing-bar');
    await expect(bar.getByRole('link', { name: 'Use in browser', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Install', exact: true })).toBeVisible({ visible: shown });
    await home(page);
    await expect(page.locator('.home-header').getByRole('button', { name: 'Install', exact: true }))
      .toBeVisible({ visible: shown });
  }
});

test('the opening screen offers Learn more and Install on landscape screens only', async ({ page }) => {
  for (const [width, height, shown] of [[1280, 800, true], [844, 390, true], [768, 1024, false], [390, 844, false]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/#/');
    const doorway = page.locator('.doorway');
    await expect(doorway).toBeVisible();
    await expect(doorway.getByRole('link', { name: 'Learn more', exact: true })).toBeVisible({ visible: shown });
    await expect(doorway.getByRole('button', { name: 'Install', exact: true })).toBeVisible({ visible: shown });
  }
});
