import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKUP_KEY, STORAGE_KEY, type Bookmark } from '../src/bookmarks.ts';
import {
  MAX_SNAPSHOTS,
  SNAPSHOTS_KEY,
  buildNextSnapshots,
  clearCorruptBackup,
  computeBookmarksHash,
  deleteSnapshotFromVault,
  diffSnapshotAgainstLive,
  formatLiveHashBadge,
  formatPreRestoreLabel,
  formatShortHashChip,
  loadSnapshots,
  persistBookmarksWithVault,
  readCorruptBackup,
  saveManualSnapshot,
  shortBookmarksHash,
} from '../src/snapshotVault.ts';

function createCappedStorage(maxBytes = Number.POSITIVE_INFINITY) {
  const map = new Map<string, string>();
  const byteSize = () => {
    let total = 0;
    for (const [k, v] of map.entries()) {
      total += k.length + v.length;
    }
    return total;
  };

  return {
    map,
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      const prev = map.get(key);
      const nextTotal = byteSize() - (prev !== undefined ? key.length + prev.length : 0) + key.length + value.length;
      if (nextTotal > maxBytes) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
  };
}

function makeBookmark(id: number, section = 'Work', extra = ''): Bookmark {
  return {
    title: `Site ${id}`,
    url: `https://site-${id}.example`,
    section,
    ...(extra ? { description: extra } : {}),
  };
}

test('computeBookmarksHash is key-order invariant and array-order sensitive', () => {
  const a = { title: 'A', url: 'https://a.example', section: 'Work', alias: 'a1' } as Bookmark;
  const aReorderedKeys = { alias: 'a1', section: 'Work', url: 'https://a.example', title: 'A' } as Bookmark;
  const b: Bookmark = { title: 'B', url: 'https://b.example', section: 'Work' };

  assert.equal(computeBookmarksHash([a, b]), computeBookmarksHash([aReorderedKeys, b]));
  assert.notEqual(computeBookmarksHash([a, b]), computeBookmarksHash([b, a]));
});

test('loadSnapshots validates per entry, preserves unknown keys, and recomputes counts/hash', () => {
  const storage = createCappedStorage();
  const validBookmarks = [
    {
      title: 'Good',
      url: 'https://good.example',
      section: 'All',
      alias: 'g',
    },
  ];
  storage.setItem(
    SNAPSHOTS_KEY,
    JSON.stringify({
      version: 1,
      snapshots: [
        {
          id: 'snap-valid',
          createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Valid',
          trigger: 'manual',
          bookmarkCount: 999,
          sectionCount: 999,
          hash: 'stale-hash',
          bookmarks: validBookmarks,
        },
        {
          id: 'snap-valid', // duplicate id should be skipped
          createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Duplicate',
          trigger: 'manual',
          bookmarks: validBookmarks,
        },
        {
          id: 'snap-bad-url',
          createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Bad URL',
          trigger: 'manual',
          bookmarks: [{ title: 'Bad', url: 'javascript:alert(1)', section: 'Work' }],
        },
        {
          id: 'snap-empty',
          createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Empty',
          trigger: 'manual',
          bookmarks: [],
        },
        {
          id: 'snap-bad-trigger',
          createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Bad Trigger',
          trigger: 'unknown-trigger',
          bookmarks: validBookmarks,
        },
      ],
    }),
  );

  const loaded = loadSnapshots(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'snap-valid');
  assert.equal(loaded[0].bookmarkCount, 1);
  assert.equal(loaded[0].sectionCount, 1);
  assert.equal(loaded[0].bookmarks[0].section, 'Uncategorized');
  assert.equal((loaded[0].bookmarks[0] as unknown as Record<string, unknown>).alias, 'g');
  assert.equal(loaded[0].hash, computeBookmarksHash(loaded[0].bookmarks));
});

