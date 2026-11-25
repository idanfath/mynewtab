import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeHtmlEntities,
  detectBookmarkFileFormat,
  escapeHtml,
  parseBookmarksHtml,
  parseEditorBookmarks,
  parseImportedBookmarkFile,
  serializeBookmarksHtml,
} from '../src/bookmarkHtml.ts';
import type { Bookmark } from '../src/bookmarks.ts';

test('parses Chrome, Firefox, and Safari bookmark HTML dialects and strips wrappers', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://root.example">Root Link</A>
    <DT><H3>Engineering</H3>
    <DD>Folder notes should not attach to bookmarks
    <DL><p>
      <DT><A HREF="https://react.dev" ICON="data:image/png;base64,AAA" ICON_URI="https://react.dev/favicon.ico" TAGS=" frontend , , Frontend , ui ">React Docs</A>
      <DD>UI library<BR>for the web
      <DT><H3>Frontend / CSS</H3>
      <DL><p>
        <DT><A HREF="https://mdn.example/css">MDN CSS</A>
      </DL><p>
    </DL><p>
  </DL><p>
  <DT><H3 UNFILED_BOOKMARKS_FOLDER="true">Other bookmarks</H3>
  <DL><p>
    <DT><H3>Reading</H3>
    <DL><p>
      <DT><A HREF="https://news.example">News</A>
    </DL><p>
  </DL><p>
  <DT><H3>Favorites</H3>
  <DL><p>
    <DT><H3>Reading List</H3>
    <DL><p>
      <DT><A HREF="https://safari.example">Safari Saved</A>
    </DL><p>
  </DL><p>
</DL><p>`;

  const parsed = parseBookmarksHtml(html);
  assert.equal(parsed.format, 'html');
  assert.equal(parsed.skippedNonHttpCount, 0);
  assert.equal(parsed.bookmarks.length, 5);

  assert.deepEqual(parsed.bookmarks[0], {
    title: 'Root Link',
    url: 'https://root.example/',
    section: 'Uncategorized',
  });
  assert.deepEqual(parsed.bookmarks[1], {
    title: 'React Docs',
    url: 'https://react.dev/',
    section: 'Engineering',
    iconUrl: 'https://react.dev/favicon.ico',
    categories: ['frontend', 'ui'],
    description: 'UI library for the web',
  });
  assert.deepEqual(parsed.bookmarks[2], {
    title: 'MDN CSS',
    url: 'https://mdn.example/css',
    section: 'Engineering',
    subsection: 'Frontend / CSS',
  });
  assert.deepEqual(parsed.bookmarks[3], {
    title: 'News',
    url: 'https://news.example/',
    section: 'Reading',
  });
  assert.deepEqual(parsed.bookmarks[4], {
    title: 'Safari Saved',
    url: 'https://safari.example/',
    section: 'Uncategorized',
  });
});

test('strips localized toolbar wrappers via attributes and preserves explicit section markers', () => {
  const localizedHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Lesezeichenleiste</H3>
  <DL><p>
    <DT><A HREF="https://x.example">X</A>
    <DT><H3>Arbeit</H3>
    <DL><p>
      <DT><A HREF="https://y.example">Y</A>
    </DL><p>
  </DL><p>
  <DT><H3 UNFILED_BOOKMARKS_FOLDER="true">Weitere Lesezeichen</H3>
  <DL><p>
    <DT><A HREF="https://z.example">Z</A>
  </DL><p>
  <DT><H3 DATA-MYNEWTAB-SECTION="1">Favorites</H3>
  <DL><p>
    <DT><A HREF="https://fav.example">Fav</A>
  </DL><p>
</DL><p>`;

  const parsed = parseBookmarksHtml(localizedHtml);
  assert.deepEqual(
    parsed.bookmarks.map((b) => [b.title, b.section]),
    [
      ['X', 'Uncategorized'],
      ['Y', 'Arbeit'],
      ['Z', 'Uncategorized'],
      ['Fav', 'Favorites'],
    ],
  );
});

