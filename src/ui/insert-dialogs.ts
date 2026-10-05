import type { GittinController, SourceContext } from '../editor/controller';
import {
  insertElement, snippets, imageContext, transformImage, transformTable, type ElementRequest,
} from '../editor/markdown-elements';
import { headingAnchors } from '../editor/heading-anchors';
import {
  button, checkbox, dialogShell, dropDown, el, field, select, showDialog, textField,
} from './dom';
const symbolChoices = [
  ['©', 'copyright'], ['®', 'registered'], ['™', 'trademark'], ['→', 'right arrow'], ['←', 'left arrow'],
  ['✓', 'check'], ['×', 'multiply'], ['÷', 'divide'], ['±', 'plus minus'], ['∞', 'infinity'], ['π', 'pi'],
  ['≤', 'less equal'], ['≥', 'greater equal'], ['—', 'em dash'], ['…', 'ellipsis'],
  ['😀', 'smile happy emoji'], ['🎉', 'celebration party emoji'], ['👍', 'thumbs up emoji'],
  ['❤️', 'heart love emoji'], ['🚀', 'rocket emoji'], ['✅', 'check emoji'], ['⚠️', 'warning emoji'],
];
type Edit = Parameters<SourceContext['apply']>[0];
type Link = ReturnType<GittinController['getLinkValues']>;
/** Adds a form's fields to `body` and returns its edit, or null when there is nothing to edit. */
type Form = (body: HTMLElement, context: SourceContext, id?: string, link?: Link) => Edit | null;

const insert = (request: () => ElementRequest): Edit =>
  (source, selection, type) => insertElement(source, selection, type, request());
const hint = (body: HTMLElement, text: string) =>
  body.append(el('p', { className: 'dialog-hint', textContent: text }));
/** A form with no fields: a hint about what it inserts. */
const explained = (kind: string, text: string): Form =>
  (body, _context, id) => { hint(body, text); return insert(() => ({ kind, id })); };
