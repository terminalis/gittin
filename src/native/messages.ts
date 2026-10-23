// Commit messages that say what changed: the files, and for Markdown the sections whose lines changed.
import { fileTypeForName } from '../documents/file-types';
import { lineDiff } from '../editor/diff';
import { headingAnchors } from '../editor/heading-anchors';

/** A file in a commit: its text before (null when it is new) and after. */
export interface Change { path: string; before: string | null; after: string }
type Heading = { text: string; line: number };

/** Each heading with the line, counted from 1, it starts on, as lineDiff counts lines. */
function headingLines(text: string): Heading[] {
  const starts = [0];
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
  return headingAnchors(text).map(heading => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= heading.from) line++;
    return { text: heading.text, line: line + 1 };
  });
}
const owner = (headings: Heading[], line: number) => headings.filter(heading => heading.line <= line).at(-1);

/** The headings of the sections whose lines changed, in the order they changed; none when the comparison gives up. */
export function changedSections(before: string, after: string): string[] {
  const { lines, coarse } = lineDiff(before, after);
  if (coarse) return [];
  const old = headingLines(before), now = headingLines(after), names = new Set<string>();
  const removed = new Set(lines.filter(line => line.kind === 'remove').map(line => line.oldLine));
  const oldCount = lines.filter(line => line.kind !== 'add').length;
  // A section whose heading line was removed too is named only if all of it was removed; otherwise it was renamed or merged into the section above.
  const wholeRemoved = ({ line }: Heading) => {
    const end = old.find(heading => heading.line > line)?.line ?? oldCount + 1;
    for (let i = line; i < end; i++) if (!removed.has(i)) return false;
    return true;
  };
  for (const line of lines) {
    if (line.kind === 'same' || !line.text.trim()) continue;
    const heading = line.kind === 'add' ? owner(now, line.newLine!) : owner(old, line.oldLine!);
    if (heading && (line.kind === 'add' || !removed.has(heading.line) || (!names.has(heading.text) && wholeRemoved(heading)))) names.add(heading.text);
  }
  return [...names];
}

const list = (names: string[]) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

function part({ path, before, after }: Change) {
  // A file Gittin created starts out empty.
  if (!before) return `add ${path}`;
  const sections = fileTypeForName(path) === 'markdown' ? changedSections(before, after) : [];
  return sections.length && sections.length <= 3 ? `edit ${list(sections)} in ${path}` : `edit ${path}`;
}

/** For example "Edit Introduction and Usage in README.md; add notes/ideas.md". */
export function commitMessage(changes: Change[]): string {
  const text = changes.map(part).join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
