import type { MdNode } from './parser';
import { createProjection, markdownNodes } from './source-projection';
import type { SyntaxIssue, WriteEligibility } from '../documents/types';
export function writeEligibility(source: string): WriteEligibility {
  const p = createProjection(source),
    issues: SyntaxIssue[] = [];
  const code: Array<[number, number]> = [];
  const add = (from: number, to: number, reason: string) =>
    issues.push({ from: p.toRaw(from), to: p.toRaw(to), reason });
  const range = (node: MdNode): [number, number] =>
    node.sourcepos
      ? [
          (p.displayStarts[node.sourcepos[0][0] - 1] ?? 0) + node.sourcepos[0][1] - 1,
          Math.min(
            p.text.length,
            (p.displayStarts[node.sourcepos[1][0] - 1] ?? p.text.length) + node.sourcepos[1][1]
          ),
        ]
      : [0, p.text.length];
  try {
    for (const node of markdownNodes(source)) {
      const [from, to] = range(node);
      if (node.type === 'code' || node.type === 'codeBlock') code.push([from, to]);
      else if (node.type === 'htmlBlock' || node.type === 'htmlInline') add(from, to, 'raw HTML');
    }
  } catch {
    add(0, p.text.length, 'unrenderable content');
  }
  // Recognizers work outside AST code spans/blocks only. This is a named profile, not an extension-language parser.
  let masked = p.text.split('');
  for (const [from, to] of code)
    for (let i = from; i < to; i++) if (masked[i] !== '\n') masked[i] = ' ';
  const text = masked.join('');
  const patterns: Array<[RegExp, string]> = [
    [/^\+\+\+\n[\s\S]*?\n\+\+\+(?=\n|$)/g, 'front matter'],
    [/\[\^[^\]\n]+\](?::[^\n]*)?/g, 'footnotes'],
    [/\[\[[^\]\n]+\]\]/g, 'wiki links'],
    [/^\s*:{2,}[A-Za-z][^\n]*|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, 'math or directives'],
    [/(?:^|\n)\s*@[A-Za-z]+\{[^\n]*|(?:^|\n)\s*:::[^\n]*/g, 'custom blocks or directives'],
  ];
  for (const [pattern, reason] of patterns)
    for (const match of text.matchAll(pattern)) {
      const from = match.index!;
      if (from > 0 && text[from - 1] === '\\' && !match[0].startsWith('\\')) continue;
      add(from, from + match[0].length, reason);
    }
  issues.sort((a, b) => a.from - b.from || b.to - a.to);
  const merged: SyntaxIssue[] = [];
  for (const issue of issues) {
    const last = merged[merged.length - 1];
    if (last && issue.from <= last.to) {
      last.to = Math.max(last.to, issue.to);
      if (!last.reason.includes(issue.reason)) last.reason += ', ' + issue.reason;
    } else merged.push({ ...issue });
  }
  return merged.length ? { editable: false, issues: merged } : { editable: true };
}
