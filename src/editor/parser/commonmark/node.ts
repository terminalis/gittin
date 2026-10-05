import NodeWalker from './nodeWalker';

export type BlockNodeType =
  | 'document'
  | 'list'
  | 'blockQuote'
  | 'item'
  | 'heading'
  | 'thematicBreak'
  | 'paragraph'
  | 'codeBlock'
  | 'htmlBlock'
  | 'table'
  | 'tableHead'
  | 'tableBody'
  | 'tableRow'
  | 'tableCell'
  | 'tableDelimRow'
  | 'tableDelimCell'
  | 'refDef';

export type InlineNodeType =
  | 'code'
  | 'text'
  | 'emph'
  | 'strong'
  | 'strike'
  | 'link'
  | 'image'
  | 'htmlInline'
  | 'linebreak'
  | 'softbreak';

export type MdNodeType = BlockNodeType | InlineNodeType;

export type Pos = [number, number];
export type Sourcepos = [Pos, Pos];

export interface ListData {
  type: 'ordered' | 'bullet';
  tight: boolean;
  start: number;
  bulletChar: string;
  delimiter: string;
  markerOffset: number;
  padding: number;
  task: boolean;
  checked: boolean;
}

export interface TableColumn {
  align: 'left' | 'center' | 'right' | null;
}

const containerTypes = new Set<MdNodeType>([
  'document',
  'blockQuote',
  'list',
  'item',
  'paragraph',
  'heading',
  'emph',
  'strong',
  'strike',
  'link',
  'image',
  'table',
  'tableHead',
  'tableBody',
  'tableRow',
  'tableCell',
  'tableDelimRow',
]);

export function isContainer(node: Node) {
  return containerTypes.has(node.type);
}

export class Node {
  type: MdNodeType;
  parent: Node | null = null;
  prev: Node | null = null;
  next: Node | null = null;
  sourcepos?: Sourcepos;

  // only for container node
  firstChild: Node | null = null;
  lastChild: Node | null = null;

  // only for leaf node
  literal: string | null = null;

  constructor(nodeType: MdNodeType, sourcepos?: Sourcepos) {
    this.type = nodeType;
    this.sourcepos = sourcepos;
  }

  unlink() {
    if (this.prev) {
      this.prev.next = this.next;
    } else if (this.parent) {
      this.parent.firstChild = this.next;
    }
    if (this.next) {
      this.next.prev = this.prev;
    } else if (this.parent) {
      this.parent.lastChild = this.prev;
    }
    this.parent = null;
    this.next = null;
    this.prev = null;
  }

  insertAfter(sibling: Node) {
    sibling.unlink();
    sibling.next = this.next;
    if (sibling.next) {
      sibling.next.prev = sibling;
    }
    sibling.prev = this;
    this.next = sibling;
    if (this.parent) {
      sibling.parent = this.parent;
      if (!sibling.next) {
        sibling.parent.lastChild = sibling;
      }
    }
  }

  insertBefore(sibling: Node) {
    sibling.unlink();
    sibling.prev = this.prev;
    if (sibling.prev) {
      sibling.prev.next = sibling;
    }
    sibling.next = this;
    this.prev = sibling;
    sibling.parent = this.parent;
    if (!sibling.prev) {
      sibling.parent!.firstChild = sibling;
    }
  }

  appendChild(child: Node) {
    child.unlink();
    child.parent = this;
    if (this.lastChild) {
      this.lastChild.next = child;
      child.prev = this.lastChild;
      this.lastChild = child;
    } else {
      this.firstChild = child;
      this.lastChild = child;
    }
  }

  walker() {
    return new NodeWalker(this);
  }
}

export class BlockNode extends Node {
  type: BlockNodeType;

  // temporal data (for parsing)
  open = true;
  lineOffsets: number[] | null = null;
  stringContent: string | null = null;
  lastLineBlank = false;
  lastLineChecked = false;

  constructor(nodeType: BlockNodeType, sourcepos?: Sourcepos) {
    super(nodeType, sourcepos);
    this.type = nodeType;
  }
}

export class ListNode extends BlockNode {
  listData: ListData | null = null;
}

export class HeadingNode extends BlockNode {
  level = 0;
  headingType: 'atx' | 'setext' = 'atx';
}

export class CodeBlockNode extends BlockNode {
  isFenced = false;
  fenceChar: string | null = null;
  fenceLength = 0;
  fenceOffset = -1;
  info: string | null = null;
  infoPadding = 0;
}

export class TableNode extends BlockNode {
  columns: TableColumn[] = [];
}

export class TableCellNode extends BlockNode {
  startIdx = 0;
  endIdx = 0;
  ignored = false;
}

export class HtmlBlockNode extends BlockNode {
  htmlBlockType = -1;
}

export class LinkNode extends Node {
  destination: string | null = null;
  title: string | null = null;
  extendedAutolink = false;
  declare lastChild: Node;
}

export class CodeNode extends Node {
  tickCount = 0;
}

export type MdNode = Node;
export type ListItemMdNode = ListNode & { parent: Node; listData: ListData };
export type HeadingMdNode = HeadingNode;
export type TableMdNode = TableNode;
export type LinkMdNode = LinkNode;

const nodeClasses: Partial<Record<MdNodeType, typeof Node>> = {
  heading: HeadingNode,
  list: ListNode,
  item: ListNode,
  link: LinkNode,
  image: LinkNode,
  codeBlock: CodeBlockNode,
  htmlBlock: HtmlBlockNode,
  table: TableNode,
  tableCell: TableCellNode,
  document: BlockNode,
  paragraph: BlockNode,
  blockQuote: BlockNode,
  thematicBreak: BlockNode,
  tableRow: BlockNode,
  tableBody: BlockNode,
  tableHead: BlockNode,
  code: CodeNode,
  refDef: BlockNode,
};

export function createNode(type: 'heading', sourcepos?: Sourcepos): HeadingNode;
export function createNode(type: 'list' | 'item', sourcepos?: Sourcepos): ListNode;
export function createNode(type: 'codeBlock', sourcepos?: Sourcepos): CodeBlockNode;
export function createNode(type: 'htmlBlock', sourcepos?: Sourcepos): HtmlBlockNode;
export function createNode(type: 'link' | 'image', sourcepos?: Sourcepos): LinkNode;
export function createNode(type: 'code', sourcepos?: Sourcepos): CodeNode;
export function createNode(type: 'table', sourcepos?: Sourcepos): TableNode;
export function createNode(type: 'tableCell', sourcepos?: Sourcepos): TableCellNode;
export function createNode(type: BlockNodeType, sourcepos?: Sourcepos): BlockNode;
export function createNode(type: MdNodeType, sourcepos?: Sourcepos): Node;
export function createNode(type: MdNodeType, sourcepos?: Sourcepos) {
  return new (nodeClasses[type] ?? Node)(type, sourcepos);
}

export function isCodeBlock(node: Node): node is CodeBlockNode {
  return node.type === 'codeBlock';
}

export function isHtmlBlock(node: Node): node is HtmlBlockNode {
  return node.type === 'htmlBlock';
}

export function isHeading(node: Node): node is HeadingNode {
  return node.type === 'heading';
}

export function text(s: string, sourcepos?: Sourcepos) {
  const node = createNode('text', sourcepos);
  node.literal = s;
  return node;
}
