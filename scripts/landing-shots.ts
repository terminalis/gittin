// Screenshots of the real app for the landing page: npm run landing-shots
// Drives the running app with a sample folder and writes public/landing/<shot>-<theme>-<size>.webp,
// plus their sizes in src/web/landing-shots.json. Re-run it whenever the workspace changes, then commit both.
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const folder: Record<string, string> = {
  'trip-notes.md': '# Trip notes\n\n**Day 1:** the harbour, then the old town.\n\n| Stop | Time |\n| --- | --- |\n| Harbour | 09:00 |\n| Old town | 11:30 |\n\n- [x] Book the ferry\n- [ ] Find the market\n',
  'guide.md': '# Guide\n\nHow to use the project, step by step.\n\n## Getting started\n\n1. Open the `field-notes` folder.\n2. Pick a file from the tree.\n3. Save writes straight back to it.\n',
  'README.md': '# Field notes\n\nNotes and guides for the project.\n',
  'site.yaml': '# Site settings\ntitle: "Field notes"\ndraft: false\npages: 3\nnav:\n  - guide.md\n  - README.md\n',
  'theme.css': '/* Reading width */\n.page {\n  max-width: 72ch;\n  line-height: 1.6;\n}\n',
  'to-do.txt': 'Call the venue by Friday.\nBring the long cable.\n',
  'stops.json': '{\n  "stops": 3,\n  "start": "09:00",\n  "walk": true\n}\n',
  'drafts/ideas.md': '# Ideas\n',
};
const sizes = { desktop: { width: 880, height: 600 }, phone: { width: 390, height: 640 } } as const;
type Size = keyof typeof sizes;
type Theme = 'light' | 'dark';

const md = (page: Page) => page.locator('.md-mode .ProseMirror');

/** Opens Home with the sample folder standing in for the system folder picker (Chromium's private file system). */
async function start(page: Page, theme: Theme, size: Size, changes: Record<string, string> = {}) {
  await page.setViewportSize(sizes[size]);
  // A fixed clock keeps Version history times the same on every run.
  await page.clock.setFixedTime(new Date('2026-10-01T10:24:00'));
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('field-notes', { create: true });
  });
  await page.goto('/#/home');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await page.evaluate(async files => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('field-notes', { create: true });
    for (const [path, text] of Object.entries(files)) {
      const parts = path.split('/'), name = parts.pop()!;
      let dir = root;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(text);
      await writable.close();
    }
  }, { ...folder, ...changes });
}

