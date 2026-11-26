import { groupBookmarksBySection, type Bookmark } from './bookmarks.ts';
import { normalizeUrl, urlIdentity } from './lib.ts';

export type MergeStrategy = 'merge' | 'append' | 'replace';

export type BookmarkField =
  | 'title'
  | 'url'
  | 'section'
  | 'subsection'
  | 'description'
  | 'iconUrl'
  | 'tier'
  | 'product'
  | 'categories'
  | 'capabilities'
  | 'formats'
  | 'pros'
  | 'cons';

export interface MatchedBookmarkDiff {
  identity: string;
  existing: Bookmark;
  incoming: Bookmark;
  enriched: Bookmark;
  enrichFields: BookmarkField[];
  replaceDiffFields: BookmarkField[];
}

export interface BookmarkDiffReport {
  added: Bookmark[];
  matched: MatchedBookmarkDiff[];
  localOnly: Bookmark[];
}

export interface StrategyPreviewRow {
  kind: 'added' | 'enriched' | 'modified' | 'removed';
  bookmark: Bookmark;
  previous?: Bookmark;
  changedFields?: BookmarkField[];
}

export interface StrategyPreview {
  strategy: MergeStrategy;
  addedCount: number;
  changedCount: number;
  unchangedCount: number;
  localKeptCount: number;
  removedCount: number;
  orderChanged: boolean;
  affectedRows: StrategyPreviewRow[];
  hasEffectiveChanges: boolean;
}

const OPTIONAL_SCALAR_FIELDS = [
  'subsection',
  'description',
  'iconUrl',
  'tier',
  'product',
] as const;

const TAXONOMY_ARRAY_FIELDS = [
  'categories',
  'capabilities',
  'formats',
] as const;

const JUDGMENT_ARRAY_FIELDS = ['pros', 'cons'] as const;

const ALL_OPTIONAL_ARRAY_FIELDS = [
  ...TAXONOMY_ARRAY_FIELDS,
  ...JUDGMENT_ARRAY_FIELDS,
] as const;

const KNOWN_BOOKMARK_KEYS = new Set<string>([
  'title',
  'url',
  'section',
  ...OPTIONAL_SCALAR_FIELDS,
  ...ALL_OPTIONAL_ARRAY_FIELDS,
]);

function cleanStringList(values: readonly string[] | undefined): string[] {
  if (!values?.length) return [];
  const result: string[] = [];
  for (const item of values) {
    const trimmed = item.trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
}

function dedupeStringList(values: readonly string[] | undefined): string[] {
  const cleaned = cleanStringList(values);
  if (!cleaned.length) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of cleaned) {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function cloneWithoutProto(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneWithoutProto(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '__proto__' || v === undefined) continue;
      out[k] = cloneWithoutProto(v);
    }
    return out;
  }
  return value;
}

function canonicalizeUnknownValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeUnknownValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (key === '__proto__') continue;
      const entry = record[key];
      if (entry === undefined) continue;
      sorted[key] = canonicalizeUnknownValue(entry);
    }
    return sorted;
  }
  return value;
}

export function canonicalizeBookmark(bookmark: Bookmark): Record<string, unknown> {
  const raw = bookmark as unknown as Record<string, unknown>;
  const unsorted: Record<string, unknown> = {
    title: bookmark.title.trim(),
    url: bookmark.url.trim(),
    section: bookmark.section.trim(),
  };

  for (const field of OPTIONAL_SCALAR_FIELDS) {
    const value = bookmark[field];
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (field === 'iconUrl') {
      unsorted.iconUrl = normalizeUrl(trimmed) || trimmed;
    } else {
      unsorted[field] = trimmed;
    }
  }

  for (const field of ALL_OPTIONAL_ARRAY_FIELDS) {
    const cleaned = cleanStringList(bookmark[field]);
    if (cleaned.length > 0) {
      unsorted[field] = cleaned;
    }
  }

  for (const key of Object.keys(raw)) {
    if (key === '__proto__' || KNOWN_BOOKMARK_KEYS.has(key)) continue;
    const extra = raw[key];
    if (extra === undefined) continue;
    unsorted[key] = canonicalizeUnknownValue(extra);
  }

  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(unsorted).sort()) {
    if (key === '__proto__') continue;
    sorted[key] = unsorted[key];
  }
  return sorted;
}

function cyrb53Hex(input: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, '0');
}

export function computeBookmarksHash(bookmarks: readonly Bookmark[]): string {
  const canonical = JSON.stringify(
    bookmarks.map((bookmark) => canonicalizeBookmark(bookmark)),
  );
  const h1Hex = cyrb53Hex(canonical, 0);
  const h2Hex = cyrb53Hex(canonical, 1);
  return `${canonical.length.toString(36)}:${h2Hex}${h1Hex}`;
}

