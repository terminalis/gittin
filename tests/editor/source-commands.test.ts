import { describe, it, expect } from 'vitest';
import { applySourceCommand as apply, continuation, sourceCommandAvailable } from '@/source-commands';
import { commentRanges, proseRanges, syntaxSpans } from '@/source-language';
import { literalMatches } from '@/find';
import { splice } from '@/source-projection';
const range=(anchor:number,head=anchor)=>({anchor,head});
describe('canonical source commands',()=>{
  it('preserves BOM and mixed endings through line commands and reversed selections',()=>{
    const source='\uFEFFone\r\ntwo\nthree\rfour\n';
    expect(apply(source,range(9,6),'indent','javascript')?.source).toBe('\uFEFFone\r\n  two\nthree\rfour\n');
    const moved=apply(source,range(6,9),'moveLinesUp','javascript')!;
    expect(moved.source).toBe('\uFEFFtwo\r\none\nthree\rfour\n');
    expect(moved.selection).toEqual(range(1,4));
    expect(apply(source,range(source.length),'deleteLines','text')?.source).toBe('\uFEFFone\r\ntwo\nthree\rfour');
    expect(apply('one\r\ntwo',range(5),'duplicateLines','text')?.source).toBe('one\r\ntwo\r\ntwo');
    const multi=apply('aa\r\nbb\nc',range(6,0),'moveLinesDown','text')!;
    expect(multi.source).toBe('c\r\naa\nbb');expect(multi.selection).toEqual({anchor:8,head:3});
    expect(multi.source.slice(multi.selection.head,multi.selection.anchor)).toBe('aa\nbb');
    expect(apply('abc',range(2,0),'duplicateLines','text')).toEqual({source:'ababc',selection:{anchor:4,head:2}});
  });
  it('toggles all eight inline forms, including empty and reversed selections',()=>{
    for(const command of ['bold','italic','strike','code','ins','sup','sub','mark'] as const){
      const result=apply('alpha',range(5,0),command,'markdown')!;
      expect(result.selection.anchor).toBeGreaterThan(result.selection.head);
      expect(apply(result.source,result.selection,command,'markdown')?.source).toBe('alpha');
      const empty=apply('',range(0),command,'markdown')!; expect(empty.source.length).toBeGreaterThan(0);expect(empty.selection.anchor).toBe(empty.selection.head);
      expect(apply('alpha',range(0,5),command,'javascript')).toBeNull();
    }
  });
  it('inline code chooses a safe delimiter and restores padded content on toggle',()=>{
    for(const text of ['a `tick` b',' padded ','']) { const result=apply(text,range(0,text.length),'code','markdown')!;expect(apply(result.source,result.selection,'code','markdown')?.source).toBe(text); }
  });
  it('clears strikethrough written with one tilde or two',()=>{
    const text='a ~b~ c ~~d~~ ~/e';
    expect(apply(text,range(0,text.length),'clearFormatting','markdown')?.source).toBe('a b c d ~/e');
  });
  it('protects fences, inline literals, escaped markers and URLs',()=>{
    expect(apply('foo__bar__',range(0,10),'clearFormatting','markdown')?.source).toBe('foo__bar__');
    const text='```js\r\n**literal**\r\n```\nplain `literal` [**label**](https://x/**path**) \\*escaped*';
    expect(apply(text,range(7,18),'bold','markdown')).toBeNull();
    const clear=apply(text,range(0,text.length),'clearFormatting','markdown')!.source;
    expect(clear).toContain('```js\r\n**literal**\r\n```');expect(clear).toContain('[label](https://x/**path**)');expect(clear).toContain('\\*escaped*');
    expect(proseRanges('---\ntitle: literal\n---\nprose','markdown').map(r=>'---\ntitle: literal\n---\nprose'.slice(r.from,r.to))).toEqual(['prose']);
    expect(proseRanges('[label](https://x) <ins>HTML</ins> tail','markdown').map(r=>'[label](https://x) <ins>HTML</ins> tail'.slice(r.from,r.to)).join('')).toBe('  tail');
    expect(commentRanges('text: |\n  # literal\n# comment','yaml').map(r=>'text: |\n  # literal\n# comment'.slice(r.from,r.to))).toEqual(['# comment']);
    const prose=proseRanges(text,'markdown').map(r=>text.slice(r.from,r.to)).join(''); expect(prose).not.toContain('https:');expect(prose).not.toContain('**literal**');
  });
  it('recognizes comment syntax without treating quoted, template, regex or attribute text as comments',()=>{
    const js='const a="https://x/\\\"//"; const b=`/*template*/ ${1}`; const r=/[/*]\\/\\//; // real\r\n/* block */';
    expect(commentRanges(js,'javascript').map(r=>js.slice(r.from,r.to))).toEqual(['// real','/* block */']);
    const css='a{content:"/* text */"}/* yes */'; expect(commentRanges(css,'css').map(r=>css.slice(r.from,r.to))).toEqual(['/* yes */']);
    const html='<a href="https://x/<!--no-->">hi</a><!-- yes -->';expect(commentRanges(html,'html').map(r=>html.slice(r.from,r.to))).toEqual(['<!-- yes -->']);
    expect(syntaxSpans('const a="unterminated // literal','javascript')).toEqual([{from:8,to:32,kind:'string'}]);
  });
  it('lists, headings, alignment and whitespace use raw source ranges',()=>{
    expect(apply('one\r\ntwo',range(0,8),'taskList','markdown')?.source).toBe('- [ ] one\r\n- [ ] two');
    expect(apply('hello',range(5),'heading','markdown',2)?.source).toBe('## hello');
    expect(apply('## title',range(3),'heading','markdown',0)?.source).toBe('title');
    expect(apply('text',range(0),'alignCenter','markdown')?.source).toBe('<div align="center">text</div>');
    expect(apply('  a\r\n\tb',range(0,8),'outdent','javascript')?.source).toBe('a\r\nb');
  });
  it('whole-word matching keeps literal/case semantics and Unicode boundaries',()=>{
    const text='cat scatter cat_cat Cat cat. écat caté cat2 cat';
    expect(literalMatches(text,'cat',false,true).map(m=>text.slice(m.from,m.to))).toEqual(['cat','Cat','cat','cat']);
    expect(literalMatches(text,'cat',true,true)).toHaveLength(3);
    expect(literalMatches('a.b aXb','a.b',false,true)).toEqual([{from:0,to:3}]);
  });
});

