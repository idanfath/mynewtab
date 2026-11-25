import {
  groupBookmarksBySection,
  parseBookmarks,
  type Bookmark,
} from './bookmarks.ts';
import { normalizeUrl } from './lib.ts';
import { cloneWithoutProto, deduplicateBookmarks } from './bookmarkMerge.ts';

export type BookmarkFileFormat = 'json' | 'html';

export interface ParsedBookmarkImport {
  format: BookmarkFileFormat;
  bookmarks: Bookmark[];
  skippedNonHttpCount: number;
  intraFileDuplicateCount: number;
}

const ROOT_WRAPPER_NAMES = new Set<string>([
  'bookmarks bar',
  'bookmarks toolbar',
  'bookmarks menu',
  'bookmarks',
  'other bookmarks',
  'unfiled bookmarks',
  'favorites',
  'favorites bar',
  'other favorites',
  'mobile bookmarks',
  'mobile favorites',
  'reading list',
  'imported',
  'imported bookmarks',
]);

const OPTIONAL_STRING_FIELDS = [
  'subsection',
  'description',
  'tier',
  'product',
] as const;

const OPTIONAL_ARRAY_FIELDS = [
  'categories',
  'capabilities',
  'pros',
  'cons',
  'formats',
] as const;

type HtmlToken =
  | { type: 'text'; raw: string }
  | { type: 'open'; tag: string; attrs: Record<string, string> }
  | { type: 'close'; tag: string };

interface DlStackEntry {
  name: string | null;
  isToolbarAttr: boolean;
  explicitSection: boolean;
}

interface PendingFolder {
  name: string;
  isToolbarAttr: boolean;
  explicitSection: boolean;
}

interface ActiveHeading {
  chunks: string[];
  isToolbarAttr: boolean;
  explicitSection: boolean;
}

interface ActiveAnchor {
  href: string;
  iconUrl?: string;
  tags?: string[];
  chunks: string[];
}

export function decodeHtmlEntities(input: string): string {
  return input.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos|nbsp));/gi,
    (_match, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
      if (named) {
        switch (named.toLowerCase()) {
          case 'amp':
            return '&';
          case 'lt':
            return '<';
          case 'gt':
            return '>';
          case 'quot':
            return '"';
          case 'apos':
            return "'";
          case 'nbsp':
            return ' ';
          default:
            return _match;
        }
      }

      const digits = dec ?? hex ?? '';
      const radix = dec ? 10 : 16;
      const cp = Number.parseInt(digits, radix);
      if (
        !Number.isSafeInteger(cp)
        || cp <= 0
        || cp > 0x10ffff
        || (cp >= 0xd800 && cp <= 0xdfff)
      ) {
        return '\uFFFD';
      }
      return String.fromCodePoint(cp);
    },
  );
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function detectBookmarkFileFormat(
  content: string,
  fileName?: string,
): BookmarkFileFormat | null {
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  const lowerName = fileName?.trim().toLocaleLowerCase() ?? '';

  if (!trimmed) {
    if (lowerName.endsWith('.json')) return 'json';
    if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'html';
    return null;
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return 'json';
  }

  if (
    /<!doctype\s+netscape-bookmark-file/i.test(trimmed)
    || /<(?:dl|dt|h3|a|html|head|body|meta|title)\b/i.test(trimmed)
  ) {
    return 'html';
  }

  if (lowerName.endsWith('.json')) {
    return 'json';
  }

  return null;
}

