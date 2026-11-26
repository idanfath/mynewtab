import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_KEY, type Bookmark } from '../src/bookmarks.ts';
import {
  DEFAULT_OMNIBAR_SETTINGS,
  OMNIBAR_STORAGE_KEY,
  isSettingsJsonObject,
  loadStoredOmnibarSettings,
  parseOmnibarSettings,
  parseSettingsFile,
  serializeOmnibarStorageValue,
  serializeSettingsJson,
  type OmnibarSettings,
} from '../src/omnibar.ts';
import {
  classifyImportContent,
  commitPairedBookmarksAndSettingsToStorage,
  formatSettingsError,
  looksLikeBookmarkImportContent,
  prepareImportBatch,
} from '../src/settingsImport.ts';
import { persistBookmarksWithVault } from '../src/snapshotVault.ts';
import { buildInitialOmnibarState } from '../src/useOmnibarSettings.ts';

function memoryStorage(values = new Map<string, string>()) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

function cappedStorage(maxBytes: number, initial = new Map<string, string>()) {
  const map = new Map<string, string>(initial);
  const byteSize = () => {
    let total = 0;
    for (const [k, v] of map.entries()) {
      total += k.length + v.length;
    }
    return total;
  };
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const prev = map.get(key);
      const nextTotal = byteSize()
        - (prev !== undefined ? key.length + prev.length : 0)
        + key.length
        + value.length;
      if (nextTotal > maxBytes) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

test('parseSettingsFile, serializeSettingsJson, and loadStoredOmnibarSettings preserve envelope and unknown extra sections', () => {
  assert.equal(isSettingsJsonObject({ kind: 'mynewtab-settings' }), true);
  assert.equal(isSettingsJsonObject({ defaultEngine: 'google' }), true);
  assert.equal(isSettingsJsonObject({ title: 'GitHub', url: 'https://github.com', section: 'Dev' }), false);
  assert.equal(isSettingsJsonObject([]), false);
  assert.equal(isSettingsJsonObject(null), false);

  const settings: OmnibarSettings = {
    version: 1,
    defaultEngine: 'kagi',
    customBangs: [
      { trigger: 'docs', label: 'Docs', searchUrl: 'https://docs.example/?q=%s' },
    ],
    disabledBuiltInBangs: ['yt', 'maps'],
  };

  const exported = serializeSettingsJson(settings, {
    theme: { density: 'compact' },
    __proto__: { polluted: true },
  });
  const reparsed = parseSettingsFile(`\uFEFF${exported}`);
  assert.deepEqual(reparsed.settings, settings);
  assert.deepEqual(reparsed.extraSections, { theme: { density: 'compact' } });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);

  // Raw OmnibarSettings object also imports cleanly
  const rawParsed = parseSettingsFile(JSON.stringify(settings));
  assert.deepEqual(rawParsed.settings, settings);
  assert.deepEqual(rawParsed.extraSections, {});

  // Empty settings file throws before JSON.parse
  assert.throws(() => parseSettingsFile('   \uFEFF  '), /No settings found in JSON file\./);

  // Envelope version check runs BEFORE missing omnibar check
  assert.throws(
    () => parseSettingsFile(JSON.stringify({ kind: 'mynewtab-settings', version: 2 })),
    /Unsupported settings file version\./,
  );
  assert.throws(
    () => parseOmnibarSettings(JSON.stringify({ kind: 'mynewtab-settings', version: 2 })),
    /Unsupported settings file version\./,
  );
  assert.throws(
    () => parseSettingsFile(JSON.stringify({ kind: 'mynewtab-settings', version: 1 })),
    /missing an "omnibar" object/,
  );

  // Storage round-trip keeps extraSections when present and omits property when absent
  const withExtra = serializeOmnibarStorageValue(settings, { theme: { accent: 'amber' } });
  const loadedWithExtra = loadStoredOmnibarSettings(
    memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, withExtra]])),
  );
  assert.deepEqual(loadedWithExtra.settings, settings);
  assert.deepEqual(loadedWithExtra.extraSections, { theme: { accent: 'amber' } });

  const withoutExtra = serializeOmnibarStorageValue(DEFAULT_OMNIBAR_SETTINGS, {});
  const loadedWithoutExtra = loadStoredOmnibarSettings(
    memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, withoutExtra]])),
  );
  assert.deepEqual(loadedWithoutExtra, { settings: DEFAULT_OMNIBAR_SETTINGS });
});

