import { test, expect, type Page } from '@playwright/test';
import { noSidewaysScroll } from './kit';

const flatpakref = 'https://terminalis.github.io/packages/flatpak/gittin.flatpakref';
const chrome = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const windowsChrome = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${chrome}`;
const macChrome = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${chrome}`;
const androidChrome = `Mozilla/5.0 (Linux; Android 10; K) ${chrome.replace('Safari', 'Mobile Safari')}`;
const linuxFirefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0';
const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/18.6 Safari/605.1.15';
const iPhoneSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
  + 'Version/18.6 Mobile/15E148 Safari/604.1';

const order = (page: Page) => page.locator('.install-card').evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.card));
const primary = (page: Page) => page.locator('.install-cards .primary');
const install = (page: Page) => page.locator('.install-card').getByRole('button', { name: 'Install', exact: true });

/** Opens the install page as another browser would: its user agent, Chromium's platform hint and touch points. */
async function visitAs(page: Page, userAgent: string, platform?: string, touch = 0) {
  await page.addInitScript(({ userAgent, platform, touch }) => {
    Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => userAgent });
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => (platform ? { platform } : undefined) });
    Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => touch });
  }, { userAgent, platform: platform ?? '', touch });
  await page.goto('/install/');
}

/** What Chromium does when Gittin can be installed: the event's prompt() opens the browser's own install prompt. */
const offerInstall = (page: Page) => page.evaluate(() => {
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), {
    prompt: async () => {
      (window as any).prompted = ((window as any).prompted ?? 0) + 1;
      return { outcome: 'accepted' };
    },
  }));
});

for (const [name, userAgent, platform, touch, cards, main] of [
  ['Windows', windowsChrome, 'Windows', 0, ['windows', 'linux', 'web'], 'Get it from Microsoft Store'],
  ['Linux', linuxFirefox, undefined, 0, ['linux', 'windows', 'web'], 'Download Flatpak'],
  ['a Mac', macSafari, undefined, 0, ['web', 'windows', 'linux'], 'Use in browser'],
  ['an iPad', macSafari, undefined, 5, ['web', 'windows', 'linux'], 'Use in browser'],
  ['Android', androidChrome, 'Android', 5, ['web', 'windows', 'linux'], 'Use in browser'],
] as const)
  test(`on ${name} the ${cards[0]} card leads, holding the page's one primary button`, async ({ page }) => {
    await visitAs(page, userAgent, platform, touch);
    await expect.poll(() => order(page)).toEqual([...cards]);
    await expect(primary(page)).toHaveCount(1);
    await expect(primary(page)).toHaveText(main);
    await expect(page.getByText('On a Mac, iPhone, iPad or Android, install the web version.', { exact: true }))
      .toBeVisible({ visible: cards[0] === 'web' });
  });

for (const [name, userAgent, touch, text] of [
  ['Safari on a Mac', macSafari, 0, 'In Safari, choose File › Add to Dock.'],
  ['Safari on an iPhone', iPhoneSafari, 5, 'In Safari, tap Share, then Add to Home Screen.'],
  ['Firefox on Linux', linuxFirefox, 0, "Your browser can't install Gittin, but you can use it here."],
  ['Chrome on Windows', windowsChrome, 0, undefined],
] as const)
  test(`${name} ${text ? 'is told how the web version installs' : 'gets no hint'}`, async ({ page }) => {
    await visitAs(page, userAgent, userAgent === windowsChrome ? 'Windows' : undefined, touch);
    await expect(page.locator('.install-cards')).toBeVisible();
    await expect(page.locator('.install-hint').filter({ visible: true })).toHaveText(text ? [text] : []);
  });

test.describe('with scripts off', () => {
  test.use({ javaScriptEnabled: false });
  test('the page keeps Windows, Linux, web version, with the Store as its primary button', async ({ page }) => {
    await page.goto('/install/');
    expect(await order(page)).toEqual(['windows', 'linux', 'web']);
    await expect(primary(page)).toHaveText('Get it from Microsoft Store');
    await expect(page.locator('.install-hint').filter({ visible: true })).toHaveCount(0);
  });
});

