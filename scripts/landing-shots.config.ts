import { defineConfig } from '@playwright/test';
const port = Number(process.env.PORT) || 4176;
// Regenerates the landing page's screenshots from the running app (landing-shots.ts).
export default defineConfig({
  testDir: '.',
  testMatch: 'landing-shots.ts',
  // One worker, so the image sizes collected across shots are written once at the end.
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: 'list',
});
