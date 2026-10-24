import type { LangDB } from '../db';
import type { RemoteFile, RemoteStore } from './drive';
import { applySnapshot, buildSnapshot, compress, decompress, fingerprint, mergeSnapshots, type SyncFile } from './snapshot';

export interface SyncResult {
  file: RemoteFile;
  /** Records changed on this device. */
  pulled: number;
  uploaded: boolean;
  skipped: boolean;
}

/**
 * One round of two-way sync: download the Drive copy, merge it with local data,
 * write remote changes locally and upload the merged result if it differs.
 */
export async function syncOnce(db: LangDB, remote: RemoteStore, last: { fileId?: string; version?: string }, dirty: boolean): Promise<SyncResult> {
  const files = await remote.list();
  const primary = files.find((f) => f.id === last.fileId) ?? files[0];

  // Nothing changed anywhere since the last round.
  if (primary && !dirty && primary.id === last.fileId && primary.version === last.version) {
    return { file: primary, pulled: 0, uploaded: false, skipped: true };
  }

  // Two devices that connected at the same time may each have created a file; fold them together.
  const remotes: SyncFile[] = [];
  for (const f of files) remotes.push(await decompress(await remote.download(f.id)));
  const remoteMerged = remotes.reduce<SyncFile | null>((acc, f) => (acc ? mergeSnapshots(acc, f) : f), null);

  const local = await buildSnapshot(db);
  const merged = remoteMerged ? mergeSnapshots(local, remoteMerged) : local;
  const { changed } = await applySnapshot(db, merged);

  let file = primary;
  let uploaded = false;
  if (!remoteMerged || files.length > 1 || fingerprint(merged) !== fingerprint(remoteMerged)) {
    merged.updatedAt = Date.now();
    file = await remote.upload(await compress(merged), primary?.id);
    uploaded = true;
  }
  for (const extra of files) if (extra.id !== file!.id) await remote.remove(extra.id);
  return { file: file!, pulled: changed, uploaded, skipped: false };
}
