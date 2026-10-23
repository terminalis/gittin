import { expect, test } from 'vitest';
import { changedSections, commitMessage } from '../../src/native/messages';

const doc = '# Introduction\nold\n\n## Usage\nsame\n\n## Limits\nsame\n';

test('the sections whose lines changed are named by their headings', () => {
  expect(changedSections(doc, doc.replace('old', 'new'))).toEqual(['Introduction']);
  expect(changedSections(doc, doc.replace('old', 'new').replace('## Limits\nsame', '## Limits\nmore'))).toEqual(['Introduction', 'Limits']);
  // A removed line belongs to the heading above it in the old text.
  expect(changedSections(doc, doc.replace('## Usage\nsame\n', '## Usage\n'))).toEqual(['Usage']);
  // A renamed heading is named as it now reads, whether or not its lines changed too.
  expect(changedSections(doc, doc.replace('## Usage', '## Use'))).toEqual(['Use']);
  expect(changedSections(doc, doc.replace('## Usage\nsame', '## Use\nmore'))).toEqual(['Use']);
  // A section deleted entirely is named by its old heading.
  expect(changedSections(doc, doc.replace('## Limits\nsame\n', ''))).toEqual(['Limits']);
  // Blank lines belong to no section.
  const spaced = '# Introduction\n\nintro text\n\n## Usage\n\nusage text\n\n## Limits\n\nlimits text\n';
  expect(changedSections(spaced, spaced.slice(0, spaced.indexOf('\n\n## Limits') + 1))).toEqual(['Limits']);
  // Text above the first heading belongs to no section.
  expect(changedSections('intro\n# A\nx\n', 'preface\n# A\nx\n')).toEqual([]);
});

test('no sections are named when the comparison gives up', () => {
  expect(changedSections('# A\n' + 'x'.repeat(1_000_000), '# A\n' + 'y'.repeat(1_000_000))).toEqual([]);
});

test('a message names the files and, for Markdown, up to three changed sections', () => {
  expect(commitMessage([{ path: 'README.md', before: doc, after: doc.replace('old', 'new').replace('## Usage\nsame', '## Usage\nnew') }]))
    .toBe('Edit Introduction and Usage in README.md');
  expect(commitMessage([{ path: 'notes/ideas.md', before: null, after: 'x' }])).toBe('Add notes/ideas.md');
  // A file Gittin created starts out empty.
  expect(commitMessage([{ path: 'new.md', before: '', after: 'x' }])).toBe('Add new.md');
  expect(commitMessage([{ path: 'config.yml', before: 'a: 1\n', after: 'a: 2\n' }])).toBe('Edit config.yml');
  const four = '# A\n1\n# B\n1\n# C\n1\n# D\n1\n';
  expect(commitMessage([{ path: 'four.md', before: four, after: four.replaceAll('1', '2') }])).toBe('Edit four.md');
  expect(commitMessage([
    { path: 'a.md', before: doc, after: doc.replace('old', 'new') },
    { path: 'img/b.png', before: null, after: '' },
  ])).toBe('Edit Introduction in a.md; add img/b.png');
});
