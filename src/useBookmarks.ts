import { useCallback, useEffect, useState } from 'react';
import {
  BACKUP_KEY,
  STORAGE_KEY,
  loadStoredBookmarks,
  type Bookmark,
} from './bookmarks.ts';
import {
  clearCorruptBackup,
  deleteSnapshotFromVault,
  loadSnapshots,
  persistBookmarksWithVault,
  readCorruptBackup,
  saveManualSnapshot,
  type BookmarkSnapshot,
  type CorruptBackupInfo,
  type PersistVaultOptions,
  type PersistVaultResult,
} from './snapshotVault.ts';

export interface AppError {
  title: string;
  detail: string;
}

export interface UndoState {
  title: string;
  detail: string;
  bookmarks: Bookmark[];
  section: string;
  query: string;
  activeBookmark: Bookmark | null;
}

export type UndoMeta = Omit<UndoState, 'bookmarks'>;

export type RestoreUndoResult = UndoState | { error: AppError } | null;

export function storageError(title: string): AppError {
  return {
    title,
    detail: 'Browser storage is full, blocked, or unavailable. Existing bookmarks were not changed.',
  };
}

export type InitialState = { bookmarks: Bookmark[]; error: AppError | null };

export function buildInitialState(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): InitialState {
  try {
    const { bookmarks, recovery, failure } = loadStoredBookmarks(storage);
    if (!recovery) return { bookmarks, error: null };

    const cause = failure === 'invalid'
      ? 'The saved data is complete JSON but has invalid bookmark entries.'
      : 'The saved data looks truncated or is not valid JSON.';
    return {
      bookmarks,
      error: {
        title: 'Couldn’t read saved bookmarks',
        detail: recovery === 'backed-up'
          ? `${cause} A copy is kept in localStorage under ${BACKUP_KEY}, so new changes won’t lose it.`
          : `${cause} No backup could be made and the next save will overwrite them. Copy localStorage key ${STORAGE_KEY} first.`,
      },
    };
  } catch {
    return { bookmarks: [], error: null };
  }
}

export function loadInitialState(): InitialState {
  try {
    // Reading the localStorage global itself throws when site data is blocked.
    return buildInitialState(localStorage);
  } catch {
    return { bookmarks: [], error: null };
  }
}

function getBrowserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function useBookmarks() {
  // Lazy initializer: runs once per mount instead of at module import,
  // so tests/SSR importing this module pay no localStorage cost.
  const [initialState] = useState(loadInitialState);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialState.bookmarks);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [snapshots, setSnapshots] = useState<BookmarkSnapshot[]>(() => {
    const storage = getBrowserStorage();
    return storage ? loadSnapshots(storage) : [];
  });
  const [corruptBackup, setCorruptBackup] = useState<CorruptBackupInfo | null>(() => {
    const storage = getBrowserStorage();
    return storage ? readCorruptBackup(storage) : null;
  });

  useEffect(() => {
    if (!undoState) return;
    const timeoutId = window.setTimeout(() => setUndoState(null), 6500);
    return () => window.clearTimeout(timeoutId);
  }, [undoState]);

  const persistWithMeta = (
    nextBookmarks: Bookmark[],
    undo: UndoMeta | null,
    options: PersistVaultOptions = {},
  ): PersistVaultResult => {
    const storage = getBrowserStorage();
    if (!storage) {
      return { ok: false, snapshots, evictedForPrimary: 0 };
    }

    const resolvedSnapshots = options.snapshots?.map((request) => ({
      ...request,
      bookmarks: request.bookmarks ?? bookmarks,
    }));

    const result = persistBookmarksWithVault(storage, nextBookmarks, {
      ...options,
      snapshots: resolvedSnapshots,
    });
    if (!result.ok) {
      return result;
    }

    setBookmarks(nextBookmarks);
    setSnapshots(result.snapshots);
    setUndoState(undo ? { ...undo, bookmarks } : null);
    setCorruptBackup(readCorruptBackup(storage));
    return result;
  };

  const persist = (nextBookmarks: Bookmark[], undo: UndoMeta | null): boolean =>
    persistWithMeta(nextBookmarks, undo).ok;

  const restoreUndo = (): RestoreUndoResult => {
    if (!undoState) return null;
    const storage = getBrowserStorage();
    if (!storage) {
      return { error: storageError('Couldn’t undo last change') };
    }

    const result = persistBookmarksWithVault(storage, undoState.bookmarks);
    if (!result.ok) {
      return { error: storageError('Couldn’t undo last change') };
    }

    const snapshot = undoState;
    setBookmarks(snapshot.bookmarks);
    setSnapshots(result.snapshots);
    setUndoState(null);
    setCorruptBackup(readCorruptBackup(storage));
    return snapshot;
  };

  const createCheckpoint = (
    label: string,
  ): {
    ok: boolean;
    status: 'added' | 'upgraded' | 'skipped-empty' | 'quota-exceeded';
    snapshot?: BookmarkSnapshot;
  } => {
    const storage = getBrowserStorage();
    if (!storage) {
      return { ok: false, status: 'quota-exceeded' };
    }
    const result = saveManualSnapshot(storage, bookmarks, label);
    setSnapshots(result.snapshots);
    return {
      ok: result.ok,
      status: result.status,
      snapshot: result.ok ? result.snapshots[0] : undefined,
    };
  };

  const deleteSnapshot = (snapshotId: string): boolean => {
    const storage = getBrowserStorage();
    if (!storage) return false;
    const result = deleteSnapshotFromVault(storage, snapshotId);
    setSnapshots(result.snapshots);
    return result.ok;
  };

  const dismissCorruptBackup = () => {
    const storage = getBrowserStorage();
    if (!storage) return;
    clearCorruptBackup(storage);
    setCorruptBackup(readCorruptBackup(storage));
  };

  const refreshVaultFromStorage = useCallback(() => {
    const storage = getBrowserStorage();
    if (!storage) return;
    setSnapshots(loadSnapshots(storage));
    setCorruptBackup(readCorruptBackup(storage));
  }, []);

  const applyExternalBookmarksState = useCallback((nextBookmarks: Bookmark[]) => {
    setBookmarks(nextBookmarks);
  }, []);

  const clearUndo = useCallback(() => setUndoState(null), []);

  return {
    bookmarks,
    initialError: initialState.error,
    undoState,
    snapshots,
    corruptBackup,
    persist,
    persistWithMeta,
    restoreUndo,
    clearUndo,
    createCheckpoint,
    deleteSnapshot,
    dismissCorruptBackup,
    refreshVaultFromStorage,
    applyExternalBookmarksState,
  };
}
