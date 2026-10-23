// Publish to GitHub: a repository with no remote gets one under the signed-in account, as GitHub Desktop's Publish
// repository does. It is named after the folder and private unless the writer clears the box.
import { reshow } from '../app';
import { button, checkbox, el, fileDialog, notice, textField } from '../ui/dom';
import { github } from './github';
import type { Repo } from './repositories';
import { failureText, signedIn } from './sign-in';

export function publishDialog(repo: Repo) {
  fileDialog('Publish to GitHub', (body, close, footer) => {
    const name = textField(body, 'Name', { value: repo.name, required: true, autocomplete: 'off' });
    const keepPrivate = checkbox('Private', true);
    const status = el('p', { role: 'status' });
    body.append(keepPrivate.parentElement!, status);
    const go = button('Publish', () => void publish(), 'primary');
    footer.append(go);
    const publish = async () => {
      name.value = name.value.trim();
      if (!name.reportValidity()) return;
      go.disabled = true;
      status.textContent = 'Publishing…';
      try {
        const synced = await signedIn(() => github.publish(repo.root, name.value, keepPrivate.checked));
        status.textContent = '';
        if (!synced) return;
        // Cancel may have closed the dialog meanwhile; GitHub has the repository all the same.
        if (body.isConnected) close();
        await reshow();
        if (synced.kind === 'done') notice(`Published ${repo.name} to GitHub.`);
        else notice(`GitHub has the new repository, but the push didn't go through`
          + `${synced.kind === 'refused' ? `: ${synced.message}` : ''}. Sync sends the commits later.`);
      } catch (error) {
        status.textContent = failureText(error);
      } finally {
        go.disabled = false;
      }
    };
    name.onkeydown = event => { if (event.key === 'Enter' && !go.disabled) { event.preventDefault(); void publish(); } };
  }, { closeLabel: 'Cancel', className: 'publish-dialog' });
}
