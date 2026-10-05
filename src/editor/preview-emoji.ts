import { gemoji } from 'gemoji';
const names = new Map(gemoji.flatMap(entry => entry.names.map(name => [name, entry.emoji] as const)));
/** GitHub-style `:shortcode:` emoji; unknown shortcodes stay as typed. */
export function replaceEmoji(texts: Text[]) {
  for (const node of texts) node.data = node.data.replace(/:([a-z0-9_+-]+):/g, (full, name: string) => names.get(name) ?? full);
}
