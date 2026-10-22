// @vitest-environment jsdom
import { vi } from 'vitest';
import type { Transaction } from 'prosemirror-state';
import MarkdownEditor from '@/markdown-editor';

describe('MarkdownEditor', () => {
  let editor: MarkdownEditor;
  const onSettled = vi.fn(), pastedImages = vi.fn();

  beforeEach(() => {
    editor = new MarkdownEditor({
      plugins: [], onSettled, pastedImages, selectedSource: () => '', pastedText: (_html, text) => text,
    });
    document.body.append(editor.el);
  });

  afterEach(() => {
    editor.destroy();
    editor.el.remove();
    vi.clearAllMocks();
  });

  it('shows each line of the text as one paragraph of text', () => {
    editor.setMarkdown('# myText\r\nnext\n');

    expect(editor.el.classList.contains('md-mode')).toBe(true);
    const lines = [...editor.view.dom.children].map((line) => line.tagName + ':' + line.textContent);
    expect(lines).toEqual(['DIV:# myText', 'DIV:next', 'DIV:']);
  });

  const paste = (text: string, files: File[] = []) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(Object.assign(event, { clipboardData: { getData: () => text, files } }));
  };

  it('pastes plain text as lines and keeps the raw text for the source', () => {
    paste('a\r\nb');

    const tr: Transaction = onSettled.mock.lastCall![1][0];
    expect([tr.getMeta('rawPaste'), tr.getMeta('uiEvent')]).toEqual(['a\r\nb', 'paste']);
    expect(editor.view.state.doc.childCount).toBe(2);
  });

  it('hands on pasted image files, and only image files, when the paste has no text', () => {
    const image = new File(['x'], 'shot.png', { type: 'image/png' });
    paste('', [new File(['x'], 'notes.pdf', { type: 'application/pdf' }), image]);

    expect(pastedImages).toHaveBeenCalledWith([image]);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('destroy disposes the view and is idempotent', () => {
    editor.destroy();

    expect(editor.view.isDestroyed).toBe(true);
    expect(() => editor.destroy()).not.toThrow();
  });

  it('setScrollTop moves the scroll position', () => {
    editor.setMarkdown('foo\n\n\n\n\n\n\n');

    editor.setScrollTop(30);

    expect(editor.getScrollTop()).toBe(30);
  });
});