function tokenizeBookmarkHtml(content: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;
  const len = content.length;

  while (i < len) {
    if (content[i] !== '<') {
      const nextLt = content.indexOf('<', i);
      const raw = nextLt === -1 ? content.slice(i) : content.slice(i, nextLt);
      tokens.push({ type: 'text', raw });
      i = nextLt === -1 ? len : nextLt;
      continue;
    }

    if (content.startsWith('!--', i + 1)) {
      const endComment = content.indexOf('-->', i + 4);
      i = endComment === -1 ? len : endComment + 3;
      continue;
    }

    const nextChar = content[i + 1] ?? '';
    if (nextChar === '!' || nextChar === '?') {
      const endDecl = content.indexOf('>', i + 2);
      i = endDecl === -1 ? len : endDecl + 1;
      continue;
    }

    if (nextChar === '/') {
      const afterSlash = content[i + 2] ?? '';
      if (!/[a-zA-Z]/.test(afterSlash)) {
        const gt = content.indexOf('>', i + 2);
        i = gt === -1 ? len : gt + 1;
        continue;
      }
      const nameStart = i + 2;
      let nameEnd = nameStart;
      while (nameEnd < len && /[a-zA-Z0-9:-]/.test(content[nameEnd])) {
        nameEnd += 1;
      }
      const tag = content.slice(nameStart, nameEnd).toLowerCase();
      const gt = content.indexOf('>', nameEnd);
      i = gt === -1 ? len : gt + 1;
      tokens.push({ type: 'close', tag });
      continue;
    }

    if (!/[a-zA-Z]/.test(nextChar)) {
      tokens.push({ type: 'text', raw: '<' });
      i += 1;
      continue;
    }

    i += 1;
    const tagStart = i;
    while (i < len && /[a-zA-Z0-9:-]/.test(content[i])) {
      i += 1;
    }
    const tag = content.slice(tagStart, i).toLowerCase();
    const attrs: Record<string, string> = {};

    while (i < len) {
      while (i < len && /[\s/]/.test(content[i])) i += 1;
      if (i >= len) break;
      if (content[i] === '>') {
        i += 1;
        break;
      }

      const attrStart = i;
      i += 1;
      while (i < len && !/[\s=/>]/.test(content[i])) i += 1;
      const attrName = content.slice(attrStart, i).toLowerCase();

      if (attrName === '=' || attrName.startsWith('=')) continue;

      while (i < len && /\s/.test(content[i])) i += 1;
      let attrValue = '';
      if (i < len && content[i] === '=') {
        i += 1;
        while (i < len && /\s/.test(content[i])) i += 1;
        if (i < len && (content[i] === '"' || content[i] === "'")) {
          const quote = content[i];
          i += 1;
          const endQuote = content.indexOf(quote, i);
          if (endQuote === -1) {
            attrValue = decodeHtmlEntities(content.slice(i));
            i = len;
          } else {
            attrValue = decodeHtmlEntities(content.slice(i, endQuote));
            i = endQuote + 1;
          }
        } else {
          const valStart = i;
          while (i < len && !/[\s>]/.test(content[i])) i += 1;
          attrValue = decodeHtmlEntities(content.slice(valStart, i));
        }
      }

      if (attrName && attrName !== '__proto__') {
        attrs[attrName] = attrValue;
      }
    }

    if (tag === 'script' || tag === 'style') {
      const closeRe = tag === 'script'
        ? /<\/script(?=[\s/>]|$)/gi
        : /<\/style(?=[\s/>]|$)/gi;
      closeRe.lastIndex = i;
      const match = closeRe.exec(content);
      if (!match) {
        i = len;
      } else {
        const closeGt = content.indexOf('>', match.index + match[0].length);
        i = closeGt === -1 ? len : closeGt + 1;
      }
      continue;
    }

    tokens.push({ type: 'open', tag, attrs });
  }

  return tokens;
}

function parseHtmlTags(rawTags: string): string[] | undefined {
  if (!rawTags.trim()) return undefined;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of rawTags.split(',')) {
    const cleaned = part.trim();
    if (!cleaned) continue;
    const lower = cleaned.toLocaleLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    tags.push(cleaned);
  }
  return tags.length > 0 ? tags : undefined;
}

