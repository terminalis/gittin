// Append licence notices for bundled packages: node scripts/append-notices.mjs <package dir>...
// The build's notices guard prints the directories to pass.
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
for (const dir of process.argv.slice(2)) {
  const name = dir.replace(/\\/g, '/').split('node_modules/').pop();
  const file = readdirSync(dir).find(entry => /^(licen[cs]e|copying)/i.test(entry));
  if (!file) {
    console.error(`No licence file in ${dir}: add "${name} — package.json" with its licence text by hand.`);
    process.exitCode = 1;
    continue;
  }
  appendFileSync('THIRD_PARTY_NOTICES.txt', `\n\n${name} — ${file}\n\n${readFileSync(`${dir}/${file}`, 'utf8').trim()}\n`);
}