test('classifyImportContent routes bookmarks, settings, HTML, accidental bookmark objects, and unknown files accurately', () => {
  assert.equal(classifyImportContent('[{"title":"A"}]', 'bookmarks.json'), 'bookmarks');
  assert.equal(classifyImportContent('<!DOCTYPE NETSCAPE-Bookmark-file-1>', 'export.html'), 'bookmarks');
  assert.equal(
    classifyImportContent(JSON.stringify({ kind: 'mynewtab-settings', version: 1, omnibar: { defaultEngine: 'google' } }), 'backup.json'),
    'settings',
  );
  assert.equal(
    classifyImportContent(JSON.stringify({ defaultEngine: 'brave', customBangs: [] }), 'my-config.json'),
    'settings',
  );
  // Single bookmark object or {} in bookmarks.json routes to bookmarks validator (not settings)
  assert.equal(
    classifyImportContent(JSON.stringify({ title: 'GitHub', url: 'https://github.com', section: 'Dev' }), 'bookmarks.json'),
    'bookmarks',
  );
  assert.equal(classifyImportContent('{}', 'bookmarks.json'), 'bookmarks');
  assert.equal(classifyImportContent('{}', 'settings.json'), 'settings');
  assert.equal(classifyImportContent('   ', 'settings.json'), 'settings');
  assert.equal(classifyImportContent('random text', 'notes.txt'), 'unknown');
});

