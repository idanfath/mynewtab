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
  parseBookmarks,
  searchBookmarks,
  type Bookmark,
} from '../src/bookmarks.ts';
import {
  findBookmarkLine,
  formatBookmarkError,
} from '../src/formatBookmarkError.ts';
import {
  DEFAULT_OMNIBAR_SETTINGS,
  buildWebSearchUrl,
  detectDirectUrl,
  getActiveSearchEngine,
  parseOmnibarSettings,
  resolveOmnibar,
  resolvePreservedCustomBangHomeUrl,
  resolveTabCompletion,
  type OmnibarSettings,
} from '../src/omnibar.ts';

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
  assert.equal(firstPass[0].alias, 'gh-work');
  assert.equal(firstPass[1].searchUrl, 'http://[::1]:8080/q?s=%s');

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