const textForm = (kind: string, label: string, value: string): Form => body => {
  const text = textField(body, label, { name: 'text', type: 'text', value });
  return insert(() => ({ kind, text: text.value }));
};
const linkForm = (kind: 'link' | 'image'): Form => (body, _context, _id, link) => {
  const image = kind === 'image';
  const url = textField(body, image ? 'Image URL' : 'URL',
    { name: 'url', type: 'text', value: link?.linkUrl || '', required: true });
  const text = textField(body, image ? 'Alt text' : 'Link text',
    { name: 'text', type: 'text', value: link?.linkText || '' });
  if (image) hint(body, 'Use Insert › Image › From folder… for images in the document’s folder.');
  return insert(() => ({ kind, url: url.value, text: text.value }));
};
const tableForm: Form = body => {
  const rows = textField(body, 'Rows (including header)',
    { name: 'rows', type: 'number', value: '3', required: true, min: '2', max: '100', step: '1' });
  const columns = textField(body, 'Columns',
    { name: 'columns', type: 'number', value: '2', required: true, min: '1', max: '50', step: '1' });
  const grid = el('div', { className: 'table-grid', ariaLabel: 'Table grid' }), output = el('output');
  const update = () => {
    output.textContent = rows.value + ' rows × ' + columns.value + ' columns';
    for (const b of grid.querySelectorAll<HTMLButtonElement>('button'))
      b.dataset.selected = String(Number(b.dataset.row) <= Number(rows.value)
        && Number(b.dataset.column) <= Number(columns.value));
  };
  for (let r = 2; r <= 6; r++)
    for (let c = 1; c <= 6; c++) {
      const pick = () => { rows.value = String(r); columns.value = String(c); update(); };
      const b = Object.assign(button('', pick), { ariaLabel: r + ' rows, ' + c + ' columns' });
      Object.assign(b.dataset, { row: String(r), column: String(c) });
      grid.append(b);
    }
  body.append(grid, output);
  rows.oninput = columns.oninput = update;
  update();
  return insert(() => ({ kind: 'table', rows: Number(rows.value), columns: Number(columns.value) }));
};
const symbolForm: Form = body => {
  const search = textField(body, 'Search symbols and emoji', { name: 'search', type: 'search' });
  const choices = el('div', { className: 'symbol-choices' }), output = el('output');
  let chosen = '';
  const render = () => choices.replaceChildren(...symbolChoices
    .filter(([symbol, name]) => (symbol + ' ' + name).includes(search.value.toLowerCase()))
    .map(([symbol, name]) => {
      const pick = () => { chosen = symbol; output.textContent = 'Selected: ' + symbol; };
      return Object.assign(button(symbol, pick), { ariaLabel: name });
    }));
  search.oninput = render;
  render();
  body.append(choices, output);
  return insert(() => ({ kind: 'symbol', text: chosen }));
};
const headingForm: Form = (body, context) => {
  const headings = headingAnchors(context.source);
  if (!headings.length) hint(body, 'This file has no headings.');
  const picker = select('Heading', headings.map((h, i) =>
    [String(i), '  '.repeat(h.level - 1) + h.text + ' (Heading ' + h.level + ')']));
  body.append(field('Heading', picker));
  picker.size = Math.min(8, Math.max(2, headings.length));
  for (const [i, h] of headings.entries())
    picker.options[i].style.paddingInlineStart = ((h.level - 1) * 16 + 8) + 'px';
  const heading = () => (picker.value === '' ? -1 : Number(picker.value));
  return insert(() => ({ kind: 'headingLink', heading: heading() }));
};
const imageSizeForm: Form = (body, context) => {
  const image = imageContext(context.source, context.selection);
  if (!image) return null;
  const size = { type: 'number', min: '1', max: '10000', step: '1' };
  const width = textField(body, 'Width (pixels)', { name: 'width', ...size, value: image.width });
  const height = textField(body, 'Height (pixels)', { name: 'height', ...size, value: image.height });
  const keep = checkbox('Keep proportions', true, 'dialog-option');
  body.append(keep.parentElement!);
  hint(body, 'Keep proportions stores width only (or height when width is empty), so the browser '
    + 'uses the image’s natural proportions. No remote dimensions are fetched. '
    + 'Clear both fields with Reset size.');
  return (source, selection) => transformImage(source, selection, {
    width: width.value ? Number(width.value) : undefined,
    height: height.value ? Number(height.value) : undefined,
    keepProportions: keep.checked,
  });
};
/** Each kind's dialog title and form. */
const forms: Record<string, [title: string, form: Form]> = {
  link: ['Insert link', linkForm('link')],
  image: ['Insert image', linkForm('image')],
  table: ['Insert table', tableForm],
  symbol: ['Symbols', symbolForm],
  headingLink: ['Link to heading', headingForm],
  codeBlock: ['Code block', body => {
    const language = textField(body, 'Language (optional)',
      { name: 'language', type: 'text', pattern: '[a-zA-Z0-9_-]{0,40}' });
    return insert(() => ({ kind: 'codeBlock', language: language.value }));
  }],
  footnote: ['Footnote', textForm('footnote', 'Note text', 'Note')],
  details: ['Collapsible section', textForm('details', 'Summary', 'Details')],
  comment: ['Comment', explained('comment', 'Inserts a comment stub using this file’s language.')],
  alert: ['Alert', body => {
    const type = dropDown(body, 'Alert type', ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']);
    return insert(() => ({ kind: 'alert', id: type.value }));
  }],
  math: ['Math', explained('math', 'Inserts math source. Preview typesets it.')],
  diagram: ['Diagram',
    explained('diagram', 'Inserts a Mermaid source block. Preview draws it as a diagram.')],
  toc: ['Table of contents',
    explained('toc', 'Inserts ordinary heading links. Renaming headings may require updating links.')],
  snippet: ['Insert snippet', (body, context, id) => {
    hint(body, snippets(context.type).find(s => s.id === id)?.text || 'No snippet available.');
    return insert(() => ({ kind: 'snippet', id }));
  }],
  imageSize: ['Image size', imageSizeForm],
  alignColumn: ['Align column', body => {
    const align = dropDown(body, 'Column alignment', ['left', 'center', 'right']);
    return (source, selection) =>
      transformTable(source, selection, 'alignColumn', align.value as 'left' | 'center' | 'right');
  }],
};
export class InsertDialogs {
  private dialog?: HTMLDialogElement;
  constructor(private controller: GittinController) {}
  open(kind: string, id?: string) {
    if (!this.controller.isEditable()) return;
    this.close();
    // Cancel restores the selection from before a link's text was selected for editing.
    const original = this.controller.captureSourceContext();
    const link = kind === 'link' ? this.controller.getLinkValues() : undefined;
    const context = this.controller.captureSourceContext();
    const [title, build] = forms[kind], form = el('form');
    const { dialog, body, footer } = dialogShell(title, 'insert-dialog', form);
    const edit = build(body, context, id, link);
    if (!edit) return;
    const error = el('p', { role: 'alert' });
    const cancel = () => { this.close(); original.restore(); };
    const label = kind === 'imageSize' || kind === 'alignColumn' ? 'Apply'
      : link?.linkUrl ? 'Update link' : 'Insert';
    body.append(error);
    footer.append(button('Cancel', cancel),
      el('button', { type: 'submit', className: 'primary', textContent: label }));
    form.onsubmit = event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      if (!context.valid()) {
        error.textContent = 'The file or editing context changed. Close this dialog and try again.';
        return;
      }
      dialog.close();
      if (context.apply(edit)) this.close();
      else {
        error.textContent = 'Enter supported values and choose an applicable source selection.';
        showDialog(dialog);
      }
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
    this.dialog = dialog;
    document.body.append(dialog);
    showDialog(dialog);
  }
  close() { this.dialog?.close(); this.dialog?.remove(); this.dialog = undefined; }
  dispose() { this.close(); }
}
