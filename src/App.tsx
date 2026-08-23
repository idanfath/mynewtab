import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
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
const EMPTY_HEADING = 'Bring your index.';
const DROP_HEADING = 'Drop your file.';
const URL_DROP_HEADING = 'Drop your URL.';
const EMPTY_COPY = 'Choose your bookmarks.json. It stays in this browser and is never uploaded.';
const DROP_COPY = 'Drop your bookmarks.json anywhere. It stays in this browser and is never uploaded.';
const URL_DROP_COPY = 'Drop your URL anywhere. It will be saved locally in the Uncategorized section.';
const SECTION_DRAG_TYPE = 'application/x-mynewtab-section';
const TYPEWRITER_DURATION = 1300;
const TYPEWRITER_PAUSE = 55;

type DropMode = 'file' | 'url' | null;

interface AppError {
  title: string;
  detail: string;
}

function loadStoredBookmarks(): Bookmark[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseBookmarks(stored) : [];
  } catch {
    return [];
  }
}

function detectDropMode(
  dataTransfer: DataTransfer,
  allowFiles: boolean,
): DropMode {
  const types = Array.from(dataTransfer.types);
  if (types.includes(SECTION_DRAG_TYPE)) return null;
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

function readDroppedUrl(dataTransfer: DataTransfer): string {
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

function readDroppedTitle(dataTransfer: DataTransfer, url: string): string {
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

function renderTypedText(text: string, codeToken?: string) {
  if (!codeToken) return text;

  const tokenStart = text.indexOf(codeToken.slice(0, 4));
  if (tokenStart < 0) return text;

  const tokenEnd = Math.min(tokenStart + codeToken.length, text.length);
  return (
    <>
      {text.slice(0, tokenStart)}
      <code>{text.slice(tokenStart, tokenEnd)}</code>
      {text.slice(tokenEnd)}
    </>
  );
}

function TypewriterText({
  text,
  reserve,
  codeToken,
}: {
  text: string;
  reserve: string;
  codeToken?: string;
}) {
  const [displayed, setDisplayed] = useState(text);
  const displayedRef = useRef(text);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayedRef.current = text;
      setDisplayed(text);
      return;
    }

    let timeoutId: number;
    const current = displayedRef.current;
    if (current === text) return;

    const stepCount = text.startsWith(current)
      ? text.length - current.length
      : current.length + text.length;
    const stepDelay = (TYPEWRITER_DURATION - TYPEWRITER_PAUSE)
      / Math.max(1, stepCount);
    const step = () => {
      const currentText = displayedRef.current;
      if (currentText === text) return;

      const typing = text.startsWith(currentText);
      const next = typing
        ? text.slice(0, currentText.length + 1)
        : currentText.slice(0, -1);
      displayedRef.current = next;
      setDisplayed(next);

      if (next !== text) {
        timeoutId = window.setTimeout(step, stepDelay);
      }
    };

    timeoutId = window.setTimeout(step, TYPEWRITER_PAUSE + stepDelay);
    return () => window.clearTimeout(timeoutId);
  }, [text]);

  return (
    <span className="app-typewriter" aria-label={text}>
      <span className="app-typewriter-reserve" aria-hidden="true">
        {renderTypedText(reserve, codeToken)}
      </span>
      <span className="app-typewriter-value" aria-hidden="true">
        {renderTypedText(displayed, codeToken)}
      </span>
    </span>
  );
}

