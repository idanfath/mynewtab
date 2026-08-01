import assert from 'node:assert/strict';
import test from 'node:test';
import {
    INVALID_BOOKMARKS_BACKUP_KEY,
    getDefaultBookmarks,
    loadBookmarks,
    normalizeUrl,
    parseBookmarks,
} from '../src/lib.ts';

test('normalizes shorthand domains and rejects unsafe schemes', () => {
    assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
    assert.equal(normalizeUrl('javascript://alert(1)'), '');
    assert.equal(normalizeUrl('mailto:user@example.com'), '');
});

test('accepts bookmark data only when its shape and URLs are valid', () => {
    assert.deepEqual(
        parseBookmarks('{"work":[{"title":"Docs","url":"docs.example.com"}]}'),
        { work: [{ title: 'Docs', url: 'docs.example.com' }] },
    );
    assert.throws(
        () => parseBookmarks('{"work":[{"title":"Docs","url":"ftp://example.com"}]}'),
        /valid HTTP\(S\) URL/,
    );
    assert.throws(() => parseBookmarks('null'), /grouped by category/);
});

test('backs up invalid stored data before restoring defaults', () => {
    const values = new Map([['bookmarks', '{broken']]);
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
    };
    const originalWarn = console.warn;
    console.warn = () => undefined;

    try {
        assert.deepEqual(loadBookmarks(storage), getDefaultBookmarks());
        assert.equal(values.get(INVALID_BOOKMARKS_BACKUP_KEY), '{broken');
    } finally {
        console.warn = originalWarn;
    }
});
