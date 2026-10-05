// @vitest-environment jsdom
import { Plugin } from 'prosemirror-state';
import { Fragment, Slice } from 'prosemirror-model';
import type MarkdownEditor from '@/markdown-editor';
import { mount } from './mount';
it('accepted separated and appended source changes preserve mixed-newline interior; highlights and rejection do not revise', () => {
  const t = mount('A\r\nunchanged\ninterior\r\nZ');
  const v = t.markdown.view;
  const plugin = new Plugin({
    appendTransaction(trs, old, state) {
      if (trs.some((tr) => tr.getMeta('append-end')))
        return state.tr.insertText('!', state.doc.content.size - 1);
      return null;
    },
    filterTransaction(tr) {
      return !tr.getMeta('reject');
    },
  });
  v.updateState(v.state.reconfigure({ plugins: [...v.state.plugins, plugin] }));
  v.dispatch(
    v.state.tr
      .insertText('B', 2)
      .insertText('Y', v.state.doc.content.size)
      .setMeta('append-end', true)
  );
  expect(t.session.current.source).toBe('AB\r\nunchanged\ninterior\r\nZY!');
  expect(t.session.current.revision).toBe(1);
  const before = t.session.current;
  v.dispatch(v.state.tr.insertText('rejected', 1).setMeta('reject', true));
  expect(t.session.current).toBe(before);
  // A transaction without steps, as a redraw of the highlighting dispatches.
  v.dispatch(v.state.tr);
  expect(t.session.current).toBe(before);
  t.controller.execute('undo');
  expect(t.session.current.source).toBe('A\r\nunchanged\ninterior\r\nZ');
  t.controller.setMode('preview');
  t.controller.setMode('markdown');
  expect(t.controller.execute('redo')).toBe(true);
  expect(t.session.current.source).toBe(before.source);
});
it('Edit formatting history survives read-only Preview visits', () => {
  const t = mount('foo');
  t.controller.selectSource(0, 3);
  t.controller.execute('bold');
  expect(t.session.current.source).toBe('**foo**');
  const stats = t.session.historyStats;
  t.controller.setMode('preview');
  expect(t.controller.execute('undo')).toBe(false);
  expect(t.controller.execute('bold')).toBe(false);
  expect(t.session.historyStats).toEqual(stats);
  expect(t.host.querySelector('[data-readable] strong')?.textContent).toBe('foo');
  t.controller.setMode('markdown');
  expect(t.controller.execute('undo')).toBe(true);
  expect(t.session.current.source).toBe('foo');
  t.controller.setMode('preview');
  expect(t.controller.execute('redo')).toBe(false);
  t.controller.setMode('markdown');
  expect(t.controller.execute('redo')).toBe(true);
  expect(t.session.current.source).toBe('**foo**');
});

it('Preview rejects direct and appended model mutations without source or history changes', () => {
  const t = mount('original');
  // Visit Edit first so the hidden Markdown view holds the source while Preview shows.
  t.controller.setMode('preview');
  const view = t.markdown.view;
  view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, new Plugin({
    appendTransaction(trs, old, state) {
      return trs.some(tr => tr.getMeta('append')) ? state.tr.insertText('!', 1) : null;
    },
  })] }));
  view.dispatch(view.state.tr.insertText('bad', 1));
  view.dispatch(view.state.tr.setMeta('append', true));
  expect(view.state.doc.textContent).toBe('original');
  expect(t.session.current).toEqual({ source: 'original', revision: 0 });
  expect(t.host.querySelector('[data-readable] p')?.textContent).toBe('original');
  expect(t.session.historyStats.undoGroups).toBe(0);
});

it('Edit history preserves redo through Preview visits and branches after undo', () => {
  const t = mount('A');
  for (const text of ['B', 'C', 'D']) {
    const view = t.markdown.view;
    view.dispatch(view.state.tr.insertText(text, t.session.current.source.length + 1));
    t.controller.setMode('preview'); t.controller.setMode('markdown');
  }
  for (const expected of ['ABC', 'AB', 'A']) {
    expect(t.controller.execute('undo')).toBe(true);
    expect(t.session.current.source).toBe(expected);
    t.controller.setMode('preview'); t.controller.setMode('markdown');
  }
  for (const expected of ['AB', 'ABC', 'ABCD']) {
    expect(t.controller.execute('redo')).toBe(true); expect(t.session.current.source).toBe(expected);
  }
  t.controller.execute('undo');
  t.markdown.view.dispatch(t.markdown.view.state.tr.insertText('X', 4));
  expect(t.session.current.source).toBe('ABCX'); expect(t.controller.execute('redo')).toBe(false);
});

it('plain paste preserves pasted mixed newline characters even with unchanged prefix and suffix', () => {
  const t = mount('\uFEFFsame\nold\nlast'), view = t.markdown.view, { schema } = view.state;
  const text = 'same\r\nnew\rlast';
  // As the editor pastes plain text: one paragraph per line, with the raw text alongside.
  const lines = text.split(/\r\n|\r/).map(line => schema.nodes.paragraph.create(null, schema.text(line)));
  const slice = new Slice(Fragment.from(lines), 1, 1);
  view.dispatch(view.state.tr.replace(1, view.state.doc.content.size - 1, slice)
    .setMeta('rawPaste', text).setMeta('uiEvent', 'paste'));
  expect(t.session.current.source).toBe('\uFEFFsame\r\nnew\rlast');
});

