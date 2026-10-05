import type { HeadingMdNode, MdNode } from './parser';
import { createProjection, markdownNodes } from './source-projection';
export interface HeadingAnchor {
  text: string;
  id: string;
  level: number;
  from: number;
}
/** GitHub-style Unicode slugs, including collisions with previously generated suffixes. */
function anchorAllocator() {
  const used = new Set<string>();
  return (text: string) => {
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').replace(/ /g, '-');
    let id = base, suffix = 0;
    while (used.has(id))
      id = base + '-' + (++suffix);
    used.add(id);
    return id;
  };
}
function inlineText(node: MdNode): string {
  if (node.type === 'htmlInline')
    return '';
  if (node.literal !== null)
    return node.literal;
  let text = '';
  for (let child = node.firstChild; child; child = child.next)
    text += inlineText(child);
  return text;
}
/** YAML front matter at the very start of a document; Preview shows it as a table and Outline must skip it. */
export const FRONT_MATTER = /^\uFEFF?---\n([\s\S]*?)\n(?:---|\.\.\.)(?=\n|$)/;
export function headingAnchors(source: string): HeadingAnchor[] {
  const p = createProjection(source), allocate = anchorAllocator(), headings: HeadingAnchor[] = [];
  // The parser reads front matter as Markdown; headings it finds there are not the document's.
  const frontMatterLines = FRONT_MATTER.exec(p.text)?.[0].split('\n').length ?? 0;
  for (const node of markdownNodes(source)) {
    if (node.type !== 'heading' || node.sourcepos![0][0] <= frontMatterLines) continue;
    const text = inlineText(node), level = (node as HeadingMdNode).level;
    const from = p.toRaw(p.displayStarts[node.sourcepos![0][0] - 1]);
    headings.push({ text, id: allocate(text), level, from });
  }
  return headings;
}
