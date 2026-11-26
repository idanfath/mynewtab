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

export function findShortcutLine(
  content: string,
  bookmarkNumber: number,
  shortcutNumber: number,
  subField?: string,
): number | null {
  if (!content.includes('\n') || bookmarkNumber < 1 || shortcutNumber < 1) return null;
  let line = 1;
  let depth = 0;
  let elementIndex = 0;
  let expectingElement = false;
  let inTargetBookmark = false;
  let expectingBookmarkKey = false;
  let pendingShortcutsValue = false;
  let inShortcutsArray = false;
  let shortcutIndex = 0;
  let expectingShortcut = false;
  let inTargetShortcut = false;
  let shortcutStartLine: number | null = null;
  let expectingShortcutKey = false;

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
        if (ch !== '{') return null;
        inTargetBookmark = true;
      }
    }

    if (inShortcutsArray && depth === 3 && expectingShortcut && ch !== ']') {
      shortcutIndex += 1;
      expectingShortcut = false;
      if (shortcutIndex === shortcutNumber) {
        shortcutStartLine = line;
        if (!subField || ch !== '{') return shortcutStartLine;
        inTargetShortcut = true;
      }
    }

    if (pendingShortcutsValue && depth === 2) {
      if (ch === ':') continue;
      pendingShortcutsValue = false;
      if (ch === '[') {
        depth += 1;
        inShortcutsArray = true;
        expectingShortcut = true;
        continue;
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
      if (inTargetBookmark && depth === 2 && expectingBookmarkKey) {
        expectingBookmarkKey = false;
        try {
          const parsedKey: unknown = JSON.parse(content.slice(start, i + 1));
          if (parsedKey === 'shortcuts') {
            pendingShortcutsValue = true;
          }
        } catch {
          // ignore malformed slice
        }
      } else if (inTargetShortcut && depth === 4 && expectingShortcutKey) {
        expectingShortcutKey = false;
        try {
          const parsedKey: unknown = JSON.parse(content.slice(start, i + 1));
          if (parsedKey === subField) return strLine;
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
      if (inShortcutsArray && depth === 3) return shortcutStartLine;
      depth -= 1;
      if (depth === 0) break;
    } else if (ch === '{') {
      depth += 1;
      if (inTargetBookmark && depth === 2) expectingBookmarkKey = true;
      else if (inTargetShortcut && depth === 4) expectingShortcutKey = true;
    } else if (ch === '}') {
      if (inTargetShortcut && depth === 4) return shortcutStartLine;
      if (inTargetBookmark && depth === 2) return shortcutStartLine;
      depth -= 1;
    } else if (ch === ',') {
      if (depth === 1) expectingElement = true;
      else if (inTargetBookmark && depth === 2) expectingBookmarkKey = true;
      else if (inShortcutsArray && depth === 3) expectingShortcut = true;
      else if (inTargetShortcut && depth === 4) expectingShortcutKey = true;
    }
  }
  return shortcutStartLine;
}

function friendlyRequirementText(requirement: string): string {
  if (requirement === 'a valid HTTP(S) URL') {
    return 'a valid http:// or https:// address';
  }
  if (
    requirement === 'a valid HTTP(S) search URL containing %s'
    || requirement === 'a valid HTTP(S) query URL containing %s'
  ) {
    return 'a valid http:// or https:// address containing %s';
  }
  if (requirement === 'a string array') {
    return 'an array containing only text values';
  }
  return requirement;
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

  if (message === 'Unrecognized bookmark file format.') {
    return {
      title,
      detail: 'Choose a .json bookmark export or a browser-exported .html bookmark file.',
    };
  }

  if (message === 'No bookmarks found in HTML file.') {
    return {
      title,
      detail: 'No bookmarks were found in that HTML file.',
    };
  }

  if (message === 'No bookmarks found in JSON file.') {
    return {
      title,
      detail: 'No bookmarks were found in that JSON file.',
    };
  }

  if (/^No valid http:\/\/ or https:\/\/ bookmarks found/.test(message)) {
    return {
      title,
      detail: message,
    };
  }

  if (/^Bookmark \d+: section “All” is reserved/.test(message)) {
    return {
      title,
      detail: message,
    };
  }

  // Intra-bookmark duplicate in shortcuts[M].alias
  const intraShortcutDup = message.match(
    /^Bookmark (\d+)\.shortcuts\[(\d+)\]\.alias duplicates "([^"]+)" in Bookmark \d+\.$/,
  );
  if (intraShortcutDup) {
    const [, index, shortcutNum, alias] = intraShortcutDup;
    const line = findShortcutLine(content, Number(index), Number(shortcutNum), 'alias');
    const loc = line !== null ? ` (line ${line})` : '';
    return {
      title,
      detail: `Bookmark ${index}${loc}: shortcut ${shortcutNum} (“alias”) duplicates “!${alias}” already used on this bookmark.`,
    };
  }

  // Intra-bookmark duplicate in legacy .alias
  const intraLegacyDup = message.match(
    /^Bookmark (\d+)\.alias duplicates "([^"]+)" in Bookmark \d+\.$/,
  );
  if (intraLegacyDup) {
    const [, index, alias] = intraLegacyDup;
    const line = findBookmarkLine(content, Number(index), 'alias');
    const loc = line !== null ? ` (line ${line})` : '';
    return {
      title,
      detail: `Bookmark ${index}${loc}: “alias” duplicates “!${alias}” already used on this bookmark.`,
    };
  }

  // Cross-bookmark duplicate from shortcuts[M].alias
  const crossShortcutDup = message.match(
    /^Bookmark (\d+)\.shortcuts\[(\d+)\]\.alias duplicates "([^"]+)" from Bookmark (\d+)(?: shortcut (\d+))? \(([\s\S]+)\)\.$/,
  );
  if (crossShortcutDup) {
    const [, index, shortcutNum, alias, firstIndex, firstShortcutNum, firstTitle] = crossShortcutDup;
    const line = findShortcutLine(content, Number(index), Number(shortcutNum), 'alias');
    const firstLine = firstShortcutNum !== undefined
      ? findShortcutLine(content, Number(firstIndex), Number(firstShortcutNum), 'alias')
      : findBookmarkLine(content, Number(firstIndex), 'alias');
    const loc = line !== null ? ` (line ${line})` : '';
    const firstLoc = firstLine !== null ? `, line ${firstLine}` : '';
    const cleanTitle = firstTitle.replace(/\s+/g, ' ').trim();
    return {
      title,
      detail: `Bookmark ${index}${loc}: shortcut ${shortcutNum} (“alias”) duplicates “!${alias}” already used by Bookmark ${firstIndex} (“${cleanTitle}”${firstLoc}).`,
    };
  }

  // Cross-bookmark duplicate from legacy .alias
  const duplicateAlias = message.match(
    /^Bookmark (\d+)\.alias duplicates "([^"]+)" from Bookmark (\d+)(?: shortcut (\d+))? \(([\s\S]+)\)\.$/,
  );
  if (duplicateAlias) {
    const [, index, alias, firstIndex, firstShortcutNum, firstTitle] = duplicateAlias;
    const line = findBookmarkLine(content, Number(index), 'alias');
    const firstLine = firstShortcutNum !== undefined
      ? findShortcutLine(content, Number(firstIndex), Number(firstShortcutNum), 'alias')
      : findBookmarkLine(content, Number(firstIndex), 'alias');
    const loc = line !== null ? ` (line ${line})` : '';
    const firstLoc = firstLine !== null ? `, line ${firstLine}` : '';
    const cleanTitle = firstTitle.replace(/\s+/g, ' ').trim();
    return {
      title,
      detail: `Bookmark ${index}${loc}: “alias” duplicates “!${alias}” already used by Bookmark ${firstIndex} (“${cleanTitle}”${firstLoc}).`,
    };
  }

  // Shortcut sub-field error
  const shortcutFieldError = message.match(
    /^Bookmark (\d+)\.shortcuts\[(\d+)\]\.([\w]+) must be (.+)\.$/,
  );
  if (shortcutFieldError) {
    const [, index, shortcutNum, subField, requirement] = shortcutFieldError;
    const line = findShortcutLine(content, Number(index), Number(shortcutNum), subField);
    const loc = line !== null ? ` (line ${line})` : '';
    return {
      title,
      detail: `Bookmark ${index}${loc}: shortcut ${shortcutNum} “${subField}” must be ${friendlyRequirementText(requirement)}.`,
    };
  }

  // Shortcut element non-object error
  const shortcutItemError = message.match(
    /^Bookmark (\d+)\.shortcuts\[(\d+)\] must be an object\.$/,
  );
  if (shortcutItemError) {
    const [, index, shortcutNum] = shortcutItemError;
    const line = findShortcutLine(content, Number(index), Number(shortcutNum));
    const loc = line !== null ? ` (line ${line})` : '';
    return {
      title,
      detail: `Bookmark ${index}${loc}: shortcut ${shortcutNum} must be an object.`,
    };
  }

  const fieldError = message.match(/^Bookmark (\d+)\.([\w]+) must be (.+)\.$/);
  if (fieldError) {
    const [, index, field, requirement] = fieldError;
    const line = findBookmarkLine(content, Number(index), field);
    const loc = line !== null ? ` (line ${line})` : '';
    return {
      title,
      detail: `Bookmark ${index}${loc}: “${field}” must be ${friendlyRequirementText(requirement)}.`,
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