function pickSafeHttpIcon(icon: string, iconUri: string): string | undefined {
  for (const rawCandidate of [icon.trim(), iconUri.trim()]) {
    if (!rawCandidate) continue;
    if (/^data:/i.test(rawCandidate)) continue;
    if (!/^https?:\/\//i.test(rawCandidate)) continue;
    const normalized = normalizeUrl(rawCandidate);
    if (normalized) return normalized;
  }
  return undefined;
}

function resolveFolderFromStack(
  dlStack: readonly DlStackEntry[],
): { section: string; subsection?: string } {
  const named = dlStack.filter(
    (entry): entry is PendingFolder => entry.name !== null,
  );

  let startIdx = 0;
  while (startIdx < named.length && startIdx < 2) {
    const current = named[startIdx];
    const normalizedName = current.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (
      !current.explicitSection
      && (current.isToolbarAttr || ROOT_WRAPPER_NAMES.has(normalizedName))
    ) {
      startIdx += 1;
    } else {
      break;
    }
  }

  const effectivePath = named.slice(startIdx);
  if (effectivePath.length === 0) {
    return { section: 'Uncategorized', subsection: undefined };
  }

  const rawSection = effectivePath[0].name.trim();
  const section = !rawSection || rawSection.toLocaleLowerCase() === 'all'
    ? 'Uncategorized'
    : rawSection;

  const subSegments = effectivePath
    .slice(1)
    .flatMap((entry) => entry.name.split(/\s*\/\s*/).map((seg) => seg.trim()).filter(Boolean));

  return {
    section,
    subsection: subSegments.length > 0 ? subSegments.join(' / ') : undefined,
  };
}

export function parseBookmarksHtml(content: string): ParsedBookmarkImport {
  const tokens = tokenizeBookmarkHtml(content.replace(/^\uFEFF/, ''));

  const dlStack: DlStackEntry[] = [];
  let pendingFolder: PendingFolder | null = null;
  let activeHeading: ActiveHeading | null = null;
  let activeAnchor: ActiveAnchor | null = null;
  let lastBookmark: Bookmark | null = null;
  let ddChunks: string[] | null = null;

  const rawBookmarks: Bookmark[] = [];
  let skippedNonHttpCount = 0;

  const flushDd = () => {
    if (ddChunks !== null && lastBookmark !== null) {
      const desc = ddChunks.join('').replace(/\s+/g, ' ').trim();
      if (desc) {
        lastBookmark.description = desc;
      }
      ddChunks = null;
      lastBookmark = null;
    } else if (ddChunks !== null) {
      ddChunks = null;
    }
  };

  const finalizeHeading = () => {
    if (activeHeading !== null) {
      const headingName = activeHeading.chunks.join('').replace(/\s+/g, ' ').trim();
      if (headingName) {
        pendingFolder = {
          name: headingName,
          isToolbarAttr: activeHeading.isToolbarAttr,
          explicitSection: activeHeading.explicitSection,
        };
      }
      activeHeading = null;
    }
  };

  const takePendingFolder = (): PendingFolder | null => {
    const folder = pendingFolder;
    pendingFolder = null;
    return folder;
  };

  const finalizeAnchor = () => {
    if (activeAnchor === null) return;
    const current = activeAnchor;
    activeAnchor = null;

    if (!current.href || current.href.startsWith('#')) {
      return;
    }
    if (!/^https?:\/\//i.test(current.href)) {
      skippedNonHttpCount += 1;
      return;
    }
    const normalizedHref = normalizeUrl(current.href);
    if (!normalizedHref) {
      skippedNonHttpCount += 1;
      return;
    }

    const fallbackTitle = new URL(normalizedHref).hostname.replace(/^www\./i, '') || normalizedHref;
    const title = current.chunks.join('').replace(/\s+/g, ' ').trim() || fallbackTitle;
    const { section, subsection } = resolveFolderFromStack(dlStack);

    const bookmark: Bookmark = {
      title,
      url: normalizedHref,
      section,
    };
    if (subsection) bookmark.subsection = subsection;
    if (current.iconUrl) bookmark.iconUrl = current.iconUrl;
    if (current.tags && current.tags.length > 0) bookmark.categories = current.tags;

    rawBookmarks.push(bookmark);
    lastBookmark = bookmark;
  };

  for (const token of tokens) {
    if (token.type === 'text') {
      const decoded = decodeHtmlEntities(token.raw);
      if (activeAnchor !== null) {
        activeAnchor.chunks.push(decoded);
      } else if (activeHeading !== null) {
        activeHeading.chunks.push(decoded);
      } else if (ddChunks !== null) {
        ddChunks.push(decoded);
      }
      continue;
    }

    if (token.type === 'open') {
      switch (token.tag) {
        case 'dl': {
          finalizeAnchor();
          finalizeHeading();
          flushDd();
          lastBookmark = null;
          const folder = takePendingFolder();
          dlStack.push(
            folder !== null
              ? { ...folder }
              : { name: null, isToolbarAttr: false, explicitSection: false },
          );
          break;
        }
        case 'dt': {
          finalizeAnchor();
          finalizeHeading();
          flushDd();
          lastBookmark = null;
          pendingFolder = null;
          break;
        }
        case 'h3': {
          finalizeAnchor();
          finalizeHeading();
          flushDd();
          lastBookmark = null;
          pendingFolder = null;
          activeHeading = {
            chunks: [],
            isToolbarAttr:
              'personal_toolbar_folder' in token.attrs
              || 'unfiled_bookmarks_folder' in token.attrs,
            explicitSection: 'data-mynewtab-section' in token.attrs,
          };
          break;
        }
        case 'a': {
          finalizeAnchor();
          finalizeHeading();
          flushDd();
          lastBookmark = null;
          pendingFolder = null;
          activeAnchor = {
            href: (token.attrs.href ?? '').trim(),
            iconUrl: pickSafeHttpIcon(token.attrs.icon ?? '', token.attrs.icon_uri ?? ''),
            tags: parseHtmlTags(token.attrs.tags ?? ''),
            chunks: [],
          };
          break;
        }
        case 'dd': {
          finalizeAnchor();
          finalizeHeading();
          flushDd();
          if (lastBookmark !== null) {
            ddChunks = [];
          }
          break;
        }
        case 'p':
        case 'hr':
        case 'h1': {
          flushDd();
          break;
        }
        case 'br': {
          if (ddChunks !== null) {
            ddChunks.push(' ');
          }
          break;
        }
        default:
          break;
      }
      continue;
    }

    // token.type === 'close'
    switch (token.tag) {
      case 'dl': {
        finalizeAnchor();
        finalizeHeading();
        flushDd();
        lastBookmark = null;
        pendingFolder = null;
        if (dlStack.length > 0) dlStack.pop();
        break;
      }
      case 'h3': {
        finalizeHeading();
        break;
      }
      case 'a': {
        finalizeAnchor();
        break;
      }
      case 'dd': {
        flushDd();
        break;
      }
      default:
        break;
    }
  }

  finalizeAnchor();
  finalizeHeading();
  flushDd();

  if (rawBookmarks.length === 0) {
    if (skippedNonHttpCount > 0) {
      throw new Error(
        `No valid http:// or https:// bookmarks found (skipped ${skippedNonHttpCount} non-web link${skippedNonHttpCount === 1 ? '' : 's'}).`,
      );
    }
    throw new Error('No bookmarks found in HTML file.');
  }

  const { bookmarks, duplicateCount } = deduplicateBookmarks(rawBookmarks);
  return {
    format: 'html',
    bookmarks,
    skippedNonHttpCount,
    intraFileDuplicateCount: duplicateCount,
  };
}

interface FolderNode {
  name: string;
  bookmarks: Bookmark[];
  children: Map<string, FolderNode>;
}

function renderBookmarkItem(bookmark: Bookmark, indent: string): string {
  const href = normalizeUrl(bookmark.url) || bookmark.url.trim();
  const normalizedIcon = bookmark.iconUrl?.trim() ? normalizeUrl(bookmark.iconUrl) : '';
  const iconAttr = normalizedIcon ? ` ICON="${escapeHtml(normalizedIcon)}"` : '';
  const tags = (bookmark.categories ?? []).map((tag) => tag.trim()).filter(Boolean);
  const tagsAttr = tags.length > 0 ? ` TAGS="${escapeHtml(tags.join(','))}"` : '';

  let line = `${indent}<DT><A HREF="${escapeHtml(href)}"${iconAttr}${tagsAttr}>${escapeHtml(bookmark.title)}</A>\n`;
  const desc = bookmark.description?.trim();
  if (desc) {
    line += `${indent}<DD>${escapeHtml(desc)}\n`;
  }
  return line;
}

function renderFolderChildren(node: FolderNode, indent: string): string {
  let out = '';
  for (const bookmark of node.bookmarks) {
    out += renderBookmarkItem(bookmark, indent);
  }
  for (const child of node.children.values()) {
    out += `${indent}<DT><H3>${escapeHtml(child.name)}</H3>\n`;
    out += `${indent}<DL><p>\n`;
    out += renderFolderChildren(child, `${indent}    `);
    out += `${indent}</DL><p>\n`;
  }
  return out;
}

export function serializeBookmarksHtml(bookmarks: readonly Bookmark[]): string {
  const grouped = groupBookmarksBySection([...bookmarks]);
  const sectionBuckets = new Map<string, Bookmark[]>();
  for (const bookmark of grouped) {
    let bucket = sectionBuckets.get(bookmark.section);
    if (!bucket) {
      bucket = [];
      sectionBuckets.set(bookmark.section, bucket);
    }
    bucket.push(bookmark);
  }

  let output = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ].join('\n');
  output += '\n';

  for (const [sectionName, items] of sectionBuckets) {
    const rootNode: FolderNode = {
      name: sectionName,
      bookmarks: [],
      children: new Map<string, FolderNode>(),
    };

    for (const item of items) {
      const segments = item.subsection
        ? item.subsection.split(/\s*\/\s*/).map((seg) => seg.trim()).filter(Boolean)
        : [];
      let current = rootNode;
      for (const seg of segments) {
        let child = current.children.get(seg);
        if (!child) {
          child = {
            name: seg,
            bookmarks: [],
            children: new Map<string, FolderNode>(),
          };
          current.children.set(seg, child);
        }
        current = child;
      }
      current.bookmarks.push(item);
    }

    output += `    <DT><H3 DATA-MYNEWTAB-SECTION="1">${escapeHtml(sectionName)}</H3>\n`;
    output += '    <DL><p>\n';
    output += renderFolderChildren(rootNode, '        ');
    output += '    </DL><p>\n';
  }

  output += '</DL><p>\n';
  return output;
}

