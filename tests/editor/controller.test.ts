// @vitest-environment jsdom
import { vi } from 'vitest';
import { applySourceCommand } from '@/source-commands';
vi.mock('@/source-commands', async importOriginal => { const actual = await importOriginal<typeof import('@/source-commands')>(); return { ...actual, applySourceCommand: vi.fn(actual.applySourceCommand) }; });
import { mount } from './mount';
import { commandRegistry } from '@/commands';
it('mounts owned Edit and a static read-only Preview without changing source', () => {
  const source = '\uFEFF# Title\r\n\r\n- one\r\n';
  const { controller, session, host } = mount(source);
  expect(host.querySelectorAll('.md-mode .ProseMirror')).toHaveLength(1);
  controller.setMode('preview');
  expect(host.querySelector('[data-readable]')?.getAttribute('contenteditable')).toBe('false');
  expect(host.querySelector('[data-readable] h1')?.textContent).toBe('Title');
  controller.setMode('markdown');
  expect(session.current).toEqual({ revision: 0, source });
});
it('combined_untrusted_html_link_image_keeps_exact_markdown_source', () => {
  const source =
    '# Untrusted\r\n\r\n<script>window.bad=true</script>\r\n<a href="https://example.com" data-raw-html="script">window.reviewProbe=1</a>\r\n<img src="x" onerror="window.bad=true">\r\n\r\n[bad](javascript:alert%281%29) ![bad](javascript:alert%281%29)\r\n';
  const { controller, session, host } = mount(source), rendered = document.createElement('div');
  controller.setMode('preview');
  controller.renderReadOnly(source, rendered);
  for (const element of [host, rendered]) {
    expect(element.querySelector('script,iframe,embed,object,[onerror],[onclick],[srcdoc]')).toBeNull();
    for (const url of element.querySelectorAll('[href],[src]'))
      expect(url.getAttribute('href') || url.getAttribute('src') || '').not.toMatch(/^\s*(javascript|vbscript|data):/i);
  }
  controller.setMode('markdown');
  expect(session.current).toEqual({ revision: 0, source });
});
it('registry commands execute against retained view selection', () => {
  const { controller, session } = mount('hello');
  expect(commandRegistry.bold.state).toBe('strong');
  expect(controller.execute('heading', 2)).toBe(true);
  expect(session.current.source).toBe('## hello');
});
it('commandState reuses conversion availability until source or selection changes', () => {
  const { controller, session } = mount('one two');
  const convert = vi.mocked(applySourceCommand);
  controller.selectSource(0, 3);
  convert.mockClear();
  expect(controller.commandState('convertToComment').disabled).toBe(false);
  expect(controller.commandState('convertToComment').disabled).toBe(false);
  expect(convert).toHaveBeenCalledTimes(1);
  controller.selectSource(3);
  expect(controller.commandState('convertToComment').disabled).toBe(true);
  expect(convert).toHaveBeenCalledTimes(2);
  controller.selectSource(0, 3);
  session.applyWriteSource('', 'typing', { mode: 'markdown', anchor: 1, head: 1, sourceAnchor: 0, scrollTop: 0 });
  expect(controller.commandState('convertToComment').disabled).toBe(true);
  expect(convert).toHaveBeenCalledTimes(3);
});
it('toolbar state at the caret comes from the parse of the current source', () => {
  const cases = [['# h', 'heading'], ['- a', 'bulletList'], ['> q', 'blockQuote'], ['**b**', 'bold']] as const;
  for (const [source, command] of cases) {
    const { controller } = mount(source);
    controller.goToSource(3);
    expect(controller.commandState(command).selected, source).toBe(true);
    expect(controller.commandState('italic').selected, source).toBe(false);
    expect(controller.blockLabel(), source).toBe(command === 'heading' ? 'Heading 1' : 'Paragraph');
  }
});
it('Edit shows Markdown emphasis from the parse of the text it draws, and none in code files', () => {
  const { controller, host, markdown } = mount('**a** *b* ~~c~~ ~d~\n# h\n- [x] t\n- [ ] u');
  const styled = (kind: string) =>
    [...host.querySelectorAll('.gittin-editor-md-' + kind)].map(span => span.textContent).join('');
  expect(['strong', 'emph', 'strike', 'heading', 'list-item-style'].map(styled))
    .toEqual(['a', 'b', 'cd', '# h', '- x- ']);
  // The edit that closes the emphasis shows it at once.
  markdown.view.dispatch(markdown.view.state.tr.insertText(' **e*', 20));
  markdown.view.dispatch(markdown.view.state.tr.insertText('*', 25));
  expect(styled('strong')).toBe('ae');
  controller.setFileType('javascript');
  expect(host.querySelector('[class*="gittin-editor-md-"]')).toBeNull();
});
