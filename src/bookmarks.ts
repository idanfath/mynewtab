import Fuse from 'fuse.js';
import { normalizeAlias, normalizeSearchUrl, normalizeUrl, urlIdentity } from './lib.ts';

export interface BookmarkShortcut {
    alias: string;
    queryUrl?: string;
}

export interface Bookmark {
    title: string;
    url: string;
    section: string;
    shortcuts?: BookmarkShortcut[];
    alias?: string;
    searchUrl?: string;
    subsection?: string;
    description?: string;
    iconUrl?: string;
    categories?: string[];
    capabilities?: string[];
    pros?: string[];
    cons?: string[];
    formats?: string[];
    tier?: string;
    product?: string;
}

export function getBookmarkShortcuts(bookmark: Bookmark): BookmarkShortcut[] {
    const result: BookmarkShortcut[] = [];
    const seenAliases = new Set<string>();

    if (Array.isArray(bookmark.shortcuts)) {
        for (const entry of bookmark.shortcuts) {
            if (!entry || typeof entry !== 'object') continue;
            const rawAlias = typeof entry.alias === 'string' ? entry.alias : '';
            const alias = normalizeAlias(rawAlias);
            if (!alias || seenAliases.has(alias)) continue;

            const rawQuery = entry.queryUrl !== undefined
                ? entry.queryUrl
                : (entry as unknown as Record<string, unknown>).searchUrl;
            const queryUrl = typeof rawQuery === 'string' ? normalizeSearchUrl(rawQuery) : '';
            seenAliases.add(alias);
            result.push(queryUrl ? { alias, queryUrl } : { alias });
        }
    }

    const legacyAlias = normalizeAlias(typeof bookmark.alias === 'string' ? bookmark.alias : '');
    if (legacyAlias && !seenAliases.has(legacyAlias)) {
        const legacyQuery = typeof bookmark.searchUrl === 'string'
            ? normalizeSearchUrl(bookmark.searchUrl)
            : '';
        seenAliases.add(legacyAlias);
        result.push(legacyQuery ? { alias: legacyAlias, queryUrl: legacyQuery } : { alias: legacyAlias });
    }

    return result;
}

export function formatBookmarkShortcutBadges(bookmark: Bookmark): {
    visible: string[];
    overflowCount: number;
} {
    const shortcuts = getBookmarkShortcuts(bookmark);
    if (shortcuts.length === 0) {
        return { visible: [], overflowCount: 0 };
    }
    if (shortcuts.length <= 2) {
        return {
            visible: shortcuts.map((shortcut) => shortcut.alias),
            overflowCount: 0,
        };
    }
    return {
        visible: [shortcuts[0].alias, shortcuts[1].alias],
        overflowCount: shortcuts.length - 2,
    };
}

export function findBookmarkShortcut(
    bookmarks: readonly Bookmark[],
    trigger: string,
    requireQueryUrl = false,
): { bookmark: Bookmark; shortcut: BookmarkShortcut } | undefined {
    const normalized = normalizeAlias(trigger);
    if (!normalized) return undefined;

    for (const bookmark of bookmarks) {
        for (const shortcut of getBookmarkShortcuts(bookmark)) {
            if (
                shortcut.alias === normalized
                && (!requireQueryUrl || Boolean(shortcut.queryUrl))
            ) {
                return { bookmark, shortcut };
            }
        }
    }
    return undefined;
}

const optionalStrings = [
    'subsection',
    'description',
    'iconUrl',
    'tier',
    'product',
] as const;

const optionalStringArrays = [
    'categories',
    'capabilities',
    'pros',
    'cons',
    'formats',
] as const;

const searchKeys = [
    {
        name: 'alias',
        weight: 3,
        getFn: (bookmark: Bookmark) => getBookmarkShortcuts(bookmark).map((s) => s.alias),
    },
    { name: 'title', weight: 2 },
    { name: 'section', weight: 1.5 },
    { name: 'categories', weight: 1.5 },
    { name: 'capabilities', weight: 1.5 },
    { name: 'subsection', weight: 1.2 },
    { name: 'description', weight: 1 },
    { name: 'product', weight: 1 },
    { name: 'formats', weight: 0.9 },
    { name: 'pros', weight: 0.8 },
    { name: 'cons', weight: 0.8 },
    { name: 'tier', weight: 0.7 },
    { name: 'url', weight: 0.6 },
];

