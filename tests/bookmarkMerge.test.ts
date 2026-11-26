import assert from 'node:assert/strict';
import test from 'node:test';
import { insertBookmarkInSection, type Bookmark } from '../src/bookmarks.ts';
import {
  applyBookmarkMerge,
  areBookmarksEqual,
  canonicalizeBookmark,
  computeBookmarkDiff,
  computeBookmarksHash,
  deduplicateBookmarks,
  enrichBookmark,
  previewBookmarkMerge,
} from '../src/bookmarkMerge.ts';

test('enrichBookmark preserves curated core fields, normalizes iconUrl, and preserves unknown keys', () => {
  const existing = {
    title: 'My GitHub',
    url: 'https://github.com',
    section: 'Work',
    description: 'Local note',
    categories: ['Code'],
    pros: ['Fast'],
    alias: 'gh',
    searchUrl: 'https://github.com/search?q=%s',
  } as Bookmark & { alias: string; searchUrl: string };

  const incoming: Bookmark = {
    title: 'GitHub Official',
    url: 'https://github.com/',
    section: 'Dev',
    subsection: 'Repos',
    description: 'Remote note should not overwrite',
    iconUrl: 'cdn.example.com/gh.png',
    categories: ['code', 'Git', 'OSS'],
    pros: ['Should not overwrite'],
    cons: ['Rate limits'],
  };

  const { bookmark: enriched, changedFields } = enrichBookmark(existing, incoming);
  assert.deepEqual(changedFields, ['subsection', 'iconUrl', 'categories', 'cons']);
  assert.equal(enriched.title, 'My GitHub');
  assert.equal(enriched.url, 'https://github.com');
  assert.equal(enriched.section, 'Work');
  assert.equal(enriched.description, 'Local note');
  assert.equal(enriched.subsection, 'Repos');
  assert.equal(enriched.iconUrl, 'https://cdn.example.com/gh.png');
  assert.deepEqual(enriched.categories, ['Code', 'Git', 'OSS']);
  assert.deepEqual(enriched.pros, ['Fast']);
  assert.deepEqual(enriched.cons, ['Rate limits']);
  assert.equal((enriched as unknown as Record<string, unknown>).alias, 'gh');
  assert.equal(
    (enriched as unknown as Record<string, unknown>).searchUrl,
    'https://github.com/search?q=%s',
  );

  // Exact reference preserved on no-op enrichment
  const noop = enrichBookmark(enriched, {
    title: 'Different',
    url: 'https://github.com/',
    section: 'Other',
    categories: ['code', 'git'],
  });
  assert.equal(noop.bookmark, enriched);
  assert.deepEqual(noop.changedFields, []);
});

test('deduplicateBookmarks merges intra-file duplicates and normalizes first iconUrl', () => {
  const { bookmarks, duplicateCount } = deduplicateBookmarks([
    {
      title: 'First',
      url: 'https://example.com/a',
      section: 'Work',
      iconUrl: 'icons.example.com/a.png',
    },
    {
      title: 'Duplicate',
      url: 'https://EXAMPLE.com:443/a/',
      section: 'Other',
      description: 'Filled from duplicate',
      categories: ['Tools'],
    },
  ]);

  assert.equal(duplicateCount, 1);
  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].title, 'First');
  assert.equal(bookmarks[0].iconUrl, 'https://icons.example.com/a.png');
  assert.equal(bookmarks[0].description, 'Filled from duplicate');
  assert.deepEqual(bookmarks[0].categories, ['Tools']);
});

test('areBookmarksEqual and computeBookmarksHash share canonicalization including unknown keys', () => {
  const a = {
    title: ' Docs ',
    url: 'https://docs.example',
    section: 'Work',
    categories: [' Dev ', ''],
    description: '   ',
    alias: 'd',
    searchUrl: 'https://docs.example?q=%s',
  } as Bookmark;
  const b = {
    searchUrl: 'https://docs.example?q=%s',
    alias: 'd',
    section: 'Work',
    url: 'https://docs.example',
    title: 'Docs',
    categories: ['Dev'],
  } as Bookmark;
  const c = { ...b, alias: 'docs' } as Bookmark;

  assert.equal(areBookmarksEqual(a, b), true);
  assert.equal(computeBookmarksHash([a]), computeBookmarksHash([b]));
  assert.equal(areBookmarksEqual(a, c), false);
  assert.notEqual(computeBookmarksHash([a]), computeBookmarksHash([c]));
});

