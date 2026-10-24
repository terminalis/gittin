// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import type { OpenDocument } from '../../src/screens/workspace';
import { saveDialog, type SaveGroup } from '../../src/native/save-dialog';
import { buttonNamed, octocat, openDialog, useDom, useGitHubStand } from './stand-ins';

beforeEach(useDom);

test("the save dialog notes workflow files the sign-in can't change, and Allow workflow changes… clears the note", async () => {
  const stand = useGitHubStand({
    deviceWait: vi.fn(async () => ({ kind: 'signedIn' as const, account: { ...octocat, scopes: ['repo', 'workflow'] }, remembered: true })),
  });
  const path = '.github/workflows/ci.yml';
  const group: SaveGroup = {
    place: { root: '/work', name: 'work', path }, docs: [{ doc: {} as OpenDocument, path }], message: 'Edit ci.yml', workflow: [path],
  };
  const answer = saveDialog([group], 'save');
  expect(openDialog()!.querySelector('.workflow-note')!.textContent).toContain('left out of the commit');
  buttonNamed('Allow workflow changes…', openDialog()!)!.click();
  await vi.waitFor(() => expect(openDialog()!.querySelector('.workflow-note')).toBeNull());
  expect(stand.deviceCode).toHaveBeenCalledWith(true);
  expect(group.workflow).toEqual([]);
  buttonNamed('Save', openDialog()!)!.click();
  expect(await answer).toEqual(new Map([['/work', 'Edit ci.yml']]));
});
