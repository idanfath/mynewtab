import {
  classifyStoredDataFailure,
  findBookmarkShortcut,
  getBookmarkShortcuts,
  type Bookmark,
  type StoredDataFailure,
} from './bookmarks.ts';
import { cloneWithoutProto } from './bookmarkMerge.ts';
import {
  buildSearchUrl,
  getFaviconUrl,
  isBareHostWithPort,
  isLocalOrPrivateHost,
  isPublicSearchableHost,
  normalizeAlias,
  normalizeSearchUrl,
  normalizeUrl,
  safeHostname,
} from './lib.ts';

export const OMNIBAR_STORAGE_KEY = 'newtab-directory-omnibar';
export const OMNIBAR_BACKUP_KEY = `${OMNIBAR_STORAGE_KEY}-corrupt-backup`;

export type SearchEnginePresetId =
  | 'duckduckgo'
  | 'google'
  | 'brave'
  | 'kagi'
  | 'perplexity'
  | 'custom';

export interface SearchEnginePreset {
  id: Exclude<SearchEnginePresetId, 'custom'>;
  label: string;
  shortBadge: string;
  homeUrl: string;
  searchUrl: string;
}

export interface BuiltInBang {
  trigger: string;
  label: string;
  homeUrl: string;
  searchUrl: string;
}

export interface CustomBang {
  trigger: string;
  label: string;
  searchUrl: string;
  homeUrl?: string;
}

export interface OmnibarSettings {
  version: 1;
  defaultEngine: SearchEnginePresetId;
  customSearchName?: string;
  customSearchUrl?: string;
  customBangs: CustomBang[];
  disabledBuiltInBangs?: string[];
}

export interface SettingsFileEnvelope {
  kind: 'mynewtab-settings';
  version: 1;
  omnibar: OmnibarSettings;
  [key: string]: unknown;
}

export interface ParsedSettingsImport {
  settings: OmnibarSettings;
  extraSections: Record<string, unknown>;
}

export interface BookmarkBangShortcutItem {
  alias: string;
  queryUrl?: string;
  targetLabel: string;
  overrideNote?: string;
}

export interface BookmarkBangDirectoryEntry {
  bookmark: Bookmark;
  shortcuts: BookmarkBangShortcutItem[];
}

export interface EmptyOmnibarViewState {
  isSearchExpanded: boolean;
  isDrawerOpen: boolean;
  displayedAction: OmnibarAction;
  triggerTabIndex: -1 | undefined;
  inputTabIndex: -1 | undefined;
  resultTabIndex: -1 | undefined;
}

export type OmnibarActionKind =
  | 'bang-search'
  | 'bang-jump'
  | 'bang-incomplete'
  | 'bang-unknown'
  | 'url'
  | 'bookmark-alias'
  | 'web-search';

export interface OmnibarAction {
  kind: OmnibarActionKind;
  url: string;
  title: string;
  subtitle: string;
  badge: string;
  iconUrl?: string;
  autoSelect: boolean;
  tabCompletion?: string;
  matchedBookmark?: Bookmark;
}

export type OmnibarEffectiveTarget =
  | { kind: 'omnibar'; action: OmnibarAction }
  | { kind: 'bookmark'; bookmark: Bookmark }
  | null;

export const DEFAULT_OMNIBAR_SETTINGS: OmnibarSettings = {
  version: 1,
  defaultEngine: 'duckduckgo',
  customBangs: [],
};

export const SEARCH_ENGINE_PRESETS: Record<
  Exclude<SearchEnginePresetId, 'custom'>,
  SearchEnginePreset
> = {
  duckduckgo: {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    shortBadge: 'DDG',
    homeUrl: 'https://duckduckgo.com/',
    searchUrl: 'https://duckduckgo.com/?q=%s',
  },
  google: {
    id: 'google',
    label: 'Google',
    shortBadge: 'GOOGLE',
    homeUrl: 'https://www.google.com/',
    searchUrl: 'https://www.google.com/search?q=%s',
  },
  brave: {
    id: 'brave',
    label: 'Brave Search',
    shortBadge: 'BRAVE',
    homeUrl: 'https://search.brave.com/',
    searchUrl: 'https://search.brave.com/search?q=%s',
  },
  kagi: {
    id: 'kagi',
    label: 'Kagi',
    shortBadge: 'KAGI',
    homeUrl: 'https://kagi.com/',
    searchUrl: 'https://kagi.com/search?q=%s',
  },
  perplexity: {
    id: 'perplexity',
    label: 'Perplexity',
    shortBadge: 'PPX',
    homeUrl: 'https://www.perplexity.ai/',
    searchUrl: 'https://www.perplexity.ai/search?q=%s',
  },
};

export const BUILT_IN_BANGS: readonly BuiltInBang[] = [
  {
    trigger: 'g',
    label: 'Google',
    homeUrl: 'https://www.google.com/',
    searchUrl: 'https://www.google.com/search?q=%s',
  },
  {
    trigger: 'ddg',
    label: 'DuckDuckGo',
    homeUrl: 'https://duckduckgo.com/',
    searchUrl: 'https://duckduckgo.com/?q=%s',
  },
  {
    trigger: 'br',
    label: 'Brave Search',
    homeUrl: 'https://search.brave.com/',
    searchUrl: 'https://search.brave.com/search?q=%s',
  },
  {
    trigger: 'kagi',
    label: 'Kagi',
    homeUrl: 'https://kagi.com/',
    searchUrl: 'https://kagi.com/search?q=%s',
  },
  {
    trigger: 'ppx',
    label: 'Perplexity',
    homeUrl: 'https://www.perplexity.ai/',
    searchUrl: 'https://www.perplexity.ai/search?q=%s',
  },
  {
    trigger: 'w',
    label: 'Wikipedia',
    homeUrl: 'https://en.wikipedia.org/',
    searchUrl: 'https://en.wikipedia.org/w/index.php?search=%s',
  },
  {
    trigger: 'yt',
    label: 'YouTube',
    homeUrl: 'https://www.youtube.com/',
    searchUrl: 'https://www.youtube.com/results?search_query=%s',
  },
  {
    trigger: 'gh',
    label: 'GitHub',
    homeUrl: 'https://github.com/',
    searchUrl: 'https://github.com/search?q=%s',
  },
  {
    trigger: 'npm',
    label: 'npm',
    homeUrl: 'https://www.npmjs.com/',
    searchUrl: 'https://www.npmjs.com/search?q=%s',
  },
  {
    trigger: 'mdn',
    label: 'MDN',
    homeUrl: 'https://developer.mozilla.org/',
    searchUrl: 'https://developer.mozilla.org/en-US/search?q=%s',
  },
  {
    trigger: 'so',
    label: 'Stack Overflow',
    homeUrl: 'https://stackoverflow.com/',
    searchUrl: 'https://stackoverflow.com/search?q=%s',
  },
  {
    trigger: 'hn',
    label: 'Hacker News',
    homeUrl: 'https://news.ycombinator.com/',
    searchUrl: 'https://hn.algolia.com/?q=%s',
  },
  {
    trigger: 'r',
    label: 'Reddit',
    homeUrl: 'https://www.reddit.com/',
    searchUrl: 'https://www.reddit.com/search/?q=%s',
  },
  {
    trigger: 'maps',
    label: 'Google Maps',
    homeUrl: 'https://www.google.com/maps',
    searchUrl: 'https://www.google.com/maps/search/%s',
  },
];

