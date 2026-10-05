/** Bounded exact line LCS. Excessive inputs use a complete, labelled coarse replacement. */
export interface DiffLine {
  kind: 'same' | 'remove' | 'add';
  text: string;
  oldLine?: number;
  newLine?: number;
}
export interface LineDiff {
  lines: DiffLine[];
  coarse: boolean;
}
export function lineDiff(before: string, after: string): LineDiff {
  const split = (text: string) => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
  const a = split(before), b = split(after);
  // Identical leading and trailing lines need no table; the line limits apply to the changed stretch between them.
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  // At most 1M cells (4MB) and 10K lines in the changed stretch in the exact algorithm, and 2MB of source.
  const coarse = x.length * y.length > 1000000 || x.length + y.length > 10000 || before.length + after.length > 2000000;
  if (coarse)
    return { coarse, lines: [...a.map((text, i): DiffLine => ({ kind: 'remove', text, oldLine: i + 1 })), ...b.map((text, i): DiffLine => ({ kind: 'add', text, newLine: i + 1 }))] };
  const width = y.length + 1, cells = new Uint32Array((x.length + 1) * width);
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      cells[i * width + j] = x[i] === y[j] ? cells[(i + 1) * width + j + 1] + 1 : Math.max(cells[(i + 1) * width + j], cells[i * width + j + 1]);
  const lines: DiffLine[] = a.slice(0, start).map((text, k) => ({ kind: 'same', text, oldLine: k + 1, newLine: k + 1 }));
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      lines.push({ kind: 'same', text: x[i], oldLine: start + ++i, newLine: start + ++j });
    }
    else if (i < x.length && (j === y.length || cells[(i + 1) * width + j] >= cells[i * width + j + 1]))
      lines.push({ kind: 'remove', text: x[i], oldLine: start + ++i });
    else
      lines.push({ kind: 'add', text: y[j], newLine: start + ++j });
  }
  for (let k = 0; k < end; k++)
    lines.push({ kind: 'same', text: a[a.length - end + k], oldLine: a.length - end + k + 1, newLine: b.length - end + k + 1 });
  return { lines, coarse };
}
/** Diff draws each change with up to `context` unchanged lines either side; it skips the other unchanged lines. */
export function shownLines(lines: DiffLine[], context = 3): boolean[] {
  const shown = lines.map(() => false);
  lines.forEach((line, i) => {
    if (line.kind !== 'same')
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) shown[k] = true;
  });
  return shown;
}
