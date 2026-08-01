import type { BookMark, BookMarks } from './types.ts';

const STORAGE_KEY = 'bookmarks';
export const INVALID_BOOKMARKS_BACKUP_KEY = 'bookmarks.invalid-backup';

export function getDefaultBookmarks(): BookMarks {
    return {
        default: [
            {
                title: 'Example Bookmark',
                url: 'https://example.com',
                description: 'This is an example bookmark.',
            },
        ],
    };
}

export function normalizeUrl(url: string): string {
    const value = url.trim();
    if (!value) return '';

    try {
        const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
        if (hasScheme && !/^https?:\/\//i.test(value)) return '';

        const candidate = hasScheme ? value : `https://${value}`;
        const parsed = new URL(candidate);

        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.href
            : '';
    } catch {
        return '';
    }
}

export function getFaviconUrl(url: string, size = 64): string {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return '';

    return `https://www.google.com/s2/favicons?domain=${new URL(normalizedUrl).hostname}&sz=${size}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(
    value: unknown,
    field: string,
    location: string,
): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new Error(`${location}.${field} must be a string.`);
    }
    return value;
}

function parseBookmark(value: unknown, location: string): BookMark {
    if (!isRecord(value)) {
        throw new Error(`${location} must be an object.`);
    }
    if (typeof value.title !== 'string' || !value.title.trim()) {
        throw new Error(`${location}.title must be a non-empty string.`);
    }
    if (typeof value.url !== 'string' || !normalizeUrl(value.url)) {
        throw new Error(`${location}.url must be a valid HTTP(S) URL.`);
    }

    const customIconUrl = optionalString(
        value.customIconUrl,
        'customIconUrl',
        location,
    );
    if (customIconUrl && !normalizeUrl(customIconUrl)) {
        throw new Error(`${location}.customIconUrl must be a valid HTTP(S) URL.`);
    }

    const description = optionalString(value.description, 'description', location);

    return {
        title: value.title.trim(),
        url: value.url.trim(),
        ...(description === undefined ? {} : { description }),
        ...(customIconUrl === undefined ? {} : { customIconUrl }),
    };
}

export function parseBookmarks(content: string): BookMarks {
    const value: unknown = JSON.parse(content);
    if (!isRecord(value)) {
        throw new Error('Bookmarks must be an object grouped by category.');
    }

    return Object.fromEntries(
        Object.entries(value).map(([category, bookmarks]) => {
            if (!category.trim()) {
                throw new Error('Category names cannot be empty.');
            }
            if (!Array.isArray(bookmarks)) {
                throw new Error(`Category "${category}" must contain an array.`);
            }

            return [
                category,
                bookmarks.map((bookmark, index) =>
                    parseBookmark(bookmark, `${category}[${index}]`),
                ),
            ];
        }),
    );
}

type BookmarkStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadBookmarks(storage: BookmarkStorage = localStorage): BookMarks {
    let content: string | null;
    try {
        content = storage.getItem(STORAGE_KEY);
    } catch (error) {
        console.warn('Bookmark storage is unavailable. Using defaults.', error);
        return getDefaultBookmarks();
    }
    if (!content) return getDefaultBookmarks();

    try {
        return parseBookmarks(content);
    } catch (error) {
        try {
            storage.setItem(INVALID_BOOKMARKS_BACKUP_KEY, content);
        } catch {
            // Recovery still works when storage is full or unavailable.
        }
        console.warn('Invalid saved bookmarks were backed up and reset.', error);
        return getDefaultBookmarks();
    }
}

export function saveBookmarks(
    bookmarks: BookMarks,
    storage: BookmarkStorage = localStorage,
): boolean {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
        return true;
    } catch (error) {
        console.error('Failed to save bookmarks:', error);
        return false;
    }
}
