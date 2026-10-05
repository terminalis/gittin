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
