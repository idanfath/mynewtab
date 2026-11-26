import {
  BACKUP_KEY,
  STORAGE_KEY,
  classifyStoredDataFailure,
  parseBookmarks,
  type Bookmark,
  type StoredDataFailure,
} from './bookmarks.ts';
import { normalizeUrl, urlIdentity } from './lib.ts';
import {
  areBookmarksEqual,
  computeBookmarksHash,
  shortBookmarksHash,
} from './bookmarkMerge.ts';

export { computeBookmarksHash, shortBookmarksHash };

export function formatShortHashChip(hash: string): string {
  return `#${shortBookmarksHash(hash)}`;
}

export function formatLiveHashBadge(bookmarks: readonly Bookmark[]): string | null {
  if (bookmarks.length === 0) return null;
  return `Current · #${shortBookmarksHash(computeBookmarksHash(bookmarks))}`;
}

export function formatPreRestoreLabel(snapshot: Pick<BookmarkSnapshot, 'hash'>): string {
  return `Before restoring #${shortBookmarksHash(snapshot.hash)}`;
}

export const SNAPSHOTS_KEY = 'newtab-directory-snapshots-v1';
export const MAX_SNAPSHOTS = 15;

export type SnapshotTrigger =
  | 'manual'
  | 'pre-import'
  | 'pre-replace'
  | 'pre-editor-save'
  | 'pre-section-delete'
  | 'pre-restore'
  | 'external-conflict';

export interface BookmarkSnapshot {
  id: string;
  createdAt: string;
  label: string;
  trigger: SnapshotTrigger;
  bookmarkCount: number;
  sectionCount: number;
  hash: string;
  bookmarks: Bookmark[];
}

export interface SnapshotVaultEnvelope {
  version: 1;
  snapshots: BookmarkSnapshot[];
}

export interface SnapshotRequest {
  trigger: SnapshotTrigger;
  label: string;
  bookmarks?: Bookmark[];
}

export interface PersistVaultOptions {
  snapshots?: SnapshotRequest[];
  clearCorruptBackup?: boolean;
}

export interface PersistVaultResult {
  ok: boolean;
  snapshots: BookmarkSnapshot[];
  evictedForPrimary: number;
  snapshotWarning?: 'snapshot-quota-exceeded';
}

export interface CorruptBackupInfo {
  raw: string;
  byteLength: number;
  failure: StoredDataFailure;
  source: 'backup-key' | 'primary-key';
}

export interface LiveSnapshotDiff {
  restoredOrAddedCount: number;
  changedCount: number;
  removedCount: number;
  unchangedCount: number;
  orderChanged: boolean;
  isIdenticalToLive: boolean;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & {
  removeItem?: (key: string) => void;
};

const VALID_TRIGGERS = new Set<string>([
  'manual',
  'pre-import',
  'pre-replace',
  'pre-editor-save',
  'pre-section-delete',
  'pre-restore',
  'external-conflict',
]);

const OPTIONAL_SCALARS = [
  'subsection',
  'description',
  'iconUrl',
  'tier',
  'product',
] as const;

const OPTIONAL_ARRAYS = [
  'categories',
  'capabilities',
  'pros',
  'cons',
  'formats',
] as const;

export function safeGetItem(
  storage: Pick<Storage, 'getItem'>,
  key: string,
): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemoveItem(
  storage: { removeItem?: (key: string) => void },
  key: string,
): boolean {
  if (typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function deepCloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '__proto__' || v === undefined) continue;
      out[k] = deepCloneValue(v);
    }
    return out;
  }
  return value;
}

export function cloneBookmark(bookmark: Bookmark): Bookmark {
  return deepCloneValue(bookmark) as Bookmark;
}

function generateSnapshotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function validateSnapshotBookmark(item: unknown): Bookmark | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  for (const field of ['title', 'url', 'section'] as const) {
    if (typeof record[field] !== 'string' || !record[field].trim()) {
      return null;
    }
  }
  if (!normalizeUrl(record.url as string)) {
    return null;
  }

  for (const field of OPTIONAL_SCALARS) {
    if (record[field] !== undefined && typeof record[field] !== 'string') {
      return null;
    }
  }

  for (const field of OPTIONAL_ARRAYS) {
    const value = record[field];
    if (
      value !== undefined
      && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))
    ) {
      return null;
    }
  }

  if (typeof record.iconUrl === 'string' && record.iconUrl.trim() && !normalizeUrl(record.iconUrl)) {
    return null;
  }

  const rawSection = (record.section as string).trim();
  const sanitizedSection = rawSection.toLocaleLowerCase() === 'all'
    ? 'Uncategorized'
    : rawSection;

  const out: Record<string, unknown> = {
    ...(deepCloneValue(record) as Record<string, unknown>),
    title: (record.title as string).trim(),
    url: (record.url as string).trim(),
    section: sanitizedSection,
  };

  for (const field of OPTIONAL_SCALARS) {
    const rawVal = record[field];
    if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();
      if (!trimmed) {
        delete out[field];
      } else if (field === 'iconUrl') {
        const normalizedIcon = normalizeUrl(trimmed);
        if (normalizedIcon) out.iconUrl = normalizedIcon;
        else delete out.iconUrl;
      } else {
        out[field] = trimmed;
      }
    } else {
      delete out[field];
    }
  }

  for (const field of OPTIONAL_ARRAYS) {
    const rawArr = record[field];
    if (Array.isArray(rawArr)) {
      const cleaned = rawArr
        .map((entry) => (entry as string).trim())
        .filter(Boolean);
      if (cleaned.length > 0) out[field] = cleaned;
      else delete out[field];
    } else {
      delete out[field];
    }
  }

  return out as unknown as Bookmark;
}

export function loadSnapshots(storage: Pick<Storage, 'getItem'>): BookmarkSnapshot[] {
  const raw = safeGetItem(storage, SNAPSHOTS_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || (parsed as Record<string, unknown>).version !== 1
    || !Array.isArray((parsed as Record<string, unknown>).snapshots)
  ) {
    return [];
  }

  const rawList = (parsed as { snapshots: unknown[] }).snapshots;
  const seenIds = new Set<string>();
  const valid: BookmarkSnapshot[] = [];

  for (const entry of rawList) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    if (
      typeof rec.id !== 'string'
      || !rec.id.trim()
      || seenIds.has(rec.id)
      || typeof rec.createdAt !== 'string'
      || !rec.createdAt.trim()
      || typeof rec.label !== 'string'
      || !rec.label.trim()
      || typeof rec.trigger !== 'string'
      || !VALID_TRIGGERS.has(rec.trigger)
      || !Array.isArray(rec.bookmarks)
      || rec.bookmarks.length === 0
    ) {
      continue;
    }

    const validBookmarks: Bookmark[] = [];
    let entryValid = true;
    for (const item of rec.bookmarks) {
      const validated = validateSnapshotBookmark(item);
      if (!validated) {
        entryValid = false;
        break;
      }
      validBookmarks.push(validated);
    }
    if (!entryValid) continue;

    seenIds.add(rec.id);
    valid.push({
      id: rec.id,
      createdAt: rec.createdAt,
      label: rec.label.trim(),
      trigger: rec.trigger as SnapshotTrigger,
      bookmarkCount: validBookmarks.length,
      sectionCount: new Set(validBookmarks.map((b) => b.section)).size,
      hash: computeBookmarksHash(validBookmarks),
      bookmarks: validBookmarks,
    });

    if (valid.length >= MAX_SNAPSHOTS) break;
  }

  return valid;
}

function evictOneFromRing(list: BookmarkSnapshot[], protectIndexZero: boolean): boolean {
  if (list.length === 0) return false;
  const minIndex = protectIndexZero ? 1 : 0;
  if (list.length <= minIndex) return false;

  for (let i = list.length - 1; i >= minIndex; i -= 1) {
    if (list[i].trigger !== 'manual') {
      list.splice(i, 1);
      return true;
    }
  }

  list.pop();
  return true;
}