test('prepareImportBatch validates single, paired, duplicate, malformed, and unsupported batches atomically', () => {
  const validBookmarksJson = JSON.stringify([
    { title: 'GitHub', url: 'https://github.com/', section: 'Dev', shortcuts: [{ alias: 'gh' }] },
  ]);
  const validSettingsJson = serializeSettingsJson({
    version: 1,
    defaultEngine: 'brave',
    customBangs: [],
  });

  // 0 files & >2 files rejected
  assert.equal(prepareImportBatch([]).ok, false);
  assert.equal(
    prepareImportBatch([
      { name: 'a.json', content: validBookmarksJson },
      { name: 'b.json', content: validSettingsJson },
      { name: 'c.json', content: validSettingsJson },
    ]).ok,
    false,
  );

  // Unsupported file type rejected
  const unsupported = prepareImportBatch([
    { name: 'notes.txt', content: 'hello', supportedType: false },
  ]);
  assert.equal(unsupported.ok, false);

  // Single bookmarks file
  const bmOnly = prepareImportBatch([
    { name: 'bookmarks.json', content: validBookmarksJson, supportedType: true },
  ]);
  assert.equal(bmOnly.ok, true);
  if (bmOnly.ok) {
    assert.equal(bmOnly.bookmarks?.parsed.bookmarks.length, 1);
    assert.equal(bmOnly.settings, undefined);
  }

  // Single settings file
  const settingsOnly = prepareImportBatch([
    { name: 'settings.json', content: validSettingsJson, supportedType: true },
  ]);
  assert.equal(settingsOnly.ok, true);
  if (settingsOnly.ok) {
    assert.equal(settingsOnly.bookmarks, undefined);
    assert.equal(settingsOnly.settings?.parsed.settings.defaultEngine, 'brave');
  }

  // Paired bookmarks + settings in either order
  const paired = prepareImportBatch([
    { name: 'settings.json', content: validSettingsJson, supportedType: true },
    { name: 'bookmarks.json', content: validBookmarksJson, supportedType: true },
  ]);
  assert.equal(paired.ok, true);
  if (paired.ok) {
    assert.equal(paired.bookmarks?.fileName, 'bookmarks.json');
    assert.equal(paired.settings?.fileName, 'settings.json');
  }

  // 2 bookmarks files or 2 settings files rejected
  const twoBookmarks = prepareImportBatch([
    { name: 'a.json', content: validBookmarksJson },
    { name: 'b.json', content: validBookmarksJson },
  ]);
  assert.equal(twoBookmarks.ok, false);
  if (!twoBookmarks.ok) {
    assert.match(twoBookmarks.error.detail, /only one bookmarks file/i);
  }

  const twoSettings = prepareImportBatch([
    { name: 's1.json', content: validSettingsJson },
    { name: 's2.json', content: validSettingsJson },
  ]);
  assert.equal(twoSettings.ok, false);
  if (!twoSettings.ok) {
    assert.match(twoSettings.error.detail, /only one settings file/i);
  }

  // Paired batch fails atomically when either file is invalid and names offending file
  const badPaired = prepareImportBatch([
    { name: 'bookmarks.json', content: validBookmarksJson },
    { name: 'settings.json', content: '{"kind":"mynewtab-settings","version":99}' },
  ]);
  assert.equal(badPaired.ok, false);
  if (!badPaired.ok) {
    assert.match(badPaired.error.detail, /settings\.json:/);
    assert.match(badPaired.error.detail, /not supported/);
  }

  // Accidental bookmark object in bookmarks.json gives clear top-level array error
  const accidentalObj = prepareImportBatch([
    { name: 'bookmarks.json', content: '{"title":"A","url":"https://a.example","section":"Dev"}' },
  ]);
  assert.equal(accidentalObj.ok, false);
  if (!accidentalObj.ok) {
    assert.equal(accidentalObj.error.detail, 'Top level must be an array of bookmark objects.');
  }

  // formatSettingsError handles SyntaxError with line/col
  const brokenJson = '{\n  "kind": "mynewtab-settings",\n  "omnibar": \n}';
  const formattedSyntax = formatSettingsError(
    new SyntaxError(`Unexpected token } in JSON at position ${brokenJson.indexOf('}')}`),
    brokenJson,
    'Couldn’t import settings',
    'settings.json',
  );
  assert.match(formattedSyntax.detail, /settings\.json: File contains invalid JSON near line 4/);

  // Paired Netscape HTML + settings.json batch succeeds
  const netscapeHtml = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<DL><p>',
    '<DT><H3>Work</H3>',
    '<DL><p>',
    '<DT><A HREF="https://example.com/">Example</A>',
    '</DL><p>',
    '</DL><p>',
  ].join('\n');
  const pairedHtml = prepareImportBatch([
    { name: 'export.html', content: netscapeHtml, supportedType: true },
    { name: 'settings.json', content: validSettingsJson, supportedType: true },
  ]);
  assert.equal(pairedHtml.ok, true);
  if (pairedHtml.ok) {
    assert.equal(pairedHtml.bookmarks?.fileName, 'export.html');
    assert.equal(pairedHtml.bookmarks?.parsed.format, 'html');
    assert.equal(pairedHtml.bookmarks?.parsed.bookmarks.length, 1);
    assert.equal(pairedHtml.settings?.fileName, 'settings.json');
  }

  // Paired batch fails atomically when bookmarks file is invalid (naming bookmarks file)
  const badBookmarksPaired = prepareImportBatch([
    { name: 'broken-bookmarks.json', content: '[{"title":"NoUrl"}]', supportedType: true },
    { name: 'settings.json', content: validSettingsJson, supportedType: true },
  ]);
  assert.equal(badBookmarksPaired.ok, false);
  if (!badBookmarksPaired.ok) {
    assert.match(badBookmarksPaired.error.detail, /^broken-bookmarks\.json:/);
  }

  // Paired batch fails atomically when one of the two files has supportedType: false
  const unsupportedPaired = prepareImportBatch([
    { name: 'settings.json', content: validSettingsJson, supportedType: true },
    { name: 'notes.txt', content: 'hello', supportedType: false },
  ]);
  assert.equal(unsupportedPaired.ok, false);
  if (!unsupportedPaired.ok) {
    assert.equal(unsupportedPaired.error.title, 'Unsupported file type');
    assert.match(unsupportedPaired.error.detail, /notes\.txt:/);
  }
});

