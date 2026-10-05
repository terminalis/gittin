import { test, expect, type Page } from '@playwright/test';
import { editor, expectDraftSaved, newFile, noSidewaysScroll, rememberFolder } from './kit';

const ring = (page: Page) => page.locator('.doorway .ring');
const bar = (page: Page) => page.locator('.landing-bar');

test('the doorway has no header and says what Gittin is', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Gittin', exact: true })).toBeVisible();
  await expect(page.locator('.doorway .tagline')).toHaveText("An IDE? A word processor? It's just plain text.");
  await expect(page.locator('.doorway header')).toHaveCount(0);
  await expect(ring(page)).toHaveAccessibleName('Open Gittin');
  await expect(page.locator('.doorway .explore')).toHaveAttribute('href', '#story');
});

const ringSizes = [
  [1280, 800],
  [1280, 600],
  [1920, 1080],
  [900, 800],
  [899, 800],
  [1000, 1000],
  [1024, 1366],
  [820, 1180],
  [800, 1280],
  [768, 1024],
  [600, 960],
  [390, 844],
  [375, 667],
  [844, 390],
  [667, 375],
];

test('the ring is on screen and clear of the copy at every width', async ({ page }) => {
  await page.goto('/');
  for (const [width, height] of ringSizes) {
    await page.setViewportSize({ width, height });
    await expect(ring(page)).toBeInViewport({ ratio: 1 });
    const overlap = await page.evaluate(() => {
      const r = document.querySelector('.doorway .ring')!.getBoundingClientRect();
      return [...document.querySelectorAll('.doorway-copy > *')].some(el => {
        const c = el.getBoundingClientRect();
        return c.right > r.left && c.left < r.right && c.bottom > r.top && c.top < r.bottom;
      });
    });
    expect(overlap, `${width}×${height}`).toBe(false);
    expect(await noSidewaysScroll(page), `${width}×${height}`).toBe(true);
  }
});

test('the closing logo is clear of its words at every width', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.farewell h2')).toBeAttached();
  for (const width of [1280, 1000, 900, 800, 761, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const overlap = await page.evaluate(() => {
      const d = document.querySelector('.farewell .door')!.getBoundingClientRect();
      return [...document.querySelectorAll('.farewell-text > *')].some(el => {
        const c = el.getBoundingClientRect();
        return c.right > d.left && c.left < d.right && c.bottom > d.top && c.top < d.bottom;
      });
    });
    expect(overlap, `${width}px`).toBe(false);
  }
});

test('the bar slides in once the doorway has gone', async ({ page }) => {
  await page.goto('/');
  await expect(ring(page)).toBeVisible();
  await expect(bar(page)).toBeAttached();
  const pastDoorway = () =>
    page.evaluate(() =>
      window.scrollTo(0, document.querySelector('.doorway')!.getBoundingClientRect().height + 200));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(bar(page)).toBeHidden();
    await pastDoorway();
    await expect(bar(page)).toBeVisible();
    await expect.poll(async () => Math.round((await bar(page).boundingBox())!.y)).toBe(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar(page)).toBeHidden();
  }
  await pastDoorway();
  await bar(page).getByRole('link', { name: 'Open Gittin' }).click();
  await expect(page.locator('#home')).toBeVisible();
});

test('the ring zooms into Home', async ({ page }) => {
  await page.goto('/');
  await ring(page).click();
  await expect(page.locator('.landing-portal')).toBeAttached();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);
});

test('Enter on the focused ring zooms into Home', async ({ page }) => {
  await page.goto('/');
  await ring(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.landing-portal')).toBeAttached();
  await expect(page.locator('#home')).toBeVisible();
});

test('the closing ring zooms into Home too', async ({ page }) => {
  await page.goto('/');
  await page.locator('.farewell .ring').click();
  await expect(page.locator('.landing-portal')).toBeAttached();
  await expect(page.locator('#home')).toBeVisible();
});

test('with reduced motion the ring is a plain link', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => document.addEventListener('click', e => { (window as any).ringPrevented = e.defaultPrevented; }, { once: true }));
  await ring(page).click();
  await expect(page.locator('#home')).toBeVisible();
  expect(await page.evaluate(() => (window as any).ringPrevented)).toBe(false);
});

test('a modified click on the ring keeps the browser default', async ({ page }) => {
  await page.goto('/');
  // The document listener runs after the ring's own handler; it records, then cancels the new tab.
  await page.evaluate(() => document.addEventListener('click', e => { (window as any).ringPrevented = e.defaultPrevented; e.preventDefault(); }, { once: true }));
  await ring(page).click({ modifiers: ['ControlOrMeta'] });
  expect(await page.evaluate(() => (window as any).ringPrevented)).toBe(false);
  await expect(page.locator('.landing-portal')).toHaveCount(0);
});

