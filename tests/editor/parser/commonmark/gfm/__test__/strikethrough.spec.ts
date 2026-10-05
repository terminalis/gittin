import { Parser } from '@/parser/commonmark/blocks';
import { Renderer } from '@/parser/html/renderer';

const reader = new Parser();
const renderer = new Renderer();

describe('strikethrough', () => {
  // https://github.github.com/gfm/#example-491
  it('GFM Example 491', () => {
    const root = reader.parse('~~Hi~~ Hello, world!');
    const html = renderer.render(root);

    expect(html).toBe('<p><del>Hi</del> Hello, world!</p>\n');
  });

  it('GFM Example 492', () => {
    const input = ['This ~~has a', '', 'new paragraph~~.'].join('\n');
    const output = ['<p>This ~~has a</p>', '<p>new paragraph~~.</p>'].join('\n');

    const root = reader.parse(input);
    const html = renderer.render(root);

    expect(html).toEqual(`${output}\n`);
  });

  it('basic example', () => {
    const root = reader.parse('Hello ~~World~~');
    const para = root.firstChild!;
    const text = para.firstChild!;
    const strike = text.next!;
    const strikeText = strike.firstChild!;

    expect(text.literal).toBe('Hello ');
    expect(strikeText.literal).toBe('World');
    expect(strike.sourcepos).toEqual([
      [1, 7],
      [1, 15],
    ]);
    expect(strikeText.sourcepos).toEqual([
      [1, 9],
      [1, 13],
    ]);

    const html = renderer.render(root);

    expect(html).toBe('<p>Hello <del>World</del></p>\n');
  });

  it('strikes through between single tildes', () => {
    const root = reader.parse('~Hi~ and ~~there~~');
    const strike = root.firstChild!.firstChild!;

    expect(strike.sourcepos).toEqual([
      [1, 1],
      [1, 4],
    ]);
    expect(strike.firstChild!.sourcepos).toEqual([
      [1, 2],
      [1, 3],
    ]);
    expect(renderer.render(root)).toBe('<p><del>Hi</del> and <del>there</del></p>\n');
  });

  it('keeps runs of three or more tildes literal', () => {
    for (const input of [
      'This will ~~~not~~~ strike.',
      '~~Hello~~~~~~World~~~',
      'Hello~~~~~~World~~~~~',
    ]) {
      expect(renderer.render(reader.parse(input))).toBe(`<p>${input}</p>\n`);
    }
  });

  it('keeps tilde runs of different lengths literal', () => {
    for (const input of ['~~Hi~ there', '~Hi~~ there', '~~a~ b~~']) {
      expect(renderer.render(reader.parse(input))).toBe(`<p>${input}</p>\n`);
    }
  });

  it('pairs tilde runs inside words as github.com does', () => {
    const pairs = [
      ['~~foo~bar~~', '<del>foo~bar</del>'],
      ['~foo~~bar~', '<del>foo~~bar</del>'],
      ['~~approx~5~~', '<del>approx~5</del>'],
      ['~~a~b~', '~~a<del>b</del>'],
      ['~a~~b~~', '~a<del>b</del>'],
    ];

    for (const [input, html] of pairs) {
      expect(renderer.render(reader.parse(input))).toBe(`<p>${html}</p>\n`);
    }
  });

  it('nested delimiters (with emphasis)', () => {
    const root = reader.parse('~~*Hello*~~**~~World~~**');
    const para = root.firstChild!;
    const strike1 = para.firstChild!;
    const emph = strike1.firstChild!;
    const strong = strike1.next!;
    const strike2 = strong.firstChild!;

    expect(strike1.sourcepos).toEqual([
      [1, 1],
      [1, 11],
    ]);
    expect(emph.sourcepos).toEqual([
      [1, 3],
      [1, 9],
    ]);
    expect(strong.sourcepos).toEqual([
      [1, 12],
      [1, 24],
    ]);
    expect(strike2.sourcepos).toEqual([
      [1, 14],
      [1, 22],
    ]);

    const html = renderer.render(root);

    expect(html).toBe('<p><del><em>Hello</em></del><strong><del>World</del></strong></p>\n');
  });
});
