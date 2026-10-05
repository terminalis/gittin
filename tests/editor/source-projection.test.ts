import {
  createProjection,
  replaceDisplay,
  decodeSource,
  encodeSource,
  markdownNodes,
} from '@/source-projection';
import { DocumentSession } from '../../src/documents/session';
const selection = {
  mode: 'markdown' as const,
  anchor: 1,
  head: 1,
  sourceAnchor: 0,
  scrollTop: 0,
};
it('UTF-8 roundtrips BOM, mixed newlines, Unicode and no final newline', () => {
  for (const source of ['\uFEFF# T\r\n\r\n- a\nlast\rline', 'a\r\nb', 'é😀']) {
    const bytes = new TextEncoder().encode(source);
    const s = new DocumentSession(decodeSource(bytes));
    expect(encodeSource(s.current.source)).toEqual(bytes);
    expect(s.current.revision).toBe(0);
  }
  expect(() => decodeSource(new Uint8Array([255]))).toThrow(/UTF-8/);
});
it('maps offsets and preserves untouched raw spans', () => {
  const source = '\uFEFFa\r\nb\nc\rfinal';
  const p = createProjection(source);
  expect(p.text).toBe('a\nb\nc\nfinal');
  expect(p.toRaw(2)).toBe(4);
  expect(p.toDisplay(4)).toBe(2);
  expect(replaceDisplay(source, 2, 3, 'B\nnew')).toBe('\uFEFFa\r\nB\r\nnew\nc\rfinal');
});
it('source-only edit revises once and undo restores exact hyphen', () => {
  const s = new DocumentSession('- item');
  s.applySourceEdit({ from: 0, to: 1, insert: '*' }, 'command', selection);
  expect(s.current).toEqual({ source: '* item', revision: 1 });
  s.applySourceEdit({ from: 0, to: 1, insert: '*' }, 'command', selection);
  expect(s.current.revision).toBe(1);
  expect(s.undo()).toBe(true);
  expect(s.current.source).toBe('- item');
});

it('keeps one parse per text and maps parser positions to raw offsets', () => {
  const source = '\uFEFFIntro\r\n\r\nsee [guide](docs/guide.md)\r\n';
  const nodes = markdownNodes(source);
  expect(markdownNodes(source)).toBe(nodes);
  expect(markdownNodes(source + 'more')).not.toBe(nodes);
  const link = markdownNodes(source).find((node) => node.type === 'link')!;
  const { from, to } = createProjection(source).rangeOf(link.sourcepos!);
  expect(source.slice(from, to)).toBe('[guide](docs/guide.md)');
});

it('explicit display ranges distinguish identical lines with different raw newlines', () => {
  const raw = 'A\r\nA\nB';
  expect(replaceDisplay(raw, 0, 2, '')).toBe('A\nB');
  expect(replaceDisplay(raw, 2, 4, '')).toBe('A\r\nB');
  expect(replaceDisplay(raw, 0, 2, 'X\n')).toBe('X\r\nA\nB');
});
