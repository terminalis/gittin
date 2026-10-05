// @vitest-environment jsdom
import { writeEligibility } from '@/supported-syntax';
import { mount } from './mount';
it.each([
  '+++\ntitle = "one"\n+++\nbody',
  '<script>alert(1)</script>',
  '[^note]: text',
  '[[Wiki]]',
  ':::note\nbody\n:::',
  '\\(x\\)',
  '\\[x\\]',
  '<table><tr><td colspan="2">x</td></tr></table>',
])('restricts %s', (source) => {
  expect(writeEligibility(source).editable).toBe(false);
});
it.each([
  '---\ntitle: one\n---\nbody',
  '$$\nx+y\n$$',
  '$x+y$',
  '$x$',
  '$2+2$',
  '$2x$',
  '$10$',
  '$$custom\nbody\n$$',
  'Costs $10 and $20.',
  'Prices: $5.00, $7.50 and $1,000.',
  'Spend $2 on lunch and $3 on coffee.',
  '`$2+2$ $2x$`',
  '```math\n$2+2$\n$2x$\n```',
  '`[[wiki]] [^n] $x$ <b>`',
  '```md\n---\n[[wiki]]\n[^n]: footnote\n$x$\n:::x\n<script>x</script>\n```',
  '[link][a]\n\n[a]: https://example.com',
  'www.example.com\n\n![image](missing.png)',
])('admits %s', (source) => {
  expect(writeEligibility(source).editable).toBe(true);
});
it('Preview source fallback visibly escapes raw regions and returns to Edit', () => {
  const source = '\uFEFF# Title\r\n\r\n<script>window.bad=1</script>\r\n';
  const { session, controller: c, host } = mount(source, 'preview');
  expect(c.getMode()).toBe('preview');
  expect(host.querySelector('[data-readable]')?.textContent).toContain('<script>');
  expect(host.querySelector('script')).toBeNull();
  expect(c.getPreviewDescription()).toContain('Unsupported HTML is shown as source');
  expect(c.execute('bold')).toBe(false);
  c.setMode('markdown');
  expect(c.getMode()).toBe('markdown');
  expect(session.current).toEqual({ source, revision: 0 });
});
