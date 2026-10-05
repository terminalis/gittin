// @vitest-environment jsdom
import { renderPreview } from '@/preview';
import { renderPreviewExtras } from '@/preview-extras';
import { defaultDisplay, sourceForDisplay } from '@/display';
it('numbers footnotes by reference order, preserves escaped/code literals and avoids heading ID collisions', () => {
  const host = document.createElement('div');
  renderPreview('# Footnote 1\n\n# Footnote ref 1 1\n\nEscaped \\[^a], `[^a]`, actual [^b] then [^a].\n\n[^a]: First definition\n[^b]: Second definition', host, defaultDisplay);
  const refs = host.querySelectorAll('a[aria-label^="Footnote"]');
  expect(refs).toHaveLength(2);
  expect(refs[0].textContent).toBe('[1]');
  const target = refs[0].getAttribute('href')!.slice(1);
  expect(target).not.toBe('footnote-1');
  expect(host.querySelector('#' + target)?.textContent).toContain('Second definition');
  const ids = [...host.querySelectorAll('[id]')].map(node => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(host.querySelector('[data-literal-footnote]')?.textContent).toBe('[^a]');
  expect(host.querySelector('code')?.textContent).toBe('[^a]');
});
it('coarse display hides only recognized comments without changing original data', () => {
  const source = 'const url="https://x/*literal*/"; /*secret*/\n';
  expect(sourceForDisplay(source, 'javascript', false)).toBe('const url="https://x/*literal*/"; \n');
  expect(sourceForDisplay(source, 'javascript', true)).toBe(source);
});

it('keeps accepted image dimensions through 10000 and removes larger dimensions', () => {
  const host = document.createElement('div');
  renderPreview('<img src="https://example.test/image.png" width="10000" height="10001">', host, defaultDisplay);
  const image = host.querySelector('img')!;
  expect(image.getAttribute('width')).toBe('10000');
  expect(image.hasAttribute('height')).toBe(false);
});

for (const marker of ['\\(x\\)', '[^private-note]', '\n::: private-directive\n']) {
  it(`hides comment content in fallback ranges containing ${JSON.stringify(marker)}`, () => {
    const source = `Before\r\n\r\n<!-- secret ${marker} -->\r\n\r\nAfter\r\n\r\n\\(visible\\)\r\n\r\n` +
      '`<!-- literal $code$ -->`\r\n\r\n[URL](https://example.test/<!--literal-->)';
    const host = document.createElement('div');
    renderPreview(source, host, { ...defaultDisplay, showComments: false });
    expect(host.textContent).not.toContain('secret');
    expect(host.textContent).toContain('Before');
    expect(host.textContent).toContain('After');
    expect(host.textContent).toContain('\\(visible\\)');
    expect(host.textContent).toContain('<!-- literal $code$ -->');
    expect(host.querySelector('a')?.getAttribute('href')).toContain('literal');
    renderPreview(source, host, defaultDisplay);
    expect(host.textContent).toContain('secret');
    expect(host.textContent).toContain(marker.trim());
  });
}

it('preserves unsupported source around a comment within one merged fallback range', () => {
  const source = '\\[ before\n<!-- secret [^n] -->\nafter \\]';
  const host = document.createElement('div');
  renderPreview(source, host, { ...defaultDisplay, showComments: false });
  expect(host.textContent).not.toContain('secret');
  expect(host.textContent).toContain('before');
  expect(host.textContent).toContain('after');
  expect(host.textContent).toContain('\\[');
});

import { headingAnchors } from '@/heading-anchors';
it('shows simple YAML front matter as a GitHub-style table and keeps headings aligned', async () => {
  const host = document.createElement('div');
  const warnings = renderPreview('---\ntitle: "Launch notes"\ndraft: false\n---\n# Intro\n', host, defaultDisplay);
  await renderPreviewExtras(host);
  const table = host.querySelector('table.front-matter')!;
  expect([...table.querySelectorAll('th')].map(th => th.textContent)).toEqual(['title', 'draft']);
  expect([...table.querySelectorAll('td')].map(td => td.textContent)).toEqual(['Launch notes', 'false']);
  expect(host.querySelector('hr')).toBeNull();
  expect(host.querySelector('h1')!.id).toBe('intro');
  expect(warnings).toEqual([]);
  expect(headingAnchors('---\ntitle: x\n---\n# Intro').map(h => h.text)).toEqual(['Intro']);
});
it('keeps headings after a leading rule with no closing rule', () => {
  expect(headingAnchors('---\n# Intro\n\nText').map(h => h.text)).toEqual(['Intro']);
});
it('does not take a reference definition above a === line for a heading', () => {
  const source = '[a]: /x\n===\n\n# Real';
  expect(headingAnchors(source).map(h => h.text)).toEqual(['Real']);
  const host = document.createElement('div');
  renderPreview(source, host, defaultDisplay);
  expect([...host.querySelectorAll('h1,h2')].map(h => h.id)).toEqual(['real']);
});
it('reads double dollar signs as text', () => {
  const host = document.createElement('div');
  renderPreview('$$word\n\n# Rest', host, defaultDisplay);
  expect(host.querySelector('h1')!.textContent).toBe('Rest');
  expect(renderPreview('costs $$5$$ total', host, defaultDisplay)).toEqual([]);
  expect(host.textContent).toContain('costs $$5$$ total');
});
it('keeps other front matter readable as YAML', () => {
  const host = document.createElement('div');
  renderPreview('---\ntags:\n  - a\n  - b\n---\nBody', host, defaultDisplay);
  expect(host.querySelector('table.front-matter')).toBeNull();
  expect(host.querySelector('pre code')!.textContent).toBe('tags:\n  - a\n  - b');
  expect(host.textContent).toContain('Body');
});
it('notes embedded content in place of its markup', () => {
  const host = document.createElement('div');
  const warnings = renderPreview('<iframe src="https://example.invalid/frame"></iframe>\n\nA clip <embed src="https://example.invalid/clip"> and <object data="https://example.invalid/movie">fallback</object> here', host, defaultDisplay);
  const note = "Embedded content isn't shown in Preview.";
  expect([...host.querySelectorAll('.preview-embed-note')].map(el => el.textContent)).toEqual([note, note, note]);
  expect(host.querySelector('p.preview-embed-note')).not.toBeNull();
  expect(host.querySelectorAll('p > span.preview-embed-note')).toHaveLength(2);
  expect(host.textContent).toContain('fallback');
  expect(host.textContent).toContain('Preview. fallback');
  expect(host.textContent).not.toContain('example.invalid');
  expect(warnings.join(' ')).not.toMatch(/Unsupported HTML/);
});
it('keeps a block that mixes an embed with other HTML or text as source', () => {
  for (const source of ['<div>\n<p>Watch the demo</p>\n<iframe src="https://example.invalid/frame"></iframe>\n</div>', '<iframe src="https://example.invalid/frame"></iframe>\nWatch the demo']) {
    const host = document.createElement('div');
    const warnings = renderPreview(source, host, defaultDisplay);
    expect(host.querySelector('.preview-embed-note')).toBeNull();
    expect(host.textContent).toContain('Watch the demo');
    expect(host.querySelector('pre.unsupported-source')!.textContent).toContain('Watch the demo');
    expect(warnings.join(' ')).toMatch(/Unsupported HTML/);
  }
});
