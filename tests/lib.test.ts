import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildSearchUrl,
    encodeSearchQuery,
    getFaviconUrl,
    isBareHostWithPort,
    isLocalOrPrivateHost,
    isPublicSearchableHost,
    normalizeAlias,
    normalizeSearchUrl,
    normalizeUrl,
    safeHostname,
    urlIdentity,
} from '../src/lib.ts';
import {
    BACKUP_KEY,
    STORAGE_KEY,
    applyBookmarkSave,
    classifyStoredDataFailure,
    findMatchingBookmark,
    findMatchingBookmarkIndex,
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
    isBookmarkFileMime,
    isBookmarkFileName,
    readDroppedUrl,
    resolveDropSection,
    type DataTransferItemLike,
} from '../src/dropHandlers.ts';
import { formatBookmarkError } from '../src/formatBookmarkError.ts';
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

test('normalizes shorthand domains, local/private hosts, and rejects unsafe or malformed URLs', () => {
    // Public HTTPS defaults
    assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
    assert.equal(normalizeUrl('example.com:8443/app'), 'https://example.com:8443/app');
    assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');

    // Local/private HTTP defaults
    assert.equal(normalizeUrl('localhost:5173/api'), 'http://localhost:5173/api');
    assert.equal(normalizeUrl('sub.localhost:3000'), 'http://sub.localhost:3000/');
    assert.equal(normalizeUrl('nas.local/ui'), 'http://nas.local/ui');
    assert.equal(normalizeUrl('nas.local.'), 'http://nas.local./');
    assert.equal(normalizeUrl('app.internal:3000'), 'http://app.internal:3000/');
    assert.equal(normalizeUrl('router.lan'), 'http://router.lan/');
    assert.equal(normalizeUrl('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
    assert.equal(normalizeUrl('10.0.0.1'), 'http://10.0.0.1/');
    assert.equal(normalizeUrl('192.168.1.5'), 'http://192.168.1.5/');
    assert.equal(normalizeUrl('172.16.0.1'), 'http://172.16.0.1/');
    assert.equal(normalizeUrl('0.0.0.0:4000'), 'http://0.0.0.0:4000/');
    assert.equal(normalizeUrl('[::1]:3000/health'), 'http://[::1]:3000/health');

    // Rejections
    const rejected = [
        '//evil.com',
        '\\evil.com',
        '/etc/passwd',
        'https:///',
        'https:///path',
        'https://\\evil.com',
        'https://.',
        'https://..',
        'https://foo..',
        'https://.example.com',
        'https://example.com:0',
        'localhost:0',
        'localhost:99999',
        'javascript:1',
        'javascript:alert(1)',
        'javascript://alert(1)',
        'data:text/html,hi',
        'vbscript:1',
        'blob:https://example.com/1',
        'file:///etc/passwd',
        'mailto:a@b.com',
        'http:example.com',
    ];
    for (const bad of rejected) {
        assert.equal(normalizeUrl(bad), '', `expected empty for ${bad}`);
    }
});

test('checks host privacy helpers, safeHostname, and privacy-gated getFaviconUrl', () => {
    assert.equal(isLocalOrPrivateHost('localhost'), true);
    assert.equal(isLocalOrPrivateHost('sub.localhost'), true);
    assert.equal(isLocalOrPrivateHost('nas.local.'), true);
    assert.equal(isLocalOrPrivateHost('172.31.255.254'), true);
    assert.equal(isLocalOrPrivateHost('172.32.0.1'), false);
    assert.equal(isLocalOrPrivateHost('[fe80::1]'), true);
    assert.equal(isLocalOrPrivateHost('[fd00::1]'), true);
    assert.equal(isLocalOrPrivateHost('github.com'), false);

    assert.equal(isPublicSearchableHost('github.com'), true);
    assert.equal(isPublicSearchableHost('github.com.'), true);
    assert.equal(isPublicSearchableHost('localhost'), false);
    assert.equal(isPublicSearchableHost('nas.local'), false);
    assert.equal(isPublicSearchableHost('app.internal'), false);
    assert.equal(isPublicSearchableHost('router.lan'), false);
    assert.equal(isPublicSearchableHost('intranet'), false);
    assert.equal(isPublicSearchableHost('1.1.1.1'), false);
    assert.equal(isPublicSearchableHost('[::1]'), false);

    assert.equal(isBareHostWithPort('localhost:5173/api'), true);
    assert.equal(isBareHostWithPort('example.com:8443/app'), true);
    assert.equal(isBareHostWithPort('localhost:0'), false);
    assert.equal(isBareHostWithPort('localhost:99999'), false);
    assert.equal(isBareHostWithPort('javascript:1'), false);

    assert.equal(safeHostname('example.com/foo'), 'example.com');
    assert.equal(safeHostname('http://[::1]:8080/api'), '[::1]');
    assert.equal(safeHostname('javascript:alert(1)'), '');
    assert.equal(safeHostname(''), '');

    assert.equal(
        getFaviconUrl('https://github.com/org'),
        'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    );
    assert.equal(
        getFaviconUrl('https://github.com./'),
        'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    );
    assert.equal(getFaviconUrl('http://localhost:3000'), '');
    assert.equal(getFaviconUrl('http://nas.local'), '');
    assert.equal(getFaviconUrl('http://app.internal'), '');
    assert.equal(getFaviconUrl('http://router.lan'), '');
    assert.equal(getFaviconUrl('http://192.168.1.1'), '');
    assert.equal(getFaviconUrl('http://127.0.0.1:8080'), '');
    assert.equal(getFaviconUrl('http://[::1]:8080'), '');
    assert.equal(getFaviconUrl('http://intranet/wiki'), '');
});

test('normalizes valid aliases and rejects malformed tokens', () => {
    assert.equal(normalizeAlias('gh'), 'gh');
    assert.equal(normalizeAlias('!GH'), 'gh');
    assert.equal(normalizeAlias('  !My-Docs-2  '), 'my-docs-2');
    assert.equal(normalizeAlias('g'), 'g');
    assert.equal(normalizeAlias('a'.repeat(32)), 'a'.repeat(32));

    for (const invalid of [
        '',
        '   ',
        '!',
        '!!gh',
        '-gh',
        'gh-',
        'gh search',
        'c++',
        'a'.repeat(33),
    ]) {
        assert.equal(normalizeAlias(invalid), '', `expected empty for ${invalid}`);
    }
});

test('validates searchUrl templates safely and builds search URLs without injection or path collapse', () => {
    assert.equal(
        normalizeSearchUrl('github.com/search?q=%s'),
        'https://github.com/search?q=%s',
    );
    assert.equal(
        normalizeSearchUrl('https://en.wikipedia.org/wiki/%s'),
        'https://en.wikipedia.org/wiki/%s',
    );
    assert.equal(
        normalizeSearchUrl('https://app.example/#/q=%s'),
        'https://app.example/#/q=%s',
    );
    assert.equal(
        normalizeSearchUrl('localhost:3000/q?s=%s'),
        'http://localhost:3000/q?s=%s',
    );
    assert.equal(
        normalizeSearchUrl('nas.local/search?q=%s'),
        'http://nas.local/search?q=%s',
    );
    assert.equal(
        normalizeSearchUrl('https://example.com/?a=%s&b=%s'),
        'https://example.com/?a=%s&b=%s',
    );
    assert.equal(
        normalizeSearchUrl('https://user:__OMNIBAR_S__@example.com/?q=%s'),
        'https://user:__OMNIBAR_S__@example.com/?q=%s',
    );
    assert.equal(
        normalizeSearchUrl('https://omnibarsentinel.com/?q=%s'),
        'https://omnibarsentinel.com/?q=%s',
    );
    assert.equal(
        normalizeSearchUrl('https://%6fmnibarsentinel.com/?q=%s'),
        'https://omnibarsentinel.com/?q=%s',
    );

    const rejectedTemplates = [
        'https://example.com/search',
        'javascript:alert("%s")',
        'data:text/html,%s',
        '//%s',
        '/%s',
        'https:///%s',
        'https://\\%s',
        'https://%s.example.com/?q=%s',
        'https://user:%s@example.com/?q=%s',
        'https://%s:pass@example.com/?q=%s',
        'https://example.com:%s/?q=%s',
        'https://.:80/?q=%s',
        'https://example.com:0/?q=%s',
    ];
    for (const bad of rejectedTemplates) {
        assert.equal(normalizeSearchUrl(bad), '', `expected empty for ${bad}`);
    }

    assert.equal(
        buildSearchUrl('https://example.com/?q=%s', 'c++ & rust / a?b#c $&'),
        'https://example.com/?q=c%2B%2B%20%26%20rust%20%2F%20a%3Fb%23c%20%24%26',
    );
    assert.equal(
        encodeSearchQuery('\uD800hello\uDC00🚀'),
        '%EF%BF%BDhello%EF%BF%BD%F0%9F%9A%80',
    );
    assert.equal(
        buildSearchUrl('https://example.com/?q=%s', '\uD800hello\uDC00🚀'),
        'https://example.com/?q=%EF%BF%BDhello%EF%BF%BD%F0%9F%9A%80',
    );

    // Prevent WHATWG %2E / %2E%2E path collapse
    assert.equal(
        buildSearchUrl('https://en.wikipedia.org/wiki/%s', '..'),
        'https://en.wikipedia.org/wiki/%2E%2E',
    );
    assert.equal(
        buildSearchUrl('https://en.wikipedia.org/wiki/%s', '.'),
        'https://en.wikipedia.org/wiki/%2E',
    );
    assert.equal(
        buildSearchUrl('https://www.google.com/maps/search/%s', '..'),
        'https://www.google.com/maps/search/%2E%2E',
    );
    assert.equal(
        buildSearchUrl('https://en.wikipedia.org/wiki/%s', '../admin'),
        'https://en.wikipedia.org/wiki/..%2Fadmin',
    );
    assert.equal(
        buildSearchUrl('https://en.wikipedia.org/wiki/%s', 'a/..'),
        'https://en.wikipedia.org/wiki/a%2F..',
    );
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

test('accepts bookmark data only when its shape, URLs, aliases, and searchUrls are valid', () => {
    assert.deepEqual(parseBookmarks('  \n  '), []);
    assert.deepEqual(
        parseBookmarks('[{"title":"Docs","url":"docs.example.com","section":"Work"}]'),
        [{ title: 'Docs', url: 'docs.example.com', section: 'Work' }],
    );
    assert.deepEqual(
        parseBookmarks(`[
            {"title":"GitHub","url":"https://github.com/","section":"Dev","alias":"!GH","searchUrl":"github.com/search?q=%s"},
            {"title":"Notes","url":"https://notes.example/","section":"Work","alias":"  ","searchUrl":""},
            {"title":"SoloAlias","url":"https://solo.example/","section":"Work","alias":"solo"},
            {"title":"SoloSearch","url":"https://search.example/","section":"Work","searchUrl":"https://search.example/?q=%s"}
        ]`),
        [
            {
                title: 'GitHub',
                url: 'https://github.com/',
                section: 'Dev',
                alias: 'gh',
                searchUrl: 'https://github.com/search?q=%s',
            },
            { title: 'Notes', url: 'https://notes.example/', section: 'Work' },
            { title: 'SoloAlias', url: 'https://solo.example/', section: 'Work', alias: 'solo' },
            {
                title: 'SoloSearch',
                url: 'https://search.example/',
                section: 'Work',
                searchUrl: 'https://search.example/?q=%s',
            },
        ],
    );
    assert.throws(
        () => parseBookmarks(`[
            {"title":"GitHub","url":"https://github.com/","section":"Dev","alias":"gh"},
            {"title":"Gitea","url":"https://gitea.example/","section":"Dev","alias":"!GH"}
        ]`),
        /Bookmark 2\.alias duplicates "gh" from Bookmark 1 \(GitHub\)\./,
    );
    assert.throws(
        () => parseBookmarks('[{"title":"Bad","url":"https://example.com","section":"Dev","alias":"bad alias"}]'),
        /Bookmark 1\.alias must be 1-32 lowercase letters, numbers, or hyphens\./,
    );
    assert.throws(
        () => parseBookmarks('[{"title":"Bad","url":"https://example.com","section":"Dev","searchUrl":"https://example.com/search"}]'),
        /Bookmark 1\.searchUrl must be a valid HTTP\(S\) search URL containing %s\./,
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

test('matches every search token across fields, handles punctuation, and boosts aliases', () => {
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
        },
        {
            "title":"My Docs Reference",
            "url":"https://docs.example/",
            "section":"Work",
            "alias":"my-docs"
        },
        {
            "title":"Production EU Monitor",
            "url":"https://monitor.example/",
            "section":"Ops",
            "alias":"mon-prod-eu"
        }
    ]`);

    assert.deepEqual(searchBookmarks(bookmarks, ''), bookmarks);
    assert.deepEqual(searchBookmarks(bookmarks, '   '), bookmarks);
    assert.deepEqual(searchBookmarks(bookmarks, '???'), []);
    assert.deepEqual(searchBookmarks(bookmarks, '+++'), []);
    assert.deepEqual(searchBookmarks(bookmarks, '$$$'), []);

    assert.deepEqual(
        searchBookmarks(bookmarks, 'anime download').map((bookmark) => bookmark.title),
        ['Anime Vault'],
    );
    assert.deepEqual(
        searchBookmarks(bookmarks, 'download stream').map((bookmark) => bookmark.title),
        ['Anime Vault'],
    );
    assert.equal(
        searchBookmarks(bookmarks, 'my-docs')[0]?.title,
        'My Docs Reference',
    );
    assert.equal(
        searchBookmarks(bookmarks, 'mon-p')[0]?.title,
        'Production EU Monitor',
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

test('recognizes bookmark file extensions, MIME types, and DataTransfer items drop modes', () => {
    assert.equal(isBookmarkFileName('bookmarks.json'), true);
    assert.equal(isBookmarkFileName('Chrome_Bookmarks.HTML'), true);
    assert.equal(isBookmarkFileName('saved.htm'), true);
    assert.equal(isBookmarkFileName('site.webloc'), false);
    assert.equal(isBookmarkFileName('photo.png'), false);

    assert.equal(isBookmarkFileMime('application/json'), true);
    assert.equal(isBookmarkFileMime('application/json; charset=utf-8'), true);
    assert.equal(isBookmarkFileMime('TEXT/HTML'), true);
    assert.equal(isBookmarkFileMime('text/html; charset=utf-8'), true);
    assert.equal(isBookmarkFileMime(' TEXT/HTML ; charset=UTF-8 '), true);
    assert.equal(isBookmarkFileMime('text/plain; charset=utf-8'), false);
    assert.equal(isBookmarkFileMime('image/png'), false);
    assert.equal(isBookmarkFileMime(''), false);

    const withItems = (types: string[], items: DataTransferItemLike[]) => ({
        types,
        items,
    });

    // Browser URL drag attaching virtual .webloc/.url file (type '') resolves to 'url'
    assert.equal(
        detectDropMode(
            withItems(['Files', 'text/uri-list'], [{ kind: 'file', type: '' }]),
            true,
        ),
        'url',
    );
    // Linked image drag (image/png + text/uri-list) resolves to 'url'
    assert.equal(
        detectDropMode(
            withItems(['Files', 'text/uri-list'], [{ kind: 'file', type: 'image/png' }]),
            true,
        ),
        'url',
    );
    // Linux file-manager HTML/JSON drag with text/uri-list resolves to 'file'
    assert.equal(
        detectDropMode(
            withItems(['Files', 'text/uri-list'], [{ kind: 'file', type: 'text/html' }]),
            true,
        ),
        'file',
    );
    assert.equal(
        detectDropMode(
            withItems(['Files', 'text/uri-list'], [{ kind: 'file', type: 'application/json' }]),
            true,
        ),
        'file',
    );
    // Desktop file drag without text/uri-list resolves to 'file'
    assert.equal(
        detectDropMode(
            withItems(['Files'], [{ kind: 'file', type: '' }]),
            true,
        ),
        'file',
    );
});

test('formats HTML, empty-file, unrecognized-format, and reserved-section errors cleanly', () => {
    assert.match(
        formatBookmarkError(new Error('Unrecognized bookmark file format.'), 'x', 'Import').detail,
        /\.json.*\.html/,
    );
    assert.match(
        formatBookmarkError(new Error('No bookmarks found in HTML file.'), '', 'Import').detail,
        /HTML file/,
    );
    assert.match(
        formatBookmarkError(new Error('No bookmarks found in JSON file.'), '[]', 'Import').detail,
        /JSON file/,
    );
    assert.equal(
        formatBookmarkError(
            new Error('No valid http:// or https:// bookmarks found (skipped 2 non-web links).'),
            '',
            'Import',
        ).detail,
        'No valid http:// or https:// bookmarks found (skipped 2 non-web links).',
    );
    assert.equal(
        formatBookmarkError(
            new Error('Bookmark 2: section “All” is reserved for the complete directory.'),
            '[]',
            'Save',
        ).detail,
        'Bookmark 2: section “All” is reserved for the complete directory.',
    );
});

test('handles IPv6, IDN, non-default ports, repeated query params, and unsafe schemes in normalizeUrl and urlIdentity', () => {
    assert.equal(normalizeUrl('https://[::1]:8080/api'), 'https://[::1]:8080/api');
    assert.equal(urlIdentity('https://[::1]:8080/api/'), urlIdentity('https://[::1]:8080/api'));
    assert.equal(normalizeUrl('https://münchen.de/path'), 'https://xn--mnchen-3ya.de/path');
    assert.equal(urlIdentity('https://MÜNCHEN.de:443/path/'), urlIdentity('https://xn--mnchen-3ya.de/path'));
    assert.notEqual(urlIdentity('https://example.com:8443/a'), urlIdentity('https://example.com/a'));
    assert.equal(
        urlIdentity('https://example.com/?b=2&a=1&a=0'),
        urlIdentity('https://example.com/?a=1&a=0&b=2'),
    );
    assert.equal(normalizeUrl('vbscript:msgbox(1)'), '');
    assert.equal(normalizeUrl('blob:https://example.com/123'), '');
    assert.equal(normalizeUrl('data:text/html,hi'), '');
});

test('allows editing a bookmark when another bookmark shares its URL identity, while still rejecting new or changed URL collisions', () => {
    const gamesWplace: Bookmark = {
        title: 'Wplace',
        url: 'https://wplace.live/',
        section: 'Games',
    };
    const pinnedWplace: Bookmark = {
        title: 'Wplace',
        url: 'https://wplace.live/',
        section: 'Pinned',
    };
    const github: Bookmark = {
        title: 'GitHub',
        url: 'https://github.com/',
        section: 'Dev',
        alias: 'gh',
    };
    const directory = [gamesWplace, pinnedWplace, github];

    // Exact bug reproduction: adding !bang shortcut + searchUrl to Pinned copy while Games copy shares URL
    const editedPinned: Bookmark = {
        ...pinnedWplace,
        alias: 'aa',
        searchUrl: 'https://wplace.live/search?q=%s',
    };
    const savedPinned = applyBookmarkSave(directory, editedPinned, pinnedWplace);
    assert.equal(savedPinned.ok, true);
    if (!savedPinned.ok) return;
    assert.equal(savedPinned.bookmarks.length, 3);
    assert.equal(savedPinned.bookmarks[0], gamesWplace);
    assert.deepEqual(savedPinned.bookmarks[1], editedPinned);
    assert.equal(savedPinned.bookmarks[2], github);
    // Persisted result remains valid on reload
    assert.deepEqual(
        parseBookmarks(JSON.stringify(savedPinned.bookmarks)),
        savedPinned.bookmarks,
    );

    // Re-saving Pinned copy with equivalent URL variant (same urlIdentity) and keeping its own !aa shortcut succeeds
    const normalizedVariantSave = applyBookmarkSave(
        savedPinned.bookmarks,
        {
            ...editedPinned,
            url: 'https://WPLACE.live:443',
            description: 'Collaborative pixel canvas',
        },
        editedPinned,
    );
    assert.equal(normalizedVariantSave.ok, true);

    // Moving edited Pinned copy to another section while keeping same urlIdentity updates only that entry
    const movedPinnedSave = applyBookmarkSave(
        savedPinned.bookmarks,
        { ...editedPinned, section: 'Favorites' },
        editedPinned,
    );
    assert.equal(movedPinnedSave.ok, true);
    if (movedPinnedSave.ok) {
        assert.deepEqual(
            movedPinnedSave.bookmarks.map((b) => `${b.section}:${b.title}`),
            ['Games:Wplace', 'Dev:GitHub', 'Favorites:Wplace'],
        );
    }

    // Assigning the same !aa shortcut to the Games copy is rejected
    const collidingAlias = applyBookmarkSave(
        savedPinned.bookmarks,
        { ...gamesWplace, alias: 'aa' },
        gamesWplace,
    );
    assert.deepEqual(collidingAlias, {
        ok: false,
        error: '“Wplace” already uses shortcut !aa.',
    });

    // Adding a brand-new bookmark with an already-used URL identity is rejected
    const duplicateAdd = applyBookmarkSave(
        directory,
        { title: 'Wplace Copy', url: 'https://wplace.live', section: 'Creative' },
        null,
    );
    assert.deepEqual(duplicateAdd, {
        ok: false,
        error: '“Wplace” already uses this URL.',
    });

    // Changing an existing bookmark's URL to collide with another bookmark's URL is rejected
    const collidingUrlChange = applyBookmarkSave(
        directory,
        { ...github, url: 'https://wplace.live/' },
        github,
    );
    assert.deepEqual(collidingUrlChange, {
        ok: false,
        error: '“Wplace” already uses this URL.',
    });

    // Changing one duplicate's URL to a brand-new non-colliding URL succeeds
    const nonCollidingUrlChange = applyBookmarkSave(
        directory,
        { ...pinnedWplace, url: 'https://wplace.org/' },
        pinnedWplace,
    );
    assert.equal(nonCollidingUrlChange.ok, true);
});

test('disambiguates detached bookmark references across duplicate URLs by section, title, and metadata', () => {
    const gamesWplace: Bookmark = {
        title: 'Wplace',
        url: 'https://wplace.live/',
        section: 'Games',
    };
    const pinnedWplaceA: Bookmark = {
        title: 'Wplace',
        url: 'https://wplace.live/',
        section: 'Pinned',
        subsection: 'Daily',
    };
    const pinnedWplaceB: Bookmark = {
        title: 'Wplace',
        url: 'https://wplace.live/',
        section: 'Pinned',
        subsection: 'Events',
        alias: 'wp',
    };
    const list = [gamesWplace, pinnedWplaceA, pinnedWplaceB];

    // Detached clone of Pinned/Events resolves index 2 (not index 0 Games or index 1 Daily)
    const detachedPinnedB: Bookmark = { ...pinnedWplaceB };
    assert.equal(findMatchingBookmarkIndex(list, detachedPinnedB), 2);
    assert.equal(findMatchingBookmark(list, detachedPinnedB), pinnedWplaceB);

    // Detached clone of Pinned/Wplace without subsection resolves Pinned over earlier Games entry
    const detachedPinned: Bookmark = {
        title: 'Wplace',
        url: 'https://wplace.live',
        section: 'Pinned',
    };
    assert.equal(findMatchingBookmarkIndex([gamesWplace, pinnedWplaceA], detachedPinned), 1);

    // Saving via detached Pinned reference updates Pinned entry and leaves Games entry intact
    const detachedSave = applyBookmarkSave(
        [gamesWplace, { title: 'Wplace', url: 'https://wplace.live/', section: 'Pinned' }],
        {
            title: 'Wplace',
            url: 'https://wplace.live/',
            section: 'Pinned',
            alias: 'aa',
            searchUrl: 'https://wplace.live/search?q=%s',
        },
        detachedPinned,
    );
    assert.equal(detachedSave.ok, true);
    if (detachedSave.ok) {
        assert.equal(detachedSave.bookmarks[0], gamesWplace);
        assert.equal(detachedSave.bookmarks[0].alias, undefined);
        assert.equal(detachedSave.bookmarks[1].section, 'Pinned');
        assert.equal(detachedSave.bookmarks[1].alias, 'aa');
    }

    // External title edit in same section still prefers matching section over another section's old title
    const renamedInPinned: Bookmark = {
        title: 'Wplace Live',
        url: 'https://wplace.live/',
        section: 'Pinned',
    };
    assert.equal(
        findMatchingBookmark([gamesWplace, renamedInPinned], detachedPinned),
        renamedInPinned,
    );

    // External move of uniquely-titled bookmark still prefers matching title over unrelated copy
    const movedDistinctTitle: Bookmark = {
        title: 'Wplace Official',
        url: 'https://wplace.live/',
        section: 'Favorites',
    };
    assert.equal(
        findMatchingBookmark(
            [gamesWplace, movedDistinctTitle],
            { title: 'Wplace Official', url: 'https://wplace.live/', section: 'Pinned' },
        ),
        movedDistinctTitle,
    );
});