const VALID_ENGINE_IDS = new Set<SearchEnginePresetId>([
  'duckduckgo',
  'google',
  'brave',
  'kagi',
  'perplexity',
  'custom',
]);

const BUILT_IN_BANG_TRIGGERS = new Set<string>(
  BUILT_IN_BANGS.map((bang) => bang.trigger),
);

export function isBuiltInBangEnabled(
  settings: OmnibarSettings,
  trigger: string,
): boolean {
  if (!settings.disabledBuiltInBangs?.length) return true;
  const normalized = normalizeAlias(trigger);
  if (!normalized) return false;
  return !settings.disabledBuiltInBangs.some(
    (disabled) => normalizeAlias(disabled) === normalized,
  );
}

export function getEnabledBuiltInBangs(
  settings: OmnibarSettings,
): BuiltInBang[] {
  if (!settings.disabledBuiltInBangs?.length) return [...BUILT_IN_BANGS];
  const disabledSet = new Set(
    settings.disabledBuiltInBangs
      .map((trigger) => normalizeAlias(trigger))
      .filter(Boolean),
  );
  return BUILT_IN_BANGS.filter((bang) => !disabledSet.has(bang.trigger));
}

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const RECOGNIZED_TLDS = new Set([
  // Standard 2-letter ISO ccTLDs
  'ac', 'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az',
  'ba', 'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bv', 'bw', 'by', 'bz',
  'ca', 'cc', 'cd', 'cf', 'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cw', 'cx', 'cy', 'cz',
  'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'er', 'es', 'et', 'eu', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr',
  'ga', 'gb', 'gd', 'ge', 'gf', 'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy',
  'hk', 'hm', 'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il', 'im', 'in', 'io', 'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp',
  'ke', 'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls', 'lt', 'lu', 'lv', 'ly',
  'ma', 'mc', 'md', 'me', 'mf', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz',
  'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py',
  'qa', 're', 'ro', 'rs', 'ru', 'rw', 'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss', 'st', 'su', 'sv', 'sx', 'sy', 'sz',
  'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'uk', 'us', 'uy', 'uz',
  'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu', 'wf', 'ws', 'ye', 'yt', 'za', 'zm', 'zw',
  // Common web & developer gTLDs (excludes code/config/asset extensions like js, ts, tsx, json, css, html, go, java, etc.)
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'pro', 'xyz', 'online', 'site', 'tech', 'store',
  'blog', 'app', 'dev', 'page', 'cloud', 'tools', 'design', 'studio', 'work', 'world', 'live', 'news', 'media',
  'video', 'social', 'community', 'network', 'systems', 'solutions', 'services', 'digital', 'agency', 'company',
  'team', 'group', 'space', 'zone', 'link', 'click', 'wtf', 'lol', 'fun', 'games', 'run', 'codes', 'software',
  'rocks', 'ninja', 'wiki', 'guide', 'docs', 'chat', 'email', 'money', 'finance', 'art', 'music', 'film', 'zip', 'mov',
]);

function isStrictIpv4(host: string): boolean {
  const match = host.match(
    /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/,
  );
  if (!match) return false;
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

function stripWww(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

function resolveTemplateHomeUrl(
  template: string,
  explicitHomeUrl: string | undefined,
  fallbackHomeUrl: string,
): string {
  const directHome = explicitHomeUrl ? normalizeUrl(explicitHomeUrl) : '';
  if (directHome) return directHome;
  const normalizedTemplate = normalizeSearchUrl(template);
  if (normalizedTemplate) {
    try {
      return `${new URL(normalizedTemplate.replaceAll('%s', '0')).origin}/`;
    } catch {
      // fall through to fallbackHomeUrl
    }
  }
  return fallbackHomeUrl;
}

function compactUrlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const hostPort = parsed.host.replace(/^www\./i, '');
    const rest = `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${hostPort}${rest}`;
  } catch {
    return url;
  }
}

const SETTINGS_INDICATOR_KEYS = [
  'omnibar',
  'defaultEngine',
  'customBangs',
  'disabledBuiltInBangs',
  'customSearchUrl',
  'customSearchName',
] as const;

export function isSettingsJsonObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.kind === 'mynewtab-settings') {
    return true;
  }
  return SETTINGS_INDICATOR_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(record, key),
  );
}

function sanitizeExtraSections(
  extraSections?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!extraSections) return out;
  for (const [key, value] of Object.entries(extraSections)) {
    if (
      key === 'kind'
      || key === 'version'
      || key === 'omnibar'
      || key === '__proto__'
      || key === 'constructor'
      || key === 'prototype'
      || value === undefined
    ) {
      continue;
    }
    out[key] = cloneWithoutProto(value);
  }
  return out;
}