test('diffSnapshotAgainstLive distinguishes identical vs order-only changes', () => {
  const a = makeBookmark(1, 'Work');
  const b = makeBookmark(2, 'Media');

  const identical = diffSnapshotAgainstLive([a, b], [a, b]);
  assert.equal(identical.isIdenticalToLive, true);
  assert.equal(identical.orderChanged, false);

  const reordered = diffSnapshotAgainstLive([b, a], [a, b]);
  assert.equal(reordered.restoredOrAddedCount, 0);
  assert.equal(reordered.changedCount, 0);
  assert.equal(reordered.removedCount, 0);
  assert.equal(reordered.unchangedCount, 2);
  assert.equal(reordered.orderChanged, true);
  assert.equal(reordered.isIdenticalToLive, false);
});

test('ring buffer deduplicates, defaults empty manual label, upgrades manual, and evicts auto first', () => {
  const b1 = [makeBookmark(1)];
  const emptySkip = buildNextSnapshots([], { trigger: 'manual', label: 'Empty', bookmarks: [] });
  assert.equal(emptySkip.status, 'skipped-empty');

  // Empty manual label defaults to 'Manual checkpoint'
  const first = buildNextSnapshots([], { trigger: 'manual', label: '   ', bookmarks: b1 });
  assert.equal(first.status, 'added');
  assert.equal(first.snapshots[0].label, 'Manual checkpoint');

  // Auto with same hash is deduplicated
  const dupAuto = buildNextSnapshots(first.snapshots, {
    trigger: 'pre-import',
    label: 'Auto import',
    bookmarks: b1,
  });
  assert.equal(dupAuto.status, 'deduplicated');

  // Auto then manual with same hash upgrades in place
  const autoStart = buildNextSnapshots([], {
    trigger: 'pre-import',
    label: 'Before import',
    bookmarks: b1,
  });
  const upgraded = buildNextSnapshots(autoStart.snapshots, {
    trigger: 'manual',
    label: 'Pinned release',
    bookmarks: b1,
  });
  assert.equal(upgraded.status, 'upgraded');
  assert.equal(upgraded.snapshots.length, 1);
  assert.equal(upgraded.snapshots[0].trigger, 'manual');
  assert.equal(upgraded.snapshots[0].label, 'Pinned release');

  // Ring buffer cap (MAX_SNAPSHOTS = 15) evicts oldest auto before older manual
  let ring = buildNextSnapshots([], {
    trigger: 'manual',
    label: 'Old Manual',
    bookmarks: [makeBookmark(100)],
  }).snapshots;

  for (let i = 1; i <= MAX_SNAPSHOTS; i += 1) {
    ring = buildNextSnapshots(ring, {
      trigger: 'pre-import',
      label: `Auto ${i}`,
      bookmarks: [makeBookmark(i)],
    }).snapshots;
  }

  assert.equal(ring.length, MAX_SNAPSHOTS);
  assert.equal(ring.some((s) => s.label === 'Old Manual'), true);
  assert.equal(ring.some((s) => s.label === 'Auto 1'), false);

  // saveManualSnapshot with empty label persists and survives loadSnapshots
  const storage = createCappedStorage();
  const saved = saveManualSnapshot(storage, b1, '   ');
  assert.equal(saved.ok, true);
  assert.equal(saved.snapshots[0].label, 'Manual checkpoint');
  assert.equal(loadSnapshots(storage).length, 1);
  assert.equal(loadSnapshots(storage)[0].label, 'Manual checkpoint');

  // deleteSnapshotFromVault removes entry cleanly
  const deleted = deleteSnapshotFromVault(storage, saved.snapshots[0].id);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.snapshots.length, 0);
  assert.equal(storage.getItem(SNAPSHOTS_KEY), null);
});

