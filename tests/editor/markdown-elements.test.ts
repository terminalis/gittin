import { describe, it, expect } from 'vitest';
import { insertElement, tableCell, tableContext, transformTable, imageContext, transformImage, snippets } from '@/markdown-elements';
const at = (n: number) => ({ anchor: n, head: n });
describe('canonical element insertion', () => {
    it('preserves BOM and unrelated mixed separators with escaped labels and destinations', () => {
        const s = '\ufefflabel\r\nother\n';
        const r = insertElement(s, { anchor: 1, head: 6 }, 'markdown', { kind: 'link', url: 'https://x/a(b)', text: 'a [b]' });
        expect(r?.source).toBe('\ufeff[a \\[b\\]](<https://x/a(b)>)\r\nother\n');
        expect(insertElement(s, at(1), 'markdown', { kind: 'image', url: 'javascript:alert(1)', text: 'x' })).toBeNull();
    });
    it('shares duplicate Unicode heading anchors and selected heading label', () => {
        const s = '# Héllo\r\n## Héllo\nlabel';
        expect(insertElement(s, { anchor: s.length - 5, head: s.length }, 'markdown', { kind: 'headingLink', heading: 1 })?.source).toBe('# Héllo\r\n## Héllo\n[label](<#héllo-1>)');
        expect(insertElement(s, at(s.length), 'markdown', { kind: 'toc' })?.source).toContain('- [Héllo](<#héllo>)\r\n  - [Héllo](<#héllo-1>)');
    });
    it('uses fences longer than selected backticks and collision-free footnotes', () => {
        expect(insertElement('``` x', { anchor: 0, head: 5 }, 'markdown', { kind: 'codeBlock', language: 'js' })?.source).toContain('````js\n``` x\n````');
        expect(insertElement('[^note]: old\n', at(0), 'markdown', { kind: 'footnote', text: 'new' })?.source).toContain('[^note-2]');
    });
    it('rejects literal context and offers bounded language stubs', () => {
        expect(insertElement('`literal`', at(3), 'markdown', { kind: 'link', url: '#x', text: 'x' })).toBeNull();
        expect(snippets('typescript').map(s => s.id)).toEqual(['function', 'class', 'import']);
        expect(insertElement('x', at(1), 'yaml', { kind: 'comment' })?.source).toContain('# Comment');
        expect(insertElement('', at(0), 'json', { kind: 'comment' })).toBeNull();
    });
});
describe('source table contexts', () => {
    const s = 'before\r\n| A\\|B | `x\\|y` | C |\r\n| --- | :---: | ---: |\n| a | b | c |\r\nafter';
    it('recognizes escaped and code pipes, transforms only the table and preserves separators', () => {
        const context = tableContext(s, at(s.indexOf(' b ') + 1));
        expect(context?.column).toBe(1);
        const r = transformTable(s, at(s.indexOf(' b ') + 1), 'removeColumn');
        expect(r?.source).toBe('before\r\n| A\\|B | C |\r\n| --- | ---: |\n| a | c |\r\nafter');
    });
    it('gates literal tables and validates minimum dimensions', () => {
        expect(tableContext('```\n| A |\n| --- |\n```', at(8))).toBeNull();
        expect(insertElement('', at(0), 'markdown', { kind: 'table', rows: 1, columns: 2 })).toBeNull();
        expect(transformTable('| A |\n| --- |\n| b |', at(2), 'removeColumn')).toBeNull();
    });
    it('moves between cell texts by position, skipping the delimiter row and staying put at the ends', () => {
        const table = '| a | b |\n| - | - |\n| c | d |', cell = (text: string) => {
            const from = table.lastIndexOf(text);
            return { anchor: from, head: from + 1 };
        };
        expect(tableCell(table, at(2), 1)).toEqual(cell('b'));
        expect(tableCell(table, at(12), 1)).toEqual(cell('c'));
        expect(tableCell(table, at(12), -1)).toEqual(cell('b'));
        expect(tableCell(table, at(26), 1)).toEqual(at(26));
        expect(tableCell(table, at(2), -1)).toEqual(at(2));
        expect(tableCell('plain', at(0), 1)).toBeNull();
    });
});
describe('source image formatting', () => {
    it('escapes attributes and retains one dimension for proportions, alignment and reset', () => {
        const s = 'a ![a "b"](https://x/a.png) z', sel = at(8);
        expect(imageContext(s, sel)?.alt).toBe('a "b"');
        const sized = transformImage(s, sel, { width: 120, height: 50, keepProportions: true })!;
        expect(sized.source).toBe('a <img src="https://x/a.png" alt="a &quot;b&quot;" width="120"> z');
        expect(transformImage(sized.source, sel, { align: 'center' })?.source).toContain('align="center"');
        expect(transformImage(sized.source, sel, { reset: true })?.source).not.toContain('width=');
        expect(transformImage(s, sel, { width: -1 })).toBeNull();
    });
});
import { linkContext } from '@/markdown-elements';
describe('parser-backed boundaries and generated source', () => {
    it('updates titled, reference and nested destinations without changing definitions', () => {
        const s = 'before [old [label]](https://x/a(b) "title") after';
        const c = linkContext(s, at(12));
        expect(c?.url).toBe('https://x/a(b)');
        expect(insertElement(s, { anchor: c!.from, head: c!.to }, 'markdown', { kind: 'link', url: '#x', text: 'new' })?.source).toBe('before [new](<#x>) after');
        const reference = '[old][ref]\r\n\r\n[ref]: https://x/a(b) "title"\n';
        expect(linkContext(reference, at(3))?.url).toBe('https://x/a(b)');
        expect(imageContext('`![x](https://x)`', at(8))).toBeNull();
    });
    it('gives block insertions real blank lines around CRLF and hard breaks only two spaces', () => {
        expect(insertElement('before\r\nafter', at(8), 'markdown', { kind: 'hr' })?.source).toBe('before\r\n\r\n---\r\n\r\nafter');
        expect(insertElement('ab\r\nother\n', { anchor: 1, head: 1 }, 'markdown', { kind: 'lineBreak' })?.source).toBe('a  \r\nb\r\nother\n');
    });
    it('preserves declared image dimensions and title unless explicitly reset or locked', () => {
        const s = 'before <img src="https://x/a.png" alt="a" title="caption" width="100" height="50" align="right"> after';
        expect(transformImage(s, at(12), { align: 'left' })?.source).toContain('width="100" height="50" align="left" title="caption"');
        expect(transformImage(s, at(12), { reset: true })?.source).toBe('before <img src="https://x/a.png" alt="a" align="right" title="caption"> after');
        expect(transformImage(s, at(12), { height: 80, keepProportions: true })?.source).not.toContain('width=');
    });
    it('inserts bounded language starters and comment stubs without interpreting code as Markdown', () => {
        for (const type of ['markdown', 'javascript', 'typescript', 'html', 'css', 'json', 'yaml'] as const)
            for (const snippet of snippets(type))
                expect(insertElement('', at(0), type, { kind: 'snippet', id: snippet.id })?.source).toBe(snippet.text);
        expect(insertElement('', at(0), 'html', { kind: 'details' })?.source).toContain('<summary>Details</summary>');
        expect(insertElement('', at(0), 'text', { kind: 'toc' })).toBeNull();
        expect(insertElement('', at(0), 'markdown', { kind: 'image', url: 'https://x/"a', text: 'quoted' })).not.toBeNull();
    });
});
it('rejects image formatting in comments, raw/literal regions and unsafe destinations', () => {
    for (const source of ['<!-- <img src="https://x/a.png"> -->', '<script>const x="<img src=\"https://x/a.png\">";</script>', '`<img src="https://x/a.png">`', '![x](javascript:alert(1))'])
        expect(imageContext(source, at(source.indexOf('img') >= 0 ? source.indexOf('img') + 2 : 3))).toBeNull();
});
it('supports the complete contextual row/column/alignment catalogue in a single bounded table span',()=>{
 const source='lead\r\n| A | B |\r\n| --- | --- |\n| a | b |\r\n| c | d |\nend',selection=at(source.indexOf(' b ')+1);
 expect(transformTable(source,selection,'addRowToUp')?.source).toContain('| --- | --- |\n|  |  |\r\n| a | b |');
 expect(transformTable(source,selection,'addRowToDown')?.source).toContain('| a | b |\r\n|  |  |\r\n| c | d |');
 expect(transformTable(source,selection,'removeRow')?.source).toBe('lead\r\n| A | B |\r\n| --- | --- |\n| c | d |\nend');
 expect(transformTable(source,selection,'addColumnToLeft')?.source).toContain('| A |  | B |');
 expect(transformTable(source,selection,'addColumnToRight')?.source).toContain('| A | B |  |');
 expect(transformTable(source,selection,'alignColumn','right')?.source).toContain('| --- | ---: |');
 expect(transformTable(source,selection,'removeTable')?.source).toBe('lead\r\n\nend');
});
describe('Task4 review regressions',()=>{
 it('rejects indented/fenced literal pipe tables without deleting code',()=>{
  for(const source of ['    | A | B |\n    | --- | --- |\n    | a | b |','```md\n| A | B |\n| --- | --- |\n| a | b |\n```']){expect(tableContext(source,at(source.indexOf('A')))).toBeNull();expect(transformTable(source,at(source.indexOf('A')),'removeTable')).toBeNull();}
 });
 it('uses complete ragged table bounds and retains extra raw cell text for non-deletion transforms',()=>{
  const source='before\r\n| A | B |\r\n| - | - |\n| one |\r\n| two | three | extra |\n\r\nafter',selection=at(source.indexOf('one'));
  expect(tableContext(source,selection)?.rows).toHaveLength(4);
  expect(transformTable(source,selection,'removeTable')?.source).toBe('before\r\n\n\r\nafter');
  expect(transformTable(source,selection,'alignColumn','center')?.source).toContain('| two | three | extra |');
  expect(transformTable(source,selection,'removeColumn')?.source).toContain('| three | extra |');
  expect(transformTable(source,selection,'addColumnToRight')?.source).toContain('| two |  | three | extra |');
 });
 it('preserves blockquote/list prefixes and mixed separators while adding/removing rows or columns',()=>{
  for(const [header,continuation] of [['> ', '> '],['- ', '  '],['> - ', '>   ']]){
   const source='lead\r\n'+header+'| A | B |\r\n'+continuation+'| - | - |\n'+continuation+'| one |\r\n'+continuation+'| two | three | extra |\n\r\nafter',selection=at(source.indexOf('one'));
   expect(tableContext(source,selection)?.rows).toHaveLength(4);
   const added=transformTable(source,selection,'addRowToDown')!.source;expect(added).toContain(continuation+'| one |  |\r\n'+continuation+'|  |  |\r\n');expect(added).toContain(header+'| A | B |');expect(added).toContain(continuation+'| two | three | extra |');
   expect(transformTable(source,selection,'removeTable')?.source).toBe('lead\r\n'+header+'\n\r\nafter');
   expect(transformTable(source,selection,'removeColumn')?.source).toContain(continuation+'| three | extra |');
  }
 });
 it('preserves semantic image URL/alt/title and rejects entity-obfuscated unsafe decoded URLs',()=>{
  const html='<img src="https://x/a&#46;png?q=1&amp;x=2" alt="&#169; &copy; &#x26;" title="a &quot;b&quot;">';
  expect(transformImage(html,at(8),{width:120})?.source).toBe('<img src="https://x/a.png?q=1&amp;x=2" alt="© © &amp;" width="120" title="a &quot;b&quot;">');
  const md='![a &amp; **b** `c`](https://x/a&#46;png "title &amp;")';expect(transformImage(md,at(8),{width:120})?.source).toBe('<img src="https://x/a.png" alt="a &amp; b c" width="120" title="title &amp;">');
  for(const src of ['java&#115;cript:alert(1)','javascript&#58;alert(1)','java&NewLine;script:alert(1)'])expect(imageContext('<img src="'+src+'" alt="x">',at(8))).toBeNull();
 });
 it('prefills autolinks from parsed semantic text without closing angle delimiters',()=>{
  const source='before <https://example.com> after',c=linkContext(source,at(15))!;expect(c.alt).toBe('https://example.com');expect(insertElement(source,{anchor:c.from,head:c.to},'markdown',{kind:'link',url:'https://new.example',text:c.alt})?.source).toBe('before [https://example.com](<https://new.example>) after');
 });
});

it('uses owned table-cell spans for unmatched ticks, escapes and ignored extra cells',()=>{
 const source='| A | B |\n| --- | --- |\n| `unclosed | b |',selection=at(source.indexOf(' b ')+1);
 expect(tableContext(source,selection)?.column).toBe(1);expect(transformTable(source,selection,'removeColumn')?.source).toBe('| A |\n| --- |\n| `unclosed |');
 const escaped='| A | B |\n| --- | --- |\n| `unclosed\\|raw | b | extra |';expect(transformTable(escaped,at(escaped.indexOf(' b ')+1),'removeColumn')?.source).toBe('| A |\n| --- |\n| `unclosed\\|raw | extra |');
});
it('decodes image attributes using attribute-context entity rules',()=>{
 const source='<img src="https://x/?id=1&copy=2&notit;" alt="&notit; &copy &copy; &#169 &#xA9; &amp= &amp!" title="&quot title">';
 expect(transformImage(source,at(8),{width:120})?.source).toBe('<img src="https://x/?id=1&amp;copy=2&amp;notit;" alt="&amp;notit; \u00a9 \u00a9 \u00a9 \u00a9 &amp;amp= &amp;!" width="120" title="&quot; title">');
});
