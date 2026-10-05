import { fileTypeForName, type FileType } from './file-types';
import { change, get, getAll } from './database';
import { basename } from '../sources/paths';
import { isAt } from '../sources/registry';
import type { DocumentSession, Identity, SavedBaseline, SourceVersion } from './types';
import { signal } from '../signal';
interface DraftMetadata {
  title: string;
  fileType: FileType;
  favourite: boolean;
  localBaseline: SavedBaseline | null;
}
export interface DraftRecord {
  fileType: FileType;
  favourite: boolean;
  localBaseline: SavedBaseline | null;
  id: string;
  identity: Identity;
  current: SourceVersion;
  title: string;
  lastOpened: number;
  storageRevision: number;
}
export type DraftSummary = Pick<
  DraftRecord,
  'id' | 'identity' | 'title' | 'lastOpened' | 'fileType' | 'favourite'
> & { previewSource?: string; unsaved: boolean };
export type SaveResult =
  | { kind: 'saved'; storageRevision: number }
  | { kind: 'conflict'; stored: DraftRecord }
  | { kind: 'error'; message: string };
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Local storage is unavailable.';
export async function loadDraft(id: string): Promise<DraftRecord | null> {
  return (await get<DraftRecord>('documents', id)) ?? null;
}
export async function listRecent(): Promise<DraftSummary[]> {
  const rows = await getAll<DraftRecord>('documents');
  return rows
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .map(({ id, identity, title, lastOpened, fileType, favourite, current, localBaseline }) => ({
      fileType, favourite,
      // Home only needs a bounded excerpt of visible favourites, not every file body.
      previewSource: favourite ? current.source.slice(0, 2000) : undefined,
      id, identity, title, lastOpened,
      unsaved: identity.kind === 'local' || current.source !== localBaseline?.source,
    }));
}
export async function findDraft(sourceId: string, path: string): Promise<DraftRecord | null> {
  const rows = await getAll<DraftRecord>('documents');
  return rows.find(row => isAt(row.identity, sourceId, path)) ?? null;
}
export function deleteDraft(id: string): Promise<void> {
  return change(['documents'], tx => tx.objectStore('documents').delete(id));
}
/** Point a stored draft that is not open at its file's new path; its title follows the file name. */
export function moveDraft(sourceId: string, from: string, to: string): Promise<void> {
  return change(['documents'], tx => {
    const store = tx.objectStore('documents'), request = store.getAll();
    request.onsuccess = () => {
      for (const row of request.result as DraftRecord[])
        if (isAt(row.identity, sourceId, from))
          store.put({
            ...row, identity: { kind: 'source', sourceId, path: to }, title: basename(to),
            fileType: fileTypeForName(to), storageRevision: row.storageRevision + 1,
          });
    };
  });
}
/** Delete the drafts of a deleted file, or of every file under a deleted folder. */
export function deleteDraftsAt(sourceId: string, path: string): Promise<void> {
  return change(['documents'], tx => {
    const store = tx.objectStore('documents'), request = store.getAll();
    request.onsuccess = () => {
      for (const row of request.result as DraftRecord[])
        if (isAt(row.identity, sourceId, path)) store.delete(row.id);
    };
  });
}
/** Store the draft if the stored copy is still at `expectedStorageRevision`, in one transaction. */
export async function saveDraft(record: DraftRecord, expectedStorageRevision: number): Promise<SaveResult> {
  let result: SaveResult | undefined;
  try {
    await change(['documents'], tx => {
      const store = tx.objectStore('documents'), request = store.get(record.id);
      request.onsuccess = () => {
        const stored = request.result as DraftRecord | undefined;
        if ((stored?.storageRevision ?? 0) !== expectedStorageRevision) {
          result = stored
            ? { kind: 'conflict', stored }
            : { kind: 'error', message: 'The stored draft was removed. Save a recovery copy.' };
          return;
        }
        const storageRevision = expectedStorageRevision + 1;
        try {
          store.put({ ...record, storageRevision });
          result = { kind: 'saved', storageRevision };
        } catch (error) {
          result = { kind: 'error', message: message(error) };
          tx.abort();
        }
      };
    });
    return result!;
  } catch (error) {
    return result?.kind === 'error' ? result : { kind: 'error', message: message(error) };
  }
}
interface DraftBackup { format: 'gittin-drafts'; version: 1; exportedAt: string; drafts: DraftRecord[] }
export async function exportDrafts(): Promise<DraftBackup> {
  const drafts = await getAll<DraftRecord>('documents');
  return { format: 'gittin-drafts', version: 1, exportedAt: new Date().toISOString(), drafts };
}
function isBackup(value: unknown): value is DraftBackup {
  const backup = value as DraftBackup;
  return !!backup && backup.format === 'gittin-drafts' && backup.version === 1 && Array.isArray(backup.drafts) &&
    backup.drafts.every(d => !!d && typeof d.id === 'string' && typeof d.title === 'string' && typeof d.current?.source === 'string' &&
      typeof d.current.revision === 'number' && typeof d.lastOpened === 'number' && typeof d.storageRevision === 'number' && !!d.identity);
}
/** Add backed-up drafts that are not on this device; an existing draft with the same id is never replaced. */
export async function importDrafts(value: unknown): Promise<{ restored: number; kept: number }> {
  if (!isBackup(value)) throw Error('This file is not a Gittin drafts backup.');
  let restored = 0, kept = 0;
  await change(['documents'], tx => {
    const store = tx.objectStore('documents');
    for (const draft of value.drafts) {
      const request = store.get(draft.id);
      request.onsuccess = () => {
        if (request.result) kept++;
        else { store.put(draft); restored++; }
      };
    }
  });
  return { restored, kept };
}
export type DraftStatus =
  | { kind: 'pending' }
  | { kind: 'saving'; revision: number }
  | { kind: 'saved'; revision: number }
  | Exclude<SaveResult, { kind: 'saved' }>;
