// @vitest-environment jsdom
import { renderPreview } from '@/preview';
import { renderPreviewExtras } from '@/preview-extras';
import { defaultDisplay } from '@/display';
async function render(source: string) {
  const host = document.createElement('div');
  const warnings = renderPreview(source, host, defaultDisplay);
  await renderPreviewExtras(host);
  return { host, warnings };
}
it('replaces known emoji shortcodes outside code and keeps unknown ones', async () => {
  const { host } = await render('Hi :smile: :+1: :not-an-emoji: `:smile:`');
  expect(host.querySelector('p')!.textContent).toBe('Hi 😄 👍 :not-an-emoji: :smile:');
});
it('shows maths as source until KaTeX renders it', () => {
  const host = document.createElement('div');
  renderPreview('Inline $x^2$ here\n\n$$\na+b\n$$', host, defaultDisplay);
  expect(host.querySelector('p')!.textContent).toContain('$x^2$');
  expect(host.querySelector('[data-math="display"]')!.textContent).toBe('$$\na+b\n$$');
});
it('renders inline, display and fenced maths with KaTeX and leaves currency and code alone', async () => {
  const { host, warnings } = await render('Inline $x^2$ costs $10 and $20.\n\n$$\n\\frac{a}{b}\n$$\n\n```math\ny=mx\n```\n\n`$code$`');
  expect(host.querySelectorAll('.katex')).toHaveLength(3);
  expect(host.querySelectorAll('.katex-display')).toHaveLength(2);
  expect(host.textContent).toContain('costs $10 and $20.');
  expect(host.querySelector('p > code')!.textContent).toBe('$code$');
  expect(warnings.join(' ')).not.toMatch(/math/);
});
it('shows nested front matter as nested tables, with values as written', async () => {
  const { host } = await render('---\ntitle: Notes\nversion: 1.10\ntags:\n  - draft\n  - web\nauthor:\n  name: Sam\nnote: <b>x</b>\n---\nBody');
  const table = host.querySelector('table.front-matter')!;
  const cells = table.querySelectorAll(':scope > tbody > tr > td');
  expect([...table.querySelectorAll(':scope > thead th')].map(th => th.textContent)).toEqual(['title', 'version', 'tags', 'author', 'note']);
  expect(cells[1].textContent).toBe('1.10');
  expect([...cells[2].querySelectorAll('td')].map(td => td.textContent)).toEqual(['draft', 'web']);
  expect(cells[3].querySelector('th')!.textContent).toBe('name');
  expect(cells[3].querySelector('td')!.textContent).toBe('Sam');
  expect(cells[4].textContent).toBe('<b>x</b>');
  expect(table.querySelector('b')).toBeNull();
  expect(host.querySelector('pre')).toBeNull();
});
it('keeps front matter that does not parse as YAML text', async () => {
  const { host } = await render('---\ntitle: [unclosed\nlist:\n  - a\n---\nBody');
  expect(host.querySelector('table.front-matter')).toBeNull();
  expect(host.querySelector('pre code')!.textContent).toBe('title: [unclosed\nlist:\n  - a');
});
it('keeps front matter that is not keys and values, or uses aliases, as text', async () => {
  for (const yaml of ['- a\n- b', 'base: &b\n  x: 1\ncopy: *b']) {
    const { host } = await render(`---\n${yaml}\n---\nBody`);
    expect(host.querySelector('table.front-matter')).toBeNull();
    expect(host.querySelector('pre code')!.textContent).toBe(yaml);
  }
});