test('two-phase QuotaExceededError defense protects primary bookmarks and evicts corrupt snapshots', () => {
  // 1. Phase 1 evicts valid snapshots to make room for primary write
  const primaryList = [makeBookmark(1, 'Work', 'x'.repeat(500))];
  const primaryBytes = STORAGE_KEY.length + JSON.stringify(primaryList).length;
  // Cap fits small primary + S1 (~600 bytes), or large primaryList alone (~610 bytes), but NOT both
  const tightStorage = createCappedStorage(primaryBytes + 220);

  // Seed vault with a snapshot that consumes ~450 bytes while primary is small (~100 bytes)
  const seed = persistBookmarksWithVault(tightStorage, [makeBookmark(1)], {
    snapshots: [{ trigger: 'pre-import', label: 'S1', bookmarks: [makeBookmark(2, 'Work', 'y'.repeat(220))] }],
  });
  assert.equal(seed.ok, true);
  assert.equal(seed.snapshots.length, 1);

  const primaryRes = persistBookmarksWithVault(tightStorage, primaryList, {
    snapshots: [{ trigger: 'pre-import', label: 'S2', bookmarks: [makeBookmark(3, 'Work', 'z'.repeat(220))] }],
  });
  assert.equal(primaryRes.ok, true);
  assert.equal(primaryRes.evictedForPrimary >= 1, true);
  assert.deepEqual(JSON.parse(tightStorage.getItem(STORAGE_KEY)!), primaryList);
  assert.equal(primaryRes.snapshotWarning, 'snapshot-quota-exceeded');

  // 2. Guardrail 4: Phase 1 removes giant corrupt unparseable SNAPSHOTS_KEY to fit primary save
  const corruptSnapStorage = createCappedStorage(primaryBytes + 150);
  corruptSnapStorage.setItem(SNAPSHOTS_KEY, 'corrupt-garbage-'.repeat(25));
  const rescued = persistBookmarksWithVault(corruptSnapStorage, primaryList);
  assert.equal(rescued.ok, true);
  assert.deepEqual(JSON.parse(corruptSnapStorage.getItem(STORAGE_KEY)!), primaryList);
  assert.equal(corruptSnapStorage.getItem(SNAPSHOTS_KEY), null);

  // 3. Rollback SNAPSHOTS_KEY if primary alone exceeds total quota
  const tinyStorage = createCappedStorage(420);
  const initialSnap = persistBookmarksWithVault(tinyStorage, [makeBookmark(1)], {
    snapshots: [{ trigger: 'manual', label: 'Keep me', bookmarks: [makeBookmark(1)] }],
  });
  assert.equal(initialSnap.ok, true);
  const rawBefore = tinyStorage.getItem(SNAPSHOTS_KEY);

  const failHuge = persistBookmarksWithVault(tinyStorage, [makeBookmark(1, 'Work', 'h'.repeat(500))]);
  assert.equal(failHuge.ok, false);
  assert.equal(tinyStorage.getItem(SNAPSHOTS_KEY), rawBefore);
});

test('corrupt backup rescue reads backup-key or primary-key fallback and clears only on repair/dismiss', () => {
  // backup-key case
  const storage = createCappedStorage();
  storage.setItem(BACKUP_KEY, '{"broken":');
  const backupInfo = readCorruptBackup(storage);
  assert.equal(backupInfo?.source, 'backup-key');
  assert.equal(backupInfo?.failure, 'truncated');

  // Normal save (clearCorruptBackup: false) preserves BACKUP_KEY
  const normalSave = persistBookmarksWithVault(storage, [makeBookmark(1)], {
    clearCorruptBackup: false,
  });
  assert.equal(normalSave.ok, true);
  assert.equal(storage.getItem(BACKUP_KEY), '{"broken":');

  // Repair save (clearCorruptBackup: true) removes BACKUP_KEY
  const repairSave = persistBookmarksWithVault(storage, [makeBookmark(1)], {
    clearCorruptBackup: true,
  });
  assert.equal(repairSave.ok, true);
  assert.equal(storage.getItem(BACKUP_KEY), null);

  // Repair save under tight quota frees BACKUP_KEY during Phase 1 to fit primary
  const repaired = [makeBookmark(1, 'Work', 'r'.repeat(200))];
  const needed = STORAGE_KEY.length + JSON.stringify(repaired).length + 40;
  const tightRepair = createCappedStorage(needed);
  tightRepair.setItem(BACKUP_KEY, '{' + 'x'.repeat(180));
  const tightResult = persistBookmarksWithVault(tightRepair, repaired, {
    clearCorruptBackup: true,
  });
  assert.equal(tightResult.ok, true);
  assert.equal(tightRepair.getItem(BACKUP_KEY), null);

  // primary-key fallback when startup backup failed
  const fallbackStorage = createCappedStorage();
  fallbackStorage.setItem(STORAGE_KEY, '[{"title":1}]');
  const primaryFallback = readCorruptBackup(fallbackStorage);
  assert.equal(primaryFallback?.source, 'primary-key');
  assert.equal(primaryFallback?.failure, 'invalid');

  // clearCorruptBackup removes corrupt primary-key too
  clearCorruptBackup(fallbackStorage);
  assert.equal(readCorruptBackup(fallbackStorage), null);
  assert.equal(fallbackStorage.getItem(STORAGE_KEY), null);
});

