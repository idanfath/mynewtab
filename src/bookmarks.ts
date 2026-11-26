import Fuse from 'fuse.js';
import { normalizeAlias, normalizeSearchUrl, normalizeUrl, urlIdentity } from './lib.ts';

export interface Bookmark {
    title: string;
    url: string;
    section: string;
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
    { name: 'alias', weight: 3 },
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

    const seenAliases = new Map<string, { index: number; title: string }>();

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

        let needsClone = false;
        let resolvedAlias: string | undefined;
        let hasAliasKey = false;

        if (record.alias !== undefined) {
            hasAliasKey = true;
            if (typeof record.alias !== 'string') {
                throw new Error(`Bookmark ${bookmarkNum}.alias must be a string.`);
            }
            const trimmedAlias = record.alias.trim();
            if (trimmedAlias === '') {
                needsClone = true;
                resolvedAlias = undefined;
            } else {
                const normalizedAlias = normalizeAlias(trimmedAlias);
                if (!normalizedAlias) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.alias must be 1-32 lowercase letters, numbers, or hyphens.`,
                    );
                }
                const existing = seenAliases.get(normalizedAlias);
                if (existing) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.alias duplicates "${normalizedAlias}" from Bookmark ${existing.index} (${existing.title}).`,
                    );
                }
                seenAliases.set(normalizedAlias, {
                    index: bookmarkNum,
                    title: (record.title as string).trim(),
                });
                resolvedAlias = normalizedAlias;
                if (record.alias !== normalizedAlias) {
                    needsClone = true;
                }
            }
        }

        let resolvedSearchUrl: string | undefined;
        let hasSearchUrlKey = false;

        if (record.searchUrl !== undefined) {
            hasSearchUrlKey = true;
            if (typeof record.searchUrl !== 'string') {
                throw new Error(`Bookmark ${bookmarkNum}.searchUrl must be a string.`);
            }
            const trimmedSearchUrl = record.searchUrl.trim();
            if (trimmedSearchUrl === '') {
                needsClone = true;
                resolvedSearchUrl = undefined;
            } else {
                const normalizedSearchUrl = normalizeSearchUrl(trimmedSearchUrl);
                if (!normalizedSearchUrl) {
                    throw new Error(
                        `Bookmark ${bookmarkNum}.searchUrl must be a valid HTTP(S) search URL containing %s.`,
                    );
                }
                resolvedSearchUrl = normalizedSearchUrl;
                if (record.searchUrl !== normalizedSearchUrl) {
                    needsClone = true;
                }
            }
        }

        if (!needsClone) {
            return record as unknown as Bookmark;
        }

        const copy = { ...(record as unknown as Bookmark) };
        if (hasAliasKey) {
            if (resolvedAlias !== undefined) copy.alias = resolvedAlias;
            else delete copy.alias;
        }
        if (hasSearchUrlKey) {
            if (resolvedSearchUrl !== undefined) copy.searchUrl = resolvedSearchUrl;
            else delete copy.searchUrl;
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
            const bAlias = normalizeAlias(bookmark.alias ?? '');
            if (!bAlias) return;
            if (normalizedWholeAlias && bAlias === normalizedWholeAlias) {
                scores.set(bookmark, -2);
            } else if (aliasPrefix && bAlias.startsWith(aliasPrefix)) {
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
    const targetAlias = normalizeAlias(target.alias ?? '');

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
                && normalizeAlias(item.alias ?? '') === targetAlias
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
    | { ok: true; bookmarks: Bookmark[] }
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

    const nextAlias = normalizeAlias(nextBookmark.alias ?? '');
    if (nextAlias) {
        const duplicateAlias = bookmarks.find(
            (bookmark, index) =>
                index !== editingIndex
                && normalizeAlias(bookmark.alias ?? '') === nextAlias,
        );
        if (duplicateAlias) {
            return {
                ok: false,
                error: `“${duplicateAlias.title}” already uses shortcut !${nextAlias}.`,
            };
        }
    }

    let nextBookmarks: Bookmark[];
    if (resolvedEditing) {
        if (nextBookmark.section === resolvedEditing.section) {
            nextBookmarks = bookmarks.map((bookmark, index) =>
                index === editingIndex ? nextBookmark : bookmark,
            );
        } else {
            const remaining = bookmarks.filter(
                (_bookmark, index) => index !== editingIndex,
            );
            nextBookmarks = insertBookmarkInSection(remaining, nextBookmark);
        }
    } else {
        nextBookmarks = insertBookmarkInSection(bookmarks, nextBookmark);
    }

    return { ok: true, bookmarks: nextBookmarks };
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
