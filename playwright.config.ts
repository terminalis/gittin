import { defineConfig } from '@playwright/test';
const port = Number(process.env.PORT) || 4173;
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: true,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
  reporter: 'list',
});
