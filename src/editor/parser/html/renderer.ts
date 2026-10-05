import { MdNodeType, Node } from '../commonmark/node';
import { escapeXml } from '../commonmark/common';
import { convertors } from './convertors';

export type HTMLConvertor = (node: Node, context: Context) => HTMLToken | HTMLToken[] | null;

export type HTMLConvertorMap = Partial<Record<MdNodeType, HTMLConvertor>>;

interface RendererOptions {
  // Raw HTML written for a soft line break
  softbreak: string;
}

interface Context {
  entering: boolean;
  options: RendererOptions;
  getChildrenText: (node: Node) => string;
  skipChildren: () => void;
}

interface TagToken {
  tagName: string;
  outerNewLine?: boolean;
  innerNewLine?: boolean;
}

interface OpenTagToken extends TagToken {
  type: 'openTag';
  classNames?: string[];
  attributes?: Record<string, any>;
  selfClose?: boolean;
}

interface CloseTagToken extends TagToken {
  type: 'closeTag';
}

interface TextToken {
  type: 'text';
  content: string;
}

interface RawHTMLToken {
  type: 'html';
  content: string;
  outerNewLine?: boolean;
}

export type HTMLToken = OpenTagToken | CloseTagToken | TextToken | RawHTMLToken;

const defaultOptions: RendererOptions = { softbreak: '\n' };

function getChildrenText(node: Node) {
  const buffer: string[] = [];
  const walker = node.walker();
  let event: ReturnType<typeof walker.next> = null;

  while ((event = walker.next())) {
    const { node } = event;
    if (node.type === 'text' || node.type === 'code') {
      buffer.push(node.literal!);
    }
  }
  return buffer.join('');
}

export class Renderer {
  private options: RendererOptions;

  private buffer: string[] = [];

  constructor(options?: Partial<RendererOptions>) {
    this.options = { ...defaultOptions, ...options };
  }

  render(rootNode: Node): string {
    this.buffer = [];

    const walker = rootNode.walker();
    let event: ReturnType<typeof walker.next> = null;

    while ((event = walker.next())) {
      const { node, entering } = event;
      const convertor = convertors[node.type];
      if (!convertor) {
        continue;
      }

      let skipped = false;
      const context: Context = {
        entering,
        options: this.options,
        getChildrenText,
        skipChildren: () => {
          skipped = true;
        },
      };

      const converted = convertor(node, context);
      if (converted) {
        for (const htmlNode of Array.isArray(converted) ? converted : [converted]) {
          this.renderHTMLNode(htmlNode);
        }

        if (skipped) {
          walker.resumeAt(node, false);
          walker.next();
        }
      }
    }
    this.addNewLine();

    return this.buffer.join('');
  }

  renderHTMLNode(node: HTMLToken) {
    switch (node.type) {
      case 'openTag':
      case 'closeTag':
        this.renderElementNode(node);
        break;
      case 'text':
        this.renderTextNode(node);
        break;
      case 'html':
        this.renderRawHtmlNode(node);
        break;
      default:
      // no-default-case
    }
  }

  private generateOpenTagString(node: OpenTagToken) {
    const { tagName, classNames, attributes } = node;

    this.buffer.push(`<${tagName}`);

    if (classNames && classNames.length > 0) {
      this.buffer.push(` class="${classNames.join(' ')}"`);
    }

    if (attributes) {
      Object.keys(attributes).forEach((attrName) => {
        const attrValue = attributes[attrName];
        this.buffer.push(` ${attrName}="${attrValue}"`);
      });
    }

    if (node.selfClose) {
      this.buffer.push(' /');
    }
    this.buffer.push('>');
  }

  private generateCloseTagString({ tagName }: CloseTagToken) {
    this.buffer.push(`</${tagName}>`);
  }

  private addNewLine() {
    if (this.buffer.length && this.buffer.at(-1)!.at(-1) !== '\n') {
      this.buffer.push('\n');
    }
  }

  private addOuterNewLine(node: TagToken | RawHTMLToken) {
    if (node.outerNewLine) {
      this.addNewLine();
    }
  }

  private addInnerNewLine(node: TagToken) {
    if (node.innerNewLine) {
      this.addNewLine();
    }
  }

  private renderTextNode(node: TextToken) {
    this.buffer.push(escapeXml(node.content));
  }

  private renderRawHtmlNode(node: RawHTMLToken) {
    this.addOuterNewLine(node);
    this.buffer.push(node.content);
    this.addOuterNewLine(node);
  }

  private renderElementNode(node: OpenTagToken | CloseTagToken) {
    if (node.type === 'openTag') {
      this.addOuterNewLine(node);
      this.generateOpenTagString(node);
      if (node.selfClose) {
        this.addOuterNewLine(node);
      } else {
        this.addInnerNewLine(node);
      }
    } else {
      this.addInnerNewLine(node);
      this.generateCloseTagString(node);
      this.addOuterNewLine(node);
    }
  }
}
