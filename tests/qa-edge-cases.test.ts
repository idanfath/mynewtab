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
} from '../src/lib.ts';
import {
  formatBookmarkShortcutBadges,
  getBookmarkShortcuts,
  parseBookmarks,
  searchBookmarks,
  type Bookmark,
} from '../src/bookmarks.ts';
import {
  applyBookmarkMerge,
  areBookmarksEqual,
  computeBookmarksHash,
  deduplicateBookmarks,
} from '../src/bookmarkMerge.ts';
import {
  findBookmarkLine,
  findShortcutLine,
  formatBookmarkError,
} from '../src/formatBookmarkError.ts';
import {
  DEFAULT_OMNIBAR_SETTINGS,
  buildWebSearchUrl,
  collectBookmarkBangEntries,
  detectDirectUrl,
  getActiveSearchEngine,
  parseOmnibarSettings,
  resolveOmnibar,
  resolvePreservedCustomBangHomeUrl,
  resolveTabCompletion,
  type OmnibarSettings,
} from '../src/omnibar.ts';
import { SNAPSHOTS_KEY, loadSnapshots } from '../src/snapshotVault.ts';
import { evaluateExternalBookmarkChange } from '../src/storageSync.ts';

test('searchUrl templates preserve literal %20/%25, hash routes, multiple %s, IPv6, and sentinel collisions', () => {
  // Literal %25 and %20 in template must remain intact after normalization + substitution
  assert.equal(
    normalizeSearchUrl('https://example.com/search?type=100%25&filter=a%20b&q=%s'),
    'https://example.com/search?type=100%25&filter=a%20b&q=%s',
  );
  assert.equal(
    buildSearchUrl(
      'https://example.com/search?type=100%25&filter=a%20b&q=%s',
      '50% off & more',
    ),
    'https://example.com/search?type=100%25&filter=a%20b&q=50%25%20off%20%26%20more',
  );

  // Hash-routed search template with query params and multiple %s placeholders
  assert.equal(
    normalizeSearchUrl('https://app.example/#/search?q=%s&raw=%s'),
    'https://app.example/#/search?q=%s&raw=%s',
  );
  assert.equal(
    buildSearchUrl('https://app.example/#/search?q=%s&raw=%s', '$& $$ $1'),
    'https://app.example/#/search?q=%24%26%20%24%24%20%241&raw=%24%26%20%24%24%20%241',
  );

  // Literal %25s (escaped percent before s) without %s is rejected; alongside %s is preserved
  assert.equal(normalizeSearchUrl('https://example.com/search?q=%25s'), '');
  assert.equal(
    buildSearchUrl('https://example.com/search?q=%s&lit=%25s', 'ok'),
    'https://example.com/search?q=ok&lit=%25s',
  );

  // Sentinel collisions in host, path, and query
  assert.equal(
    normalizeSearchUrl('https://omnibarsentinel0.com/omnibarsentinel?q=%s&ref=omnibarsentinel'),
    'https://omnibarsentinel0.com/omnibarsentinel?q=%s&ref=omnibarsentinel',
  );

  // IPv6 search templates (local defaults to http, public defaults to https)
  assert.equal(
    normalizeSearchUrl('[::1]:8080/search?q=%s'),
    'http://[::1]:8080/search?q=%s',
  );
  assert.equal(
    normalizeSearchUrl('[2001:db8::1]:8080/search?q=%s'),
    'https://[2001:db8::1]:8080/search?q=%s',
  );
  assert.equal(
    buildSearchUrl('[::1]:8080/search?q=%s', 'health check'),
    'http://[::1]:8080/search?q=health%20check',
  );

  // Punycode and IDN search templates
  assert.equal(
    normalizeSearchUrl('https://bücher.de/search?q=%s'),
    'https://xn--bcher-kva.de/search?q=%s',
  );
  assert.equal(
    buildSearchUrl('https://xn--bcher-kva.de/search?q=%s', 'Über'),
    'https://xn--bcher-kva.de/search?q=%C3%9Cber',
  );
});