test('saveManualSnapshot preserves existing snapshots untouched when new checkpoint exceeds quota', () => {
  const s1Bookmarks = [makeBookmark(1, 'Work', 'a'.repeat(40))];
  const s2Bookmarks = [makeBookmark(2, 'Work', 'b'.repeat(40))];
  const storage = createCappedStorage(1200);

  const first = saveManualSnapshot(storage, s1Bookmarks, 'Checkpoint 1');
  const second = saveManualSnapshot(storage, s2Bookmarks, 'Checkpoint 2');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.snapshots.length, 2);

  const rawBefore = storage.getItem(SNAPSHOTS_KEY);
  assert.notEqual(rawBefore, null);

  const hugeBookmarks = [makeBookmark(3, 'Work', 'x'.repeat(1300))];
  const failed = saveManualSnapshot(storage, hugeBookmarks, 'Too large');
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 'quota-exceeded');
  assert.deepEqual(
    failed.snapshots.map((snapshot) => snapshot.label),
    ['Checkpoint 2', 'Checkpoint 1'],
  );
  assert.equal(storage.getItem(SNAPSHOTS_KEY), rawBefore);
  assert.deepEqual(
    loadSnapshots(storage).map((snapshot) => snapshot.label),
    ['Checkpoint 2', 'Checkpoint 1'],
  );
});

