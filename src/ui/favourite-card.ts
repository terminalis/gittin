import createDOMPurify from 'dompurify';
import type { DraftSummary } from '../documents/drafts';
import { fileDescriptor } from '../documents/file-types';
import { Renderer } from '../editor/parser';
import { markdownNodes } from '../editor/source-projection';
import { button, el } from './dom';
import { fileTile } from './file-tile';

const purifier = createDOMPurify(window);
const previewTags = [
  'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 's', 'mark', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

export function favouriteCard(row: DraftSummary, open: () => void): HTMLElement {
  const preview = el('div', { className: 'favourite-preview', ariaHidden: 'true' });
  const type = row.fileType;
  const source = row.previewSource ?? '';
  if (!source.trim()) {
    preview.classList.add('favourite-preview-empty');
    preview.textContent = row.previewSource === undefined ? 'Preview unavailable' : 'Empty file';
  } else if (type === 'markdown') {
    const html = new Renderer({ softbreak: ' ' }).render(markdownNodes(source)[0]);
    // Keep thumbnails inert: no links, remote media, IDs, inline styles or controls.
    preview.innerHTML = purifier.sanitize(html, {
      ALLOWED_TAGS: previewTags, ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
    });
    if (!preview.textContent?.trim()) preview.textContent = 'Open file to preview';
  } else preview.append(el('pre', { textContent: source }));

  const openButton = button(row.title, open, 'favourite-open');
  openButton.title = row.title;
  return el('article', { className: 'favourite-card' },
    el('div', { className: 'favourite-thumbnail' }, preview),
    el('div', { className: 'favourite-caption' }, fileTile(type, row.title), openButton,
      el('small', { textContent: fileDescriptor(type)?.label ?? 'File' })));
}