test('handles Unicode, emoji, RTL, CJK, and very long queries across search, encoding, and omnibar', () => {
  const unicodeBookmarks = parseBookmarks(JSON.stringify([
    {
      title: '🚀 日本語ドキュメント & العربية',
      url: 'https://docs.example.jp/guide',
      section: 'Docs',
      alias: 'jp-docs',
      searchUrl: 'https://docs.example.jp/search?q=%s',
    },
    {
      title: 'RTL News مرحبا',
      url: 'https://news.example.com/',
      section: 'Reading',
    },
  ]));

  assert.deepEqual(
    searchBookmarks(unicodeBookmarks, '日本語').map((b) => b.title),
    ['🚀 日本語ドキュメント & العربية'],
  );
  assert.deepEqual(
    searchBookmarks(unicodeBookmarks, 'مرحبا').map((b) => b.title),
    ['RTL News مرحبا'],
  );

  const cjkBang = resolveOmnibar(
    '!jp-docs 東京 🚀 مرحبا',
    unicodeBookmarks,
    DEFAULT_OMNIBAR_SETTINGS,
    [],
  );
  assert.equal(cjkBang?.kind, 'bang-search');
  assert.equal(
    cjkBang?.url,
    `https://docs.example.jp/search?q=${encodeSearchQuery('東京 🚀 مرحبا')}`,
  );

  const longQuery = 'rust '.repeat(500).trim();
  const longAction = resolveOmnibar(
    longQuery,
    unicodeBookmarks,
    DEFAULT_OMNIBAR_SETTINGS,
    [],
  );
  assert.equal(longAction?.kind, 'web-search');
  assert.ok(longAction?.url.startsWith('https://duckduckgo.com/?q='));
  assert.ok(longAction!.url.length > 2000);
});

test('handles IPv6, punycode IDN, private IP ranges, and control characters safely', () => {
  assert.equal(normalizeUrl('[::1]'), 'http://[::1]/');
  assert.equal(normalizeUrl('[2001:db8::1]:8080'), 'https://[2001:db8::1]:8080/');
  assert.equal(detectDirectUrl('[::1]'), 'http://[::1]/');
  assert.equal(detectDirectUrl('[2001:db8::1]:8080'), 'https://[2001:db8::1]:8080/');
  assert.equal(detectDirectUrl('xn--bcher-kva.de'), 'https://xn--bcher-kva.de/');
  assert.equal(detectDirectUrl('https://bücher.de/path'), 'https://xn--bcher-kva.de/path');
  assert.equal(getFaviconUrl('https://xn--bcher-kva.de/'), 'https://www.google.com/s2/favicons?domain=xn--bcher-kva.de&sz=64');
  assert.equal(getFaviconUrl('https://[2001:db8::1]/'), '');

  // RFC1918 & link-local boundaries
  assert.equal(isLocalOrPrivateHost('169.254.169.254'), true);
  assert.equal(isLocalOrPrivateHost('172.15.255.255'), false);
  assert.equal(isLocalOrPrivateHost('172.16.0.0'), true);
  assert.equal(isLocalOrPrivateHost('172.31.255.255'), true);
  assert.equal(isLocalOrPrivateHost('172.32.0.0'), false);
  assert.equal(isLocalOrPrivateHost('[fc00::1]'), true);
  assert.equal(isLocalOrPrivateHost('[fe80::abcd]'), true);
  assert.equal(isPublicSearchableHost('169.254.169.254'), false);
  assert.equal(isPublicSearchableHost('2001:db8::1'), false);

  // Port boundaries and obfuscated schemes
  assert.equal(normalizeUrl('example.com:65535'), 'https://example.com:65535/');
  assert.equal(normalizeUrl('example.com:65536'), '');
  assert.equal(normalizeUrl('java\tscript:alert(1)'), '');
  assert.equal(detectDirectUrl('http://0177.0.0.1'), '');
  assert.equal(detectDirectUrl('http://0x7f.0.0.1'), '');
  assert.equal(detectDirectUrl('http://2130706433'), '');
  assert.equal(detectDirectUrl('https://example.com:'), '');
  assert.equal(safeHostname('https://github.com./'), 'github.com.');
});