test('persistBookmarksWithVault Phase 2 preserves surviving snapshots when new auto-snapshot exceeds quota', () => {
  // Case 1: Phase 1 does not touch SNAPSHOTS_KEY; Phase 2 auto-snapshot overflows remaining quota
  const storage = createCappedStorage(1500);
  const seed1 = persistBookmarksWithVault(storage, [makeBookmark(1)], {
    snapshots: [{ trigger: 'manual', label: 'Keep 1', bookmarks: [makeBookmark(10)] }],
  });
  const seed2 = persistBookmarksWithVault(storage, [makeBookmark(2)], {
    snapshots: [{ trigger: 'pre-import', label: 'Keep 2', bookmarks: [makeBookmark(11)] }],
  });
  assert.equal(seed1.ok, true);
  assert.equal(seed2.ok, true);
  assert.equal(seed2.snapshots.length, 2);

  const rawBefore = storage.getItem(SNAPSHOTS_KEY);
  const nextPrimary = [makeBookmark(3)];
  const phase2Overflow = persistBookmarksWithVault(storage, nextPrimary, {
    snapshots: [{
      trigger: 'pre-import',
      label: 'Huge auto snapshot',
      bookmarks: [makeBookmark(12, 'Work', 'z'.repeat(1600))],
    }],
  });

  assert.equal(phase2Overflow.ok, true);
  assert.equal(phase2Overflow.evictedForPrimary, 0);
  assert.equal(phase2Overflow.snapshotWarning, 'snapshot-quota-exceeded');
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)!), nextPrimary);
  assert.deepEqual(
    phase2Overflow.snapshots.map((snapshot) => snapshot.label),
    ['Keep 2', 'Keep 1'],
  );
  assert.equal(storage.getItem(SNAPSHOTS_KEY), rawBefore);
  assert.deepEqual(
    loadSnapshots(storage).map((snapshot) => snapshot.label),
    ['Keep 2', 'Keep 1'],
  );

  // Case 2: Phase 1 partially evicts oldest auto snapshot, leaving Pinned manual snapshot surviving,
  // and Phase 2's new auto-snapshot exceeds remaining space -> Pinned manual snapshot must survive!
  const smallPrimary = [makeBookmark(1)];
  const smallPrimaryBytes = STORAGE_KEY.length + JSON.stringify(smallPrimary).length;
  const pinnedPayload = [makeBookmark(20, 'Work', 'p'.repeat(40))];
  const oldAutoPayload = [makeBookmark(22, 'Work', 'o'.repeat(120))];
  const grownPrimary = [makeBookmark(21, 'Work', 'g'.repeat(420))];
  const grownPrimaryBytes = STORAGE_KEY.length + JSON.stringify(grownPrimary).length;

  const probe = createCappedStorage();
  const pinnedSnap = saveManualSnapshot(probe, pinnedPayload, 'Pinned');
  const pinnedVaultBytes = SNAPSHOTS_KEY.length + probe.getItem(SNAPSHOTS_KEY)!.length;
  const bothProbe = persistBookmarksWithVault(probe, smallPrimary, {
    snapshots: [{ trigger: 'pre-import', label: 'OldAuto', bookmarks: oldAutoPayload }],
  });
  const bothVaultBytes = SNAPSHOTS_KEY.length + probe.getItem(SNAPSHOTS_KEY)!.length;
  const cap = Math.max(smallPrimaryBytes + bothVaultBytes, grownPrimaryBytes + pinnedVaultBytes) + 40;
  assert.equal(grownPrimaryBytes + bothVaultBytes > cap, true);

  const partialStorage = createCappedStorage(cap);
  const p1 = persistBookmarksWithVault(partialStorage, smallPrimary, {
    snapshots: [{ trigger: 'manual', label: 'Pinned', bookmarks: pinnedPayload }],
  });
  const p2 = persistBookmarksWithVault(partialStorage, smallPrimary, {
    snapshots: [{ trigger: 'pre-import', label: 'OldAuto', bookmarks: oldAutoPayload }],
  });
  assert.equal(pinnedSnap.ok, true);
  assert.equal(bothProbe.ok, true);
  assert.equal(p1.ok, true);
  assert.equal(p2.ok, true);
  assert.equal(p2.snapshots.length, 2);

  const partialRes = persistBookmarksWithVault(partialStorage, grownPrimary, {
    snapshots: [{
      trigger: 'pre-import',
      label: 'HugeAuto',
      bookmarks: [makeBookmark(23, 'Work', 'h'.repeat(900))],
    }],
  });

  assert.equal(partialRes.ok, true);
  assert.equal(partialRes.evictedForPrimary, 1);
  assert.equal(partialRes.snapshotWarning, 'snapshot-quota-exceeded');
  assert.deepEqual(JSON.parse(partialStorage.getItem(STORAGE_KEY)!), grownPrimary);
  assert.deepEqual(
    partialRes.snapshots.map((snapshot) => snapshot.label),
    ['Pinned'],
  );
  assert.deepEqual(
    loadSnapshots(partialStorage).map((snapshot) => snapshot.label),
    ['Pinned'],
  );
});