export const STORAGE_KEY = 'newtab-directory-bookmarks';
export const BACKUP_KEY = `${STORAGE_KEY}-corrupt-backup`;

export type StoredDataFailure = 'truncated' | 'invalid';

export function classifyStoredDataFailure(error: unknown): StoredDataFailure {
  // JSON.parse throws SyntaxError on truncated/malformed JSON; anything
  // else is a well-formed value that fails schema validation.
  return error instanceof SyntaxError ? 'truncated' : 'invalid';
}

export function loadStoredBookmarks(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): {
    bookmarks: Bookmark[];
    recovery?: 'backed-up' | 'backup-failed';
    failure?: StoredDataFailure;
  } {
  const stored = storage.getItem(STORAGE_KEY);
  if (!stored) return { bookmarks: [] };

  try {
    return { bookmarks: parseBookmarks(stored) };
  } catch (parseError) {
    const failure = classifyStoredDataFailure(parseError);
    // Copy instead of move: the original stays readable until a save replaces it.
    try {
      storage.setItem(BACKUP_KEY, stored);
      return { bookmarks: [], recovery: 'backed-up', failure };
    } catch {
      return { bookmarks: [], recovery: 'backup-failed', failure };
    }
  }
}

export function parseBookmarks(content: string): Bookmark[] {
    if (!content.trim()) return [];

    const value: unknown = JSON.parse(content);
    if (!Array.isArray(value)) throw new Error('Expected a JSON array of bookmarks.');

    const seenAliases = new Map<string, { index: number; title: string; shortcutNum?: number }>();

    return value.map((item: unknown, index) => {
        const bookmarkNum = index + 1;
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`Bookmark ${bookmarkNum} must be an object.`);
        }

        const record = item as Record<string, unknown>;
        for (const field of ['title', 'url', 'section'] as const) {
            if (typeof record[field] !== 'string' || !record[field].trim()) {
                throw new Error(`Bookmark ${bookmarkNum}.${field} must be a non-empty string.`);
            }
        }
        if (!normalizeUrl(record.url as string)) {
            throw new Error(`Bookmark ${bookmarkNum}.url must be a valid HTTP(S) URL.`);
        }

        for (const field of optionalStrings) {
            if (record[field] !== undefined && typeof record[field] !== 'string') {
                throw new Error(`Bookmark ${bookmarkNum}.${field} must be a string.`);
            }
        }
        for (const field of optionalStringArrays) {
            if (
                record[field] !== undefined &&
                (!Array.isArray(record[field]) ||
                    record[field].some((entry) => typeof entry !== 'string'))
            ) {
                throw new Error(`Bookmark ${bookmarkNum}.${field} must be a string array.`);
            }
        }
        if (record.iconUrl && !normalizeUrl(record.iconUrl as string)) {
            throw new Error(`Bookmark ${bookmarkNum}.iconUrl must be a valid HTTP(S) URL.`);
        }

        const bookmarkTitle = (record.title as string).trim();
        const intraSeen = new Set<string>();
        const finalShortcuts: BookmarkShortcut[] = [];
        let hasShortcutFields = false;

        if (record.shortcuts !== undefined) {
            hasShortcutFields = true;
            if (!Array.isArray(record.shortcuts)) {
                throw new Error(`Bookmark ${bookmarkNum}.shortcuts must be an array.`);
            }

            record.shortcuts.forEach((shortcutItem: unknown, sIdx: number) => {
                const shortcutNum = sIdx + 1;
                if (
                    typeof shortcutItem !== 'object'
                    || shortcutItem === null
                    || Array.isArray(shortcutItem)
                ) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}] must be an object.`,
                    );
                }

                const entry = shortcutItem as Record<string, unknown>;
                const rawAlias = typeof entry.alias === 'string' ? entry.alias.trim() : '';
                const normAlias = rawAlias ? normalizeAlias(rawAlias) : '';
                if (!normAlias) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}].alias must be 1-32 lowercase letters, numbers, or hyphens.`,
                    );
                }
                if (intraSeen.has(normAlias)) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}].alias duplicates "${normAlias}" in Bookmark ${bookmarkNum}.`,
                    );
                }
                const existing = seenAliases.get(normAlias);
                if (existing) {
                    if (existing.shortcutNum !== undefined) {
                        throw new Error(
                            `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}].alias duplicates "${normAlias}" from Bookmark ${existing.index} shortcut ${existing.shortcutNum} (${existing.title}).`,
                        );
                    }
                    throw new Error(
                        `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}].alias duplicates "${normAlias}" from Bookmark ${existing.index} (${existing.title}).`,
                    );
                }

                const urlKeyName = entry.queryUrl !== undefined ? 'queryUrl' : 'searchUrl';
                const rawQuery = entry.queryUrl !== undefined ? entry.queryUrl : entry.searchUrl;
                let normQuery: string | undefined;
                if (rawQuery !== undefined) {
                    if (typeof rawQuery !== 'string') {
                        throw new Error(
                            `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}].${urlKeyName} must be a string.`,
                        );
                    }
                    const trimmedQuery = rawQuery.trim();
                    if (trimmedQuery !== '') {
                        const normalizedQuery = normalizeSearchUrl(trimmedQuery);
                        if (!normalizedQuery) {
                            throw new Error(
                                `Bookmark ${bookmarkNum}.shortcuts[${shortcutNum}].${urlKeyName} must be a valid HTTP(S) query URL containing %s.`,
                            );
                        }
                        normQuery = normalizedQuery;
                    }
                }

                intraSeen.add(normAlias);
                seenAliases.set(normAlias, {
                    index: bookmarkNum,
                    title: bookmarkTitle,
                    shortcutNum,
                });
                finalShortcuts.push(
                    normQuery ? { alias: normAlias, queryUrl: normQuery } : { alias: normAlias },
                );
            });
        }

        let resolvedLegacyAlias: string | undefined;
        if (record.alias !== undefined) {
            hasShortcutFields = true;
            if (typeof record.alias !== 'string') {
                throw new Error(`Bookmark ${bookmarkNum}.alias must be a string.`);
            }
            const trimmedAlias = record.alias.trim();
            if (trimmedAlias !== '') {
                const normalizedAlias = normalizeAlias(trimmedAlias);
                if (!normalizedAlias) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.alias must be 1-32 lowercase letters, numbers, or hyphens.`,
                    );
                }
                if (intraSeen.has(normalizedAlias)) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.alias duplicates "${normalizedAlias}" in Bookmark ${bookmarkNum}.`,
                    );
                }
                const existing = seenAliases.get(normalizedAlias);
                if (existing) {
                    if (existing.shortcutNum !== undefined) {
                        throw new Error(
                            `Bookmark ${bookmarkNum}.alias duplicates "${normalizedAlias}" from Bookmark ${existing.index} shortcut ${existing.shortcutNum} (${existing.title}).`,
                        );
                    }
                    throw new Error(
                        `Bookmark ${bookmarkNum}.alias duplicates "${normalizedAlias}" from Bookmark ${existing.index} (${existing.title}).`,
                    );
                }
                intraSeen.add(normalizedAlias);
                seenAliases.set(normalizedAlias, {
                    index: bookmarkNum,
                    title: bookmarkTitle,
                });
                resolvedLegacyAlias = normalizedAlias;
            }
        }

        let resolvedLegacySearchUrl: string | undefined;
        if (record.searchUrl !== undefined) {
            hasShortcutFields = true;
            if (typeof record.searchUrl !== 'string') {
                throw new Error(`Bookmark ${bookmarkNum}.searchUrl must be a string.`);
            }
            const trimmedSearchUrl = record.searchUrl.trim();
            if (trimmedSearchUrl !== '') {
                const normalizedSearchUrl = normalizeSearchUrl(trimmedSearchUrl);
                if (!normalizedSearchUrl) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.searchUrl must be a valid HTTP(S) search URL containing %s.`,
                    );
                }
                resolvedLegacySearchUrl = normalizedSearchUrl;
            }
        }

        if (resolvedLegacyAlias !== undefined) {
            finalShortcuts.push(
                resolvedLegacySearchUrl !== undefined
                    ? { alias: resolvedLegacyAlias, queryUrl: resolvedLegacySearchUrl }
                    : { alias: resolvedLegacyAlias },
            );
        }

        if (!hasShortcutFields) {
            return record as unknown as Bookmark;
        }

        const copy = { ...(record as unknown as Bookmark) };
        if (finalShortcuts.length > 0) {
            copy.shortcuts = finalShortcuts;
            delete copy.alias;
            delete copy.searchUrl;
        } else {
            delete copy.shortcuts;
            delete copy.alias;
            if (record.shortcuts === undefined && resolvedLegacySearchUrl !== undefined) {
                copy.searchUrl = resolvedLegacySearchUrl;
            } else {
                delete copy.searchUrl;
            }
        }
        return copy;
    });
}

