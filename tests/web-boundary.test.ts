import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Shared code runs in every version of Gittin, so it must not depend on what only the website has.
const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src'), web = join(src, 'web');
const inWeb = (path: string) => path === web || path.startsWith(web + sep);
const show = (path: string) => relative(root, path).replace(/\\/g, '/');

it('shared code does not import from src/web', () => {
  const shared = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(ts|js|css)$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
    .filter(file => !inWeb(file));
  // Relative specifiers in `from '…'`, `import '…'`, `import('…')` and CSS `@import "…"`.
  const imports = shared.flatMap(file =>
    [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)]
      .map(match => ({ file, target: resolve(dirname(file), match[1]) })));
  expect(imports.filter(({ target }) => inWeb(target)).map(({ file, target }) => `${show(file)} imports ${show(target)}`))
    .toEqual([]);
});