test('round-trips complex bookmarks.json and locates errors with escaped keys, nested arrays, and CRLF', () => {
  const input: Bookmark[] = [
    {
      title: 'GitHub (Work)',
      url: 'https://github.com/org?b=2&a=1#repos',
      section: 'Development',
      alias: '!GH-WORK',
      searchUrl: 'https://github.com/search?type=code&q=%s&pct=100%25',
      subsection: 'Code',
      description: 'Line 1\nLine 2',
      iconUrl: 'https://github.com/favicon.ico',
      categories: ['Code', 'Git'],
      capabilities: ['Search'],
      pros: ['Fast'],
      cons: [],
      formats: ['Web'],
      tier: 'S-Tier',
      product: 'GitHub',
    },
    {
      title: 'Local IPv6',
      url: '[::1]:8080/app',
      section: 'Infra',
      alias: 'v6',
      searchUrl: '[::1]:8080/q?s=%s',
    },
  ];

  const firstPass = parseBookmarks(JSON.stringify(input));
  const secondPass = parseBookmarks(JSON.stringify(firstPass, null, 2));
  assert.deepEqual(secondPass, firstPass);
  assert.deepEqual(firstPass[0].shortcuts, [
    { alias: 'gh-work', queryUrl: 'https://github.com/search?type=code&q=%s&pct=100%25' },
  ]);
  assert.deepEqual(firstPass[1].shortcuts, [
    { alias: 'v6', queryUrl: 'http://[::1]:8080/q?s=%s' },
  ]);

  // CRLF, escaped key name (\u0061lias), nested array before error field, parentheses in title
  const crlfDup = [
    '[',
    '  {',
    '    "title": "GitHub (Work)",',
    '    "categories": ["a", "b"],',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "\\u0061lias": "gh"',
    '  },',
    '  {',
    '    "title": "Mirror",',
    '    "url": "https://mirror.example/",',
    '    "section": "Dev",',
    '    "alias": "!GH"',
    '  }',
    ']',
  ].join('\r\n');

  assert.equal(findBookmarkLine(crlfDup, 1, 'alias'), 7);
  assert.equal(findBookmarkLine(crlfDup, 2, 'alias'), 13);

  let dupErr: unknown;
  try {
    parseBookmarks(crlfDup);
  } catch (err) {
    dupErr = err;
  }
  assert.equal(
    formatBookmarkError(dupErr, crlfDup, 'Couldn’t save changes').detail,
    'Bookmark 2 (line 13): “alias” duplicates “!gh” already used by Bookmark 1 (“GitHub (Work)”, line 7).',
  );

  // Missing required field falls back to bookmark object start line
  const missingField = '[\n  {\n    "title": "No URL",\n    "section": "Work"\n  }\n]';
  assert.equal(findBookmarkLine(missingField, 1, 'url'), 2);
});

test('parseOmnibarSettings and getActiveSearchEngine handle invalid shapes and fallback safely', () => {
  assert.throws(() => parseOmnibarSettings('[]'), /JSON object/);
  assert.throws(() => parseOmnibarSettings('null'), /JSON object/);
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({ version: 2, defaultEngine: 'google' })),
    /Unsupported omnibar settings version/,
  );
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({
      version: 1,
      defaultEngine: 'google',
      customSearchUrl: 'not-a-valid-template',
    })),
    /customSearchUrl must be a valid HTTP\(S\) search URL/,
  );
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({
      version: 1,
      defaultEngine: 'google',
      customBangs: [{ trigger: 'docs', label: 'Docs', searchUrl: 'https://docs.example/?q=%s', homeUrl: 'javascript:alert(1)' }],
    })),
    /homeUrl must be a valid HTTP\(S\) URL/,
  );

  // Programmatic invalid custom engine safely falls back to DuckDuckGo
  const brokenCustom: OmnibarSettings = {
    version: 1,
    defaultEngine: 'custom',
    customSearchUrl: 'not-valid',
    customBangs: [],
  };
  assert.equal(getActiveSearchEngine(brokenCustom).id, 'duckduckgo');
  assert.equal(
    buildWebSearchUrl('hello', brokenCustom),
    'https://duckduckgo.com/?q=hello',
  );

  // resolvePreservedCustomBangHomeUrl drops invalid or cross-origin stale homeUrl
  assert.equal(
    resolvePreservedCustomBangHomeUrl('javascript:alert(1)', 'https://a.example/?q=%s', 'https://a.example/?q=%s'),
    undefined,
  );
  assert.equal(
    resolvePreservedCustomBangHomeUrl('https://a.example/home', undefined, 'https://a.example/find?q=%s'),
    'https://a.example/home',
  );

  // resolveTabCompletion ignores whitespace-only query and already-completed query
  assert.equal(resolveTabCompletion('!gh ', null, {
    kind: 'bang-jump',
    url: 'https://github.com/',
    title: 'Open GitHub',
    subtitle: '',
    badge: '!gh',
    autoSelect: true,
    tabCompletion: '!gh ',
  }), null);
  assert.equal(normalizeAlias('!A-1'), 'a-1');
});