describe('explicit comment conversions', () => {
  it('converts selected text and back without toggling, preserving direction, BOM and mixed endings', () => {
    for (const type of ['markdown', 'html', 'javascript', 'typescript', 'css'] as const) {
      const text = '\ufeffone\r\ntwo\n';
      for (const selection of [range(1, text.length), range(text.length, 1)]) {
        const once = apply(text, selection, 'convertToComment', type)!;
        expect(once.source).toBe(['markdown', 'html'].includes(type) ? '\ufeff<!--one\r\ntwo\n-->' : '\ufeff/*one\r\ntwo\n*/');
        expect(apply(once.source, once.selection, 'convertToComment', type)).toBeNull();
        const restored = apply(once.source, once.selection, 'convertToText', type)!;
        expect(restored).toEqual({ source:text, selection });
        expect(apply(restored.source, restored.selection, 'convertToText', type)).toBeNull();
      }
      expect(apply('abc', range(1), 'convertToComment', type)).toBeNull();
      expect(apply('', range(0), 'convertToComment', type)).toBeNull();
      expect(apply('  ', range(0, 2), 'convertToComment', type)).toBeNull();
    }
  });

  it('converts a comment containing the cursor or selection without touching surrounding text', () => {
    const text = 'before <!--abc--> after';
    for (const selection of [range(12), range(11, 14), range(7, 17)]) {
      expect(apply(text, selection, 'convertToText', 'markdown')?.source).toBe('before abc after');
    }
    const js = 'const url="https://x"; // note\r\n/*other*/';
    expect(apply(js, range(0, js.length), 'convertToText', 'javascript')?.source).toBe('const url="https://x"; note\r\nother');
    expect(apply('<!-- unfinished', range(8), 'convertToText', 'markdown')?.source).toBe(' unfinished');
    expect(apply('/*/', range(0, 3), 'convertToText', 'css')).toEqual({ source:'/', selection:range(0, 1) });
  });

  it('rejects Markdown comment conversions the parser would not read as one comment', () => {
    const cases: [string, string][] = [
      ['# Title\nbody text', 'Title\nbody'],
      ['- item one\n- item two', 'item one\n- i'],
      ['| a | b |\n|---|---|\n| c | d |', 'c | d'],
      ['one\n\ntwo', 'e\n\ntw'],
    ];
    for (const [text, selected] of cases) {
      const from = text.indexOf(selected);
      expect(apply(text, range(from, from + selected.length), 'convertToComment', 'markdown'), text).toBeNull();
    }
    expect(apply('one\n\ntwo', range(0, 8), 'convertToComment', 'markdown')?.source).toBe('<!--one\n\ntwo-->');
    expect(apply('a b c', range(2, 3), 'convertToComment', 'markdown')?.source).toBe('a <!--b--> c');
    expect(apply('a b\nc d', range(2, 5), 'convertToComment', 'markdown')?.source).toBe('a <!--b\nc--> d');
    expect(apply('<!--x-->\n\nx', range(10, 11), 'convertToComment', 'markdown')?.source).toBe('<!--x-->\n\n<!--x-->');
    expect(apply('<!--x-->\n\n# t\nx', range(14, 15), 'convertToComment', 'markdown')?.source).toBe('<!--x-->\n\n# t\n<!--x-->');
    expect(apply('<div>\nfoo\n</div>', range(6, 9), 'convertToComment', 'markdown')?.source).toBe('<div>\n<!--foo-->\n</div>');
    expect(apply('> <div>\n> foo\n> </div>', range(10, 13), 'convertToComment', 'markdown')?.source).toBe('> <div>\n> <!--foo-->\n> </div>');
    expect(apply('- <div>\n  foo\n  </div>', range(10, 13), 'convertToComment', 'markdown')?.source).toBe('- <div>\n  <!--foo-->\n  </div>');
    expect(apply('<div>foo</div>', range(5, 8), 'convertToComment', 'markdown')?.source).toBe('<div><!--foo--></div>');
    expect(apply('<div title="foo">x</div>', range(12, 15), 'convertToComment', 'markdown')).toBeNull();
    expect(apply('<div>\nfoo\n\nbar', range(6, 14), 'convertToComment', 'markdown')).toBeNull();
    expect(apply('<div>\nfoo\n\n# bar', range(6, 15), 'convertToComment', 'markdown')).toBeNull();
    expect(apply('<div>\nfoo\n</div>\n\nbar', range(6, 21), 'convertToComment', 'markdown')).toBeNull();
    for (const tag of ['script', 'style']) {
      const raw = `<${tag}>\nfoo\n</${tag}>`, at = raw.indexOf('foo');
      expect(apply(raw, range(at, at + 3), 'convertToComment', 'markdown'), tag).toBeNull();
    }
    expect(apply('<!--x-->\n\n# x\nx', range(13, 18), 'convertToComment', 'markdown')).toBeNull();
  });

  it('falls back to line comments when the JavaScript block form is rejected', () => {
    const text = 'const a = 1; // why\nconst b = 2;';
    const withBlock = 'a /* x */\nb';
    for (const type of ['javascript', 'typescript'] as const) {
      expect(apply(text, range(0, text.length), 'convertToComment', type)?.source).toBe('// const a = 1; // why\n// const b = 2;');
      expect(apply(withBlock, range(0, withBlock.length), 'convertToComment', type)?.source).toBe('// a /* x */\n// b');
    }
    expect(apply('/* x */', range(0, 7), 'convertToComment', 'css')).toBeNull();
  });

  it('uses YAML line syntax, preserves endings and indentation, and skips existing comments', () => {
    const text = '\ufeff  key: value\r\nnext: yes\n';
    const once = apply(text, range(text.length, 0), 'convertToComment', 'yaml')!;
    expect(once.source).toBe('\ufeff  # key: value\r\n# next: yes\n');
    expect(once.selection.anchor).toBeGreaterThan(once.selection.head);
    expect(apply(once.source, once.selection, 'convertToComment', 'yaml')).toBeNull();
    expect(apply(once.source, once.selection, 'convertToText', 'yaml')?.source).toBe(text);
    const mixed = '# existing\nkey: value';
    expect(apply(mixed, range(0, mixed.length), 'convertToComment', 'yaml')?.source).toBe('# existing\n# key: value');
    const scalar = 'text: |\n  literal\n';
    const commented = apply(scalar, range(0, scalar.length), 'convertToComment', 'yaml')!;
    expect(commented.source).toBe('# text: |\n  # literal\n');
    expect(apply(commented.source, commented.selection, 'convertToText', 'yaml')?.source).toBe(scalar);
    expect(apply(scalar, range(10, 15), 'convertToComment', 'yaml')).toBeNull();
  });

  it('does not reinterpret quoted markers, code, existing comments or unsupported files', () => {
    for (const [type, text] of [
      ['javascript', 'const x="/*literal*/";'], ['css', 'a{content:"/*literal*/"}'],
      ['html', '<a title="<!--literal-->">hi</a>'], ['markdown', '`<!--literal-->`'],
      ['yaml', 'text: |\n  # literal\n'],
    ] as const) {
      expect(apply(text, range(0, text.length), 'convertToText', type), type).toBeNull();
    }
    for (const [type, text, selection] of [
      ['javascript', 'const x="literal";', range(9, 16)],
      ['markdown', '`literal`', range(1, 8)],
      ['markdown', '<!--existing-->', range(4, 12)],
      ['css', '/*existing*/', range(2, 10)],
      ['javascript', '// existing', range(0, 11)],
      ['markdown', 'text --> text', range(0, 13)],
    ] as const) expect(apply(text, selection, 'convertToComment', type)).toBeNull();
    for (const type of ['json', 'text', 'unknown'] as const) {
      for (const command of ['convertToComment', 'convertToText'] as const) {
        expect(sourceCommandAvailable(command, type)).toBe(false);
        expect(apply('abc', range(0, 3), command, type)).toBeNull();
      }
    }
  });
});

