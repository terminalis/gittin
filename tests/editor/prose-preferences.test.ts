import { describe, it, expect } from 'vitest';
import { automaticSubstitution, proseTypedCharacter, ruleError, spellcheckEnabled, sourceLinks } from '@/prose-preferences';
import { toolbarGroups, toolbarVisible } from '@/controls/controls';
const rule=(replace:string,withText:string,enabled=true)=>({replace,with:withText,enabled});
describe('device prose preferences',()=>{
 it('automatically expands completed shortcuts, chooses the longest match and never cascades',()=>{
  const rules=[rule('teh','the'),rule('the','other'),rule('hello teh','greeting'),rule('(c)','©')];
  const expand=(before:string,insert=' ')=>automaticSubstitution(before+insert,{anchor:before.length+insert.length,head:before.length+insert.length},'markdown',{from:before.length,to:before.length,insert},{substitutions:rules});
  expect(expand('teh')?.source).toBe('the ');
  expect(expand('teh',',')?.source).toBe('the,');
  expect(expand('hello teh')?.source).toBe('greeting ');
  expect(expand('(c)')?.selection).toEqual({anchor:2,head:2});
  expect(expand('somewhere\r\n- teh','\r\n- ')?.source).toBe('somewhere\r\n- the\r\n- ');
  expect(expand('\ufeffteh','\r\n')?.source).toBe('\ufeffthe\r\n');
  expect(expand('someteh')).toBeNull();
  expect(expand('𠀀teh')).toBeNull();
  expect(expand('teh','x')).toBeNull();
  expect(expand('teh',' pasted text')).toBeNull();
 });
 it('allows punctuation-leading substitution rules to fire after word characters',()=>{
  const rules=[rule('...','…'),rule('(tm)','™'),rule('teh','the')];
  const expand=(before:string,insert=' ')=>automaticSubstitution(before+insert,{anchor:before.length+insert.length,head:before.length+insert.length},'markdown',{from:before.length,to:before.length,insert},{substitutions:rules});
  expect(expand('Wait...')?.source).toBe('Wait… ');
  expect(expand('Brand(tm)')?.source).toBe('Brand™ ');
  expect(expand('someteh')).toBeNull();
 });
 it('keeps automatic substitutions out of literal syntax, code files and disabled settings',()=>{
  const rules=[rule('teh','the')];
  for(const before of ['`teh','```md\nteh','    teh','[label](https://x/teh','https://x/teh','<ins>teh','<!-- teh','[teh']) {
   const source=before+' ',at=before.length;
   expect(automaticSubstitution(source,{anchor:at+1,head:at+1},'markdown',{from:at,to:at,insert:' '},{substitutions:rules}),before).toBeNull();
  }
  for(const preferences of [{substitutions:rules,automaticSubstitution:false},{substitutions:[rule('teh','the',false)]}])
   expect(automaticSubstitution('teh ',{anchor:4,head:4},'markdown',{from:3,to:3,insert:' '},preferences)).toBeNull();
  expect(automaticSubstitution('teh ',{anchor:4,head:4},'typescript',{from:3,to:3,insert:' '},{substitutions:rules})).toBeNull();
  expect(automaticSubstitution('teh ',{anchor:4,head:4},'markdown',{from:3,to:7,insert:' '},{substitutions:rules})).toBeNull();
 });
 it('starts empty, validates exact nonempty keys and keeps rule order for conflicts',()=>{
  expect(automaticSubstitution('text ',{anchor:5,head:5},'markdown',{from:4,to:4,insert:' '},{})).toBeNull();
  expect(ruleError('',[])).toContain('literal');expect(ruleError('a',[rule('a','b')])).toContain('unique');
  expect(ruleError('A',[rule('a','b')])).toBe('');expect(ruleError(' ',[])).toBe('');
 });
 it('capitalises conservative starts and types smart quotes without changing protected literals or pasted text',()=>{
  const p={capitalise:true,smartQuotes:true};
  const typed=(source:string,text:string,type:'markdown'|'javascript'='markdown')=>proseTypedCharacter(source,{anchor:source.length,head:source.length},type,text,p);
  expect(typed('','a')).toBe('A');expect(typed('Hello. ','w')).toBe('W');expect(typed('Hello ','w')).toBe('w');expect(typed('# ','h')).toBe('H');
  expect(typed('Hello. ','é')).toBe('É');expect(typed('','ж')).toBe('Ж');expect(typed('# ','ö')).toBe('Ö');expect(typed('Hello ','é')).toBe('é');
  expect(typed('','"')).toBe('\u201c');expect(typed('word','"')).toBe('\u201d');expect(typed('don',"'")).toBe('\u2019');
  for(const text of ['`literal','```js\n','[label](https://x/','<a title="','<ins>'])expect(typed(text,'"')).toBe('"');
  expect(typed('','alpha')).toBe('alpha');expect(typed('','a','javascript')).toBe('a');
  expect(proseTypedCharacter('',{anchor:0,head:0},'markdown','a',{})).toBe('a');
 });
 it('remembers spellcheck by Markdown/code category and exposes only safe known parser link destinations',()=>{
  expect(spellcheckEnabled({},'markdown')).toBe(true);expect(spellcheckEnabled({},'typescript')).toBe(false);
  expect(spellcheckEnabled({spellcheck:{code:true,markdown:false}},'html')).toBe(true);
  expect(spellcheckEnabled({spellcheck:{code:true,markdown:false}},'markdown')).toBe(false);
  expect(spellcheckEnabled({},'text')).toBe(true);expect(spellcheckEnabled({spellcheck:{code:true,markdown:false}},'text')).toBe(false);
  expect(spellcheckEnabled({},'unknown')).toBe(false);
  const source='\ufeff[x](https://x/a(b))\r\n[bad](javascript:alert(1)) [ref][id]\n\n[id]: https://ref';
  expect(sourceLinks(source).map(link=>[source.slice(link.from,link.to),link.url])).toEqual([['[x](https://x/a(b))','https://x/a(b)'],['[ref][id]','https://ref']]);
 });
 it('includes all eight styles and Find; group hiding retains item choices and reset shows defaults',()=>{
  const prefs={toolbarGroups:{text:false},toolbarItems:{bold:false,find:false}};
  expect(toolbarVisible(prefs,'italic')).toBe(false);expect(toolbarVisible({...prefs,toolbarGroups:{}},'bold')).toBe(false);expect(toolbarVisible({...prefs,toolbarGroups:{}},'italic')).toBe(true);
  expect(toolbarGroups.flatMap(group=>[...group.items])).toEqual(expect.arrayContaining(['undo','find','bold','italic','strike','code','ins','sup','sub','mark']));
  expect(toolbarVisible({toolbarGroups:{},toolbarItems:{}},'find')).toBe(true);
 });
});
