/** Preview rendering that needs a large library. Each library loads only when the rendered document uses it. */
export async function renderPreviewExtras(container: HTMLElement): Promise<void> {
  const jobs: Promise<void>[] = [];
  const emoji = textNodes(container, 'code,pre').filter(node => /:[a-z0-9_+-]+:/.test(node.data));
  if (emoji.length) jobs.push(import('./preview-emoji').then(module => module.replaceEmoji(emoji)));
  const maths = [...container.querySelectorAll<HTMLElement>('[data-math]')];
  if (maths.length) jobs.push(import('./preview-math').then(module => module.renderMath(maths)));
  const diagrams = [...container.querySelectorAll<HTMLElement>('.preview-diagram[data-mermaid]')];
  if (diagrams.length) jobs.push(import('./preview-diagrams').then(module => module.renderDiagrams(diagrams)));
  const frontMatter = container.querySelector<HTMLElement>('pre[data-front-matter]');
  if (frontMatter) jobs.push(import('./preview-front-matter').then(module => module.renderFrontMatter(frontMatter)));
  // A library that fails to load leaves its placeholder source in place, and must not reject the caller (printing waits on this).
  await Promise.allSettled(jobs);
}
/** The text nodes under root that are not inside an element matching skip. */
export function textNodes(root: HTMLElement, skip: string): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), texts: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest(skip)) texts.push(node);
  }
  return texts;
}
