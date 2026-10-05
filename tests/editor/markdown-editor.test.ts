// @vitest-environment jsdom
import { vi } from 'vitest';
import type { Transaction } from 'prosemirror-state';
import MarkdownEditor from '@/markdown-editor';

describe('MarkdownEditor', () => {
  let editor: MarkdownEditor;
  const onSettled = vi.fn(), onNotice = vi.fn();

  beforeEach(() => {
    editor = new MarkdownEditor({ plugins: [], onSettled, onNotice });
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

  const paste = (text: string, items: { kind: string }[] = []) => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(Object.assign(event, { clipboardData: { getData: () => text, items } }));
  };

  it('pastes plain text as lines and keeps the raw text for the source', () => {
    paste('a\r\nb');

    const tr: Transaction = onSettled.mock.lastCall![1][0];
    expect([tr.getMeta('rawPaste'), tr.getMeta('uiEvent')]).toEqual(['a\r\nb', 'paste']);
    expect(editor.view.state.doc.childCount).toBe(2);
  });

  it('asks for an image URL when a pasted file has no text', () => {
    paste('', [{ kind: 'file' }]);

    expect(onNotice).toHaveBeenCalledWith('Paste an image URL to insert an image.');
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
