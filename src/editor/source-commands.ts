import type { FileType } from '../documents/file-types';
import {
  commentRanges, commentSyntax, frontMatterEnd, syntaxSpans, type SourceRange, type SyntaxSpan,
} from './source-language';
import { newlineStyle, createProjection, bounds, markdownNodes, sourceLines, splice } from './source-projection';
export interface SourceSelection {
  anchor: number;
  head: number;
}
export interface SourceCommandResult {
  source: string;
  selection: SourceSelection;
}
export const sourceCommands = [
  'bold', 'italic', 'strike', 'code', 'ins', 'sup', 'sub', 'mark', 'clearFormatting',
  'heading', 'bulletList', 'orderedList', 'taskList', 'blockQuote', 'indent', 'outdent',
  'duplicateLines', 'moveLinesUp', 'moveLinesDown', 'deleteLines',
  'convertToComment', 'convertToText', 'deleteSelection',
  'alignLeft', 'alignCenter', 'alignRight', 'alignJustify',
] as const;
export type SourceCommand = typeof sourceCommands[number];
export function sourceCommandAvailable(command: string, type: FileType) {
  if (command === 'convertToComment' || command === 'convertToText')
    return !!(commentSyntax(type).line || commentSyntax(type).block);
  if (/^(indent|outdent|duplicateLines|moveLinesUp|moveLinesDown|deleteLines|deleteSelection)$/.test(command))
    return true;
  if (command.startsWith('align'))
    return type === 'markdown' || type === 'html';
  return type === 'markdown';
}
const lineCommands = new Set<SourceCommand>(['duplicateLines', 'moveLinesUp', 'moveLinesDown', 'deleteLines']);
const orderedItem = /^([ \t]*)(\d{1,9})([.)])(?=[ \t]|$)/;
type ListAround = { lines: { start: number; text: string }[]; items: number[] };
/** The ordered list (same indent and delimiter) containing the line at `at`; nested and blank lines belong to it. */
function listAround(source: string, at: number): ListAround | null {
  const lines = sourceLines(source);
  let index = 0;
  while (index + 1 < lines.length && lines[index + 1].start <= at) index++;
  const current = orderedItem.exec(lines[index].text);
  if (!current) return null;
  const [, indent, , delimiter] = current;
  const belongs = (text: string) => { const m = orderedItem.exec(text); return !!m && m[1] === indent && m[3] === delimiter; };
  const within = (text: string) => !text.trim() || /^[ \t]*/.exec(text)![0].length > indent.length;
  const items = [index];
  for (let i = index - 1; i >= 0 && (belongs(lines[i].text) || within(lines[i].text)); i--) if (belongs(lines[i].text)) items.unshift(i);
  for (let i = index + 1; i < lines.length && (belongs(lines[i].text) || within(lines[i].text)); i++) if (belongs(lines[i].text)) items.push(i);
  return { lines, items };
}
/** After a line command, number the list around the caret consecutively from the start number it had before. */
function renumberOrderedList(before: string, beforeSelection: SourceSelection, result: SourceCommandResult): SourceCommandResult {
  const at = bounds(result.selection).from;
  // Numbered lines inside a code fence are literal text, not a list.
  if (syntaxSpans(result.source, 'markdown').some(span => span.kind === 'code' && span.from <= at && at < span.to && /^ {0,3}(?:```|~~~)/.test(result.source.slice(span.from))))
    return result;
  const after = listAround(result.source, at);
  if (!after) return result;
  const original = listAround(before, bounds(beforeSelection).from);
  const firstLine = (list: ListAround) => list.lines[list.items[0]].text;
  let number = Number(orderedItem.exec(firstLine(original ?? after))![2]);
  const edits: { from: number; to: number; text: string }[] = [];
  for (const index of after.items) {
    const line = after.lines[index], m = orderedItem.exec(line.text)!, from = line.start + m[1].length, wanted = String(number++);
    if (m[2] !== wanted) edits.push({ from, to: from + m[2].length, text: wanted });
  }
  if (!edits.length) return result;
  let source = result.source;
  for (const edit of [...edits].reverse()) source = splice(source, edit.from, edit.to, edit.text);
  const map = (position: number) => edits.reduce((mapped, edit) => position >= edit.to ? mapped + edit.text.length - (edit.to - edit.from) : mapped, position);
  return { source, selection: { anchor: map(result.selection.anchor), head: map(result.selection.head) } };
}
export function applySourceCommand(source: string, selection: SourceSelection, command: SourceCommand, type: FileType, level = 0): SourceCommandResult | null {
  const result = applyRawSourceCommand(source, selection, command, type, level);
  return result && type === 'markdown' && lineCommands.has(command) ? renumberOrderedList(source, selection, result) : result;
}
function isCompleteHtmlSpan(text: string): boolean {
  let quote = '';
  let openingEnd = -1;
  for (let index = 1; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      openingEnd = index + 1;
      break;
    }
  }
  if (openingEnd < 0) return false;
  const rawTag = /^<(script|style|pre|code)\b/i.exec(text);
  if (!rawTag) return openingEnd === text.length;
  return new RegExp('</' + rawTag[1] + '\\s*>$', 'i').test(text.slice(openingEnd));
}
// Preview and GitHub only render a comment the Markdown parser reads inside a single HTML node at `from`; a raw HTML block (e.g. <div>) may hold the comment on a later line, or later on its first line outside any tag.
function markdownCommentAt(source: string, from: number, to: number): boolean {
  const p = createProjection(source), start = p.toDisplay(from), comment = p.text.slice(start, p.toDisplay(to));
  const lineAt = (offset: number) => p.text.slice(0, offset).split('\n').length, line = lineAt(start), endLine = lineAt(p.toDisplay(to)), column = start - p.text.lastIndexOf('\n', start - 1);
  for (const node of markdownNodes(source))
    if (node.type === 'htmlBlock' || node.type === 'htmlInline') {
      const { literal = '', sourcepos, type } = node, [row, col] = sourcepos![0];
      if (row === line && col === column && literal!.startsWith(comment)) return true;
      if (type === 'htmlBlock' && endLine <= sourcepos![1][0] && !/^<(?:script|style|textarea)/i.test(literal!) &&
        (row < line || row === line && col < column && commentRanges(source, 'markdown').some(span => span.from === from && span.to === to))) return true;
    }
  return false;
}
function canAlignSourceRange(source: string, type: FileType, from: number, to: number): boolean {
  return syntaxSpans(source, type).every(span => {
    if (span.to <= from || span.from >= to)
      return true;
    // Complete HTML tags/raw elements may be wrapped externally. A boundary
    // inside a tag, quoted attribute or raw body must never receive markup.
    return span.kind === 'html' && span.from >= from && span.to <= to &&
      isCompleteHtmlSpan(source.slice(span.from, span.to));
  });
}
interface CommandContext {
  source: string; from: number; to: number; type: FileType; level: number;
  /** Replaces start..end and selects a..b, keeping the selection's direction. */
  replace(start: number, end: number, text: string, a?: number, b?: number): SourceCommandResult;
}
type Transform = (c: CommandContext, command: SourceCommand) => SourceCommandResult | null;
/** The whole lines the selection touches, each with its newline. */
function selectedLines({ source, from, to }: CommandContext) {
  const lines = sourceLines(source).map((line, i, all) =>
    ({ ...line, eol: source.slice(line.start + line.text.length, all[i + 1]?.start) }));
  const index = (at: number) => {
    const i = lines.findIndex(l => at < l.start + l.text.length + l.eol.length);
    return i < 0 ? lines.length - 1 : i;
  };
  const first = index(from), last = index(Math.max(from, to - 1));
  const end = lines[last].start + lines[last].text.length;
  return { lines, first, last, start: lines[first].start, end };
}
type Lines = ReturnType<typeof selectedLines>;
/** Rewrites each selected line, keeping its newline, and selects the changed lines. */
function changeLines(c: CommandContext, { lines, first, last, start, end }: Lines,
  change: (line: Lines['lines'][number], index: number) => string) {
  const text = lines.slice(first, last + 1).map((line, i) => change(line, i) + (i < last - first ? line.eol : ''));
  return c.replace(start, end, text.join(''));
}
const wraps: Record<string, [string, string]> = {
  bold: ['**', '**'], italic: ['*', '*'], strike: ['~~', '~~'], code: ['`', '`'],
  ins: ['<ins>', '</ins>'], sup: ['<sup>', '</sup>'], sub: ['<sub>', '</sub>'], mark: ['<mark>', '</mark>'],
};
/** Inline code toggles off when the selection is a single-line code span or its content. */
function unwrapCode({ source, from, to, replace }: CommandContext, spans: SyntaxSpan[]) {
  const span = spans.find(s => s.kind === 'code' && s.from <= from && s.to >= to);
  if (!span) return null;
  const raw = source.slice(span.from, span.to);
  if (from === to && raw === '``' && span.from === from - 1 && span.to === to + 1)
    return replace(span.from, span.to, '');
  const run = /^`+/.exec(raw)?.[0];
  if (!run || /[\r\n]/.test(raw) || !raw.endsWith(run)) return null;
  const inner = raw.slice(run.length, -run.length);
  const padding = inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() ? 1 : 0;
  const content = span.from + run.length + padding === from && span.to - run.length - padding === to;
  if (span.from === from && span.to === to || content)
    return replace(span.from, span.to, padding ? inner.slice(1, -1) : inner);
  return null;
}
const wrap: Transform = (c, command) => {
  const { source, from, to, type, replace } = c, selected = source.slice(from, to);
  const spans = syntaxSpans(source, type);
  let [open, close] = wraps[command];
  const unwrapped = command === 'code' && unwrapCode(c, spans);
  if (unwrapped) return unwrapped;
  // A marker may not land inside a literal; a selection may cover whole one-line code spans.
  const blocked = (s: SyntaxSpan) =>
    (s.from < to && s.to > from || from === to && s.from <= from && s.to > from) &&
    !(s.kind === 'html' && [open, close].includes(source.slice(s.from, s.to))) &&
    !(command === 'code' && s.kind === 'code' && s.from >= from && s.to <= to &&
      !/[\r\n]/.test(source.slice(s.from, s.to)));
  if (spans.some(blocked)) return null;
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length)
    return replace(from, to, selected.slice(open.length, -close.length));
  if (source.slice(from - open.length, from) === open && source.slice(to, to + close.length) === close)
    return replace(from - open.length, to + close.length, selected);
  if (command === 'code') {
    const longest = Math.max(0, ...(selected.match(/`+/g) ?? []).map(s => s.length));
    open = close = '`'.repeat(longest + 1);
    if (/^ | $|^`|`$/.test(selected)) { open += ' '; close = ' ' + close; }
  }
  return replace(from, to, open + selected + close, from + open.length, to + open.length);
};
const clean = (text: string) => text
  .replace(/(?<!\\)(\*\*|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
  .replace(/(?<![\\\w])__(?=\S)([^\r\n]*?\S)__(?!\w)/g, '$1')
  .replace(/(?<![\\\w])([*_~])(?=\S)([^\r\n]*?\S)\1(?!\w)/g, '$2')
  .replace(/<\/?(?:ins|sup|sub|mark)>/g, '');
const clearFormatting: Transform = ({ source, from, to, type, replace }) => {
  const protectedSpans = syntaxSpans(source, type)
    .filter(s => s.kind !== 'html' || !/^<\/?(?:ins|sup|sub|mark)>$/.test(source.slice(s.from, s.to)));
  let text = '', at = from;
  for (const span of protectedSpans.filter(s => s.to > from && s.from < to)) {
    text += clean(source.slice(at, Math.max(at, span.from)));
    const end = Math.min(to, span.to);
    const chunk = source.slice(Math.max(at, span.from), end);
    const wholeCode = span.kind === 'code' && span.from >= from && span.to <= to && /^(`+)([^\r\n]*?)\1$/.test(chunk);
    text += wholeCode ? chunk.replace(/^(`+)([\s\S]*?)\1$/, '$2') : chunk;
    at = end;
  }
  text += clean(source.slice(at, to));
  return replace(from, to, text);
};
const convertToText: Transform = ({ source, from, to, type, replace }) => {
  const syntax = commentSyntax(type);
  const comments = commentRanges(source, type).filter(span => from === to
    ? span.from <= from && from < span.to
    : span.from < to && span.to > from);
  const removals: SourceRange[] = [];
  for (const span of comments) {
    const text = source.slice(span.from, span.to);
    if (syntax.block && text.startsWith(syntax.block[0])) {
      const [open, close] = syntax.block;
      removals.push({ from: span.from, to: span.from + open.length });
      if (text.length >= open.length + close.length && text.endsWith(close))
        removals.push({ from: span.to - close.length, to: span.to });
    } else if (syntax.line && text.startsWith(syntax.line)) {
      const length = syntax.line.length;
      removals.push({ from: span.from, to: span.from + length + (text[length] === ' ' ? 1 : 0) });
    }
  }
  if (!removals.length) return null;
  let text = '', at = 0;
  for (const removal of removals) { text += source.slice(at, removal.from); at = removal.to; }
  text += source.slice(at);
  const mapPosition = (position: number) =>
    position - removals.reduce((removed, span) => removed + Math.max(0, Math.min(position, span.to) - span.from), 0);
  return replace(0, source.length, text, mapPosition(from), mapPosition(to));
};
/** A block comment around the selection where the syntax allows one; otherwise a line comment on each line. */
const convertToComment: Transform = c => {
  const { source, from, to, type, replace } = c, selected = source.slice(from, to), syntax = commentSyntax(type);
  if (from === to || !selected.trim()) return null;
  const overlaps = commentRanges(source, type).some(span => span.from < to && span.to > from);
  if (syntax.block && !overlaps && !selected.includes(syntax.block[0]) && !selected.includes(syntax.block[1])) {
    const [open, close] = syntax.block, end = to + open.length + close.length;
    const result = replace(from, to, open + selected + close, from + open.length, to + open.length);
    // Reject nesting and boundaries inside literals or across Markdown blocks: the inserted
    // markers must form a real comment covering exactly the selected content.
    return (type === 'markdown'
      ? markdownCommentAt(result.source, from, end)
      : commentRanges(result.source, type).some(span => span.from === from && span.to === end)) ? result : null;
  }
  if (!syntax.line) return null;
  const marker = syntax.line, comments = commentRanges(source, type), inserted: number[] = [];
  let added = 0;
  const result = changeLines(c, selectedLines(c), line => {
    const indent = /^[ \t]*/.exec(line.text)![0].length;
    if (!line.text.trim() || comments.some(span => span.from === line.start + indent)) return line.text;
    inserted.push(line.start + indent + added);
    added += marker.length + 1;
    return splice(line.text, indent, indent, marker + ' ');
  });
  const converted = commentRanges(result.source, type);
  const real = inserted.every(position => converted.some(span => span.from === position));
  return inserted.length && real ? result : null;
};
const duplicateLines: Transform = c => {
  const { source, from, to, replace } = c;
  if (from !== to) return replace(to, to, source.slice(from, to), to, to + to - from);
  const { start, end } = selectedLines(c), block = source.slice(start, end), nl = newlineStyle(source);
  return replace(end, end, nl + block, end + nl.length, end + nl.length + block.length);
};
const deleteLines: Transform = c => {
  const { lines, first, last, start, end } = selectedLines(c), finish = end + lines[last].eol.length;
  if (finish === end && first > 0)
    return c.replace(lines[first - 1].start + lines[first - 1].text.length, end, '');
  return c.replace(start, finish, '');
};
const moveLines: Transform = (c, command) => {
  const { lines, first, last, end } = selectedLines(c), up = command === 'moveLinesUp';
  if (up ? first === 0 : last === lines.length - 1) return null;
  const a = up ? first - 1 : first, b = up ? last : last + 1;
  // The line order after the move; each place keeps its own newline.
  const order = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  if (up) order.push(order.shift()!);
  else order.unshift(order.pop()!);
  const text = order.map((index, i) => lines[index].text + (i < order.length - 1 ? lines[a + i].eol : '')).join('');
  const movedStarts = new Map<number, number>();
  let offset = lines[a].start;
  order.forEach((oldIndex, i) => {
    movedStarts.set(oldIndex, offset);
    offset += lines[oldIndex].text.length + lines[a + i].eol.length;
  });
  const mapPosition = (position: number) => {
    if (position > end) {
      const ordinal = order.indexOf(last) + a;
      return movedStarts.get(last)! + lines[last].text.length + (ordinal < b ? lines[ordinal].eol.length : 0);
    }
    let index = first;
    while (index < last && position >= lines[index + 1].start)
      index++;
    return movedStarts.get(index)! + Math.min(position - lines[index].start, lines[index].text.length);
  };
  const replaced = lines[b].start + lines[b].text.length;
  return c.replace(lines[a].start, replaced, text, mapPosition(c.from), mapPosition(c.to));
};
const align: Transform = (c, command) => {
  const { start, end } = selectedLines(c), block = c.source.slice(start, end);
  if (!canAlignSourceRange(c.source, c.type, start, end)) return null;
  const alignment = command.slice(5).toLowerCase();
  const existing = /^<div align="(?:left|center|right|justify)">([\s\S]*)<\/div>$/.exec(block);
  return c.replace(start, end, `<div align="${alignment}">${existing?.[1] ?? block}</div>`);
};
/** Whether a selected line is literal text: inside a code block or front matter. Block commands leave it alone. */
function literalLines({ source }: CommandContext, { first, last, start }: Lines) {
  return start < frontMatterEnd(source) || markdownNodes(source).some(node => node.type === 'codeBlock' &&
    node.sourcepos![0][0] <= last + 1 && node.sourcepos![1][0] >= first + 1);
}
const headingOrList: Transform = (c, command) => {
  const lines = selectedLines(c), heading = c.level ? '#'.repeat(c.level) + ' ' : '';
  if (literalLines(c, lines)) return null;
  const marker = (index: number) => command === 'bulletList' ? '- ' : command === 'taskList' ? '- [ ] ' : `${index + 1}. `;
  return changeLines(c, lines, ({ text }, index) => command === 'heading'
    ? text.replace(/^( {0,3})(?:#{1,6} +)?/, '$1' + heading)
    : text.replace(/^(\s*)(?:(?:[-+*]|\d+[.)]) +(?:\[[ xX]\] +)?)?/, '$1' + marker(index)));
};
/** Adds one quote level to each line, or removes one when every non-blank line is quoted. */
const blockQuote: Transform = c => {
  const lines = selectedLines(c);
  if (literalLines(c, lines)) return null;
  const texts = lines.lines.slice(lines.first, lines.last + 1)
    .map(line => line.text).filter(text => text.trim());
  const quoted = texts.length > 0 && texts.every(text => /^[ \t]*>/.test(text));
  return changeLines(c, lines, ({ text }) =>
    quoted ? text.replace(/^([ \t]*)> ?/, '$1') : text.replace(/^[ \t]*/, '$&> '));
};
const indentation: Transform = (c, command) => changeLines(c, selectedLines(c), ({ text }) =>
  command === 'indent' ? '  ' + text : text.replace(/^(?: {1,2}|\t)/, ''));
const transforms: Record<SourceCommand, Transform> = {
  bold: wrap, italic: wrap, strike: wrap, code: wrap, ins: wrap, sup: wrap, sub: wrap, mark: wrap,
  clearFormatting, convertToComment, convertToText,
  deleteSelection: ({ from, to, replace }) => from === to ? null : replace(from, to, ''),
  duplicateLines, deleteLines, moveLinesUp: moveLines, moveLinesDown: moveLines,
  alignLeft: align, alignCenter: align, alignRight: align, alignJustify: align,
  blockQuote, heading: headingOrList,
  bulletList: headingOrList, orderedList: headingOrList, taskList: headingOrList,
  indent: indentation, outdent: indentation,
};
function commandContext(source: string, selection: SourceSelection, type: FileType, level = 0) {
  const { from, to } = bounds(selection), reversed = selection.anchor > selection.head;
  const replace = (start: number, end: number, text: string, a = start, b = start + text.length) => ({
    source: splice(source, start, end, text), selection: reversed ? { anchor: b, head: a } : { anchor: a, head: b },
  });
  return { source, from, to, type, level, replace } satisfies CommandContext;
}
function applyRawSourceCommand(
  source: string, selection: SourceSelection, command: SourceCommand, type: FileType, level = 0,
): SourceCommandResult | null {
  if (!sourceCommandAvailable(command, type))
    return null;
  return transforms[command](commandContext(source, selection, type, level), command);
}
const listMarker = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;
/** Enter on a list item: the next item, or leaving the list on an empty one. Null when not in a list. */
export function continuation(source: string, selection: SourceSelection): SourceCommandResult | null {
  const c = commandContext(source, selection, 'markdown'), lines = selectedLines(c);
  const line = lines.lines[lines.first], item = listMarker.exec(line.text), nl = newlineStyle(source);
  if (c.from !== c.to || !item || c.from < line.start + item[0].length || literalLines(c, lines))
    return null;
  if (!line.text.slice(item[0].length).trim()) {
    const caret = line.start + nl.length;
    return c.replace(line.start, lines.end, nl, caret, caret);
  }
  const [, indent, marker, space, task] = item, number = parseInt(marker);
  const next = indent + (isNaN(number) ? marker : number + 1 + marker.slice(-1)) + space +
    (task ? task.replace(/\[[xX]\]/, '[ ]') : '');
  const caret = c.from + nl.length + next.length;
  const result = c.replace(c.from, c.from, nl + next, caret, caret);
  return isNaN(number) ? result : renumberOrderedList(source, selection, result);
}
