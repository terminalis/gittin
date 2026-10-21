import { Parser } from '@/parser/commonmark/blocks';
import { Renderer } from '@/parser/html/renderer';
import specs from './base-examples.json';

const reader = new Parser();
const renderer = new Renderer();

specs.forEach((spec) => {
  const { example, section, markdown, html } = spec;

  it(`Example ${example} (${section})`, () => {
    const parsed = reader.parse(markdown);
    const result = renderer.render(parsed);

    expect(result).toBe(html);
  });
});

it('collapses every whitespace run in a reference label', () => {
  const result = renderer.render(reader.parse('[a b  c]\n\n[a b c]: /u'));

  expect(result).toBe('<p><a href="/u">a b  c</a></p>\n');
});

describe('renders as GitHub does', () => {
  const render = (markdown: string) => renderer.render(reader.parse(markdown));
  it('closes a code fence followed by a tab', () => {
    expect(render('```\ncode\n```\t\n\n# After')).toBe('<pre><code>code\n</code></pre>\n<h1>After</h1>\n');
  });
  it('decodes an entity only with its semicolon', () => {
    expect(render('Use &notx; here')).toBe('<p>Use &amp;notx; here</p>\n');
    expect(render('&copyright;')).toBe('<p>&amp;copyright;</p>\n');
    expect(render('[a](/x "&notx;")')).toBe('<p><a href="/x" title="&amp;notx;">a</a></p>\n');
  });
  it('keeps the line under a paragraph of definitions alone as text', () => {
    expect(render('[foo]: /url\n---')).toBe('<p>---</p>\n');
    expect(render('[foo]: /url\n===')).toBe('<p>===</p>\n');
  });
  it('gives a line break in alt text a space', () => {
    expect(render('![foo\nbar](/url)')).toBe('<p><img src="/url" alt="foo bar" /></p>\n');
  });
  it('reads a processing instruction across lines as inline HTML', () => {
    expect(render('a <?x\ny?> b')).toBe('<p>a <?x\ny?> b</p>\n');
  });
});

describe('parses text built to be slow quickly', () => {
  // Gittin parses with GitHub's extended autolinks on, as Preview and Edit do.
  const gfm = new Parser({ extendedAutolinks: true });
  const render = (markdown: string) => renderer.render(gfm.parse(markdown));
  const time = (markdown: string) => {
    const start = performance.now();
    gfm.parse(markdown);
    return performance.now() - start;
  };
  it('stops a link destination nesting more than 32 brackets, as cmark does', () => {
    const nested = (depth: number) => render(`[a](${'('.repeat(depth)}b${')'.repeat(depth)})`);
    expect(nested(32)).toContain('<a href=');
    expect(nested(33)).not.toContain('<a href=');
    expect(time('[a](b'.repeat(10000))).toBeLessThan(1000);
  });
  it('finds an e-mail address only from the start of a word', () => {
    expect(time('a'.repeat(80000))).toBeLessThan(1000);
    expect(render('x.y+z@example.com')).toContain('href="mailto:x.y+z@example.com"');
  });
});
