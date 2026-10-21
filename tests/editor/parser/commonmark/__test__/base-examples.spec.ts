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
});