test('the cards link to the Store and the Flatpak, and the comparison says what each version has', async ({ page }) => {
  // Playwright's WebKit presents itself as Safari on a Mac, which would put the web version first.
  await visitAs(page, windowsChrome, 'Windows');
  await expect(page).toHaveTitle('Install Gittin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Install Gittin');
  await expect(page.locator('.install-card h2')).toHaveText(['Windows', 'Linux', 'Web version']);
  const store = page.getByRole('link', { name: 'Get it from Microsoft Store', exact: true });
  const flatpak = page.getByRole('link', { name: 'Download Flatpak', exact: true });
  await expect(store).toHaveAttribute('href', 'https://apps.microsoft.com/detail/9NDJ4HR0FF1H');
  await expect(flatpak).toHaveAttribute('href', flatpakref);
  for (const link of [store, flatpak]) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(page.locator('.install-command code')).toHaveText(`flatpak install --user ${flatpakref}`);
  await expect(page.locator('.install-card').getByRole('link', { name: 'Use in browser', exact: true }))
    .toHaveAttribute('href', '/use/');
  await expect(page.locator('.install-compare thead th')).toHaveText(['Desktop app', 'Web version']);
  await expect(page.locator('.install-compare tbody th')).toHaveText(
    ['Git and GitHub', 'Saving back to your files', 'Unsaved changes are kept', 'Offline', 'Updates', 'Runs on']);
  await expect(page.locator('.install-compare tbody tr').first().locator('td')).toHaveText(['Built in', 'Not available']);
});

test('the command wraps inside its box after a slash, Copy in its corner, at every width', async ({ page }) => {
  await page.goto('/install/');
  for (const width of [1280, 760, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const code = page.locator('.install-command code');
    expect(await code.evaluate(code => code.scrollWidth <= code.clientWidth), `${width}px`).toBe(true);
    const box = (await page.locator('.install-command').boundingBox())!;
    const copy = (await page.getByRole('button', { name: 'Copy command', exact: true }).boundingBox())!;
    expect(box.x + box.width - (copy.x + copy.width)).toBeLessThan(8);
    expect(copy.y - box.y).toBeLessThan(8);
    expect(await code.evaluate(code => {
      const name = 'gittin.flatpakref';
      const text = [...code.childNodes].find(node => node.textContent!.includes(name))!;
      const range = document.createRange(), at = text.textContent!.indexOf(name);
      range.setStart(text, at);
      range.setEnd(text, at + name.length);
      return range.getClientRects().length;
    }), `${width}px`).toBe(1);
    expect(await noSidewaysScroll(page), `${width}px`).toBe(true);
  }
});

test('Copy command copies the Flatpak command and says so', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async (text: string) => { (window as any).copied = text; } },
    });
  });
  await page.goto('/install/');
  await page.getByRole('button', { name: 'Copy command', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).copied)).toBe(`flatpak install --user ${flatpakref}`);
  await expect(page.locator('.install-status')).toHaveText('Command copied.');
});

test('once the browser offers installation, Install prompts once and goes', async ({ page }) => {
  await visitAs(page, macChrome, 'macOS');
  await expect(install(page)).toBeHidden();
  await offerInstall(page);
  await expect(install(page)).toBeVisible();
  await expect(primary(page)).toHaveText('Install');
  await install(page).click();
  await expect.poll(() => page.evaluate(() => (window as any).prompted)).toBe(1);
  await expect(install(page)).toBeHidden();
  await expect(primary(page)).toHaveText('Use in browser');
});

test('an install made elsewhere drops the offer', async ({ page }) => {
  await page.goto('/install/');
  await offerInstall(page);
  await expect(install(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(install(page)).toBeHidden();
});

test('inside the installed app there is no Install button', async ({ page }) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query =>
      query === '(display-mode: standalone)' ? { ...matchMedia(query), matches: true } : matchMedia(query);
  });
  await page.goto('/install/');
  await offerInstall(page);
  await expect(page.locator('.install-cards')).toBeVisible();
  await expect(install(page)).toBeHidden();
});

test('the bar and footer: home, Use in browser and the legal pages, with no sideways scroll', async ({ page }) => {
  await page.goto('/install/');
  const bar = page.locator('.site-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Gittin home', exact: true })).toHaveAttribute('href', '/');
  await expect(bar.getByRole('link', { name: 'Use in browser', exact: true })).toHaveAttribute('href', '/use/');
  await expect(page.getByRole('navigation', { name: 'Legal', exact: true }).getByRole('link'))
    .toHaveText(['Privacy Policy', 'Terms of Service', 'Third-party notices']);
  expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toBe('Install Gittin');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await noSidewaysScroll(page), `${width}px`).toBe(true);
  }
});