test('previewBookmarkMerge detects no-ops and order-only replace changes accurately', () => {
  const a: Bookmark = { title: 'A', url: 'https://a.example', section: 'Work' };
  const b: Bookmark = { title: 'B', url: 'https://b.example', section: 'Media' };
  const existing = [a, b];

  const sameMerge = previewBookmarkMerge(existing, [a, b], 'merge');
  assert.equal(sameMerge.hasEffectiveChanges, false);
  assert.equal(sameMerge.addedCount, 0);
  assert.equal(sameMerge.changedCount, 0);
  assert.equal(sameMerge.unchangedCount, 2);

  const sameAppend = previewBookmarkMerge(existing, [a, b], 'append');
  assert.equal(sameAppend.hasEffectiveChanges, false);

  const sameReplace = previewBookmarkMerge(existing, [a, b], 'replace');
  assert.equal(sameReplace.hasEffectiveChanges, false);
  assert.equal(sameReplace.orderChanged, false);

  const reorderedReplace = previewBookmarkMerge(existing, [b, a], 'replace');
  assert.equal(reorderedReplace.addedCount, 0);
  assert.equal(reorderedReplace.changedCount, 0);
  assert.equal(reorderedReplace.removedCount, 0);
  assert.equal(reorderedReplace.orderChanged, true);
  assert.equal(reorderedReplace.hasEffectiveChanges, true);
});

test('applyBookmarkMerge executes merge, append, and replace deterministically', () => {
  const w1: Bookmark = { title: 'W1', url: 'https://w1.example', section: 'Work' };
  const m1: Bookmark = { title: 'M1', url: 'https://m1.example', section: 'Media' };
  const existing = [w1, m1];

  const incoming: Bookmark[] = [
    {
      title: 'W1 Remote',
      url: 'https://w1.example/',
      section: 'Other',
      description: 'Enriched note',
    },
    {
      title: 'W2 New',
      url: 'https://w2.example',
      section: 'work',
    },
    {
      title: 'R1 New',
      url: 'https://r1.example',
      section: 'All',
    },
  ];

  const diff = computeBookmarkDiff(existing, incoming);
  assert.equal(diff.added.length, 2);
  assert.equal(diff.matched.length, 1);
  assert.equal(diff.localOnly.length, 1);

  // Merge: enriches W1 in place, case-matches 'work' -> 'Work', maps 'All' -> 'Uncategorized'
  const merged = applyBookmarkMerge(existing, incoming, 'merge');
  assert.deepEqual(
    merged.map((b) => `${b.title}:${b.section}`),
    ['W1:Work', 'W2 New:Work', 'M1:Media', 'R1 New:Uncategorized'],
  );
  assert.equal(merged[0].description, 'Enriched note');

  // Matches sequential insertBookmarkInSection 1:1
  const sequential = insertBookmarkInSection(
    insertBookmarkInSection([merged[0], m1], { ...incoming[1], section: 'Work' }),
    { ...incoming[2], section: 'Uncategorized' },
  );
  assert.deepEqual(merged, sequential);

  // Append: keeps every existing bookmark reference untouched
  const appended = applyBookmarkMerge(existing, incoming, 'append');
  assert.equal(appended[0], w1);
  assert.equal(appended[2], m1);
  assert.equal(appended[0].description, undefined);
  assert.deepEqual(
    appended.map((b) => `${b.title}:${b.section}`),
    ['W1:Work', 'W2 New:Work', 'M1:Media', 'R1 New:Uncategorized'],
  );

  // Replace: regroups incoming and normalizes 'All' -> 'Uncategorized'
  const replaced = applyBookmarkMerge(existing, incoming, 'replace');
  assert.deepEqual(
    replaced.map((b) => `${b.title}:${b.section}`),
    ['W1 Remote:Other', 'W2 New:work', 'R1 New:Uncategorized'],
  );
});