function ErrorNotice({
  error,
  onDismiss,
  className = '',
}: {
  error: AppError;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div className={`app-error-notice ${className}`.trim()} role="alert">
      <div>
        <strong>{error.title}</strong>
        <p>{error.detail}</p>
      </div>
      <button type="button" aria-label="Dismiss error" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

function jsonErrorLocation(error: SyntaxError, content: string): string {
  const position = error.message.match(/position\s+(\d+)/i)?.[1];
  if (!position) return '';

  const offset = Number(position);
  const lines = content.slice(0, offset).split('\n');
  return ` near line ${lines.length}, column ${lines.at(-1)!.length + 1}`;
}

function formatBookmarkError(
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

function storageError(title: string): AppError {
  return {
    title,
    detail: 'Browser storage is full, blocked, or unavailable. Existing bookmarks were not changed.',
  };
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
  const [editorError, setEditorError] = useState<AppError | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [dropMode, setDropMode] = useState<DropMode>(null);
  const [urlDropSection, setUrlDropSection] = useState<string | null>(null);
  const [addedBookmark, setAddedBookmark] = useState<Bookmark | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropDepthRef = useRef(0);

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

  useEffect(() => {
    if (!addedBookmark) return;
    const timeoutId = window.setTimeout(() => setAddedBookmark(null), 6500);
    return () => window.clearTimeout(timeoutId);
  }, [addedBookmark]);

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
    setError(null);
    setAddedBookmark(null);
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookmarks));
      setBookmarks(nextBookmarks);
      setActiveBookmark(null);
      setKeyboardSelection(false);
      setError(null);
    } catch {
      setError(storageError('Couldn’t save section order'));
    }
  };

  const importFile = async (file: File) => {
    let content: string;
    try {
      content = await file.text();
    } catch {
      setError({
        title: 'Couldn’t read file',
        detail: 'Choose a readable JSON file and try again.',
      });
      return;
    }

    let nextBookmarks: Bookmark[];
    try {
      nextBookmarks = parseBookmarks(content);
    } catch (parseError) {
      setError(formatBookmarkError(parseError, content, 'Couldn’t import bookmarks'));
      return;
    }

    try {
      applyBookmarks(nextBookmarks);
    } catch {
      setError(storageError('Couldn’t import bookmarks'));
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await importFile(file);
    event.target.value = '';
  };

  const resetDropState = () => {
    dropDepthRef.current = 0;
    setDropMode(null);
    setUrlDropSection(null);
  };

  const handleDragEnter = (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    const mode = detectDropMode(event.dataTransfer, allowFiles);
    if (!mode) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    if (mode === 'url') setAddedBookmark(null);
    setDropMode(mode);
  };

  const handleDragOver = (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    if (!detectDropMode(event.dataTransfer, allowFiles)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!dropDepthRef.current) return;
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropMode(null);
  };

  const importDroppedFile = async (dataTransfer: DataTransfer) => {
    const files = [...dataTransfer.files];

    if (files.length !== 1) {
      setError({
        title: 'Couldn’t import bookmarks',
        detail: 'Drop one JSON file at a time.',
      });
      return;
    }

    const [file] = files;
    if (!file.name.toLocaleLowerCase().endsWith('.json')) {
      setError({
        title: 'Couldn’t import bookmarks',
        detail: 'Drop a file with a .json extension.',
      });
      return;
    }

    setError(null);
    await importFile(file);
  };

  const addDroppedUrl = (
    dataTransfer: DataTransfer,
    targetSection = 'Uncategorized',
  ) => {
    const url = readDroppedUrl(dataTransfer);
    if (!url) {
      setError({
        title: 'Couldn’t save URL',
        detail: 'Drop a valid http:// or https:// webpage link.',
      });
      return;
    }

    const duplicate = bookmarks.find(
      (bookmark) => normalizeUrl(bookmark.url) === url,
    );
    if (duplicate) {
      setError({
        title: 'URL already saved',
        detail: `“${duplicate.title}” already points to this address.`,
      });
      return;
    }

    const bookmark: Bookmark = {
      title: readDroppedTitle(dataTransfer, url),
      url,
      section: targetSection,
    };
    const nextBookmarks = [...bookmarks, bookmark];

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookmarks));
      setBookmarks(nextBookmarks);
      setSection(targetSection);
      setQuery('');
      setActiveBookmark(bookmark);
      setKeyboardSelection(false);
      setError(null);
      setAddedBookmark(bookmark);
    } catch {
      setError(storageError('Couldn’t save URL'));
    }
  };

  const handlePageDrop = async (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    const mode = detectDropMode(event.dataTransfer, allowFiles);
    event.preventDefault();
    resetDropState();

    if (mode === 'file') {
      await importDroppedFile(event.dataTransfer);
    } else if (mode === 'url') {
      addDroppedUrl(event.dataTransfer);
    }
  };

  const undoDroppedUrl = () => {
    if (!addedBookmark) return;
    const nextBookmarks = bookmarks.filter(
      (bookmark) => bookmark !== addedBookmark,
    );

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextBookmarks));
      setBookmarks(nextBookmarks);
      setSection('All');
      setActiveBookmark(null);
      setKeyboardSelection(false);
      setAddedBookmark(null);
      setError(null);
    } catch {
      setError(storageError('Couldn’t undo URL addition'));
    }
  };

  const chooseFile = () => {
    setError(null);
    resetDropState();
    fileRef.current?.click();
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
    setEditorError(null);
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
    let nextBookmarks: Bookmark[];
    try {
      nextBookmarks = parseBookmarks(editorContent);
    } catch (saveError) {
      setEditorError(
        formatBookmarkError(saveError, editorContent, 'Couldn’t save changes'),
      );
      return;
    }

    try {
      applyBookmarks(nextBookmarks);
      closeEditor();
      setEditorError(null);
    } catch {
      setEditorError(storageError('Couldn’t save changes'));
    }
  };

  if (!bookmarks.length) {
    const dropActive = dropMode !== null;
    const dropHeading = dropMode === 'url' ? URL_DROP_HEADING : DROP_HEADING;
    const dropCopy = dropMode === 'url' ? URL_DROP_COPY : DROP_COPY;

    return (
      <main
        className={`app-empty app-page${dropActive ? ' is-drop-active' : ''}`}
        onDragEnter={(event) => handleDragEnter(event, true)}
        onDragOver={(event) => handleDragOver(event, true)}
        onDragLeave={handleDragLeave}
        onDrop={(event) => { void handlePageDrop(event, true); }}
      >
        <section className="app-empty-panel">
          <div className="app-empty-brand">
            <img src={icon} alt="" className="app-empty-mark" />
          </div>
          <div aria-live="polite">
            <h1>
              <TypewriterText
                text={dropActive ? dropHeading : EMPTY_HEADING}
                reserve={EMPTY_HEADING}
              />
            </h1>
            <p className="app-empty-copy">
              <TypewriterText
                text={dropActive ? dropCopy : EMPTY_COPY}
                reserve={DROP_COPY}
                codeToken="bookmarks.json"
              />
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFile}
          />
          <div
            className={`app-empty-action${dropActive ? ' is-transparent' : ''}`}
            aria-hidden={dropActive}
            style={{ transitionDuration: `${TYPEWRITER_DURATION}ms` }}
          >
            <button
              type="button"
              className="app-load-button"
              tabIndex={dropActive ? -1 : undefined}
              onClick={chooseFile}
            >
              Choose JSON file
              <span className="app-load-arrow" aria-hidden="true">↗</span>
            </button>
          </div>
          {error && (
            <ErrorNotice
              error={error}
              onDismiss={() => setError(null)}
              className="app-file-error"
            />
          )}
        </section>
      </main>
    );
  }

  return (
    <div
      className="app-shell app-page"
      onDragEnter={(event) => handleDragEnter(event, false)}
      onDragOver={(event) => handleDragOver(event, false)}
      onDragLeave={handleDragLeave}
      onDrop={(event) => { void handlePageDrop(event, false); }}
    >
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
              }${
                urlDropSection === name ? ' is-url-drop-target' : ''
              }`}
              aria-pressed={section === name}
              title="Drag to reorder"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(SECTION_DRAG_TYPE, name);
                event.dataTransfer.setData('text/plain', name);
                setDraggedSection(name);
              }}
              onDragEnter={(event) => {
                if (detectDropMode(event.dataTransfer, false) === 'url') {
                  setUrlDropSection(name);
                }
              }}
              onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes(SECTION_DRAG_TYPE)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  const bounds = event.currentTarget.getBoundingClientRect();
                  setDragTarget({
                    name,
                    position: event.clientY < bounds.top + bounds.height / 2
                      ? 'before'
                      : 'after',
                  });
                  return;
                }

                if (detectDropMode(event.dataTransfer, false) === 'url') {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setUrlDropSection(name);
                }
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget as Node | null;
                if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                  setUrlDropSection((current) => current === name ? null : current);
                }
              }}
              onDrop={(event) => {
                const source = event.dataTransfer.getData(SECTION_DRAG_TYPE);
                if (source) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dragTarget) {
                    reorderSection(source, name, dragTarget.position);
                  }
                  setDraggedSection(null);
                  setDragTarget(null);
                  return;
                }

                if (detectDropMode(event.dataTransfer, false) === 'url') {
                  event.preventDefault();
                  event.stopPropagation();
                  resetDropState();
                  addDroppedUrl(event.dataTransfer, name);
                }
              }}
              onDragEnd={() => {
                setDraggedSection(null);
                setDragTarget(null);
                setUrlDropSection(null);
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

        {error && (
          <ErrorNotice
            error={error}
            onDismiss={() => setError(null)}
            className="app-sidebar-error"
          />
        )}

        <div className="app-data-actions">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleFile}
          />
          <button type="button" onClick={chooseFile}>
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
                  setActiveBookmark(null);
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
                aria-label="Search bookmarks"
              />
              <small>{matches.length}</small>
            </label>
          </div>
        </header>

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

      {dropMode === 'url' && (
        <div className="app-url-drop-hint" role="status">
          <span aria-hidden="true">＋</span>
          <div>
            <strong>Drop URL to save</strong>
            <small>
              It will land in {urlDropSection ?? 'Uncategorized'}
            </small>
          </div>
        </div>
      )}

      {addedBookmark && (
        <div className="app-undo-toast" role="status">
          <div>
            <strong>Saved to {addedBookmark.section}</strong>
            <small>{addedBookmark.title}</small>
          </div>
          <button type="button" onClick={undoDroppedUrl}>Undo</button>
        </div>
      )}

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
            {editorError && (
              <ErrorNotice
                error={editorError}
                onDismiss={() => setEditorError(null)}
                className="app-editor-error"
              />
            )}
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
                  setEditorError(null);
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
