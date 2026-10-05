import mermaid from 'mermaid';
let next = 0;
/** Replace each diagram's source with Mermaid's SVG; a diagram Mermaid cannot parse keeps its source. */
export async function renderDiagrams(figures: HTMLElement[]) {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: figures[0]?.closest('#print-file') ? 'default' : document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default' });
  for (const figure of figures) {
    try {
      const { svg } = await mermaid.render('gittin-diagram-' + ++next, figure.dataset.mermaid ?? '');
      figure.innerHTML = svg;
    } catch {
      // The coloured source already inside the figure stays visible.
    }
  }
}
