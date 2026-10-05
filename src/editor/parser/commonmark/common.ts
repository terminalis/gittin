import { encode } from 'mdurl';
import { decodeHTML } from 'entities';

export const ENTITY = '&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});';
const reBackslashOrAmp = /[\\&]/;
export const ESCAPABLE = '[!"#$%&\'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]';
const reEntityOrEscapedChar = new RegExp(`\\\\${ESCAPABLE}|${ENTITY}`, 'gi');

const unescapeChar = (s: string) => (s[0] === '\\' ? s[1] : decodeHTML(s));

// Replace entities and backslash escapes with literal characters.
export function unescapeString(s: string) {
  if (reBackslashOrAmp.test(s)) {
    return s.replace(reEntityOrEscapedChar, unescapeChar);
  }
  return s;
}

export function normalizeURI(uri: string) {
  try {
    return encode(uri);
  } catch (err) {
    return uri;
  }
}

const xmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeXml(s: string) {
  return s.replace(/[&<>"]/g, (c) => xmlEntities[c]);
}

// Normalize a reference label: remove []s, trim, collapse internal space, unicode case fold.
export function normalizeReference(str: string) {
  return str.slice(1, -1).trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
}