test('handles blocked storage errors and 15-manual + 1-auto ring eviction cleanly', () => {
  const blockedStorage = {
    getItem(): string | null {
      throw new Error('SecurityError');
    },
    setItem(): void {
      throw new Error('SecurityError');
    },
    removeItem(): void {
      throw new Error('SecurityError');
    },
  };

  assert.deepEqual(loadSnapshots(blockedStorage), []);
  assert.equal(readCorruptBackup(blockedStorage), null);
  assert.doesNotThrow(() => clearCorruptBackup(blockedStorage));
  assert.deepEqual(persistBookmarksWithVault(blockedStorage, [makeBookmark(1)]), {
    ok: false,
    snapshots: [],
    evictedForPrimary: 0,
  });
  const manualBlocked = saveManualSnapshot(blockedStorage, [makeBookmark(1)], 'Test');
  assert.equal(manualBlocked.ok, false);
  assert.equal(manualBlocked.status, 'quota-exceeded');

  // 15 manual snapshots + 1 new auto snapshot keeps length === MAX_SNAPSHOTS and evicts oldest manual (M1)
  let ring = buildNextSnapshots([], {
    trigger: 'manual',
    label: 'M1',
    bookmarks: [makeBookmark(1)],
  }).snapshots;
  for (let i = 2; i <= MAX_SNAPSHOTS; i += 1) {
    ring = buildNextSnapshots(ring, {
      trigger: 'manual',
      label: `M${i}`,
      bookmarks: [makeBookmark(i)],
    }).snapshots;
  }
  assert.equal(ring.length, MAX_SNAPSHOTS);

  const afterAuto = buildNextSnapshots(ring, {
    trigger: 'pre-import',
    label: 'Auto Safety',
    bookmarks: [makeBookmark(99)],
  });
  assert.equal(afterAuto.status, 'added');
  assert.equal(afterAuto.snapshots.length, MAX_SNAPSHOTS);
  assert.equal(afterAuto.snapshots[0].label, 'Auto Safety');
  assert.equal(afterAuto.snapshots.at(-1)?.label, 'M2');
  assert.equal(afterAuto.snapshots.some((s) => s.label === 'M1'), false);

  // Consecutive auto snapshots with identical bookmark hash deduplicate regardless of trigger/label
  const dedup = buildNextSnapshots(afterAuto.snapshots, {
    trigger: 'pre-editor-save',
    label: 'Before JSON edit',
    bookmarks: [makeBookmark(99)],
  });
  assert.equal(dedup.status, 'deduplicated');
  assert.equal(dedup.snapshots.length, MAX_SNAPSHOTS);
});

test('loadSnapshots resists prototype-chain mutation from __proto__ keys while tolerating constructor keys', () => {
  const raw = JSON.stringify({
    version: 1,
    snapshots: [
      {
        id: 'snap-proto',
        createdAt: '2026-01-01T00:00:00.000Z',
        label: 'Proto test',
        trigger: 'manual',
        bookmarks: [
          JSON.parse(
            '{"title":"A","url":"https://a.example","section":"Work","constructor":"custom","__proto__":{"topPolluted":true},"meta":{"__proto__":{"nestedPolluted":true}}}',
          ),
        ],
      },
    ],
  });
  const storage = createCappedStorage();
  storage.setItem(SNAPSHOTS_KEY, raw);

  const loaded = loadSnapshots(storage);
  assert.equal(loaded.length, 1);
  const loadedRecord = loaded[0].bookmarks[0] as unknown as Record<string, unknown>;
  assert.equal(loadedRecord.topPolluted, undefined);
  assert.equal(loadedRecord.constructor, 'custom');
  const meta = loadedRecord.meta as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(meta), Object.prototype);
  assert.equal(meta.nestedPolluted, undefined);
});

test('deleteSnapshotFromVault reports ok: false and preserves snapshot when removeItem fails on last snapshot', () => {
  const storage = createCappedStorage();
  const saved = saveManualSnapshot(storage, [makeBookmark(1)], 'Only Snapshot');
  assert.equal(saved.ok, true);

  const throwingRemoveStorage = {
    getItem: (key: string) => storage.getItem(key),
    setItem: (key: string, value: string) => storage.setItem(key, value),
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };

  const deleted = deleteSnapshotFromVault(throwingRemoveStorage, saved.snapshots[0].id);
  assert.equal(deleted.ok, false);
  assert.equal(deleted.snapshots.length, 1);
  assert.equal(loadSnapshots(storage).length, 1);
});

test('diffSnapshotAgainstLive accounts for duplicate URLs instead of reporting order-only change', () => {
  const a1: Bookmark = { title: 'A', url: 'https://a.example', section: 'Work' };
  const a2: Bookmark = { title: 'A dup', url: 'https://a.example/', section: 'Work' };

  const liveHasDup = diffSnapshotAgainstLive([a1], [a1, a2]);
  assert.equal(liveHasDup.removedCount, 1);
  assert.equal(liveHasDup.orderChanged, false);
  assert.equal(liveHasDup.isIdenticalToLive, false);

  const snapHasDup = diffSnapshotAgainstLive([a1, a2], [a1]);
  assert.equal(snapHasDup.restoredOrAddedCount, 1);
  assert.equal(snapHasDup.orderChanged, false);
  assert.equal(snapHasDup.isIdenticalToLive, false);
});

