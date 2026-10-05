import { describe, it, expect } from 'vitest';
import { lineDiff, shownLines } from '@/diff';
import { headingAnchors } from '@/heading-anchors';
describe('bounded exact line comparisons', () => {
  const shownText = (d: ReturnType<typeof lineDiff>) => { const s = shownLines(d.lines); return d.lines.filter((_, i) => s[i]).map(l => l.text); };
  it('preserves complete versions, raw endings and final newline differences', () => {
    for (const [before, after] of [['a\r\nb\n', 'a\r\nc\r'], ['', 'new'], ['a', 'a\n'], ['a\r\nb\rc', 'b\rc\n'], ['same', 'same']]) {
      const result = lineDiff(before, after);
      expect(result.coarse).toBe(false);
      expect(result.lines.filter(l => l.kind !== 'add').map(l => l.text).join('')).toBe(before);
      expect(result.lines.filter(l => l.kind !== 'remove').map(l => l.text).join('')).toBe(after);
    }
    expect(lineDiff('a\nb\n', 'a\nc\n').lines.map(l => l.kind)).toEqual(['same', 'remove', 'add']);
  });
  it('labels coarse fallback and retains every line of both full versions', () => {
    const a = 'a\n'.repeat(1100), b = 'b\n'.repeat(1100), d = lineDiff(a, b);
    expect(d.coarse).toBe(true);
    expect(d.lines.filter(l => l.kind === 'remove').map(l => l.text).join('')).toBe(a);
    expect(d.lines.filter(l => l.kind === 'add').map(l => l.text).join('')).toBe(b);
  });
  it('stays exact for changes between identical leading and trailing lines of a long file', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`), before = lines.join('');
    const changed = [...lines.slice(0, 999), 'changed\n', ...lines.slice(1000)].join('');
    const inserted = [...lines.slice(0, 1000), 'new\n', ...lines.slice(1000)].join('');
    const c = lineDiff(before, changed), n = lineDiff(before, inserted);
    expect(c.coarse).toBe(false);
    expect(c.lines.filter(l => l.kind !== 'same')).toEqual([
      { kind: 'remove', text: 'line 1000\n', oldLine: 1000 },
      { kind: 'add', text: 'changed\n', newLine: 1000 },
    ]);
    expect(n.coarse).toBe(false);
    expect(n.lines.filter(l => l.kind !== 'same')).toEqual([{ kind: 'add', text: 'new\n', newLine: 1001 }]);
    expect(n.lines[0]).toEqual({ kind: 'same', text: 'line 1\n', oldLine: 1, newLine: 1 });
    expect(n.lines.at(-1)).toEqual({ kind: 'same', text: 'line 2000\n', oldLine: 2000, newLine: 2001 });
    for (const [after, d] of [[changed, c], [inserted, n]] as const) {
      expect(d.lines.filter(l => l.kind !== 'add').map(l => l.text).join('')).toBe(before);
      expect(d.lines.filter(l => l.kind !== 'remove').map(l => l.text).join('')).toBe(after);
    }
  });
  it('shows each change with three unchanged lines either side and skips the rest', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}\n`), before = lines.join('');
    const middle = lineDiff(before, [...lines.slice(0, 9), 'changed\n', ...lines.slice(10)].join(''));
    expect(shownText(middle))
      .toEqual(['line 7\n', 'line 8\n', 'line 9\n', 'line 10\n', 'changed\n', 'line 11\n', 'line 12\n', 'line 13\n']);
    const first = lineDiff(before, ['changed\n', ...lines.slice(1)].join(''));
    expect(shownText(first))
      .toEqual(['line 1\n', 'changed\n', 'line 2\n', 'line 3\n', 'line 4\n']);
    const last = lineDiff(before, [...lines.slice(0, 19), 'changed\n'].join(''));
    expect(shownText(last))
      .toEqual(['line 17\n', 'line 18\n', 'line 19\n', 'line 20\n', 'changed\n']);
  });
  it('joins changes whose context overlaps and shows nothing when nothing changed', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}\n`), before = lines.join('');
    const change = (...at: number[]) => lineDiff(before, lines.map((l, i) => (at.includes(i) ? 'changed\n' : l)).join(''));
    // Six unchanged lines between two changes are all context; with seven, the middle one is skipped.
    expect(shownLines(change(4, 11).lines).map(Number).join('')).toBe('0' + '1'.repeat(16) + '0'.repeat(5));
    expect(shownLines(change(4, 12).lines).map(Number).join('')).toBe('0' + '1'.repeat(8) + '0' + '1'.repeat(8) + '0'.repeat(4));
    expect(shownLines(lineDiff('a\nb\n', 'a\nb\n').lines)).toEqual([false, false]);
  });
  it('shares formatted Unicode anchors with explicit suffix collision disambiguation', () => {
    expect(headingAnchors('# **Hello**, `world`!\n## Hello world\n# Hello world-1\n# Hello world\n# Café 日本\n').map(h => h.id)).toEqual(['hello-world', 'hello-world-1', 'hello-world-1-1', 'hello-world-2', 'café-日本']);
  });
});
