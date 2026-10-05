import { Node, BlockNode } from '@/parser/commonmark/node';

export function pos(line1: number, col1: number, line2: number, col2: number) {
  return [
    [line1, col1],
    [line2, col2],
  ];
}

export function convertToArrayTree(root: BlockNode, attrs: (keyof BlockNode)[]) {
  function recur(node: Node) {
    const newNode: any = {};
    attrs.forEach((attr) => {
      const attrVal = node[attr as keyof Node];
      if (attrVal !== undefined && attrVal !== null) {
        newNode[attr] = attrVal;
      }
    });

    let child = node.firstChild;
    if (child) {
      newNode.children = [];
    }
    while (child) {
      newNode.children.push(recur(child));
      child = child.next;
    }
    return newNode;
  }

  return recur(root);
}
