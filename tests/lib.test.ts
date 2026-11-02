import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUrl } from '../src/lib.ts';
import { urlIdentity } from '../src/lib.ts';
import {
    BACKUP_KEY,
    STORAGE_KEY,
    classifyStoredDataFailure,
    loadStoredBookmarks,
    parseBookmarks,
    reorderBookmarkSections,
    searchBookmarks,
} from '../src/bookmarks.ts';
import { buildInitialState } from '../src/useBookmarks.ts';

function memoryStorage(values = new Map<string, string>()) {
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        values,
    };
}

test('normalizes shorthand domains and rejects unsafe schemes', () => {
    assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
    assert.equal(normalizeUrl('javascript://alert(1)'), '');
    assert.equal(normalizeUrl('mailto:user@example.com'), '');
});

test('treats URL variants as the same identity', () => {
    assert.equal(urlIdentity('https://example.com'), urlIdentity('https://example.com/'));
    assert.equal(urlIdentity('https://example.com'), urlIdentity('https://EXAMPLE.com/'));
    assert.equal(urlIdentity('https://example.com:443/a'), urlIdentity('https://example.com/a'));
    assert.equal(urlIdentity('http://example.com:80/a/'), urlIdentity('http://example.com/a'));
    assert.equal(urlIdentity('https://example.com/a#frag'), urlIdentity('https://example.com/a'));
    assert.equal(urlIdentity('https://example.com/?b=2&a=1'), urlIdentity('https://example.com/?a=1&b=2'));
    assert.notEqual(urlIdentity('https://example.com/a'), urlIdentity('https://example.com/b'));
    assert.equal(urlIdentity('not a url'), '');
});

test('accepts bookmark data only when its shape and URLs are valid', () => {
    assert.deepEqual(parseBookmarks('  \n  '), []);
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

test('keeps a backup of stored data it cannot read', () => {
    const values = new Map([[STORAGE_KEY, '{broken']]);
    const storage = memoryStorage(values);

    assert.deepEqual(loadStoredBookmarks(storage), {
        bookmarks: [],
        recovery: 'backed-up',
        failure: 'truncated',
    });
    assert.equal(values.get(BACKUP_KEY), '{broken');

    storage.setItem = () => {
        throw new Error('full');
    };
    assert.deepEqual(loadStoredBookmarks(storage), {
        bookmarks: [],
        recovery: 'backup-failed',
        failure: 'truncated',
    });

    values.set(STORAGE_KEY, '[{"title":1,"url":"x","section":"y"}]');
    assert.deepEqual(loadStoredBookmarks(storage), {
        bookmarks: [],
        recovery: 'backup-failed',
        failure: 'invalid',
    });

    values.set(STORAGE_KEY, '[]');
    assert.deepEqual(loadStoredBookmarks(storage), { bookmarks: [] });
});

test('classifies stored-data failures by parseability', () => {
    assert.equal(classifyStoredDataFailure(new SyntaxError('bad')), 'truncated');
    assert.equal(classifyStoredDataFailure(new Error('Bookmark 1.url must be a valid HTTP(S) URL.')), 'invalid');
    assert.equal(classifyStoredDataFailure(new Error('Expected a JSON array of bookmarks.')), 'invalid');
});

test('builds load state with happy path and corrupt-backup errors', () => {
    const happy = memoryStorage(new Map([
        [STORAGE_KEY, JSON.stringify([{ title: 'Docs', url: 'https://docs.example', section: 'Work' }])],
    ]));
    const happyState = buildInitialState(happy);
    assert.equal(happyState.error, null);
    assert.deepEqual(happyState.bookmarks.map((bookmark) => bookmark.title), ['Docs']);

    const truncated = memoryStorage(new Map([[STORAGE_KEY, '{"title":']]));
    const truncatedState = buildInitialState(truncated);
    assert.equal(truncatedState.bookmarks.length, 0);
    assert.equal(truncatedState.error?.title, 'Couldn’t read saved bookmarks');
    assert.match(truncatedState.error?.detail ?? '', /truncated|not valid JSON/);
    assert.match(truncatedState.error?.detail ?? '', new RegExp(BACKUP_KEY));
    assert.equal(truncated.values.get(BACKUP_KEY), '{"title":');

    const invalid = memoryStorage(new Map([[STORAGE_KEY, '[{"title":1}]']]));
    const invalidState = buildInitialState(invalid);
    assert.equal(invalidState.bookmarks.length, 0);
    assert.match(invalidState.error?.detail ?? '', /invalid bookmark entries/);

    const quota = memoryStorage(new Map([[STORAGE_KEY, '{broken']]));
    quota.setItem = () => {
        throw new Error('full');
    };
    const quotaState = buildInitialState(quota);
    assert.match(quotaState.error?.detail ?? '', /No backup could be made/);

    const emptyState = buildInitialState(memoryStorage());
    assert.deepEqual(emptyState, { bookmarks: [], error: null });
});