export function shortBookmarksHash(hash: string): string {
  const trimmed = hash.trim();
  const colonIndex = trimmed.indexOf(':');
  const hex = colonIndex >= 0 ? trimmed.slice(colonIndex + 1) : trimmed;
  return hex.slice(0, 6).toLowerCase();
}

export function areBookmarksEqual(a: Bookmark, b: Bookmark): boolean {
  return JSON.stringify(canonicalizeBookmark(a)) === JSON.stringify(canonicalizeBookmark(b));
}

export function getChangedBookmarkFields(a: Bookmark, b: Bookmark): BookmarkField[] {
  const left = canonicalizeBookmark(a);
  const right = canonicalizeBookmark(b);
  const changed: BookmarkField[] = [];
  const orderedFields: readonly BookmarkField[] = [
    'title',
    'url',
    'section',
    'subsection',
    'description',
    'iconUrl',
    'tier',
    'product',
    'categories',
    'capabilities',
    'formats',
    'pros',
    'cons',
  ];

  for (const field of orderedFields) {
    if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
      changed.push(field);
    }
  }
  return changed;
}

export function enrichBookmark(
  existing: Bookmark,
  incoming: Bookmark,
): { bookmark: Bookmark; changedFields: BookmarkField[] } {
  const patch: Partial<Bookmark> = {};
  const changedFields: BookmarkField[] = [];

  for (const field of OPTIONAL_SCALAR_FIELDS) {
    const existingValue = existing[field]?.trim() ?? '';
    const incomingValue = incoming[field]?.trim() ?? '';
    if (!existingValue && incomingValue) {
      if (field === 'iconUrl') {
        const normalizedIcon = normalizeUrl(incomingValue);
        if (normalizedIcon) {
          patch.iconUrl = normalizedIcon;
          changedFields.push('iconUrl');
        }
      } else {
        patch[field] = incomingValue;
        changedFields.push(field);
      }
    }
  }

  for (const field of TAXONOMY_ARRAY_FIELDS) {
    const existingList = cleanStringList(existing[field]);
    const seen = new Set(existingList.map((item) => item.toLocaleLowerCase()));
    const merged = [...existingList];

    for (const item of cleanStringList(incoming[field])) {
      const lower = item.toLocaleLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      merged.push(item);
    }

    if (merged.length > existingList.length) {
      patch[field] = merged;
      changedFields.push(field);
    }
  }

  for (const field of JUDGMENT_ARRAY_FIELDS) {
    const existingHasAny = existing[field]?.some((item) => item.trim().length > 0) ?? false;
    if (!existingHasAny) {
      const incomingList = dedupeStringList(incoming[field]);
      if (incomingList.length > 0) {
        patch[field] = incomingList;
        changedFields.push(field);
      }
    }
  }

  if (changedFields.length === 0) {
    return { bookmark: existing, changedFields: [] };
  }

  return {
    bookmark: {
      ...(cloneWithoutProto(existing) as Record<string, unknown>),
      ...patch,
    } as Bookmark,
    changedFields,
  };
}

export function deduplicateBookmarks(
  bookmarks: readonly Bookmark[],
): { bookmarks: Bookmark[]; duplicateCount: number } {
  const result: Bookmark[] = [];
  const indexByIdentity = new Map<string, number>();
  let duplicateCount = 0;

  for (const item of bookmarks) {
    const identity = urlIdentity(item.url);
    if (!identity) continue;

    const existingIndex = indexByIdentity.get(identity);
    if (existingIndex === undefined) {
      let normalizedFirst = item;
      const rawIcon = item.iconUrl?.trim();
      if (rawIcon) {
        const normalizedIcon = normalizeUrl(rawIcon);
        if (normalizedIcon && normalizedIcon !== item.iconUrl) {
          normalizedFirst = { ...item, iconUrl: normalizedIcon };
        }
      }
      indexByIdentity.set(identity, result.length);
      result.push(normalizedFirst);
    } else {
      duplicateCount += 1;
      const { bookmark: enriched } = enrichBookmark(result[existingIndex], item);
      result[existingIndex] = enriched;
    }
  }

  return { bookmarks: result, duplicateCount };
}

function safeSectionName(rawSection: string): string {
  const cleaned = rawSection.trim();
  if (!cleaned || cleaned.toLocaleLowerCase() === 'all') {
    return 'Uncategorized';
  }
  return cleaned;
}