export function buildNextSnapshots(
  currentSnapshots: readonly BookmarkSnapshot[],
  request: {
    trigger: SnapshotTrigger;
    label: string;
    bookmarks: readonly Bookmark[];
  },
  nowIso = new Date().toISOString(),
): {
  snapshots: BookmarkSnapshot[];
  status: 'added' | 'upgraded' | 'deduplicated' | 'skipped-empty';
} {
  if (request.bookmarks.length === 0) {
    return { snapshots: [...currentSnapshots], status: 'skipped-empty' };
  }

  const hash = computeBookmarksHash(request.bookmarks);
  const trimmedLabel = request.label.trim();
  const cleanLabel = trimmedLabel
    || (request.trigger === 'manual' ? 'Manual checkpoint' : 'Saved snapshot');

  const matchingSnapshots = currentSnapshots.filter((snapshot) => snapshot.hash === hash);
  if (matchingSnapshots.length > 0) {
    const preferredMatch = matchingSnapshots.find((snapshot) => snapshot.trigger === 'manual')
      ?? matchingSnapshots[0];
    const remaining = currentSnapshots.filter((snapshot) => snapshot.hash !== hash);

    if (request.trigger !== 'manual') {
      const bubbled: BookmarkSnapshot = {
        ...preferredMatch,
        createdAt: nowIso,
      };
      return {
        snapshots: [bubbled, ...remaining],
        status: 'deduplicated',
      };
    }

    const upgraded: BookmarkSnapshot = {
      ...preferredMatch,
      trigger: 'manual',
      label: trimmedLabel || preferredMatch.label.trim() || 'Manual checkpoint',
      createdAt: nowIso,
    };
    return {
      snapshots: [upgraded, ...remaining],
      status: 'upgraded',
    };
  }

  const clonedBookmarks = request.bookmarks.map(cloneBookmark);
  const created: BookmarkSnapshot = {
    id: generateSnapshotId(),
    createdAt: nowIso,
    label: cleanLabel,
    trigger: request.trigger,
    bookmarkCount: clonedBookmarks.length,
    sectionCount: new Set(clonedBookmarks.map((b) => b.section)).size,
    hash,
    bookmarks: clonedBookmarks,
  };

  const next = [created, ...currentSnapshots];
  while (next.length > MAX_SNAPSHOTS) {
    evictOneFromRing(next, true);
  }

  return { snapshots: next, status: 'added' };
}

function writeFittingSnapshots(
  storage: StorageLike,
  snapshots: readonly BookmarkSnapshot[],
): BookmarkSnapshot[] {
  const candidate = [...snapshots];
  while (candidate.length > 0) {
    if (
      safeSetItem(
        storage,
        SNAPSHOTS_KEY,
        JSON.stringify({ version: 1, snapshots: candidate }),
      )
    ) {
      return candidate;
    }
    evictOneFromRing(candidate, false);
  }
  safeRemoveItem(storage, SNAPSHOTS_KEY);
  return [];
}

