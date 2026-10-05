import type { FileType } from '../documents/file-types';
import { syntaxSpans, commentRanges, type SyntaxSpan } from './source-language';
import { shownLines, type LineDiff } from './diff';
export interface DisplaySettings {
  showComments: boolean;
  syntaxHighlighting: boolean;
  whitespace: boolean;
  wordWrap: boolean;
}
export const defaultDisplay: DisplaySettings = { showComments: true, syntaxHighlighting: true, whitespace: false, wordWrap: true };
export type ColorSpan = Omit<SyntaxSpan, 'kind'> & {
  kind: SyntaxSpan['kind'] | 'keyword' | 'number';
};
export function coloredSpans(source: string, type: FileType): ColorSpan[] {
  if (type === 'unknown' || type === 'text')
    return [];
  const protectedSpans = syntaxSpans(source, type), spans: ColorSpan[] = [...protectedSpans];
  const pattern = type === 'markdown' ? /(?:^|\n) {0,3}(?:#{1,6}|>|[-+*]|\d+\.)|\*+|_+|~~/g : /\b(?:const|let|var|function|return|class|new|if|else|for|while|import|export|from|async|await|throw|try|catch|true|false|null|undefined|interface|type|public|private)\b|\b\d+(?:\.\d+)?\b/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const from = match.index!, to = from + match[0].length;
    while (cursor < protectedSpans.length && protectedSpans[cursor].to <= from)
      cursor++;
    if (protectedSpans[cursor] && protectedSpans[cursor].from < to)
      continue;
    spans.push({ from, to, kind: /^\d/.test(match[0]) ? 'number' : 'keyword' });
  }
  return spans.sort((a, b) => a.from - b.from);
}
/** Lexical highlighting, not a compiler: comments, strings, literal code, URLs and HTML. */
export function appendSource(target: HTMLElement, source: string, type: FileType, settings: DisplaySettings, spans = coloredSpans(source, type), from = 0, to = source.length) {
  let end = from;
  let low = 0, high = spans.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (spans[mid].to <= from)
      low = mid + 1;
    else
      high = mid;
  }
  for (let index = low; index < spans.length; index++) {
    const original = spans[index];
    if (original.from >= to)
      break;
    if (original.to <= from || original.from >= to)
      continue;
    const span = { ...original, from: Math.max(from, original.from), to: Math.min(to, original.to) };
    target.append(document.createTextNode(source.slice(end, span.from)));
    const el = document.createElement('span');
    el.textContent = source.slice(span.from, span.to);
    if (settings.syntaxHighlighting)
      el.className = 'syntax-' + span.kind;
    if (span.kind !== 'comment' || settings.showComments)
      target.append(el);
    end = span.to;
  }
  target.append(document.createTextNode(source.slice(end, to)));
}
/** Draws a line diff: each change with three lines of context either side and one marker row per
 * skipped run, or both versions whole when the diff is coarse. */
export function renderDiff(target: HTMLElement, diff: LineDiff, before: string, after: string, type: FileType,
  settings: DisplaySettings) {
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, textContent = '') =>
    Object.assign(document.createElement(tag), className ? { className, textContent } : { textContent });
  if (diff.coarse) {
    for (const [label, text] of [['Complete baseline (removed)', before], ['Complete current draft (added)', after]])
      target.append(element('h3', '', label), element('pre', '', sourceForDisplay(text, type, settings.showComments)));
    return;
  }
  const oldSpans = coloredSpans(before, type), newSpans = coloredSpans(after, type);
  const shown = shownLines(diff.lines);
  // Markdown source stays neutral in Diff, as in Edit; code files keep lexical colours.
  const colours = type === 'markdown' ? { ...settings, syntaxHighlighting: false } : settings;
  const row = (kind: string, ...cells: Node[]) => {
    const line = element('div', 'diff-line diff-' + kind); line.append(...cells); target.append(line);
  };
  let oldOffset = 0, newOffset = 0, skipped = 0;
  const flushSkipped = () => {
    if (!skipped) return;
    const sign = element('span', 'diff-sign', '⋯'), count = `${skipped} unchanged line${skipped === 1 ? '' : 's'}`;
    sign.setAttribute('aria-hidden', 'true');
    row('skipped', element('span', ''), element('span', ''), sign, element('span', '', count));
    skipped = 0;
  };
  diff.lines.forEach((line, index) => {
    if (!shown[index]) { skipped++; oldOffset += line.text.length; newOffset += line.text.length; return; }
    flushSkipped();
    const removed = line.kind === 'remove', offset = removed ? oldOffset : newOffset, code = element('code', '');
    const [text, spans] = removed ? [before, oldSpans] : [after, newSpans];
    appendSource(code, text, type, colours, spans, offset, offset + line.text.length);
    if (line.kind !== 'add') oldOffset += line.text.length;
    if (line.kind !== 'remove') newOffset += line.text.length;
    row(line.kind, element('span', 'diff-number diff-old-number', String(line.oldLine ?? '')),
      element('span', 'diff-number diff-new-number', String(line.newLine ?? '')),
      element('span', 'diff-sign', line.kind === 'add' ? '+' : removed ? '−' : ''), code);
  });
  flushSkipped();
}
export function fenceType(language: string): FileType {
  return ({ js: 'javascript', javascript: 'javascript', ts: 'typescript', typescript: 'typescript', json: 'json', css: 'css', html: 'html', yaml: 'yaml', yml: 'yaml', md: 'markdown', markdown: 'markdown', txt: 'text', text: 'text' } as Record<string, FileType>)[language.toLowerCase()] ?? 'unknown';
}
/** Only the detached display string changes; source and comparison data stay intact. */
export function sourceForDisplay(source: string, type: FileType, showComments: boolean) {
  if (showComments)
    return source;
  const parts: string[] = [];
  let end = 0;
  for (const span of commentRanges(source, type)) {
    parts.push(source.slice(end, span.from));
    end = span.to;
  }
  parts.push(source.slice(end));
  return parts.join('');
}
