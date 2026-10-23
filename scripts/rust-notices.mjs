// Regenerate the desktop app's Rust notices whenever src-tauri/Cargo.lock changes: node scripts/rust-notices.mjs
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const notices = 'src-tauri/THIRD_PARTY_NOTICES.txt';
execFileSync('cargo', ['about', 'generate', '--manifest-path', 'src-tauri/Cargo.toml', '-c', 'src-tauri/about.toml',
  'src-tauri/about.hbs', '-o', notices], { stdio: 'inherit' });
// libgit2, which libgit2-sys builds into the app, has a licence of its own and lists the code it bundles.
const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--manifest-path',
  'src-tauri/Cargo.toml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const libgit2 = metadata.packages.find(item => item.name === 'libgit2-sys');
appendFileSync(notices, `\nlibgit2, built into the app by libgit2-sys ${libgit2.version}\n\n`
  + readFileSync(join(dirname(libgit2.manifest_path), 'libgit2', 'COPYING'), 'utf8').trim() + '\n');
const credited = '\n' + readFileSync(notices, 'utf8');
const unbuilt = new Set(readFileSync('src-tauri/Cargo.lock', 'utf8').split('[[package]]').slice(1)
  .filter(block => block.includes('\nsource = ')).map(block => /name = "([^"]+)"/.exec(block)[1])
  .filter(name => !credited.includes('\n' + name + ' — ')));
appendFileSync(notices, `\nIn Cargo.lock but not built into the app: ${[...unbuilt].join(', ')}.\n`);
