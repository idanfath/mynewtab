import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_KEY, findMatchingBookmark, type Bookmark } from '../src/bookmarks.ts';
import {
  computeBookmarksHash,
  loadSnapshots,
  persistBookmarksWithVault,
} from '../src/snapshotVault.ts';
import {
  detectDiskConflict,
  evaluateExternalBookmarkChange,
  normalizeExternalBookmarks,
  reconcileViewAfterSync,
  summarizeExternalDiff,
} from '../src/storageSync.ts';

function memoryStorage(initial = new Map<string, string>()) {
  return {
    map: initial,
    getItem: (key: string) => initial.get(key) ?? null,
    setItem: (key: string, value: string) => {
      initial.set(key, value);
    },
    removeItem: (key: string) => {
      initial.delete(key);
    },
  };
}

const A: Bookmark = { title: 'Alpha', url: 'https://a.example', section: 'Work' };
const B: Bookmark = { title: 'Beta', url: 'https://b.example', section: 'Media' };
const C: Bookmark = { title: 'Gamma', url: 'https://c.example', section: 'Reading' };
const D: Bookmark = { title: 'Delta', url: 'https://d.example', section: 'Tools' };

test('background sync converges bookmarks, reconciles view, and preserves unknown keys', () => {
  const externalRaw = JSON.stringify([
    {
      title: ' Alpha ',
      url: 'https://a.example/',
      section: 'All',
      alias: 'al',
    },
    C,
  ]);

  const transition = evaluateExternalBookmarkChange({
    rawNewValue: externalRaw,
    currentBookmarks: [A, B],
    currentSection: 'Media',
    currentActiveBookmark: A,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });

  assert.equal(transition.kind, 'background-sync');
  if (transition.kind !== 'background-sync') return;
  assert.equal(transition.clearUndo, true);
  assert.equal(transition.section, 'All'); // 'Media' was removed
  assert.equal(transition.activeBookmark?.title, 'Alpha'); // matched by urlIdentity
  assert.equal(transition.bookmarks[0].section, 'Uncategorized'); // 'All' normalized
  assert.equal((transition.bookmarks[0] as unknown as Record<string, unknown>).alias, 'al');

  // Invalid external JSON does not wipe valid in-memory bookmarks
  const invalid = evaluateExternalBookmarkChange({
    rawNewValue: '{broken',
    currentBookmarks: [A, B],
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.equal(invalid.kind, 'invalid-external');

  // Reconcile keeps valid section and drops removed active bookmark
  const reconciled = reconcileViewAfterSync([A, C], 'Work', B);
  assert.equal(reconciled.section, 'Work');
  assert.equal(reconciled.activeBookmark, null);

  // Normalizer cleans scheme-less iconUrl
  const normalized = normalizeExternalBookmarks([
    { title: 'Iconed', url: 'https://i.example', section: 'Work', iconUrl: 'cdn.i.example/f.png' },
  ]);
  assert.equal(normalized[0].iconUrl, 'https://cdn.i.example/f.png');
});

test('open-modal conflict reports non-inverted diff polarity and clears on revert without replacing references', () => {
  const localBase = [A, B];
  const baseHash = computeBookmarksHash(localBase);

  // External tab deletes B and adds C and D -> +2 added, 0 changed, -1 removed
  const summary = summarizeExternalDiff(localBase, [A, C, D]);
  assert.deepEqual(summary, { added: 2, changed: 0, removed: 1 });

  const conflictTransition = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([A, C, D]),
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: true,
    modalBaseHash: baseHash,
    modalBaseBookmarks: localBase,
  });

  assert.equal(conflictTransition.kind, 'modal-conflict');
  if (conflictTransition.kind !== 'modal-conflict') return;
  assert.deepEqual(conflictTransition.conflict.summary, { added: 2, changed: 0, removed: 1 });
  assert.equal(conflictTransition.clearUndo, true);

  // External tab reverts back to local baseline -> modal-reverted (preserves local bookmark refs)
  const revertedTransition = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([A, B]),
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: true,
    modalBaseHash: baseHash,
    modalBaseBookmarks: localBase,
  });

  assert.deepEqual(revertedTransition, {
    kind: 'modal-reverted',
    clearConflict: true,
    clearUndo: true,
  });
});

test('detectDiskConflict catches un-dispatched writes and Save Mine archives external version', () => {
  const localBase = [A, B];
  const baseHash = computeBookmarksHash(localBase);
  const storage = memoryStorage(new Map([[STORAGE_KEY, JSON.stringify([A, C, D])]]));

  const conflict = detectDiskConflict(storage, baseHash, localBase);
  assert.ok(conflict);
  assert.deepEqual(conflict.summary, { added: 2, changed: 0, removed: 1 });

  // No conflict when disk matches baseline
  storage.setItem(STORAGE_KEY, JSON.stringify(localBase));
  assert.equal(detectDiskConflict(storage, baseHash, localBase), null);

  // "Save mine" snapshots externalConflict.externalBookmarks under 'external-conflict' before writing local edit
  const localEdited: Bookmark[] = [{ ...A, title: 'Alpha Edited' }, B];
  const saveRes = persistBookmarksWithVault(storage, localEdited, {
    snapshots: [
      {
        trigger: 'external-conflict',
        label: 'External tab changes before overwrite',
        bookmarks: conflict.externalBookmarks,
      },
    ],
  });
  assert.equal(saveRes.ok, true);
  const vault = loadSnapshots(storage);
  assert.equal(vault.length, 1);
  assert.equal(vault[0].trigger, 'external-conflict');
  assert.deepEqual(vault[0].bookmarks.map((b) => b.title), ['Alpha', 'Gamma', 'Delta']);
  assert.deepEqual(
    JSON.parse(storage.getItem(STORAGE_KEY)!).map((b: Bookmark) => b.title),
    ['Alpha Edited', 'Beta'],
  );
});