function writeVaultWithEviction(
  storage: StorageLike,
  snapshots: readonly BookmarkSnapshot[],
  fallback?: {
    snapshots: readonly BookmarkSnapshot[];
    rawOnDisk: string | null;
    clearedOnDisk?: boolean;
  },
): {
  snapshots: BookmarkSnapshot[];
  snapshotWarning?: 'snapshot-quota-exceeded';
} {
  const candidate = [...snapshots];
  if (candidate.length === 0) {
    safeRemoveItem(storage, SNAPSHOTS_KEY);
    return { snapshots: [] };
  }

  if (safeSetItem(storage, SNAPSHOTS_KEY, JSON.stringify({ version: 1, snapshots: candidate }))) {
    return { snapshots: candidate };
  }

  while (candidate.length > 0) {
    const evictedOlder = evictOneFromRing(candidate, true);
    if (!evictedOlder) {
      break;
    }

    if (
      safeSetItem(
        storage,
        SNAPSHOTS_KEY,
        JSON.stringify({ version: 1, snapshots: candidate }),
      )
    ) {
      return { snapshots: candidate };
    }
  }

  if (fallback) {
    if (fallback.snapshots.length > 0 && fallback.rawOnDisk !== null && !fallback.clearedOnDisk) {
      if (safeGetItem(storage, SNAPSHOTS_KEY) !== fallback.rawOnDisk) {
        safeSetItem(storage, SNAPSHOTS_KEY, fallback.rawOnDisk);
      }
      return {
        snapshots: [...fallback.snapshots],
        snapshotWarning: 'snapshot-quota-exceeded',
      };
    }

    if (fallback.snapshots.length > 0) {
      const preserved = writeFittingSnapshots(storage, fallback.snapshots);
      return {
        snapshots: preserved,
        snapshotWarning: 'snapshot-quota-exceeded',
      };
    }
  }

  safeRemoveItem(storage, SNAPSHOTS_KEY);
  return {
    snapshots: [],
    snapshotWarning: 'snapshot-quota-exceeded',
  };
}

export function persistBookmarksWithVault(
  storage: StorageLike,
  nextBookmarks: readonly Bookmark[],
  options: PersistVaultOptions = {},
): PersistVaultResult {
  const rawSnapshotsBackup = safeGetItem(storage, SNAPSHOTS_KEY);
  const existingSnapshots = loadSnapshots(storage);
  const rawCorruptBackup = options.clearCorruptBackup
    ? safeGetItem(storage, BACKUP_KEY)
    : null;

  const workingSnapshots = [...existingSnapshots];
  const primaryPayload = JSON.stringify(nextBookmarks);
  let evictedForPrimary = 0;
  let clearedSnapshotsInPhase1 = false;

  // Phase 1: Write primary STORAGE_KEY first
  let primaryWritten = safeSetItem(storage, STORAGE_KEY, primaryPayload);

  if (!primaryWritten) {
    while (workingSnapshots.length > 0) {
      evictOneFromRing(workingSnapshots, false);
      evictedForPrimary += 1;

      if (workingSnapshots.length === 0) {
        safeRemoveItem(storage, SNAPSHOTS_KEY);
        clearedSnapshotsInPhase1 = true;
      } else {
        const shrunk = safeSetItem(
          storage,
          SNAPSHOTS_KEY,
          JSON.stringify({ version: 1, snapshots: workingSnapshots }),
        );
        if (!shrunk) {
          safeRemoveItem(storage, SNAPSHOTS_KEY);
          clearedSnapshotsInPhase1 = true;
        }
      }

      if (safeSetItem(storage, STORAGE_KEY, primaryPayload)) {
        primaryWritten = true;
        break;
      }
    }
  }

  // Guardrail 4: If SNAPSHOTS_KEY holds giant unparseable garbage, evict it to rescue primary save
  if (!primaryWritten && existingSnapshots.length === 0 && rawSnapshotsBackup !== null) {
    safeRemoveItem(storage, SNAPSHOTS_KEY);
    clearedSnapshotsInPhase1 = true;
    primaryWritten = safeSetItem(storage, STORAGE_KEY, primaryPayload);
  }

  if (!primaryWritten && options.clearCorruptBackup === true && rawCorruptBackup !== null) {
    safeRemoveItem(storage, BACKUP_KEY);
    primaryWritten = safeSetItem(storage, STORAGE_KEY, primaryPayload);
  }

  if (!primaryWritten) {
    if (rawCorruptBackup !== null) {
      safeSetItem(storage, BACKUP_KEY, rawCorruptBackup);
    }
    if (rawSnapshotsBackup !== null) {
      safeSetItem(storage, SNAPSHOTS_KEY, rawSnapshotsBackup);
    }
    return {
      ok: false,
      snapshots: existingSnapshots,
      evictedForPrimary: 0,
    };
  }

  // Between Phase 1 & Phase 2: clear repaired BACKUP_KEY if requested
  if (options.clearCorruptBackup === true) {
    safeRemoveItem(storage, BACKUP_KEY);
  }

  // Phase 2: Best-effort SNAPSHOTS_KEY update
  const rawSnapshotsAfterPhase1 = safeGetItem(storage, SNAPSHOTS_KEY);
  let candidate = workingSnapshots;
  let mutatedVault = false;
  for (const req of options.snapshots ?? []) {
    const targetBookmarks = req.bookmarks ?? [];
    if (targetBookmarks.length === 0) continue;
    const built = buildNextSnapshots(candidate, {
      trigger: req.trigger,
      label: req.label,
      bookmarks: targetBookmarks,
    });
    if (
      built.status === 'added'
      || built.status === 'upgraded'
      || built.status === 'deduplicated'
    ) {
      candidate = built.snapshots;
      mutatedVault = true;
    }
  }

  if (!mutatedVault && !clearedSnapshotsInPhase1) {
    return {
      ok: true,
      snapshots: candidate,
      evictedForPrimary,
    };
  }

  if (!mutatedVault && clearedSnapshotsInPhase1) {
    if (workingSnapshots.length === 0) {
      return {
        ok: true,
        snapshots: [],
        evictedForPrimary,
      };
    }
    const preserved = writeFittingSnapshots(storage, workingSnapshots);
    return {
      ok: true,
      snapshots: preserved,
      evictedForPrimary,
      ...(preserved.length < workingSnapshots.length
        ? { snapshotWarning: 'snapshot-quota-exceeded' as const }
        : {}),
    };
  }

  const vaultResult = writeVaultWithEviction(storage, candidate, {
    snapshots: workingSnapshots,
    rawOnDisk: rawSnapshotsAfterPhase1,
    clearedOnDisk: clearedSnapshotsInPhase1,
  });
  return {
    ok: true,
    snapshots: vaultResult.snapshots,
    evictedForPrimary,
    snapshotWarning: vaultResult.snapshotWarning,
  };
}

