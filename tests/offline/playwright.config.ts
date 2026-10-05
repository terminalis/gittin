import { defineConfig } from '@playwright/test';
const port = Number(process.env.PORT) || 4174;
// Offline behaviour needs the production build: the service worker is not registered by the dev server.
export default defineConfig({
  testDir: '.',
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `npm run build && npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: '../..',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180000,
  },
  reporter: 'list',
});
