// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pastedMarkdown as pasted } from '@/pasted-markdown';

describe('pasted Markdown', () => {
  it('links selected text to a pasted URL, but not a selected URL or several lines', () => {
    expect(pasted('see docs', 4, 8, '', 'https://a.test/docs\n')).toBe('[docs](https://a.test/docs)');
    expect(pasted('see https://b.test', 4, 18, '', 'https://a.test')).toBeNull();
    expect(pasted('a\nb', 0, 3, '', 'https://a.test')).toBeNull();
  });
  it('makes a pasted image URL an image when nothing is selected', () => {
    expect(pasted('', 0, 0, '', 'https://a.test/logo.png?v=2')).toBe('![](https://a.test/logo.png?v=2)');
    expect(pasted('', 0, 0, '', 'https://a.test/page')).toBeNull();
  });
  it('pastes plain text in code, front matter, link destinations and HTML tags', () => {
    for (const [source, at] of [['`x`', 1], ['```\nx\n```', 5], ['---\na: b\n---\n', 4], ['[a]()', 4], ['<img src="">', 10]] as const)
      expect(pasted(source, at, at, '<a href="https://a.test">x</a>', 'https://a.test/logo.png'), source).toBeNull();
  });
  it('writes the links in pasted HTML into its plain text, where their text appears', () => {
    const html = '<p>docs: read the <a href="https://a.test/docs">docs</a> at <a href="https://a.test/">https://a.test/</a>.</p>';
    expect(pasted('', 0, 0, html, 'docs: read the docs at https://a.test/.'))
      .toBe('docs: read the [docs](https://a.test/docs) at https://a.test/.');
    expect(pasted('', 0, 0, '<a href="https://a.test/x y">[1]</a>', '[1]')).toBe('[\\[1\\]](<https://a.test/x y>)');
    expect(pasted('', 0, 0, '<b>bold</b>', 'bold')).toBeNull();
  });
  it('makes a paste that is only a table a Markdown table, its first row the header', () => {
    const html = '<style>td { color: red }</style><table><tr><td>a</td><td>b|c</td><td>d</td></tr>'
      + '<tr><td><a href="https://x.test">x</a><br>y</td><td></td></tr></table>';
    expect(pasted('', 0, 0, html, 'a\tb|c\td\nx y\t'))
      .toBe('| a | b\\|c | d |\n| --- | --- | --- |\n| [x](https://x.test) y |  |  |');
    expect(pasted('', 0, 0, '<p>Totals</p><table><tr><td><a href="https://x.test">x</a></td></tr></table>', 'Totals\nx'))
      .toBe('Totals\n[x](https://x.test)');
  });
});
