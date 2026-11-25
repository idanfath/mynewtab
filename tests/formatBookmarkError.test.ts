import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBookmarks } from '../src/bookmarks.ts';
import { findBookmarkLine, formatBookmarkError } from '../src/formatBookmarkError.ts';

test('reports exact line and column on SyntaxError', () => {
  const broken = '[\n  {\n    "title": "Docs",\n    "url": \n  }\n]';
  let caught: unknown;
  try {
    parseBookmarks(broken);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SyntaxError);
  const formatted = formatBookmarkError(caught, broken, 'Couldn’t import bookmarks');
  assert.equal(formatted.title, 'Couldn’t import bookmarks');
  assert.match(formatted.detail, /invalid JSON/);
  const braceOffset = broken.indexOf('}');
  const deterministic = formatBookmarkError(
    new SyntaxError(`Unexpected token } in JSON at position ${braceOffset}`),
    broken,
    'Couldn’t import bookmarks',
  );
  assert.equal(
    deterministic.detail,
    'File contains invalid JSON near line 5, column 3. Check its syntax and try again.',
  );
});

test('reports exact 1-based line numbers despite non-object array elements and matching property values', () => {
  const multiline = [
    '[',
    '  null,',
    '  123,',
    '  "str",',
    '  [1],',
    '  {',
    '    "title": "url",',
    '    "url": "ftp://bad.example",',
    '    "section": "Work"',
    '  }',
    ']',
  ].join('\n');

  assert.equal(findBookmarkLine(multiline, 1), 2);
  assert.equal(findBookmarkLine(multiline, 2), 3);
  assert.equal(findBookmarkLine(multiline, 3), 4);
  assert.equal(findBookmarkLine(multiline, 4), 5);
  assert.equal(findBookmarkLine(multiline, 5), 6);
  assert.equal(findBookmarkLine(multiline, 5, 'url'), 8);

  const nonObjectErr = formatBookmarkError(
    new Error('Bookmark 1 must be an object.'),
    multiline,
    'Couldn’t save changes',
  );
  assert.equal(nonObjectErr.detail, 'Bookmark 1 (line 2) must be a bookmark object.');

  const fieldErr = formatBookmarkError(
    new Error('Bookmark 5.url must be a valid HTTP(S) URL.'),
    multiline,
    'Couldn’t save changes',
  );
  assert.equal(
    fieldErr.detail,
    'Bookmark 5 (line 8): “url” must be a valid http:// or https:// address.',
  );

  const searchUrlContent = [
    '[',
    '  {',
    '    "title": "Search",',
    '    "url": "https://example.com",',
    '    "section": "Work",',
    '    "searchUrl": "https://example.com/no-placeholder"',
    '  }',
    ']',
  ].join('\n');
  let searchErr: unknown;
  try {
    parseBookmarks(searchUrlContent);
  } catch (err) {
    searchErr = err;
  }
  assert.equal(
    formatBookmarkError(searchErr, searchUrlContent, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 6): “searchUrl” must be a valid http:// or https:// address containing %s.',
  );
});

test('formats duplicate alias errors accurately with multiline titles and both line numbers', () => {
  const duplicateJson = [
    '[',
    '  {',
    '    "title": "Git\\nHub",',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "alias": "gh"',
    '  },',
    '  {',
    '    "title": "Gitea",',
    '    "url": "https://gitea.example/",',
    '    "section": "Dev",',
    '    "alias": "!GH"',
    '  }',
    ']',
  ].join('\n');

  let caught: unknown;
  try {
    parseBookmarks(duplicateJson);
  } catch (err) {
    caught = err;
  }
  const formatted = formatBookmarkError(caught, duplicateJson, 'Couldn’t save changes');
  assert.equal(
    formatted.detail,
    'Bookmark 2 (line 12): “alias” duplicates “!gh” already used by Bookmark 1 (“Git Hub”, line 6).',
  );
});

test('keeps single-line JSON error strings concise without line numbers', () => {
  const singleLine = '[{"title":"GitHub","url":"https://github.com/","section":"Dev","alias":"gh"},{"title":"Gitea","url":"https://gitea.example/","section":"Dev","alias":"gh"}]';
  let caught: unknown;
  try {
    parseBookmarks(singleLine);
  } catch (err) {
    caught = err;
  }
  const formatted = formatBookmarkError(caught, singleLine, 'Couldn’t import bookmarks');
  assert.equal(
    formatted.detail,
    'Bookmark 2: “alias” duplicates “!gh” already used by Bookmark 1 (“GitHub”).',
  );
  assert.ok(!formatted.detail.includes('line '));

  const badUrlSingle = '[{"title":"Docs","url":"ftp://example.com","section":"Work"}]';
  assert.equal(
    formatBookmarkError(
      new Error('Bookmark 1.url must be a valid HTTP(S) URL.'),
      badUrlSingle,
      'Couldn’t import bookmarks',
    ).detail,
    'Bookmark 1: “url” must be a valid http:// or https:// address.',
  );
});