test('terminates cleanly on malformed equals attributes and unclosed tags', () => {
  const malformedHtml = `
<DL>
  <DT><H3>Dev<DL>
    <DT><A =HREF="https://bad.example" HREF="https://good.example">Good</A>
    <DT><A == HREF="https://good-eq.example">Good Double Eq</A>
    <DT><A = HREF="https://good2.example">Good 2</A>
    <DT><A === HREF="https://good3.example" />Good 3</A>
    <DT><A HREF="https://one.example">One<A HREF="https://two.example">Two</A>
    <DT><H3>Orphan<DT><A HREF="https://after-orphan.example">After Orphan</A>
    <DT><A HREF="https://eof.example">Unclosed EOF
  </DL>
</DL>`;

  const parsed = parseBookmarksHtml(malformedHtml);
  assert.deepEqual(
    parsed.bookmarks.map((b) => [b.title, b.url, b.section]),
    [
      ['Good', 'https://good.example/', 'Dev'],
      ['Good Double Eq', 'https://good-eq.example/', 'Dev'],
      ['Good 2', 'https://good2.example/', 'Dev'],
      ['Good 3', 'https://good3.example/', 'Dev'],
      ['One', 'https://one.example/', 'Dev'],
      ['Two', 'https://two.example/', 'Dev'],
      ['After Orphan', 'https://after-orphan.example/', 'Dev'],
      ['Unclosed EOF', 'https://eof.example/', 'Dev'],
    ],
  );
});