it('Preview visits preserve exact bytes and Edit changes preserve untouched mixed newlines', () => {
  const raw = '\uFEFF# Heading\r\n\r\n- item\n\nlast', t = mount(raw);
  const bytes = new TextEncoder().encode(raw);
  t.controller.setMode('preview'); t.controller.setMode('markdown');
  expect(new TextEncoder().encode(t.session.current.source)).toEqual(bytes);
  expect(t.session.current.revision).toBe(0);
  t.controller.execute('heading', 2);
  expect(t.session.current.source).toBe(raw.replace('# Heading', '## Heading'));
  t.controller.execute('undo'); expect(new TextEncoder().encode(t.session.current.source)).toEqual(bytes);
});

it('Preview replacement cannot be enabled by a forged editable find snapshot', () => {
  const t = mount('one **two**', 'preview');
  const snapshot = t.controller.findSnapshot();
  expect(snapshot.text).toBe('one two\n'); expect(snapshot.editable).toBe(false);
  expect(t.controller.replaceFind({ ...snapshot, editable: true }, [{ from: 0, to: 3 }], 'bad')).toBe(false);
  expect(t.session.current).toEqual({ source: 'one **two**', revision: 0 });
});

it.each([false, true])(
  'dispose during composition (end event %s) preserves committed source and releases the session',
  (ended) => {
    vi.useFakeTimers();
    const t = mount('A');
    try {
      const el = t.markdown.view.dom;
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      t.markdown.view.dispatch(t.markdown.view.state.tr.insertText('漢', 2));
      if (ended) el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      t.controller.dispose();
      expect(t.session.current.source).toBe(ended ? 'A漢' : 'A');
      t.controller.mount(t.host, t.session, 'markdown');
      const md = (t.controller as unknown as { markdown: MarkdownEditor }).markdown;
      md.view.dispatch(md.view.state.tr.insertText('B', ended ? 3 : 2));
      expect(t.session.current.source).toBe(ended ? 'A漢B' : 'AB');
      vi.runAllTimers();
      expect(t.session.current.source).toBe(ended ? 'A漢B' : 'AB');
      t.controller.execute('undo');
      expect(t.session.current.source).toBe(ended ? 'A漢' : 'A');
      expect(t.controller.execute('undo')).toBe(ended);
      expect(t.session.current.source).toBe('A');
    } finally {
      t.dispose();
      vi.useRealTimers();
    }
  }
);

it('multiple text steps highlight every changed span against the final parser state', () => {
  const t = mount('A\n\nZ');
  const v = t.markdown.view,
    tr = v.state.tr.insertText('**', 1).insertText('**', 4);
  tr.insertText('!', tr.doc.content.size - 1);
  v.dispatch(tr);
  expect(t.session.current.source).toBe('**A**\n\nZ!');
  expect(t.host.querySelector('.gittin-editor-md-strong')?.textContent).toBe('A');
});

it('Preview navigation restores the corresponding Edit source block without revising source', () => {
  const t = mount('one\n\nsecond', 'preview');
  t.controller.goToSource(5); expect(t.controller.getSelection().sourceAnchor).toBe(5);
  t.controller.setMode('markdown'); expect(t.markdown.view.state.selection.anchor).toBeGreaterThan(4);
  expect(t.session.current.revision).toBe(0);
});

it('remounting the same session restores its current native bookmark without recording history', () => {
  const t = mount('abc');
  t.controller.selectSource(2);
  const bookmark = t.controller.getSelection();
  t.controller.dispose();
  t.controller.mount(t.host, t.session, 'markdown');
  expect(t.controller.getSelection().anchor).toBe(bookmark.anchor);
  expect(t.session.current.revision).toBe(0);
  expect(t.controller.execute('undo')).toBe(false);
});

it.each([
  [0, 3, 'A\nB'],
  [3, 6, 'A\r\nB'],
])(
  'deleting repeated display line at native %i..%i preserves the untouched raw newline',
  (from, to, expected) => {
    const original = 'A\r\nA\nB',
      t = mount(original);
    t.markdown.view.dispatch(t.markdown.view.state.tr.delete(from as number, to as number));
    expect(t.session.current.source).toBe(expected);
    t.controller.setMode('preview');
    t.controller.setMode('markdown');
    expect(t.session.current.source).toBe(expected);
    t.controller.execute('undo');
    expect(t.session.current.source).toBe(original);
    t.controller.execute('redo');
    expect(t.session.current.source).toBe(expected);
  }
);
it('appended replacement deletes the intended repeated line with one exact source revision', () => {
  const t = mount('A\r\nA\nB');
  const v = t.markdown.view;
  v.updateState(
    v.state.reconfigure({
      plugins: [
        ...v.state.plugins,
        new Plugin({
          appendTransaction(trs, old, state) {
            return trs.some((tr) => tr.getMeta('remove-first'))
              ? state.tr.delete(0, 3)
              : null;
          },
        }),
      ],
    })
  );
  v.dispatch(
    v.state.tr.insertText('!', v.state.doc.content.size - 1).setMeta('remove-first', true)
  );
  expect(t.session.current).toEqual({ source: 'A\nB!', revision: 1 });
  t.controller.execute('undo');
  expect(t.session.current.source).toBe('A\r\nA\nB');
});

