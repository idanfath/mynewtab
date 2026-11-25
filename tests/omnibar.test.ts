import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bookmark } from '../src/bookmarks.ts';
import {
  DEFAULT_OMNIBAR_SETTINGS,
  OMNIBAR_BACKUP_KEY,
  OMNIBAR_STORAGE_KEY,
  buildWebSearchUrl,
  detectDirectUrl,
  getBookmarkOmnibarIcon,
  getOmnibarGlyph,
  loadStoredOmnibarSettings,
  parseOmnibarSettings,
  resolveOmnibar,
  resolvePreservedCustomBangHomeUrl,
  resolveTabCompletion,
  type OmnibarAction,
  type OmnibarActionKind,
  type OmnibarSettings,
} from '../src/omnibar.ts';
import {
  buildInitialOmnibarState,
  loadInitialOmnibarState,
  mergeStartupErrors,
} from '../src/useOmnibarSettings.ts';

function memoryStorage(values = new Map<string, string>()) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

const githubBookmark: Bookmark = {
  title: 'GitHub',
  url: 'https://github.com/',
  section: 'Dev',
  alias: 'gh',
  searchUrl: 'https://github.com/search?q=%s',
};

const docsBookmark: Bookmark = {
  title: 'My Docs',
  url: 'https://docs.example.com/',
  section: 'Work',
  alias: 'my-docs',
};

const lightroomBookmark: Bookmark = {
  title: 'Lightroom',
  url: 'https://lightroom.adobe.com/',
  section: 'Media',
};

const hnBookmark: Bookmark = {
  title: 'Hacker News',
  url: 'https://news.ycombinator.com/',
  section: 'Reading',
  alias: 'hn',
};

const nasBookmark: Bookmark = {
  title: 'Home NAS',
  url: 'http://nas.local/',
  section: 'Infra',
  alias: 'nas',
};

const localAppBookmark: Bookmark = {
  title: 'Local Dev',
  url: 'http://localhost:5173/',
  section: 'Infra',
  alias: 'loc',
  searchUrl: 'http://localhost:5173/search?q=%s',
};

const internalBookmark: Bookmark = {
  title: 'Internal Wiki',
  url: 'http://app.internal/',
  section: 'Infra',
  alias: 'int',
};

const lanBookmark: Bookmark = {
  title: 'Router',
  url: 'http://router.lan/',
  section: 'Infra',
  alias: 'lan',
};

const ipBookmark: Bookmark = {
  title: 'Home Server',
  url: 'http://192.168.1.5/',
  section: 'Infra',
  alias: 'srv',
};

const ipv6Bookmark: Bookmark = {
  title: 'Loopback API',
  url: 'http://[::1]:8080/',
  section: 'Infra',
  alias: 'v6',
};

const intranetBookmark: Bookmark = {
  title: 'Intranet Portal',
  url: 'http://intranet/wiki',
  section: 'Infra',
  alias: 'intra',
};

const privateWithCustomIcon: Bookmark = {
  title: 'Custom NAS',
  url: 'http://nas.local/',
  section: 'Infra',
  alias: 'cnas',
  iconUrl: 'https://cdn.example.com/nas.png',
};

