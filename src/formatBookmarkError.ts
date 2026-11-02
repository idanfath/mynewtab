import type { AppError } from './useBookmarks';

export function jsonErrorLocation(error: SyntaxError, content: string): string {
  const position = error.message.match(/position\s+(\d+)/i)?.[1];
  if (!position) return '';

  const offset = Number(position);
  const lines = content.slice(0, offset).split('\n');
  return ` near line ${lines.length}, column ${lines.at(-1)!.length + 1}`;
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

  const fieldError = message.match(/^Bookmark (\d+)\.([\w]+) must be (.+)\.$/);
  if (fieldError) {
    const [, index, field, requirement] = fieldError;
    const friendlyRequirement = requirement === 'a valid HTTP(S) URL'
      ? 'a valid http:// or https:// address'
      : requirement === 'a string array'
        ? 'an array containing only text values'
        : requirement;
    return {
      title,
      detail: `Bookmark ${index}: “${field}” must be ${friendlyRequirement}.`,
    };
  }

  const bookmarkError = message.match(/^Bookmark (\d+) must be an object\.$/);
  if (bookmarkError) {
    return {
      title,
      detail: `Bookmark ${bookmarkError[1]} must be a bookmark object.`,
    };
  }

  return {
    title,
    detail: 'Bookmark data could not be validated. Check the file and try again.',
  };
}
