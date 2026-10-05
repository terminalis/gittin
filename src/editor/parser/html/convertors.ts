import type { HTMLConvertor, HTMLConvertorMap, HTMLToken } from './renderer';
import type {
  HeadingNode, CodeBlockNode, ListNode, LinkNode, TableNode, TableCellNode,
} from '../commonmark/node';
import { escapeXml } from '../commonmark/common';

/** The convertor of a node drawn as one element around its children. */
const element = (tagName: string, outerNewLine = false): HTMLConvertor => (_, { entering }) =>
  ({ type: entering ? 'openTag' : 'closeTag', tagName, outerNewLine });

export const convertors: HTMLConvertorMap = {
  heading(node, { entering }) {
    const tagName = `h${(node as HeadingNode).level}`;
    return { type: entering ? 'openTag' : 'closeTag', tagName, outerNewLine: true };
  },

  text(node) {
    return { type: 'text', content: node.literal! };
  },

  softbreak(_, { options }) {
    return { type: 'html', content: options.softbreak };
  },

  linebreak() {
    return { type: 'html', content: '<br />\n' };
  },

  emph: element('em'),
  strong: element('strong'),
  strike: element('del'),

  paragraph(node, { entering }) {
    const grandparent = node.parent?.parent;
    if (grandparent?.type === 'list' && (grandparent as ListNode).listData!.tight) return null;
    return { type: entering ? 'openTag' : 'closeTag', tagName: 'p', outerNewLine: true };
  },

  thematicBreak() {
    return { type: 'openTag', tagName: 'hr', outerNewLine: true, selfClose: true };
  },

  blockQuote(_, { entering }) {
    const type = entering ? 'openTag' : 'closeTag';
    return { type, tagName: 'blockquote', outerNewLine: true, innerNewLine: true };
  },

  list(node, { entering }) {
    const { type, start } = (node as ListNode).listData!;
    const tagName = type === 'bullet' ? 'ul' : 'ol';
    const attributes: Record<string, string> = {};
    if (tagName === 'ol' && start !== null && start !== 1) {
      attributes.start = start.toString();
    }
    return { type: entering ? 'openTag' : 'closeTag', tagName, attributes, outerNewLine: true };
  },

  item(node, { entering }) {
    if (!entering) return { type: 'closeTag', tagName: 'li', outerNewLine: true };
    const { checked, task } = (node as ListNode).listData!;
    const itemTag: HTMLToken = { type: 'openTag', tagName: 'li', outerNewLine: true };
    if (!task) return itemTag;
    // A read-only checkbox that reads as [x] or [ ] wherever scripts and form controls are stripped
    return [
      itemTag,
      {
        type: 'openTag',
        tagName: 'span',
        attributes: {
          role: 'checkbox',
          'aria-checked': String(checked),
          'aria-readonly': 'true',
          'aria-label': checked ? 'Completed' : 'Not completed',
        },
      },
      { type: 'text', content: checked ? '[x]' : '[ ]' },
      { type: 'closeTag', tagName: 'span' },
      { type: 'text', content: ' ' },
    ];
  },

  htmlInline(node) {
    return { type: 'html', content: node.literal! };
  },

  htmlBlock(node) {
    return { type: 'html', content: node.literal!, outerNewLine: true };
  },

  code(node) {
    return [
      { type: 'openTag', tagName: 'code' },
      { type: 'text', content: node.literal! },
      { type: 'closeTag', tagName: 'code' },
    ];
  },

  codeBlock(node) {
    const infoStr = (node as CodeBlockNode).info;
    const infoWords = infoStr ? infoStr.split(/\s+/) : [];
    const codeClassNames = [];
    if (infoWords.length > 0 && infoWords[0].length > 0) {
      codeClassNames.push(`language-${escapeXml(infoWords[0])}`);
    }

    return [
      { type: 'openTag', tagName: 'pre', outerNewLine: true },
      { type: 'openTag', tagName: 'code', classNames: codeClassNames },
      { type: 'text', content: node.literal! },
      { type: 'closeTag', tagName: 'code' },
      { type: 'closeTag', tagName: 'pre', outerNewLine: true },
    ];
  },

  link(node, { entering }) {
    if (!entering) return { type: 'closeTag', tagName: 'a' };
    const { title, destination } = node as LinkNode;
    const attributes = { href: escapeXml(destination!), ...(title && { title: escapeXml(title) }) };
    return { type: 'openTag', tagName: 'a', attributes };
  },

  image(node, { getChildrenText, skipChildren }) {
    const { title, destination } = node as LinkNode;

    skipChildren();

    return {
      type: 'openTag',
      tagName: 'img',
      selfClose: true,
      attributes: {
        src: escapeXml(destination!),
        alt: escapeXml(getChildrenText(node)),
        ...(title && { title: escapeXml(title) }),
      },
    };
  },

  table: element('table', true),
  tableHead: element('thead', true),
  tableBody: element('tbody', true),

  tableRow(node, { entering }) {
    if (entering) return { type: 'openTag', tagName: 'tr', outerNewLine: true };
    const result: HTMLToken[] = [];
    if (node.lastChild) {
      // Rows shorter than the header get empty cells
      const columnLen = (node.parent!.parent as TableNode).columns.length;
      for (let i = (node.lastChild as TableCellNode).endIdx + 1; i < columnLen; i += 1) {
        result.push(
          { type: 'openTag', tagName: 'td', outerNewLine: true },
          { type: 'closeTag', tagName: 'td', outerNewLine: true }
        );
      }
    }
    result.push({ type: 'closeTag', tagName: 'tr', outerNewLine: true });
    return result;
  },

  tableCell(node, { entering }) {
    if ((node as TableCellNode).ignored) return { type: 'text', content: '' };
    const tablePart = node.parent!.parent!;
    const tagName = tablePart.type === 'tableHead' ? 'th' : 'td';
    const table = tablePart.parent as TableNode;
    const columnInfo = table.columns[(node as TableCellNode).startIdx];
    const attributes = columnInfo?.align ? { align: columnInfo.align } : null;
    return entering
      ? { type: 'openTag', tagName, outerNewLine: true, ...(attributes && { attributes }) }
      : { type: 'closeTag', tagName, outerNewLine: true };
  },
};
