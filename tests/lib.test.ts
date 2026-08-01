import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUrl } from '../src/lib.ts';
import {
    parseBookmarks,
    reorderBookmarkSections,
    searchBookmarks,
} from '../src/bookmarks.ts';

test('normalizes shorthand domains and rejects unsafe schemes', () => {
    assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
    assert.equal(normalizeUrl('javascript://alert(1)'), '');
    assert.equal(normalizeUrl('mailto:user@example.com'), '');
});

test('accepts bookmark data only when its shape and URLs are valid', () => {
    assert.deepEqual(
        parseBookmarks('[{"title":"Docs","url":"docs.example.com","section":"Work"}]'),
        [{ title: 'Docs', url: 'docs.example.com', section: 'Work' }],
    );
    assert.throws(
        () => parseBookmarks('[{"title":"Docs","url":"ftp://example.com","section":"Work"}]'),
        /valid HTTP\(S\) URL/,
    );
    assert.throws(() => parseBookmarks('null'), /JSON array/);
});

test('reorders whole sections while preserving bookmark order within them', () => {
    const bookmarks = parseBookmarks(`[
        {"title":"Work 1","url":"work.example","section":"Work"},
        {"title":"Media 1","url":"media.example","section":"Media"},
        {"title":"Media 2","url":"media-2.example","section":"Media"},
        {"title":"AI 1","url":"ai.example","section":"AI"}
    ]`);

    assert.deepEqual(
        reorderBookmarkSections(bookmarks, 'AI', 'Work', 'before')
            .map((bookmark) => bookmark.title),
        ['AI 1', 'Work 1', 'Media 1', 'Media 2'],
    );
});

test('matches every search token across different bookmark fields', () => {
    const bookmarks = parseBookmarks(`[
        {
            "title":"Anime Vault",
            "url":"anime.example",
            "section":"Media",
            "categories":["Anime"],
            "capabilities":["Download","Stream"]
        },
        {
            "title":"Anime News",
            "url":"news.example",
            "section":"Reading",
            "categories":["Anime"]
        }
    ]`);

    assert.deepEqual(
        searchBookmarks(bookmarks, 'anime download').map((bookmark) => bookmark.title),
        ['Anime Vault'],
    );
    assert.deepEqual(
        searchBookmarks(bookmarks, 'download stream').map((bookmark) => bookmark.title),
        ['Anime Vault'],
    );
});
