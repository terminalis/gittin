import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  plugins: [
    {
      name: 'gittin-notices',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_NOTICES.txt',
          source: readFileSync('THIRD_PARTY_NOTICES.txt', 'utf8'),
        });
        const excluded = [...this.getModuleIds()].filter((id) =>
          /(?:\/tests\/|\/node_modules\/(?:@playwright|playwright)(?:\/|$))/.test(id)
        );
        if (excluded.length) throw Error('Excluded build inputs: ' + excluded.join(', '));
        // Every bundled npm package needs a "<name> — <licence file>" entry in the notices.
        const notices = readFileSync('THIRD_PARTY_NOTICES.txt', 'utf8');
        const packages = new Map<string, string>();
        for (const id of this.getModuleIds()) {
          const path = id.replace(/\\/g, '/'), match = [...path.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].pop();
          if (match) packages.set(match[1], path.slice(0, match.index! + match[0].length));
        }
        const missing = [...packages].filter(([name]) => !notices.includes('\n' + name + ' — '));
        if (missing.length)
          throw Error(
            'THIRD_PARTY_NOTICES.txt has no entry for:\n' + missing.map(([, dir]) => dir).join('\n') +
              '\nAdd them with: node scripts/append-notices.mjs <the folders above>'
          );
      },
    },
    {
      name: 'gittin-offline',
      apply: 'build',
      enforce: 'post',
      generateBundle(_options, bundle) {
        // landing/ stays out of the install: the installed app opens at Home, and the link-preview
        // image is only for other apps.
        const publicFiles = readdirSync('public', { recursive: true, withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => relative('public', join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
          .filter(name => !name.startsWith('landing/'));
        const built = Object.keys(bundle).filter(name => name !== 'index.html');
        const hash = createHash('sha256');
        for (const name of Object.keys(bundle).sort()) { const item = bundle[name]; hash.update(name).update(item.type === 'chunk' ? item.code : item.source); }
        for (const name of publicFiles.sort()) hash.update(name).update(readFileSync(join('public', name)));
        const files = ['/', ...built.map(name => '/' + name), ...publicFiles.map(name => '/' + name)];
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: readFileSync('src/web/service-worker.js', 'utf8')
            .replace('__VERSION__', hash.digest('hex').slice(0, 16))
            .replace('__FILES__', JSON.stringify(files)),
        });
      },
    },
  ],
  // Pre-bundle Mermaid so its first dynamic import doesn't trigger a dev-server re-optimise and page reload.
  optimizeDeps: { include: ['mermaid'] },
  build: {
    // Mermaid's on-demand diagram engines (ELK layout, its grammar parser) are third-party chunks
    // of up to about 1.5 MB that load only when a diagram needs them.
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/editor', import.meta.url)),
    },
  },
  test: {
    globals: true,
    maxWorkers: 2,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: [...configDefaults.exclude, 'tests/browser/**', 'tests/offline/**'],
  },
});