test('handles rapid external writes, external storage clear (newValue = null), and modal open/close transitions', () => {
  const localBase = [A, B];
  const baseHash = computeBookmarksHash(localBase);

  // External clear (newValue = null) when idle -> background-sync to []
  const clearedIdle = evaluateExternalBookmarkChange({
    rawNewValue: null,
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.deepEqual(clearedIdle, {
    kind: 'background-sync',
    bookmarks: [],
    section: 'All',
    activeBookmark: null,
    clearUndo: true,
  });

  // Subsequent clear when already empty -> noop
  const clearedAgain = evaluateExternalBookmarkChange({
    rawNewValue: null,
    currentBookmarks: [],
    currentSection: 'All',
    currentActiveBookmark: null,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.deepEqual(clearedAgain, { kind: 'noop' });

  // External clear while modal open -> modal-conflict with removed = 2
  const clearedInModal = evaluateExternalBookmarkChange({
    rawNewValue: null,
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: true,
    modalBaseHash: baseHash,
    modalBaseBookmarks: localBase,
  });
  assert.equal(clearedInModal.kind, 'modal-conflict');
  if (clearedInModal.kind === 'modal-conflict') {
    assert.deepEqual(clearedInModal.conflict.externalBookmarks, []);
    assert.deepEqual(clearedInModal.conflict.summary, { added: 0, changed: 0, removed: 2 });
  }

  // Rapid writes while modal open: write 1 -> conflict, write 2 -> updated conflict, write 3 -> modal-reverted
  const w1 = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([A, B, C]),
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: true,
    modalBaseHash: baseHash,
    modalBaseBookmarks: localBase,
  });
  assert.equal(w1.kind, 'modal-conflict');
  if (w1.kind === 'modal-conflict') {
    assert.deepEqual(w1.conflict.summary, { added: 1, changed: 0, removed: 0 });
  }

  const w2 = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([A, B, C, D]),
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: true,
    modalBaseHash: baseHash,
    modalBaseBookmarks: localBase,
  });
  assert.equal(w2.kind, 'modal-conflict');
  if (w2.kind === 'modal-conflict') {
    assert.deepEqual(w2.conflict.summary, { added: 2, changed: 0, removed: 0 });
  }

  const w3 = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify(localBase),
    currentBookmarks: localBase,
    currentSection: 'Work',
    currentActiveBookmark: A,
    isEditModalOpen: true,
    modalBaseHash: baseHash,
    modalBaseBookmarks: localBase,
  });
  assert.deepEqual(w3, {
    kind: 'modal-reverted',
    clearConflict: true,
    clearUndo: true,
  });

  // detectDiskConflict edge cases: cleared storage, corrupt storage, and throwing storage
  const clearedStorage = memoryStorage();
  const clearedDiskConflict = detectDiskConflict(clearedStorage, baseHash, localBase);
  assert.ok(clearedDiskConflict);
  assert.deepEqual(clearedDiskConflict.summary, { added: 0, changed: 0, removed: 2 });

  const corruptStorage = memoryStorage(new Map([[STORAGE_KEY, '{corrupt']]));
  assert.equal(detectDiskConflict(corruptStorage, baseHash, localBase), null);

  const blockedStorage = {
    getItem: () => {
      throw new Error('SecurityError');
    },
  };
  assert.equal(detectDiskConflict(blockedStorage, baseHash, localBase), null);
});

test('reconcileViewAfterSync and external reload disambiguate duplicate-URL bookmarks across sections', () => {
  const gamesWplace: Bookmark = { title: 'Wplace', url: 'https://wplace.live/', section: 'Games' };
  const pinnedWplace: Bookmark = { title: 'Wplace', url: 'https://wplace.live/', section: 'Pinned' };

  const externalRaw = JSON.stringify([
    gamesWplace,
    { ...pinnedWplace, description: 'Updated in other tab' },
    C,
  ]);

  const synced = evaluateExternalBookmarkChange({
    rawNewValue: externalRaw,
    currentBookmarks: [gamesWplace, pinnedWplace],
    currentSection: 'Pinned',
    currentActiveBookmark: pinnedWplace,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });

  assert.equal(synced.kind, 'background-sync');
  if (synced.kind !== 'background-sync') return;
  assert.equal(synced.section, 'Pinned');
  assert.equal(synced.activeBookmark?.section, 'Pinned');
  assert.equal(synced.activeBookmark?.description, 'Updated in other tab');

  const reloadedTarget = findMatchingBookmark(synced.bookmarks, pinnedWplace);
  assert.equal(reloadedTarget, synced.bookmarks[1]);
});
