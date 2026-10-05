// @vitest-environment jsdom
import { Parser, Renderer } from '@/parser';
import { mount } from './mount';
import { writeEligibility } from '@/supported-syntax';
function rendered(source: string) {
  const el = document.createElement('div');
  el.innerHTML = new Renderer().render(new Parser().parse(source));
  return el;
}
const fixtures = [
  ['two-space hard break', 'hello  \nworld', 'br', ''],
  ['backslash hard break', 'hello\\\nworld', 'br', ''],
  ['nested hard break', '**hello  \nworld**', 'strong', 'helloworld'],
  ['nested soft break', '**hello\nworld**', 'strong', 'hello world'],
  ['emphasized linked soft break', '[*hello\nworld*](https://example.test)', 'a', 'hello world'],
  ['image description/title', '![hello *world* and `code`](https://example.test/img.png "Caption")', 'img', ''],
  ['link closing delimiter', '[go](<https://example.test/a)b>)', 'a', 'go'],
  ['link opening delimiter', '[go](<https://example.test/a(b>)', 'a', 'go'],
  ['image closing delimiter', '![go](<https://example.test/a)b>)', 'img', ''],
  ['image opening delimiter', '![go](<https://example.test/a(b>)', 'img', ''],
  ['code boundary spaces', '`  a  `', 'code', ' a '],
  ['code all spaces', '`   `', 'code', '   '],
  ['code boundary backticks', '`` `a` ``', 'code', '`a`'],
  ['code mixed spaces/backticks', '``  `a`  ``', 'code', ' `a` '],
] as const;
it.each(fixtures)('%s survives Edit changes, read-only Preview roundtrip and exact undo', (name, input, selector, text) => {
  const original = input + '\n\nnext', t = mount(original, 'preview');
  expect(t.controller.isEditable()).toBe(false);
  t.controller.setMode('markdown');
  const end = t.markdown.view.state.doc.content.size - 1;
  t.markdown.view.dispatch(t.markdown.view.state.tr.insertText('!', end));
  t.controller.setMode('preview');
  expect(t.session.current.source).toMatch(/next!$/);
  const el = rendered(t.session.current.source), node = el.querySelector(selector)!;
  expect(node).not.toBeNull();
  expect(name.includes('hard break') ? node.textContent?.replace(/\n/g, '')
    : name.includes('soft break') ? node.textContent?.replace(/\n/g, ' ') : node.textContent).toBe(text);
  if (name.includes('hard break')) expect(el.querySelector('br')).not.toBeNull();
  if (input.includes('hello *world*')) {
    expect(t.host.querySelector('.ww-mode img[src]')?.getAttribute('alt')).toBe('hello world and code');
    expect(node.getAttribute('title')).toBe('Caption');
    expect(t.host.querySelector('.ww-mode img[src]')?.getAttribute('title')).toBe('Caption');
  }
  if (input.includes('a)b')) expect(node.getAttribute(selector === 'img' ? 'src' : 'href')).toBe('https://example.test/a)b');
  if (input.includes('a(b')) expect(node.getAttribute(selector === 'img' ? 'src' : 'href')).toBe('https://example.test/a(b');
  t.controller.setMode('markdown'); t.controller.setMode('preview');
  expect(t.controller.isEditable()).toBe(false);
  const roundtrip = t.host.querySelector('[data-readable]')!.innerHTML;
  const again = document.createElement('div'); again.innerHTML = roundtrip;
  const actual=again.querySelector(selector)?.textContent;
  expect(name.includes('hard break')?actual?.replace(/\n/g,''):name.includes('soft break')?actual?.replace(/\n/g,' '):actual).toBe(text);
  t.controller.setMode('markdown'); expect(t.controller.execute('undo')).toBe(true);
  expect(t.session.current.source).toBe(original);
});
it('Edit blank paragraphs remain supported across Preview visits', () => {
  const t = mount('hello', 'preview');
  t.controller.setMode('markdown');
  const {schema} = t.markdown.view.state, {paragraph} = schema.nodes;
  const lines = [paragraph.create(), paragraph.create(), paragraph.create(null, schema.text('world'))];
  t.markdown.view.dispatch(t.markdown.view.state.tr.insert(t.markdown.view.state.doc.content.size, lines));
  expect(writeEligibility(t.session.current.source).editable).toBe(true);
  expect(t.session.current.source).not.toContain('<br>');
  t.controller.setMode('markdown'); t.controller.setMode('preview');
  expect(t.controller.isEditable()).toBe(false);
  expect([...t.host.querySelectorAll('[data-readable] p')].map(p=>p.textContent).join('')).toBe('helloworld');
  t.controller.setMode('markdown'); t.controller.execute('undo');
  expect(t.session.current.source).toBe('hello');
});
it.each(['<br>', '<br class="x">', '<div>hello</div>', 'hello <b>world</b>'])('general HTML stays restricted: %s', source => expect(writeEligibility(source).editable).toBe(false));
it.each(['hello  \nworld\n\nnext', 'hello\\\nworld\n\nnext', '**hello\nworld**\n\nnext'])('maps the following block after an inline break: %s', source => {
  const t = mount(source + '\n\nlast', 'preview');
  t.controller.goToSource(source.indexOf('next'));
  expect(t.controller.getMode()).toBe('markdown');expect(t.markdown.view.state.selection.$from.parent.textContent).toBe('next');
  expect(t.controller.getSelection().sourceAnchor).toBe(source.indexOf('next'));
});
it('Preview find separates hard-break text and refuses replacement', () => {
  const t = mount('hello  \nworld\n\nnext', 'preview');
  const snapshot = t.controller.findSnapshot();
  expect(snapshot.text).toContain('hello\nworld');
  expect(snapshot.text).not.toContain('helloworld');
  const start = snapshot.text.indexOf('world');
  expect(t.controller.replaceFind(snapshot, [{from:start, to:start+5}], 'earth')).toBe(false);
  expect(rendered(t.session.current.source).querySelector('p')?.textContent).toBe('hello\nworld');
  expect(t.session.current).toEqual({source: 'hello  \nworld\n\nnext', revision: 0});
});


