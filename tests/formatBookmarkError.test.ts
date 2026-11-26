import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBookmarks } from '../src/bookmarks.ts';
import {
  findBookmarkLine,
  findShortcutLine,
  formatBookmarkError,
} from '../src/formatBookmarkError.ts';

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

test('findShortcutLine and formatBookmarkError pinpoint multi-shortcut errors across CRLF and escaped keys', () => {
  const multiJson = [
    '[',
    '  {',
    '    "title": "GitHub",',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      {',
    '        "alias": "gh",',
    '        "queryUrl": "https://github.com/search?q=%s"',
    '      },',
    '      {',
    '        "\\u0061lias": "ghr",',
    '        "queryUrl": "https://github.com/no-placeholder"',
    '      }',
    '    ]',
    '  }',
    ']',
  ].join('\r\n');

  assert.equal(findShortcutLine(multiJson, 1, 1, 'alias'), 8);
  assert.equal(findShortcutLine(multiJson, 1, 2, 'alias'), 12);
  assert.equal(findShortcutLine(multiJson, 1, 2, 'queryUrl'), 13);

  let badQueryErr: unknown;
  try {
    parseBookmarks(multiJson);
  } catch (err) {
    badQueryErr = err;
  }
  assert.equal(
    formatBookmarkError(badQueryErr, multiJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 13): shortcut 2 “queryUrl” must be a valid http:// or https:// address containing %s.',
  );

  // Cross-bookmark duplicate between shortcuts[] on Bookmark 1 and legacy alias on Bookmark 2
  const crossDupJson = [
    '[',
    '  {',
    '    "title": "GitHub",',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      { "alias": "gh" },',
    '      { "alias": "ghr" }',
    '    ]',
    '  },',
    '  {',
    '    "title": "Mirror",',
    '    "url": "https://mirror.example/",',
    '    "section": "Dev",',
    '    "alias": "ghr"',
    '  }',
    ']',
  ].join('\n');

  let crossErr: unknown;
  try {
    parseBookmarks(crossDupJson);
  } catch (err) {
    crossErr = err;
  }
  assert.equal(
    formatBookmarkError(crossErr, crossDupJson, 'Couldn’t save changes').detail,
    'Bookmark 2 (line 15): “alias” duplicates “!ghr” already used by Bookmark 1 (“GitHub”, line 8).',
  );

  // Intra-bookmark duplicate in shortcuts[]
  const intraDupJson = [
    '[',
    '  {',
    '    "title": "GitHub",',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      { "alias": "gh" },',
    '      { "alias": "!GH" }',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  let intraErr: unknown;
  try {
    parseBookmarks(intraDupJson);
  } catch (err) {
    intraErr = err;
  }
  assert.equal(
    formatBookmarkError(intraErr, intraDupJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 8): shortcut 2 (“alias”) duplicates “!gh” already used on this bookmark.',
  );

  // Non-object shortcut entry
  const nonObjJson = '[\n  {\n    "title": "A",\n    "url": "https://a.example",\n    "section": "Dev",\n    "shortcuts": [\n      "bad"\n    ]\n  }\n]';
  let nonObjErr: unknown;
  try {
    parseBookmarks(nonObjJson);
  } catch (err) {
    nonObjErr = err;
  }
  assert.equal(
    formatBookmarkError(nonObjErr, nonObjJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 7): shortcut 1 must be an object.',
  );
});

test('findShortcutLine and formatBookmarkError handle preceding arrays/nested objects, dual shortcuts[] duplicates, legacy-vs-shortcuts duplicates, and missing alias fallback', () => {
  // Preceding array AND nested unknown object containing a fake "shortcuts" key
  const nestedPrecedingJson = [
    '[',
    '  {',
    '    "title": "Docs",',
    '    "url": "https://docs.example/",',
    '    "section": "Dev",',
    '    "categories": ["a", "b"],',
    '    "meta": {',
    '      "shortcuts": [{ "alias": "fake" }]',
    '    },',
    '    "shortcuts": [',
    '      {',
    '        "alias": "ok"',
    '      },',
    '      {',
    '        "alias": "bad alias!"',
    '      }',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  assert.equal(findShortcutLine(nestedPrecedingJson, 1, 1, 'alias'), 12);
  assert.equal(findShortcutLine(nestedPrecedingJson, 1, 2, 'alias'), 15);
  let nestedErr: unknown;
  try {
    parseBookmarks(nestedPrecedingJson);
  } catch (err) {
    nestedErr = err;
  }
  assert.equal(
    formatBookmarkError(nestedErr, nestedPrecedingJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 15): shortcut 2 “alias” must be 1-32 lowercase letters, numbers, or hyphens.',
  );

  // Cross-bookmark duplicate where BOTH Bookmark 1 and Bookmark 2 use shortcuts[]
  const dualShortcutsDupJson = [
    '[',
    '  {',
    '    "title": "GitHub",',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      { "alias": "gh" },',
    '      { "alias": "ghr" }',
    '    ]',
    '  },',
    '  {',
    '    "title": "GitLab",',
    '    "url": "https://gitlab.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      { "alias": "gl" },',
    '      { "alias": "ghr" }',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  let dualDupErr: unknown;
  try {
    parseBookmarks(dualShortcutsDupJson);
  } catch (err) {
    dualDupErr = err;
  }
  assert.ok(dualDupErr instanceof Error);
  assert.equal(
    dualDupErr.message,
    'Bookmark 2.shortcuts[2].alias duplicates "ghr" from Bookmark 1 shortcut 2 (GitHub).',
  );
  assert.equal(
    formatBookmarkError(dualDupErr, dualShortcutsDupJson, 'Couldn’t save changes').detail,
    'Bookmark 2 (line 17): shortcut 2 (“alias”) duplicates “!ghr” already used by Bookmark 1 (“GitHub”, line 8).',
  );

  // Intra-bookmark duplicate between shortcuts[1] and legacy "alias" on the same bookmark
  const intraMixedDupJson = [
    '[',
    '  {',
    '    "title": "GitHub",',
    '    "url": "https://github.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      { "alias": "gh" }',
    '    ],',
    '    "alias": "!GH"',
    '  }',
    ']',
  ].join('\n');

  let intraMixedErr: unknown;
  try {
    parseBookmarks(intraMixedDupJson);
  } catch (err) {
    intraMixedErr = err;
  }
  assert.equal(
    formatBookmarkError(intraMixedErr, intraMixedDupJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 9): “alias” duplicates “!gh” already used on this bookmark.',
  );

  // Shortcut object missing "alias" key falls back to the shortcut `{` start line
  const missingAliasJson = [
    '[',
    '  {',
    '    "title": "Search",',
    '    "url": "https://example.com/",',
    '    "section": "Dev",',
    '    "shortcuts": [',
    '      {',
    '        "queryUrl": "https://example.com/?q=%s"',
    '      }',
    '    ]',
    '  }',
    ']',
  ].join('\n');

  assert.equal(findShortcutLine(missingAliasJson, 1, 1, 'alias'), 7);
  let missingAliasErr: unknown;
  try {
    parseBookmarks(missingAliasJson);
  } catch (err) {
    missingAliasErr = err;
  }
  assert.equal(
    formatBookmarkError(missingAliasErr, missingAliasJson, 'Couldn’t save changes').detail,
    'Bookmark 1 (line 7): shortcut 1 “alias” must be 1-32 lowercase letters, numbers, or hyphens.',
  );
});
