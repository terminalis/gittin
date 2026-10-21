import { Node, Sourcepos, createNode, text } from '../node';
import NodeWalker from '../nodeWalker';

const DOMAIN = '(?:[\\w-]+\\.)*[A-Za-z0-9-]+\\.[A-Za-z0-9-]+';
const PATH = '[^<\\s]*[^<?!.,:*_?~\\s]';
// Starts only at a word's start, so a long word isn't scanned again from each of its letters.
const EMAIL = '(?<![\\w.+-])[\\w.+-]+@(?:[\\w-]+\\.)+[\\w-]+';

function trimUnmatchedTrailingParens(source: string) {
  const trailingParen = /\)+$/.exec(source);
  if (trailingParen) {
    let count = 0;
    for (const ch of source) {
      if (ch === '(') {
        if (count < 0) {
          count = 1;
        } else {
          count += 1;
        }
      } else if (ch === ')') {
        count -= 1;
      }
    }

    if (count < 0) {
      const trimCount = Math.min(-count, trailingParen[0].length);
      return source.substring(0, source.length - trimCount);
    }
  }
  return source;
}

function trimTrailingEntity(source: string) {
  return source.replace(/&[A-Za-z0-9]+;$/, '');
}

interface LinkInfo {
  text: string;
  url: string;
  range: [number, number];
}

export function parseEmailLink(source: string) {
  const reEmailLink = new RegExp(EMAIL, 'g');
  const result: LinkInfo[] = [];
  let m;
  while ((m = reEmailLink.exec(source))) {
    const text = m[0];
    if (!/[_-]+$/.test(text)) {
      result.push({
        text,
        range: [m.index, m.index + text.length - 1],
        url: `mailto:${text}`,
      });
    }
  }

  return result;
}

export function parseUrlLink(source: string) {
  // www. starts a link only at the start, after whitespace or after one of * _ ~ (
  const reWwwAutolink = new RegExp(`((?<=^|[\\s*_~(])www\\.|https?://)${DOMAIN}(?:${PATH})?`, 'g');
  const result: LinkInfo[] = [];
  let m;

  while ((m = reWwwAutolink.exec(source))) {
    const text = trimTrailingEntity(trimUnmatchedTrailingParens(m[0]));
    const scheme = m[1] === 'www.' ? 'http://' : '';
    result.push({
      text,
      range: [m.index, m.index + text.length - 1],
      url: `${scheme}${text}`,
    });
  }

  return result;
}

/** The addresses in a text, in order; where two overlap, such as an e-mail address inside a web
 * address, the first one stays. */
function autolinkParser(source: string) {
  let end = -1;
  return [...parseUrlLink(source), ...parseEmailLink(source)]
    .sort((a, b) => a.range[0] - b.range[0])
    .filter(({ range }) => range[0] > end && ((end = range[1]), true));
}

function insideLink(node: Node) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (parent.type === 'link') return true;
  return false;
}

export function convertExtAutoLinks(walker: NodeWalker) {
  let event;
  while ((event = walker.next())) {
    const { entering, node } = event;
    if (entering && node.type === 'text' && !insideLink(node)) {
      const literal = node.literal!;
      const linkInfos = autolinkParser(literal);

      if (!linkInfos || !linkInfos.length) {
        continue;
      }

      let lastIdx = 0;
      const [lineNum, chPos] = node.sourcepos![0];
      // The source column of a literal index: merged text maps it through its pieces, since an
      // entity or escape is longer in the source than in the literal.
      const column = (index: number, isEnd: boolean) => {
        const piece = node.pieces?.filter(({ at }) => at <= index).pop();
        if (!piece) return chPos + index;
        if (!piece.plain) return isEnd ? piece.end : piece.start;
        return piece.start + index - piece.at;
      };
      const sourcepos = (startIdx: number, endIdx: number): Sourcepos => [
        [lineNum, column(startIdx, false)],
        [lineNum, column(endIdx, true)],
      ];
      const newNodes = [];
      for (const { range, url, text: linkText } of linkInfos) {
        if (range[0] > lastIdx) {
          newNodes.push(
            text(literal.substring(lastIdx, range[0]), sourcepos(lastIdx, range[0] - 1))
          );
        }
        const linkNode = createNode('link', sourcepos(...range));
        linkNode.appendChild(text(linkText, sourcepos(...range)));
        linkNode.destination = url;
        linkNode.extendedAutolink = true;
        newNodes.push(linkNode);
        lastIdx = range[1] + 1;
      }
      if (lastIdx < literal.length) {
        newNodes.push(text(literal.substring(lastIdx), sourcepos(lastIdx, literal.length - 1)));
      }

      for (const newNode of newNodes) {
        node.insertBefore(newNode);
      }
      node.unlink();
    }
  }
}