it('image plain alt preserves literal Markdown punctuation, spacing and code payload after edits', () => {
  const original = '![literal \\*stars\\* and ` a  b ` plus \\`ticks\\`](missing.png "A \\"quote\\" \\\\ title")\n\nnext';
  const t = mount(original, 'preview');
  t.controller.setMode('markdown');
  const end=t.markdown.view.state.doc.content.size-1; t.markdown.view.dispatch(t.markdown.view.state.tr.insertText('!',end));
  t.controller.setMode('preview');
  const img=t.host.querySelector('.ww-mode img[src]')!;
  expect(img.getAttribute('alt')).toBe('literal *stars* and a  b plus `ticks`');
  expect(img.getAttribute('title')).toBe('A "quote" \\ title');
  t.controller.setMode('markdown');t.controller.setMode('preview');
  expect(t.host.querySelector('.ww-mode img[src]')?.getAttribute('alt')).toBe('literal *stars* and a  b plus `ticks`');
  t.controller.setMode('markdown');t.controller.execute('undo');expect(t.session.current.source).toBe(original);
});
it('large inline-code payload survives Edit changes, Preview and exact undo', () => {
  const payload = '`a'.repeat(150000);
  const original = '`` ' + payload + ' ``\n\nnext';
  const t = mount(original, 'preview');
  t.controller.setMode('markdown');
  const end = t.markdown.view.state.doc.content.size - 1;
  t.markdown.view.dispatch(t.markdown.view.state.tr.insertText('!', end));
  t.controller.setMode('preview');
  expect(t.session.current.source.endsWith('next!')).toBe(true);
  expect(rendered(t.session.current.source).querySelector('code')?.textContent).toBe(payload);
  t.controller.setMode('markdown'); t.controller.setMode('preview');
  expect(t.controller.isEditable()).toBe(false);
  t.controller.setMode('markdown'); t.controller.execute('undo');
  expect(t.session.current.source).toBe(original);
});
it.each(['hello  \nworld', 'hello\\\nworld'])('hard-break copy and visible plain text separate words: %s', source => {
  const t = mount(source, 'preview');
  const paragraph=t.host.querySelector('[data-readable] p')!;const range=document.createRange();range.selectNodeContents(paragraph);
  const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
  const copied = new Map<string, string>();
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    clearData: () => copied.clear(),
    setData: (type: string, value: string) => copied.set(type, value),
  } });
  paragraph.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(copied.get('text/plain')).toBe('hello\nworld');
  expect(copied.get('text/html')).toContain('hello<br>world');
  expect(t.controller.visibleText()).toBe('hello\nworld\n');
  expect(t.session.current).toEqual({ source, revision: 0 });
});