describe('Task 2 review regressions', () => {
  it('protects balanced, escaped and uncertain link destinations from clearing and prose utilities', () => {
    for (const destination of ['https://example.com/a(b)**literal**', 'relative/a(b(c))**literal**', 'relative/a\\(b\\)**literal**', 'relative/a\\)b**literal**']) {
      const link = `[label](${destination})`;
      const text = link + ' **prose**';
      expect(apply(text, range(0, text.length), 'clearFormatting', 'markdown')?.source).toBe(link + ' prose');
      expect(proseRanges(text, 'markdown').map(r => text.slice(r.from, r.to)).join('')).toBe(' prose');
    }
    const nested = '[outer [inner]](relative/a(b)**literal**) tail';
    expect(proseRanges(nested, 'markdown').map(r => nested.slice(r.from, r.to)).join('')).toBe(' tail');
    const uncertain = '[label](relative/a(b)**literal**';
    expect(apply(uncertain, range(0, uncertain.length), 'clearFormatting', 'markdown')?.source).toBe(uncertain);
    expect(proseRanges(uncertain, 'markdown')).toEqual([]);
  });

  it('rejects alignment boundaries inside HTML attributes or raw content', () => {
    expect(apply('<a title="unfinished>', range(0, 21), 'alignCenter', 'html')).toBeNull();
    expect(apply('<script>unfinished', range(0, 18), 'alignCenter', 'html')).toBeNull();
    const attribute = '<a title="first\nsecond\nthird">text</a>';
    for (const type of ['markdown', 'html'] as const) {
      expect(apply(attribute, range(attribute.indexOf('second')), 'alignCenter', type)).toBeNull();
      expect(apply(attribute, range(0, attribute.length), 'alignCenter', type)?.source).toBe(`<div align="center">${attribute}</div>`);
      for (const tag of ['script', 'style', 'pre', 'code']) {
        const text = `<${tag}>first\nsecond\nthird</${tag}>`;
        expect(apply(text, range(text.indexOf('second')), 'alignCenter', type), tag).toBeNull();
        expect(apply(text, range(0, text.length), 'alignCenter', type)?.source).toBe(`<div align="center">${text}</div>`);
      }
    }
  });
});

