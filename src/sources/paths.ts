export const join = (directory: string, name: string) => (directory ? directory + '/' + name : name);
export const dirname = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
export const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
/** True for `target` itself and anything inside it. */
export const isWithin = (path: string, target: string) => path === target || path.startsWith(target + '/');
/** What follows `#` in a link, or '' when it has none. */
export const fragment = (reference: string) => { const at = reference.indexOf('#'); return at < 0 ? '' : reference.slice(at + 1); };
const decode = (part: string) => { try { return decodeURIComponent(part); } catch { return part; } };
/** A source-relative path for a reference written in the file at `from`, or null for URLs and paths above the root. */
export function resolvePath(from: string, reference: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(reference)) return null;
  const parts = reference.startsWith('/') ? [] : dirname(from).split('/').filter(Boolean);
  for (const part of reference.split(/[?#]/)[0].split('/')) {
    if (!part || part === '.') continue;
    if (part !== '..') parts.push(decode(part));
    else if (!parts.pop()) return null;
  }
  return parts.length ? parts.join('/') : null;
}
export function relativePath(from: string, to: string): string {
  const base = dirname(from).split('/').filter(Boolean), target = to.split('/');
  let shared = 0;
  while (shared < base.length && shared < target.length - 1 && base[shared] === target[shared]) shared++;
  return [...base.slice(shared).map(() => '..'), ...target.slice(shared)].join('/');
}
const images: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif' };
export const imageType = (path: string): string | undefined => {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return Object.hasOwn(images, extension) ? images[extension] : undefined;
};