test('bare "! " and "! query" never render double-bang "!!" in subtitle, and "!alias " matches "alias " jump URL', () => {
  const action = resolveOmnibar('! ', [], DEFAULT_OMNIBAR_SETTINGS, []);
  assert.ok(action !== null);
  assert.ok(
    !action.subtitle.includes('!!'),
    `unexpected double bang in subtitle: ${action.subtitle}`,
  );
  const queryNoToken = resolveOmnibar('! react', [], DEFAULT_OMNIBAR_SETTINGS, []);
  assert.ok(queryNoToken !== null);
  assert.ok(!queryNoToken.subtitle.includes('!!'));

  // Jump-only bookmark + customBang sharing trigger resolve identical ready-state jumpUrl & title
  const sharedBookmarks: Bookmark[] = [
    { title: 'Docs Home', url: 'https://docs.example/', section: 'Work', alias: 'docs' },
  ];
  const sharedSettings: OmnibarSettings = {
    version: 1,
    defaultEngine: 'duckduckgo',
    customBangs: [
      {
        trigger: 'docs',
        label: 'Custom Docs Search',
        homeUrl: 'https://home.docs.example/',
        searchUrl: 'https://custom.docs.example/?q=%s',
      },
    ],
  };
  const bangSpace = resolveOmnibar('!docs ', sharedBookmarks, sharedSettings, []);
  const bareSpace = resolveOmnibar('docs ', sharedBookmarks, sharedSettings, []);
  assert.equal(bangSpace?.url, 'https://docs.example/');
  assert.equal(bareSpace?.url, 'https://docs.example/');
  assert.equal(bangSpace?.title, 'Search Custom Docs Search…');
  assert.equal(bareSpace?.title, 'Search Custom Docs Search…');
});

test('trailing-dot FQDNs with ports and bare trailing-dot domains normalize and detect consistently', () => {
  // Trailing-dot host with port should match bare trailing-dot host behavior
  assert.equal(isBareHostWithPort('github.com.:8443'), true);
  assert.equal(isBareHostWithPort('localhost.:3000'), true);
  assert.equal(normalizeUrl('github.com.:8443'), 'https://github.com.:8443/');
  assert.equal(normalizeUrl('localhost.:3000'), 'http://localhost.:3000/');
  assert.equal(normalizeUrl('nas.local.:8080'), 'http://nas.local.:8080/');
  assert.equal(
    normalizeSearchUrl('github.com.:8443/search?q=%s'),
    'https://github.com.:8443/search?q=%s',
  );

  // Bare trailing-dot domains should match explicit-scheme trailing-dot behavior
  assert.equal(detectDirectUrl('https://github.com.'), 'https://github.com./');
  assert.equal(detectDirectUrl('github.com.'), 'https://github.com./');
  assert.equal(detectDirectUrl('nas.local.'), 'http://nas.local./');
  assert.equal(detectDirectUrl('localhost.'), 'http://localhost./');
  assert.equal(detectDirectUrl('README.md.'), '');
  assert.equal(detectDirectUrl('github.com..'), '');
});

test('embedded ASCII control chars do not bypass scheme checks or emit mangled URLs', () => {
  assert.equal(normalizeUrl('http\t://example.com'), '');
  assert.equal(normalizeUrl('java\tscript://alert(1)'), '');
  assert.equal(normalizeUrl('file\n:///etc/passwd'), '');
  assert.equal(normalizeSearchUrl('http\t://example.com/search?q=%s'), '');
});

test('multi-shortcut badges and unnormalized fixtures handle 0/1/2/3/5 shortcuts and legacy mixes', () => {
  const make = (shortcuts?: Bookmark['shortcuts'], alias?: string, searchUrl?: string): Bookmark => ({
    title: 'Sample',
    url: 'https://sample.example/',
    section: 'Dev',
    ...(shortcuts !== undefined ? { shortcuts } : {}),
    ...(alias !== undefined ? { alias } : {}),
    ...(searchUrl !== undefined ? { searchUrl } : {}),
  });

  assert.deepEqual(formatBookmarkShortcutBadges(make()), { visible: [], overflowCount: 0 });
  assert.deepEqual(formatBookmarkShortcutBadges(make([])), { visible: [], overflowCount: 0 });
  assert.deepEqual(formatBookmarkShortcutBadges(make([{ alias: 'one' }])), {
    visible: ['one'],
    overflowCount: 0,
  });
  assert.deepEqual(
    formatBookmarkShortcutBadges(make([{ alias: 'one' }, { alias: 'two' }])),
    { visible: ['one', 'two'], overflowCount: 0 },
  );
  assert.deepEqual(
    formatBookmarkShortcutBadges(make([{ alias: 's1' }, { alias: 's2' }, { alias: 's3' }])),
    { visible: ['s1', 's2'], overflowCount: 1 },
  );
  assert.deepEqual(
    formatBookmarkShortcutBadges(
      make([{ alias: 's1' }, { alias: 's2' }, { alias: 's3' }, { alias: 's4' }, { alias: 's5' }]),
    ),
    { visible: ['s1', 's2'], overflowCount: 3 },
  );

  // Unnormalized in-memory fixture mixing shortcuts[], legacy alias/searchUrl, duplicates, and invalid entries
  const mixed = {
    title: 'Mixed',
    url: 'https://mixed.example/',
    section: 'Dev',
    shortcuts: [
      { alias: '!GH', queryUrl: 'github.com/search?q=%s' },
      { alias: 'gh', queryUrl: 'https://ignored-dup.example/?q=%s' },
      { alias: 'bad alias!', queryUrl: 'https://bad.example/?q=%s' },
      { alias: 'ghr', queryUrl: 'not-a-valid-template' },
      { alias: 'ghi', searchUrl: 'github.com/issues?q=%s' },
    ],
    alias: '!GH-LEGACY',
    searchUrl: 'github.com/pulls?q=%s',
  } as unknown as Bookmark;

  assert.deepEqual(getBookmarkShortcuts(mixed), [
    { alias: 'gh', queryUrl: 'https://github.com/search?q=%s' },
    { alias: 'ghr' },
    { alias: 'ghi', queryUrl: 'https://github.com/issues?q=%s' },
    { alias: 'gh-legacy', queryUrl: 'https://github.com/pulls?q=%s' },
  ]);
  assert.deepEqual(formatBookmarkShortcutBadges(mixed), {
    visible: ['gh', 'ghr'],
    overflowCount: 2,
  });

  // Duplicate legacy alias already in shortcuts[] does not inflate badge count
  const dupLegacy = make([{ alias: 'gh' }, { alias: 'ghr' }], '!GH', 'github.com/search?q=%s');
  assert.deepEqual(formatBookmarkShortcutBadges(dupLegacy), {
    visible: ['gh', 'ghr'],
    overflowCount: 0,
  });
});

