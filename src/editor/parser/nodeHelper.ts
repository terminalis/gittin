import type { Node, Pos } from './commonmark/node';

/** Below, at or above zero as p1 comes before, at or after p2. */
function comparePos(p1: Pos, p2: Pos) {
  return p1[0] - p2[0] || p1[1] - p2[1];
}

/** The innermost node under parent whose source range holds pos, or null when parent's doesn't. */
export function findNodeAtPosition(parent: Node, pos: Pos) {
  let node: Node | null = parent;
  let prev: Node | null = null;
  while (node) {
    const [start, end] = node.sourcepos!;
    if (comparePos(end, pos) < 0) {
      if (!node.next) return prev;
      node = node.next;
    } else if (comparePos(start, pos) > 0) return prev;
    else if (!node.firstChild) return node;
    else {
      prev = node;
      node = node.firstChild;
    }
  }
  return null;
}
