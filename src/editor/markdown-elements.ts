import type { FileType } from '../documents/file-types';
import type { SourceSelection, SourceCommandResult } from './source-commands';
import { decodeHTML, decodeHTMLStrict } from 'entities';
import type { LinkMdNode, MdNode, TableMdNode } from './parser';
import { newlineStyle, createProjection, bounds, markdownNodes, sourceLines, splice } from './source-projection';
import { syntaxSpans, commentSyntax } from './source-language';
import { headingAnchors } from './heading-anchors';
import { safeURL } from './safe-url';
import { escapeXml } from './parser/commonmark/common';
export type ElementRequest = {
    kind: string; text?: string; url?: string; heading?: number; rows?: number; columns?: number;
    language?: string; id?: string;
};
const label = (s: string) => s.replace(/\\/g, '\\\\').replace(/[\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ');
// Named references without a semicolon remain literal in attributes before = or
// alphanumerics; the dependency supplies the actual named/numeric decoding.
function unattr(value:string):string {
    return value.replace(/&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[a-zA-Z][a-zA-Z0-9]*;?)/g,(entity,offset:number)=>{
        if(entity[1]==='#')return decodeHTML(entity);
        if(entity.endsWith(';'))return decodeHTMLStrict(entity);
        if(value[offset+entity.length]==='='||decodeHTMLStrict(entity+';')===entity+';')return entity;
        return decodeHTML(entity);
    });
}
function replace(source: string, from: number, to: number, text: string): SourceCommandResult {
    const caret = from + text.length;
    return { source: splice(source, from, to, text), selection: { anchor: caret, head: caret } };
}
function literal(source: string, from: number, to = from) { return syntaxSpans(source, 'markdown').some(s => ['code', 'comment', 'html', 'url'].includes(s.kind) && (from === to ? s.from < from && s.to > from : s.from < to && s.to > from)); }
const templates: Partial<Record<FileType, [id: string, label: string, text: string][]>> = {
    markdown: [
        ['basic', 'Basic document', '# Title\n\nIntroduction.\n\n## Section\n\nContent.'],
        ['readme', 'README starter',
            '# Project name\n\nDescription.\n\n## Installation\n\nInstallation steps.\n\n## Usage\n\nUsage example.'],
        ['checklist', 'Checklist', '## Checklist\n\n- [ ] First task\n- [ ] Second task'],
    ],
    javascript: [
        ['function', 'Function', 'function example() {\n  return undefined;\n}'],
        ['class', 'Class', 'class Example {\n  constructor() {}\n}'],
        ['import', 'Import', "import { example } from './module.js';"],
    ],
    typescript: [
        ['function', 'Function', 'function example(): void {\n  // TODO\n}'],
        ['class', 'Class', 'class Example {\n  constructor() {}\n}'],
        ['import', 'Import', "import { example } from './module';"],
    ],
    html: [['element', 'HTML element', '<section>\n  <h2>Heading</h2>\n  <p>Content</p>\n</section>']],
    css: [['rule', 'CSS rule', '.example {\n  display: block;\n}']],
    json: [['property', 'JSON property', '"property": "value"']],
    yaml: [['property', 'YAML key/value', 'property: value']],
};
export function snippets(type: FileType): { id: string; label: string; text: string }[] {
    return (templates[type] ?? []).map(([id, label, text]) => ({ id, label, text }));
}
interface InsertContext {
    source: string; type: FileType; selected: string; from: number; to: number; nl: string;
}
/** Text to insert, and whether it is a block set apart by blank lines; or a whole result; or null. */
type Built = { text: string; block?: boolean } | SourceCommandResult | null;
type Builder = (r: ElementRequest, c: InsertContext) => Built;
const block = (text: string) => ({ text, block: true });
const linkTo = (image: boolean): Builder => (r, c) =>
    !r.url?.trim() || !safeURL(r.url, image) || /[<>\r\n]/.test(r.url) ? null
        : { text: (image ? '!' : '') + '[' + label(r.text ?? c.selected) + '](<' + r.url + '>)' };
const fenced: Builder = (r, c) => {
    if (r.language && !/^[a-zA-Z0-9_-]{0,40}$/.test(r.language))
        return null;
    const diagram = r.kind === 'diagram', content = c.selected || r.text || (diagram ? 'graph TD\n  A --> B' : 'code');
    const fence = '`'.repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map(s => s.length + 1)));
    return block(fence + (diagram ? 'mermaid' : r.language || '') + '\n' + content + '\n' + fence);
};
/** Inserts any file type takes. */
const anyFileBuilders: Partial<Record<string, Builder>> = {
    snippet: (r, c) => {
        const snippet = snippets(c.type).find(s => s.id === r.id);
        return snippet ? block(snippet.text) : null;
    },
    symbol: r => r.text ? { text: r.text } : null,
    comment: (_, c) => {
        const { line, block: pair } = commentSyntax(c.type);
        return line ? block(line + ' Comment') : pair ? block(pair[0] + ' Comment ' + pair[1]) : null;
    },
    details: (r, c) => !['markdown', 'html'].includes(c.type) ? null : block(
        '<details>\n<summary>' + escapeXml(r.text || 'Details') + '</summary>\n\n'
          + (c.selected || 'Content') + '\n\n</details>'),
};
/** Inserts only Markdown takes. */
const markdownBuilders: Partial<Record<string, Builder>> = {
    link: linkTo(false),
    image: linkTo(true),
    headingLink: (r, c) => {
        const heading = headingAnchors(c.source)[r.heading ?? -1];
        return heading ? { text: '[' + label(c.selected || heading.text) + '](<#' + heading.id + '>)' } : null;
    },
    toc: (_, c) => {
        const headings = headingAnchors(c.source), min = Math.min(...headings.map(h => h.level));
        const items = headings.map(h => '  '.repeat(h.level - min) + '- [' + label(h.text) + '](<#' + h.id + '>)');
        return items.length ? block(items.join(c.nl)) : null;
    },
    table: ({ rows = 0, columns = 0 }, c) => {
        if (!Number.isInteger(rows) || !Number.isInteger(columns)) return null;
        if (rows < 2 || rows > 100 || columns < 1 || columns > 50) return null;
        const row = (cell: string) => '| ' + Array(columns).fill(cell).join(' | ') + ' |';
        return block([row('Header'), row('---'), ...Array(rows - 1).fill(row(''))].join(c.nl));
    },
    hr: () => block('---'),
    lineBreak: (_, c) => ({ text: '  ' + c.nl }),
    codeBlock: fenced,
    diagram: fenced,
    footnote: (r, c) => {
        let id = 'note', n = 1;
        while (new RegExp('\\[\\^' + id + '\\]').test(c.source))
            id = 'note-' + (++n);
        const marker = '[^' + id + ']', note = (r.text || 'Note').replace(/[\r\n]+/g, ' ');
        const caret = c.from + marker.length;
        const source = splice(c.source, c.from, c.to, marker + c.selected) + c.nl + c.nl + marker + ': ' + note;
        return { source, selection: { anchor: caret, head: caret } };
    },
    alert: (r, c) => {
        const kind = r.id || 'NOTE';
        if (!['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].includes(kind))
            return null;
        const text = (c.selected || r.text || 'Alert text').replace(/\r\n|\r|\n/g, '\n> ');
        return block('> [!' + kind + ']\n> ' + text);
    },
    math: (r, c) => block('$$\n' + (c.selected || r.text || 'x^2') + '\n$$'),
};
export function insertElement(
    source: string, selection: SourceSelection, type: FileType, r: ElementRequest,
): SourceCommandResult | null {
    const { from, to } = bounds(selection);
    const selected = source.slice(from, to), nl = newlineStyle(source), markdown = markdownBuilders[r.kind];
    if (markdown) {
        if (type !== 'markdown')
            return null;
        // Literal text takes no Markdown, but a selected link may be replaced and selected text fenced.
        const wholeLink = () => { const link = linkContext(source, selection); return link?.from === from && link.to === to; };
        if (literal(source, from, to) && !(r.kind === 'codeBlock' && from !== to) && !(r.kind === 'link' && wholeLink()))
            return null;
    }
    const built = (markdown ?? anyFileBuilders[r.kind])?.(r, { source, type, selected, from, to, nl });
    if (!built || 'source' in built)
        return built ?? null;
    let text = built.text.replace(/\r\n|\r|\n/g, nl);
    if (built.block) {
        const before = source.slice(0, from), after = source.slice(to);
        const above = before && !before.replace(/\r\n|\r/g, '\n').endsWith('\n\n') ? nl.repeat(before.endsWith(nl) ? 1 : 2) : '';
        const below = after && !after.replace(/\r\n|\r/g, '\n').startsWith('\n\n') ? nl.repeat(after.startsWith(nl) ? 1 : 2) : '';
        text = above + text + below;
    }
    return replace(source, from, to, text);
}
/** The owned parser decides table eligibility, ancestry and complete row boundaries.
 * Owned cell spans retain raw escapes and ignored extra cells through edits. */
export function tableContext(source: string, selection: SourceSelection) {
    const selected=bounds(selection), ls=sourceLines(source);
    for(const node of markdownNodes(source)) {
        if(node.type!=='table')continue;
        const table=node as TableMdNode;
        const rowWalker=table.walker();
        const rows:{start:number;text:string;eol:string;prefix:string;content:string;suffix:string;
            cellSpans:{text:string;from:number;to:number}[]}[]=[];
        let rowEvent;
        while((rowEvent=rowWalker.next())) {
            const node=rowEvent.node;
            if(!rowEvent.entering||!['tableRow','tableDelimRow'].includes(node.type)||!node.sourcepos)continue;
            const [start,end]=node.sourcepos,line=ls[start[0]-1];
            if(!line)continue;
            const cellSpans:{text:string;from:number;to:number}[]=[];
            for(let cell=node.firstChild;cell;cell=cell.next) {
                if(!cell.sourcepos)continue;
                const [cellStart,cellEnd]=cell.sourcepos;
                const raw=line.text.slice(cellStart[1]-1,cellEnd[1]),text=raw.trim();
                const from=line.start+cellStart[1]-1+raw.length-raw.trimStart().length;
                cellSpans.push({text,from,to:line.start+cellEnd[1]});
            }
            const eol=source.slice(line.start+line.text.length,ls[start[0]]?.start);
            rows.push({...line,eol,cellSpans,prefix:line.text.slice(0,start[1]-1),
                content:line.text.slice(start[1]-1,end[1]),suffix:line.text.slice(end[1])});
        }
        if(rows.length<2||!table.columns.length)continue;
        const from=rows[0].start,to=rows.at(-1)!.start+rows.at(-1)!.text.length;
        if(selected.from<from||selected.to>to)continue;
        const row=Math.max(0,rows.findIndex(line=>selected.from<=line.start+line.text.length));
        const rowCells=rows[row].cellSpans;
        const column=Math.min(table.columns.length-1,Math.max(0,rowCells.findIndex(cell=>selected.from<=cell.to)));
        const values=rows.map(line=>{const values=line.cellSpans.map(cell=>cell.text);while(values.length<table.columns.length)values.push('');return values;});
        return {from,to,rows,row,column,columnCount:table.columns.length,cells:values};
    }
    return null;
}
/** The text of the next or previous cell, skipping the delimiter row; at the table's ends, no move. */
export function tableCell(source: string, selection: SourceSelection, step: 1 | -1): SourceSelection | null {
    const table = tableContext(source, selection), { from } = bounds(selection);
    if (!table) return null;
    const cells = table.rows.flatMap((row, index) => index === 1 ? [] : row.cellSpans);
    const cell = step > 0 ? cells.find(c => c.from > from) : cells.filter(c => c.to < from).at(-1);
    return cell ? { anchor: cell.from, head: cell.from + cell.text.length } : selection;
}
export type TableOperation = 'addRowToUp' | 'addRowToDown' | 'removeRow' | 'addColumnToLeft' | 'addColumnToRight' | 'removeColumn' | 'alignColumn' | 'removeTable';
export function transformTable(source: string, selection: SourceSelection, op: TableOperation, align: 'left' | 'center' | 'right' = 'left'): SourceCommandResult | null {
    const c = tableContext(source, selection);
    if (!c)
        return null;
    if (op.startsWith('addRow') && c.rows.length >= 101 || op.startsWith('addColumn') && c.columnCount >= 50)
        return null;
    if (op === 'removeTable')
        return replace(source, c.from, c.to, c.rows[0].prefix);
    const rows = c.cells.map(r => [...r]), eols = c.rows.map(r => r.eol), prefixes=c.rows.map(r=>r.prefix),suffixes=c.rows.map(r=>r.suffix);
    if (op === 'removeRow') {
        if (c.row < 2 || rows.length <= 3)
            return null;
        rows.splice(c.row, 1);
        eols.splice(c.row, 1);
        prefixes.splice(c.row,1);suffixes.splice(c.row,1);
    }
    else if (op.startsWith('addRow')) {
        const at = Math.max(2, c.row + (op === 'addRowToDown' ? 1 : 0));
        rows.splice(at, 0, Array(c.columnCount).fill(''));
        eols.splice(at, 0, newlineStyle(source));
        prefixes.splice(at,0,c.rows[1].prefix);suffixes.splice(at,0,'');
    }
    else if (op === 'removeColumn') {
        if (c.columnCount <= 1)
            return null;
        rows.forEach(r => r.splice(c.column, 1));
    }
    else if (op.startsWith('addColumn')) {
        const at = c.column + (op === 'addColumnToRight' ? 1 : 0);
        rows.forEach((r, i) => r.splice(at, 0, i === 1 ? '---' : ''));
    }
    else if (op === 'alignColumn') {
        rows[1][c.column] = align === 'center' ? ':---:' : align === 'right' ? '---:' : ':---';
    }
    else
        return null;
    const text = rows.map((r, i) => prefixes[i]+'| ' + r.join(' | ') + ' |'+suffixes[i] + (i < rows.length - 1 ? eols[i] || newlineStyle(source) : '')).join('');
    return replace(source, c.from, c.to, text);
}
function semanticLabel(node:MdNode):string {
    const walker=node.walker(),parts:string[]=[];let event;
    while((event=walker.next())) {
        if(!event.entering)continue;
        if(['text','code'].includes(event.node.type)&&event.node.literal!==null)parts.push(event.node.literal);
        else if(['softbreak','linebreak'].includes(event.node.type))parts.push(' ');
    }
    return parts.join('');
}
/** Parser spans handle inline, titled and reference links without truncating nested destinations. */
export function linkContext(source: string, selection: SourceSelection, image = false) {
    const selected = bounds(selection), projection = createProjection(source);
    for (const node of markdownNodes(source) as LinkMdNode[]) {
        if (node.type !== (image ? 'image' : 'link') || !node.sourcepos)
            continue;
        const { from, to } = projection.rangeOf(node.sourcepos);
        if (from > selected.from || to < selected.to)
            continue;
        const raw = source.slice(from, to), opening = image ? 2 : 1;
        let closing = opening, depth = 1;
        for (; closing < raw.length; closing++) {
            if (raw[closing] === '\\') {
                closing++;
                continue;
            }
            if (raw[closing] === '[')
                depth++;
            if (raw[closing] === ']' && !--depth)
                break;
        }
        return { from, to, alt: image||!raw.startsWith('[')?semanticLabel(node):raw.slice(opening, closing).replace(/\\([\[\]\\])/g, '$1'), url: node.destination || '', title: node.title || '' };
    }
    return null;
}
export function imageContext(source: string, selection: SourceSelection) {
    const md = linkContext(source, selection, true);
    if (md && !safeURL(md.url, true))
        return null;
    if (md)
        return { ...md, width: '', height: '', align: '' };
    const { from, to } = bounds(selection);
    for (const m of source.matchAll(/<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
        if (m.index! > from || m.index! + m[0].length < to)
            continue;
        if (syntaxSpans(source, 'markdown').some(s => s.from <= m.index! && s.to > m.index! && (['code', 'comment'].includes(s.kind) || s.kind === 'html' && source.slice(s.from, s.to) !== m[0])))
            continue;
        const attrs = new Map([...m[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(a => [a[1].toLowerCase(), unattr(a[2] ?? a[3] ?? a[4])]));
        const url = attrs.get('src') || '';
        if (!safeURL(url, true))
            return null;
        return { from: m.index!, to: m.index! + m[0].length, url, alt: attrs.get('alt') || '', title: attrs.get('title') || '', width: attrs.get('width') || '', height: attrs.get('height') || '', align: attrs.get('align') || '' };
    }
    return null;
}
export interface ImageTransform {
    width?: number;
    height?: number;
    keepProportions?: boolean;
    align?: 'left' | 'center' | 'right';
    reset?: boolean;
}
export function transformImage(source: string, selection: SourceSelection, r: ImageTransform): SourceCommandResult | null {
    const c = imageContext(source, selection);
    if (!c)
        return null;
    if ([r.width, r.height].some(n => n !== undefined && (!Number.isInteger(n) || n < 1 || n > 10000)))
        return null;
    let width = r.reset ? '' : r.width === undefined ? c.width : String(r.width), height = r.reset ? '' : r.height === undefined ? c.height : String(r.height);
    if (r.keepProportions && r.width !== undefined)
        height = '';
    else if (r.keepProportions && r.height !== undefined)
        width = '';
    const alignment = r.align ?? c.align;
    const attribute = (name: string, value?: string) => value ? ` ${name}="${escapeXml(value)}"` : '';
    const text = `<img src="${escapeXml(c.url)}" alt="${escapeXml(c.alt)}"` + attribute('width', width)
      + attribute('height', height) + attribute('align', alignment) + attribute('title', c.title) + '>';
    return replace(source, c.from, c.to, text);
}
