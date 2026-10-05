import type { FileType } from '../documents/file-types';
import { bomLength } from './source-projection';
export interface SourceRange {
  from: number;
  to: number;
}
export interface SyntaxSpan extends SourceRange {
  kind: 'comment' | 'string' | 'code' | 'url' | 'html';
}
export function commentSyntax(type: FileType) {
  if (type === 'javascript' || type === 'typescript')
    return { line: '//', block: ['/*', '*/'] as const };
  if (type === 'css')
    return { block: ['/*', '*/'] as const };
  if (type === 'yaml')
    return { line: '#' };
  if (type === 'markdown' || type === 'html')
    return { block: ['<!--', '-->'] as const };
  return {};
}
/** Consume the entire parenthesized destination, including nested/escaped punctuation.
* Unclosed destinations conservatively protect the remainder of the source.
*/
function linkDestinationEnd(source: string, opening: number): number {
  let depth = 1;
  let quote = '';
  for (let index = opening + 1; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (quote) {
      if (character === quote)
        quote = '';
      continue;
    }
    // Quoted link titles may themselves contain parentheses.
    if ((character === '"' || character === "'") && /\s/.test(source[index - 1])) {
      quote = character;
    }
    else if (character === '(') {
      depth++;
    }
    else if (character === ')' && --depth === 0) {
      return index + 1;
    }
  }
  return source.length;
}
function linkLabelEnd(source: string, opening: number): number {
  let depth = 1;
  for (let index = opening + 1; index < source.length; index++) {
    if (source[index] === '\\') {
      index++;
    } else if (source[index] === '[') {
      depth++;
    } else if (source[index] === ']' && --depth === 0) {
      return index + 1;
    }
  }
  return source.length;
}

function markdownLinkRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === '\\') {
      index++;
      continue;
    }
    if (source[index] !== '[') continue;
    const from = source[index - 1] === '!' ? index - 1 : index;
    let end = linkLabelEnd(source, index);
    if (source[end] === '(') {
      end = linkDestinationEnd(source, end);
    } else if (source[end] === '[') {
      end = linkLabelEnd(source, end);
    }
    ranges.push({ from, to: end });
    index = end - 1;
  }
  return ranges;
}
/** The end of front matter opening a Markdown text, after its closing `---` or `...` line; else 0. */
export function frontMatterEnd(source: string) {
  const start = bomLength(source), open = /^---(?:\r\n|\r|\n)/.exec(source.slice(start));
  if (!open) return 0;
  const close = /^(?:---|\.\.\.)(?:\r\n|\r|\n|$)/gm;
  close.lastIndex = start + open[0].length;
  const found = close.exec(source);
  return found ? found.index + found[0].length : 0;
}
/** Conservative lexical boundaries, not a compiler: uncertain literals are protected to EOF. */
export function syntaxSpans(source: string, type: FileType): SyntaxSpan[] {
  const spans: SyntaxSpan[] = [], frontMatter = type === 'markdown' ? frontMatterEnd(source) : 0;
  const add = (from: number, to: number, kind: SyntaxSpan['kind']) => { spans.push({ from, to, kind }); return to; };
  const until = (start: number, end: string) => { const at = source.indexOf(end, start); return at < 0 ? source.length : at + end.length; };
  const js = type === 'javascript' || type === 'typescript';
  for (let i = bomLength(source); i < source.length;) {
    const rest = source.slice(i), ch = source[i];
    if (type === 'yaml' && (i === 0 || /[\r\n]/.test(source[i - 1]))) {
      const scalar = /^(?![ \t]*#)([ \t]*)[^\r\n]*[:>-] +[|>][+-]?[0-9]?[^\r\n]*(?:\r\n|\r|\n)/.exec(rest);
      if (scalar) {
        let end = i + scalar[0].length;
        for (const line of source.slice(end).matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
          if (!line[0])
            break;
          if (line[0].trim() && (/^[ \t]*/.exec(line[0])![0].length <= scalar[1].length))
            break;
          end += line[0].length;
        }
        i = add(i, end, 'string');
        continue;
      }
    }
    if (type === 'markdown') {
      if (frontMatter && i === bomLength(source)) {
        i = add(i, frontMatter, 'code');
        continue;
      }
      const fence = /^(?: {0,3})(`{3,}|~{3,})[^\r\n]*(?:\r\n|\r|\n|$)/.exec(rest);
      if ((i === 0 || /[\r\n\uFEFF]/.test(source[i - 1])) && fence) {
        const close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[^\\S\\r\\n]*(?:\\r?\\n|\\r|$)', 'gm');
        close.lastIndex = i + fence[0].length;
        const found = close.exec(source);
        i = add(i, found ? found.index + found[0].length : source.length, 'code');
        continue;
      }
      if (ch === '\\') {
        i = add(i, Math.min(i + 2, source.length), 'code');
        continue;
      }
      if (ch === '`') {
        const run = /^`+/.exec(rest)![0];
        i = add(i, until(i + run.length, run), 'code');
        continue;
      }
      if ((i === 0 || /[\r\n]/.test(source[i - 1])) && /^( {4}|\t)/.test(rest)) {
        const end = rest.search(/[\r\n]/);
        i = add(i, end < 0 ? source.length : i + end, 'code');
        continue;
      }
      if (rest.startsWith('](')) {
        i = add(i, linkDestinationEnd(source, i + 1), 'url');
        continue;
      }
      const reference = /^\[[^\]\r\n]+\]:[^\r\n]*/.exec(rest);
      if (reference) {
        i = add(i, i + reference[0].length, 'url');
        continue;
      }
    }
    if ((type === 'markdown' || type === 'html') && rest.startsWith('<!--')) {
      i = add(i, until(i + 4, '-->'), 'comment');
      continue;
    }
    if ((type === 'markdown' || type === 'html') && ch === '<' && /^<\/?[A-Za-z!]/.test(rest)) {
      let j = i + 1, quote = '';
      for (; j < source.length; j++) {
        const c = source[j];
        if (quote) {
          if (c === quote)
            quote = '';
        }
        else if (c === '"' || c === "'")
          quote = c;
        else if (c === '>') {
          j++;
          break;
        }
      }
      const tag = /^<(script|style|pre|code)\b/i.exec(rest);
      if (tag)
        j = until(j, '</' + tag[1] + '>');
      i = add(i, j, 'html');
      continue;
    }
    const url = /^(?:https?:\/\/|mailto:)[^\s<>"'`]+/.exec(rest);
    if (url) {
      i = add(i, i + url[0].length, 'url');
      continue;
    }
    if ((js || type === 'css' || type === 'json' || type === 'yaml') && (ch === '"' || ch === "'" || (js && ch === '`'))) {
      let j = i + 1;
      for (; j < source.length; j++) {
        if (source[j] === '\\')
          j++;
        else if (source[j] === ch) {
          j++;
          break;
        }
      }
      i = add(i, Math.min(j, source.length), 'string');
      continue;
    }
    if ((js || type === 'css') && rest.startsWith('/*')) {
      i = add(i, until(i + 2, '*/'), 'comment');
      continue;
    }
    if ((js && rest.startsWith('//')) || (type === 'yaml' && ch === '#' && (i === 0 || /\s/.test(source[i - 1])))) {
      const end = rest.search(/[\r\n]/);
      i = add(i, end < 0 ? source.length : i + end, 'comment');
      continue;
    }
    // A slash could start a regex. Protect the rest of this line if it cannot be resolved.
    if (js && ch === '/') {
      let j = i + 1, cls = false;
      for (; j < source.length && !/[\r\n]/.test(source[j]); j++) {
        if (source[j] === '\\')
          j++;
        else if (source[j] === '[')
          cls = true;
        else if (source[j] === ']')
          cls = false;
        else if (source[j] === '/' && !cls) {
          j++;
          while (/[a-z]/i.test(source[j] ?? '') && j < source.length)
            j++;
          break;
        }
      }
      i = add(i, j, 'string');
      continue;
    }
    i++;
  }
  return spans;
}
export function commentRanges(source: string, type: FileType): SourceRange[] { return syntaxSpans(source, type).filter(s => s.kind === 'comment'); }
export function proseRanges(source: string, type: FileType): SourceRange[] {
  if (type !== 'markdown')
    return [];
  const protectedRanges: SourceRange[] = [...syntaxSpans(source, type)];
  // Prose utilities exclude complete links (including labels/references) and HTML.
  protectedRanges.push(...markdownLinkRanges(source));
  for (const span of syntaxSpans(source, type).filter(s => s.kind === 'html')) {
    const tag = /^<([A-Za-z][\w:-]*)\b/.exec(source.slice(span.from, span.to));
    if (!tag || /\/\s*>$/.test(source.slice(span.from, span.to)) || /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag[1]))
      continue;
    const close = new RegExp('</' + tag[1] + '\\s*>', 'ig');
    if (close.test(source.slice(span.from, span.to)))
      continue;
    close.lastIndex = span.to;
    const match = close.exec(source);
    protectedRanges.push({ from: span.from, to: match ? match.index + match[0].length : source.length });
  }
  for (const m of source.matchAll(/^(?: {0,3}(?:#{1,6} +|> ?)|[ \t]*(?:[-+*]|\d+[.)]) +(?:\[[ xX]\] +)?)|(?<!\\)(?:\*+|_+|~~)/gm))
    protectedRanges.push({ from: m.index!, to: m.index! + m[0].length });
  const ranges: SourceRange[] = [];
  let from = bomLength(source);
  for (const span of protectedRanges.sort((a, b) => a.from - b.from)) {
    if (from < span.from)
      ranges.push({ from, to: span.from });
    from = Math.max(from, span.to);
  }
  if (from < source.length)
    ranges.push({ from, to: source.length });
  return ranges;
}