export function saveManualSnapshot(
  storage: StorageLike,
  bookmarks: readonly Bookmark[],
  label: string,
): {
  ok: boolean;
  snapshots: BookmarkSnapshot[];
  status: 'added' | 'upgraded' | 'skipped-empty' | 'quota-exceeded';
} {
  const rawBefore = safeGetItem(storage, SNAPSHOTS_KEY);
  const existing = loadSnapshots(storage);
  const built = buildNextSnapshots(existing, {
    trigger: 'manual',
    label,
    bookmarks,
  });

  if (built.status === 'skipped-empty') {
    return { ok: false, snapshots: existing, status: 'skipped-empty' };
  }

  const written = writeVaultWithEviction(storage, built.snapshots, {
    snapshots: existing,
    rawOnDisk: rawBefore,
  });
  if (written.snapshotWarning === 'snapshot-quota-exceeded') {
    if (rawBefore !== null && safeGetItem(storage, SNAPSHOTS_KEY) !== rawBefore) {
      safeSetItem(storage, SNAPSHOTS_KEY, rawBefore);
    }
    return { ok: false, snapshots: existing, status: 'quota-exceeded' };
  }

  return {
    ok: true,
    snapshots: written.snapshots,
    status: built.status === 'upgraded' ? 'upgraded' : 'added',
  };
}

export function deleteSnapshotFromVault(
  storage: StorageLike,
  snapshotId: string,
): { ok: boolean; snapshots: BookmarkSnapshot[] } {
  const existing = loadSnapshots(storage);
  const next = existing.filter((snapshot) => snapshot.id !== snapshotId);
  if (next.length === existing.length) {
    return { ok: true, snapshots: existing };
  }

  if (next.length === 0) {
    const ok = safeRemoveItem(storage, SNAPSHOTS_KEY);
    return { ok, snapshots: ok ? [] : existing };
  }

  const ok = safeSetItem(
    storage,
    SNAPSHOTS_KEY,
    JSON.stringify({ version: 1, snapshots: next }),
  );
  return { ok, snapshots: ok ? next : existing };
}

