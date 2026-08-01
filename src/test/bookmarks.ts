import { normalizeUrl } from '../lib';

export interface TestBookmark {
    title: string;
    url: string;
    section: string;
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

export function parseTestBookmarks(content: string): TestBookmark[] {
    const value: unknown = JSON.parse(content);
    if (!Array.isArray(value)) throw new Error('Expected a JSON array of bookmarks.');

    return value.map((item: unknown, index) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new Error(`Bookmark ${index + 1} must be an object.`);
        }

        const record = item as Record<string, unknown>;
        for (const field of ['title', 'url', 'section'] as const) {
            if (typeof record[field] !== 'string' || !record[field].trim()) {
                throw new Error(`Bookmark ${index + 1}.${field} must be a non-empty string.`);
            }
        }
        if (!normalizeUrl(record.url as string)) {
            throw new Error(`Bookmark ${index + 1}.url must be a valid HTTP(S) URL.`);
        }

        for (const field of optionalStrings) {
            if (record[field] !== undefined && typeof record[field] !== 'string') {
                throw new Error(`Bookmark ${index + 1}.${field} must be a string.`);
            }
        }
        for (const field of optionalStringArrays) {
            if (
                record[field] !== undefined &&
                (!Array.isArray(record[field]) ||
                    record[field].some((entry) => typeof entry !== 'string'))
            ) {
                throw new Error(`Bookmark ${index + 1}.${field} must be a string array.`);
            }
        }
        if (record.iconUrl && !normalizeUrl(record.iconUrl as string)) {
            throw new Error(`Bookmark ${index + 1}.iconUrl must be a valid HTTP(S) URL.`);
        }

        return record as unknown as TestBookmark;
    });
}