function sanitizeJsonBookmark(
  bookmark: Bookmark,
  mode: 'import' | 'editor',
  index: number,
): Bookmark {
  const title = bookmark.title.trim();
  const url = bookmark.url.trim();
  const rawSection = bookmark.section.trim();

  if (mode === 'editor' && rawSection.toLocaleLowerCase() === 'all') {
    throw new Error(
      `Bookmark ${index + 1}: section “All” is reserved for the complete directory.`,
    );
  }

  const section = rawSection.toLocaleLowerCase() === 'all'
    ? 'Uncategorized'
    : rawSection;

  const record: Record<string, unknown> = {
    ...(cloneWithoutProto(bookmark) as Record<string, unknown>),
    title,
    url,
    section,
  };

  for (const field of OPTIONAL_STRING_FIELDS) {
    const cleaned = bookmark[field]?.trim();
    if (cleaned) {
      record[field] = cleaned;
    } else {
      delete record[field];
    }
  }

  const rawIcon = bookmark.iconUrl?.trim();
  if (rawIcon) {
    const normalizedIcon = normalizeUrl(rawIcon);
    if (normalizedIcon) {
      record.iconUrl = normalizedIcon;
    } else {
      delete record.iconUrl;
    }
  } else {
    delete record.iconUrl;
  }

  for (const field of OPTIONAL_ARRAY_FIELDS) {
    const cleaned = bookmark[field]?.map((entry) => entry.trim()).filter(Boolean);
    if (cleaned && cleaned.length > 0) {
      record[field] = cleaned;
    } else {
      delete record[field];
    }
  }

  return record as unknown as Bookmark;
}

