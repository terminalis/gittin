import { literalMatches } from '../../src/editor/find';
describe('literal current-document search', () => {
  it('treats regex punctuation literally and preserves UTF-16 offsets', () => {
    expect(literalMatches('😀 a.* A.*', 'a.*', false)).toEqual([
      { from: 3, to: 6 },
      { from: 7, to: 10 },
    ]);
  });
  it('does not lose offsets to case-fold expansions', () => {
    expect(literalMatches('İ AX', 'ax', false)).toEqual([{ from: 2, to: 4 }]);
  });
  it('returns complete non-overlapping matches and handles empty queries', () => {
    expect(literalMatches('aaaa', 'aa', true)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
    expect(literalMatches('text', '', false)).toEqual([]);
  });
});

it('rejects excessive matches without returning a partial set', () => {
  expect(() => literalMatches('a'.repeat(10001), 'a', true)).toThrow(
    'Narrow your search'
  );
  expect(literalMatches('a'.repeat(10000), 'a', true)).toHaveLength(10000);
});