export function searchBookmarks(bookmarks: Bookmark[], query: string): Bookmark[] {
    const trimmed = query.trim();
    if (!trimmed) return bookmarks;

    const normalizedWholeAlias = /^!?[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/i.test(trimmed)
        ? normalizeAlias(trimmed)
        : '';
    const rawAliasPrefix = trimmed.startsWith('!')
        ? trimmed.slice(1).toLowerCase()
        : trimmed.toLowerCase();
    const aliasPrefix = /^[a-z0-9][a-z0-9-]{1,31}$/.test(rawAliasPrefix)
        ? rawAliasPrefix
        : '';

    const tokens = [...new Set(
        trimmed.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
    )];
    if (!tokens.length && !normalizedWholeAlias && !aliasPrefix) {
        return [];
    }

    const scores = new Map<Bookmark, number>();
    if (tokens.length > 0) {
        const fuse = new Fuse(bookmarks, {
            keys: searchKeys,
            threshold: 0.35,
            ignoreLocation: true,
            includeScore: true,
        });
        const tokenResults = tokens.map((token) => new Map(
            fuse.search(token).map((result) => [result.item, result.score ?? 1]),
        ));
        bookmarks.forEach((bookmark) => {
            let total = 0;
            for (const results of tokenResults) {
                const score = results.get(bookmark);
                if (score === undefined) return;
                total += score;
            }
            scores.set(bookmark, total);
        });
    }

    if (normalizedWholeAlias || aliasPrefix) {
        bookmarks.forEach((bookmark) => {
            const shortcuts = getBookmarkShortcuts(bookmark);
            if (shortcuts.length === 0) return;
            if (
                normalizedWholeAlias
                && shortcuts.some((shortcut) => shortcut.alias === normalizedWholeAlias)
            ) {
                scores.set(bookmark, -2);
            } else if (
                aliasPrefix
                && shortcuts.some((shortcut) => shortcut.alias.startsWith(aliasPrefix))
            ) {
                scores.set(bookmark, Math.min(scores.get(bookmark) ?? 0, -1));
            }
        });
    }

    return [...scores]
        .sort(([, left], [, right]) => left - right)
        .map(([bookmark]) => bookmark);
}

export function groupBookmarksBySection(bookmarks: readonly Bookmark[]): Bookmark[] {
    const groups = new Map<string, Bookmark[]>();
    for (const bookmark of bookmarks) {
        let group = groups.get(bookmark.section);
        if (!group) {
            group = [];
            groups.set(bookmark.section, group);
        }
        group.push(bookmark);
    }
    return [...groups.values()].flat();
}

export function insertBookmarkInSection(
    bookmarks: readonly Bookmark[],
    bookmark: Bookmark,
): Bookmark[] {
    const grouped = groupBookmarksBySection(bookmarks);
    let lastIndex = -1;
    for (let index = grouped.length - 1; index >= 0; index -= 1) {
        if (grouped[index].section === bookmark.section) {
            lastIndex = index;
            break;
        }
    }
    if (lastIndex < 0) return [...grouped, bookmark];

    const next = [...grouped];
    next.splice(lastIndex + 1, 0, bookmark);
    return next;
}

export function findMatchingBookmarkIndex(
    bookmarks: readonly Bookmark[],
    target: Bookmark,
): number {
    const exactRefIndex = bookmarks.indexOf(target);
    if (exactRefIndex >= 0) return exactRefIndex;

    const targetIdentity = urlIdentity(target.url);
    if (!targetIdentity) return -1;

    const targetSection = target.section.trim();
    const targetSectionLower = targetSection.toLocaleLowerCase();
    const targetTitle = target.title.trim();
    const targetSubsection = (target.subsection ?? '').trim();
    const targetShortcuts = getBookmarkShortcuts(target).map((s) => s.alias).join(',');

    let fullMatchIdx = -1;
    let exactSectionTitleIdx = -1;
    let lowerSectionTitleIdx = -1;
    let sameSectionIdx = -1;
    let sameTitleIdx = -1;
    let anyIdentityIdx = -1;

    for (let index = 0; index < bookmarks.length; index += 1) {
        const item = bookmarks[index];
        if (urlIdentity(item.url) !== targetIdentity) continue;

        if (anyIdentityIdx < 0) anyIdentityIdx = index;

        const itemSection = item.section.trim();
        const itemSectionLower = itemSection.toLocaleLowerCase();
        const itemTitle = item.title.trim();
        const sameExactSection = itemSection === targetSection;
        const sameLowerSection = itemSectionLower === targetSectionLower;
        const sameExactTitle = itemTitle === targetTitle;

        if (sameExactSection && sameExactTitle) {
            if (exactSectionTitleIdx < 0) exactSectionTitleIdx = index;
            if (
                fullMatchIdx < 0
                && (item.subsection ?? '').trim() === targetSubsection
                && getBookmarkShortcuts(item).map((s) => s.alias).join(',') === targetShortcuts
            ) {
                fullMatchIdx = index;
            }
        }
        if (lowerSectionTitleIdx < 0 && sameLowerSection && sameExactTitle) {
            lowerSectionTitleIdx = index;
        }
        if (sameSectionIdx < 0 && sameLowerSection) {
            sameSectionIdx = index;
        }
        if (sameTitleIdx < 0 && sameExactTitle) {
            sameTitleIdx = index;
        }
    }

    if (fullMatchIdx >= 0) return fullMatchIdx;
    if (exactSectionTitleIdx >= 0) return exactSectionTitleIdx;
    if (lowerSectionTitleIdx >= 0) return lowerSectionTitleIdx;
    if (sameSectionIdx >= 0) return sameSectionIdx;
    if (sameTitleIdx >= 0) return sameTitleIdx;
    return anyIdentityIdx;
}

export function findMatchingBookmark(
    bookmarks: readonly Bookmark[],
    target: Bookmark,
): Bookmark | null {
    const index = findMatchingBookmarkIndex(bookmarks, target);
    return index >= 0 ? bookmarks[index] : null;
}

export type SaveBookmarkResult =
    | { ok: true; bookmarks: Bookmark[]; bookmark: Bookmark }
    | { ok: false; error: string };

export function applyBookmarkSave(
    bookmarks: readonly Bookmark[],
    nextBookmark: Bookmark,
    editingBookmark: Bookmark | null,
): SaveBookmarkResult {
    const bookmarkIdentity = urlIdentity(nextBookmark.url);
    if (!bookmarkIdentity) {
        return { ok: false, error: 'Enter a valid http:// or https:// address.' };
    }

    const editingIndex = editingBookmark
        ? findMatchingBookmarkIndex(bookmarks, editingBookmark)
        : -1;
    const resolvedEditing = editingIndex >= 0 ? bookmarks[editingIndex] : null;
    const editingIdentity = resolvedEditing ? urlIdentity(resolvedEditing.url) : '';

    if (!resolvedEditing || bookmarkIdentity !== editingIdentity) {
        const duplicate = bookmarks.find(
            (bookmark, index) =>
                index !== editingIndex
                && urlIdentity(bookmark.url) === bookmarkIdentity,
        );
        if (duplicate) {
            return {
                ok: false,
                error: `“${duplicate.title}” already uses this URL.`,
            };
        }
    }

    const validatedShortcuts: BookmarkShortcut[] = [];
    const intraSeen = new Set<string>();

    if (nextBookmark.shortcuts !== undefined) {
        if (!Array.isArray(nextBookmark.shortcuts)) {
            return { ok: false, error: 'Shortcuts must be a list.' };
        }
        for (const entry of nextBookmark.shortcuts) {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
                return { ok: false, error: 'Each shortcut must be a valid entry.' };
            }
            const rawEntry = entry as unknown as Record<string, unknown>;
            if (rawEntry.alias !== undefined && typeof rawEntry.alias !== 'string') {
                return {
                    ok: false,
                    error: 'Shortcut must be 1–32 letters, numbers, or hyphens (e.g. gh or my-docs).',
                };
            }
            const rawQueryVal = rawEntry.queryUrl !== undefined
                ? rawEntry.queryUrl
                : rawEntry.searchUrl;
            if (rawQueryVal !== undefined && typeof rawQueryVal !== 'string') {
                return {
                    ok: false,
                    error: 'Query URL must be a valid http:// or https:// address containing %s.',
                };
            }
            const rawAlias = typeof rawEntry.alias === 'string' ? rawEntry.alias.trim() : '';
            const rawQuery = typeof rawQueryVal === 'string' ? rawQueryVal.trim() : '';
            if (!rawAlias && !rawQuery) continue;
            if (!rawAlias && rawQuery) {
                return { ok: false, error: 'Add a shortcut (!bang) to use a query URL.' };
            }
            const normAlias = normalizeAlias(rawAlias);
            if (!normAlias) {
                return {
                    ok: false,
                    error: 'Shortcut must be 1–32 letters, numbers, or hyphens (e.g. gh or my-docs).',
                };
            }
            if (intraSeen.has(normAlias)) {
                return {
                    ok: false,
                    error: `Duplicate shortcut “!${normAlias}” on this bookmark.`,
                };
            }
            let normQuery = '';
            if (rawQuery) {
                normQuery = normalizeSearchUrl(rawQuery);
                if (!normQuery) {
                    return {
                        ok: false,
                        error: 'Query URL must be a valid http:// or https:// address containing %s.',
                    };
                }
            }
            intraSeen.add(normAlias);
            validatedShortcuts.push(
                normQuery ? { alias: normAlias, queryUrl: normQuery } : { alias: normAlias },
            );
        }
    }

    if (nextBookmark.alias !== undefined && typeof nextBookmark.alias !== 'string') {
        return {
            ok: false,
            error: 'Shortcut must be 1–32 letters, numbers, or hyphens (e.g. gh or my-docs).',
        };
    }
    if (nextBookmark.searchUrl !== undefined && typeof nextBookmark.searchUrl !== 'string') {
        return {
            ok: false,
            error: 'Query URL must be a valid http:// or https:// address containing %s.',
        };
    }
    const rawLegacyAlias = typeof nextBookmark.alias === 'string' ? nextBookmark.alias.trim() : '';
    const rawLegacySearch = typeof nextBookmark.searchUrl === 'string'
        ? nextBookmark.searchUrl.trim()
        : '';
    if (rawLegacyAlias || rawLegacySearch) {
        if (!rawLegacyAlias && rawLegacySearch) {
            return { ok: false, error: 'Add a shortcut (!bang) to use a query URL.' };
        }
        const normLegacyAlias = normalizeAlias(rawLegacyAlias);
        if (!normLegacyAlias) {
            return {
                ok: false,
                error: 'Shortcut must be 1–32 letters, numbers, or hyphens (e.g. gh or my-docs).',
            };
        }
        if (intraSeen.has(normLegacyAlias)) {
            return {
                ok: false,
                error: `Duplicate shortcut “!${normLegacyAlias}” on this bookmark.`,
            };
        }
        let normLegacyQuery = '';
        if (rawLegacySearch) {
            normLegacyQuery = normalizeSearchUrl(rawLegacySearch);
            if (!normLegacyQuery) {
                return {
                    ok: false,
                    error: 'Query URL must be a valid http:// or https:// address containing %s.',
                };
            }
        }
        intraSeen.add(normLegacyAlias);
        validatedShortcuts.push(
            normLegacyQuery
                ? { alias: normLegacyAlias, queryUrl: normLegacyQuery }
                : { alias: normLegacyAlias },
        );
    }

    for (const sc of validatedShortcuts) {
        const duplicateOwner = bookmarks.find(
            (other, idx) =>
                idx !== editingIndex
                && getBookmarkShortcuts(other).some((otherSc) => otherSc.alias === sc.alias),
        );
        if (duplicateOwner) {
            return {
                ok: false,
                error: `“${duplicateOwner.title}” already uses shortcut !${sc.alias}.`,
            };
        }
    }

    const savedBookmark: Bookmark = { ...nextBookmark };
    delete savedBookmark.alias;
    delete savedBookmark.searchUrl;
    if (validatedShortcuts.length > 0) {
        savedBookmark.shortcuts = validatedShortcuts;
    } else {
        delete savedBookmark.shortcuts;
    }

    let nextBookmarks: Bookmark[];
    if (resolvedEditing) {
        if (savedBookmark.section === resolvedEditing.section) {
            nextBookmarks = bookmarks.map((bookmark, index) =>
                index === editingIndex ? savedBookmark : bookmark,
            );
        } else {
            const remaining = bookmarks.filter(
                (_bookmark, index) => index !== editingIndex,
            );
            nextBookmarks = insertBookmarkInSection(remaining, savedBookmark);
        }
    } else {
        nextBookmarks = insertBookmarkInSection(bookmarks, savedBookmark);
    }

    return { ok: true, bookmarks: nextBookmarks, bookmark: savedBookmark };
}