test('computeBookmarkDiff, previewBookmarkMerge, and applyBookmarkMerge account for duplicate URLs in existing', () => {
  const dupFirst: Bookmark = { title: 'Docs Primary', url: 'https://docs.example', section: 'Work' };
  const dupSecond: Bookmark = { title: 'Docs Duplicate', url: 'https://docs.example/', section: 'Work' };
  const localOther: Bookmark = { title: 'Local Only', url: 'https://local.example', section: 'Media' };
  const existing = [dupFirst, dupSecond, localOther];

  const incomingEnrich: Bookmark[] = [
    {
      title: 'Docs Primary',
      url: 'https://docs.example',
      section: 'Work',
      description: 'Added description',
    },
  ];

  const diff = computeBookmarkDiff(existing, incomingEnrich);
  assert.equal(diff.matched.length, 1);
  assert.equal(diff.matched[0].existing, dupFirst);
  assert.deepEqual(diff.localOnly, [dupSecond, localOther]);

  const mergePreview = previewBookmarkMerge(existing, incomingEnrich, 'merge');
  const merged = applyBookmarkMerge(existing, incomingEnrich, 'merge');
  assert.equal(mergePreview.addedCount, 0);
  assert.equal(mergePreview.changedCount, 1);
  assert.equal(mergePreview.unchangedCount, 0);
  assert.equal(mergePreview.localKeptCount, 2);
  assert.equal(mergePreview.removedCount, 0);
  assert.equal(mergePreview.hasEffectiveChanges, true);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].description, 'Added description');
  assert.equal(merged[1], dupSecond);
  assert.equal(merged[2], localOther);

  const appendPreview = previewBookmarkMerge(existing, incomingEnrich, 'append');
  const appended = applyBookmarkMerge(existing, incomingEnrich, 'append');
  assert.equal(appendPreview.addedCount, 0);
  assert.equal(appendPreview.changedCount, 0);
  assert.equal(appendPreview.unchangedCount, 1);
  assert.equal(appendPreview.localKeptCount, 2);
  assert.equal(appendPreview.removedCount, 0);
  assert.equal(appendPreview.hasEffectiveChanges, false);
  assert.deepEqual(appended, existing);

  // Replace with identical first entry still removes the duplicate second entry
  const existingDupsOnly = [dupFirst, dupSecond];
  const incomingSingle: Bookmark[] = [{ ...dupFirst }];
  const replacePreview = previewBookmarkMerge(existingDupsOnly, incomingSingle, 'replace');
  const replaced = applyBookmarkMerge(existingDupsOnly, incomingSingle, 'replace');
  assert.equal(replacePreview.addedCount, 0);
  assert.equal(replacePreview.changedCount, 0);
  assert.equal(replacePreview.unchangedCount, 1);
  assert.equal(replacePreview.removedCount, 1);
  assert.equal(replacePreview.localKeptCount, 0);
  assert.equal(replacePreview.hasEffectiveChanges, true);
  assert.deepEqual(
    replacePreview.affectedRows.map((row) => [row.kind, row.bookmark.title]),
    [['removed', 'Docs Duplicate']],
  );
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].title, 'Docs Primary');
});

test('handles urlIdentity collisions, enrichBookmark array union ordering and whitespace elements, and preview/apply parity', () => {
  // enrichBookmark array union preserves existing order, strips whitespace/empty elements, and dedupes case-insensitively
  const enriched = enrichBookmark(
    {
      title: 'T',
      url: 'https://t.example',
      section: 'Work',
      categories: ['  Alpha ', '', '   ', 'Beta'],
      pros: ['  ', ''],
    },
    {
      title: 'T Remote',
      url: 'https://T.EXAMPLE:443/',
      section: 'Other',
      categories: ['alpha', '  Gamma ', '', 'gamma', 'Delta'],
      pros: [' Fast ', 'fast', '', 'Clean'],
    },
  );
  assert.deepEqual(enriched.changedFields, ['categories', 'pros']);
  assert.deepEqual(enriched.bookmark.categories, ['Alpha', 'Beta', 'Gamma', 'Delta']);
  assert.deepEqual(enriched.bookmark.pros, ['Fast', 'Clean']);

  // Complex dataset verifying exact count parity across merge, append, and replace
  const existing: Bookmark[] = [
    { title: 'E1', url: 'https://e1.example', section: 'Work' },
    { title: 'E1 Dup', url: 'https://e1.example/', section: 'Work' },
    { title: 'E2', url: 'https://e2.example?b=2&a=1', section: 'Media', description: 'Local', categories: ['Video'] },
    { title: 'E3', url: 'https://e3.example:443/path/', section: 'Tools', alias: 'e3' } as Bookmark,
    { title: 'E4', url: 'https://e4.example#one', section: 'Reading' },
  ];
  const incoming: Bookmark[] = [
    { title: 'E1 Updated', url: 'https://E1.EXAMPLE:443', section: 'Work', description: 'Enriched' },
    { title: 'E2 Same', url: 'https://e2.example/?a=1&b=2', section: 'Media', categories: ['video', 'Stream'] },
    { title: 'E3 Alias Change', url: 'https://e3.example/path', section: 'Tools', alias: 'e3-new' } as Bookmark,
    { title: 'E4 Diff Frag', url: 'https://e4.example#two', section: 'reading' },
    { title: 'N1', url: 'https://n1.example', section: 'All' },
  ];

  const mergePreview = previewBookmarkMerge(existing, incoming, 'merge');
  const merged = applyBookmarkMerge(existing, incoming, 'merge');
  assert.equal(merged.length, existing.length + mergePreview.addedCount);
  assert.equal(
    mergePreview.changedCount + mergePreview.unchangedCount + mergePreview.localKeptCount,
    existing.length,
  );
  assert.equal(mergePreview.removedCount, 0);
  assert.equal(mergePreview.affectedRows.length, mergePreview.addedCount + mergePreview.changedCount);

  const appendPreview = previewBookmarkMerge(existing, incoming, 'append');
  const appended = applyBookmarkMerge(existing, incoming, 'append');
  assert.equal(appended.length, existing.length + appendPreview.addedCount);
  assert.equal(appendPreview.changedCount, 0);
  assert.equal(appendPreview.unchangedCount + appendPreview.localKeptCount, existing.length);
  assert.equal(appendPreview.removedCount, 0);
  assert.equal(appendPreview.affectedRows.length, appendPreview.addedCount);

  const replacePreview = previewBookmarkMerge(existing, incoming, 'replace');
  const replaced = applyBookmarkMerge(existing, incoming, 'replace');
  assert.equal(
    replaced.length,
    replacePreview.addedCount + replacePreview.changedCount + replacePreview.unchangedCount,
  );
  assert.equal(
    replacePreview.changedCount + replacePreview.unchangedCount + replacePreview.removedCount,
    existing.length,
  );
  assert.equal(replacePreview.localKeptCount, 0);
  assert.equal(
    replacePreview.affectedRows.length,
    replacePreview.addedCount + replacePreview.changedCount + replacePreview.removedCount,
  );
});

