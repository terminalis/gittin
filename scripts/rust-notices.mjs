// Regenerate the desktop app's Rust notices whenever src-tauri/Cargo.lock changes: node scripts/rust-notices.mjs
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const notices = 'src-tauri/THIRD_PARTY_NOTICES.txt';
execFileSync('cargo', ['about', 'generate', '--manifest-path', 'src-tauri/Cargo.toml', '-c', 'src-tauri/about.toml',
  'src-tauri/about.hbs', '-o', notices], { stdio: 'inherit' });
const credited = '\n' + readFileSync(notices, 'utf8');
const unbuilt = new Set(readFileSync('src-tauri/Cargo.lock', 'utf8').split('[[package]]').slice(1)
  .filter(block => block.includes('\nsource = ')).map(block => /name = "([^"]+)"/.exec(block)[1])
  .filter(name => !credited.includes('\n' + name + ' — ')));
appendFileSync(notices, `\nIn Cargo.lock but not built into the app: ${[...unbuilt].join(', ')}.\n`);
