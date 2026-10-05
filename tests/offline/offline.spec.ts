import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { editor } from '../browser/kit';
test('after one visit Gittin starts offline and edits and exports an existing draft', async ({ page, context }) => {
  await page.addInitScript(() => { (window as any).showSaveFilePicker = undefined; });
  await page.goto('/#/home');
  await expect(page.locator('.offline-status')).toBeVisible();
  await page.getByRole('button', { name: 'New file', exact: true }).click();
  await editor(page).pressSequentially('offline draft');
  await expect(page.locator('#draft-status')).toHaveText('Draft saved on this device');
  await context.setOffline(true);
  await page.reload();
  await expect(editor(page)).toHaveText('offline draft');
  await editor(page).press('End');
  await editor(page).pressSequentially(' edited');
  await expect(page.locator('#draft-status')).toHaveText('Draft saved on this device');
  const saving = page.waitForEvent('download');
  await page.locator('#save-file').click();
  expect((await readFile((await (await saving).path())!)).toString()).toBe('offline draft edited');
});
test('the install leaves out the landing screenshots; offline the landing shows without its demos', async ({ page, context }) => {
  await page.goto('/#/home');
  await expect(page.locator('.offline-status')).toBeVisible();
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key =>
    (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat());
  expect(cached).toContain('/');
  expect(cached.filter(path => path.startsWith('/landing/'))).toEqual([]);
  await context.setOffline(true);
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1, name: 'Gittin', exact: true })).toBeVisible();
  for (const demo of await page.locator('#story .demo').all()) {
    await demo.evaluate(element => element.parentElement!.scrollIntoView());
    await expect(demo).toBeHidden();
  }
});
test('a failed initial cache never claims offline readiness', async ({ page, context }) => {
  let blocked = false;
  await context.route('**/THIRD_PARTY_NOTICES.txt', route => { blocked = true; return route.abort(); });
  await page.goto('/#/home');
  await expect.poll(() => blocked).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))).toBe(false);
  await expect(page.locator('.offline-status')).toBeHidden();
});
