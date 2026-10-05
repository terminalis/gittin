import createDOMPurify from 'dompurify';
const purifier = createDOMPurify(window);
const forbidden = [
  'input',
  'script',
  'textarea',
  'form',
  'button',
  'select',
  'meta',
  'style',
  'link',
  'title',
  'object',
  'base',
  'iframe',
  'embed',
];
export function sanitizeHTML(html: string): string {
  return purifier.sanitize(html, {
    ADD_ATTR: ['target'],
    FORBID_TAGS: forbidden,
    FORBID_ATTR: ['srcdoc', 'data-raw-html', 'style', 'contenteditable', 'autofocus'],
    RETURN_TRUSTED_TYPE: false,
  });
}
