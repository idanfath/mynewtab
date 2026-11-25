import { normalizeUrl } from './lib.ts';

export const SECTION_DRAG_TYPE = 'application/x-mynewtab-section';
export const BOOKMARK_DRAG_TYPE = 'application/x-mynewtab-bookmark';

export type DropMode = 'file' | 'url' | null;

export function detectDropMode(
  dataTransfer: Pick<DataTransfer, 'types'>,
  allowFiles: boolean,
): DropMode {
  const types = Array.from(dataTransfer.types);
  if (
    types.includes(SECTION_DRAG_TYPE)
    || types.includes(BOOKMARK_DRAG_TYPE)
  ) {
    return null;
  }
  if (allowFiles && types.includes('Files')) return 'file';
  if (
    types.includes('text/uri-list')
    || types.includes('text/html')
    || types.includes('text/plain')
  ) {
    return 'url';
  }
  return null;
}

export function resolveDropSection(
  hoveredSection: string | null | undefined,
  activeSection: string,
  fallback = 'Uncategorized',
): string {
  const hovered = hoveredSection?.trim();
  if (hovered) return hovered;
  if (activeSection && activeSection !== 'All') return activeSection;
  return fallback;
}

export function readDroppedUrl(
  dataTransfer: Pick<DataTransfer, 'getData'>,
): string {
  const candidates = [
    ...dataTransfer.getData('text/uri-list').split('\n'),
    ...dataTransfer.getData('text/plain').split('\n'),
  ];

  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value || value.startsWith('#')) continue;
    const normalized = normalizeUrl(value);
    if (normalized) return normalized;
  }
  return '';
}

export function readDroppedTitle(dataTransfer: DataTransfer, url: string): string {
  const html = dataTransfer.getData('text/html');
  if (html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const matchingLink = [...document.querySelectorAll('a')].find(
      (link) => normalizeUrl(link.href) === url,
    );
    const title = matchingLink?.textContent?.replace(/\s+/g, ' ').trim();
    if (title) return title.slice(0, 120);
  }

  return new URL(url).hostname.replace(/^www\./, '');
}