export function parseImportedBookmarkFile(
  content: string,
  fileName?: string,
): ParsedBookmarkImport {
  const stripped = content.replace(/^\uFEFF/, '');
  const format = detectBookmarkFileFormat(stripped, fileName);
  if (!format) {
    throw new Error('Unrecognized bookmark file format.');
  }

  if (format === 'html') {
    return parseBookmarksHtml(stripped);
  }

  const parsed = parseBookmarks(stripped);
  if (parsed.length === 0) {
    throw new Error('No bookmarks found in JSON file.');
  }

  const sanitized = parsed.map((bookmark, index) =>
    sanitizeJsonBookmark(bookmark, 'import', index),
  );
  const { bookmarks, duplicateCount } = deduplicateBookmarks(sanitized);

  return {
    format: 'json',
    bookmarks,
    skippedNonHttpCount: 0,
    intraFileDuplicateCount: duplicateCount,
  };
}

export function parseEditorBookmarks(content: string): Bookmark[] {
  const parsed = parseBookmarks(content.replace(/^\uFEFF/, ''));
  const sectionMap = new Map<string, string>();
  const sanitized = parsed.map((bookmark, index) => {
    const cleaned = sanitizeJsonBookmark(bookmark, 'editor', index);
    const key = cleaned.section.toLocaleLowerCase();
    const existing = sectionMap.get(key);
    if (existing) {
      return existing === cleaned.section ? cleaned : { ...cleaned, section: existing };
    }
    sectionMap.set(key, cleaned.section);
    return cleaned;
  });
  return groupBookmarksBySection(sanitized);
}
