import type { AppError } from './useBookmarks.ts';

export function jsonErrorLocation(error: SyntaxError, content: string): string {
  const position = error.message.match(/position\s+(\d+)/i)?.[1];
  if (!position) return '';

  const offset = Number(position);
  const lines = content.slice(0, offset).split('\n');
  return ` near line ${lines.length}, column ${lines.at(-1)!.length + 1}`;
}

export function findBookmarkLine(
  content: string,
  bookmarkNumber: number,
  field?: string,
): number | null {
  if (!content.includes('\n') || bookmarkNumber < 1) return null;
  let line = 1;
  let depth = 0;
  let elementIndex = 0;
  let expectingElement = false;
  let inTargetObject = false;
  let targetStartLine: number | null = null;
  let expectingKey = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '\n') {
      line += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') continue;

    if (depth === 1 && expectingElement && ch !== ']') {
      elementIndex += 1;
      expectingElement = false;
      if (elementIndex === bookmarkNumber) {
        targetStartLine = line;
        if (!field || ch !== '{') return targetStartLine;
        inTargetObject = true;
      }
    }

    if (ch === '"') {
      const strLine = line;
      const start = i;
      i += 1;
      while (i < content.length) {
        const sc = content[i];
        if (sc === '\n') line += 1;
        if (sc === '\\') {
          if (i + 1 < content.length && content[i + 1] === '\n') line += 1;
          i += 2;
          continue;
        }
        if (sc === '"') break;
        i += 1;
      }
      if (inTargetObject && depth === 2 && expectingKey) {
        expectingKey = false;
        try {
          const parsedKey: unknown = JSON.parse(content.slice(start, i + 1));
          if (parsedKey === field) return strLine;
        } catch {
          // ignore malformed slice
        }
      }
      continue;
    }

    if (ch === '[') {
      depth += 1;
      if (depth === 1) expectingElement = true;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === '{') {
      depth += 1;
      if (inTargetObject && depth === 2) expectingKey = true;
    } else if (ch === '}') {
      if (inTargetObject && depth === 2) return targetStartLine;
      depth -= 1;
    } else if (ch === ',') {
      if (depth === 1) expectingElement = true;
      else if (inTargetObject && depth === 2) expectingKey = true;
    }
  }
  return targetStartLine;
}

export function formatBookmarkError(
  error: unknown,
  content: string,
  title: string,
): AppError {
  if (error instanceof SyntaxError) {
    return {
      title,
      detail: `File contains invalid JSON${jsonErrorLocation(error, content)}. Check its syntax and try again.`,
    };
  }

  const message = error instanceof Error ? error.message : '';
  if (message === 'Expected a JSON array of bookmarks.') {
    return {
      title,
      detail: 'Top level must be an array of bookmark objects.',
    };
  }

  const duplicateAlias = message.match(
    /^Bookmark (\d+)\.alias duplicates "([^"]+)" from Bookmark (\d+) \(([\s\S]+)\)\.$/,
  );
  if (duplicateAlias) {
    const [, index, alias, firstIndex, firstTitle] = duplicateAlias;
    const line = findBookmarkLine(content, Number(index), 'alias');
    const firstLine = findBookmarkLine(content, Number(firstIndex), 'alias');
    const loc = line !== null ? ` (line ${line})` : '';
    const firstLoc = firstLine !== null ? `, line ${firstLine}` : '';
    const cleanTitle = firstTitle.replace(/\s+/g, ' ').trim();
    return {
      title,
      detail: `Bookmark ${index}${loc}: “alias” duplicates “!${alias}” already used by Bookmark ${firstIndex} (“${cleanTitle}”${firstLoc}).`,
    };
  }

  const fieldError = message.match(/^Bookmark (\d+)\.([\w]+) must be (.+)\.$/);
  if (fieldError) {
    const [, index, field, requirement] = fieldError;
    const line = findBookmarkLine(content, Number(index), field);
    const loc = line !== null ? ` (line ${line})` : '';
    const friendlyRequirement = requirement === 'a valid HTTP(S) URL'
      ? 'a valid http:// or https:// address'
      : requirement === 'a valid HTTP(S) search URL containing %s'
        ? 'a valid http:// or https:// address containing %s'
        : requirement === 'a string array'
          ? 'an array containing only text values'
          : requirement;
    return {
      title,
      detail: `Bookmark ${index}${loc}: “${field}” must be ${friendlyRequirement}.`,
    };
  }

  const bookmarkError = message.match(/^Bookmark (\d+) must be an object\.$/);
  if (bookmarkError) {
    const line = findBookmarkLine(content, Number(bookmarkError[1]));
    const loc = line !== null ? ` (line ${line})` : '';
    return {
      title,
      detail: `Bookmark ${bookmarkError[1]}${loc} must be a bookmark object.`,
    };
  }

  return {
    title,
    detail: 'Bookmark data could not be validated. Check the file and try again.',
  };
}