function validateOmnibarSettingsRecord(
  record: Record<string, unknown>,
): OmnibarSettings {
  if (record.version !== undefined && record.version !== 1) {
    throw new Error('Unsupported omnibar settings version.');
  }

  if (
    typeof record.defaultEngine !== 'string'
    || !VALID_ENGINE_IDS.has(record.defaultEngine as SearchEnginePresetId)
  ) {
    throw new Error('Omnibar defaultEngine must be a valid search engine preset.');
  }
  const defaultEngine = record.defaultEngine as SearchEnginePresetId;

  const result: OmnibarSettings = {
    version: 1,
    defaultEngine,
    customBangs: [],
  };

  if (record.customSearchName !== undefined) {
    if (typeof record.customSearchName !== 'string') {
      throw new Error('Omnibar customSearchName must be a string.');
    }
    const trimmedName = record.customSearchName.trim();
    if (trimmedName !== '') {
      result.customSearchName = trimmedName;
    }
  }

  if (record.customSearchUrl !== undefined && typeof record.customSearchUrl !== 'string') {
    throw new Error('Omnibar customSearchUrl must be a string.');
  }
  const rawCustomUrl = typeof record.customSearchUrl === 'string'
    ? record.customSearchUrl.trim()
    : '';

  if (defaultEngine === 'custom') {
    const normalized = normalizeSearchUrl(rawCustomUrl);
    if (!normalized) {
      throw new Error(
        'Custom search engine requires a valid HTTP(S) search URL containing %s.',
      );
    }
    result.customSearchUrl = normalized;
  } else if (rawCustomUrl !== '') {
    const normalized = normalizeSearchUrl(rawCustomUrl);
    if (!normalized) {
      throw new Error(
        'Omnibar customSearchUrl must be a valid HTTP(S) search URL containing %s.',
      );
    }
    result.customSearchUrl = normalized;
  }

  if (record.customBangs !== undefined) {
    if (!Array.isArray(record.customBangs)) {
      throw new Error('Omnibar customBangs must be an array.');
    }
    const seenTriggers = new Set<string>();
    const customBangs: CustomBang[] = [];

    record.customBangs.forEach((item: unknown, idx: number) => {
      const bangNum = idx + 1;
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new Error(`Custom bang ${bangNum} must be an object.`);
      }
      const entry = item as Record<string, unknown>;
      const trigger = normalizeAlias(
        typeof entry.trigger === 'string' ? entry.trigger : '',
      );
      if (!trigger) {
        throw new Error(
          `Custom bang ${bangNum}.trigger must be 1-32 lowercase letters, numbers, or hyphens.`,
        );
      }
      if (seenTriggers.has(trigger)) {
        throw new Error(`Custom bang ${bangNum}.trigger duplicates "${trigger}".`);
      }
      seenTriggers.add(trigger);

      const label = typeof entry.label === 'string' ? entry.label.trim() : '';
      if (!label) {
        throw new Error(`Custom bang ${bangNum}.label must be a non-empty string.`);
      }

      const searchUrl = normalizeSearchUrl(
        typeof entry.searchUrl === 'string' ? entry.searchUrl : '',
      );
      if (!searchUrl) {
        throw new Error(
          `Custom bang ${bangNum}.searchUrl must be a valid HTTP(S) search URL containing %s.`,
        );
      }

      const parsedBang: CustomBang = { trigger, label, searchUrl };
      if (entry.homeUrl !== undefined) {
        if (typeof entry.homeUrl !== 'string') {
          throw new Error(`Custom bang ${bangNum}.homeUrl must be a string.`);
        }
        const trimmedHome = entry.homeUrl.trim();
        if (trimmedHome !== '') {
          const normalizedHome = normalizeUrl(trimmedHome);
          if (!normalizedHome) {
            throw new Error(
              `Custom bang ${bangNum}.homeUrl must be a valid HTTP(S) URL.`,
            );
          }
          parsedBang.homeUrl = normalizedHome;
        }
      }
      customBangs.push(parsedBang);
    });

    result.customBangs = customBangs;
  }

  if (record.disabledBuiltInBangs !== undefined) {
    if (!Array.isArray(record.disabledBuiltInBangs)) {
      throw new Error('Omnibar disabledBuiltInBangs must be an array.');
    }
    const disabledSet = new Set<string>();
    record.disabledBuiltInBangs.forEach((entry: unknown, idx: number) => {
      if (typeof entry !== 'string') {
        throw new Error(
          `Disabled built-in bang ${idx + 1} must be a string.`,
        );
      }
      const normalized = normalizeAlias(entry);
      if (!normalized) {
        throw new Error(
          `Disabled built-in bang ${idx + 1} must be a valid bang trigger.`,
        );
      }
      if (BUILT_IN_BANG_TRIGGERS.has(normalized)) {
        disabledSet.add(normalized);
      }
    });

    const orderedDisabled = BUILT_IN_BANGS
      .map((bang) => bang.trigger)
      .filter((trigger) => disabledSet.has(trigger));
    if (orderedDisabled.length > 0) {
      result.disabledBuiltInBangs = orderedDisabled;
    }
  }

  return result;
}

function extractSettingsEnvelope(value: unknown): ParsedSettingsImport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object for omnibar settings.');
  }

  const record = value as Record<string, unknown>;
  if (record.kind === 'mynewtab-settings') {
    if (record.version !== undefined && record.version !== 1) {
      throw new Error('Unsupported settings file version.');
    }
    if (
      typeof record.omnibar !== 'object'
      || record.omnibar === null
      || Array.isArray(record.omnibar)
    ) {
      throw new Error('Settings file is missing an "omnibar" object.');
    }
    const settings = validateOmnibarSettingsRecord(
      record.omnibar as Record<string, unknown>,
    );
    const extraSections = sanitizeExtraSections(record);
    return { settings, extraSections };
  }

  return {
    settings: validateOmnibarSettingsRecord(record),
    extraSections: {},
  };
}

export function parseOmnibarSettings(content: string): OmnibarSettings {
  const stripped = content.replace(/^\uFEFF/, '');
  if (!stripped.trim()) {
    return { ...DEFAULT_OMNIBAR_SETTINGS, customBangs: [] };
  }
  const value: unknown = JSON.parse(stripped);
  return extractSettingsEnvelope(value).settings;
}

export function parseSettingsFile(content: string): ParsedSettingsImport {
  const stripped = content.replace(/^\uFEFF/, '').trim();
  if (!stripped) {
    throw new Error('No settings found in JSON file.');
  }
  const value: unknown = JSON.parse(stripped);
  return extractSettingsEnvelope(value);
}