test('classifyImportContent, looksLikeBookmarkImportContent, and buildInitialOmnibarState cover malformed settings, generic JSON, and extraSections', () => {
  // Malformed settings JSON with arbitrary filename still routes to settings
  assert.equal(
    classifyImportContent('{"kind":"mynewtab-settings",', 'backup-2026.json'),
    'settings',
  );
  assert.equal(
    classifyImportContent('{"defaultEngine":', 'backup-2026.json'),
    'settings',
  );

  // looksLikeBookmarkImportContent distinguishes bookmarks from generic/malformed JSON
  assert.equal(looksLikeBookmarkImportContent('{}', 'config.json'), false);
  assert.equal(looksLikeBookmarkImportContent('{"theme":"dark"}', 'config.json'), false);
  assert.equal(looksLikeBookmarkImportContent('{"foo":', 'config.json'), false);
  assert.equal(looksLikeBookmarkImportContent('[{"title":"A"}]', 'bookmarks.json'), true);
  assert.equal(
    looksLikeBookmarkImportContent('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p></DL><p>', 'export.html'),
    true,
  );
  assert.equal(
    looksLikeBookmarkImportContent(
      JSON.stringify({ title: 'GitHub', url: 'https://github.com/', section: 'Dev' }),
      'single.json',
    ),
    true,
  );
  assert.equal(
    looksLikeBookmarkImportContent(
      JSON.stringify({ bookmarks: [{ title: 'A', url: 'https://a.example' }] }),
      'wrapped.json',
    ),
    true,
  );
  assert.equal(
    looksLikeBookmarkImportContent(
      JSON.stringify({ kind: 'mynewtab-settings', version: 1, omnibar: { defaultEngine: 'google' } }),
      'settings.json',
    ),
    false,
  );
  assert.equal(looksLikeBookmarkImportContent('   ', 'empty.html'), true);
  assert.equal(looksLikeBookmarkImportContent('   ', 'empty.json'), false);

  // buildInitialOmnibarState preserves extraSections when loading an envelope from storage
  const storedEnvelope = serializeOmnibarStorageValue(
    { version: 1, defaultEngine: 'kagi', customBangs: [] },
    { theme: { mode: 'dark' } },
  );
  const initialState = buildInitialOmnibarState(
    memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, storedEnvelope]])),
  );
  assert.equal(initialState.error, null);
  assert.equal(initialState.settings.defaultEngine, 'kagi');
  assert.deepEqual(initialState.extraSections, { theme: { mode: 'dark' } });
});

