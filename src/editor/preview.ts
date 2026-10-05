import { createProjection } from './source-projection';
import { Parser, Renderer } from './parser';
import { escapeXml } from './parser/commonmark/common';
import { sanitizeHTML } from './sanitizer/htmlSanitizer';
import { safeURL } from './safe-url';
import { FRONT_MATTER, headingAnchors } from './heading-anchors';
import { syntaxSpans, commentRanges, type SourceRange } from './source-language';
import { appendSource, fenceType, type DisplaySettings } from './display';
import { writeEligibility } from './supported-syntax';
import { textNodes } from './preview-extras';
const allowedTags = new Set('a p div span br hr ins sup sub mark em strong b i s del strike u code pre blockquote ul ol li table thead tbody tr th td img details summary kbd samp var dl dt dd abbr ruby rt rp'.split(' '));
const embedTag = /^(?:iframe|embed|object)$/i;
function markdownHTML(source: string, warnings: Set<string>): string {
  const root = new Parser({ extendedAutolinks: true }).parse(source);
  const walker = root.walker();
  let event;
  while ((event = walker.next()))
    if (event.entering && /html/i.test(event.node.type)) {
      const raw = event.node.literal ?? '';
      const tags = [...raw.matchAll(/<\/?([a-z][\w-]*)\b/gi)];
      if (tags.length && tags.every(m => embedTag.test(m[1])) && !raw.replace(/<[^>]*>/g, '').trim()) {
        // Embedded pages never load in Preview: say so in place of markup that holds nothing else. A closing tag alone adds nothing.
        const element = event.node.type === 'htmlBlock' ? 'p' : 'span';
        event.node.literal = tags.some(m => !m[0].startsWith('</'))
          ? `<${element} class="preview-embed-note">Embedded content isn't shown in Preview.</${element}> `
          : '';
      } else if (tags.some(m => !allowedTags.has(m[1].toLowerCase())) || /\s(?:style|on\w+|srcdoc|class|id|name)\s*=/i.test(raw)) {
        warnings.add('Unsupported HTML is shown as source; scripts and arbitrary CSS never run');
        event.node.literal = event.node.type === 'htmlBlock'
          ? '<pre class="unsupported-source">' + escapeXml(raw) + '</pre>'
          : '<code>' + escapeXml(raw) + '</code>';
      }
    }
  return sanitizeHTML(new Renderer({ softbreak: ' ' }).render(root));
}
/** Intersect full-source comment spans rather than re-lexing an isolated fallback fragment. */
function fallbackSource(source: string, from: number, to: number, hiddenComments: SourceRange[]) {
  const parts: string[] = [];
  let cursor = from;
  for (const comment of hiddenComments) {
    if (comment.from >= to) break;
    if (comment.to <= cursor) continue;
    parts.push(source.slice(cursor, Math.max(cursor, comment.from)));
    cursor = Math.min(to, comment.to);
  }
  parts.push(source.slice(cursor, to));
  return parts.join('');
}
/** Replace GitHub maths outside code and HTML with placeholders that renderPreviewExtras fills with KaTeX. */
function mathPlaceholders(text: string): string {
  const outside = (source: string) => {
    const spans = syntaxSpans(source, 'markdown').filter(s => (s.kind === 'code' && source[s.from] !== '\\') || s.kind === 'html');
    return (from: number, to: number) => !spans.some(s => from < s.to && to > s.from) && source[from - 1] !== '\\';
  };
  let free = outside(text);
  text = text.replace(/(^|\n)[ \t]*\$\$([\s\S]*?)\$\$[ \t]*(?=\n|$)/g, (full, lead: string, tex: string, offset: number) =>
    free(offset + lead.length, offset + full.length)
      ? `${lead}\n<div data-math="display" data-tex="${escapeXml(tex.trim())}"></div>\n` : full);
  free = outside(text);
  return text.replace(/\$(?![\s$])(?:[^$\n]*?[^\s$])?\$(?!\d)/g, (full, offset: number) =>
    free(offset, offset + full.length)
      ? `<span data-math="inline" data-tex="${escapeXml(full.slice(1, -1))}"></span>` : full);
}
/** Take footnote definitions out of the text into notes, and keep escaped references as literal text. */
function footnoteDefinitions(display: string, notes: Map<string, string>, warnings: Set<string>) {
  const protectedSpans = syntaxSpans(display, 'markdown').filter(s => s.kind === 'code' || s.kind === 'string' || s.kind === 'html');
  display = display.replace(/^ {0,3}\[\^([^\]\r\n]+)\]:[ \t]*(.*)(?:(?:\r\n|\r|\n)(?: {4}|\t).*)*/gm, (full, label, _first, offset) => {
    if (protectedSpans.some(s => offset >= s.from && offset < s.to))
      return full;
    if (notes.has(label)) {
      warnings.add('Duplicate footnote definitions remain visible source');
      return '<pre>' + escapeXml(full) + '</pre>';
    }
    notes.set(label, full.replace(/^ {0,3}\[\^[^\]]+\]:[ \t]*/, '').replace(/^(?: {4}|\t)/gm, ''));
    return '';
  });
  const literalSpans = syntaxSpans(display, 'markdown');
  return display.replace(/\\\[\^[^\]\n]+\]/g, (full, offset) => {
    const escaped = literalSpans.some(span => span.from === offset && span.to === offset + 2 && span.kind === 'code');
    return escaped ? '<span data-literal-footnote>' + escapeXml(full.slice(1)) + '</span>' : full;
  });
}
/** Number footnote references in reading order, link each to its note, and list the notes at the end. */
function footnotes(
  container: HTMLElement,
  notes: Map<string, string>,
  usedIDs: Set<string>,
  warnings: Set<string>
) {
  const reserveID = (base: string) => { let id = base, suffix = 0; while (usedIDs.has(id))
    id = base + '-' + (++suffix); usedIDs.add(id); return id; };
  const cited = new Map<string, { n: number; id: string; refs: string[] }>();
  for (const node of textNodes(container, 'code,pre,a,[data-literal-footnote]')) {
    const text = node.data, matches = [...text.matchAll(/\[\^([^\]\n]+)\]/g)];
    if (!matches.length)
      continue;
    const fragment = document.createDocumentFragment();
    let end = 0;
    for (const match of matches) {
      fragment.append(text.slice(end, match.index));
      const label = match[1];
      if (!notes.has(label)) {
        fragment.append(match[0]);
        warnings.add('Unresolved footnotes remain visible source');
      }
      else {
        if (!cited.has(label)) {
          const n = cited.size + 1;
          cited.set(label, { n, id: reserveID(`footnote-${n}`), refs: [] });
        }
        const note = cited.get(label)!, a = document.createElement('a');
        a.id = reserveID(`footnote-ref-${note.n}-${note.refs.length + 1}`);
        note.refs.push(a.id);
        a.href = '#' + note.id;
        a.textContent = `[${note.n}]`;
        a.setAttribute('aria-label', `Footnote ${note.n}`);
        fragment.append(a);
      }
      end = match.index! + match[0].length;
    }
    fragment.append(text.slice(end));
    node.replaceWith(fragment);
  }
  if (!cited.size)
    return;
  const section = document.createElement('section');
  section.setAttribute('aria-label', 'Footnotes');
  const title = document.createElement('h2');
  title.textContent = 'Footnotes';
  section.append(title);
  for (const [label, { n, id, refs }] of cited) {
    const item = document.createElement('div');
    item.id = id;
    item.innerHTML = markdownHTML(notes.get(label)!, warnings);
    const number = document.createElement('strong');
    number.textContent = `[${n}] `;
    item.prepend(number);
    refs.forEach((ref, i) => {
      const back = document.createElement('a');
      back.href = '#' + ref;
      back.textContent = ' Back';
      back.setAttribute('aria-label', `Back to footnote ${n} reference ${i + 1}`);
      item.append(back);
    });
    section.append(item);
  }
  container.append(section);
}
export function renderPreview(source: string, container: HTMLElement, settings: DisplaySettings) {
  const warnings = new Set<string>();
  const eligibility = writeEligibility(source);
  // Raw HTML and footnotes render here; other unsupported syntax stays as source
  const unsupported = eligibility.editable ? [] : eligibility.issues.filter(issue =>
    issue.reason !== 'raw HTML' && issue.reason !== 'footnotes');
  const hiddenComments = settings.showComments ? [] : commentRanges(source, 'markdown');
  for (const issue of unsupported)
    warnings.add(issue.reason + ' remains visible source (local rendering unavailable)');
  const projected = createProjection(source).text;
  let display = projected;
  for (const span of [...commentRanges(projected, 'markdown')].reverse())
    display = display.slice(0, span.from)
      + (settings.showComments ? '<pre>' + escapeXml(projected.slice(span.from, span.to)) + '</pre>' : '')
      + display.slice(span.to);
  let frontMatter: string | undefined;
  display = display.replace(FRONT_MATTER, (_full, yaml: string) => { frontMatter = yaml; return ''; });
  const notes = new Map<string, string>();
  display = footnoteDefinitions(display, notes, warnings);
  container.innerHTML = markdownHTML(mathPlaceholders(display), warnings);
  if (frontMatter !== undefined) {
    // Shown as YAML until renderPreviewExtras loads a YAML parser and turns it into a table.
    const pre = document.createElement('pre'), code = document.createElement('code');
    pre.dataset.frontMatter = '';
    code.className = 'language-yaml';
    code.textContent = frontMatter;
    pre.append(code);
    container.prepend(pre);
  }
  const headings = headingAnchors(source);
  container.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((el, i) => {
    if (headings[i])
      el.id = headings[i].id;
  });
  for (const quote of container.querySelectorAll('blockquote')) {
    const first = quote.querySelector('p'), marker = first?.firstChild;
    if (marker?.nodeType === Node.TEXT_NODE) {
      const match = marker.textContent?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/);
      if (match) {
        const title = document.createElement('strong');
        title.textContent = match[1] + '\n';
        marker.textContent = marker.textContent!.slice(match[0].length);
        first!.prepend(title);
        quote.classList.add('preview-alert');
      }
    }
  }
  footnotes(container, notes, new Set(headings.map(heading => heading.id)), warnings);
  for (const code of container.querySelectorAll<HTMLElement>('pre > code')) {
    const language = code.className.match(/language-([^\s]+)/)?.[1] ?? '', type = fenceType(language), text = code.textContent ?? '';
    if (language === 'math') {
      const block = document.createElement('div');
      block.dataset.math = 'display';
      block.dataset.tex = text.trim();
      code.parentElement!.replaceWith(block);
      continue;
    }
    if (language === 'mermaid') {
      const pre = code.parentElement!, figure = document.createElement('div');
      figure.className = 'preview-diagram';
      figure.dataset.mermaid = text;
      pre.replaceWith(figure);
      figure.append(pre);
      // Keep the source readable until Mermaid replaces it; `mermaid` is not a colouring language, so skip the unknown-language warning.
      code.replaceChildren();
      appendSource(code, text, type, settings);
      continue;
    }
    code.replaceChildren();
    appendSource(code, text, type, settings);
    if (['geojson', 'topojson', 'stl'].includes(language))
      warnings.add(language + ' remains visible source (local rendering unavailable)');
    else if (language && type === 'unknown')
      warnings.add('Unknown code language ' + language + ': readable uncolored source');
  }
  for (const issue of unsupported) {
    const snippet = fallbackSource(source, issue.from, issue.to, hiddenComments);
    if (!snippet.trim() || container.textContent?.includes(snippet))
      continue;
    const fallback = document.createElement('pre');
    fallback.className = 'unsupported-source';
    fallback.textContent = snippet;
    container.append(fallback);
  }
  for (const el of container.querySelectorAll<HTMLElement>('*')) {
    el.removeAttribute('style');
    for (const name of ['href', 'src'])
      if (el.hasAttribute(name)) {
        const url = safeURL(el.getAttribute(name)!, name === 'src');
        if (url)
          el.setAttribute(name, url);
        else
          el.removeAttribute(name);
      }
    if (el.hasAttribute('align') && !/^(left|center|right|justify)$/i.test(el.getAttribute('align')!))
      el.removeAttribute('align');
    for (const name of ['width', 'height'])
      if (el.hasAttribute(name) && !/^(?:[1-9]\d{0,3}|10000)$/.test(el.getAttribute(name)!))
        el.removeAttribute(name);
    if (el.tagName === 'A')
      el.setAttribute('rel', 'noopener noreferrer');
  }
  // Show maths as source until KaTeX replaces it (or for good if KaTeX cannot load).
  for (const el of container.querySelectorAll<HTMLElement>('[data-math]'))
    el.textContent = el.dataset.math === 'display' ? '$$\n' + el.dataset.tex + '\n$$' : '$' + el.dataset.tex + '$';
  return [...warnings];
}
