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
import BookmarkDialog from './BookmarkDialog';
import SectionDialog from './SectionDialog';
import { getFaviconUrl, normalizeUrl } from './lib';
import TypewriterText, { TYPEWRITER_DURATION } from './TypewriterText';
import { useBookmarks, storageError, type AppError } from './useBookmarks';
import { ErrorNotice, MetaList, UndoNotice } from './notices';
import { formatBookmarkError } from './formatBookmarkError';
import { tierRank } from './tierRank';
import {
  SECTION_DRAG_TYPE,
  detectDropMode,
  readDroppedTitle,
  readDroppedUrl,
  type DropMode,
} from './dropHandlers';
import {
  parseBookmarks,
  reorderBookmarkSections,
  searchBookmarks,
  type Bookmark,
} from './bookmarks';
import './App.css';

const EMPTY_HEADING = 'Bring your index.';
const DROP_HEADING = 'Drop your file.';
const URL_DROP_HEADING = 'Drop your URL.';
const EMPTY_COPY = 'Choose your bookmarks.json. It stays in this browser and is never uploaded.';
const DROP_COPY = 'Drop your bookmarks.json anywhere. It stays in this browser and is never uploaded.';
const URL_DROP_COPY = 'Drop your URL anywhere. It will be saved locally in the Uncategorized section.';

type BookmarkDialogState =
  | { mode: 'add'; initialSection: string }
  | { mode: 'edit'; bookmark: Bookmark };

interface SectionDialogState {
  mode: 'rename' | 'delete';
  section: string;
}