test('folds multiple case variants of a new incoming section consistently across merge, append, and replace', () => {
  const existing: Bookmark[] = [
    { title: 'M', url: 'https://m.example', section: 'Media' },
  ];
  const incoming: Bookmark[] = [
    { title: 'W1', url: 'https://w1.example', section: 'work' },
    { title: 'W2', url: 'https://w2.example', section: 'WORK' },
  ];

  for (const strategy of ['merge', 'append'] as const) {
    const applied = applyBookmarkMerge(existing, incoming, strategy);
    const preview = previewBookmarkMerge(existing, incoming, strategy);
    assert.deepEqual(
      applied.map((b) => b.section),
      ['Media', 'work', 'work'],
      `${strategy} should fold 'WORK' into first-seen 'work'`,
    );
    assert.deepEqual(
      preview.affectedRows.map((row) => row.bookmark.section),
      ['work', 'work'],
      `${strategy} preview should match applied section folding`,
    );
  }

  const replaced = applyBookmarkMerge(existing, incoming, 'replace');
  const replacePreview = previewBookmarkMerge(existing, incoming, 'replace');
  assert.deepEqual(replaced.map((b) => b.section), ['work', 'work']);
  assert.deepEqual(
    replacePreview.affectedRows
      .filter((row) => row.kind === 'added')
      .map((row) => row.bookmark.section),
    ['work', 'work'],
  );
});

test('canonicalizeBookmark resists prototype-chain mutation from __proto__ keys', () => {
  const poisoned = JSON.parse(
    '{"title":"A","url":"https://a.example","section":"Work","meta":{"__proto__":{"polluted":true}}}',
  ) as Bookmark;
  const canonical = canonicalizeBookmark(poisoned);
  const meta = canonical.meta as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(meta), Object.prototype);
  assert.equal(meta.polluted, undefined);
});

test('enriches alias and searchUrl while stripping colliding incoming aliases so merged output passes parseBookmarks', async () => {
  const { parseBookmarks } = await import('../src/bookmarks.ts');

  const existing: Bookmark[] = [
    { title: 'GitHub', url: 'https://github.com/', section: 'Dev', alias: 'gh' },
    { title: 'Docs', url: 'https://docs.example/', section: 'Dev' },
  ];
  const incoming: Bookmark[] = [
    {
      title: 'Docs',
      url: 'https://docs.example',
      section: 'Dev',
      alias: '!DOCS',
      searchUrl: 'docs.example/search?q=%s',
    },
    {
      title: 'Gitea',
      url: 'https://gitea.example/',
      section: 'Dev',
      alias: '!GH',
      searchUrl: 'https://gitea.example/search?q=%s',
    },
  ];

  const mergePreview = previewBookmarkMerge(existing, incoming, 'merge');
  const merged = applyBookmarkMerge(existing, incoming, 'merge');
  assert.equal(mergePreview.changedCount, 1);
  assert.equal(mergePreview.addedCount, 1);
  assert.equal(merged[1].alias, 'docs');
  assert.equal(merged[1].searchUrl, 'https://docs.example/search?q=%s');
  assert.equal(merged[2].alias, undefined);
  assert.equal(merged[2].searchUrl, 'https://gitea.example/search?q=%s');
  assert.equal(parseBookmarks(JSON.stringify(merged)).length, 3);

  const appended = applyBookmarkMerge(existing, incoming, 'append');
  assert.equal(appended[2].alias, undefined);
  assert.equal(parseBookmarks(JSON.stringify(appended)).length, 3);
});
