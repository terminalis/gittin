import { Parser } from '@/parser/commonmark/blocks';
import { Renderer } from '@/parser/html/renderer';

const parser = new Parser();

describe('softbreak options', () => {
  it('softbreak option value should be used as a raw HTML string', () => {
    const renderer = new Renderer({
      softbreak: '\n<br />\n',
    });
    const html = renderer.render(parser.parse('Hello\nWorld'));

    expect(html).toBe('<p>Hello\n<br />\nWorld</p>\n');
  });
});