it.each([
  ['remove final paragraph', 'A\r\nB', 'remove', 3, 6, '', 'A'],
  ['append paragraph', 'A\r\nB', 'insert', 6, 6, 'C', 'A\r\nB\r\nC'],
  ['remove first paragraph', 'A\r\nB\nC', 'remove', 0, 3, '', 'B\nC'],
  ['remove middle paragraph', 'A\r\nB\nC', 'remove', 3, 6, '', 'A\r\nC'],
  ['insert first paragraph', 'A\r\nB', 'insert', 0, 0, 'C', 'C\r\nA\r\nB'],
  ['insert middle paragraph', 'A\r\nB', 'insert', 3, 3, 'C', 'A\r\nC\r\nB'],
  ['remove final empty paragraph', 'A\r\n', 'remove', 3, 5, '', 'A'],
  ['append empty paragraph', 'A\r\nB', 'insert', 6, 6, '', 'A\r\nB\r\n'],
  ['insert middle empty paragraph', 'A\r\nB', 'insert', 3, 3, '', 'A\r\n\r\nB'],
  ['remove first empty paragraph', '\r\nA\nB', 'remove', 0, 2, '', 'A\nB'],
  ['remove middle empty paragraph', 'A\r\n\nB', 'remove', 3, 5, '', 'A\r\nB'],
  ['insert into empty document', '', 'insert', 0, 0, 'C', 'C\n'],
] as const)(
  '%s reconciles structural separators and roundtrips history',
  (_label, original, operation, from, to, text, expected) => {
    const t = mount(original);
    const v = t.markdown.view, { schema } = v.state;
    const tr =
      operation === 'remove'
        ? v.state.tr.delete(from, to)
        : v.state.tr.insert(from,
            schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined));
    v.dispatch(tr);
    expect(t.session.current).toEqual({ source: expected, revision: 1 });
    expect(v.state.doc.textBetween(0, v.state.doc.content.size, '\n')).toBe(
      expected.replace(/\r\n|\r/g, '\n')
    );
    t.controller.setMode('preview');
    t.controller.setMode('markdown');
    expect(t.session.current.source).toBe(expected);
    t.controller.execute('undo');
    expect(t.session.current.source).toBe(original);
    t.controller.execute('redo');
    expect(t.session.current.source).toBe(expected);
  }
);
it.each(['remove', 'insert'] as const)(
  'appended whole-paragraph %s retains final batch separators',
  (operation) => {
    const t = mount('A\r\nB');
    const v = t.markdown.view;
    v.updateState(
      v.state.reconfigure({
        plugins: [
          ...v.state.plugins,
          new Plugin({
            appendTransaction(trs, old, state) {
              if (!trs.some((tr) => tr.getMeta('boundary-append'))) return null;
              return operation === 'remove'
                ? state.tr.delete(4, state.doc.content.size)
                : state.tr.insert(
                    state.doc.content.size,
                    state.schema.nodes.paragraph.create(null, state.schema.text('C'))
                  );
            },
          }),
        ],
      })
    );
    v.dispatch(v.state.tr.insertText('!', 2).setMeta('boundary-append', true));
    const expected = operation === 'remove' ? 'A!' : 'A!\r\nB\r\nC';
    expect(t.session.current).toEqual({ source: expected, revision: 1 });
    t.controller.setMode('preview');
    expect(t.controller.execute('undo')).toBe(false);
    t.controller.setMode('markdown');
    t.controller.execute('undo');
    expect(t.session.current.source).toBe('A\r\nB');
    t.controller.setMode('markdown');
    t.controller.execute('redo');
    expect(t.session.current.source).toBe(expected);
  }
);
it('a divergent accepted projection restores canonical source and reports the failed edit', () => {
  const t = mount('A\r\nB'),
    notices: string[] = [];
  t.controller.subscribeNotice((message) => notices.push(message));
  const view = t.markdown.view;
  // Simulate a view that drifted from the source: a change drawn without a dispatch, then an edit.
  view.updateState(view.state.apply(view.state.tr.insertText('lost', 2)));
  view.dispatch(view.state.tr.insertText('?', 1));
  expect(t.session.current).toEqual({ source: 'A\r\nB', revision: 0 });
  expect(view.state.doc.textBetween(0, view.state.doc.content.size, '\n')).toBe('A\nB');
  expect(notices).toEqual([
    'The edit could not be converted. Your original source is still available.',
  ]);
  expect(t.controller.execute('undo')).toBe(false);
  view.dispatch(view.state.tr.insertText('!', 2));
  expect(t.session.current).toEqual({ source: 'A!\r\nB', revision: 1 });
});