/** Opens a top-level file of the sample folder from Home. */
async function openFromHome(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  await page.getByRole('dialog', { name: 'field-notes', exact: true }).getByRole('button', { name, exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText(name);
}

/** Opens another file from the workspace's Folder panel. */
async function openFromPanel(page: Page, name: string, size: Size) {
  if (size === 'phone') await page.locator('#repository-toggle').click();
  await page.locator('#repository-panel').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('#document-title')).toHaveText(name);
  if (size === 'phone' && !(await page.locator('#workspace').evaluate(el => el.classList.contains('hide-repository'))))
    await page.locator('#repository-toggle').click();
}

/** Shows or hides a side panel (desktop) or drawer (phone). */
async function panel(page: Page, which: 'documents' | 'repository', open: boolean) {
  const shown = await page.locator('#workspace').evaluate((el, which) => !el.classList.contains('hide-' + which), which);
  if (shown !== open) await page.locator(`#${which}-toggle`).click();
}

async function view(page: Page, mode: 'markdown' | 'preview' | 'diff') {
  await page.locator(`[data-mode="${mode}"]`).click();
  await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
}

/** Inserts text at the end as one input, so list continuation and typing substitutions leave it as written. */
async function typeAtEnd(page: Page, text: string) {
  await md(page).click();
  await md(page).press('ControlOrMeta+End');
  await page.keyboard.insertText(text);
}

/** Replaces the whole file text as one input. */
async function replaceText(page: Page, text: string) {
  await md(page).click();
  await md(page).press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

async function saveAt(page: Page, time: string) {
  await page.clock.setFixedTime(new Date(`2026-10-01T${time}:00`));
  await page.locator('#save-file').click();
  await expect(page.locator('#save-state')).toHaveText('Saved');
}

/** Captures the page (or a region) and writes it as WebP, encoded by the browser so no extra tool is needed. */
async function shot(page: Page, name: string, theme: Theme, size: Size, clip?: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(async () => {
    // Passing messages ("Saved to guide.md.") are not part of the view being shown.
    document.querySelector('#notice')?.replaceChildren();
    const status = document.querySelector('#file-status');
    if (status) status.textContent = '';
    (document.activeElement as HTMLElement | null)?.blur();
    await document.fonts.ready;
  });
  await page.mouse.move(sizes[size].width - 2, sizes[size].height / 2);
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const webp = await page.evaluate(async data => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + data;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return canvas.toDataURL('image/webp', 0.92).split(',')[1];
  }, png.toString('base64'));
  mkdirSync('public/landing', { recursive: true });
  writeFileSync(`public/landing/${name}-${theme}-${size}.webp`, Buffer.from(webp, 'base64'));
  (dimensions[name] ??= {})[size] = [Math.round(clip?.width ?? sizes[size].width), Math.round(clip?.height ?? sizes[size].height)];
}

/** CSS-pixel sizes per shot and screen size, so the landing reserves each image's space before it loads. */
const dimensions: Record<string, Partial<Record<Size, [number, number]>>> = {};
test.afterAll(() => {
  const sorted = Object.fromEntries(Object.keys(dimensions).sort().map(name => [name, { desktop: dimensions[name].desktop, phone: dimensions[name].phone }]));
  writeFileSync('src/web/landing-shots.json', JSON.stringify(sorted, null, 2) + '\n');
});

test.use({ deviceScaleFactor: 2, browserName: 'chromium', locale: 'en-GB' });

for (const size of Object.keys(sizes) as Size[])
  for (const theme of ['light', 'dark'] as const) {
    test(`write ${theme} ${size}`, async ({ page }) => {
      await start(page, theme, size);
      await openFromHome(page, 'trip-notes.md');
      await panel(page, 'documents', false);
      await panel(page, 'repository', false);
      await shot(page, 'write-edit', theme, size);
      await view(page, 'preview');
      const tools = (await page.locator('.workspace-tools').boundingBox())!;
      await shot(page, 'write-preview', theme, size, { x: 0, y: tools.y, width: sizes[size].width, height: sizes[size].height - tools.y });
    });

    test(`files ${theme} ${size}`, async ({ page }) => {
      await start(page, theme, size);
      await openFromHome(page, 'to-do.txt');
      for (const name of ['theme.css', 'stops.json', 'site.yaml']) await openFromPanel(page, name, size);
      await panel(page, 'repository', false);
      // On a phone the Open Files drawer would cover the file, so the file itself is shown.
      await panel(page, 'documents', size === 'desktop');
      await shot(page, 'files', theme, size);
    });

    test(`folder ${theme} ${size}`, async ({ page }) => {
      await start(page, theme, size);
      await openFromHome(page, 'README.md');
      await typeAtEnd(page, '\nOpen guide.md first.');
      await openFromPanel(page, 'guide.md', size);
      await view(page, 'preview');
      await panel(page, 'documents', false);
      await panel(page, 'repository', true);
      await shot(page, 'folder', theme, size);
    });

    test(`history ${theme} ${size}`, async ({ page }) => {
      const intro = '# Guide\n\nHow to use the project.\n\n## Getting started\n';
      await start(page, theme, size, { 'guide.md': intro });
      await page.clock.setFixedTime(new Date('2026-10-01T09:12:00'));
      await openFromHome(page, 'guide.md');
      await replaceText(page, intro + '\n1. Open the `field-notes` folder.\n');
      await saveAt(page, '10:24');
      await replaceText(page, intro + '\n1. Open the `field-notes` folder.\n2. Pick a file from the tree.\n');
      await saveAt(page, '11:02');
      await replaceText(page, folder['guide.md']);
      await panel(page, 'documents', false);
      await panel(page, 'repository', false);
      await view(page, 'diff');
      await shot(page, 'history-diff', theme, size);
      await page.locator('#version-history').click();
      const dialog = page.getByRole('dialog', { name: 'Version history' });
      await expect(dialog.locator('.version-row')).toHaveCount(3);
      await shot(page, 'history-versions', theme, size, (await dialog.boundingBox())!);
    });
  }