describe('heading and list commands on lines with inline syntax', () => {
  it('apply on lines with links, inline code, HTML, escapes and web addresses', () => {
    const lines = ['see [guide](docs/guide.md)', 'use `x` here', '<b>x</b> y', '\\*literal\\*', 'https://example.com'];
    for (const line of lines) {
      expect(apply(line, range(0), 'heading', 'markdown', 1)?.source, line).toBe('# ' + line);
      expect(apply(line, range(0), 'bulletList', 'markdown')?.source, line).toBe('- ' + line);
    }
  });
  it('apply on a nested list item indented four spaces', () => {
    const nested = '- a\n    - b';
    expect(apply(nested, range(nested.length), 'taskList', 'markdown')?.source).toBe('- a\n    - [ ] b');
    expect(apply(nested, range(nested.length), 'orderedList', 'markdown')?.source).toBe('- a\n    1. b');
  });
  it('refuse inside a fence, an indented code block and front matter', () => {
    for (const source of ['```\ncode\n```', 'para\n\n    code', '---\ntitle: x\n---']) {
      const at = source.search(/code|title/);
      for (const command of ['heading', 'bulletList', 'orderedList', 'taskList'] as const)
        expect(apply(source, range(at), command, 'markdown', 1), source + ' ' + command).toBeNull();
    }
  });
  it('apply after a leading --- that no closing line makes front matter', () => {
    expect(apply('---\n\n- a', range(8), 'taskList', 'markdown')?.source).toBe('---\n\n- [ ] a');
  });
});

