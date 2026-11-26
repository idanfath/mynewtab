import {
  detectBookmarkFileFormat,
  parseImportedBookmarkFile,
  type ParsedBookmarkImport,
} from './bookmarkHtml.ts';
import {
  formatBookmarkError,
  jsonErrorLocation,
} from './formatBookmarkError.ts';
import {
  OMNIBAR_STORAGE_KEY,
  isSettingsJsonObject,
  parseSettingsFile,
  serializeOmnibarStorageValue,
  type ParsedSettingsImport,
} from './omnibar.ts';
import type { AppError } from './useBookmarks.ts';

export interface ImportFileInput {
  name: string;
  content: string;
  supportedType?: boolean;
}

export type PreparedImportBatch =
  | {
      ok: true;
      bookmarks?: {
        fileName: string;
        parsed: ParsedBookmarkImport;
      };
      settings?: {
        fileName: string;
        parsed: ParsedSettingsImport;
      };
    }
  | {
      ok: false;
      error: AppError;
    };

function isSettingsFileName(fileName?: string): boolean {
  const lower = fileName?.trim().toLocaleLowerCase() ?? '';
  return (
    lower === 'settings.json'
    || lower.endsWith('-settings.json')
    || lower.endsWith('.settings.json')
  );
}

export function looksLikeBookmarkImportContent(
  content: string,
  fileName?: string,
): boolean {
  const stripped = content.replace(/^\uFEFF/, '').trim();
  const lowerName = fileName?.trim().toLocaleLowerCase() ?? '';

  if (!stripped) {
    return lowerName.endsWith('.html') || lowerName.endsWith('.htm');
  }
  if (stripped.startsWith('[')) {
    return true;
  }
  if (detectBookmarkFileFormat(stripped, fileName) === 'html') {
    return true;
  }
  if (stripped.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(stripped);
      if (
        typeof parsed === 'object'
        && parsed !== null
        && !Array.isArray(parsed)
        && !isSettingsJsonObject(parsed)
      ) {
        const rec = parsed as Record<string, unknown>;
        return (
          (typeof rec.url === 'string'
            && (typeof rec.title === 'string' || typeof rec.section === 'string'))
          || Array.isArray(rec.bookmarks)
        );
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function classifyImportContent(
  content: string,
  fileName?: string,
): 'bookmarks' | 'settings' | 'unknown' {
  const stripped = content.replace(/^\uFEFF/, '').trim();
  const lowerName = fileName?.trim().toLocaleLowerCase() ?? '';

  if (!stripped) {
    if (isSettingsFileName(fileName)) return 'settings';
    if (
      lowerName.endsWith('.json')
      || lowerName.endsWith('.html')
      || lowerName.endsWith('.htm')
    ) {
      return 'bookmarks';
    }
    return 'unknown';
  }

  if (stripped.startsWith('[')) {
    return 'bookmarks';
  }

  if (stripped.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(stripped);
      if (isSettingsJsonObject(parsed)) {
        return 'settings';
      }
      if (isSettingsFileName(fileName)) {
        return 'settings';
      }
      return 'bookmarks';
    } catch {
      if (isSettingsFileName(fileName)) return 'settings';
      if (
        /["']kind["']\s*:\s*["']mynewtab-settings["']/.test(stripped)
        || /["'](?:omnibar|defaultEngine|customBangs|disabledBuiltInBangs|customSearchUrl|customSearchName)["']\s*:/.test(
          stripped,
        )
      ) {
        return 'settings';
      }
      return 'bookmarks';
    }
  }

  const detected = detectBookmarkFileFormat(stripped, fileName);
  if (detected === 'html') return 'bookmarks';
  if (isSettingsFileName(fileName)) return 'settings';
  if (lowerName.endsWith('.json')) return 'bookmarks';
  return 'unknown';
}

export function formatSettingsError(
  error: unknown,
  content: string,
  title = 'Couldn’t import settings',
  fileName?: string,
): AppError {
  const prefix = fileName ? `${fileName}: ` : '';
  if (error instanceof SyntaxError) {
    return {
      title,
      detail: `${prefix}File contains invalid JSON${jsonErrorLocation(error, content)}. Check its syntax and try again.`,
    };
  }

  const message = error instanceof Error ? error.message : '';
  if (message === 'No settings found in JSON file.') {
    return {
      title,
      detail: `${prefix}No settings were found in that JSON file.`,
    };
  }
  if (message === 'Expected a JSON object for omnibar settings.') {
    return {
      title,
      detail: `${prefix}Top level must be a settings JSON object.`,
    };
  }
  if (
    message === 'Unsupported settings file version.'
    || message === 'Unsupported omnibar settings version.'
  ) {
    return {
      title,
      detail: `${prefix}This settings file version is not supported.`,
    };
  }
  if (message === 'Settings file is missing an "omnibar" object.') {
    return {
      title,
      detail: `${prefix}Settings file is missing an “omnibar” object.`,
    };
  }
  if (message) {
    return {
      title,
      detail: `${prefix}${message}`,
    };
  }
  return {
    title,
    detail: `${prefix}Settings data could not be validated. Check the file and try again.`,
  };
}

export function prepareImportBatch(
  files: readonly ImportFileInput[],
): PreparedImportBatch {
  if (files.length === 0) {
    return {
      ok: false,
      error: {
        title: 'Couldn’t import files',
        detail: 'Choose a bookmarks file (.json or .html) or a settings file (.json).',
      },
    };
  }

  if (files.length > 2) {
    return {
      ok: false,
      error: {
        title: 'Too many files',
        detail: 'Choose at most two files at once (one bookmarks file and one settings.json file).',
      },
    };
  }

  const isMulti = files.length > 1;
  for (const file of files) {
    if (file.supportedType === false) {
      return {
        ok: false,
        error: {
          title: 'Unsupported file type',
          detail: isMulti
            ? `${file.name}: choose a .json or .html file.`
            : 'Choose a .json bookmark/settings file or a browser-exported .html bookmark file.',
        },
      };
    }
  }

  let bookmarkFile: ImportFileInput | null = null;
  let settingsFile: ImportFileInput | null = null;

  for (const file of files) {
    const kind = classifyImportContent(file.content, file.name);
    if (kind === 'unknown') {
      return {
        ok: false,
        error: {
          title: 'Couldn’t import file',
          detail: isMulti
            ? `${file.name}: unrecognized format. Choose a .json bookmark/settings file or a .html bookmark file.`
            : 'Choose a .json bookmark/settings file or a browser-exported .html bookmark file.',
        },
      };
    }
    if (kind === 'bookmarks') {
      if (bookmarkFile) {
        return {
          ok: false,
          error: {
            title: 'Couldn’t import files',
            detail: 'Choose only one bookmarks file at a time (optionally paired with settings.json).',
          },
        };
      }
      bookmarkFile = file;
    } else {
      if (settingsFile) {
        return {
          ok: false,
          error: {
            title: 'Couldn’t import files',
            detail: 'Choose only one settings file at a time (optionally paired with bookmarks).',
          },
        };
      }
      settingsFile = file;
    }
  }

  let parsedBookmarks: { fileName: string; parsed: ParsedBookmarkImport } | undefined;
  let parsedSettings: { fileName: string; parsed: ParsedSettingsImport } | undefined;

  if (bookmarkFile) {
    try {
      const parsed = parseImportedBookmarkFile(bookmarkFile.content, bookmarkFile.name);
      parsedBookmarks = { fileName: bookmarkFile.name, parsed };
    } catch (parseError) {
      const formatted = formatBookmarkError(
        parseError,
        bookmarkFile.content,
        'Couldn’t import bookmarks',
      );
      return {
        ok: false,
        error: isMulti
          ? { title: formatted.title, detail: `${bookmarkFile.name}: ${formatted.detail}` }
          : formatted,
      };
    }
  }

  if (settingsFile) {
    try {
      const parsed = parseSettingsFile(settingsFile.content);
      parsedSettings = { fileName: settingsFile.name, parsed };
    } catch (parseError) {
      return {
        ok: false,
        error: formatSettingsError(
          parseError,
          settingsFile.content,
          'Couldn’t import settings',
          isMulti ? settingsFile.name : undefined,
        ),
      };
    }
  }

  return {
    ok: true,
    ...(parsedBookmarks ? { bookmarks: parsedBookmarks } : {}),
    ...(parsedSettings ? { settings: parsedSettings } : {}),
  };
}

export function commitPairedBookmarksAndSettingsToStorage(params: {
  storage: (Pick<Storage, 'getItem' | 'setItem'> & { removeItem?: (key: string) => void }) | null;
  nextSettings: ParsedSettingsImport;
  persistBookmarks: () => { ok: boolean; snapshotWarning?: 'snapshot-quota-exceeded' };
}): { ok: true; snapshotWarning?: 'snapshot-quota-exceeded' } | { ok: false } {
  const { storage, nextSettings, persistBookmarks } = params;
  if (!storage) return { ok: false };

  let previousRawSettings: string | null = null;
  try {
    previousRawSettings = storage.getItem(OMNIBAR_STORAGE_KEY);
  } catch {
    previousRawSettings = null;
  }

  const serializedSettings = serializeOmnibarStorageValue(
    nextSettings.settings,
    nextSettings.extraSections,
  );

  try {
    storage.setItem(OMNIBAR_STORAGE_KEY, serializedSettings);
  } catch {
    return { ok: false };
  }

  const rollbackSettings = () => {
    try {
      if (previousRawSettings !== null) {
        storage.setItem(OMNIBAR_STORAGE_KEY, previousRawSettings);
      } else {
        storage.removeItem?.(OMNIBAR_STORAGE_KEY);
      }
    } catch {
      // best-effort rollback
    }
  };

  let bookmarkResult: { ok: boolean; snapshotWarning?: 'snapshot-quota-exceeded' };
  try {
    bookmarkResult = persistBookmarks();
  } catch {
    rollbackSettings();
    return { ok: false };
  }
  if (!bookmarkResult.ok) {
    rollbackSettings();
    return { ok: false };
  }

  return {
    ok: true,
    ...(bookmarkResult.snapshotWarning
      ? { snapshotWarning: bookmarkResult.snapshotWarning }
      : {}),
  };
}