export function diffSnapshotAgainstLive(
  snapshotBookmarks: readonly Bookmark[],
  liveBookmarks: readonly Bookmark[],
): LiveSnapshotDiff {
  const snapBuckets = new Map<string, Bookmark[]>();
  for (const bookmark of snapshotBookmarks) {
    const id = urlIdentity(bookmark.url);
    if (!id) continue;
    let bucket = snapBuckets.get(id);
    if (!bucket) {
      bucket = [];
      snapBuckets.set(id, bucket);
    }
    bucket.push(bookmark);
  }

  const liveBuckets = new Map<string, Bookmark[]>();
  for (const bookmark of liveBookmarks) {
    const id = urlIdentity(bookmark.url);
    if (!id) continue;
    let bucket = liveBuckets.get(id);
    if (!bucket) {
      bucket = [];
      liveBuckets.set(id, bucket);
    }
    bucket.push(bookmark);
  }

  const allIds = new Set<string>([...snapBuckets.keys(), ...liveBuckets.keys()]);

  let restoredOrAddedCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let removedCount = 0;

  for (const id of allIds) {
    const snapList = snapBuckets.get(id) ?? [];
    const liveList = liveBuckets.get(id) ?? [];
    const paired = Math.min(snapList.length, liveList.length);
    for (let i = 0; i < paired; i += 1) {
      if (areBookmarksEqual(snapList[i], liveList[i])) {
        unchangedCount += 1;
      } else {
        changedCount += 1;
      }
    }
    if (snapList.length > liveList.length) {
      restoredOrAddedCount += snapList.length - liveList.length;
    } else if (liveList.length > snapList.length) {
      removedCount += liveList.length - snapList.length;
    }
  }

  const sameHash = computeBookmarksHash(snapshotBookmarks)
    === computeBookmarksHash(liveBookmarks);
  const noContentDelta = restoredOrAddedCount === 0
    && changedCount === 0
    && removedCount === 0;

  return {
    restoredOrAddedCount,
    changedCount,
    removedCount,
    unchangedCount,
    orderChanged: noContentDelta && !sameHash,
    isIdenticalToLive: noContentDelta && sameHash,
  };
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function readCorruptBackup(
  storage: Pick<Storage, 'getItem'>,
): CorruptBackupInfo | null {
  const rawBackup = safeGetItem(storage, BACKUP_KEY);
  if (rawBackup !== null && rawBackup.length > 0) {
    let failure: StoredDataFailure = 'invalid';
    try {
      parseBookmarks(rawBackup);
    } catch (err) {
      failure = classifyStoredDataFailure(err);
    }
    return {
      raw: rawBackup,
      byteLength: utf8ByteLength(rawBackup),
      failure,
      source: 'backup-key',
    };
  }

  const rawPrimary = safeGetItem(storage, STORAGE_KEY);
  if (rawPrimary && rawPrimary.trim()) {
    try {
      parseBookmarks(rawPrimary);
      return null;
    } catch (err) {
      return {
        raw: rawPrimary,
        byteLength: utf8ByteLength(rawPrimary),
        failure: classifyStoredDataFailure(err),
        source: 'primary-key',
      };
    }
  }

  return null;
}

export function clearCorruptBackup(storage: StorageLike): void {
  safeRemoveItem(storage, BACKUP_KEY);
  const rawPrimary = safeGetItem(storage, STORAGE_KEY);
  if (rawPrimary && rawPrimary.trim()) {
    try {
      parseBookmarks(rawPrimary);
    } catch {
      safeRemoveItem(storage, STORAGE_KEY);
    }
  }
}