describe('blockquote', () => {
  it('adds and removes one level, keeping indentation, hard breaks and CRLF, and selects the lines', () => {
    const quoted = apply('one  \r\n  two', range(1, 9), 'blockQuote', 'markdown')!;
    expect(quoted).toEqual({ source: '> one  \r\n  > two', selection: range(0, 16) });
    expect(apply(quoted.source, quoted.selection, 'blockQuote', 'markdown')?.source).toBe('one  \r\n  two');
    expect(apply('>> a', range(0), 'blockQuote', 'markdown')?.source).toBe('> a');
  });
  it('quotes mixed and blank lines, and refuses inside a fence and outside Markdown', () => {
    expect(apply('> a\n\nb', range(0, 6), 'blockQuote', 'markdown')?.source).toBe('> > a\n> \n> b');
    expect(apply('', range(0), 'blockQuote', 'markdown')?.source).toBe('> ');
    expect(apply('```\ncode\n```', range(5), 'blockQuote', 'markdown')).toBeNull();
    expect(apply('a', range(0), 'blockQuote', 'javascript')).toBeNull();
  });
});

describe('Enter on a list item', () => {
  // The caret is shown as |.
  const enter = (text: string) => {
    const at = text.indexOf('|'), result = continuation(text.replace('|', ''), range(at));
    return result && splice(result.source, result.selection.head, result.selection.head, '|');
  };
  it('starts the next item: bullets, numbers, task boxes and indentation', () => {
    expect(enter('- a|')).toBe('- a\n- |');
    expect(enter('* a|b')).toBe('* a\n* |b');
    expect(enter('1. a|\n2. b')).toBe('1. a\n2. |\n3. b');
    expect(enter('4) a|')).toBe('4) a\n5) |');
    expect(enter('- [x] a|')).toBe('- [x] a\n- [ ] |');
    expect(enter('  - a|')).toBe('  - a\n  - |');
  });
  it('leaves the list on an empty item', () => {
    expect(enter('- [x] item\n- [ ] |')).toBe('- [x] item\n\n|');
    expect(enter('1. a\n2. |')).toBe('1. a\n\n|');
  });
  it('keeps CRLF and returns null outside a list', () => {
    expect(enter('- a|\r\n- b')).toBe('- a\r\n- |\r\n- b');
    expect(enter('plain|')).toBeNull();
    expect(enter('|- a')).toBeNull();
    expect(enter('```\n- a|\n```')).toBeNull();
  });
  it('continues a list after a leading --- that no closing line makes front matter', () => {
    expect(enter('---\n\n- a|')).toBe('---\n\n- a\n- |');
  });
});

describe('ordered-list renumbering after line commands', () => {
  const list = '1. one\n2. two\n3. three\n';
  it('renumbers after moving an item up', () => {
    expect(apply(list, range(list.indexOf('three')), 'moveLinesUp', 'markdown')!.source).toBe('1. one\n2. three\n3. two\n');
  });
  it('renumbers after moving the first item down', () => {
    expect(apply(list, range(0), 'moveLinesDown', 'markdown')!.source).toBe('1. two\n2. one\n3. three\n');
  });
  it('keeps the original start number after deleting the first item', () => {
    expect(apply(list, range(0), 'deleteLines', 'markdown')!.source).toBe('1. two\n2. three\n');
    expect(apply('4. a\n5. b\n', range(0), 'deleteLines', 'markdown')!.source).toBe('4. b\n');
  });
  it('renumbers after duplicating an item and leaves nested lists alone', () => {
    expect(apply(list, range(list.indexOf('two')), 'duplicateLines', 'markdown')!.source).toBe('1. one\n2. two\n3. two\n4. three\n');
    expect(apply('1. a\n   1. x\n   3. y\n2. b\n', range(0), 'duplicateLines', 'markdown')!.source).toBe('1. a\n2. a\n   1. x\n   3. y\n3. b\n');
  });
  it('keeps the selection on the moved text when a number changes length', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `${i + 1}. item${i + 1}`).join('\n');
    const moved = apply(ten, range(ten.indexOf('item10')), 'moveLinesUp', 'markdown')!;
    expect(moved.source.endsWith('9. item10\n10. item9')).toBe(true);
    expect(moved.source.slice(moved.selection.head, moved.selection.head + 6)).toBe('item10');
  });
  it('does not renumber numbered lines inside a code fence', () => {
    expect(apply('```\n1. a\n3. b\n```\n', range(4), 'duplicateLines', 'markdown')!.source).toBe('```\n1. a\n1. a\n3. b\n```\n');
  });
  it('does not renumber in other file types', () => {
    expect(apply('1. a\n2. b\n', range(0), 'moveLinesDown', 'text')!.source).toBe('2. b\n1. a\n');
  });
});