test('skips script, style, comments and handles angle brackets and entities safely', () => {
  const html = `
<!-- <A HREF="https://comment.example">Comment</A> -->
<script type="text/javascript"><a href="https://evil.example">x</a></script >
<style>a { content: "<a href='https://css.example'>y</a>"; }</style>
<DL>
  <DT><H3>Math &amp; Code</H3>
  <DL>
    <DT><A TITLE="a > b" HREF="https://entities.example/?x=1&amp;y=2">2 < 3 &amp;lt; &quot;ok&quot; &#65; &#x42; &#0; &#55296; &#999999999;</A>
  </DL>
</DL>`;

  const parsed = parseBookmarksHtml(html);
  assert.equal(parsed.bookmarks.length, 1);
  assert.equal(parsed.bookmarks[0].section, 'Math & Code');
  assert.equal(parsed.bookmarks[0].url, 'https://entities.example/?x=1&y=2');
  assert.equal(
    parsed.bookmarks[0].title,
    '2 < 3 &lt; "ok" A B \uFFFD \uFFFD \uFFFD',
  );
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('filters non-http schemes, cleans empty tags and subsections, and errors when empty', () => {
  const mixed = `
<DL>
  <DT><H3>All</H3>
  <DL>
    <DT><H3> Frontend /  / React </H3>
    <DL>
      <DT><A HREF="javascript:alert(1)">JS</A>
      <DT><A HREF="data:text/html,hi">Data</A>
      <DT><A HREF="place:sort=8">Place</A>
      <DT><A HREF="chrome://settings">Chrome</A>
      <DT><A HREF="about:blank">About</A>
      <DT><A HREF="file:///tmp/a.html">File</A>
      <DT><A HREF="mailto:a@b.com">Mail</A>
      <DT><A HREF="ftp://files.example">FTP</A>
      <DT><A HREF="#local-anchor">Anchor</A>
      <DT><A HREF="https://valid.example" TAGS=" , " ICON="data:image/png;base64,xyz">Valid</A>
    </DL>
  </DL>
</DL>`;

  const parsed = parseBookmarksHtml(mixed);
  assert.equal(parsed.skippedNonHttpCount, 8);
  assert.equal(parsed.bookmarks.length, 1);
  assert.deepEqual(parsed.bookmarks[0], {
    title: 'Valid',
    url: 'https://valid.example/',
    section: 'Uncategorized',
    subsection: 'Frontend / React',
  });

  assert.throws(
    () => parseBookmarksHtml('<DL><DT><A HREF="javascript:void(0)">Only JS</A></DL>'),
    /skipped 1 non-web link/,
  );
  assert.throws(
    () => parseBookmarksHtml('<DL><p></DL>'),
    /No bookmarks found in HTML file/,
  );
});

test('round-trips bookmarks through Netscape HTML serializer and parser', () => {
  const original: Bookmark[] = [
    {
      title: 'GitHub & Code',
      url: 'https://github.com/',
      section: 'Favorites',
      description: 'Code hosting <repo>',
      iconUrl: 'https://github.com/favicon.ico',
      categories: ['Dev', 'Git'],
    },
    {
      title: 'React Docs',
      url: 'https://react.dev/',
      section: 'Engineering',
      subsection: 'Frontend / UI',
      description: 'Component library',
    },
    {
      title: 'MDN',
      url: 'https://developer.mozilla.org/',
      section: 'Engineering',
    },
  ];

  const html = serializeBookmarksHtml(original);
  const reparsed = parseBookmarksHtml(html);

  assert.equal(reparsed.bookmarks.length, 3);
  assert.deepEqual(reparsed.bookmarks[0], original[0]);
  // Direct bookmarks within Engineering are emitted before nested subsections
  assert.deepEqual(reparsed.bookmarks[1], original[2]);
  assert.deepEqual(reparsed.bookmarks[2], original[1]);
});

test('detects format, preserves unknown keys on JSON import, and validates parseEditorBookmarks', () => {
  assert.equal(detectBookmarkFileFormat('  [{"title":"A"}]'), 'json');
  assert.equal(detectBookmarkFileFormat('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), 'html');
  assert.equal(detectBookmarkFileFormat('   ', 'export.html'), 'html');
  assert.equal(detectBookmarkFileFormat('   ', 'backup.json'), 'json');
  assert.equal(detectBookmarkFileFormat('plain random text', 'notes.txt'), null);

  assert.throws(
    () => parseImportedBookmarkFile('not bookmarks', 'notes.txt'),
    /Unrecognized bookmark file format/,
  );
  assert.throws(
    () => parseImportedBookmarkFile('[]', 'empty.json'),
    /No bookmarks found in JSON file/,
  );

  const imported = parseImportedBookmarkFile(
    JSON.stringify([
      {
        title: ' Docs ',
        url: ' https://docs.example ',
        section: ' All ',
        iconUrl: 'cdn.example.com/i.png',
        alias: 'd',
        searchUrl: 'https://docs.example/?q=%s',
      },
    ]),
    'bookmarks.json',
  );
  assert.equal(imported.format, 'json');
  assert.equal(imported.bookmarks[0].section, 'Uncategorized');
  assert.equal(imported.bookmarks[0].iconUrl, 'https://cdn.example.com/i.png');
  assert.equal((imported.bookmarks[0] as unknown as Record<string, unknown>).alias, 'd');
  assert.equal(
    (imported.bookmarks[0] as unknown as Record<string, unknown>).searchUrl,
    'https://docs.example/?q=%s',
  );

  assert.throws(
    () => parseEditorBookmarks('[{"title":"A","url":"https://a.example","section":" all "}]'),
    /section “All” is reserved/,
  );

  const edited = parseEditorBookmarks(
    JSON.stringify([
      {
        title: ' A ',
        url: ' https://a.example ',
        section: ' Work ',
        iconUrl: 'cdn.example.com/a.png',
        description: '  ',
        categories: [' one ', ''],
        alias: 'aw',
      },
    ]),
  );
  assert.equal(edited[0].title, 'A');
  assert.equal(edited[0].section, 'Work');
  assert.equal(edited[0].iconUrl, 'https://cdn.example.com/a.png');
  assert.equal('description' in edited[0], false);
  assert.deepEqual(edited[0].categories, ['one']);
  assert.equal((edited[0] as unknown as Record<string, unknown>).alias, 'aw');
  assert.deepEqual(parseEditorBookmarks('[]'), []);
});

test('merges intra-file HTML duplicates and enriches optional fields across duplicate anchors', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Work</H3>
  <DL><p>
    <DT><A HREF="https://dup.example/docs">Primary Title</A>
  </DL><p>
  <DT><H3>Archive</H3>
  <DL><p>
    <DT><A HREF="https://DUP.example:443/docs/" ICON_URI="https://dup.example/favicon.ico" TAGS="Reference, Docs">Secondary Title</A>
    <DD>Enriched from duplicate entry
  </DL><p>
</DL><p>`;

  const parsed = parseBookmarksHtml(html);
  assert.equal(parsed.intraFileDuplicateCount, 1);
  assert.equal(parsed.bookmarks.length, 1);
  assert.deepEqual(parsed.bookmarks[0], {
    title: 'Primary Title',
    url: 'https://dup.example/docs',
    section: 'Work',
    iconUrl: 'https://dup.example/favicon.ico',
    categories: ['Reference', 'Docs'],
    description: 'Enriched from duplicate entry',
  });
});

test('rejects entity-obfuscated unsafe schemes in HTML href attributes', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><A HREF="&#x09;javascript:alert(1)">Tab JS</A>
  <DT><A HREF="java&#x0a;script:alert(1)">Newline JS</A>
  <DT><A HREF="&#106;avascript:alert(1)">Decimal JS</A>
  <DT><A HREF="https://safe.example/page">Safe Page</A>
</DL><p>`;

  const parsed = parseBookmarksHtml(html);
  assert.equal(parsed.skippedNonHttpCount, 3);
  assert.equal(parsed.bookmarks.length, 1);
  assert.deepEqual(parsed.bookmarks[0], {
    title: 'Safe Page',
    url: 'https://safe.example/page',
    section: 'Uncategorized',
  });
});

test('handles deeply nested folders (25 levels), unclosed quotes/scripts at EOF, mixed-case attrs, and tricky script/style closers', () => {
  let openDl = '<DL>';
  let closeDl = '</DL>';
  for (let i = 1; i <= 25; i += 1) {
    openDl += `<DT><H3>Level ${i}</H3><DL>`;
    closeDl = `</DL>${closeDl}`;
  }
  const deepHtml = `${openDl}<DT><A HREF="https://deep.example/p">Deep</A>${closeDl}`;
  const deepParsed = parseBookmarksHtml(deepHtml);
  assert.equal(deepParsed.bookmarks.length, 1);
  assert.equal(deepParsed.bookmarks[0].section, 'Level 1');
  assert.equal(deepParsed.bookmarks[0].subsection?.split(' / ').length, 24);
  assert.equal(deepParsed.bookmarks[0].subsection?.startsWith('Level 2 / '), true);
  assert.equal(deepParsed.bookmarks[0].subsection?.endsWith(' / Level 25'), true);

  const adversarialHtml = `
<script>const x = "<a href=\\"https://evil.example\\">Evil</a>"; const y = "</script";</script foo="bar">
<style>/* <a href="https://css.example">CSS</a> */</style foo="baz">
<DL>
  <DT><a   hReF = 'https://mixed.example/?k=v&amp;x=1'  iCoN_uRi = "https://mixed.example/i.png"  tAgS = " a , b "  TITLE="1 < 2 > 0" ><b>Bold</b> <span>Text</span></a>
  <DT><A HREF="https://unclosed.example`;
  const advParsed = parseBookmarksHtml(adversarialHtml);
  assert.equal(advParsed.bookmarks.length, 2);
  assert.deepEqual(advParsed.bookmarks[0], {
    title: 'Bold Text',
    url: 'https://mixed.example/?k=v&x=1',
    section: 'Uncategorized',
    iconUrl: 'https://mixed.example/i.png',
    categories: ['a', 'b'],
  });
  assert.deepEqual(advParsed.bookmarks[1], {
    title: 'unclosed.example',
    url: 'https://unclosed.example/',
    section: 'Uncategorized',
  });

  const unclosedScriptEof = `<DL><DT><A HREF="https://ok.example">OK</A></DL><script><a href="https://nope.example">Nope</a>`;
  const scriptEofParsed = parseBookmarksHtml(unclosedScriptEof);
  assert.equal(scriptEofParsed.bookmarks.length, 1);
  assert.equal(scriptEofParsed.bookmarks[0].title, 'OK');
});

test('handles entity boundaries, URL variants (ports, queries, fragments, IPv6, IDN), BOM sniffing, and special-char HTML round-trip', () => {
  assert.equal(decodeHtmlEntities('&#0;'), '\uFFFD');
  assert.equal(decodeHtmlEntities('&#1;'), '\u0001');
  assert.equal(decodeHtmlEntities('&#55295;'), '\uD7FF');
  assert.equal(decodeHtmlEntities('&#55296;'), '\uFFFD');
  assert.equal(decodeHtmlEntities('&#57343;'), '\uFFFD');
  assert.equal(decodeHtmlEntities('&#57344;'), '\uE000');
  assert.equal(decodeHtmlEntities('&#x10ffff;'), String.fromCodePoint(0x10ffff));
  assert.equal(decodeHtmlEntities('&#x110000;'), '\uFFFD');
  assert.equal(decodeHtmlEntities('&NBSP;&APOS;&QUOT;&unknown;'), ` '"&unknown;`);

  const urlsHtml = `<DL>
    <DT><A HREF="https://host.example:8443/path?b=2&amp;a=1#frag">QueryPortFrag</A>
    <DT><A HREF="https://[::1]:8080/ipv6">IPv6</A>
    <DT><A HREF="https://münchen.de/idn">IDN</A>
    <DT><A HREF="https://www.example.com"></A>
    <DT><A HREF="https://www."></A>
  </DL>`;
  const parsedUrls = parseBookmarksHtml(urlsHtml);
  assert.deepEqual(
    parsedUrls.bookmarks.map((b) => [b.title, b.url]),
    [
      ['QueryPortFrag', 'https://host.example:8443/path?b=2&a=1#frag'],
      ['IPv6', 'https://[::1]:8080/ipv6'],
      ['IDN', 'https://xn--mnchen-3ya.de/idn'],
      ['example.com', 'https://www.example.com/'],
      ['https://www./', 'https://www./'],
    ],
  );

  // Round-trip fidelity when section contains '/' and HTML special chars & < > " '
  const special: Bookmark[] = [
    {
      title: `A & B <C> "D" 'E'`,
      url: 'https://special.example:8443/?x=1&y=2#sec',
      section: 'Design / UI & <Tools>',
      subsection: `Sub & <1> / Leaf '2'`,
      description: `Line <1> & "2" '3'`,
      iconUrl: 'https://special.example/icon.png',
      categories: ['UI & UX', 'Refs'],
    },
  ];
  const reparsed = parseBookmarksHtml(serializeBookmarksHtml(special));
  assert.deepEqual(reparsed.bookmarks, special);

  // UTF-8 BOM handling in format sniffing, import, and editor parsing
  const jsonWithBom = `\uFEFF${JSON.stringify([{ title: 'B', url: 'https://b.example', section: 'Work' }])}`;
  assert.equal(detectBookmarkFileFormat(jsonWithBom), 'json');
  assert.equal(parseImportedBookmarkFile(jsonWithBom).bookmarks[0].title, 'B');
  assert.equal(parseEditorBookmarks(jsonWithBom)[0].title, 'B');

  const htmlWithBom = `\uFEFF<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><A HREF="https://h.example">H</A></DL>`;
  assert.equal(detectBookmarkFileFormat(htmlWithBom), 'html');
  assert.equal(parseImportedBookmarkFile(htmlWithBom).bookmarks[0].title, 'H');

  assert.throws(() => parseImportedBookmarkFile('\uFEFF   ', 'empty.json'), /No bookmarks found in JSON file/);
  assert.throws(() => parseImportedBookmarkFile('\uFEFF   ', 'empty.html'), /No bookmarks found in HTML file/);
});