function buildSectionMap(bookmarks: readonly Bookmark[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const bookmark of bookmarks) {
    const key = bookmark.section.toLocaleLowerCase();
    if (!map.has(key)) {
      map.set(key, bookmark.section);
    }
  }
  return map;
}

function resolveIncomingSection(
  rawSection: string,
  sectionMap: Map<string, string>,
): string {
  const safe = safeSectionName(rawSection);
  const key = safe.toLocaleLowerCase();
  const found = sectionMap.get(key);
  if (found) return found;
  sectionMap.set(key, safe);
  return safe;
}

function normalizeForReplace(
  bookmark: Bookmark,
  sectionMap: Map<string, string>,
): Bookmark {
  const section = resolveIncomingSection(bookmark.section, sectionMap);
  const rawIcon = bookmark.iconUrl?.trim();
  const normalizedIcon = rawIcon ? normalizeUrl(rawIcon) : '';

  if (section === bookmark.section && (!rawIcon || normalizedIcon === bookmark.iconUrl)) {
    return bookmark;
  }

  const next: Bookmark = { ...bookmark, section };
  if (rawIcon && normalizedIcon) {
    next.iconUrl = normalizedIcon;
  } else if (rawIcon && !normalizedIcon) {
    delete next.iconUrl;
  }
  return next;
}

function computeBookmarkDiffInternal(
  existing: readonly Bookmark[],
  dedupedIncoming: readonly Bookmark[],
): {
  diff: BookmarkDiffReport;
  replaceNormalized: Bookmark[];
  replaceTargetByIncoming: Map<Bookmark, Bookmark>;
} {
  const existingById = new Map<string, Bookmark>();
  for (const bookmark of existing) {
    const id = urlIdentity(bookmark.url);
    if (id && !existingById.has(id)) {
      existingById.set(id, bookmark);
    }
  }

  const replaceSectionMap = new Map<string, string>();
  const replaceNormalized: Bookmark[] = [];
  const replaceTargetByIncoming = new Map<Bookmark, Bookmark>();

  const matchedExisting = new Set<Bookmark>();
  const added: Bookmark[] = [];
  const matched: MatchedBookmarkDiff[] = [];

  for (const inc of dedupedIncoming) {
    const id = urlIdentity(inc.url);
    if (!id) continue;

    const normalizedReplaceTarget = normalizeForReplace(inc, replaceSectionMap);
    replaceNormalized.push(normalizedReplaceTarget);
    replaceTargetByIncoming.set(inc, normalizedReplaceTarget);

    const ex = existingById.get(id);
    if (!ex) {
      added.push(inc);
      continue;
    }

    matchedExisting.add(ex);
    const { bookmark: enriched, changedFields: enrichFields } = enrichBookmark(ex, inc);
    const replaceDiffFields = getChangedBookmarkFields(ex, normalizedReplaceTarget);
    matched.push({
      identity: id,
      existing: ex,
      incoming: inc,
      enriched,
      enrichFields,
      replaceDiffFields,
    });
  }

  const localOnly = existing.filter((bookmark) => !matchedExisting.has(bookmark));

  return {
    diff: { added, matched, localOnly },
    replaceNormalized,
    replaceTargetByIncoming,
  };
}

export function computeBookmarkDiff(
  existing: readonly Bookmark[],
  incoming: readonly Bookmark[],
): BookmarkDiffReport {
  const { bookmarks: dedupedIncoming } = deduplicateBookmarks(incoming);
  return computeBookmarkDiffInternal(existing, dedupedIncoming).diff;
}

export function applyBookmarkMerge(
  existing: readonly Bookmark[],
  incoming: readonly Bookmark[],
  strategy: MergeStrategy,
): Bookmark[] {
  const { bookmarks: dedupedIncoming } = deduplicateBookmarks(incoming);

  if (strategy === 'replace') {
    const replaceSectionMap = new Map<string, string>();
    return groupBookmarksBySection(
      dedupedIncoming.map((item) => normalizeForReplace(item, replaceSectionMap)),
    );
  }

  const { diff } = computeBookmarkDiffInternal(existing, dedupedIncoming);
  const existingSectionMap = buildSectionMap(existing);

  const enrichedByExistingRef = new Map<Bookmark, Bookmark>();
  if (strategy === 'merge') {
    for (const entry of diff.matched) {
      if (entry.enriched !== entry.existing) {
        enrichedByExistingRef.set(entry.existing, entry.enriched);
      }
    }
  }

  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of existing) {
    const resolved = strategy === 'merge'
      ? (enrichedByExistingRef.get(bookmark) ?? bookmark)
      : bookmark;
    let bucket = groups.get(resolved.section);
    if (!bucket) {
      bucket = [];
      groups.set(resolved.section, bucket);
    }
    bucket.push(resolved);
  }

  for (const item of diff.added) {
    const targetSection = resolveIncomingSection(item.section, existingSectionMap);
    const normalized = targetSection === item.section
      ? item
      : { ...item, section: targetSection };
    let bucket = groups.get(normalized.section);
    if (!bucket) {
      bucket = [];
      groups.set(normalized.section, bucket);
    }
    bucket.push(normalized);
  }

  return [...groups.values()].flat();
}