test('multi-shortcut query substitution handles Unicode/CJK/RTL, %25/%20, multiple %s, hash routes, and JS replace tokens', () => {
  const bookmarks = parseBookmarks(JSON.stringify([
    {
      title: 'Prompt Hub',
      url: 'https://chat.example/',
      section: 'AI',
      shortcuts: [
        { alias: 'chat' },
        {
          alias: 'prompt',
          queryUrl: 'https://chat.example/#/prompt?q=%s&echo=%s&pct=100%25&sp=a%20b',
        },
        {
          alias: 'pathq',
          queryUrl: 'https://chat.example/find/%s/details',
        },
      ],
    },
  ]));

  const trickyQuery = "🚀 日本語 مرحبا $& $' $` $$";
  const expectedEncoded = encodeSearchQuery(trickyQuery);
  assert.ok(!expectedEncoded.includes('$'));

  const hashRes = resolveOmnibar(`!prompt ${trickyQuery}`, bookmarks, DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(hashRes?.kind, 'bang-search');
  assert.equal(
    hashRes?.url,
    `https://chat.example/#/prompt?q=${expectedEncoded}&echo=${expectedEncoded}&pct=100%25&sp=a%20b`,
  );

  // Bare Level 2 prefix also works on 2nd shortcut with JS replace tokens
  const bareRes = resolveOmnibar("prompt $& $' $` $$", bookmarks, DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(bareRes?.kind, 'bang-search');
  const encodedDollars = encodeSearchQuery("$& $' $` $$");
  assert.equal(
    bareRes?.url,
    `https://chat.example/#/prompt?q=${encodedDollars}&echo=${encodedDollars}&pct=100%25&sp=a%20b`,
  );

  // Lone UTF-16 surrogates and dot-segment path queries remain safe
  assert.equal(encodeSearchQuery('\uD800ok\uDC00'), '%EF%BF%BDok%EF%BF%BD');
  const dotRes = resolveOmnibar('!pathq ..', bookmarks, DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(dotRes?.url, 'https://chat.example/find/%2E%2E/details');
});

test('3-tier !bang precedence, split jump/custom behavior, disabled built-in notes, and Level 4 3rd-shortcut rescue', () => {
  const bookmarks = parseBookmarks(JSON.stringify([
    {
      title: 'My AI Workspace',
      url: 'https://ai.example/',
      section: 'AI',
      shortcuts: [
        { alias: 'ai' },
        { alias: 'ppx', queryUrl: 'https://ai.example/ask?q=%s' },
        { alias: 'third-q', queryUrl: 'https://ai.example/third?q=%s' },
      ],
    },
    {
      title: 'Internal Docs',
      url: 'https://docs.example/',
      section: 'Work',
      shortcuts: [
        { alias: 'docs' },
        { alias: 'gh' },
        { alias: 'third-jump' },
      ],
    },
  ]));

  const settings: OmnibarSettings = {
    version: 1,
    defaultEngine: 'duckduckgo',
    disabledBuiltInBangs: ['gh'],
    customBangs: [
      {
        trigger: 'ppx',
        label: 'Custom Perplexity',
        searchUrl: 'https://custom-ppx.example/?q=%s',
      },
      {
        trigger: 'docs',
        label: 'Company Docs Search',
        homeUrl: 'https://custom-docs.example/home',
        searchUrl: 'https://custom-docs.example/find?q=%s',
      },
    ],
  };

  // Level 1A: bare '!' lists bookmark shortcuts first
  const bareBang = resolveOmnibar('!', bookmarks, settings, []);
  assert.equal(bareBang?.kind, 'bang-incomplete');
  assert.equal(bareBang?.tabCompletion, '!ai ');

  // 2nd shortcut (!ppx) with queryUrl overrides BOTH custom !ppx and built-in !ppx
  const ppxJump = resolveOmnibar('!ppx', bookmarks, settings, []);
  assert.equal(ppxJump?.kind, 'bang-jump');
  assert.equal(ppxJump?.url, 'https://ai.example/');
  assert.equal(ppxJump?.tabCompletion, '!ppx ');

  const ppxReady = resolveOmnibar('!ppx ', bookmarks, settings, []);
  assert.equal(ppxReady?.kind, 'bang-jump');
  assert.equal(ppxReady?.title, 'Search My AI Workspace…');
  assert.equal(ppxReady?.url, 'https://ai.example/');

  const ppxSearch = resolveOmnibar('!ppx rust', bookmarks, settings, []);
  assert.equal(ppxSearch?.kind, 'bang-search');
  assert.equal(ppxSearch?.url, 'https://ai.example/ask?q=rust');

  const ppxBareLevel2 = resolveOmnibar('ppx rust', bookmarks, settings, []);
  assert.equal(ppxBareLevel2?.kind, 'bang-search');
  assert.equal(ppxBareLevel2?.url, 'https://ai.example/ask?q=rust');

  // Jump-only bookmark (!docs) + active custom !docs: split jump vs search behavior
  const docsBare = resolveOmnibar('!docs', bookmarks, settings, []);
  assert.equal(docsBare?.kind, 'bang-jump');
  assert.equal(docsBare?.url, 'https://docs.example/');
  assert.equal(docsBare?.title, 'Open Internal Docs');
  assert.equal(docsBare?.tabCompletion, '!docs ');

  const docsTrailing = resolveOmnibar('!docs ', bookmarks, settings, []);
  assert.equal(docsTrailing?.kind, 'bang-jump');
  assert.equal(docsTrailing?.title, 'Search Company Docs Search…');
  assert.equal(docsTrailing?.url, 'https://docs.example/');

  const docsSearch = resolveOmnibar('!docs api', bookmarks, settings, []);
  assert.equal(docsSearch?.kind, 'bang-search');
  assert.equal(docsSearch?.title, 'Search Company Docs Search for “api”');
  assert.equal(docsSearch?.url, 'https://custom-docs.example/find?q=api');

  // Level 5 fallback when bookmark is in current section with jump-only !docs + custom !docs
  const level5Docs = resolveOmnibar('docs', bookmarks, settings, [bookmarks[1]]);
  assert.equal(level5Docs?.kind, 'web-search');
  assert.equal(level5Docs?.tabCompletion, '!docs ');
  assert.equal(
    resolveTabCompletion('docs', { kind: 'bookmark', bookmark: bookmarks[1] }, level5Docs),
    '!docs ',
  );

  // Disabled built-in !gh + bookmark !gh -> collectBookmarkBangEntries does NOT falsely claim override
  const directory = collectBookmarkBangEntries(
    bookmarks,
    new Set(['!PPX', 'docs']),
    new Set(['!GH']),
  );
  const aiEntry = directory.find((entry) => entry.bookmark.title === 'My AI Workspace');
  const docsEntry = directory.find((entry) => entry.bookmark.title === 'Internal Docs');
  assert.equal(
    aiEntry?.shortcuts.find((sc) => sc.alias === 'ppx')?.overrideNote,
    'Overrides custom !bang',
  );
  assert.equal(
    docsEntry?.shortcuts.find((sc) => sc.alias === 'docs')?.overrideNote,
    'Bare !docs opens bookmark · !docs <query> uses custom !bang',
  );
  assert.equal(
    docsEntry?.shortcuts.find((sc) => sc.alias === 'gh')?.overrideNote,
    undefined,
  );

  // Without disabling !gh, built-in override note IS reported
  const directoryWithGhEnabled = collectBookmarkBangEntries(
    bookmarks,
    new Set(['ppx', 'docs']),
    new Set(),
  );
  assert.equal(
    directoryWithGhEnabled
      .find((entry) => entry.bookmark.title === 'Internal Docs')
      ?.shortcuts.find((sc) => sc.alias === 'gh')?.overrideNote,
    'Overrides built-in !bang',
  );

  // Level 4 cross-section rescue on 3rd shortcut: with queryUrl vs without queryUrl
  const rescueWithQuery = resolveOmnibar('third-q', bookmarks, settings, []);
  assert.equal(rescueWithQuery?.kind, 'bookmark-alias');
  assert.equal(rescueWithQuery?.badge, '!third-q');
  assert.equal(rescueWithQuery?.tabCompletion, '!third-q ');
  assert.equal(
    resolveTabCompletion('third-q', { kind: 'omnibar', action: rescueWithQuery! }, rescueWithQuery),
    '!third-q ',
  );

  const rescueJumpOnly = resolveOmnibar('third-jump', bookmarks, settings, []);
  assert.equal(rescueJumpOnly?.kind, 'bookmark-alias');
  assert.equal(rescueJumpOnly?.badge, '!third-jump');
  assert.equal(rescueJumpOnly?.tabCompletion, undefined);
  assert.equal(
    resolveTabCompletion('third-jump', { kind: 'omnibar', action: rescueJumpOnly! }, rescueJumpOnly),
    null,
  );
});

test('legacy migration hash invariance, 3-shortcut merge/dedup collision resolution, and vault/sync rejection', () => {
  const legacyBookmark: Bookmark = {
    title: 'GitHub',
    url: 'https://github.com/',
    section: 'Dev',
    alias: '!GH',
    searchUrl: 'github.com/search?q=%s',
  };
  const canonicalBookmark: Bookmark = {
    title: 'GitHub',
    url: 'https://github.com/',
    section: 'Dev',
    shortcuts: [{ alias: 'gh', queryUrl: 'https://github.com/search?q=%s' }],
  };

  assert.equal(areBookmarksEqual(legacyBookmark, canonicalBookmark), true);
  assert.equal(
    computeBookmarksHash([legacyBookmark]),
    computeBookmarksHash([canonicalBookmark]),
  );

  // 3-shortcut incoming: #1 collides with Other, #2 enriches matched jump-only, #3 is brand new
  const existing: Bookmark[] = [
    { title: 'Other', url: 'https://other.example/', section: 'Dev', shortcuts: [{ alias: 'taken' }] },
    { title: 'Docs', url: 'https://docs.example/', section: 'Dev', shortcuts: [{ alias: 'docs' }] },
  ];
  const incoming: Bookmark[] = [
    {
      title: 'Docs Updated',
      url: 'https://docs.example/',
      section: 'Dev',
      shortcuts: [
        { alias: 'taken', queryUrl: 'https://taken.example/?q=%s' },
        { alias: 'docs', queryUrl: 'https://docs.example/search?q=%s' },
        { alias: 'docs-api', queryUrl: 'https://docs.example/api?q=%s' },
      ],
    },
  ];

  const merged = applyBookmarkMerge(existing, incoming, 'merge');
  assert.deepEqual(merged[0].shortcuts, [{ alias: 'taken' }]);
  assert.deepEqual(merged[1].shortcuts, [
    { alias: 'docs', queryUrl: 'https://docs.example/search?q=%s' },
    { alias: 'docs-api', queryUrl: 'https://docs.example/api?q=%s' },
  ]);
  assert.doesNotThrow(() => parseBookmarks(JSON.stringify(merged)));

  const appended = applyBookmarkMerge(existing, incoming, 'append');
  assert.deepEqual(appended, existing);

  const replaced = applyBookmarkMerge(existing, incoming, 'replace');
  assert.equal(replaced.length, 1);
  assert.deepEqual(replaced[0].shortcuts, [
    { alias: 'taken', queryUrl: 'https://taken.example/?q=%s' },
    { alias: 'docs', queryUrl: 'https://docs.example/search?q=%s' },
    { alias: 'docs-api', queryUrl: 'https://docs.example/api?q=%s' },
  ]);
  assert.doesNotThrow(() => parseBookmarks(JSON.stringify(replaced)));

  const deduped = deduplicateBookmarks([...existing, ...incoming]);
  assert.equal(deduped.duplicateCount, 1);
  assert.deepEqual(deduped.bookmarks[1].shortcuts, [
    { alias: 'docs', queryUrl: 'https://docs.example/search?q=%s' },
    { alias: 'docs-api', queryUrl: 'https://docs.example/api?q=%s' },
  ]);
  assert.doesNotThrow(() => parseBookmarks(JSON.stringify(deduped.bookmarks)));

  // Vault: rejects intra-bookmark & cross-bookmark collisions across shortcuts[] + legacy alias, migrates valid legacy
  const vaultMap = new Map<string, string>();
  vaultMap.set(
    SNAPSHOTS_KEY,
    JSON.stringify({
      version: 1,
      snapshots: [
        {
          id: 'bad-intra',
          createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Intra collision',
          trigger: 'manual',
          bookmarks: [
            {
              title: 'GitHub',
              url: 'https://github.com/',
              section: 'Dev',
              shortcuts: [{ alias: 'gh' }],
              alias: '!GH',
            },
          ],
        },
        {
          id: 'bad-cross',
          createdAt: '2026-01-01T00:01:00.000Z',
          label: 'Cross collision',
          trigger: 'manual',
          bookmarks: [
            {
              title: 'GitHub',
              url: 'https://github.com/',
              section: 'Dev',
              shortcuts: [{ alias: 'gh' }, { alias: 'ghr' }],
            },
            {
              title: 'Mirror',
              url: 'https://mirror.example/',
              section: 'Dev',
              alias: '!GHR',
            },
          ],
        },
        {
          id: 'good-legacy',
          createdAt: '2026-01-01T00:02:00.000Z',
          label: 'Valid legacy',
          trigger: 'manual',
          bookmarks: [legacyBookmark],
        },
      ],
    }),
  );

  const loadedSnapshots = loadSnapshots({ getItem: (key: string) => vaultMap.get(key) ?? null });
  assert.equal(loadedSnapshots.length, 1);
  assert.equal(loadedSnapshots[0].id, 'good-legacy');
  assert.deepEqual(loadedSnapshots[0].bookmarks[0].shortcuts, [
    { alias: 'gh', queryUrl: 'https://github.com/search?q=%s' },
  ]);
  assert.equal(loadedSnapshots[0].bookmarks[0].alias, undefined);
  assert.equal(loadedSnapshots[0].bookmarks[0].searchUrl, undefined);
  assert.equal(loadedSnapshots[0].hash, computeBookmarksHash([canonicalBookmark]));

  // Cross-tab sync: rejects intra/cross collisions, treats equivalent legacy as noop, migrates differing legacy
  const syncIntra = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([
      { title: 'A', url: 'https://a.example/', section: 'Dev', shortcuts: [{ alias: 'a' }], alias: '!A' },
    ]),
    currentBookmarks: [canonicalBookmark],
    currentSection: 'All',
    currentActiveBookmark: null,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.equal(syncIntra.kind, 'invalid-external');

  const syncCross = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([
      { title: 'A', url: 'https://a.example/', section: 'Dev', shortcuts: [{ alias: 'a' }, { alias: 'b' }] },
      { title: 'B', url: 'https://b.example/', section: 'Dev', alias: '!B' },
    ]),
    currentBookmarks: [canonicalBookmark],
    currentSection: 'All',
    currentActiveBookmark: null,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.equal(syncCross.kind, 'invalid-external');

  const syncEquivalentLegacy = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([legacyBookmark]),
    currentBookmarks: [canonicalBookmark],
    currentSection: 'All',
    currentActiveBookmark: null,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.equal(syncEquivalentLegacy.kind, 'noop');

  const syncNewLegacy = evaluateExternalBookmarkChange({
    rawNewValue: JSON.stringify([legacyBookmark]),
    currentBookmarks: [],
    currentSection: 'All',
    currentActiveBookmark: null,
    isEditModalOpen: false,
    modalBaseHash: null,
    modalBaseBookmarks: null,
  });
  assert.equal(syncNewLegacy.kind, 'background-sync');
  if (syncNewLegacy.kind === 'background-sync') {
    assert.deepEqual(syncNewLegacy.bookmarks[0].shortcuts, [
      { alias: 'gh', queryUrl: 'https://github.com/search?q=%s' },
    ]);
    assert.equal(syncNewLegacy.bookmarks[0].alias, undefined);
    assert.equal(syncNewLegacy.bookmarks[0].searchUrl, undefined);
  }
});

test('findShortcutLine ignores decoy "shortcuts": [...] strings with escaped quotes and backslashes', () => {
  const decoyJson = [
    '[',
    '  {',
    '    "title": "shortcuts",',
    '    "url": "https://decoy.example/",',
    '    "section": "Dev",',
    '    "description": " Fake \\"shortcuts\\": [ { \\"alias\\": \\"x\\" } ] ends with \\\\",',
    '    "shortcuts":',
    '    [',
    '      {',
    '        "queryUrl": "https://decoy.example/?q=%s&fake=\\"alias\\"",',
    '        "alias": "ok"',
    '      },',
    '      {',
    '        "alias": "bad alias!"',
    '      }',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  assert.equal(findShortcutLine(decoyJson, 1, 1, 'alias'), 11);
  assert.equal(findShortcutLine(decoyJson, 1, 2, 'alias'), 14);

  let caught: unknown;
  try {
    parseBookmarks(decoyJson);
  } catch (err) {
    caught = err;
  }
  assert.equal(
    formatBookmarkError(caught, decoyJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 14): shortcut 2 “alias” must be 1-32 lowercase letters, numbers, or hyphens.',
  );
});
