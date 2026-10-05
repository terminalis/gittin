import type { Mode } from '../documents/types';
export interface FindSnapshot {
  id: string;
  revision: number;
  mode: Mode;
  text: string;
  starts: number[];
  ends: number[];
  editable: boolean;
  displayEpoch?: number;
}
export interface Match {
  from: number;
  to: number;
}
const MAX_FIND_MATCHES = 10000;
export const matchLimitMessage =
  'More than 10,000 matches. Narrow your search. No replacements were made.';
function wholeWordMatch(text: string, from: number, to: number) {
  const word = /[\p{L}\p{N}\p{M}_]/u;
  const before = Array.from(text.slice(Math.max(0, from - 2), from)).at(-1) ?? '';
  return !word.test(before) && !word.test(Array.from(text.slice(to, to + 2))[0] ?? '');
}
/** Matches of a global expression, whole words only if asked. Past the limit it throws. */
export function expressionMatches(text: string, expression: RegExp, wholeWord: boolean): Match[] {
  const matches: Match[] = [];
  for (const m of text.matchAll(expression)) {
    const from = m.index!, to = from + m[0].length;
    if (wholeWord && !wholeWordMatch(text, from, to)) continue;
    if (matches.length === MAX_FIND_MATCHES) throw Error(matchLimitMessage);
    matches.push({ from, to });
  }
  return matches;
}
export function literalMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord = false
): Match[] {
  if (!query) return [];
  // Escaping into a literal regex preserves offsets under Unicode case folding.
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expressionMatches(text, new RegExp(escaped, caseSensitive ? 'g' : 'gi'), wholeWord);
}
export class FindRequests {
  private generation = 0;
  private cancel?: () => void;
  invalidate() {
    this.generation++;
    this.cancel?.();
    this.cancel = undefined;
  }
  async search(
    snapshot: FindSnapshot,
    query: string,
    caseSensitive: boolean,
    regex: boolean,
    wholeWord = false
  ): Promise<Match[] | null> {
    this.invalidate();
    const generation = this.generation;
    if (!query) return [];
    if (!regex) return literalMatches(snapshot.text, query, caseSensitive, wholeWord);
    if (snapshot.mode !== 'markdown')
      throw Error('Regular expressions search Markdown source only.');
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./find-worker.ts', import.meta.url), {
        type: 'module',
      });
      const done = () => {
        clearTimeout(timer);
        worker.terminate();
        if (this.generation === generation) this.cancel = undefined;
      };
      const timer = setTimeout(() => {
        done();
        reject(
          Error(
            'Search took longer than one second. Simplify the regular expression. Your document is unchanged.'
          )
        );
      }, 1000);
      this.cancel = () => {
        done();
        resolve(null);
      };
      worker.onmessage = ({ data }) => {
        done();
        if (this.generation !== generation) resolve(null);
        else if (data.error) reject(Error(data.error));
        else resolve(data.matches);
      };
      worker.onerror = () => {
        done();
        reject(Error('Search could not complete. Your document is unchanged.'));
      };
      worker.postMessage({ text: snapshot.text, query, caseSensitive, wholeWord });
    });
  }
}
