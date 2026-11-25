import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUrl, urlIdentity } from '../src/lib.ts';
import {
    BACKUP_KEY,
    STORAGE_KEY,
    classifyStoredDataFailure,
    groupBookmarksBySection,
    insertBookmarkInSection,
    loadStoredBookmarks,
    moveBookmarkToSection,
    parseBookmarks,
    reorderBookmark,
    reorderBookmarkSections,
    searchBookmarks,
    type Bookmark,
} from '../src/bookmarks.ts';
import {
    BOOKMARK_DRAG_TYPE,
    SECTION_DRAG_TYPE,
    detectDropMode,
    readDroppedUrl,
    resolveDropSection,
} from '../src/dropHandlers.ts';
import { buildInitialState, loadInitialState } from '../src/useBookmarks.ts';

function memoryStorage(values = new Map<string, string>()) {
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        values,
    };
}

function makeDropData(
    types: string[],
    values: Record<string, string> = {},
): Pick<DataTransfer, 'types' | 'getData'> {
    return {
        types,
        getData: (format: string) => values[format] ?? '',
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
    assert.equal(urlIdentity('https://example.com/?b=2&a=1'), urlIdentity('https://example.com/?a=1&b=2'));
    assert.notEqual(urlIdentity('https://example.com/a'), urlIdentity('https://example.com/b'));
    assert.notEqual(urlIdentity('https://example.com/#/inbox'), urlIdentity('https://example.com/#/sent'));
    assert.notEqual(urlIdentity('https://example.com/a#frag'), urlIdentity('https://example.com/a'));
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

test('groups scattered bookmarks by first-seen section order preserving object identity', () => {
    const w1: Bookmark = { title: 'W1', url: 'https://w1.example', section: 'Work' };
    const m1: Bookmark = { title: 'M1', url: 'https://m1.example', section: 'Media' };
    const w2: Bookmark = { title: 'W2', url: 'https://w2.example', section: 'Work' };
    const a1: Bookmark = { title: 'A1', url: 'https://a1.example', section: 'AI' };
    const m2: Bookmark = { title: 'M2', url: 'https://m2.example', section: 'Media' };

    const grouped = groupBookmarksBySection([w1, m1, w2, a1, m2]);
    assert.deepEqual(grouped, [w1, w2, m1, m2, a1]);
    assert.equal(grouped[0], w1);
    assert.equal(grouped[1], w2);
    assert.equal(grouped[2], m1);
    assert.equal(grouped[3], m2);
    assert.equal(grouped[4], a1);
});

test('inserts bookmark at end of its section or appends new section', () => {
    const w1: Bookmark = { title: 'W1', url: 'https://w1.example', section: 'Work' };
    const m1: Bookmark = { title: 'M1', url: 'https://m1.example', section: 'Media' };
    const w2: Bookmark = { title: 'W2', url: 'https://w2.example', section: 'Work' };
    const w3: Bookmark = { title: 'W3', url: 'https://w3.example', section: 'Work' };
    const r1: Bookmark = { title: 'R1', url: 'https://r1.example', section: 'Reading' };

    const existingSection = insertBookmarkInSection([w1, m1, w2], w3);
    assert.deepEqual(existingSection.map((b) => b.title), ['W1', 'W2', 'W3', 'M1']);
    assert.equal(existingSection[2], w3);

    const newSection = insertBookmarkInSection([w1, m1], r1);
    assert.deepEqual(newSection.map((b) => b.title), ['W1', 'M1', 'R1']);
});

test('moves bookmark to target section and returns exact reference on no-ops', () => {
    const w1: Bookmark = { title: 'W1', url: 'https://w1.example', section: 'Work' };
    const m1: Bookmark = { title: 'M1', url: 'https://m1.example', section: 'Media' };
    const w2: Bookmark = { title: 'W2', url: 'https://w2.example', section: 'Work' };
    const scattered = [w1, m1, w2];

    const moved = moveBookmarkToSection(scattered, w1, 'Media');
    assert.deepEqual(moved.map((b) => `${b.title}:${b.section}`), [
        'W2:Work',
        'M1:Media',
        'W1:Media',
    ]);
    assert.notEqual(moved[2], w1);
    assert.equal(moved[0], w2);
    assert.equal(moved[1], m1);

    const created = moveBookmarkToSection(scattered, m1, 'Reading');
    assert.deepEqual(created.map((b) => `${b.title}:${b.section}`), [
        'W1:Work',
        'W2:Work',
        'M1:Reading',
    ]);

    assert.equal(moveBookmarkToSection(scattered, w1, 'Work'), scattered);
    assert.equal(moveBookmarkToSection(scattered, w1, 'All'), scattered);
    assert.equal(moveBookmarkToSection(scattered, w1, '   '), scattered);
    const cloneNotInList: Bookmark = { ...w1 };
    assert.equal(moveBookmarkToSection(scattered, cloneNotInList, 'Media'), scattered);
});

test('reorders bookmarks within and across sections using object references', () => {
    const w1: Bookmark = { title: 'W1', url: 'https://w1.example', section: 'Work' };
    const w2: Bookmark = { title: 'W2', url: 'https://w2.example', section: 'Work' };
    const w3: Bookmark = { title: 'W3', url: 'https://w3.example', section: 'Work' };
    const m1: Bookmark = { title: 'M1', url: 'https://m1.example', section: 'Media' };
    const m2: Bookmark = { title: 'M2', url: 'https://m2.example', section: 'Media' };

    const ordered = [w1, w2, w3, m1, m2];

    const movedDown = reorderBookmark(ordered, w1, w3, 'after');
    assert.deepEqual(movedDown.map((b) => b.title), ['W2', 'W3', 'W1', 'M1', 'M2']);
    assert.equal(movedDown[2], w1);

    const movedUp = reorderBookmark(ordered, w3, w1, 'before');
    assert.deepEqual(movedUp.map((b) => b.title), ['W3', 'W1', 'W2', 'M1', 'M2']);
    assert.equal(movedUp[0], w3);

    const crossSection = reorderBookmark(ordered, w1, m2, 'before');
    assert.deepEqual(crossSection.map((b) => `${b.title}:${b.section}`), [
        'W2:Work',
        'W3:Work',
        'M1:Media',
        'W1:Media',
        'M2:Media',
    ]);
    assert.notEqual(crossSection[3], w1);

    const singleWorkCross = reorderBookmark([w1, m1], w1, m1, 'before');
    assert.deepEqual(singleWorkCross.map((b) => `${b.title}:${b.section}`), [
        'W1:Media',
        'M1:Media',
    ]);

    assert.equal(reorderBookmark(ordered, w1, w1, 'before'), ordered);
    assert.equal(reorderBookmark(ordered, w1, w2, 'before'), ordered);
    assert.equal(reorderBookmark(ordered, w2, w1, 'after'), ordered);

    const scattered = [w1, m1, w2];
    assert.equal(reorderBookmark(scattered, w1, w2, 'before'), scattered);
    assert.equal(reorderBookmark(scattered, w2, w1, 'after'), scattered);

    const missing: Bookmark = { ...w1 };
    assert.equal(reorderBookmark(ordered, missing, w2, 'before'), ordered);
    assert.equal(reorderBookmark(ordered, w1, missing, 'before'), ordered);
});

test('detects drop mode while ignoring internal section and bookmark drags', () => {
    assert.equal(
        detectDropMode(makeDropData([SECTION_DRAG_TYPE, 'text/plain']), true),
        null,
    );
    assert.equal(
        detectDropMode(makeDropData([BOOKMARK_DRAG_TYPE, 'text/uri-list', 'text/plain']), true),
        null,
    );
    assert.equal(
        detectDropMode(makeDropData(['Files', 'text/uri-list']), true),
        'file',
    );
    assert.equal(
        detectDropMode(makeDropData(['Files', 'text/uri-list']), false),
        'url',
    );
    assert.equal(detectDropMode(makeDropData(['Files']), false), null);
    assert.equal(detectDropMode(makeDropData(['text/html']), false), 'url');
    assert.equal(detectDropMode(makeDropData(['text/plain']), false), 'url');
    assert.equal(detectDropMode(makeDropData(['application/octet-stream']), true), null);
});

test('resolves drop section from hovered target, active section, or fallback', () => {
    assert.equal(resolveDropSection('  Media  ', 'Work'), 'Media');
    assert.equal(resolveDropSection('AI', 'All'), 'AI');
    assert.equal(resolveDropSection(null, 'Work'), 'Work');
    assert.equal(resolveDropSection('   ', 'Work'), 'Work');
    assert.equal(resolveDropSection(undefined, 'All'), 'Uncategorized');
    assert.equal(resolveDropSection('', '', 'Reading'), 'Reading');
});

test('reads valid dropped HTTP(S) URLs from uri-list or plain text', () => {
    assert.equal(
        readDroppedUrl(makeDropData(['text/uri-list'], {
            'text/uri-list': '# comment\n\nhttps://example.com/docs\nhttps://ignored.example',
        })),
        'https://example.com/docs',
    );
    assert.equal(
        readDroppedUrl(makeDropData(['text/uri-list', 'text/plain'], {
            'text/uri-list': 'javascript:alert(1)',
            'text/plain': 'example.org/notes',
        })),
        'https://example.org/notes',
    );
    assert.equal(
        readDroppedUrl(makeDropData(['text/plain'], {
            'text/plain': 'mailto:user@example.com',
        })),
        '',
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

test('starts empty instead of crashing when storage access is blocked', (context) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    context.after(() => {
        if (original) Object.defineProperty(globalThis, 'localStorage', original);
        else delete (globalThis as { localStorage?: unknown }).localStorage;
    });
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
            throw new Error('SecurityError');
        },
    });

    assert.deepEqual(loadInitialState(), { bookmarks: [], error: null });
});