function App() {
  const {
    bookmarks,
    initialError,
    undoState,
    persist,
    restoreUndo,
    clearUndo,
  } = useBookmarks();
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
  const [error, setError] = useState<AppError | null>(() => initialError);
  const [dropMode, setDropMode] = useState<DropMode>(null);
  const [urlDropSection, setUrlDropSection] = useState<string | null>(null);
  const [bookmarkDialog, setBookmarkDialog] = useState<BookmarkDialogState | null>(null);
  const [sectionDialog, setSectionDialog] = useState<SectionDialogState | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropDepthRef = useRef(0);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      if (isTyping || editorOpen || bookmarkDialog || sectionDialog) return;

      if (
        event.key === '/'
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
      ) {
        event.preventDefault();
        setSearchOpen(true);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      } else if (
        event.key === '+'
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
      ) {
        event.preventDefault();
        setBookmarkDialog({
          mode: 'add',
          initialSection: section === 'All' ? 'Uncategorized' : section,
        });
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [bookmarkDialog, editorOpen, section, sectionDialog]);

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
    if (!persist(nextBookmarks, null)) {
      setError(storageError('Couldn’t import bookmarks'));
      return;
    }
    setSection('All');
    setQuery('');
    setActiveBookmark(nextBookmarks[0] ?? null);
    setKeyboardSelection(false);
    setError(null);
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
    if (persist(nextBookmarks, null)) {
      setActiveBookmark(null);
      setKeyboardSelection(false);
      setError(null);
    } else {
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

    applyBookmarks(nextBookmarks);
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
    if (bookmarkDialog || sectionDialog || editorOpen) return;
    const mode = detectDropMode(event.dataTransfer, allowFiles);
    if (!mode) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    if (mode === 'url') clearUndo();
    setDropMode(mode);
  };

  const handleDragOver = (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    if (bookmarkDialog || sectionDialog || editorOpen) return;
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

    if (persist(nextBookmarks, {
      title: `Saved to ${targetSection}`,
      detail: bookmark.title,
      section,
      query,
      activeBookmark,
    })) {
      setSection(targetSection);
      setQuery('');
      setActiveBookmark(bookmark);
      setKeyboardSelection(false);
      setError(null);
    } else {
      setError(storageError('Couldn’t save URL'));
    }
  };

  const handlePageDrop = async (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    if (bookmarkDialog || sectionDialog || editorOpen) return;
    const mode = detectDropMode(event.dataTransfer, allowFiles);
    event.preventDefault();
    resetDropState();

    if (mode === 'file') {
      await importDroppedFile(event.dataTransfer);
    } else if (mode === 'url') {
      addDroppedUrl(event.dataTransfer);
    }
  };

  const undoLastChange = () => {
    const restored = restoreUndo();
    if (!restored || 'error' in restored) {
      if (restored && 'error' in restored) setError(restored.error);
      return;
    }
    setSection(restored.section);
    setQuery(restored.query);
    setActiveBookmark(restored.activeBookmark);
    setKeyboardSelection(false);
    setError(null);
  };

  const saveBookmark = (nextBookmark: Bookmark): string | null => {
    const editingBookmark = bookmarkDialog?.mode === 'edit'
      ? bookmarkDialog.bookmark
      : null;
    const normalizedUrl = normalizeUrl(nextBookmark.url);
    const duplicate = bookmarks.find(
      (bookmark) => bookmark !== editingBookmark
        && normalizeUrl(bookmark.url) === normalizedUrl,
    );
    if (duplicate) return `“${duplicate.title}” already uses this URL.`;

    const nextBookmarks = editingBookmark
      ? bookmarks.map((bookmark) =>
        bookmark === editingBookmark ? nextBookmark : bookmark)
      : [...bookmarks, nextBookmark];

    if (persist(nextBookmarks, null)) {
      setSection(nextBookmark.section);
      setQuery('');
      setActiveBookmark(nextBookmark);
      setKeyboardSelection(false);
      setError(null);
      setBookmarkDialog(null);
      return null;
    }
    return 'Browser storage is full, blocked, or unavailable.';
  };

  const deleteBookmark = (bookmarkToDelete: Bookmark) => {
    const nextBookmarks = bookmarks.filter(
      (bookmark) => bookmark !== bookmarkToDelete,
    );
    const nextSection = section !== 'All'
      && !nextBookmarks.some((bookmark) => bookmark.section === section)
      ? 'All'
      : section;

    if (persist(nextBookmarks, {
      title: 'Bookmark removed',
      detail: bookmarkToDelete.title,
      section,
      query,
      activeBookmark,
    })) {
      setSection(nextSection);
      setActiveBookmark(null);
      setKeyboardSelection(false);
      setError(null);
      setBookmarkDialog(null);
    } else {
      setError(storageError('Couldn’t remove bookmark'));
    }
  };

  const renameSection = (nextName: string): string | null => {
    if (!sectionDialog) return 'Section is no longer available.';
    const previousName = sectionDialog.section;
    if (!nextName) return 'Enter a section name.';
    if (nextName.toLocaleLowerCase() === 'all') {
      return '“All” is reserved for the complete directory.';
    }
    const conflictingSection = [...sectionCounts.keys()].find(
      (name) => name !== previousName
        && name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
    );
    if (conflictingSection) {
      return `“${conflictingSection}” already exists.`;
    }

    let nextActiveBookmark = activeBookmark;
    const nextBookmarks = bookmarks.map((bookmark) => {
      if (bookmark.section !== previousName) return bookmark;
      const renamed = { ...bookmark, section: nextName };
      if (bookmark === activeBookmark) nextActiveBookmark = renamed;
      return renamed;
    });

    if (persist(nextBookmarks, null)) {
      setSection(nextName);
      setActiveBookmark(nextActiveBookmark);
      setKeyboardSelection(false);
      setError(null);
      setSectionDialog(null);
      return null;
    }
    return 'Browser storage is full, blocked, or unavailable.';
  };

  const deleteSection = (
    strategy: 'move' | 'delete',
    destination?: string,
  ): string | null => {
    if (!sectionDialog) return 'Section is no longer available.';
    const sectionToDelete = sectionDialog.section;
    if (strategy === 'move' && !destination) {
      return 'Choose a destination section.';
    }

    const affectedCount = sectionCounts.get(sectionToDelete) ?? 0;
    const nextBookmarks = strategy === 'move'
      ? bookmarks.map((bookmark) =>
        bookmark.section === sectionToDelete
          ? { ...bookmark, section: destination! }
          : bookmark)
      : bookmarks.filter((bookmark) => bookmark.section !== sectionToDelete);

    if (persist(nextBookmarks, {
      title: strategy === 'move' ? 'Section removed' : 'Section and bookmarks removed',
      detail: strategy === 'move'
        ? `${affectedCount} bookmark${affectedCount === 1 ? '' : 's'} moved to ${destination}.`
        : `${affectedCount} bookmark${affectedCount === 1 ? '' : 's'} removed from ${sectionToDelete}.`,
      section,
      query,
      activeBookmark,
    })) {
      setSection(strategy === 'move' ? destination! : 'All');
      setActiveBookmark(null);
      setKeyboardSelection(false);
      setError(null);
      setSectionDialog(null);
      return null;
    }
    return 'Browser storage is full, blocked, or unavailable.';
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
            <button
              type="button"
              className="app-load-button"
              tabIndex={dropActive ? -1 : undefined}
              onClick={() => setBookmarkDialog({
                mode: 'add',
                initialSection: 'Uncategorized',
              })}
            >
              Add manually
              <span className="app-load-arrow" aria-hidden="true">＋</span>
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
        {bookmarkDialog?.mode === 'add' && (
          <BookmarkDialog
            initialSection={bookmarkDialog.initialSection}
            sections={[]}
            onCancel={() => setBookmarkDialog(null)}
            onSave={saveBookmark}
          />
        )}
        {undoState && <UndoNotice undo={undoState} onUndo={undoLastChange} />}
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

        {section !== 'All' && sectionCounts.has(section) && (
          <div className="app-section-actions">
            <span>{section}</span>
            <button
              type="button"
              onClick={() => setSectionDialog({ mode: 'rename', section })}
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setSectionDialog({ mode: 'delete', section })}
            >
              Remove
            </button>
          </div>
        )}

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
          <div className="app-header-tools">
            {inspected && (
              <div className="app-compact-bookmark-actions">
                <button
                  type="button"
                  onClick={() => setBookmarkDialog({
                    mode: 'edit',
                    bookmark: inspected,
                  })}
                >
                  Edit
                </button>
                <button type="button" onClick={() => deleteBookmark(inspected)}>
                  Delete
                </button>
              </div>
            )}
            <button
              type="button"
              className="app-add-bookmark"
              aria-label="Add bookmark"
              title="Add bookmark (+)"
              onClick={() => setBookmarkDialog({
                mode: 'add',
                initialSection: section === 'All' ? 'Uncategorized' : section,
              })}
            >
              <span className="app-add-label" aria-hidden="true">Add</span>
              <span className="app-add-symbol" aria-hidden="true">+</span>
            </button>
            <div className={`app-search-wrap${searchOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="app-search-trigger"
                aria-label={searchOpen ? 'Focus search' : 'Open search'}
                title="Search (/)"
                onClick={() => {
                  setSearchOpen(true);
                  window.requestAnimationFrame(() => searchRef.current?.focus());
                }}
              >
                <span className="app-search-hover-label" aria-hidden="true">
                  Search
                </span>
                <span className="app-search-symbol" aria-hidden="true">/</span>
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
            <div className="app-inspector-actions">
              <button
                type="button"
                onClick={() => setBookmarkDialog({
                  mode: 'edit',
                  bookmark: inspected,
                })}
              >
                Edit
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => deleteBookmark(inspected)}
              >
                Delete
              </button>
            </div>
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

      {undoState && (
        <UndoNotice undo={undoState} onUndo={undoLastChange} />
      )}

      {bookmarkDialog && (
        <BookmarkDialog
          bookmark={bookmarkDialog.mode === 'edit' ? bookmarkDialog.bookmark : undefined}
          initialSection={bookmarkDialog.mode === 'add'
            ? bookmarkDialog.initialSection
            : bookmarkDialog.bookmark.section}
          sections={[...sectionCounts.keys()]}
          onCancel={() => setBookmarkDialog(null)}
          onSave={saveBookmark}
        />
      )}

      {sectionDialog && (
        <SectionDialog
          mode={sectionDialog.mode}
          section={sectionDialog.section}
          count={sectionCounts.get(sectionDialog.section) ?? 0}
          otherSections={[...sectionCounts.keys()].filter(
            (name) => name !== sectionDialog.section,
          )}
          onCancel={() => setSectionDialog(null)}
          onRename={renameSection}
          onDelete={deleteSection}
        />
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
