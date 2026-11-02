import { useEffect, useState } from 'react';
import {
  BACKUP_KEY,
  STORAGE_KEY,
  loadStoredBookmarks,
  type Bookmark,
} from './bookmarks';

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

function loadInitialState(): { bookmarks: Bookmark[]; error: AppError | null } {
  try {
    const { bookmarks, recovery } = loadStoredBookmarks(localStorage);
    if (!recovery) return { bookmarks, error: null };

    return {
      bookmarks,
      error: {
        title: 'Couldn’t read saved bookmarks',
        detail: recovery === 'backed-up'
          ? `A copy is kept in localStorage under ${BACKUP_KEY}, so new changes won’t lose it.`
          : `No backup could be made and the next save will overwrite them. Copy localStorage key ${STORAGE_KEY} first.`,
      },
    };
  } catch {
    return { bookmarks: [], error: null };
  }
}

export function useBookmarks() {
  // Lazy initializer: runs once per mount instead of at module import,
  // so tests/SSR importing this module pay no localStorage cost.
  const [initialState] = useState(loadInitialState);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialState.bookmarks);
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  useEffect(() => {
    if (!undoState) return;
    const timeoutId = window.setTimeout(() => setUndoState(null), 6500);
    return () => window.clearTimeout(timeoutId);
  }, [undoState]);

  const persist = (nextBookmarks: Bookmark[], undo: UndoMeta | null): boolean => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookmarks));
    } catch {
      return false;
    }
    setBookmarks(nextBookmarks);
    // Snapshot the previous bookmarks so undo restores what was just replaced.
    setUndoState(undo ? { ...undo, bookmarks } : null);
    return true;
  };

  const restoreUndo = (): RestoreUndoResult => {
    if (!undoState) return null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(undoState.bookmarks));
    } catch {
      return { error: storageError('Couldn’t undo last change') };
    }
    const snapshot = undoState;
    setBookmarks(snapshot.bookmarks);
    setUndoState(null);
    return snapshot;
  };

  const clearUndo = () => setUndoState(null);

  return {
    bookmarks,
    initialError: initialState.error,
    undoState,
    persist,
    restoreUndo,
    clearUndo,
  };
}
