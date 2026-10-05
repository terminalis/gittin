import { change, get, getAll } from './database';
import { isWithin } from '../sources/paths';
export interface VersionMeta { id: string; key: string; kind: 'opened' | 'saved'; savedAt: number; version: string; size: number; trimmed?: boolean }
export const versionKey = (sourceId: string, path: string) => sourceId + '\n' + path;
const perFile = 20, budget = 50 * 1024 * 1024;
/** The versions to delete: over 20 for a file, then the oldest overall until the total is within budget. */
export function pruneVersions(all: VersionMeta[], limit = perFile, bytes = budget): VersionMeta[] {
  const newest = [...all].sort((a, b) => b.savedAt - a.savedAt), counts = new Map<string, number>(), remove = new Set<VersionMeta>();
  for (const v of newest) {
    const count = (counts.get(v.key) ?? 0) + 1;
    counts.set(v.key, count);
    if (count > limit) remove.add(v);
  }
  let total = newest.filter(v => !remove.has(v)).reduce((sum, v) => sum + v.size, 0);
  for (const v of [...newest].reverse()) {
    if (total <= bytes) break;
    if (!remove.has(v)) { remove.add(v); total -= v.size; }
  }
  return newest.filter(v => remove.has(v)).reverse();
}
export async function listVersions(key: string): Promise<VersionMeta[]> {
  const all = await getAll<VersionMeta>('versions');
  return all.filter(v => v.key === key).sort((a, b) => b.savedAt - a.savedAt);
}
export async function versionSource(id: string): Promise<string> {
  const body = await get<{ source: string }>('version-bodies', id);
  if (!body) throw Error('This version is no longer stored.');
  return body.source;
}
/**
 * Record a version unless it matches the latest one, then prune. recordVersion, moveVersions and
 * clearVersionsAt are best effort: a failure never stops the file work that calls them.
 */
export async function recordVersion(key: string, kind: VersionMeta['kind'], source: string, version: string) {
  try {
    const [latest] = await listVersions(key);
    if (latest?.version === version) return;
    const size = new TextEncoder().encode(source).length;
    const meta: VersionMeta = { id: crypto.randomUUID(), key, kind, savedAt: Date.now(), version, size };
    await change(['versions', 'version-bodies'], tx => {
      tx.objectStore('versions').put(meta);
      tx.objectStore('version-bodies').put({ id: meta.id, source });
    });
    const everything = await getAll<VersionMeta>('versions');
    const remove = pruneVersions(everything);
    if (!remove.length) return;
    const removed = new Set(remove.map(v => v.id));
    await change(['versions', 'version-bodies'], tx => {
      for (const v of remove) {
        tx.objectStore('versions').delete(v.id);
        tx.objectStore('version-bodies').delete(v.id);
      }
      // The oldest survivor of each trimmed file carries the "older versions removed" note.
      for (const key of new Set(remove.map(v => v.key))) {
        const oldest = everything.filter(v => v.key === key && !removed.has(v.id))
          .sort((a, b) => a.savedAt - b.savedAt)[0];
        if (oldest) tx.objectStore('versions').put({ ...oldest, trimmed: true });
      }
    });
  } catch { /* best effort */ }
}
const forget = (ids: string[]) => change(['versions', 'version-bodies'], tx => {
  for (const id of ids) { tx.objectStore('versions').delete(id); tx.objectStore('version-bodies').delete(id); }
});
export async function clearVersions(key: string) {
  await forget((await listVersions(key)).map(v => v.id));
}
/** Version history follows a renamed or moved file. Best effort. */
export async function moveVersions(from: string, to: string) {
  try {
    const versions = await listVersions(from);
    await change(['versions'], tx => {
      for (const v of versions) tx.objectStore('versions').put({ ...v, key: to });
    });
  } catch { /* best effort */ }
}
/** Forget the history of a deleted file, or of every file under a deleted folder. Best effort. */
export async function clearVersionsAt(sourceId: string, path: string) {
  const prefix = versionKey(sourceId, '');
  try {
    await forget((await getAll<VersionMeta>('versions'))
      .filter(v => v.key.startsWith(prefix) && isWithin(v.key.slice(prefix.length), path)).map(v => v.id));
  } catch { /* best effort */ }
}
