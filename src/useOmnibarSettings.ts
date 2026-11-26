import { useCallback, useState } from 'react';
import {
  DEFAULT_OMNIBAR_SETTINGS,
  OMNIBAR_BACKUP_KEY,
  OMNIBAR_STORAGE_KEY,
  loadStoredOmnibarSettings,
  type OmnibarSettings,
} from './omnibar.ts';
import type { AppError } from './useBookmarks.ts';

export type InitialOmnibarState = {
  settings: OmnibarSettings;
  error: AppError | null;
};

export function buildInitialOmnibarState(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): InitialOmnibarState {
  try {
    const { settings, recovery, failure } = loadStoredOmnibarSettings(storage);
    if (!recovery) return { settings, error: null };

    const cause = failure === 'invalid'
      ? 'The saved search settings are complete JSON but contain invalid entries.'
      : 'The saved search settings look truncated or are not valid JSON.';
    return {
      settings,
      error: {
        title: 'Couldn’t read search settings',
        detail: recovery === 'backed-up'
          ? `${cause} A copy is kept in localStorage under ${OMNIBAR_BACKUP_KEY}, so new changes won’t lose it.`
          : `${cause} No backup could be made and the next save will overwrite them. Copy localStorage key ${OMNIBAR_STORAGE_KEY} first.`,
      },
    };
  } catch {
    return {
      settings: { ...DEFAULT_OMNIBAR_SETTINGS, customBangs: [] },
      error: null,
    };
  }
}

export function loadInitialOmnibarState(): InitialOmnibarState {
  try {
    return buildInitialOmnibarState(localStorage);
  } catch {
    return {
      settings: { ...DEFAULT_OMNIBAR_SETTINGS, customBangs: [] },
      error: null,
    };
  }
}

export function mergeStartupErrors(
  bookmarkError: AppError | null,
  omnibarError: AppError | null,
): AppError | null {
  if (bookmarkError && omnibarError) {
    return {
      title: 'Couldn’t read saved data',
      detail: `${bookmarkError.title}: ${bookmarkError.detail} ${omnibarError.title}: ${omnibarError.detail}`,
    };
  }
  return bookmarkError ?? omnibarError;
}

export function useOmnibarSettings() {
  const [initialState] = useState(loadInitialOmnibarState);
  const [omnibarSettings, setOmnibarSettings] = useState<OmnibarSettings>(
    initialState.settings,
  );

  const persistOmnibarSettings = (next: OmnibarSettings): boolean => {
    try {
      localStorage.setItem(OMNIBAR_STORAGE_KEY, JSON.stringify(next));
    } catch {
      return false;
    }
    setOmnibarSettings(next);
    return true;
  };

  const refreshOmnibarFromStorage = useCallback(() => {
    try {
      const { settings, recovery } = loadStoredOmnibarSettings(localStorage);
      if (!recovery) {
        setOmnibarSettings(settings);
      }
    } catch {
      // ignore blocked storage
    }
  }, []);

  return {
    omnibarSettings,
    initialOmnibarError: initialState.error,
    persistOmnibarSettings,
    refreshOmnibarFromStorage,
  };
}
