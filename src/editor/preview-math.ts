import 'katex/dist/katex.min.css';
import katex from 'katex';
export function renderMath(nodes: HTMLElement[]) {
  for (const node of nodes)
    node.innerHTML = katex.renderToString(node.dataset.tex ?? '', { displayMode: node.dataset.math === 'display', throwOnError: false });
}