export function serializeSettingsJson(
  settings: OmnibarSettings,
  extraSections: Record<string, unknown> = {},
): string {
  const omnibar: Record<string, unknown> = {
    defaultEngine: settings.defaultEngine,
  };
  if (settings.customSearchName?.trim()) {
    omnibar.customSearchName = settings.customSearchName.trim();
  }
  if (settings.customSearchUrl?.trim()) {
    omnibar.customSearchUrl = settings.customSearchUrl.trim();
  }
  omnibar.disabledBuiltInBangs = settings.disabledBuiltInBangs ?? [];
  omnibar.customBangs = settings.customBangs;

  const envelope: Record<string, unknown> = {
    kind: 'mynewtab-settings',
    version: 1,
    omnibar,
    ...sanitizeExtraSections(extraSections),
  };
  return JSON.stringify(envelope, null, 2);
}

export function serializeOmnibarStorageValue(
  settings: OmnibarSettings,
  extraSections?: Record<string, unknown>,
): string {
  const sanitizedExtra = sanitizeExtraSections(extraSections);
  if (Object.keys(sanitizedExtra).length > 0) {
    return JSON.stringify({
      kind: 'mynewtab-settings',
      version: 1,
      omnibar: settings,
      ...sanitizedExtra,
    });
  }
  return JSON.stringify(settings);
}

export function collectBookmarkBangEntries(
  bookmarks: readonly Bookmark[],
  activeCustomTriggers: ReadonlySet<string>,
  disabledBuiltInTriggers?: ReadonlySet<string>,
): BookmarkBangDirectoryEntry[] {
  const normalizedCustomTriggers = new Set<string>();
  for (const trigger of activeCustomTriggers) {
    const normalized = normalizeAlias(trigger);
    if (normalized) normalizedCustomTriggers.add(normalized);
  }
  const normalizedDisabledBuiltIns = new Set<string>();
  if (disabledBuiltInTriggers) {
    for (const trigger of disabledBuiltInTriggers) {
      const normalized = normalizeAlias(trigger);
      if (normalized) normalizedDisabledBuiltIns.add(normalized);
    }
  }

  const entries: BookmarkBangDirectoryEntry[] = [];
  for (const bookmark of bookmarks) {
    const rawShortcuts = getBookmarkShortcuts(bookmark);
    if (rawShortcuts.length === 0) continue;

    const shortcuts: BookmarkBangShortcutItem[] = rawShortcuts.map((sc) => {
      let overrideNote: string | undefined;
      if (sc.queryUrl && normalizedCustomTriggers.has(sc.alias)) {
        overrideNote = 'Overrides custom !bang';
      } else if (!sc.queryUrl && normalizedCustomTriggers.has(sc.alias)) {
        overrideNote = `Bare !${sc.alias} opens bookmark · !${sc.alias} <query> uses custom !bang`;
      } else if (
        BUILT_IN_BANGS.some(
          (b) => b.trigger === sc.alias && !normalizedDisabledBuiltIns.has(b.trigger),
        )
      ) {
        overrideNote = 'Overrides built-in !bang';
      }

      const targetLabel = sc.queryUrl ?? `Jump to ${safeHostname(bookmark.url) || bookmark.url}`;
      return {
        alias: sc.alias,
        ...(sc.queryUrl ? { queryUrl: sc.queryUrl } : {}),
        targetLabel,
        ...(overrideNote ? { overrideNote } : {}),
      };
    });

    entries.push({ bookmark, shortcuts });
  }
  return entries;
}

export function resolvePreservedCustomBangHomeUrl(
  existingHomeUrl: string | undefined,
  initialSearchUrl: string | undefined,
  nextSearchUrl: string,
): string | undefined {
  const normalizedHome = existingHomeUrl ? normalizeUrl(existingHomeUrl) : '';
  if (!normalizedHome) return undefined;

  const nextProbe = normalizeSearchUrl(nextSearchUrl);
  if (!nextProbe) return undefined;
  const nextOrigin = new URL(nextProbe.replaceAll('%s', '0')).origin;

  const initialProbe = initialSearchUrl ? normalizeSearchUrl(initialSearchUrl) : '';
  const initialOrigin = initialProbe
    ? new URL(initialProbe.replaceAll('%s', '0')).origin
    : '';

  if (
    (initialOrigin && initialOrigin === nextOrigin)
    || new URL(normalizedHome).origin === nextOrigin
  ) {
    return normalizedHome;
  }
  return undefined;
}

export function loadStoredOmnibarSettings(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): {
  settings: OmnibarSettings;
  extraSections?: Record<string, unknown>;
  recovery?: 'backed-up' | 'backup-failed';
  failure?: StoredDataFailure;
} {
  const stored = storage.getItem(OMNIBAR_STORAGE_KEY);
  if (!stored || !stored.trim()) {
    return { settings: { ...DEFAULT_OMNIBAR_SETTINGS, customBangs: [] } };
  }

  try {
    const parsed = parseSettingsFile(stored);
    return {
      settings: parsed.settings,
      ...(Object.keys(parsed.extraSections).length > 0
        ? { extraSections: parsed.extraSections }
        : {}),
    };
  } catch (parseError) {
    const failure = classifyStoredDataFailure(parseError);
    try {
      storage.setItem(OMNIBAR_BACKUP_KEY, stored);
      return {
        settings: { ...DEFAULT_OMNIBAR_SETTINGS, customBangs: [] },
        recovery: 'backed-up',
        failure,
      };
    } catch {
      return {
        settings: { ...DEFAULT_OMNIBAR_SETTINGS, customBangs: [] },
        recovery: 'backup-failed',
        failure,
      };
    }
  }
}

export function getActiveSearchEngine(settings: OmnibarSettings): {
  id: SearchEnginePresetId;
  label: string;
  shortBadge: string;
  homeUrl: string;
  searchUrl: string;
} {
  if (settings.defaultEngine === 'custom') {
    const normalized = normalizeSearchUrl(settings.customSearchUrl ?? '');
    if (normalized) {
      const probe = new URL(normalized.replaceAll('%s', '0'));
      const homeUrl = `${probe.origin}/`;
      const label = settings.customSearchName?.trim() || stripWww(probe.hostname);
      return {
        id: 'custom',
        label,
        shortBadge: 'WEB',
        homeUrl,
        searchUrl: normalized,
      };
    }
  }
  return SEARCH_ENGINE_PRESETS[
    settings.defaultEngine === 'custom' ? 'duckduckgo' : settings.defaultEngine
  ];
}

