import type { StepMap } from 'prosemirror-transform';
import type { Node as PMNode } from 'prosemirror-model';
import type { SourceEdit } from '../documents/types';
import { Parser, type MdNode, type Sourcepos } from './parser';
import type { SourceSelection } from './source-commands';
export function decodeSource(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw Error('This file is not valid UTF-8. Choose a UTF-8 Markdown file.');
  }
}
export function encodeSource(source: string) {
  return new TextEncoder().encode(source);
}
export function newlineStyle(source: string) {
  const counts = new Map<string, number>();
  for (const match of source.matchAll(/\r\n|\r|\n/g))
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\n';
}
/** 1 when the text starts with a byte order mark, which no view shows or edits. */
export function bomLength(source: string) { return source.charCodeAt(0) === 0xfeff ? 1 : 0; }
/** The selection's start and end, in order. */
export function bounds({ anchor, head }: SourceSelection) {
  return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
}
/** Each line's start and text, after any BOM. A final newline leaves an empty last line. */
export function sourceLines(source: string): { start: number; text: string }[] {
  const lines: { start: number; text: string }[] = [];
  let start = bomLength(source);
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ start, text: source.slice(start, match.index) });
    start = match.index! + match[0].length;
  }
  lines.push({ start, text: source.slice(start) });
  return lines;
}
export function splice(source: string, from: number, to: number, text: string) {
  return source.slice(0, from) + text + source.slice(to);
}
export function createProjection(source: string) {
  const bom = bomLength(source);
  const rawStarts = [bom], displayStarts = [0];
  let extra = bom;
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    const end = match.index! + match[0].length;
    extra += match[0].length - 1;
    rawStarts.push(end);
    displayStarts.push(end - extra);
  }
  const text = source.slice(bom).replace(/\r\n|\r/g, '\n');
  function lineAt(starts: number[], offset: number) {
    let lo = 0, hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  function toRaw(offset: number) {
    offset = Math.max(0, Math.min(text.length, offset));
    const i = lineAt(displayStarts, offset);
    return rawStarts[i] + offset - displayStarts[i];
  }
  function toDisplay(offset: number) {
    offset = Math.max(bom, Math.min(source.length, offset));
    const i = lineAt(rawStarts, offset);
    return Math.min(displayStarts[i] + offset - rawStarts[i], displayStarts[i + 1] ?? text.length);
  }
  return {
    text,
    rawStarts,
    displayStarts,
    toRaw,
    toDisplay,
    /** The editor position of a raw offset. Each line is a paragraph, which opens one position. */
    toNative(raw: number) {
      const offset = toDisplay(raw);
      return offset + 1 + lineAt(displayStarts, offset);
    },
    /** Raw offsets of a parser node's 1-based line and column range; the end column is included. */
    rangeOf: ([start, end]: Sourcepos) => ({
      from: toRaw(displayStarts[start[0] - 1] + start[1] - 1), to: toRaw(displayStarts[end[0] - 1] + end[1]) }),
  };
}
let parsed: { text: string; nodes: MdNode[] } | undefined;
/**
 * The parsed nodes of this text in document order, root first. One parse is kept and shared
 * until the text changes, so callers must not change the nodes. It is kept by the text the parser
 * reads, so a source and its display text share it whatever their line endings.
 */
export function markdownNodes(source: string): MdNode[] {
  // The projection's text: no byte order mark, and \n line endings.
  const text = source.slice(bomLength(source)).replace(/\r\n|\r/g, '\n');
  if (parsed?.text !== text) {
    const walker = new Parser({ extendedAutolinks: true }).parse(text).walker(), nodes = [];
    for (let event; (event = walker.next()); ) if (event.entering) nodes.push(event.node);
    parsed = { text, nodes };
  }
  return parsed.nodes;
}
export function textEdit(before: string, after: string): SourceEdit | null {
  if (before === after) return null;
  let from = 0, to = before.length, end = after.length;
  while (from < to && from < end && before[from] === after[from]) from++;
  while (to > from && end > from && before[to - 1] === after[end - 1]) {
    to--;
    end--;
  }
  return { from, to, insert: after.slice(from, end) };
}
export function replaceDisplay(
  source: string, from: number, to: number, insert: string, verbatim = false) {
  const p = createProjection(source);
  const text = verbatim ? insert : insert.replace(/\r\n|\r|\n/g, newlineStyle(source));
  return splice(source, p.toRaw(from), p.toRaw(to), text);
}
export function markdownOffset(doc: PMNode, position: number) {
  let native = 0,
    offset = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (position < native + child.nodeSize)
      return offset + Math.max(0, Math.min(child.content.size, position - native - 1));
    native += child.nodeSize;
    offset += child.textContent.length + (i + 1 < doc.childCount ? 1 : 0);
  }
  return offset;
}

// A paragraph separator is implicit: its display character belongs to the
// closing token only while another paragraph follows. Compare the adjacent
// unchanged token at each accepted map boundary so end insertion/removal also
// includes that separator, without shifting edits across identical text.
export function markdownStepEdits(
  before: PMNode,
  after: PMNode,
  map: StepMap
): SourceEdit[] {
  const oldText = before.textBetween(0, before.content.size, '\n');
  const newText = after.textBetween(0, after.content.size, '\n');
  const edits: SourceEdit[] = [];
  map.forEach((oldStart, oldEnd, newStart, newEnd) => {
    let from = markdownOffset(before, oldStart),
      to = markdownOffset(before, oldEnd);
    let start = markdownOffset(after, newStart),
      end = markdownOffset(after, newEnd);
    const leftOld = markdownOffset(before, Math.max(0, oldStart - 1));
    const leftNew = markdownOffset(after, Math.max(0, newStart - 1));
    if (oldText.slice(leftOld, from) !== newText.slice(leftNew, start)) {
      from = leftOld;
      start = leftNew;
    }
    const rightOld = markdownOffset(before, Math.min(before.content.size, oldEnd + 1));
    const rightNew = markdownOffset(after, Math.min(after.content.size, newEnd + 1));
    if (oldText.slice(to, rightOld) !== newText.slice(end, rightNew)) {
      to = rightOld;
      end = rightNew;
    }
    if (from !== to || start !== end)
      edits.push({ from, to, insert: newText.slice(start, end) });
  });
  return edits;
}
