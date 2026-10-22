import { baseKeymap } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Schema, Slice } from 'prosemirror-model';
import { EditorState, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

/** Each line of source is one paragraph, drawn as a div, holding only text. */
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'inline*', group: 'block', selectable: false,
      parseDOM: [{ tag: 'div' }], toDOM: () => ['div', 0],
    },
    text: { group: 'inline' },
  },
});

/** Paragraphs for the lines of a text, whatever its line endings. */
function lines(text: string) {
  return text.split(/\r\n|\n|\r/)
    .map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
}

export interface MarkdownEditorOptions {
  /** Plugins ahead of ProseMirror's base key bindings. */
  plugins: Plugin[];
  /** After each dispatch: the state before it and the transactions it applied. */
  onSettled(before: EditorState, transactions: readonly Transaction[]): void;
  pastedImages(files: File[]): void;
  /** The file's exact text under the selection, which text dragged out of Edit carries. */
  selectedSource(): string;
  pastedText(html: string, text: string, plain: boolean, at?: number): string;
}

/** Edit's source view: one ProseMirror editor whose paragraphs are the lines of the source. */
export default class MarkdownEditor {
  readonly el = document.createElement('div');
  readonly view: EditorView;
  private plainPaste = false;

  constructor({ plugins, onSettled, pastedImages, selectedSource, pastedText }: MarkdownEditorOptions) {
    this.el.className = 'gittin-editor md-mode';
    const images = (data: DataTransfer | null) => [...data?.files ?? []].filter(file => file.type.startsWith('image/'));
    this.view = new EditorView(this.el, {
      state: EditorState.create({
        schema, plugins: [...plugins, keymap({ ...baseKeymap, 'Shift-Enter': baseKeymap.Enter })],
      }),
      dispatchTransaction: tr => {
        const before = this.view.state, { state, transactions } = before.applyTransaction(tr);
        this.view.updateState(state);
        onSettled(before, transactions);
      },
      clipboardTextSerializer: () => selectedSource(),
      handleDOMEvents: {
        keydown: (_view, event) => {
          this.plainPaste = event.code === 'KeyV' && (event.ctrlKey || event.metaKey) && event.shiftKey;
          return false;
        },
        // As lines; the source takes the text with its own line endings.
        paste: (view, event) => {
          const data = event.clipboardData;
          if (!data) return false;
          event.preventDefault();
          const plain = data.getData('text/plain');
          const text = plain && pastedText(data.getData('text/html'), plain, this.plainPaste);
          this.plainPaste = false;
          if (text) {
            const slice = new Slice(Fragment.from(lines(text)), 1, 1);
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView()
              .setMeta('rawPaste', text).setMeta('uiEvent', 'paste'));
          } else if (images(data).length) pastedImages(images(data));
          return true;
        },
        // ProseMirror moves text dragged within Edit; text from elsewhere goes in as lines, as Paste
        // does, and image files are added where they are dropped.
        drop: (view, event) => {
          if (view.dragging) return false;
          event.preventDefault();
          event.stopPropagation();
          const data = event.dataTransfer, files = images(data), plain = data?.getData('text/plain');
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!at || !files.length && !plain) return true;
          const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, at.pos));
          view.focus();
          if (files.length) {
            view.dispatch(tr);
            pastedImages(files);
            return true;
          }
          const text = pastedText(data!.getData('text/html'), plain!, false, at.pos);
          view.dispatch(tr.replaceSelection(new Slice(Fragment.from(lines(text)), 1, 1))
            .setMeta('rawPaste', text).setMeta('uiEvent', 'drop'));
          return true;
        },
      },
    });
  }

  /** Shows this text, replacing the whole document. */
  setMarkdown(markdown: string) {
    const { tr, doc } = this.view.state;
    this.view.dispatch(tr.replaceWith(0, doc.content.size, lines(markdown)));
  }

  getScrollTop() {
    return this.view.dom.scrollTop;
  }

  setScrollTop(top: number) {
    this.view.dom.scrollTop = top;
  }

  destroy() {
    this.view.destroy();
  }
}