export function moveBookmarkToSection(
    bookmarks: Bookmark[],
    source: Bookmark,
    targetSection: string,
): Bookmark[] {
    if (!targetSection.trim() || targetSection === 'All') return bookmarks;

    const grouped = groupBookmarksBySection(bookmarks);
    const sourceIndex = grouped.indexOf(source);
    if (sourceIndex < 0 || source.section === targetSection) return bookmarks;

    const remaining = [...grouped];
    remaining.splice(sourceIndex, 1);
    return insertBookmarkInSection(remaining, { ...source, section: targetSection });
}

export function reorderBookmark(
    bookmarks: Bookmark[],
    source: Bookmark,
    target: Bookmark,
    position: 'before' | 'after',
): Bookmark[] {
    if (source === target) return bookmarks;

    const grouped = groupBookmarksBySection(bookmarks);
    const sourceIdx = grouped.indexOf(source);
    const targetIdx = grouped.indexOf(target);
    if (sourceIdx < 0 || targetIdx < 0) return bookmarks;

    const adjustedTarget = sourceIdx < targetIdx ? targetIdx - 1 : targetIdx;
    const insertIdx = adjustedTarget + (position === 'after' ? 1 : 0);
    if (source.section === target.section && insertIdx === sourceIdx) {
        return bookmarks;
    }

    const next = [...grouped];
    next.splice(sourceIdx, 1);
    const moved = source.section === target.section
        ? source
        : { ...source, section: target.section };
    next.splice(insertIdx, 0, moved);
    return next;
}

export function reorderBookmarkSections(
    bookmarks: Bookmark[],
    source: string,
    target: string,
    position: 'before' | 'after',
): Bookmark[] {
    if (source === target) return bookmarks;

    const order = [...new Set(bookmarks.map((bookmark) => bookmark.section))];
    const sourceIndex = order.indexOf(source);
    if (sourceIndex < 0) return bookmarks;

    order.splice(sourceIndex, 1);
    const targetIndex = order.indexOf(target);
    if (targetIndex < 0) return bookmarks;
    order.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source);

    return order.flatMap((section) =>
        bookmarks.filter((bookmark) => bookmark.section === section),
    );
}
