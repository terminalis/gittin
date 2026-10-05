import { baseKeymap } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Schema, Slice } from 'prosemirror-model';
import { EditorState, type Plugin, type Transaction } from 'prosemirror-state';
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
  onNotice(message: string): void;
}

/** Edit's source view: one ProseMirror editor whose paragraphs are the lines of the source. */
export default class MarkdownEditor {
  readonly el = document.createElement('div');
  readonly view: EditorView;

  constructor({ plugins, onSettled, onNotice }: MarkdownEditorOptions) {
    this.el.className = 'gittin-editor md-mode';
    const imageNotice = () => onNotice('Paste an image URL to insert an image.');
    this.view = new EditorView(this.el, {
      state: EditorState.create({
        schema, plugins: [...plugins, keymap({ ...baseKeymap, 'Shift-Enter': baseKeymap.Enter })],
      }),
      dispatchTransaction: tr => {
        const before = this.view.state, { state, transactions } = before.applyTransaction(tr);
        this.view.updateState(state);
        onSettled(before, transactions);
      },
      handleDOMEvents: {
        // Plain text only, as lines; the source takes the text with its own line endings.
        paste: (view, event) => {
          const data = event.clipboardData;
          if (!data) return false;
          event.preventDefault();
          const text = data.getData('text/plain');
          if (text) {
            const slice = new Slice(Fragment.from(lines(text)), 1, 1);
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView()
              .setMeta('rawPaste', text).setMeta('uiEvent', 'paste'));
          } else if ([...data.items].some(item => item.kind === 'file')) imageNotice();
          return true;
        },
        // ProseMirror's own drop handling stays off: dropped text goes in as the browser inserts
        // it, and image files are refused.
        drop: (_, event) => {
          if ([...event.dataTransfer?.files ?? []].some(file => file.type.includes('image'))) {
            event.preventDefault();
            event.stopPropagation();
            imageNotice();
          }
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
