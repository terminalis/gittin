import type { Action } from './menus';

// Row keys are existing action IDs or submenu names. Layout never changes the
// action catalogue, so command search and each command's behaviour stay intact.
const sections: Record<string, readonly (readonly string[])[]> = {
  File: [
    ['home', 'New', 'Open', 'make-copy'],
    ['Email'],
    ['save', 'save-as', 'version-history'],
    ['rename', 'move', 'delete-file', 'location', 'favourite'],
    ['details', 'print', 'download-pdf', 'close'],
  ],
  Edit: [['undo', 'redo'], ['cut', 'copy', 'paste'], ['selectAll', 'deleteSelection', 'Lines'], ['find']],
  View: [
    ['Mode', 'showComments'],
    ['line-numbers', 'syntaxHighlighting', 'whitespace', 'wordWrap', 'Toolbar', 'Appearance'],
    ['focus', 'fullscreen'],
  ],
  Insert: [
    ['Image', 'addTable', 'Snippets', 'addLink', 'heading-link', 'symbols'],
    ['hr', 'line-break', 'Elements'],
  ],
  Format: [
    ['Text', 'Paragraph styles', 'Align and indent', 'Lists', 'blockQuote'],
    ['Table', 'Image'],
    ['convertToComment', 'convertToText'],
    ['clearFormatting'],
  ],
  Tools: [
    ['statistics', 'compare-files', 'attributions', 'linked-resources'],
    ['preferences'],
  ],
  Help: [
    ['commands'], ['gittin-help', 'getting-started', 'whats-new'], ['feedback'],
    ['privacy', 'terms', 'notices', 'about'], ['shortcuts'],
  ],
  'Edit/Lines': [['duplicateLines'], ['moveLinesUp', 'moveLinesDown'], ['deleteLines']],
  'Format/Text': [['bold', 'italic', 'strike', 'code', 'ins', 'sup', 'sub', 'mark']],
  'Format/Align and indent': [['alignLeft', 'alignCenter', 'alignRight', 'alignJustify'], ['indent', 'outdent']],
  'Format/Table': [
    ['addRowToUp', 'addRowToDown', 'addColumnToLeft', 'addColumnToRight'],
    ['removeRow', 'removeColumn'], ['alignColumn'], ['removeTable'],
  ],
  'Format/Image': [['image-size', 'image-reset'], ['image-left', 'image-center', 'image-right']],
};

/** The submenu of `menu` that holds the action; undefined when the action sits in `menu` itself. */
export const submenuOf = (action: Action, menu: string) =>
  action.menu === menu ? undefined : action.menu.slice(menu.length + 1).split('/')[0];

/** The actions of `menu` and its submenus in menu order, with separators between sections. */
export function arrangeMenu(items: Action[], menu: string): Action[] {
  let layout = sections[menu];
  const ids = (prefix: string) => items.filter(a => a.id.startsWith(prefix)).map(a => a.id);
  if (menu === 'View/Toolbar') {
    const groups = items.map(action => submenuOf(action, menu)).filter((name): name is string => !!name);
    layout = [[...new Set(groups)], ['reset-toolbar']];
  } else if (menu.startsWith('View/Toolbar/'))
    layout = [ids('toolbar-group-'), ids('toolbar-item-')];
  else if (menu === 'Insert/Snippets')
    layout = ['markdown', 'javascript', 'typescript', 'html', 'css', 'json', 'yaml']
      .map(type => ids(`snippet-${type}-`));
  if (!layout) return items;

  const remaining = new Set(items), arranged: Action[] = [];
  for (const section of layout) {
    let first = true;
    for (const key of section) {
      for (const action of items) {
        if (!remaining.has(action) || (submenuOf(action, menu) ?? action.id) !== key) continue;
        arranged.push({ ...action, separatorBefore: first && arranged.length > 0 });
        first = false;
        remaining.delete(action);
      }
    }
  }
  // New commands remain visible even before they are assigned a section.
  for (const action of remaining) arranged.push(action);
  return arranged;
}
