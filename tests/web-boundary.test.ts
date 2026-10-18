import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared code runs in every version of Gittin, so it must not depend on what only the website or only
// the desktop app has, and those two must not depend on each other.
const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const within = (folder: string) => (path: string) => path === folder || path.startsWith(folder + sep);
const inWeb = within(join(src, 'web')), inNative = within(join(src, 'native'));
const area = (path: string) => (inWeb(path) ? 'web' : inNative(path) ? 'native' : 'shared');
const show = (path: string) => relative(root, path).replace(/\\/g, '/');
const files = readdirSync(src, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(ts|js|css)$/.test(entry.name))
  .map(entry => join(entry.parentPath, entry.name));
const specifiers = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(match => match[1]);

it('each version imports only shared code and its own', () => {
  // Relative specifiers in `from '…'`, `import '…'`, `import('…')` and CSS `@import "…"`.
  const crossings = files.flatMap(file => specifiers(file).filter(s => s.startsWith('.'))
    .map(s => resolve(dirname(file), s))
    .filter(target => area(target) !== 'shared' && area(target) !== area(file))
    .map(target => `${show(file)} imports ${show(target)}`));
  expect(crossings).toEqual([]);
});
it('only the desktop app imports Tauri', () => {
  const tauri = files.filter(file => !inNative(file) && specifiers(file).some(s => s.startsWith('@tauri-apps/')));
  expect(tauri.map(show)).toEqual([]);
});
