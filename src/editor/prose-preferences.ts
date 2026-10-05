import type { Preferences, SubstitutionRule } from '../preferences';
import type { FileType } from '../documents/file-types';
import type { SourceSelection, SourceCommandResult } from './source-commands';
import type { SourceEdit } from '../documents/types';
import { proseRanges } from './source-language';
import type { LinkMdNode } from './parser';
import { createProjection, markdownNodes, splice } from './source-projection';
import { safeURL } from './safe-url';

export function spellcheckCategory(type: FileType): 'markdown' | 'code' { return type === 'markdown' || type === 'text' ? 'markdown' : 'code'; }
export function spellcheckEnabled(preferences: Preferences, type: FileType) {
  const category = spellcheckCategory(type);
  return preferences.spellcheck?.[category] ?? category === 'markdown';
}
export function ruleError(replace: string, rules: readonly SubstitutionRule[], except = -1): string {
  if (!replace.length) return 'Replace must contain literal text.';
  if (rules.some((rule, index) => index !== except && rule.replace === replace)) return 'Replace already exists. Use a unique exact match.';
  return '';
}
/** Expand one completed shortcut at a typing boundary, never replacement output. */
export function automaticSubstitution(source: string, selection: SourceSelection, type: FileType, edit: SourceEdit, preferences: Preferences): SourceCommandResult | null {
  if (type !== 'markdown' || preferences.automaticSubstitution === false || !preferences.substitutions?.length ||
      edit.from !== edit.to || selection.anchor !== selection.head || selection.head !== edit.from + edit.insert.length) return null;
  // Enter may also insert a continued list/quote prefix. Bulk text is not typing.
  const boundary = /^[ \t.,!?;:]$/.test(edit.insert) || /^(?:\r\n|\r|\n)[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?$/.test(edit.insert);
  if (!boundary) return null;
  const end = edit.from;
  const candidates = preferences.substitutions.filter(rule => {
    const start = end - rule.replace.length;
    const startsWithWordChar = /^[\p{L}\p{N}\p{M}_]/u.test(rule.replace);
    return rule.enabled && rule.replace.length > 0 && start >= 0 && source.slice(start, end) === rule.replace &&
      (!startsWithWordChar || start === 0 || !/[\p{L}\p{N}\p{M}_]$/u.test(source.slice(0, start)));
  }).sort((a, b) => b.replace.length - a.replace.length);
  if (!candidates.length) return null;
  const prose = proseRanges(source, type);
  const rule = candidates.find(rule => prose.some(span => span.from <= end - rule.replace.length && span.to >= end));
  if (!rule || rule.replace === rule.with) return null;
  const result = splice(source, end - rule.replace.length, end, rule.with);
  const caret = selection.head + rule.with.length - rule.replace.length;
  return { source: result, selection: { anchor: caret, head: caret } };
}
/** Only a single typed character, and only when the proposed source remains prose. */
export function proseTypedCharacter(source: string, selection: SourceSelection, type: FileType, typed: string, preferences: Preferences): string {
  if (type !== 'markdown' || typed.length !== 1 || selection.anchor !== selection.head) return typed;
  const at = selection.head, candidate = splice(source, at, at, typed);
  if (!proseRanges(candidate,type).some(span => span.from <= at && span.to > at)) return typed;
  const before = source.slice(0,at), previous = before.at(-1) ?? '';
  if (preferences.capitalise && /\p{Ll}/u.test(typed) && (/^(?:\uFEFF)?$/.test(before) || /(?:[.!?][ \t]+|(?:^|[\r\n])(?: {0,3}(?:#{1,6} |>|[-+*] |\d+[.)] ))?[ \t]*)$/.test(before))) return typed.toUpperCase();
  if (preferences.smartQuotes && (typed === '"' || typed === "'")) {
    const opening = !previous || /[\s([{]/.test(previous);
    return typed === '"' ? opening ? '\u201c' : '\u201d' : opening ? '\u2018' : '\u2019';
  }
  return typed;
}
/** The links and images in Markdown source, in source order: raw ranges and destinations as written. */
export function markdownLinks(source: string) {
  const projection = createProjection(source), links = [];
  for (const node of markdownNodes(source))
    if ((node.type === 'link' || node.type === 'image') && node.sourcepos)
      links.push({ kind: node.type, url: (node as LinkMdNode).destination || '',
        ...projection.rangeOf(node.sourcepos) });
  return links;
}
/** Links with a safe destination; no network metadata or source rewriting. */
export function sourceLinks(source: string): Array<{ from: number; to: number; url: string }> {
  return markdownLinks(source).flatMap(({ kind, url, from, to }) => {
    const safe = kind === 'link' && safeURL(url);
    return safe ? [{ from, to, url: safe }] : [];
  });
}