/** Own one instance per open session. Different tabs/instances are guarded by storage CAS. */
export class DraftAutosave {
  status: DraftStatus = { kind: 'pending' };
  private storageRevision: number;
  private acknowledged?: SourceVersion;
  private metadataVersion = 0;
  private acknowledgedMetadata = -1;
  private metadataValue: DraftMetadata;
  get metadata(): Readonly<DraftMetadata> { return this.metadataValue; }
  /** Metadata and source share one serialized CAS writer, including in-flight changes. */
  updateMetadata(patch: Partial<DraftMetadata>): Promise<boolean> {
    this.metadataValue = { ...this.metadataValue, ...patch };
    this.metadataVersion++;
    if (this.status.kind !== 'conflict' && this.status.kind !== 'error') this.update({ kind: 'pending' });
    return this.flush();
  }
  private running?: Promise<boolean>;
  private idle?: ReturnType<typeof setTimeout>;
  private maximum?: ReturnType<typeof setTimeout>;
  private unsubscribe: () => void;
  private changed = signal<DraftStatus>();
  private disposed = false;
  readonly lastOpened = Date.now();
  constructor(
    readonly session: DocumentSession,
    record: DraftMetadata & Pick<DraftRecord, 'storageRevision'>,
    private save: typeof saveDraft = saveDraft
  ) {
    const { title, fileType, favourite, localBaseline } = record;
    this.metadataValue = { title, fileType, favourite, localBaseline };
    this.storageRevision = record.storageRevision;
    this.unsubscribe = session.subscribe(() => {
      if (this.status.kind !== 'conflict' && this.status.kind !== 'error')
        this.update({ kind: 'pending' });
      this.schedule();
    });
    this.schedule(); // Initial imports/new documents need recovery even before their first edit.
  }
  /** Calls the listener with the status now and after every change. */
  subscribe(listener: (status: DraftStatus) => void) {
    const off = this.changed.on(listener);
    listener(this.status);
    return off;
  }
  private update(status: DraftStatus) {
    this.status = status;
    this.changed.emit(status);
  }
  private schedule() {
    if (this.disposed || this.status.kind === 'error' || this.status.kind === 'conflict')
      return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.flush(), 500);
    this.maximum ??= setTimeout(() => void this.flush(), 2000);
  }
  private clearTimers() {
    clearTimeout(this.idle);
    clearTimeout(this.maximum);
    this.idle = this.maximum = undefined;
  }
  flush(): Promise<boolean> {
    this.clearTimers();
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async drain(): Promise<boolean> {
    do {
      const current = { ...this.session.current };
      const metadataVersion = this.metadataVersion;
      const metadata = this.metadata;
      if (
        this.acknowledged?.revision === current.revision &&
        this.acknowledged.source === current.source &&
        this.acknowledgedMetadata === metadataVersion
      ) {
        this.update({ kind: 'saved', revision: current.revision });
        return true;
      }
      this.update({ kind: 'saving', revision: current.revision });
      let result: SaveResult;
      try {
        result = await this.save(
          {
            ...metadata,
            id: this.session.id,
            identity: this.session.identity,
            current,
            lastOpened: this.lastOpened,
            storageRevision: this.storageRevision,
          },
          this.storageRevision
        );
      } catch (error) {
        result = { kind: 'error', message: message(error) };
      }
      if (result.kind !== 'saved') {
        this.clearTimers();
        this.update(result);
        return false;
      }
      this.storageRevision = result.storageRevision;
      this.acknowledged = current;
      this.acknowledgedMetadata = metadataVersion;
      // Re-read accepted source after completion: a revision captured earlier cannot save later typing.
    } while (!this.disposed);
    return false;
  }
  /** Call only after a successful navigation flush; failures keep this session alive. */
  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.unsubscribe();
    this.changed.clear();
  }
}