test('the four demonstrations are screenshots of the app and stay out of the way', async ({ page }) => {
  await page.goto('/');
  const demos = page.locator('#story .demo');
  await expect(demos).toHaveCount(4);
  for (const demo of await demos.all()) {
    await expect(demo).toHaveAttribute('aria-hidden', 'true');
    await expect(demo).toHaveAttribute('inert', '');
  }
  const shots = (demo: number) => demos.nth(demo).locator('.shot').evaluateAll(list => list.map(shot => (shot as HTMLElement).dataset.shot));
  expect(await shots(0)).toEqual(['write-edit', 'write-preview']);
  expect(await shots(1)).toEqual(['files']);
  expect(await shots(2)).toEqual(['folder']);
  expect(await shots(3)).toEqual(['history-diff', 'history-versions']);
  // Every variant the page can ask for exists as a WebP image.
  const sources = await page.locator('#story picture').evaluateAll(pictures => pictures.flatMap(picture =>
    [...picture.querySelectorAll('source')].map(source => source.srcset).concat(picture.querySelector('img')!.getAttribute('src')!)));
  expect(sources).toHaveLength(24);
  for (const source of sources) {
    const response = await page.request.get(source);
    expect(response.ok(), source).toBe(true);
    expect(response.headers()['content-type'], source).toContain('image/webp');
  }
  const gaps = await page.locator('a.action').evaluateAll(links => links.map(a => getComputedStyle(a).columnGap));
  expect(new Set(gaps)).toEqual(new Set(['10px']));
});

for (const [width, theme, size] of [[1280, 'light', 'desktop'], [1280, 'dark', 'desktop'], [390, 'light', 'phone'], [390, 'dark', 'phone']] as const)
  test(`only the ${theme} ${size} screenshots load (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    const requested: string[] = [];
    page.on('request', request => { if (request.url().includes('/landing/')) requested.push(new URL(request.url()).pathname); });
    await page.goto('/');
    await expect(page.locator('.doorway .ring')).toBeVisible();
    for (const demo of await page.locator('#story .demo').all()) {
      await demo.scrollIntoViewIfNeeded();
      for (const image of await demo.locator(`.shot-${theme} img`).all())
        await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    expect(requested.length).toBe(6);
    expect(requested.every(path => path.endsWith(`-${theme}-${size}.webp`))).toBe(true);
  });

test('a screenshot that cannot load leaves its demo out', async ({ page }) => {
  await page.route('**/landing/**', route => route.abort());
  await page.goto('/');
  for (const demo of await page.locator('#story .demo').all()) {
    await demo.evaluate(element => element.parentElement!.scrollIntoView());
    await expect(demo).toBeHidden();
  }
});

test('the installed app opens at Home', async ({ page }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.start_url).toBe('/#/home');
  expect(manifest.id).toBe('/');
});

test('shared links preview with an image that exists', async ({ page }) => {
  await page.goto('/');
  const image = new URL((await page.locator('meta[property="og:image"]').getAttribute('content'))!);
  expect(image.origin).toBe('https://gittin.app');
  const response = await page.request.get(image.pathname);
  expect(response.headers()['content-type']).toBe('image/png');
});

test('the story headings, FAQ questions and first answer match the copy, with no collapsible FAQ', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#story h2')).toHaveText([
    'Write, then preview.', 'More than Markdown.', 'Bring the whole folder.', 'Nothing gets lost.',
    'A few things to know', 'Bring a file. Start writing.',
  ]);
  await expect(page.locator('.landing-faq dt')).toHaveText([
    'Do I need an account?', 'Where are unsaved changes kept?', 'Does Preview change my Markdown?', 'Can I work offline?',
  ]);
  await expect(page.locator('.landing-faq dd').first()).toHaveText('No. Gittin has no accounts. Your files stay on your device.');
  await expect(page.locator('.landing-faq details')).toHaveCount(0);
});

test('the footer links to the policies and the notices', async ({ page }) => {
  await page.goto('/');
  const legal = page.getByRole('navigation', { name: 'Legal', exact: true });
  await expect(legal.getByRole('link')).toHaveText(['Privacy Policy', 'Terms of Service', 'Third-party notices']);
  for (const [name, href] of [['Privacy Policy', '/privacy.html'], ['Terms of Service', '/terms.html'], ['Third-party notices', '/THIRD_PARTY_NOTICES.txt']])
    await expect(legal.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
});

test('no sideways scroll anywhere on the page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.landing > footer')).toBeAttached();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await noSidewaysScroll(page), `${width}px`).toBe(true);
  }
});

test('landing and Home are titled Gittin', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Gittin');
  await page.goto('/#/home');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page).toHaveTitle('Gittin');
});

test.describe('returning visitors', () => {
  test('a first visit to the bare address shows the landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.doorway')).toBeVisible();
    await expect(page).not.toHaveURL(/#\/home$/);
  });

  test('with recent work the bare address opens Home; #/ still shows the landing page', async ({ page }) => {
    await newFile(page);
    await editor(page).pressSequentially('notes');
    await expectDraftSaved(page);
    await page.goto('/');
    await expect(page.locator('#home')).toBeVisible();
    await expect(page).toHaveURL(/#\/home$/);
    await page.goto('/#/');
    await expect(page.locator('.doorway')).toBeVisible();
  });

  test('a remembered folder alone is enough for the bare address to open Home', async ({ page }) => {
    await page.goto('/#/home');
    await rememberFolder(page);
    await page.goto('/');
    await expect(page.locator('#home')).toBeVisible();
    await expect(page).toHaveURL(/#\/home$/);
  });
});
