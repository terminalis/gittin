import { imageType } from '../sources/paths';
import { syntaxSpans } from './source-language';

const isURL = (text: string) => /^(?:https?:\/\/|mailto:)\S+$/i.test(text) && URL.canParse(text);
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const link = (label: string, href: string) => label === href || label + '/' === href ? label
  : `[${label.replace(/[[\]]/g, '\\$&')}](${/\s/.test(href) ? `<${href}>` : href})`;

export function pastedMarkdown(source: string, from: number, to: number, html: string, text: string): string | null {
  const literal = syntaxSpans(source, 'markdown')
    .some(span => from === to ? span.from < from && from < span.to : span.from < to && from < span.to);
  if (literal) return null;
  const url = text.trim(), selected = source.slice(from, to);
  if (isURL(url)) {
    if (selected && !/[\r\n]/.test(selected) && !isURL(selected.trim())) return `[${selected}](${url})`;
    return !selected && /^https?:/i.test(url) && imageType(new URL(url).pathname) ? `![](${url})` : null;
  }
  const body = html ? new DOMParser().parseFromString(html, 'text/html').body : null;
  if (!body) return null;
  body.querySelectorAll('style, script').forEach(element => element.remove());
  return tableMarkdown(body) ?? linkedText(body, text);
}

function tableMarkdown(body: HTMLElement) {
  const table = body.querySelector('table');
  if (!table?.rows.length || collapse(body.textContent!) !== collapse(table.textContent!)) return null;
  const rows = [...table.rows].map(row => [...row.cells].map(cell => collapse(inline(cell)).replace(/\|/g, '\\|')));
  const width = Math.max(...rows.map(row => row.length));
  const line = (cells: string[]) => `| ${[...cells, ...Array(width - cells.length).fill('')].join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}
function inline(node: Node): string {
  return [...node.childNodes].map(child => {
    if (child.nodeType === Node.TEXT_NODE) return child.textContent;
    const element = child as Element, href = element.localName === 'a' && element.getAttribute('href')?.trim();
    if (href) return link(collapse(element.textContent!), href);
    return /^(?:br|p|div|li)$/.test(element.localName) ? ` ${inline(element)} ` : inline(element);
  }).join('');
}

function linkedText(body: HTMLElement, text: string) {
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), done = new Set<Element>();
  let result = '', at = 0, skip = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const anchor = node.parentElement!.closest('a[href]');
    if (!anchor) skip += node.textContent!.replace(/\s+/g, ' ').trimStart().length;
    if (!anchor || done.has(anchor)) continue;
    done.add(anchor);
    const label = collapse(anchor.textContent!), href = anchor.getAttribute('href')!.trim();
    if (!label || !href) continue;
    const words = new RegExp(label.split(' ').map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
    words.lastIndex = Math.min(at + skip, text.length);
    let match = words.exec(text);
    if (!match) {
      words.lastIndex = at;
      match = words.exec(text);
    }
    skip = 0;
    if (!match) continue;
    result += text.slice(at, match.index) + link(match[0], href);
    at = match.index + match[0].length;
  }
  result += text.slice(at);
  return result === text ? null : result;
}
