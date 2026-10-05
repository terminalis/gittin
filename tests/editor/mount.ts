import { afterEach } from 'vitest';
import { GittinController } from '@/controller';
import type MarkdownEditor from '@/markdown-editor';
import { DocumentSession } from '../../src/documents/session';

const mounted: (() => void)[] = [];
afterEach(() => mounted.splice(0).forEach((dispose) => dispose()));

/** A controller mounted on a new host in the page; it is disposed after the test. */
export function mount(source: string, mode: 'markdown' | 'preview' = 'markdown') {
  const session = new DocumentSession(source);
  const controller = new GittinController(), host = document.createElement('div');
  document.body.append(host);
  controller.mount(host, session, mode);
  const dispose = () => { controller.dispose(); host.remove(); };
  mounted.push(dispose);
  const { markdown } = controller as unknown as { markdown: MarkdownEditor };
  return { session, controller, host, markdown, dispose };
}