test('detectDirectUrl accepts valid URLs, domains, localhost, and IPv4/IPv6 while rejecting false positives', () => {
  // True positives
  assert.equal(detectDirectUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(detectDirectUrl('http://intranet/wiki'), 'http://intranet/wiki');
  assert.equal(detectDirectUrl('http://[::1]:8080/api'), 'http://[::1]:8080/api');
  assert.equal(
    detectDirectUrl('https://[2001:db8::1]:8443/docs'),
    'https://[2001:db8::1]:8443/docs',
  );
  assert.equal(detectDirectUrl('[::1]:8080'), 'http://[::1]:8080/');
  assert.equal(detectDirectUrl('localhost'), 'http://localhost/');
  assert.equal(detectDirectUrl('localhost:5173/api'), 'http://localhost:5173/api');
  assert.equal(detectDirectUrl('api.localhost:3000'), 'http://api.localhost:3000/');
  assert.equal(detectDirectUrl('nas.local'), 'http://nas.local/');
  assert.equal(detectDirectUrl('dev.internal:8080'), 'http://dev.internal:8080/');
  assert.equal(detectDirectUrl('router.lan'), 'http://router.lan/');
  assert.equal(detectDirectUrl('127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1');
  assert.equal(detectDirectUrl('192.168.1.1'), 'http://192.168.1.1/');
  assert.equal(detectDirectUrl('1.1.1.1'), 'https://1.1.1.1/');
  assert.equal(detectDirectUrl('example.com/docs'), 'https://example.com/docs');
  assert.equal(detectDirectUrl('example.com:8080'), 'https://example.com:8080/');
  assert.equal(detectDirectUrl('react.dev'), 'https://react.dev/');
  assert.equal(detectDirectUrl('docs.rs/tokio'), 'https://docs.rs/tokio');
  assert.equal(detectDirectUrl('crates.io'), 'https://crates.io/');
  assert.equal(detectDirectUrl('bun.sh'), 'https://bun.sh/');
  assert.equal(detectDirectUrl('obsidian.md'), 'https://obsidian.md/');
  assert.equal(detectDirectUrl('README.md/'), 'https://readme.md/');

  // False positives
  const rejected = [
    'example.com docs',
    'bookmarks.json',
    'App.tsx',
    'lib.ts',
    'node.js',
    'styles.css',
    'Main.java',
    'main.go',
    'README.md',
    'PRODUCT.md',
    'main.py',
    'backup.zip',
    'video.mov',
    '1.2.3',
    '1.2.3:8080',
    'v1.2.3:8080',
    'http://1.2.3:8080',
    'https://99999',
    'http://0x7f000001',
    '3.14',
    'user@example.com',
    '//evil.com',
    '/etc/passwd',
    'javascript:alert(1)',
    'localhost:0',
    'localhost:99999',
    'http://[::1]:0/api',
    'http://[::1]:99999/api',
  ];
  for (const input of rejected) {
    assert.equal(detectDirectUrl(input), '', `expected empty for ${input}`);
  }
});

test('resolveOmnibar handles Level 1 !bang grammar, precedence, matchedBookmark, and privacy', () => {
  const settings: OmnibarSettings = {
    version: 1,
    defaultEngine: 'duckduckgo',
    customBangs: [
      {
        trigger: 'gh',
        label: 'Custom GH',
        searchUrl: 'https://custom-gh.example/search?q=%s',
      },
      {
        trigger: 'custom',
        label: 'Custom Engine',
        searchUrl: 'https://search.custom.example/?q=%s',
        homeUrl: 'https://home.custom.example/',
      },
      {
        trigger: 'docs',
        label: 'Custom Docs',
        searchUrl: 'https://custom-docs.example/find?q=%s',
      },
    ],
  };

  const bookmarks: Bookmark[] = [
    githubBookmark,
    docsBookmark,
    hnBookmark,
    nasBookmark,
    localAppBookmark,
    internalBookmark,
    lanBookmark,
    ipBookmark,
    ipv6Bookmark,
    intranetBookmark,
    privateWithCustomIcon,
  ];

  assert.equal(resolveOmnibar('   ', bookmarks, settings, []), null);

  // Level 1A: bare '!'
  const bareBang = resolveOmnibar('!', bookmarks, settings, []);
  assert.equal(bareBang?.kind, 'bang-incomplete');
  assert.equal(bareBang?.autoSelect, true);
  assert.equal(bareBang?.matchedBookmark, undefined);
  assert.equal(bareBang?.tabCompletion, '!gh ');

  // Level 1B: exact !token without space
  const ghJump = resolveOmnibar('!gh', bookmarks, settings, []);
  assert.equal(ghJump?.kind, 'bang-jump');
  assert.equal(ghJump?.url, 'https://github.com/');
  assert.equal(ghJump?.autoSelect, true);
  assert.equal(ghJump?.matchedBookmark, githubBookmark);
  assert.equal(ghJump?.tabCompletion, '!gh ');

  const customJump = resolveOmnibar('!custom', bookmarks, settings, []);
  assert.equal(customJump?.kind, 'bang-jump');
  assert.equal(customJump?.url, 'https://home.custom.example/');
  assert.equal(customJump?.matchedBookmark, undefined);

  const builtInJump = resolveOmnibar('!w', bookmarks, settings, []);
  assert.equal(builtInJump?.kind, 'bang-jump');
  assert.equal(builtInJump?.url, 'https://en.wikipedia.org/');
  assert.equal(builtInJump?.matchedBookmark, undefined);

  // Level 1B: unknown and prefix completion
  const badPunct = resolveOmnibar('!c++', bookmarks, settings, []);
  assert.equal(badPunct?.kind, 'bang-unknown');
  assert.equal(badPunct?.tabCompletion, undefined);
  assert.equal(resolveOmnibar('!@', bookmarks, settings, [])?.tabCompletion, undefined);

  const prefixMdn = resolveOmnibar('!md', bookmarks, settings, []);
  assert.equal(prefixMdn?.kind, 'bang-unknown');
  assert.equal(prefixMdn?.tabCompletion, '!mdn ');

  const prefixHyphen = resolveOmnibar('!my-', bookmarks, settings, []);
  assert.equal(prefixHyphen?.kind, 'bang-unknown');
  assert.equal(prefixHyphen?.tabCompletion, '!my-docs ');

  // Level 1C: !token with trailing space
  const readyGh = resolveOmnibar('!gh ', bookmarks, settings, []);
  assert.equal(readyGh?.kind, 'bang-jump');
  assert.equal(readyGh?.title, 'Search GitHub…');
  assert.equal(readyGh?.matchedBookmark, undefined);

  // Level 1D: !token query precedence
  // 1. Bookmark searchUrl beats CustomBang
  const bmSearch = resolveOmnibar('!gh react', bookmarks, settings, []);
  assert.equal(bmSearch?.kind, 'bang-search');
  assert.equal(bmSearch?.url, 'https://github.com/search?q=react');
  assert.equal(bmSearch?.matchedBookmark, undefined);

  // 2. CustomBang beats Bookmark without searchUrl / BuiltInBang
  const customSearch = resolveOmnibar('!docs routing', bookmarks, settings, []);
  assert.equal(customSearch?.kind, 'bang-search');
  assert.equal(customSearch?.url, 'https://custom-docs.example/find?q=routing');
  assert.equal(customSearch?.matchedBookmark, undefined);

  // 3. Bookmark without searchUrl matching BuiltInBang homeUrl (hn -> algolia)
  const hnSearch = resolveOmnibar('!hn rust', bookmarks, settings, []);
  assert.equal(hnSearch?.kind, 'bang-search');
  assert.equal(hnSearch?.url, 'https://hn.algolia.com/?q=rust');
  assert.equal(hnSearch?.matchedBookmark, undefined);

  // 3b. Bookmark without searchUrl on public DNS host -> site: query
  const publicSiteSearch = resolveOmnibar('!my-docs hooks', bookmarks, settings, []);
  assert.equal(publicSiteSearch?.kind, 'bang-search');
  assert.equal(
    publicSiteSearch?.url,
    'https://duckduckgo.com/?q=site%3Adocs.example.com%20hooks',
  );
  assert.equal(publicSiteSearch?.matchedBookmark, undefined);

  // 3c. Bookmark without searchUrl on private/local/IP/intranet host -> title + query (no site: leak)
  for (const [alias, title] of [
    ['nas', 'Home NAS'],
    ['int', 'Internal Wiki'],
    ['lan', 'Router'],
    ['srv', 'Home Server'],
    ['v6', 'Loopback API'],
    ['intra', 'Intranet Portal'],
  ] as const) {
    const res = resolveOmnibar(`!${alias} status`, bookmarks, settings, []);
    assert.equal(res?.kind, 'bang-search');
    assert.equal(
      res?.url,
      `https://duckduckgo.com/?q=${encodeURIComponent(`${title} status`)}`,
    );
    assert.ok(!res!.url.includes('site%3A'), `must not leak site: for !${alias}`);
    assert.equal(res?.iconUrl, undefined, `must not ping favicon service for !${alias}`);
  }

  // 4. BuiltInBang including !maps .. without path collapse
  const mapsDots = resolveOmnibar('!maps ..', bookmarks, settings, []);
  assert.equal(mapsDots?.kind, 'bang-search');
  assert.equal(mapsDots?.url, 'https://www.google.com/maps/search/%2E%2E');

  // 5. Unknown !bang fallback
  const unknownSearch = resolveOmnibar('!nope hello', bookmarks, settings, []);
  assert.equal(unknownSearch?.kind, 'bang-unknown');
  assert.equal(unknownSearch?.url, 'https://duckduckgo.com/?q=!nope%20hello');
});

test('getBookmarkOmnibarIcon protects private hosts and un-normalized fixtures never throw', () => {
  assert.equal(
    getBookmarkOmnibarIcon(githubBookmark),
    'https://www.google.com/s2/favicons?domain=github.com&sz=64',
  );
  assert.equal(getBookmarkOmnibarIcon(nasBookmark), undefined);
  assert.equal(getBookmarkOmnibarIcon(localAppBookmark), undefined);
  assert.equal(getBookmarkOmnibarIcon(internalBookmark), undefined);
  assert.equal(getBookmarkOmnibarIcon(lanBookmark), undefined);
  assert.equal(getBookmarkOmnibarIcon(ipBookmark), undefined);
  assert.equal(getBookmarkOmnibarIcon(ipv6Bookmark), undefined);
  assert.equal(getBookmarkOmnibarIcon(intranetBookmark), undefined);
  assert.equal(
    getBookmarkOmnibarIcon(privateWithCustomIcon),
    'https://cdn.example.com/nas.png',
  );

  // Un-normalized fixture URLs never throw across resolveOmnibar branches
  const unnormalized: Bookmark = {
    title: 'Raw Docs',
    url: 'docs.example.com',
    section: 'Work',
    alias: '!RAW',
    searchUrl: 'docs.example.com/search?q=%s',
  };
  const r1 = resolveOmnibar('!raw', [unnormalized], DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(r1?.url, 'https://docs.example.com/');
  const r2 = resolveOmnibar('!raw test', [unnormalized], DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(r2?.url, 'https://docs.example.com/search?q=test');
  const r3 = resolveOmnibar('raw test', [unnormalized], DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(r3?.url, 'https://docs.example.com/search?q=test');
  const r4 = resolveOmnibar('raw', [unnormalized], DEFAULT_OMNIBAR_SETTINGS, []);
  assert.equal(r4?.url, 'https://docs.example.com/');
});

test('resolveOmnibar handles Levels 2, 3, 4, and 5 plus buildWebSearchUrl', () => {
  const settings: OmnibarSettings = {
    version: 1,
    defaultEngine: 'duckduckgo',
    customBangs: [
      {
        trigger: 'k8s',
        label: 'Kubernetes Docs',
        searchUrl: 'https://kubernetes.io/search/?q=%s',
      },
    ],
  };
  const bookmarks = [githubBookmark, docsBookmark, lightroomBookmark, localAppBookmark];

  // Level 2: bare alias prefix for bookmark searchUrl & customBang
  const bareBm = resolveOmnibar('gh react', bookmarks, settings, []);
  assert.equal(bareBm?.kind, 'bang-search');
  assert.equal(bareBm?.url, 'https://github.com/search?q=react');
  assert.equal(bareBm?.matchedBookmark, undefined);

  const bareBmSpace = resolveOmnibar('gh ', bookmarks, settings, []);
  assert.equal(bareBmSpace?.kind, 'bang-jump');
  assert.equal(bareBmSpace?.url, 'https://github.com/');

  const bareLocal = resolveOmnibar('loc metrics', bookmarks, settings, []);
  assert.equal(bareLocal?.kind, 'bang-search');
  assert.equal(bareLocal?.url, 'http://localhost:5173/search?q=metrics');
  assert.equal(bareLocal?.iconUrl, undefined);

  const bareCustom = resolveOmnibar('k8s pods', bookmarks, settings, []);
  assert.equal(bareCustom?.kind, 'bang-search');
  assert.equal(bareCustom?.url, 'https://kubernetes.io/search/?q=pods');

  // Built-in only bangs and bookmarks without searchUrl do NOT trigger Level 2
  const gSuite = resolveOmnibar('g suite', bookmarks, settings, []);
  assert.equal(gSuite?.kind, 'web-search');
  const wKey = resolveOmnibar('w key', bookmarks, settings, []);
  assert.equal(wKey?.kind, 'web-search');
  const noSearchUrl = resolveOmnibar('my-docs guide', bookmarks, settings, []);
  assert.equal(noSearchUrl?.kind, 'web-search');

  // Level 3: Direct URL
  const direct = resolveOmnibar('localhost:5173/dashboard', bookmarks, settings, []);
  assert.equal(direct?.kind, 'url');
  assert.equal(direct?.url, 'http://localhost:5173/dashboard');
  assert.equal(direct?.autoSelect, true);
  assert.equal(direct?.iconUrl, undefined);
  assert.equal(direct?.matchedBookmark, undefined);

  // Level 4: Cross-section alias rescue even with incidental fuzzy match in sectionMatches
  const rescued = resolveOmnibar('gh', bookmarks, settings, [lightroomBookmark]);
  assert.equal(rescued?.kind, 'bookmark-alias');
  assert.equal(rescued?.url, 'https://github.com/');
  assert.equal(rescued?.autoSelect, true);
  assert.equal(rescued?.matchedBookmark, githubBookmark);
  assert.equal(rescued?.tabCompletion, '!gh ');

  // Cross-section rescue on private bookmark keeps iconUrl undefined
  const rescuedPrivate = resolveOmnibar('loc', bookmarks, settings, [lightroomBookmark]);
  assert.equal(rescuedPrivate?.kind, 'bookmark-alias');
  assert.equal(rescuedPrivate?.iconUrl, undefined);

  // When alias bookmark IS in sectionMatches, Level 5 returns web-search with autoSelect: false
  const inSection = resolveOmnibar('gh', bookmarks, settings, [githubBookmark]);
  assert.equal(inSection?.kind, 'web-search');
  assert.equal(inSection?.autoSelect, false);

  // Level 5: punctuation query with empty sectionMatches auto-selects web search
  const punct = resolveOmnibar('???', bookmarks, settings, []);
  assert.equal(punct?.kind, 'web-search');
  assert.equal(punct?.autoSelect, true);

  // Level 5: matching customBang bare token offers tabCompletion
  const customHint = resolveOmnibar('k8s', bookmarks, settings, []);
  assert.equal(customHint?.kind, 'web-search');
  assert.equal(customHint?.tabCompletion, '!k8s ');

  // buildWebSearchUrl across all presets and custom engine
  assert.equal(buildWebSearchUrl('   ', DEFAULT_OMNIBAR_SETTINGS), '');
  assert.equal(
    buildWebSearchUrl('!gh react', { ...DEFAULT_OMNIBAR_SETTINGS, defaultEngine: 'duckduckgo' }),
    'https://duckduckgo.com/?q=!gh%20react',
  );
  assert.equal(
    buildWebSearchUrl('test', { ...DEFAULT_OMNIBAR_SETTINGS, defaultEngine: 'google' }),
    'https://www.google.com/search?q=test',
  );
  assert.equal(
    buildWebSearchUrl('test', { ...DEFAULT_OMNIBAR_SETTINGS, defaultEngine: 'brave' }),
    'https://search.brave.com/search?q=test',
  );
  assert.equal(
    buildWebSearchUrl('test', { ...DEFAULT_OMNIBAR_SETTINGS, defaultEngine: 'kagi' }),
    'https://kagi.com/search?q=test',
  );
  assert.equal(
    buildWebSearchUrl('test', { ...DEFAULT_OMNIBAR_SETTINGS, defaultEngine: 'perplexity' }),
    'https://www.perplexity.ai/search?q=test',
  );
  assert.equal(
    buildWebSearchUrl('test', {
      version: 1,
      defaultEngine: 'custom',
      customSearchName: 'Startpage',
      customSearchUrl: 'https://www.startpage.com/sp/search?query=%s',
      customBangs: [],
    }),
    'https://www.startpage.com/sp/search?query=test',
  );
});

test('resolveTabCompletion and getOmnibarGlyph behave deterministically', () => {
  const dummyAction: OmnibarAction = {
    kind: 'web-search',
    url: 'https://duckduckgo.com/?q=gh',
    title: 'Search DuckDuckGo',
    subtitle: 'duckduckgo.com',
    badge: 'DDG',
    autoSelect: false,
    tabCompletion: '!gh ',
  };

  assert.equal(resolveTabCompletion('  ', { kind: 'bookmark', bookmark: githubBookmark }, dummyAction), null);
  assert.equal(
    resolveTabCompletion('gh', { kind: 'bookmark', bookmark: githubBookmark }, dummyAction),
    '!gh ',
  );
  assert.equal(
    resolveTabCompletion('my-docs', { kind: 'bookmark', bookmark: docsBookmark }, null),
    null,
  );
  assert.equal(
    resolveTabCompletion('!gh ', { kind: 'bookmark', bookmark: githubBookmark }, dummyAction),
    null,
  );
  assert.equal(resolveTabCompletion('!gh ', { kind: 'omnibar', action: dummyAction }, dummyAction), null);

  const kinds: OmnibarActionKind[] = [
    'bang-search',
    'bang-jump',
    'bang-incomplete',
    'bang-unknown',
    'url',
    'bookmark-alias',
    'web-search',
  ];
  for (const kind of kinds) {
    const glyph = getOmnibarGlyph({ ...dummyAction, kind });
    assert.equal([...glyph].length, 1, `glyph for ${kind} must be 1 character`);
  }
});

test('parseOmnibarSettings, resolvePreservedCustomBangHomeUrl, recovery, and mergeStartupErrors', () => {
  assert.deepEqual(parseOmnibarSettings('   '), DEFAULT_OMNIBAR_SETTINGS);

  // Accepts blank optional fields cleanly and omits them
  const parsedPreset = parseOmnibarSettings(JSON.stringify({
    version: 1,
    defaultEngine: 'google',
    customSearchName: '   ',
    customSearchUrl: '   ',
    customBangs: [
      {
        trigger: '!DOCS',
        label: '  Company Docs  ',
        searchUrl: 'docs.example.com/search?q=%s',
        homeUrl: '   ',
      },
    ],
  }));
  assert.deepEqual(parsedPreset, {
    version: 1,
    defaultEngine: 'google',
    customBangs: [
      {
        trigger: 'docs',
        label: 'Company Docs',
        searchUrl: 'https://docs.example.com/search?q=%s',
      },
    ],
  });

  // Rejections
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({ version: 1, defaultEngine: 'custom', customSearchUrl: '' })),
    /Custom search engine requires/,
  );
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({
      version: 1,
      defaultEngine: 'duckduckgo',
      customBangs: [
        { trigger: 'a', label: 'A', searchUrl: 'https://a.example/?q=%s' },
        { trigger: '!A', label: 'A2', searchUrl: 'https://a2.example/?q=%s' },
      ],
    })),
    /duplicates "a"/,
  );
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({
      version: 1,
      defaultEngine: 'duckduckgo',
      customBangs: [{ trigger: 'bad', label: 'Bad', searchUrl: 'javascript:alert("%s")' }],
    })),
    /valid HTTP\(S\) search URL/,
  );
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({
      version: 1,
      defaultEngine: 'duckduckgo',
      customBangs: [{ trigger: 'bad', label: 'Bad', searchUrl: 'https://%s.example.com/?q=%s' }],
    })),
    /valid HTTP\(S\) search URL/,
  );

  // resolvePreservedCustomBangHomeUrl
  assert.equal(
    resolvePreservedCustomBangHomeUrl(
      'https://news.ycombinator.com/',
      'https://hn.algolia.com/?q=%s',
      'https://hn.algolia.com/?query=%s',
    ),
    'https://news.ycombinator.com/',
  );
  assert.equal(
    resolvePreservedCustomBangHomeUrl(
      'https://lobste.rs/top',
      'https://hn.algolia.com/?q=%s',
      'https://lobste.rs/search?q=%s',
    ),
    'https://lobste.rs/top',
  );
  assert.equal(
    resolvePreservedCustomBangHomeUrl(
      'https://news.ycombinator.com/',
      'https://hn.algolia.com/?q=%s',
      'https://lobste.rs/search?q=%s',
    ),
    undefined,
  );

  // Corrupt JSON and invalid schema recovery
  const corruptValues = new Map([[OMNIBAR_STORAGE_KEY, '{broken']]);
  const corruptStorage = memoryStorage(corruptValues);
  assert.deepEqual(loadStoredOmnibarSettings(corruptStorage), {
    settings: DEFAULT_OMNIBAR_SETTINGS,
    recovery: 'backed-up',
    failure: 'truncated',
  });
  assert.equal(corruptValues.get(OMNIBAR_BACKUP_KEY), '{broken');

  const corruptInit = buildInitialOmnibarState(memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, '{broken']])));
  assert.equal(corruptInit.error?.title, 'Couldn’t read search settings');
  assert.match(corruptInit.error?.detail ?? '', new RegExp(OMNIBAR_BACKUP_KEY));

  const invalidInit = buildInitialOmnibarState(
    memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, JSON.stringify({ defaultEngine: 'unknown' })]])),
  );
  assert.match(invalidInit.error?.detail ?? '', /invalid entries/);

  const quotaStorage = memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, '{broken']]));
  quotaStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  assert.deepEqual(loadStoredOmnibarSettings(quotaStorage), {
    settings: DEFAULT_OMNIBAR_SETTINGS,
    recovery: 'backup-failed',
    failure: 'truncated',
  });
  const quotaInit = buildInitialOmnibarState(quotaStorage);
  assert.match(quotaInit.error?.detail ?? '', /No backup could be made/);
  assert.match(quotaInit.error?.detail ?? '', new RegExp(OMNIBAR_STORAGE_KEY));

  // mergeStartupErrors
  const bmErr = { title: 'Couldn’t read saved bookmarks', detail: 'Bookmark detail.' };
  const omErr = { title: 'Couldn’t read search settings', detail: 'Omnibar detail.' };
  assert.equal(mergeStartupErrors(null, null), null);
  assert.equal(mergeStartupErrors(bmErr, null), bmErr);
  assert.equal(mergeStartupErrors(null, omErr), omErr);
  const merged = mergeStartupErrors(bmErr, omErr);
  assert.equal(merged?.title, 'Couldn’t read saved data');
  assert.match(merged?.detail ?? '', /Bookmark detail\./);
  assert.match(merged?.detail ?? '', /Omnibar detail\./);
});

test('loadInitialOmnibarState falls back safely when localStorage throws SecurityError', (context) => {
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

  assert.deepEqual(loadInitialOmnibarState(), {
    settings: DEFAULT_OMNIBAR_SETTINGS,
    error: null,
  });
});
