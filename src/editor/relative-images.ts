/** Turns a relative image reference into a displayable URL, or null to leave it unresolved. */
export type ImageResolver = (src: string) => Promise<string | null>;
/** Opens a relative link, which names a file beside the document rather than a page on the Gittin host. */
export type LinkOpener = (href: string) => void;
export const isRelative = (url: string) => !!url && !/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(url);
export function resolveImages(container: HTMLElement, resolve: ImageResolver | null) {
  if (!resolve) return;
  for (const image of container.querySelectorAll('img')) {
    const src = image.getAttribute('src');
    if (!src || !isRelative(src)) continue;
    // Do not ask the Gittin host for the file; the source supplies it.
    image.removeAttribute('src');
    void resolve(src).then(url => { if (url) image.src = url; });
  }
}
