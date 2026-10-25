import { test, expect, type Page } from '@playwright/test';
import { editor, expectDraftSaved, newFile, noSidewaysScroll } from './kit';

const ring = (page: Page) => page.locator('.doorway .ring');
const bar = (page: Page) => page.locator('.site-bar');
const pastDoorway = (page: Page) => page.evaluate(() =>
  window.scrollTo(0, document.querySelector('.doorway')!.getBoundingClientRect().height + 200));
const description = "An IDE? A word processor? It's just plain text. Edit Markdown, notes, code and config files and "
  + 'save straight back, with git built into the desktop app. No account needed.';

test('the doorway has no header and says what Gittin is', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Gittin', exact: true })).toBeVisible();
  await expect(page.locator('.doorway .tagline')).toHaveText("An IDE? A word processor? It's just plain text.");
  await expect(page.locator('.doorway header')).toHaveCount(0);
  await expect(ring(page)).toHaveAccessibleName('Install Gittin');
  await expect(ring(page)).toHaveAttribute('href', '/install/');
  await expect(ring(page).locator('span')).toHaveText(['Install', 'Gittin']);
});

const ringSizes = [
  [1280, 800], [1280, 600], [1920, 1080], [900, 800], [899, 800], [1000, 1000], [1024, 1366], [820, 1180],
  [800, 1280], [768, 1024], [600, 960], [390, 844], [375, 667], [844, 390], [667, 375],
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

test('the opening offers Use in browser on every screen, and Learn more on landscape ones', async ({ page }) => {
  for (const [width, height, landscape] of [[1280, 800, true], [844, 390, true], [768, 1024, false], [390, 844, false]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const use = page.locator('.doorway').getByRole('link', { name: 'Use in browser', exact: true });
    await expect(use, `${width}×${height}`).toHaveCount(1);
    await expect(use).toBeVisible();
    await expect(use).toHaveAttribute('href', '/use/');
    await expect(page.locator('.doorway').getByRole('link', { name: 'Learn more', exact: true }))
      .toBeVisible({ visible: landscape });
  }
  await expect(page.locator('.doorway .explore')).toHaveAttribute('href', '#story');
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

test('the bar slides in once the doorway has gone, with Use in browser and Install', async ({ page }) => {
  await page.goto('/');
  await expect(ring(page)).toBeVisible();
  for (const width of [1280, 390, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(bar(page)).toBeHidden();
    await pastDoorway(page);
    await expect(bar(page)).toBeVisible();
    await expect.poll(async () => Math.round((await bar(page).boundingBox())!.y)).toBe(0);
    const use = bar(page).getByRole('link', { name: 'Use in browser', exact: true });
    const install = bar(page).getByRole('link', { name: 'Install', exact: true });
    await expect(use).toHaveAttribute('href', '/use/');
    await expect(install).toHaveAttribute('href', '/install/');
    await expect(install).toHaveClass(/\bprimary\b/);
    expect(await install.evaluate(a => a.getBoundingClientRect().right), `${width}px`).toBeLessThanOrEqual(width);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar(page)).toBeHidden();
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await pastDoorway(page);
  await bar(page).getByRole('link', { name: 'Use in browser', exact: true }).click();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page).toHaveURL(/\/use\/#\/home$/);
});

test('the ring zooms out, then opens the install page', async ({ page }) => {
  await page.goto('/');
  await ring(page).click();
  await expect(page.locator('.landing-portal')).toBeAttached();
  await expect(page).toHaveURL(/\/install\/$/);
});

test('Enter on the focused ring zooms too', async ({ page }) => {
  await page.goto('/');
  await ring(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.landing-portal')).toBeAttached();
  await expect(page).toHaveURL(/\/install\/$/);
});

test('the closing ring installs Gittin too', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.farewell .ring')).toHaveAccessibleName('Install Gittin');
  await page.locator('.farewell .ring').click();
  await expect(page.locator('.landing-portal')).toBeAttached();
  await expect(page).toHaveURL(/\/install\/$/);
});

/** The document listener runs after the ring's own handler; it records whether the ring cancelled the click, then
 * cancels the navigation itself. */
const recordRingClick = (page: Page) => page.evaluate(() => document.addEventListener('click', e => {
  (window as any).ringPrevented = e.defaultPrevented;
  e.preventDefault();
}, { once: true }));

test('with reduced motion the ring is a plain link', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await recordRingClick(page);
  await ring(page).click();
  expect(await page.evaluate(() => (window as any).ringPrevented)).toBe(false);
  await expect(page.locator('.landing-portal')).toHaveCount(0);
});

test('a modified click on the ring keeps the browser default', async ({ page }) => {
  await page.goto('/');
  await recordRingClick(page);
  await ring(page).click({ modifiers: ['ControlOrMeta'] });
  expect(await page.evaluate(() => (window as any).ringPrevented)).toBe(false);
  await expect(page.locator('.landing-portal')).toHaveCount(0);
});

test('coming back from the install page shows the landing, not the zoom', async ({ page }) => {
  await page.goto('/');
  await ring(page).click();
  await expect(page).toHaveURL(/\/install\/$/);
  await page.goBack();
  await expect(ring(page)).toBeVisible();
  await expect(page.locator('.landing-portal')).toHaveCount(0);
});

test('addresses from before the move open the web app at /use/', async ({ page }) => {
  await page.goto('/#/home');
  await expect(page).toHaveURL(/\/use\/#\/home$/);
  await expect(page.locator('#home')).toBeVisible();
  await page.goto('/#/document/missing');
  await expect(page).toHaveURL(/\/use\//);
  await page.goto('/#/');
  await expect(ring(page)).toBeVisible();
});

test('the bare address shows the site even with recent work in this browser', async ({ page }) => {
  await newFile(page);
  await editor(page).pressSequentially('notes');
  await expectDraftSaved(page);
  await page.goto('/');
  await expect(ring(page)).toBeVisible();
  await expect(page).not.toHaveURL(/use/);
});

test('a Light or Dark choice made in the app applies on the site', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/use/#/home');
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('the demonstrations are screenshots of the app and stay out of the way', async ({ page }) => {
  await page.goto('/');
  const demos = page.locator('#story .demo');
  await expect(demos).toHaveCount(4);
  for (const demo of await demos.all()) {
    await expect(demo).toHaveAttribute('aria-hidden', 'true');
    await expect(demo).toHaveAttribute('inert', '');
  }
  const shots = (demo: number) =>
    demos.nth(demo).locator('.shot').evaluateAll(list => list.map(shot => (shot as HTMLElement).dataset.shot));
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
});

for (const [width, theme, size] of [[1280, 'light', 'desktop'], [1280, 'dark', 'desktop'], [390, 'light', 'phone'], [390, 'dark', 'phone']] as const)
  test(`only the ${theme} ${size} screenshots load (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    const requested: string[] = [];
    page.on('request', request => { if (request.url().includes('/landing/')) requested.push(new URL(request.url()).pathname); });
    await page.goto('/');
    await expect(ring(page)).toBeVisible();
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

test('the installed app opens at Home under /use/', async ({ page }) => {
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.start_url).toBe('/use/#/home');
  expect(manifest.id).toBe('/');
});

test('shared links preview with an image that exists, and the new description', async ({ page }) => {
  await page.goto('/');
  const image = new URL((await page.locator('meta[property="og:image"]').getAttribute('content'))!);
  expect(image.origin).toBe('https://gittin.app');
  const response = await page.request.get(image.pathname);
  expect(response.headers()['content-type']).toBe('image/png');
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]'])
    expect(await page.locator(selector).getAttribute('content')).toBe(description);
});

test('the story leads with the desktop app, then the four shared sections, the questions and the close', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#story h2')).toHaveText([
    'Every save, in git.', 'Sync with GitHub.', 'Write, then preview.', 'More than Markdown.', 'Bring the whole folder.',
    'Nothing gets lost.', 'A few things to know', 'Bring a file. Start writing.',
  ]);
  expect(await page.locator('#story .feature').evaluateAll(sections =>
    sections.map(section => section.querySelector('.site-label')?.textContent ?? ''))).toEqual(
    ['Desktop app', 'Desktop app', '', '', '', '']);
  await expect(page.locator('#story .feature-number')).toHaveText(['01', '02', '03', '04', '05', '06']);
  await expect(page.locator('#story .feature li')).toHaveText([
    "Git is built in, so there's nothing else to install", 'Start a repository to give any folder git history',
    'Your files go to GitHub only when you sync or publish', 'Signing in is optional',
    'Tables, maths, diagrams and emoji render in Preview', 'Preview never changes your source',
    'Plain text, JSON, YAML, HTML, CSS, JavaScript and TypeScript', 'Any other text file opens as plain text',
    'Unsaved changes wait until you save', 'A dot marks files with unsaved changes',
    'Up to 20 recent saves of each file, kept on your device', 'Your file only changes when you save',
  ]);
  await expect(page.locator('.landing-faq dt')).toHaveText([
    'Do I need an account?', 'Where are unsaved changes kept?', 'Does Preview change my Markdown?', 'Can I work offline?',
  ]);
  await expect(page.locator('.landing-faq dd')).toHaveText([
    'No. Gittin has no accounts of its own; the desktop app can sign in to GitHub to sync repositories.',
    'On this device, in the desktop app or your browser, until you save. A browser can clear its storage, so save to '
      + 'keep them in a file.',
    "No. Preview is read-only and shows source snippets for anything it can't render fully. Switching views leaves "
      + 'your source and undo history unchanged.',
    'Yes. The desktop app works offline from the start. In a browser, Gittin starts without a connection once it has '
      + 'loaded on this device.',
  ]);
  await expect(page.locator('.landing-faq').getByRole('link', { name: 'The desktop app', exact: true }))
    .toHaveAttribute('href', '/install/');
  await expect(page.locator('.landing-faq details')).toHaveCount(0);
  await expect(page.locator('.farewell p')).toHaveText('No account needed.');
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
  await expect(page.locator('.site-footer')).toBeAttached();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    expect(await noSidewaysScroll(page), `${width}px`).toBe(true);
  }
});

test('the site and Home are titled Gittin', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Gittin');
  await page.goto('/use/#/home');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page).toHaveTitle('Gittin');
});