export function previewBookmarkMerge(
  existing: readonly Bookmark[],
  incoming: readonly Bookmark[],
  strategy: MergeStrategy,
): StrategyPreview {
  const { bookmarks: dedupedIncoming } = deduplicateBookmarks(incoming);
  const {
    diff,
    replaceNormalized,
    replaceTargetByIncoming,
  } = computeBookmarkDiffInternal(existing, dedupedIncoming);
  const existingSectionMap = buildSectionMap(existing);

  const resolvedAdded = diff.added.map((item) => {
    if (strategy === 'replace') {
      return replaceTargetByIncoming.get(item) ?? normalizeForReplace(item, new Map());
    }
    const targetSection = resolveIncomingSection(item.section, existingSectionMap);
    return targetSection === item.section ? item : { ...item, section: targetSection };
  });

  if (strategy === 'merge') {
    const enrichedMatches = diff.matched.filter((entry) => entry.enrichFields.length > 0);
    const affectedRows: StrategyPreviewRow[] = [
      ...resolvedAdded.map((bookmark): StrategyPreviewRow => ({
        kind: 'added',
        bookmark,
      })),
      ...enrichedMatches.map((entry): StrategyPreviewRow => ({
        kind: 'enriched',
        bookmark: entry.enriched,
        previous: entry.existing,
        changedFields: entry.enrichFields,
      })),
    ];
    const addedCount = resolvedAdded.length;
    const changedCount = enrichedMatches.length;
    return {
      strategy,
      addedCount,
      changedCount,
      unchangedCount: diff.matched.length - changedCount,
      localKeptCount: diff.localOnly.length,
      removedCount: 0,
      orderChanged: false,
      affectedRows,
      hasEffectiveChanges: addedCount > 0 || changedCount > 0,
    };
  }

  if (strategy === 'append') {
    const affectedRows: StrategyPreviewRow[] = resolvedAdded.map(
      (bookmark): StrategyPreviewRow => ({
        kind: 'added',
        bookmark,
      }),
    );
    const addedCount = resolvedAdded.length;
    return {
      strategy,
      addedCount,
      changedCount: 0,
      unchangedCount: diff.matched.length,
      localKeptCount: diff.localOnly.length,
      removedCount: 0,
      orderChanged: false,
      affectedRows,
      hasEffectiveChanges: addedCount > 0,
    };
  }

  const modifiedMatches = diff.matched.filter((entry) => {
    const target = replaceTargetByIncoming.get(entry.incoming)
      ?? normalizeForReplace(entry.incoming, new Map());
    return !areBookmarksEqual(entry.existing, target);
  });
  const replaced = groupBookmarksBySection(replaceNormalized);
  const addedCount = resolvedAdded.length;
  const changedCount = modifiedMatches.length;
  const removedCount = diff.localOnly.length;
  const orderChanged = addedCount === 0
    && changedCount === 0
    && removedCount === 0
    && computeBookmarksHash(replaced) !== computeBookmarksHash(existing);

  const affectedRows: StrategyPreviewRow[] = [
    ...resolvedAdded.map((bookmark): StrategyPreviewRow => ({
      kind: 'added',
      bookmark,
    })),
    ...modifiedMatches.map((entry): StrategyPreviewRow => ({
      kind: 'modified',
      bookmark: replaceTargetByIncoming.get(entry.incoming)
        ?? normalizeForReplace(entry.incoming, new Map()),
      previous: entry.existing,
      changedFields: entry.replaceDiffFields,
    })),
    ...diff.localOnly.map((bookmark): StrategyPreviewRow => ({
      kind: 'removed',
      bookmark,
    })),
  ];

  return {
    strategy,
    addedCount,
    changedCount,
    unchangedCount: diff.matched.length - changedCount,
    localKeptCount: 0,
    removedCount,
    orderChanged,
    affectedRows,
    hasEffectiveChanges: addedCount > 0 || changedCount > 0 || removedCount > 0 || orderChanged,
  };
}
