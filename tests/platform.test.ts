import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test('the desktop app names itself where the website names the browser', async () => {
  vi.stubGlobal('document', { documentElement: { dataset: { app: 'desktop' } } });
  vi.resetModules();
  const { saveState } = await import('../src/documents/save-state');
  expect(saveState({ kind: 'local', id: 'x' }, { source: '', revision: 0 }, null, undefined)).toBe('Only in this app');
});
test('the website names the browser', async () => {
  const { saveState } = await import('../src/documents/save-state');
  expect(saveState({ kind: 'local', id: 'x' }, { source: '', revision: 0 }, null, undefined)).toBe('Only in this browser');
});