test('shortBookmarksHash, chip/live badges, and formatPreRestoreLabel slice 6 hex chars after colon', () => {
  const listA = [makeBookmark(1, 'Work')];
  const listB = [makeBookmark(2, 'Media')];
  const fullHashA = computeBookmarksHash(listA);
  const shortA = shortBookmarksHash(fullHashA);

  assert.equal(fullHashA.includes(':'), true);
  assert.match(shortA, /^[0-9a-f]{6}$/);
  assert.equal(shortA, fullHashA.split(':')[1]!.slice(0, 6));
  assert.notEqual(shortA, shortBookmarksHash(computeBookmarksHash(listB)));

  // Fallback without colon prefix
  assert.equal(shortBookmarksHash('  ABCDEF123456  '), 'abcdef');

  assert.equal(formatShortHashChip(fullHashA), `#${shortA}`);
  assert.equal(formatLiveHashBadge([]), null);
  assert.equal(formatLiveHashBadge(listA), `Current · #${shortA}`);
  assert.equal(formatPreRestoreLabel({ hash: fullHashA }), `Before restoring #${shortA}`);
});

test('vault-wide deduplication prevents ping-pong restore bloat and nested pre-restore labels', () => {
  const storage = createCappedStorage();
  const stateA = [makeBookmark(1, 'Work')];
  const stateB = [makeBookmark(2, 'Reading'), makeBookmark(3, 'Reading')];
  const stateC = [makeBookmark(4, 'Tools')];

  const hashA = computeBookmarksHash(stateA);
  const hashB = computeBookmarksHash(stateB);
  const shortA = shortBookmarksHash(hashA);

  // 1. User replaces initial stateA with stateB -> Snapshot 1 captures stateA
  let live = stateB;
  let res = persistBookmarksWithVault(storage, live, {
    snapshots: [{
      trigger: 'pre-replace',
      label: 'Before replacing with bookmarks (1).json',
      bookmarks: stateA,
    }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.snapshots.length, 1);
  assert.equal(res.snapshots[0].hash, hashA);

  // 2. First restore: restore stateA -> live stateB is new to vault, saved with flat #xxxxxx label
  const snapA = res.snapshots[0];
  res = persistBookmarksWithVault(storage, snapA.bookmarks, {
    snapshots: [{
      trigger: 'pre-restore',
      label: formatPreRestoreLabel(snapA),
      bookmarks: live,
    }],
  });
  live = snapA.bookmarks;
  assert.equal(res.snapshots.length, 2);
  assert.equal(res.snapshots[0].hash, hashB);
  assert.equal(res.snapshots[0].label, `Before restoring #${shortA}`);
  assert.equal(res.snapshots[0].trigger, 'pre-restore');
  assert.equal(res.snapshots[1].hash, hashA);
  assert.equal(res.snapshots[1].label, 'Before replacing with bookmarks (1).json');

  // 3. Ping-pong restore back and forth 6 times -> zero new snapshots, zero nested labels
  for (let step = 0; step < 6; step += 1) {
    const targetHash = step % 2 === 0 ? hashB : hashA;
    const targetSnap = res.snapshots.find((s) => s.hash === targetHash)!;
    res = persistBookmarksWithVault(storage, targetSnap.bookmarks, {
      snapshots: [{
        trigger: 'pre-restore',
        label: formatPreRestoreLabel(targetSnap),
        bookmarks: live,
      }],
    });
    live = targetSnap.bookmarks;

    assert.equal(res.snapshots.length, 2);
    const uniqueHashes = new Set(res.snapshots.map((s) => s.hash));
    assert.equal(uniqueHashes.size, 2);

    const entryA = res.snapshots.find((s) => s.hash === hashA)!;
    const entryB = res.snapshots.find((s) => s.hash === hashB)!;
    assert.equal(entryA.label, 'Before replacing with bookmarks (1).json');
    assert.equal(entryA.trigger, 'pre-replace');
    assert.equal(entryB.label, `Before restoring #${shortA}`);
    assert.equal(entryB.trigger, 'pre-restore');
  }

  // Persisted storage agrees with in-memory ring
  const persisted = loadSnapshots(storage);
  assert.equal(persisted.length, 2);
  assert.equal(persisted.some((s) => s.label.includes('Before restoring “')), false);

  // 4. Editing live to brand-new stateC then restoring snapA records flat #xxxxxx label for stateC
  live = stateC;
  const targetA = res.snapshots.find((s) => s.hash === hashA)!;
  res = persistBookmarksWithVault(storage, targetA.bookmarks, {
    snapshots: [{
      trigger: 'pre-restore',
      label: formatPreRestoreLabel(targetA),
      bookmarks: live,
    }],
  });
  assert.equal(res.snapshots.length, 3);
  assert.equal(res.snapshots[0].hash, computeBookmarksHash(stateC));
  assert.equal(res.snapshots[0].label, `Before restoring #${shortA}`);
});

test('full-ring deduplication preserves manual trigger/label on auto-match and upgrades older auto on manual save', () => {
  const storage = createCappedStorage();
  const pinnedBookmarks = [makeBookmark(10, 'Work')];
  const autoBookmarks = [makeBookmark(20, 'Media')];

  // Seed manual checkpoint, then push 3 newer auto snapshots so manual sits at index 3
  const manualInit = saveManualSnapshot(storage, pinnedBookmarks, 'Pinned milestone');
  assert.equal(manualInit.ok, true);

  let ring = manualInit.snapshots;
  ring = persistBookmarksWithVault(storage, [makeBookmark(99)], {
    snapshots: [
      { trigger: 'pre-replace', label: 'Before replacing with export.html', bookmarks: autoBookmarks },
      { trigger: 'pre-import', label: 'Auto 2', bookmarks: [makeBookmark(21)] },
      { trigger: 'pre-editor-save', label: 'Auto 3', bookmarks: [makeBookmark(22)] },
    ],
  }).snapshots;
  assert.equal(ring.length, 4);
  assert.equal(ring[3].label, 'Pinned milestone');
  assert.equal(ring[3].trigger, 'manual');

  // Auto pre-restore matching 'Pinned milestone' at index 3 bubbles it to index 0 WITHOUT downgrading trigger or label
  const afterAutoMatch = persistBookmarksWithVault(storage, [makeBookmark(100)], {
    snapshots: [{
      trigger: 'pre-restore',
      label: 'Before restoring #ffffff',
      bookmarks: pinnedBookmarks,
    }],
  });
  assert.equal(afterAutoMatch.ok, true);
  assert.equal(afterAutoMatch.snapshots.length, 4);
  assert.equal(afterAutoMatch.snapshots[0].label, 'Pinned milestone');
  assert.equal(afterAutoMatch.snapshots[0].trigger, 'manual');
  assert.equal(afterAutoMatch.snapshots[0].id, manualInit.snapshots[0].id);

  // Manual checkpoint with blank label matching older auto-snapshot ('Before replacing with export.html')
  // bubbles and upgrades it to 'manual' while keeping its descriptive label
  const upgradedBlank = saveManualSnapshot(storage, autoBookmarks, '   ');
  assert.equal(upgradedBlank.ok, true);
  assert.equal(upgradedBlank.status, 'upgraded');
  assert.equal(upgradedBlank.snapshots.length, 4);
  assert.equal(upgradedBlank.snapshots[0].trigger, 'manual');
  assert.equal(upgradedBlank.snapshots[0].label, 'Before replacing with export.html');

  // Manual checkpoint with explicit new label renames the matching entry in place at index 0
  const upgradedNamed = saveManualSnapshot(storage, autoBookmarks, 'Curated v2');
  assert.equal(upgradedNamed.ok, true);
  assert.equal(upgradedNamed.status, 'upgraded');
  assert.equal(upgradedNamed.snapshots.length, 4);
  assert.equal(upgradedNamed.snapshots[0].trigger, 'manual');
  assert.equal(upgradedNamed.snapshots[0].label, 'Curated v2');

  const reloaded = loadSnapshots(storage);
  assert.equal(reloaded.length, 4);
  assert.equal(new Set(reloaded.map((s) => s.hash)).size, 4);
});