export function getBookmarkOmnibarIcon(bookmark: Bookmark): string | undefined {
  const customIcon = bookmark.iconUrl ? normalizeUrl(bookmark.iconUrl) : '';
  if (customIcon) return customIcon;
  const favicon = getFaviconUrl(bookmark.url, 64);
  return favicon || undefined;
}

export function detectDirectUrl(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.startsWith('!') || /\s/.test(trimmed) || /^[/\\?#]/.test(trimmed)) {
    return '';
  }

  // 1. Explicit http:// or https://
  const httpMatch = trimmed.match(/^https?:\/\/([\s\S]*)$/i);
  if (httpMatch) {
    const normalized = normalizeUrl(trimmed);
    if (!normalized) return '';

    const authority = httpMatch[1].split(/[/?#]/, 1)[0];
    if (!authority || authority.includes('\\')) return '';
    const atIndex = authority.lastIndexOf('@');
    const hostPort = atIndex >= 0 ? authority.slice(atIndex + 1) : authority;
    if (!hostPort) return '';

    if (hostPort.startsWith('[')) {
      const ipv6Match = hostPort.match(/^(\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i);
      if (!ipv6Match) return '';
      if (ipv6Match[2] !== undefined) {
        const port = Number(ipv6Match[2]);
        if (port < 1 || port > 65535) return '';
      }
      return normalized;
    }

    const hostPortMatch = hostPort.match(/^([^:]+)(?::(\d{1,5}))?$/);
    if (!hostPortMatch) return '';
    const [, rawHost, rawPort] = hostPortMatch;
    if (rawPort !== undefined) {
      const port = Number(rawPort);
      if (port < 1 || port > 65535) return '';
    }

    if (rawHost.toLowerCase().replace(/\.$/, '') === 'localhost' && !rawHost.endsWith('..')) {
      return normalized;
    }
    if (/^[\d.]+$/.test(rawHost)) {
      return isStrictIpv4(rawHost) ? normalized : '';
    }

    const parsedHost = new URL(normalized).hostname.replace(/\.$/, '');
    const labels = parsedHost.split('.');
    if (
      !parsedHost
      || labels.some((label) => !DNS_LABEL_PATTERN.test(label))
      || /^\d+$/.test(labels[labels.length - 1])
    ) {
      return '';
    }
    return normalized;
  }

  // 2. Reject non-HTTP(S) schemes unless bare host:port
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !isBareHostWithPort(trimmed)) {
    return '';
  }

  // 3. No-scheme inputs
  const authority = trimmed.split(/[/?#]/, 1)[0];
  const rest = trimmed.slice(authority.length);
  if (!authority || authority.includes('@') || authority.includes('\\')) {
    return '';
  }

  if (authority.startsWith('[')) {
    const ipv6Match = authority.match(/^(\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i);
    if (!ipv6Match) return '';
    if (ipv6Match[2] !== undefined) {
      const port = Number(ipv6Match[2]);
      if (port < 1 || port > 65535) return '';
    }
    return normalizeUrl(trimmed);
  }

  const hostPortMatch = authority.match(/^([^:]+)(?::(\d{1,5}))?$/);
  if (!hostPortMatch) return '';
  const [, rawHost, rawPort] = hostPortMatch;
  if (rawPort !== undefined) {
    const port = Number(rawPort);
    if (port < 1 || port > 65535) return '';
  }

  if (/^[\d.]+$/.test(rawHost)) {
    if (!isStrictIpv4(rawHost)) return '';
    const useHttp = isLocalOrPrivateHost(rawHost)
      || (rawPort !== undefined && rawPort !== '443');
    return normalizeUrl(`${useHttp ? 'http' : 'https'}://${trimmed}`);
  }

  if (rawHost.endsWith('..')) return '';
  const hostWithoutTrailingDot = rawHost.replace(/\.$/, '');
  const lowerHost = hostWithoutTrailingDot.toLowerCase();
  if (
    lowerHost === 'localhost'
    || lowerHost.endsWith('.localhost')
    || lowerHost.endsWith('.local')
    || lowerHost.endsWith('.internal')
    || lowerHost.endsWith('.lan')
  ) {
    const labels = lowerHost.split('.');
    return labels.every((label) => DNS_LABEL_PATTERN.test(label))
      ? normalizeUrl(trimmed)
      : '';
  }

  const labels = hostWithoutTrailingDot.split('.');
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL_PATTERN.test(label))) {
    return '';
  }

  const tld = labels[labels.length - 1].toLowerCase();
  if (/^\d+$/.test(tld)) return '';
  if (rawPort !== undefined) return normalizeUrl(trimmed);

  if (!RECOGNIZED_TLDS.has(tld) && !/^xn--[a-z0-9]{2,59}$/.test(tld)) {
    return '';
  }
  if ((tld === 'zip' || tld === 'mov') && !rest.startsWith('/')) {
    return '';
  }
  if (
    labels.length === 2
    && rest === ''
    && /^(?:readme|changelog|license|contributing|product|agents|claude|todo|notes|index|main|app|setup|config)\.(?:md|py|pl|sh|rs)$/i.test(hostWithoutTrailingDot)
  ) {
    return '';
  }

  return normalizeUrl(trimmed);
}

export function resolveOmnibar(
  rawQuery: string,
  bookmarks: readonly Bookmark[],
  settings: OmnibarSettings,
  sectionMatches: readonly Bookmark[],
): OmnibarAction | null {
  if (rawQuery.trim() === '') return null;

  const activeEngine = getActiveSearchEngine(settings);
  const enabledBuiltInBangs = getEnabledBuiltInBangs(settings);
  const trimmedStart = rawQuery.trimStart();

  // Level 1: Explicit !bang syntax
  if (trimmedStart.startsWith('!')) {
    const bangMatch = trimmedStart.match(/^!(\S*)(\s+([\s\S]*))?$/);
    const rawToken = bangMatch?.[1] ?? '';
    const hasWhitespace = Boolean(bangMatch?.[2]);
    const restQuery = bangMatch?.[3] ?? '';

    const seen = new Set<string>();
    const allTriggers: string[] = [];
    for (const bookmark of bookmarks) {
      for (const shortcut of getBookmarkShortcuts(bookmark)) {
        if (!seen.has(shortcut.alias)) {
          seen.add(shortcut.alias);
          allTriggers.push(shortcut.alias);
        }
      }
    }
    for (const custom of settings.customBangs) {
      const trigger = normalizeAlias(custom.trigger);
      if (trigger && !seen.has(trigger)) {
        seen.add(trigger);
        allTriggers.push(trigger);
      }
    }
    for (const builtIn of enabledBuiltInBangs) {
      if (!seen.has(builtIn.trigger)) {
        seen.add(builtIn.trigger);
        allTriggers.push(builtIn.trigger);
      }
    }

    // 1A: Bare '!'
    if (rawToken === '' && !hasWhitespace) {
      const firstTrigger = allTriggers[0];
      return {
        kind: 'bang-incomplete',
        url: activeEngine.homeUrl,
        title: 'Type a !bang shortcut',
        subtitle: allTriggers.length > 0
          ? allTriggers.slice(0, 6).map((t) => `!${t}`).join(' · ')
          : 'No active !bang shortcuts · Enable or add in Search settings',
        badge: '!BANG',
        autoSelect: true,
        tabCompletion: firstTrigger ? `!${firstTrigger} ` : undefined,
      };
    }

    const token = normalizeAlias(rawToken);

    // 1B: !token without space
    if (!hasWhitespace) {
      if (token !== '') {
        const bookmarkHit = findBookmarkShortcut(bookmarks, token, false);
        if (bookmarkHit) {
          const bookmarkMatch = bookmarkHit.bookmark;
          const jumpUrl = normalizeUrl(bookmarkMatch.url) || activeEngine.homeUrl;
          return {
            kind: 'bang-jump',
            url: jumpUrl,
            title: `Open ${bookmarkMatch.title}`,
            subtitle: `!${token} · Space or Tab to search ${bookmarkMatch.title}`,
            badge: `!${token}`,
            iconUrl: getBookmarkOmnibarIcon(bookmarkMatch),
            autoSelect: true,
            tabCompletion: `!${token} `,
            matchedBookmark: bookmarkMatch,
          };
        }

        const customMatch = settings.customBangs.find(
          (c) => normalizeAlias(c.trigger) === token,
        );
        if (customMatch) {
          const jumpUrl = resolveTemplateHomeUrl(
            customMatch.searchUrl,
            customMatch.homeUrl,
            activeEngine.homeUrl,
          );
          return {
            kind: 'bang-jump',
            url: jumpUrl,
            title: `Open ${customMatch.label}`,
            subtitle: `!${token} · Space or Tab to search ${customMatch.label}`,
            badge: `!${token}`,
            autoSelect: true,
            tabCompletion: `!${token} `,
          };
        }

        const builtInMatch = enabledBuiltInBangs.find((b) => b.trigger === token);
        if (builtInMatch) {
          return {
            kind: 'bang-jump',
            url: builtInMatch.homeUrl,
            title: `Open ${builtInMatch.label}`,
            subtitle: `!${token} · Space or Tab to search ${builtInMatch.label}`,
            badge: `!${token}`,
            autoSelect: true,
            tabCompletion: `!${token} `,
          };
        }
      }

      const rawPrefix = rawToken.toLowerCase();
      const prefixTrigger = /^[a-z0-9][a-z0-9-]{0,30}$/.test(rawPrefix)
        ? allTriggers.find((t) => t.startsWith(rawPrefix))
        : undefined;
      const fallbackQuery = trimmedStart.trim();
      return {
        kind: 'bang-unknown',
        url: buildSearchUrl(activeEngine.searchUrl, fallbackQuery),
        title: `Search ${activeEngine.label} for “${fallbackQuery}”`,
        subtitle: prefixTrigger
          ? `Tab to complete !${prefixTrigger} · Enter searches ${activeEngine.label}`
          : `No local !${rawToken} shortcut · searches ${activeEngine.label}`,
        badge: activeEngine.shortBadge,
        autoSelect: true,
        tabCompletion: prefixTrigger ? `!${prefixTrigger} ` : undefined,
      };
    }

    // 1C: !token with trailing whitespace and empty restQuery
    if (restQuery.trim() === '') {
      if (token !== '') {
        const bookmarkWithSearchHit = findBookmarkShortcut(bookmarks, token, true);
        if (bookmarkWithSearchHit) {
          const { bookmark: bookmarkWithSearch, shortcut } = bookmarkWithSearchHit;
          const jumpUrl =
            normalizeUrl(bookmarkWithSearch.url)
            || resolveTemplateHomeUrl(
              shortcut.queryUrl!,
              undefined,
              activeEngine.homeUrl,
            );
          return {
            kind: 'bang-jump',
            url: jumpUrl,
            title: `Search ${bookmarkWithSearch.title}…`,
            subtitle: `Type query after !${token} · Enter opens ${safeHostname(jumpUrl)}`,
            badge: `!${token}`,
            iconUrl: getBookmarkOmnibarIcon(bookmarkWithSearch),
            autoSelect: true,
          };
        }

        const customMatch = settings.customBangs.find(
          (c) =>
            normalizeAlias(c.trigger) === token
            && Boolean(normalizeSearchUrl(c.searchUrl)),
        );
        const jumpBookmark = findBookmarkShortcut(bookmarks, token, false)?.bookmark;
        if (customMatch) {
          const jumpUrl =
            (jumpBookmark ? normalizeUrl(jumpBookmark.url) : '')
            || resolveTemplateHomeUrl(
              customMatch.searchUrl,
              customMatch.homeUrl,
              activeEngine.homeUrl,
            );
          return {
            kind: 'bang-jump',
            url: jumpUrl,
            title: `Search ${customMatch.label}…`,
            subtitle: `Type query after !${token} · Enter opens ${safeHostname(jumpUrl)}`,
            badge: `!${token}`,
            iconUrl: jumpBookmark ? getBookmarkOmnibarIcon(jumpBookmark) : undefined,
            autoSelect: true,
          };
        }

        if (jumpBookmark) {
          const jumpUrl = normalizeUrl(jumpBookmark.url) || activeEngine.homeUrl;
          return {
            kind: 'bang-jump',
            url: jumpUrl,
            title: `Search ${jumpBookmark.title}…`,
            subtitle: `Type query after !${token} · Enter opens ${safeHostname(jumpUrl)}`,
            badge: `!${token}`,
            iconUrl: getBookmarkOmnibarIcon(jumpBookmark),
            autoSelect: true,
          };
        }

        const builtInMatch = enabledBuiltInBangs.find((b) => b.trigger === token);
        if (builtInMatch) {
          return {
            kind: 'bang-jump',
            url: builtInMatch.homeUrl,
            title: `Search ${builtInMatch.label}…`,
            subtitle: `Type query after !${token} · Enter opens ${safeHostname(builtInMatch.homeUrl)}`,
            badge: `!${token}`,
            autoSelect: true,
          };
        }
      }

      const fallbackQuery = trimmedStart.trim();
      return {
        kind: 'bang-unknown',
        url: buildSearchUrl(activeEngine.searchUrl, fallbackQuery),
        title: `Search ${activeEngine.label} for “${fallbackQuery}”`,
        subtitle: rawToken
          ? `No local !${rawToken} shortcut · searches ${activeEngine.label}`
          : `No shortcut after ! · searches ${activeEngine.label}`,
        badge: activeEngine.shortBadge,
        autoSelect: true,
      };
    }

    // 1D: !token restQuery
    const q = restQuery.trim();
    if (token !== '') {
      // 1. Bookmark shortcut with valid queryUrl
      const bookmarkWithSearchHit = findBookmarkShortcut(bookmarks, token, true);
      if (bookmarkWithSearchHit) {
        const { bookmark: bookmarkWithSearch, shortcut } = bookmarkWithSearchHit;
        const url = buildSearchUrl(shortcut.queryUrl!, q);
        return {
          kind: 'bang-search',
          url,
          title: `Search ${bookmarkWithSearch.title} for “${q}”`,
          subtitle: `!${token} · ${safeHostname(url)}`,
          badge: `!${token}`,
          iconUrl: getBookmarkOmnibarIcon(bookmarkWithSearch),
          autoSelect: true,
        };
      }

      // 2. CustomBang with valid searchUrl
      const customWithSearch = settings.customBangs.find(
        (c) =>
          normalizeAlias(c.trigger) === token
          && Boolean(normalizeSearchUrl(c.searchUrl)),
      );
      if (customWithSearch) {
        const url = buildSearchUrl(customWithSearch.searchUrl, q);
        return {
          kind: 'bang-search',
          url,
          title: `Search ${customWithSearch.label} for “${q}”`,
          subtitle: `!${token} · ${safeHostname(url)}`,
          badge: `!${token}`,
          autoSelect: true,
        };
      }

      // 3. Bookmark shortcut without valid queryUrl
      const bookmarkNoSearch = findBookmarkShortcut(bookmarks, token, false)?.bookmark;
      if (bookmarkNoSearch) {
        const bookmarkHost = safeHostname(bookmarkNoSearch.url);
        const builtIn = enabledBuiltInBangs.find((entry) => entry.trigger === token);
        let url: string;
        let subtitle: string;

        if (
          builtIn
          && bookmarkHost
          && stripWww(bookmarkHost) === stripWww(safeHostname(builtIn.homeUrl))
        ) {
          url = buildSearchUrl(builtIn.searchUrl, q);
          subtitle = `!${token} · ${safeHostname(url)}`;
        } else if (isPublicSearchableHost(bookmarkHost)) {
          const cleanHost = stripWww(bookmarkHost);
          url = buildSearchUrl(activeEngine.searchUrl, `site:${cleanHost} ${q}`);
          subtitle = `!${token} · site:${cleanHost} via ${activeEngine.label}`;
        } else {
          url = buildSearchUrl(
            activeEngine.searchUrl,
            `${bookmarkNoSearch.title} ${q}`,
          );
          subtitle = `!${token} · via ${activeEngine.label}`;
        }

        return {
          kind: 'bang-search',
          url,
          title: `Search ${bookmarkNoSearch.title} for “${q}”`,
          subtitle,
          badge: `!${token}`,
          iconUrl: getBookmarkOmnibarIcon(bookmarkNoSearch),
          autoSelect: true,
        };
      }

      // 4. BuiltInBang
      const builtInMatch = enabledBuiltInBangs.find((b) => b.trigger === token);
      if (builtInMatch) {
        const url = buildSearchUrl(builtInMatch.searchUrl, q);
        return {
          kind: 'bang-search',
          url,
          title: `Search ${builtInMatch.label} for “${q}”`,
          subtitle: `!${token} · ${safeHostname(url)}`,
          badge: `!${token}`,
          autoSelect: true,
        };
      }
    }

    const fallbackQuery = trimmedStart.trim();
    return {
      kind: 'bang-unknown',
      url: buildSearchUrl(activeEngine.searchUrl, fallbackQuery),
      title: `Search ${activeEngine.label} for “${fallbackQuery}”`,
      subtitle: rawToken
        ? `No local !${rawToken} shortcut · searches ${activeEngine.label}`
        : `No shortcut after ! · searches ${activeEngine.label}`,
      badge: activeEngine.shortBadge,
      autoSelect: true,
    };
  }

  // Level 2: Bare bookmark / custom-bang alias prefix ('gh react' or 'gh ')
  const bareAliasMatch = trimmedStart.match(
    /^([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)\s+([\s\S]*)$/i,
  );
  if (bareAliasMatch) {
    const token = bareAliasMatch[1].toLowerCase();
    const restQuery = bareAliasMatch[2];

    const bookmarkHit = findBookmarkShortcut(bookmarks, token, true);
    const customMatch = !bookmarkHit
      ? settings.customBangs.find(
          (c) =>
            normalizeAlias(c.trigger) === token
            && Boolean(normalizeSearchUrl(c.searchUrl)),
        )
      : undefined;

    if (bookmarkHit || customMatch) {
      const jumpBookmark =
        bookmarkHit?.bookmark
        ?? findBookmarkShortcut(bookmarks, token, false)?.bookmark;
      const templateUrl = bookmarkHit
        ? bookmarkHit.shortcut.queryUrl!
        : customMatch!.searchUrl;
      const baseHomeUrl = bookmarkHit
        ? normalizeUrl(bookmarkHit.bookmark.url)
          || resolveTemplateHomeUrl(bookmarkHit.shortcut.queryUrl!, undefined, activeEngine.homeUrl)
        : (jumpBookmark ? normalizeUrl(jumpBookmark.url) : '')
          || resolveTemplateHomeUrl(
            customMatch!.searchUrl,
            customMatch!.homeUrl,
            activeEngine.homeUrl,
          );
      const label = bookmarkHit ? bookmarkHit.bookmark.title : customMatch!.label;
      const iconUrl = jumpBookmark
        ? getBookmarkOmnibarIcon(jumpBookmark)
        : undefined;

      if (restQuery.trim() !== '') {
        const q = restQuery.trim();
        const url = buildSearchUrl(templateUrl, q);
        return {
          kind: 'bang-search',
          url,
          title: `Search ${label} for “${q}”`,
          subtitle: `!${token} · ${safeHostname(url)} · Shift+Enter searches ${activeEngine.label}`,
          badge: `!${token}`,
          iconUrl,
          autoSelect: true,
        };
      }

      return {
        kind: 'bang-jump',
        url: baseHomeUrl,
        title: `Search ${label}…`,
        subtitle: `Keep typing query · Enter opens ${safeHostname(baseHomeUrl)}`,
        badge: `!${token}`,
        iconUrl,
        autoSelect: true,
      };
    }
  }

  // Level 3: Direct URL / domain / localhost / IP+port
  const directUrl = detectDirectUrl(rawQuery);
  if (directUrl) {
    return {
      kind: 'url',
      url: directUrl,
      title: `Open ${compactUrlLabel(directUrl)}`,
      subtitle: `${directUrl} · Shift+Enter searches ${activeEngine.label}`,
      badge: 'URL',
      iconUrl: undefined,
      autoSelect: true,
    };
  }

  // Level 4: Cross-section alias rescue
  const trimmed = rawQuery.trim();
  const wholeAlias = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/i.test(trimmed)
    ? trimmed.toLowerCase()
    : '';

  if (wholeAlias) {
    const inCurrentSection = Boolean(
      findBookmarkShortcut(sectionMatches, wholeAlias, false),
    );
    if (!inCurrentSection) {
      const rescuedMatch = findBookmarkShortcut(bookmarks, wholeAlias, false);
      if (rescuedMatch) {
        const rescued = rescuedMatch.bookmark;
        const hasValidQueryUrl = Boolean(rescuedMatch.shortcut.queryUrl);
        return {
          kind: 'bookmark-alias',
          url: normalizeUrl(rescued.url) || activeEngine.homeUrl,
          title: `Jump to ${rescued.title}`,
          subtitle: `!${wholeAlias} · in ${rescued.section}${hasValidQueryUrl ? ' · Tab to enter query' : ''}`,
          badge: `!${wholeAlias}`,
          iconUrl: getBookmarkOmnibarIcon(rescued),
          autoSelect: true,
          tabCompletion: hasValidQueryUrl ? `!${wholeAlias} ` : undefined,
          matchedBookmark: rescued,
        };
      }
    }
  }

  // Level 5: Default web search fallback
  const matchingCustomBang = wholeAlias
    ? settings.customBangs.find(
        (c) => normalizeAlias(c.trigger) === wholeAlias,
      )
    : undefined;
  const engineHost = stripWww(safeHostname(activeEngine.homeUrl));

  return {
    kind: 'web-search',
    url: buildSearchUrl(activeEngine.searchUrl, trimmed),
    title: `Search ${activeEngine.label} for “${trimmed}”`,
    subtitle: sectionMatches.length > 0
      ? `${engineHost} · ↑/↓ to select or Shift+Enter`
      : `${engineHost} · Enter to search web`,
    badge: activeEngine.shortBadge,
    autoSelect: sectionMatches.length === 0,
    tabCompletion: matchingCustomBang
      ? `!${normalizeAlias(matchingCustomBang.trigger)} `
      : undefined,
  };
}

export function buildWebSearchUrl(
  rawQuery: string,
  settings: OmnibarSettings,
): string {
  const trimmed = rawQuery.trim();
  if (!trimmed) return '';
  return buildSearchUrl(getActiveSearchEngine(settings).searchUrl, trimmed);
}

export function resolveTabCompletion(
  rawQuery: string,
  effectiveTarget: OmnibarEffectiveTarget,
  omnibarAction: OmnibarAction | null,
): string | null {
  if (!rawQuery.trim()) return null;

  if (effectiveTarget?.kind === 'bookmark') {
    const queryable = getBookmarkShortcuts(effectiveTarget.bookmark).filter((s) =>
      Boolean(s.queryUrl),
    );
    if (queryable.length > 0) {
      const rawToken = rawQuery.trim().replace(/^!/, '').toLowerCase();
      const picked = queryable.find((s) => s.alias === rawToken)
        ?? (rawToken ? queryable.find((s) => s.alias.startsWith(rawToken)) : undefined)
        ?? queryable[0];
      const completion = `!${picked.alias} `;
      return rawQuery !== completion ? completion : null;
    }
  }

  if (omnibarAction?.tabCompletion && omnibarAction.tabCompletion !== rawQuery) {
    return omnibarAction.tabCompletion;
  }

  return null;
}

export function resolveEmptyOmnibarState(
  rawQuery: string,
  searchOpen: boolean,
  dropActive: boolean,
  omnibarAction: OmnibarAction | null,
  lastOmnibarAction: OmnibarAction | null,
  settings: OmnibarSettings,
): EmptyOmnibarViewState {
  const isSearchExpanded = searchOpen || Boolean(rawQuery);
  const isDrawerOpen = omnibarAction !== null;
  const activeEngine = getActiveSearchEngine(settings);
  const fallbackAction: OmnibarAction = {
    kind: 'web-search',
    url: activeEngine.homeUrl,
    title: `Search ${activeEngine.label}`,
    subtitle: `${stripWww(safeHostname(activeEngine.homeUrl))} · Enter to search web`,
    badge: activeEngine.shortBadge,
    autoSelect: true,
  };

  return {
    isSearchExpanded,
    isDrawerOpen,
    displayedAction: omnibarAction ?? lastOmnibarAction ?? fallbackAction,
    triggerTabIndex: dropActive || isSearchExpanded ? -1 : undefined,
    inputTabIndex: dropActive || !isSearchExpanded ? -1 : undefined,
    resultTabIndex: dropActive || !isDrawerOpen ? -1 : undefined,
  };
}
