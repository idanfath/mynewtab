import {
  STORAGE_KEY,
  findMatchingBookmark,
  getBookmarkShortcuts,
  parseBookmarks,
  type Bookmark,
} from './bookmarks.ts';
import {
  normalizeSearchUrl,
  normalizeUrl,
} from './lib.ts';
import { cloneWithoutProto } from './bookmarkMerge.ts';
import {
  computeBookmarksHash,
  diffSnapshotAgainstLive,
} from './snapshotVault.ts';

export interface ExternalSyncConflict {
  externalBookmarks: Bookmark[];
  externalHash: string;
  detectedAt: string;
  summary: {
    added: number;
    changed: number;
    removed: number;
  };
}

export type ExternalSyncTransition =
  | { kind: 'invalid-external' }
  | { kind: 'noop' }
  | {
      kind: 'background-sync';
      bookmarks: Bookmark[];
      section: string;
      activeBookmark: Bookmark | null;
      clearUndo: true;
    }
  | {
      kind: 'modal-reverted';
      clearConflict: true;
      clearUndo: true;
    }
  | {
      kind: 'modal-conflict';
      conflict: ExternalSyncConflict;
      clearUndo: true;
    };

const OPTIONAL_SCALARS = ['subsection', 'description', 'tier', 'product'] as const;
const OPTIONAL_ARRAYS = ['categories', 'capabilities', 'pros', 'cons', 'formats'] as const;

export function normalizeExternalBookmarks(bookmarks: readonly Bookmark[]): Bookmark[] {
  return bookmarks.map((bookmark) => {
    const rawSection = bookmark.section.trim();
    const section = !rawSection || rawSection.toLocaleLowerCase() === 'all'
      ? 'Uncategorized'
      : rawSection;

    const next: Record<string, unknown> = {
      ...(cloneWithoutProto(bookmark) as Record<string, unknown>),
      title: bookmark.title.trim(),
      url: bookmark.url.trim(),
      section,
    };

    for (const field of OPTIONAL_SCALARS) {
      const cleaned = bookmark[field]?.trim();
      if (cleaned) next[field] = cleaned;
      else delete next[field];
    }

    const rawIcon = bookmark.iconUrl?.trim();
    if (rawIcon) {
      const normalizedIcon = normalizeUrl(rawIcon);
      if (normalizedIcon) next.iconUrl = normalizedIcon;
      else delete next.iconUrl;
    } else {
      delete next.iconUrl;
    }

    const shortcuts = getBookmarkShortcuts(bookmark);
    delete next.alias;
    delete next.searchUrl;
    delete next.shortcuts;
    if (shortcuts.length > 0) {
      next.shortcuts = shortcuts;
    } else if (bookmark.shortcuts === undefined) {
      const rawSearch = bookmark.searchUrl?.trim();
      if (rawSearch) {
        const normalizedSearch = normalizeSearchUrl(rawSearch);
        if (normalizedSearch) next.searchUrl = normalizedSearch;
      }
    }

    for (const field of OPTIONAL_ARRAYS) {
      const cleaned = bookmark[field]?.map((entry) => entry.trim()).filter(Boolean);
      if (cleaned && cleaned.length > 0) next[field] = cleaned;
      else delete next[field];
    }

    return next as unknown as Bookmark;
  });
}

export function summarizeExternalDiff(
  baseBookmarks: readonly Bookmark[],
  externalBookmarks: readonly Bookmark[],
): { added: number; changed: number; removed: number } {
  const diff = diffSnapshotAgainstLive(externalBookmarks, baseBookmarks);
  return {
    added: diff.restoredOrAddedCount,
    changed: diff.changedCount,
    removed: diff.removedCount,
  };
}

export function reconcileViewAfterSync(
  nextBookmarks: readonly Bookmark[],
  currentSection: string,
  currentActiveBookmark: Bookmark | null,
): { section: string; activeBookmark: Bookmark | null } {
  const nextSection = currentSection === 'All'
    || nextBookmarks.some((bookmark) => bookmark.section === currentSection)
    ? currentSection
    : 'All';

  const nextActive = currentActiveBookmark
    ? findMatchingBookmark(nextBookmarks, currentActiveBookmark)
    : null;

  return { section: nextSection, activeBookmark: nextActive };
}

export function detectDiskConflict(
  storage: Pick<Storage, 'getItem'>,
  modalBaseHash: string | null,
  modalBaseBookmarks: readonly Bookmark[] | null,
  nowIso = new Date().toISOString(),
): ExternalSyncConflict | null {
  if (modalBaseHash === null) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  let diskBookmarks: Bookmark[];
  if (raw === null || !raw.trim()) {
    diskBookmarks = [];
  } else {
    try {
      diskBookmarks = normalizeExternalBookmarks(parseBookmarks(raw));
    } catch {
      return null;
    }
  }

  const diskHash = computeBookmarksHash(diskBookmarks);
  if (diskHash === modalBaseHash) return null;

  const baseline = modalBaseBookmarks ?? [];
  return {
    externalBookmarks: diskBookmarks,
    externalHash: diskHash,
    detectedAt: nowIso,
    summary: summarizeExternalDiff(baseline, diskBookmarks),
  };
}

export function evaluateExternalBookmarkChange(params: {
  rawNewValue: string | null;
  currentBookmarks: readonly Bookmark[];
  currentSection: string;
  currentActiveBookmark: Bookmark | null;
  isEditModalOpen: boolean;
  modalBaseHash: string | null;
  modalBaseBookmarks: readonly Bookmark[] | null;
  nowIso?: string;
}): ExternalSyncTransition {
  const {
    rawNewValue,
    currentBookmarks,
    currentSection,
    currentActiveBookmark,
    isEditModalOpen,
    modalBaseHash,
    modalBaseBookmarks,
    nowIso = new Date().toISOString(),
  } = params;

  let externalBookmarks: Bookmark[];
  if (rawNewValue === null || !rawNewValue.trim()) {
    externalBookmarks = [];
  } else {
    try {
      externalBookmarks = normalizeExternalBookmarks(parseBookmarks(rawNewValue));
    } catch {
      return { kind: 'invalid-external' };
    }
  }

  const externalHash = computeBookmarksHash(externalBookmarks);

  if (!isEditModalOpen) {
    const currentHash = computeBookmarksHash(currentBookmarks);
    if (externalHash === currentHash) {
      return { kind: 'noop' };
    }
    const reconciled = reconcileViewAfterSync(
      externalBookmarks,
      currentSection,
      currentActiveBookmark,
    );
    return {
      kind: 'background-sync',
      bookmarks: externalBookmarks,
      section: reconciled.section,
      activeBookmark: reconciled.activeBookmark,
      clearUndo: true,
    };
  }

  const baseHash = modalBaseHash ?? computeBookmarksHash(currentBookmarks);
  const baseBookmarks = modalBaseBookmarks ?? currentBookmarks;

  if (externalHash === baseHash) {
    return {
      kind: 'modal-reverted',
      clearConflict: true,
      clearUndo: true,
    };
  }

  return {
    kind: 'modal-conflict',
    conflict: {
      externalBookmarks,
      externalHash,
      detectedAt: nowIso,
      summary: summarizeExternalDiff(baseBookmarks, externalBookmarks),
    },
    clearUndo: true,
  };
}
