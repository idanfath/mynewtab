import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import Editor from '@monaco-editor/react';
import icon from './assets/icon.png';
import { getFaviconUrl, normalizeUrl } from './lib';
import {
  parseBookmarks,
  reorderBookmarkSections,
  searchBookmarks,
  type Bookmark,
} from './bookmarks';
import './App.css';

const STORAGE_KEY = 'newtab-directory-bookmarks';

function loadStoredBookmarks(): Bookmark[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseBookmarks(stored) : [];
  } catch {
    return [];
  }
}

function MetaList({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null;
  return (
    <div className="app-meta-row">
      <dt>{label}</dt>
      <dd>{values.join(' · ')}</dd>
    </div>
  );
}

function tierRank(tier: string): string {
  return tier.toUpperCase().replace('-TIER', '').trim();
}

function App() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(loadStoredBookmarks);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('All');
  const [activeBookmark, setActiveBookmark] = useState<Bookmark | null>(null);
  const [keyboardSelection, setKeyboardSelection] = useState(false);
  const [draggedSection, setDraggedSection] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{
    name: string;
    position: 'before' | 'after';
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorClosing, setEditorClosing] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [editorError, setEditorError] = useState('');
  const [error, setError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key === '/' &&
        !target?.isContentEditable &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      ) {
        event.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    bookmarks.forEach((bookmark) => {
      counts.set(bookmark.section, (counts.get(bookmark.section) ?? 0) + 1);
    });
    return counts;
  }, [bookmarks]);

  const matches = useMemo(() => {
    const searched = searchBookmarks(bookmarks, query);

    return section === 'All'
      ? searched
      : searched.filter((bookmark) => bookmark.section === section);
  }, [bookmarks, query, section]);

  const groupedMatches = useMemo(() => {
    const groups = new Map<string, Bookmark[]>();
    matches.forEach((bookmark) => {
      const current = groups.get(bookmark.section) ?? [];
      current.push(bookmark);
      groups.set(bookmark.section, current);
    });
    return groups;
  }, [matches]);

  const inspected = activeBookmark && matches.includes(activeBookmark)
    ? activeBookmark
    : matches[0] ?? null;

  const selectRelativeBookmark = (direction: 1 | -1) => {
    if (!matches.length) return;

    const currentIndex = activeBookmark ? matches.indexOf(activeBookmark) : -1;
    const nextIndex = direction === 1
      ? (currentIndex + 1) % matches.length
      : currentIndex <= 0 ? matches.length - 1 : currentIndex - 1;

    setKeyboardSelection(true);
    setActiveBookmark(matches[nextIndex]);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-app-bookmark-index="${nextIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  };

  const applyBookmarks = (nextBookmarks: Bookmark[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookmarks));
    setBookmarks(nextBookmarks);
    setSection('All');
    setQuery('');
    setActiveBookmark(nextBookmarks[0] ?? null);
    setKeyboardSelection(false);
    setError('');
  };

  const reorderSection = (
    source: string,
    target: string,
    position: 'before' | 'after',
  ) => {
    if (source === target) return;

    const nextBookmarks = reorderBookmarkSections(
      bookmarks,
      source,
      target,
      position,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookmarks));
    setBookmarks(nextBookmarks);
    setActiveBookmark(null);
    setKeyboardSelection(false);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const nextBookmarks = parseBookmarks(await file.text());
      applyBookmarks(nextBookmarks);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : 'Could not read file.');
    } finally {
      event.target.value = '';
    }
  };

  const exportBookmarks = () => {
    const blob = new Blob([JSON.stringify(bookmarks, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'bookmarks.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const openEditor = () => {
    setEditorContent(JSON.stringify(bookmarks, null, 2));
    setEditorError('');
    setEditorClosing(false);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (editorClosing) return;
    setEditorClosing(true);
    window.setTimeout(() => {
      setEditorOpen(false);
      setEditorClosing(false);
    }, 180);
  };

  const saveEditor = () => {
    try {
      applyBookmarks(parseBookmarks(editorContent));
      closeEditor();
      setEditorError('');
    } catch (saveError) {
      setEditorError(
        saveError instanceof Error ? saveError.message : 'Bookmarks are invalid.',
      );
    }
  };

  if (!bookmarks.length) {
    return (
      <main className="app-empty app-page">
        <section className="app-empty-panel">
          <div className="app-empty-brand">
            <img src={icon} alt="" className="app-empty-mark" />
          </div>
          <h1>Bring your index.</h1>
          <p className="app-empty-copy">
            Choose your <code>bookmarks.json</code>. It stays in this browser
            and is never uploaded.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFile}
          />
          <div className="app-empty-action">
            <button
              type="button"
              className="app-load-button"
              onClick={() => fileRef.current?.click()}
            >
              Choose JSON file <span aria-hidden="true">↗</span>
            </button>
          </div>
          {error && <p className="app-file-error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell app-page">
      <aside className="app-sidebar">
        <a href="/" className="app-brand" aria-label="Reload new tab page">
          <img src={icon} alt="" />
          <span>
            <strong>Index</strong>
            <small>Personal atlas</small>
          </span>
        </a>

        <p className="app-nav-label">Directory</p>
        <nav className="app-section-nav" aria-label="Bookmark sections">
          <button
            className={section === 'All' ? 'is-active' : ''}
            aria-pressed={section === 'All'}
            onClick={() => {
              setSection('All');
              setActiveBookmark(null);
              setKeyboardSelection(false);
            }}
          >
            <span>Everything</span><small>{bookmarks.length}</small>
          </button>
          {[...sectionCounts].map(([name, count], index) => (
            <button
              key={name}
              draggable
              style={{ animationDelay: `${(index + 1) * 55}ms` }}
              className={`${section === name ? 'is-active' : ''}${
                draggedSection === name ? ' is-dragging' : ''
              }${
                dragTarget?.name === name
                  ? ` is-drop-${dragTarget.position}`
                  : ''
              }`}
              aria-pressed={section === name}
              title="Drag to reorder"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', name);
                setDraggedSection(name);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const bounds = event.currentTarget.getBoundingClientRect();
                setDragTarget({
                  name,
                  position: event.clientY < bounds.top + bounds.height / 2
                    ? 'before'
                    : 'after',
                });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = event.dataTransfer.getData('text/plain');
                if (source && dragTarget) {
                  reorderSection(source, name, dragTarget.position);
                }
                setDraggedSection(null);
                setDragTarget(null);
              }}
              onDragEnd={() => {
                setDraggedSection(null);
                setDragTarget(null);
              }}
              onClick={() => {
                setSection(name);
                setActiveBookmark(null);
                setKeyboardSelection(false);
              }}
            >
              <span>{name}</span><small>{count}</small>
            </button>
          ))}
        </nav>

        <div className="app-data-actions">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFile}
          />
          <button type="button" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <button type="button" onClick={exportBookmarks}>
            Export
          </button>
          <button type="button" onClick={openEditor}>
            Edit JSON
          </button>
        </div>

      </aside>

      <main className="app-main">
        <header className="app-header">
          <div>
            <p className="app-kicker">Personal directory</p>
            <h1>{section === 'All' ? 'Everything' : section}</h1>
          </div>
          <div className={`app-search-wrap${searchOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="app-search-trigger"
              aria-label={searchOpen ? 'Focus search' : 'Open search'}
              onClick={() => {
                setSearchOpen(true);
                window.requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              /
            </button>
            <label className="app-search">
              <input
                ref={searchRef}
                value={query}
                onBlur={() => {
                  if (!query) setSearchOpen(false);
                }}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setKeyboardSelection(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    selectRelativeBookmark(1);
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    selectRelativeBookmark(-1);
                  } else if (event.key === 'Enter' && inspected) {
                    event.preventDefault();
                    const destination = normalizeUrl(inspected.url);
                    if (event.ctrlKey || event.metaKey) {
                      window.open(destination, '_blank', 'noopener,noreferrer');
                    } else {
                      window.location.assign(destination);
                    }
                  } else if (event.key === 'Escape') {
                    setQuery('');
                    setSearchOpen(false);
                    searchRef.current?.blur();
                  }
                }}
                placeholder="Find anything…"
                aria-label="Search test bookmarks"
              />
              <small>{matches.length}</small>
            </label>
          </div>
        </header>

        {error && <p className="app-inline-error">{error}</p>}

        <div key={section} className="app-directory">
          {[...groupedMatches].map(([sectionName, items]) => (
            <section key={sectionName} className="app-group">
              <div className="app-group-heading">
                <h2>{sectionName}</h2>
                <span>{String(items.length).padStart(2, '0')}</span>
              </div>
              <div className="app-bookmark-list">
                {items.map((bookmark) => {
                  const bookmarkIndex = matches.indexOf(bookmark);
                  return (
                    <a
                      key={`${bookmark.url}-${bookmark.title}`}
                      href={normalizeUrl(bookmark.url)}
                      data-app-bookmark-index={bookmarkIndex}
                      className={bookmark === inspected
                        ? `app-bookmark is-current${keyboardSelection ? ' is-keyboard-current' : ''}`
                        : 'app-bookmark'}
                      onMouseEnter={() => {
                        setKeyboardSelection(false);
                        setActiveBookmark(bookmark);
                      }}
                      onFocus={() => {
                        setKeyboardSelection(true);
                        setActiveBookmark(bookmark);
                      }}
                    >
                      <img
                        src={bookmark.iconUrl || getFaviconUrl(bookmark.url, 64)}
                        alt=""
                      />
                      <span className="app-bookmark-copy">
                        <strong>{bookmark.title}</strong>
                        <small>
                          {bookmark.subsection || bookmark.description || bookmark.product || bookmark.url}
                        </small>
                      </span>
                      <span className="app-bookmark-tail">
                        {bookmark.tier && (
                          <em
                            className="app-tier"
                            data-tier={tierRank(bookmark.tier)}
                          >
                            {bookmark.tier}
                          </em>
                        )}
                        <b aria-hidden="true">↗</b>
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          ))}

          {!matches.length && (
            <div className="app-no-results">
              <span>00</span>
              <h2>No destination found.</h2>
              <button onClick={() => { setQuery(''); setSection('All'); }}>
                Reset search
              </button>
            </div>
          )}
        </div>
      </main>

      <aside className="app-inspector" aria-live="polite">
        {inspected && (
          <div
            key={inspected.url}
            className={`app-inspector-inner${keyboardSelection ? ' is-instant' : ''}`}
          >
            <p className="app-kicker">In focus</p>
            <img
              src={inspected.iconUrl || getFaviconUrl(inspected.url, 128)}
              alt=""
              className="app-inspector-icon"
            />
            <h2>{inspected.title}</h2>
            <p className="app-inspector-location">
              {inspected.section}
              {inspected.subsection ? ` / ${inspected.subsection}` : ''}
            </p>
            <p className="app-inspector-url">{new URL(normalizeUrl(inspected.url)).hostname}</p>
            {(inspected.description || inspected.product) && (
              <p className="app-inspector-description">
                {inspected.description || inspected.product}
              </p>
            )}
            <dl>
              {inspected.subsection && (
                <div className="app-meta-row">
                  <dt>Group</dt><dd>{inspected.subsection}</dd>
                </div>
              )}
              {inspected.tier && (
                <div className="app-meta-row">
                  <dt>Tier</dt>
                  <dd>
                    <span
                      className="app-tier"
                      data-tier={tierRank(inspected.tier)}
                    >
                      {inspected.tier}
                    </span>
                  </dd>
                </div>
              )}
              <MetaList label="Category" values={inspected.categories} />
              <MetaList label="Does" values={inspected.capabilities} />
              <MetaList label="Format" values={inspected.formats} />
              <MetaList label="Good" values={inspected.pros} />
              <MetaList label="Watch" values={inspected.cons} />
            </dl>
            <a href={normalizeUrl(inspected.url)} className="app-open-link">
              Open destination <span>↗</span>
            </a>
          </div>
        )}
      </aside>

      {editorOpen && (
        <div
          className={`app-editor-backdrop${editorClosing ? ' is-closing' : ''}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <section
            className={`app-editor${editorClosing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-editor-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeEditor();
            }}
          >
            <header>
              <div>
                <p className="app-kicker">Local data</p>
                <h2 id="app-editor-title">Edit JSON</h2>
              </div>
              <div className="app-editor-actions">
                <button type="button" onClick={closeEditor}>
                  Cancel
                </button>
                <button type="button" className="is-primary" onClick={saveEditor}>
                  Save changes
                </button>
              </div>
            </header>
            {editorError && <p className="app-editor-error">{editorError}</p>}
            <div className="app-editor-surface">
              <Editor
                height="100%"
                language="json"
                theme="index-json"
                value={editorContent}
                beforeMount={(monaco) => {
                  monaco.editor.defineTheme('index-json', {
                    base: 'vs-dark',
                    inherit: true,
                    rules: [
                      { token: 'string.key.json', foreground: 'D7A85A' },
                      { token: 'string.value.json', foreground: 'B8C6A5' },
                      { token: 'number.json', foreground: 'D69A72' },
                      { token: 'delimiter.bracket.json', foreground: 'AFA59A' },
                    ],
                    colors: {
                      'editor.background': '#171513',
                      'editor.foreground': '#D9D2C7',
                      'editorLineNumber.foreground': '#625B53',
                      'editorLineNumber.activeForeground': '#B7A98F',
                      'editorCursor.foreground': '#D7A85A',
                      'editor.selectionBackground': '#65533866',
                      'editor.lineHighlightBackground': '#211E1A',
                      'editorIndentGuide.background': '#2B2722',
                      'editorIndentGuide.activeBackground': '#4A4034',
                      'editorWidget.background': '#211E1A',
                      'editorWidget.border': '#4B4339',
                    },
                  });
                }}
                onChange={(value) => {
                  setEditorContent(value ?? '');
                  setEditorError('');
                }}
                options={{
                  automaticLayout: true,
                  fontSize: 12,
                  lineHeight: 21,
                  minimap: { enabled: false },
                  padding: { top: 18, bottom: 18 },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  overviewRulerBorder: false,
                  scrollbar: {
                    verticalScrollbarSize: 8,
                    horizontalScrollbarSize: 8,
                  },
                }}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
