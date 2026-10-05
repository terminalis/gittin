import { Parser } from '@/parser/commonmark/blocks';
import { Renderer } from '@/parser/html/renderer';
import { pos } from '../../__test__/helper';

const reader = new Parser();
const renderer = new Renderer();
const box = (checked: boolean, label: string, mark: string) =>
  `<span role="checkbox" aria-checked="${checked}" aria-readonly="true" aria-label="${label}">${mark}</span>`;
const done = box(true, 'Completed', '[x]');
const todo = box(false, 'Not completed', '[ ]');

describe('Task list item', () => {
  it('Parse', () => {
    const root = reader.parse(['- [ ] Item1', '-  [x] Item2', '-   [X]  Item3'].join('\n'));
    expect(root).toMatchObject({
      firstChild: {
        type: 'list',
        firstChild: {
          type: 'item',
          listData: {
            task: true,
            checked: false,
          },
          firstChild: {
            type: 'paragraph',
            sourcepos: pos(1, 7, 1, 11),
          },
          next: {
            type: 'item',
            listData: {
              task: true,
              checked: true,
            },
            firstChild: {
              type: 'paragraph',
              sourcepos: pos(2, 8, 2, 12),
            },
            next: {
              type: 'item',
              listData: {
                task: true,
                checked: true,
              },
              firstChild: {
                type: 'paragraph',
                sourcepos: pos(3, 10, 3, 14),
              },
            },
          },
        },
      },
    });
  });

  // https://github.github.com/gfm/#example-279
  it('GFM Example 279', () => {
    const input = ['- [ ] foo', '- [x] bar'].join('\n');
    const output = ['<ul>', `<li>${todo} foo</li>`, `<li>${done} bar</li>`, '</ul>'].join('\n');

    const root = reader.parse(input);
    const html = renderer.render(root);

    expect(html).toEqual(`${output}\n`);
  });

  // https://github.github.com/gfm/#example-280
  it('GFM Example 280', () => {
    const input = ['- [x] foo', '  - [ ] bar', '  - [x] baz', '- [ ] bim'].join('\n');
    const output = [
      '<ul>', `<li>${done} foo`, '<ul>', `<li>${todo} bar</li>`, `<li>${done} baz</li>`, '</ul>',
      '</li>', `<li>${todo} bim</li>`, '</ul>',
    ].join('\n');

    const root = reader.parse(input);
    const html = renderer.render(root);

    expect(html).toEqual(`${output}\n`);
  });
});