test('commitPairedBookmarksAndSettingsToStorage rolls back on QuotaExceededError and commits atomically when quota suffices', () => {
  const prevSettingsRaw = serializeOmnibarStorageValue(
    { version: 1, defaultEngine: 'duckduckgo', customBangs: [] },
    { theme: { accent: 'stone' } },
  );
  const nextSettingsParsed = {
    settings: {
      version: 1 as const,
      defaultEngine: 'kagi' as const,
      customBangs: [
        { trigger: 'docs', label: 'Docs', searchUrl: 'https://docs.example/?q=%s' },
      ],
    },
    extraSections: { theme: { accent: 'amber' } },
  };
  const nextSettingsRaw = serializeOmnibarStorageValue(
    nextSettingsParsed.settings,
    nextSettingsParsed.extraSections,
  );
  const existingBookmarks: Bookmark[] = [
    { title: 'Old', url: 'https://old.example/', section: 'Work' },
  ];
  const existingBookmarksRaw = JSON.stringify(existingBookmarks);
  const largeBookmarks: Bookmark[] = Array.from({ length: 12 }, (_, idx) => ({
    title: `Large Bookmark ${idx + 1}`,
    url: `https://large-${idx + 1}.example/path/to/resource`,
    section: 'Archive',
    description: 'x'.repeat(120),
  }));

  // 1) When OMNIBAR_STORAGE_KEY was previously set and bookmark persistence hits quota,
  //    OMNIBAR_STORAGE_KEY is rolled back to its previous value and bookmarks remain untouched.
  const tightCapWithPrev = STORAGE_KEY.length
    + existingBookmarksRaw.length
    + OMNIBAR_STORAGE_KEY.length
    + nextSettingsRaw.length
    + 40;
  const storageWithPrev = cappedStorage(
    tightCapWithPrev,
    new Map([
      [STORAGE_KEY, existingBookmarksRaw],
      [OMNIBAR_STORAGE_KEY, prevSettingsRaw],
    ]),
  );
  const failedWithPrev = commitPairedBookmarksAndSettingsToStorage({
    storage: storageWithPrev,
    nextSettings: nextSettingsParsed,
    persistBookmarks: () => persistBookmarksWithVault(storageWithPrev, largeBookmarks),
  });
  assert.deepEqual(failedWithPrev, { ok: false });
  assert.equal(storageWithPrev.getItem(OMNIBAR_STORAGE_KEY), prevSettingsRaw);
  assert.equal(storageWithPrev.getItem(STORAGE_KEY), existingBookmarksRaw);

  // 2) When OMNIBAR_STORAGE_KEY was previously unset and bookmark persistence hits quota,
  //    OMNIBAR_STORAGE_KEY is removed on rollback.
  const tightCapUnset = OMNIBAR_STORAGE_KEY.length + nextSettingsRaw.length + 40;
  const storageUnset = cappedStorage(tightCapUnset);
  const failedUnset = commitPairedBookmarksAndSettingsToStorage({
    storage: storageUnset,
    nextSettings: nextSettingsParsed,
    persistBookmarks: () => persistBookmarksWithVault(storageUnset, largeBookmarks),
  });
  assert.deepEqual(failedUnset, { ok: false });
  assert.equal(storageUnset.getItem(OMNIBAR_STORAGE_KEY), null);
  assert.equal(storageUnset.getItem(STORAGE_KEY), null);

  // 3) When quota suffices, both OMNIBAR_STORAGE_KEY and STORAGE_KEY commit atomically.
  const ampleStorage = cappedStorage(100_000);
  const committed = commitPairedBookmarksAndSettingsToStorage({
    storage: ampleStorage,
    nextSettings: nextSettingsParsed,
    persistBookmarks: () => persistBookmarksWithVault(ampleStorage, largeBookmarks),
  });
  assert.equal(committed.ok, true);
  assert.equal(ampleStorage.getItem(OMNIBAR_STORAGE_KEY), nextSettingsRaw);
  assert.deepEqual(JSON.parse(ampleStorage.getItem(STORAGE_KEY) ?? '[]'), largeBookmarks);

  // 4) When storage.setItem throws QuotaExceededError on the initial settings write,
  //    neither settings nor bookmarks are mutated and persistBookmarks is never invoked.
  let persistCalled = false;
  const settingsWriteFailsStorage = {
    map: new Map<string, string>([
      [STORAGE_KEY, existingBookmarksRaw],
      [OMNIBAR_STORAGE_KEY, prevSettingsRaw],
    ]),
    getItem(key: string) {
      return this.map.get(key) ?? null;
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem(key: string) {
      this.map.delete(key);
    },
  };
  const failedOnInitialWrite = commitPairedBookmarksAndSettingsToStorage({
    storage: settingsWriteFailsStorage,
    nextSettings: nextSettingsParsed,
    persistBookmarks: () => {
      persistCalled = true;
      return { ok: true };
    },
  });
  assert.deepEqual(failedOnInitialWrite, { ok: false });
  assert.equal(persistCalled, false);
  assert.equal(settingsWriteFailsStorage.getItem(OMNIBAR_STORAGE_KEY), prevSettingsRaw);
  assert.equal(settingsWriteFailsStorage.getItem(STORAGE_KEY), existingBookmarksRaw);

  // 5) When persistBookmarks throws synchronously after settings write, settings still roll back.
  const throwingPersistStorage = memoryStorage(
    new Map([
      [STORAGE_KEY, existingBookmarksRaw],
      [OMNIBAR_STORAGE_KEY, prevSettingsRaw],
    ]),
  );
  const failedOnThrow = commitPairedBookmarksAndSettingsToStorage({
    storage: throwingPersistStorage,
    nextSettings: nextSettingsParsed,
    persistBookmarks: () => {
      throw new Error('Unexpected write error');
    },
  });
  assert.deepEqual(failedOnThrow, { ok: false });
  assert.equal(throwingPersistStorage.getItem(OMNIBAR_STORAGE_KEY), prevSettingsRaw);
  assert.equal(throwingPersistStorage.getItem(STORAGE_KEY), existingBookmarksRaw);
});

test('settings envelope strips prototype-pollution keys, reserved keys, and undefined values across all serialization and loading paths', () => {
  const baseSettings: OmnibarSettings = {
    version: 1,
    defaultEngine: 'google',
    customBangs: [],
  };

  const hostileEnvelopeJson = `{
    "kind": "mynewtab-settings",
    "version": 1,
    "omnibar": { "defaultEngine": "google", "customBangs": [] },
    "__proto__": { "topPolluted": true },
    "constructor": { "prototype": { "ctorPolluted": true } },
    "prototype": { "protoPropPolluted": true },
    "nested": {
      "__proto__": { "nestedPolluted": true },
      "safe": "ok"
    },
    "theme": { "accent": "amber" }
  }`;

  const parsed = parseSettingsFile(hostileEnvelopeJson);
  assert.deepEqual(parsed.settings, baseSettings);
  assert.deepEqual(parsed.extraSections, {
    nested: { safe: 'ok' },
    theme: { accent: 'amber' },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.extraSections, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.extraSections, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed.extraSections, 'prototype'), false);
  assert.equal(Object.getPrototypeOf(parsed.extraSections), Object.prototype);
  assert.equal(Object.getPrototypeOf(parsed.extraSections.nested), Object.prototype);
  assert.equal(({} as Record<string, unknown>).topPolluted, undefined);
  assert.equal(({} as Record<string, unknown>).ctorPolluted, undefined);
  assert.equal(({} as Record<string, unknown>).protoPropPolluted, undefined);
  assert.equal(({} as Record<string, unknown>).nestedPolluted, undefined);

  // serializeSettingsJson strips __proto__, constructor, prototype, reserved envelope keys, and undefined
  const hostileExtra = JSON.parse(
    '{"__proto__":{"p":1},"constructor":{"prototype":{"c":1}},"prototype":{"x":1},"kind":"override","version":99,"omnibar":"evil","nested":{"__proto__":{"n":1},"ok":true},"theme":{"mode":"dark"}}',
  ) as Record<string, unknown>;
  hostileExtra.emptyField = undefined;

  const exported = serializeSettingsJson(baseSettings, hostileExtra);
  const exportedObj = JSON.parse(exported) as Record<string, unknown>;
  assert.equal(exportedObj.kind, 'mynewtab-settings');
  assert.equal(exportedObj.version, 1);
  assert.equal(typeof exportedObj.omnibar, 'object');
  assert.equal(Object.prototype.hasOwnProperty.call(exportedObj, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exportedObj, 'constructor'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exportedObj, 'prototype'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(exportedObj, 'emptyField'), false);
  assert.deepEqual(exportedObj.nested, { ok: true });
  assert.deepEqual(exportedObj.theme, { mode: 'dark' });

  // serializeOmnibarStorageValue omits envelope when only hostile/reserved/undefined keys remain
  const onlyHostile = JSON.parse(
    '{"__proto__":{"p":1},"constructor":{"prototype":{"c":1}},"prototype":{"x":1},"kind":"override","version":99,"omnibar":"evil"}',
  ) as Record<string, unknown>;
  onlyHostile.unset = undefined;

  const compactStored = serializeOmnibarStorageValue(baseSettings, onlyHostile);
  assert.deepEqual(JSON.parse(compactStored), baseSettings);

  // loadStoredOmnibarSettings sanitizes hostile stored envelope cleanly
  const loaded = loadStoredOmnibarSettings(
    memoryStorage(new Map([[OMNIBAR_STORAGE_KEY, hostileEnvelopeJson]])),
  );
  assert.equal(loaded.recovery, undefined);
  assert.deepEqual(loaded.settings, baseSettings);
  assert.deepEqual(loaded.extraSections, {
    nested: { safe: 'ok' },
    theme: { accent: 'amber' },
  });
  assert.equal(({} as Record<string, unknown>).topPolluted, undefined);
  assert.equal(({} as Record<string, unknown>).ctorPolluted, undefined);
  assert.equal(({} as Record<string, unknown>).nestedPolluted, undefined);
});
