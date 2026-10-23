// The save dialog, with a section and commit message for each repository and one for other files, and the
// one-time question for a name and email when git has none.
import { button, el, field, fileDialog, textField } from '../ui/dom';
import type { OpenDocument } from '../screens/workspace';
import type { Author } from './git';
import type { Place } from './repositories';

/** Documents saved together: one repository's (with their described message), or files outside any. */
export interface SaveGroup { place: Place | null; docs: { doc: OpenDocument; path: string }[]; message: string }
export type SaveAnswer = Map<string, string> | 'discard' | 'cancel';
const titles = {
  save: 'Save and commit', close: 'Close with unsaved changes?', quit: 'Save before quitting?', sync: 'Save before syncing?',
};

/** Resolves with each repository's commit message, by its folder, or the writer's other choice. */
export function saveDialog(groups: SaveGroup[], reason: 'save' | 'close' | 'quit' | 'sync') {
  return new Promise<SaveAnswer>(resolve => {
    let chosen: SaveAnswer = 'cancel';
    const messages = new Map<string, HTMLInputElement>();
    fileDialog(titles[reason], (body, close, footer) => {
      const save = () => {
        chosen = new Map([...messages].map(([root, input]) => [root, input.value.trim()]));
        close();
      };
      for (const group of groups) {
        const section = el('section', { className: 'save-group' },
          el('h3', { textContent: group.place?.name ?? 'Other files' }),
          el('ul', {}, ...group.docs.map(({ path }) => el('li', { textContent: path }))));
        if (group.place) {
          const message = el('input', {
            type: 'text', value: group.message,
            onkeydown: event => { if (event.key === 'Enter') { event.preventDefault(); save(); } },
          });
          section.append(field('Commit message', message));
          messages.set(group.place.root, message);
        }
        body.append(section);
      }
      footer.append(button(reason === 'sync' ? 'Save and sync' : 'Save', save, 'primary'));
      if (reason === 'close' || reason === 'quit')
        footer.append(button("Don't save", () => { chosen = 'discard'; close(); }));
    }, { className: 'save-dialog', closeLabel: 'Cancel', onClose: () => resolve(chosen) });
  });
}

/** Resolves with the name and email to use whenever git has none, or null when the writer cancels. */
export function askAuthor(repository: string) {
  return new Promise<Author | null>(resolve => {
    let author: Author | null = null;
    fileDialog('Name and email for commits', (body, close, footer) => {
      body.append(el('p', {
        textContent: `git has no name and email for commits to ${repository}. Gittin uses these whenever git has none.`,
      }));
      const name = textField(body, 'Name', { autocomplete: 'name', required: true });
      const email = textField(body, 'Email', { type: 'email', autocomplete: 'email', required: true });
      const use = () => {
        name.value = name.value.trim();
        email.value = email.value.trim();
        if (!name.reportValidity() || !email.reportValidity()) return;
        author = { name: name.value, email: email.value };
        close();
      };
      for (const input of [name, email])
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); use(); } };
      footer.append(button('Use these', use, 'primary'));
    }, { closeLabel: 'Cancel', onClose: () => resolve(author) });
  });
}
