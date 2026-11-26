import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import Editor from '@monaco-editor/react';
import icon from './assets/icon.png';
import BookmarkDialog from './BookmarkDialog.tsx';
import ContextMenu, { type ContextMenuTarget } from './ContextMenu.tsx';
import ImportMergeDialog from './ImportMergeDialog.tsx';
import SectionDialog from './SectionDialog.tsx';
import SnapshotDialog from './SnapshotDialog.tsx';
import { getFaviconUrl, normalizeUrl, urlIdentity } from './lib.ts';
import TypewriterText, { TYPEWRITER_DURATION } from './TypewriterText.tsx';
import { useBookmarks, storageError, type AppError } from './useBookmarks.ts';
import {
  ErrorNotice,
  ExternalConflictBanner,
  MetaList,
  UndoNotice,
} from './notices.tsx';
import { formatBookmarkError } from './formatBookmarkError.ts';
import { tierRank } from './tierRank.ts';
import {
  BOOKMARK_DRAG_TYPE,
  SECTION_DRAG_TYPE,
  detectDropMode,
  isBookmarkFileMime,
  isBookmarkFileName,
  readDroppedTitle,
  readDroppedUrl,
  resolveDropSection,
  type DropMode,
} from './dropHandlers.ts';
import {
  BACKUP_KEY,
  STORAGE_KEY,
  groupBookmarksBySection,
  insertBookmarkInSection,
  moveBookmarkToSection,
  parseBookmarks,
  reorderBookmark,
  reorderBookmarkSections,
  searchBookmarks,
  type Bookmark,
} from './bookmarks.ts';
import {
  parseEditorBookmarks,
  parseImportedBookmarkFile,
  serializeBookmarksHtml,
  type BookmarkFileFormat,
} from './bookmarkHtml.ts';
import { applyBookmarkMerge, type MergeStrategy } from './bookmarkMerge.ts';
import {
  SNAPSHOTS_KEY,
  cloneBookmark,
  computeBookmarksHash,
  formatPreRestoreLabel,
  safeGetItem,
  shortBookmarksHash,
  type BookmarkSnapshot,
  type SnapshotRequest,
} from './snapshotVault.ts';
import {
  detectDiskConflict,
  evaluateExternalBookmarkChange,
  normalizeExternalBookmarks,
  reconcileViewAfterSync,
  type ExternalSyncConflict,
} from './storageSync.ts';
import {
  downloadTextFile,
  focusConflictBanner,
  restoreFocusSafely,
} from './dialogFocus.ts';
import './App.css';

const EMPTY_HEADING = 'Bring your index.';
const DROP_HEADING = 'Drop your file.';
const URL_DROP_HEADING = 'Drop your URL.';
const EMPTY_COPY = 'Choose bookmarks.json or browser bookmarks.html. Everything stays in this browser.';
const DROP_COPY = 'Drop bookmarks.json or bookmarks.html anywhere. Everything stays in this browser.';
const URL_DROP_COPY = 'Drop your URL anywhere. It will be saved locally in the Uncategorized section.';

type BookmarkDialogState =
  | { mode: 'add'; initialSection: string; revision: number }
  | { mode: 'edit'; bookmark: Bookmark; revision: number };

interface SectionDialogState {
  mode: 'rename' | 'delete';
  section: string;
}

interface ImportMergeDialogState {
  fileName: string;
  format: BookmarkFileFormat;
  bookmarks: Bookmark[];
  skippedNonHttpCount: number;
  intraFileDuplicateCount: number;
}

interface ContextMenuState {
  id: number;
  anchor: { x: number; y: number };
  openedBy: 'pointer' | 'keyboard';
  target: ContextMenuTarget;
}

interface StatusToast {
  title: string;
  detail?: string;
}

function getHoveredDropSection(target: EventTarget | null): string | null {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  return element?.closest<HTMLElement>('[data-drop-section]')?.dataset.dropSection ?? null;
}

function getBookmarkDropPosition(
  event: DragEvent<HTMLElement>,
  element: HTMLElement,
): 'before' | 'after' {
  const bounds = element.getBoundingClientRect();
  const listEl = element.parentElement;
  const isGrid = listEl ? getComputedStyle(listEl).display === 'grid' : false;
  if (isGrid) {
    return event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
  }
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

function getLocalStorageSafely(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function App() {
  const {
    bookmarks,
    initialError,
    undoState,
    snapshots,
    corruptBackup,
    persist,
    persistWithMeta,
    restoreUndo,
    clearUndo,
    createCheckpoint,
    deleteSnapshot,
    dismissCorruptBackup,
    refreshVaultFromStorage,
    applyExternalBookmarksState,
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
  const [draggedBookmark, setDraggedBookmark] = useState<Bookmark | null>(null);
  const [bookmarkDropTarget, setBookmarkDropTarget] = useState<{
    bookmark: Bookmark;
    position: 'before' | 'after';
  } | null>(null);
  const [bookmarkDropSection, setBookmarkDropSection] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorClosing, setEditorClosing] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [editorError, setEditorError] = useState<AppError | null>(null);
  const [editorRepairMode, setEditorRepairMode] = useState(false);
  const [error, setError] = useState<AppError | null>(() => initialError);
  const [dropMode, setDropMode] = useState<DropMode>(null);
  const [urlDropSection, setUrlDropSection] = useState<string | null>(null);
  const [bookmarkDialog, setBookmarkDialog] = useState<BookmarkDialogState | null>(null);
  const [sectionDialog, setSectionDialog] = useState<SectionDialogState | null>(null);
  const [importMergeDialog, setImportMergeDialog] = useState<ImportMergeDialogState | null>(null);
  const [snapshotDialog, setSnapshotDialog] = useState(false);
  const [externalConflict, setExternalConflict] = useState<ExternalSyncConflict | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportMenuPos, setExportMenuPos] = useState<{ left: number; top: number }>({
    left: 16,
    top: 16,
  });
  const [statusToast, setStatusToast] = useState<StatusToast | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropDepthRef = useRef(0);
  const draggedBookmarkRef = useRef<Bookmark | null>(null);
  const bookmarkDropTargetRef = useRef<{
    bookmark: Bookmark;
    position: 'before' | 'after';
  } | null>(null);
  const bookmarkDropSectionRef = useRef<string | null>(null);
  const pendingScrollBookmarkRef = useRef<Bookmark | null>(null);
  const contextMenuTriggerRef = useRef<HTMLElement | null>(null);
  const contextMenuIdRef = useRef(0);
  const modalTriggerRef = useRef<HTMLElement | null>(null);
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const editorDialogRef = useRef<HTMLElement>(null);
  const closeEditorRef = useRef<(shouldConverge?: boolean) => void>(() => {});
  const editorCloseTimerRef = useRef<number | null>(null);
  const modalBaseHashRef = useRef<string | null>(null);
  const modalBaseBookmarksRef = useRef<Bookmark[] | null>(null);

  const isEditModalOpen = (editorOpen && !editorClosing)
    || bookmarkDialog !== null
    || sectionDialog !== null
    || importMergeDialog !== null;
  const isAnyModalVisible = editorOpen
    || bookmarkDialog !== null
    || sectionDialog !== null
    || importMergeDialog !== null
    || snapshotDialog;

  const syncStateRef = useRef({
    bookmarks,
    section,
    activeBookmark,
    isEditModalOpen,
  });
  syncStateRef.current = {
    bookmarks,
    section,
    activeBookmark,
    isEditModalOpen,
  };

  useEffect(() => {
    if (!isEditModalOpen) {
      modalBaseHashRef.current = null;
      modalBaseBookmarksRef.current = null;
    }
  }, [isEditModalOpen]);

  useEffect(() => {
    if (bookmarks.length === 0) {
      setExportMenuOpen(false);
      setContextMenu(null);
    }
  }, [bookmarks.length]);

  useEffect(() => {
    if (!editorOpen || editorClosing) return;
    const frameId = window.requestAnimationFrame(() => {
      const dialogEl = editorDialogRef.current;
      if (!dialogEl) return;
      const active = document.activeElement;
      if (!active || !dialogEl.contains(active)) {
        dialogEl.focus({ preventScroll: true });
      }
    });
    const handleEditorEscape = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeEditorRef.current(true);
      }
    };
    document.addEventListener('keydown', handleEditorEscape);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener('keydown', handleEditorEscape);
    };
  }, [editorOpen, editorClosing]);

  useEffect(() => {
    return () => {
      if (editorCloseTimerRef.current !== null) {
        window.clearTimeout(editorCloseTimerRef.current);
      }
    };
  }, []);

  const captureModalOpenContext = useCallback((trigger?: HTMLElement | null) => {
    if (trigger !== undefined) {
      modalTriggerRef.current = trigger;
      return;
    }
    const active = document.activeElement;
    modalTriggerRef.current = active instanceof HTMLElement ? active : null;
  }, []);

  const captureEditBaseline = useCallback((baseBookmarks: Bookmark[]) => {
    modalBaseHashRef.current = computeBookmarksHash(baseBookmarks);
    modalBaseBookmarksRef.current = baseBookmarks;
    setExternalConflict(null);
  }, []);

  const convergeFromDiskIfNeeded = useCallback(() => {
    if (!externalConflict) return;
    setExternalConflict(null);
    const storage = getLocalStorageSafely();
    if (!storage) return;
    const raw = safeGetItem(storage, STORAGE_KEY);
    let diskBookmarks: Bookmark[];
    if (raw === null || !raw.trim()) {
      diskBookmarks = [];
    } else {
      try {
        diskBookmarks = normalizeExternalBookmarks(parseBookmarks(raw));
      } catch {
        return;
      }
    }
    applyExternalBookmarksState(diskBookmarks);
    const reconciled = reconcileViewAfterSync(diskBookmarks, section, activeBookmark);
    setSection(reconciled.section);
    setActiveBookmark(reconciled.activeBookmark);
    setKeyboardSelection(false);
  }, [activeBookmark, applyExternalBookmarksState, externalConflict, section]);

  // Single cross-tab localStorage sync listener
  useEffect(() => {
    const handleStorageEvent = (event: StorageEvent) => {
      const storage = getLocalStorageSafely();
      if (event.storageArea && storage && event.storageArea !== storage) return;

      if (
        event.key === SNAPSHOTS_KEY
        || event.key === BACKUP_KEY
        || event.key === null
      ) {
        refreshVaultFromStorage();
      }

      if (event.key !== STORAGE_KEY && event.key !== null) return;

      const snapshot = syncStateRef.current;
      const transition = evaluateExternalBookmarkChange({
        rawNewValue: event.newValue,
        currentBookmarks: snapshot.bookmarks,
        currentSection: snapshot.section,
        currentActiveBookmark: snapshot.activeBookmark,
        isEditModalOpen: snapshot.isEditModalOpen,
        modalBaseHash: modalBaseHashRef.current,
        modalBaseBookmarks: modalBaseBookmarksRef.current,
      });

      if (transition.kind === 'invalid-external') {
        refreshVaultFromStorage();
        setError({
          title: 'External bookmark update invalid',
          detail: 'Another tab wrote invalid bookmark data. Your open tab kept its valid copy.',
        });
        return;
      }

      if (transition.kind === 'noop') return;

      if (transition.kind === 'background-sync') {
        clearUndo();
        setExportMenuOpen(false);
        setContextMenu(null);
        applyExternalBookmarksState(transition.bookmarks);
        setSection(transition.section);
        setActiveBookmark(transition.activeBookmark);
        setKeyboardSelection(false);
        return;
      }

      if (transition.kind === 'modal-reverted') {
        clearUndo();
        setExternalConflict(null);
        return;
      }

      if (transition.kind === 'modal-conflict') {
        clearUndo();
        setExternalConflict(transition.conflict);
      }
    };

    window.addEventListener('storage', handleStorageEvent);
    return () => window.removeEventListener('storage', handleStorageEvent);
  }, [applyExternalBookmarksState, clearUndo, refreshVaultFromStorage]);

  const openBookmarkDialog = useCallback(
    (
      next: { mode: 'add'; initialSection: string } | { mode: 'edit'; bookmark: Bookmark },
      trigger?: HTMLElement | null,
    ) => {
      captureModalOpenContext(trigger);
      captureEditBaseline(bookmarks);
      setBookmarkDialog(
        next.mode === 'add'
          ? { mode: 'add', initialSection: next.initialSection, revision: 0 }
          : { mode: 'edit', bookmark: next.bookmark, revision: 0 },
      );
    },
    [bookmarks, captureEditBaseline, captureModalOpenContext],
  );

  const openSectionDialog = useCallback(
    (next: SectionDialogState, trigger?: HTMLElement | null) => {
      captureModalOpenContext(trigger);
      captureEditBaseline(bookmarks);
      setSectionDialog(next);
    },
    [bookmarks, captureEditBaseline, captureModalOpenContext],
  );

  const openSnapshotDialog = useCallback(() => {
    captureModalOpenContext();
    setExportMenuOpen(false);
    setContextMenu(null);
    setSnapshotDialog(true);
  }, [captureModalOpenContext]);

  const closeSnapshotDialog = useCallback(() => {
    setSnapshotDialog(false);
    restoreFocusSafely(modalTriggerRef.current);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.isContentEditable
        || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '');
      if (
        isTyping
        || event.isComposing
        || isAnyModalVisible
        || contextMenu
        || exportMenuOpen
      ) {
        return;
      }

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
        openBookmarkDialog({
          mode: 'add',
          initialSection: section === 'All' ? 'Uncategorized' : section,
        });
      } else if (
        event.key === 'h'
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && !event.shiftKey
      ) {
        event.preventDefault();
        openSnapshotDialog();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, [
    contextMenu,
    exportMenuOpen,
    isAnyModalVisible,
    openBookmarkDialog,
    openSnapshotDialog,
    section,
  ]);

  useEffect(() => {
    if (!statusToast) return;
    const timeoutId = window.setTimeout(() => setStatusToast(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [statusToast]);

  // Export popover positioning & dismiss listeners
  useLayoutEffect(() => {
    if (!exportMenuOpen) return;
    const trigger = exportButtonRef.current;
    const menu = exportMenuRef.current;
    if (!trigger || !menu) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = menuRect.width || 192;
    const menuHeight = menuRect.height || 88;

    const preferredTop = triggerRect.top >= menuHeight + 12
      ? triggerRect.top - menuHeight - 6
      : triggerRect.bottom + 6;
    const top = Math.round(
      Math.max(margin, Math.min(preferredTop, viewportHeight - menuHeight - margin)),
    );
    const left = Math.round(
      Math.max(margin, Math.min(triggerRect.left, viewportWidth - menuWidth - margin)),
    );

    setExportMenuPos((current) => (
      current.left === left && current.top === top
        ? current
        : { left, top }
    ));
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const firstItem = exportMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus({ preventScroll: true });

    const handleDismiss = () => setExportMenuOpen(false);
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && exportMenuRef.current?.contains(event.target)) {
        return;
      }
      setExportMenuOpen(false);
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('blur', handleDismiss);
    window.addEventListener('dragstart', handleDismiss, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('blur', handleDismiss);
      window.removeEventListener('dragstart', handleDismiss, true);
    };
  }, [exportMenuOpen]);

  const closeExportMenu = (restoreFocus: boolean) => {
    setExportMenuOpen(false);
    if (restoreFocus) {
      restoreFocusSafely(exportButtonRef.current);
    }
  };

  const handleExportMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = exportMenuRef.current;
    if (!menu) return;

    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      closeExportMenu(true);
      return;
    }

    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    const active = document.activeElement as HTMLElement | null;
    const activeIndex = active ? items.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
      items[next].focus({ preventScroll: true });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      items[prev].focus({ preventScroll: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus({ preventScroll: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus({ preventScroll: true });
    }
  };

  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    bookmarks.forEach((bookmark) => {
      counts.set(bookmark.section, (counts.get(bookmark.section) ?? 0) + 1);
    });
    return counts;
  }, [bookmarks]);

  const matches = useMemo(() => {
    const searched = searchBookmarks(bookmarks, query);
    const filtered = section === 'All'
      ? searched
      : searched.filter((bookmark) => bookmark.section === section);
    return groupBookmarksBySection(filtered);
  }, [bookmarks, query, section]);

  const matchIndices = useMemo(() => {
    const indices = new Map<Bookmark, number>();
    matches.forEach((bookmark, index) => {
      indices.set(bookmark, index);
    });
    return indices;
  }, [matches]);

  useEffect(() => {
    const target = pendingScrollBookmarkRef.current;
    if (!target) return;
    pendingScrollBookmarkRef.current = null;
    const index = matchIndices.get(target);
    if (index === undefined) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-app-bookmark-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, [matches, matchIndices]);

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

  const checkPreWriteConflict = (
    overwriteExternalConflict?: boolean,
  ): { blocked: boolean; conflictForBackup: ExternalSyncConflict | null } => {
    if (overwriteExternalConflict) {
      if (externalConflict) {
        return { blocked: false, conflictForBackup: externalConflict };
      }
      const storage = getLocalStorageSafely();
      const diskConflict = storage
        ? detectDiskConflict(storage, modalBaseHashRef.current, modalBaseBookmarksRef.current)
        : null;
      return { blocked: false, conflictForBackup: diskConflict };
    }

    if (externalConflict) {
      return { blocked: true, conflictForBackup: externalConflict };
    }

    const storage = getLocalStorageSafely();
    if (storage) {
      const diskConflict = detectDiskConflict(
        storage,
        modalBaseHashRef.current,
        modalBaseBookmarksRef.current,
      );
      if (diskConflict) {
        setExternalConflict(diskConflict);
        return { blocked: true, conflictForBackup: diskConflict };
      }
    }

    return { blocked: false, conflictForBackup: null };
  };

  const handleLoadExternalChanges = () => {
    if (!externalConflict) return;
    const ext = externalConflict.externalBookmarks;
    applyExternalBookmarksState(ext);
    const reconciled = reconcileViewAfterSync(ext, section, activeBookmark);
    setSection(reconciled.section);
    setActiveBookmark(reconciled.activeBookmark);
    setKeyboardSelection(false);
    modalBaseHashRef.current = externalConflict.externalHash;
    modalBaseBookmarksRef.current = ext;
    setExternalConflict(null);

    if (editorOpen && !editorClosing) {
      setEditorContent(JSON.stringify(ext, null, 2));
      setEditorError(null);
      setEditorRepairMode(false);
      return;
    }

    if (bookmarkDialog?.mode === 'edit') {
      const targetId = urlIdentity(bookmarkDialog.bookmark.url);
      const matched = ext.find((item) => urlIdentity(item.url) === targetId);
      if (matched) {
        setBookmarkDialog({
          mode: 'edit',
          bookmark: matched,
          revision: bookmarkDialog.revision + 1,
        });
      } else {
        setBookmarkDialog(null);
        restoreFocusSafely(modalTriggerRef.current);
        setStatusToast({ title: 'Bookmark removed in another tab' });
      }
      return;
    }

    if (sectionDialog) {
      if (!ext.some((item) => item.section === sectionDialog.section)) {
        setSectionDialog(null);
        restoreFocusSafely(modalTriggerRef.current);
        setStatusToast({ title: 'Section changed in another tab' });
      }
    }
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
      if (!corruptBackup) setError(null);
    } else {
      setError(storageError('Couldn’t save section order'));
    }
  };

  const commitBookmarkMove = (
    nextBookmarks: Bookmark[],
    source: Bookmark,
    targetSection: string,
    crossSection: boolean,
  ) => {
    const undo = crossSection
      ? {
          title: `Moved to ${targetSection}`,
          detail: source.title,
          section,
          query,
          activeBookmark,
        }
      : null;

    if (!persist(nextBookmarks, undo)) {
      setError(
        storageError(
          crossSection ? 'Couldn’t move bookmark' : 'Couldn’t save bookmark order',
        ),
      );
      return;
    }

    if (activeBookmark === source) {
      if (crossSection) {
        const prevSet = new Set(bookmarks);
        const moved = nextBookmarks.find((entry) => !prevSet.has(entry)) ?? null;
        setActiveBookmark(moved);
      } else {
        setActiveBookmark(source);
      }
    }
    if (
      crossSection
      && section !== 'All'
      && !nextBookmarks.some((entry) => entry.section === section)
    ) {
      setSection('All');
    }
    setKeyboardSelection(false);
    if (!corruptBackup) setError(null);
  };

  const moveBookmarkAt = (
    source: Bookmark,
    target: Bookmark,
    position: 'before' | 'after',
  ) => {
    const nextBookmarks = reorderBookmark(bookmarks, source, target, position);
    if (nextBookmarks === bookmarks) return;
    commitBookmarkMove(
      nextBookmarks,
      source,
      target.section,
      source.section !== target.section,
    );
  };

  const moveBookmarkSection = (source: Bookmark, targetSection: string) => {
    const nextBookmarks = moveBookmarkToSection(bookmarks, source, targetSection);
    if (nextBookmarks === bookmarks) return;
    commitBookmarkMove(nextBookmarks, source, targetSection, true);
  };

  const importFile = async (file: File) => {
    let content: string;
    try {
      content = await file.text();
    } catch {
      setError({
        title: 'Couldn’t read file',
        detail: 'Choose a readable JSON or HTML bookmark file and try again.',
      });
      return;
    }

    let parsed;
    try {
      parsed = parseImportedBookmarkFile(content, file.name);
    } catch (parseError) {
      setError(formatBookmarkError(parseError, content, 'Couldn’t import bookmarks'));
      return;
    }

    if (bookmarks.length === 0) {
      const importedBookmarks = applyBookmarkMerge([], parsed.bookmarks, 'replace');
      const result = persistWithMeta(importedBookmarks, null);
      if (!result.ok) {
        setError(storageError('Couldn’t import bookmarks'));
        return;
      }
      setSection('All');
      setQuery('');
      setActiveBookmark(importedBookmarks[0] ?? null);
      setKeyboardSelection(false);
      if (!corruptBackup) setError(null);
      setStatusToast({
        title: `Imported ${importedBookmarks.length} bookmark${importedBookmarks.length === 1 ? '' : 's'}`,
        detail: parsed.skippedNonHttpCount > 0
          ? `${parsed.skippedNonHttpCount} non-web link${parsed.skippedNonHttpCount === 1 ? '' : 's'} skipped`
          : undefined,
      });
      return;
    }

    captureModalOpenContext();
    captureEditBaseline(bookmarks);
    if (!corruptBackup) setError(null);
    setImportMergeDialog({
      fileName: file.name,
      format: parsed.format,
      bookmarks: parsed.bookmarks,
      skippedNonHttpCount: parsed.skippedNonHttpCount,
      intraFileDuplicateCount: parsed.intraFileDuplicateCount,
    });
  };

  const commitImportMerge = (
    strategy: MergeStrategy,
    options?: { overwriteExternalConflict?: boolean },
  ): string | null => {
    if (!importMergeDialog) return null;

    const { blocked, conflictForBackup } = checkPreWriteConflict(
      options?.overwriteExternalConflict,
    );
    if (blocked) return null;

    const nextBookmarks = applyBookmarkMerge(
      bookmarks,
      importMergeDialog.bookmarks,
      strategy,
    );

    const snapshotRequests: SnapshotRequest[] = [];
    if (options?.overwriteExternalConflict && conflictForBackup) {
      snapshotRequests.push({
        trigger: 'external-conflict',
        label: 'External tab changes before overwrite',
        bookmarks: conflictForBackup.externalBookmarks,
      });
    }
    snapshotRequests.push({
      trigger: strategy === 'replace' ? 'pre-replace' : 'pre-import',
      label: strategy === 'replace'
        ? `Before replacing with ${importMergeDialog.fileName}`
        : `Before importing ${importMergeDialog.fileName}`,
    });

    const result = persistWithMeta(nextBookmarks, null, {
      snapshots: snapshotRequests,
    });
    if (!result.ok) {
      return 'Browser storage is full, blocked, or unavailable. Existing bookmarks were not changed.';
    }

    const nextSection = strategy === 'replace'
      ? 'All'
      : section === 'All' || nextBookmarks.some((item) => item.section === section)
        ? section
        : 'All';
    setSection(nextSection);
    setQuery('');
    setActiveBookmark(nextBookmarks[0] ?? null);
    setKeyboardSelection(false);
    if (!corruptBackup) setError(null);
    setExternalConflict(null);
    setImportMergeDialog(null);
    restoreFocusSafely(modalTriggerRef.current);

    if (options?.overwriteExternalConflict && conflictForBackup) {
      setStatusToast({
        title: 'Changes saved',
        detail: 'External tab version backed up to History',
      });
    } else {
      setStatusToast({
        title: strategy === 'replace' ? 'Directory replaced' : 'Bookmarks imported',
        detail: result.snapshotWarning
          ? 'Saved (storage full — history backup skipped)'
          : `${nextBookmarks.length} bookmark${nextBookmarks.length === 1 ? '' : 's'} in directory`,
      });
    }
    return null;
  };

  const cancelImportMerge = () => {
    setImportMergeDialog(null);
    convergeFromDiskIfNeeded();
    restoreFocusSafely(modalTriggerRef.current);
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await importFile(file);
    event.target.value = '';
  };

  const resetDropState = useCallback(() => {
    dropDepthRef.current = 0;
    setDropMode(null);
    setUrlDropSection(null);
  }, []);

  const updateBookmarkDropTarget = useCallback((
    next: { bookmark: Bookmark; position: 'before' | 'after' } | null,
  ) => {
    const current = bookmarkDropTargetRef.current;
    if (
      current === next
      || (current && next
        && current.bookmark === next.bookmark
        && current.position === next.position)
    ) {
      return;
    }
    bookmarkDropTargetRef.current = next;
    setBookmarkDropTarget(next);
  }, []);

  const updateBookmarkDropSection = useCallback((next: string | null) => {
    if (bookmarkDropSectionRef.current === next) return;
    bookmarkDropSectionRef.current = next;
    setBookmarkDropSection(next);
  }, []);

  const resetBookmarkDragState = useCallback(() => {
    draggedBookmarkRef.current = null;
    setDraggedBookmark(null);
    updateBookmarkDropTarget(null);
    updateBookmarkDropSection(null);
  }, [updateBookmarkDropSection, updateBookmarkDropTarget]);

  useEffect(() => {
    const handleDragFinish = () => {
      resetDropState();
      resetBookmarkDragState();
    };
    window.addEventListener('dragend', handleDragFinish);
    window.addEventListener('drop', handleDragFinish);
    return () => {
      window.removeEventListener('dragend', handleDragFinish);
      window.removeEventListener('drop', handleDragFinish);
    };
  }, [resetBookmarkDragState, resetDropState]);

  const handleDragEnter = (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    if (contextMenu) setContextMenu(null);
    if (exportMenuOpen) setExportMenuOpen(false);
    if (isAnyModalVisible) return;
    const mode = detectDropMode(event.dataTransfer, allowFiles);
    if (!mode) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    const isEmptyState = bookmarks.length === 0;
    clearUndo();
    if (mode === 'url') {
      setUrlDropSection(isEmptyState ? null : getHoveredDropSection(event.target));
    } else {
      setUrlDropSection(null);
    }
    setDropMode(mode);
  };

  const handleDragOver = (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    if (isAnyModalVisible) return;
    if (Array.from(event.dataTransfer.types).includes(BOOKMARK_DRAG_TYPE)) {
      updateBookmarkDropTarget(null);
      updateBookmarkDropSection(null);
      return;
    }
    const mode = detectDropMode(event.dataTransfer, allowFiles);
    if (!mode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    const isEmptyState = bookmarks.length === 0;
    if (mode === 'url') {
      const hovered = isEmptyState ? null : getHoveredDropSection(event.target);
      setUrlDropSection((current) => (current === hovered ? current : hovered));
      setDropMode((current) => (current === 'url' ? current : 'url'));
    } else {
      setUrlDropSection(null);
      setDropMode((current) => (current === 'file' ? current : 'file'));
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      updateBookmarkDropTarget(null);
      updateBookmarkDropSection(null);
    }
    if (!dropDepthRef.current) return;
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) resetDropState();
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
      (bookmark) => urlIdentity(bookmark.url) === urlIdentity(url),
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
    const nextBookmarks = insertBookmarkInSection(bookmarks, bookmark);

    if (persist(nextBookmarks, {
      title: `Saved to ${targetSection}`,
      detail: bookmark.title,
      section,
      query,
      activeBookmark,
    })) {
      if (section !== 'All' && section !== targetSection) {
        setSection(targetSection);
      }
      setQuery('');
      pendingScrollBookmarkRef.current = bookmark;
      setActiveBookmark(bookmark);
      setKeyboardSelection(false);
      if (!corruptBackup) setError(null);
    } else {
      setError(storageError('Couldn’t save URL'));
    }
  };

  const handlePageDrop = async (
    event: DragEvent<HTMLElement>,
    allowFiles: boolean,
  ) => {
    if (isAnyModalVisible) return;

    if (Array.from(event.dataTransfer.types).includes(BOOKMARK_DRAG_TYPE)) {
      event.preventDefault();
      const source = draggedBookmarkRef.current;
      const target = bookmarkDropTargetRef.current;
      const targetSec = bookmarkDropSectionRef.current;
      resetBookmarkDragState();
      if (!source) return;
      if (target) {
        moveBookmarkAt(source, target.bookmark, target.position);
      } else if (targetSec) {
        moveBookmarkSection(source, targetSec);
      }
      return;
    }

    const mode = detectDropMode(event.dataTransfer, allowFiles);
    const files = allowFiles ? Array.from(event.dataTransfer.files) : [];
    if (!mode && files.length === 0) return;

    const isEmptyState = bookmarks.length === 0;
    const hovered = isEmptyState ? null : getHoveredDropSection(event.target);
    const targetSection = isEmptyState
      ? 'Uncategorized'
      : resolveDropSection(hovered ?? urlDropSection, section);
    event.preventDefault();
    resetDropState();

    if (files.length > 0) {
      const bookmarkFiles = files.filter(
        (file) => isBookmarkFileName(file.name) || isBookmarkFileMime(file.type),
      );
      if (bookmarkFiles.length > 1) {
        setError({
          title: 'Couldn’t import bookmarks',
          detail: 'Drop one JSON or HTML file at a time.',
        });
        return;
      }
      if (bookmarkFiles.length === 1 && files.length === 1) {
        if (!corruptBackup) setError(null);
        await importFile(bookmarkFiles[0]);
        return;
      }
      if (readDroppedUrl(event.dataTransfer)) {
        addDroppedUrl(event.dataTransfer, targetSection);
        return;
      }
      setError({
        title: 'Couldn’t import bookmarks',
        detail: files.length > 1
          ? 'Drop one JSON or HTML file at a time.'
          : 'Drop a .json or .html bookmark file, or a webpage URL.',
      });
      return;
    }

    if (mode === 'url') {
      addDroppedUrl(event.dataTransfer, targetSection);
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
    if (!corruptBackup) setError(null);
  };

  const saveBookmark = (
    nextBookmark: Bookmark,
    options?: { overwriteExternalConflict?: boolean },
  ): string | null => {
    const { blocked, conflictForBackup } = checkPreWriteConflict(
      options?.overwriteExternalConflict,
    );
    if (blocked) return null;

    const editingBookmark = bookmarkDialog?.mode === 'edit'
      ? bookmarkDialog.bookmark
      : null;

    let editingIndex = -1;
    if (editingBookmark) {
      editingIndex = bookmarks.indexOf(editingBookmark);
      if (editingIndex < 0) {
        const editingIdentity = urlIdentity(editingBookmark.url);
        editingIndex = bookmarks.findIndex(
          (item) => urlIdentity(item.url) === editingIdentity,
        );
      }
    }
    const resolvedEditing = editingIndex >= 0 ? bookmarks[editingIndex] : null;

    const bookmarkIdentity = urlIdentity(nextBookmark.url);
    const duplicate = bookmarks.find(
      (bookmark, index) => index !== editingIndex
        && urlIdentity(bookmark.url) === bookmarkIdentity,
    );
    if (duplicate) return `“${duplicate.title}” already uses this URL.`;

    let nextBookmarks: Bookmark[];
    if (resolvedEditing) {
      if (nextBookmark.section === resolvedEditing.section) {
        nextBookmarks = bookmarks.map((bookmark, index) =>
          index === editingIndex ? nextBookmark : bookmark,
        );
      } else {
        const remaining = bookmarks.filter((_bookmark, index) => index !== editingIndex);
        nextBookmarks = insertBookmarkInSection(remaining, nextBookmark);
      }
    } else {
      nextBookmarks = insertBookmarkInSection(bookmarks, nextBookmark);
    }

    const snapshotRequests: SnapshotRequest[] = [];
    if (options?.overwriteExternalConflict && conflictForBackup) {
      snapshotRequests.push({
        trigger: 'external-conflict',
        label: 'External tab changes before overwrite',
        bookmarks: conflictForBackup.externalBookmarks,
      });
    }

    const result = persistWithMeta(nextBookmarks, null, {
      snapshots: snapshotRequests,
    });
    if (result.ok) {
      setSection(nextBookmark.section);
      setQuery('');
      setActiveBookmark(nextBookmark);
      setKeyboardSelection(false);
      if (!corruptBackup) setError(null);
      setExternalConflict(null);
      setBookmarkDialog(null);
      restoreFocusSafely(modalTriggerRef.current);
      if (options?.overwriteExternalConflict && conflictForBackup) {
        setStatusToast({
          title: 'Changes saved',
          detail: 'External tab version backed up to History',
        });
      }
      return null;
    }
    return 'Browser storage is full, blocked, or unavailable.';
  };

  const cancelBookmarkDialog = () => {
    setBookmarkDialog(null);
    convergeFromDiskIfNeeded();
    restoreFocusSafely(modalTriggerRef.current);
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
      if (!corruptBackup) setError(null);
      setBookmarkDialog(null);
    } else {
      setError(storageError('Couldn’t remove bookmark'));
    }
  };

  const renameSection = (
    nextName: string,
    options?: { overwriteExternalConflict?: boolean },
  ): string | null => {
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

    const { blocked, conflictForBackup } = checkPreWriteConflict(
      options?.overwriteExternalConflict,
    );
    if (blocked) return null;

    let nextActiveBookmark = activeBookmark;
    const nextBookmarks = bookmarks.map((bookmark) => {
      if (bookmark.section !== previousName) return bookmark;
      const renamed = { ...bookmark, section: nextName };
      if (bookmark === activeBookmark) nextActiveBookmark = renamed;
      return renamed;
    });

    const snapshotRequests: SnapshotRequest[] = [];
    if (options?.overwriteExternalConflict && conflictForBackup) {
      snapshotRequests.push({
        trigger: 'external-conflict',
        label: 'External tab changes before overwrite',
        bookmarks: conflictForBackup.externalBookmarks,
      });
    }

    const result = persistWithMeta(nextBookmarks, null, {
      snapshots: snapshotRequests,
    });
    if (result.ok) {
      if (section === previousName) setSection(nextName);
      setActiveBookmark(nextActiveBookmark);
      setKeyboardSelection(false);
      if (!corruptBackup) setError(null);
      setExternalConflict(null);
      setSectionDialog(null);
      restoreFocusSafely(modalTriggerRef.current);
      if (options?.overwriteExternalConflict && conflictForBackup) {
        setStatusToast({
          title: 'Changes saved',
          detail: 'External tab version backed up to History',
        });
      }
      return null;
    }
    return 'Browser storage is full, blocked, or unavailable.';
  };

  const deleteSection = (
    strategy: 'move' | 'delete',
    destination?: string,
    options?: { overwriteExternalConflict?: boolean },
  ): string | null => {
    if (!sectionDialog) return 'Section is no longer available.';
    const sectionToDelete = sectionDialog.section;
    if (strategy === 'move' && !destination) {
      return 'Choose a destination section.';
    }

    const { blocked, conflictForBackup } = checkPreWriteConflict(
      options?.overwriteExternalConflict,
    );
    if (blocked) return null;

    const affectedCount = sectionCounts.get(sectionToDelete) ?? 0;
    let nextActiveBookmark = activeBookmark;
    const nextBookmarks = strategy === 'move'
      ? bookmarks.map((bookmark) => {
        if (bookmark.section !== sectionToDelete) return bookmark;
        const moved = { ...bookmark, section: destination! };
        if (bookmark === activeBookmark) nextActiveBookmark = moved;
        return moved;
      })
      : bookmarks.filter((bookmark) => {
        if (bookmark.section !== sectionToDelete) return true;
        if (bookmark === activeBookmark) nextActiveBookmark = null;
        return false;
      });

    const snapshotRequests: SnapshotRequest[] = [];
    if (options?.overwriteExternalConflict && conflictForBackup) {
      snapshotRequests.push({
        trigger: 'external-conflict',
        label: 'External tab changes before overwrite',
        bookmarks: conflictForBackup.externalBookmarks,
      });
    }
    snapshotRequests.push({
      trigger: 'pre-section-delete',
      label: `Before removing section “${sectionToDelete}”`,
    });

    const result = persistWithMeta(
      nextBookmarks,
      {
        title: strategy === 'move' ? 'Section removed' : 'Section and bookmarks removed',
        detail: strategy === 'move'
          ? `${affectedCount} bookmark${affectedCount === 1 ? '' : 's'} moved to ${destination}.`
          : `${affectedCount} bookmark${affectedCount === 1 ? '' : 's'} removed from ${sectionToDelete}.`,
        section,
        query,
        activeBookmark,
      },
      { snapshots: snapshotRequests },
    );

    if (result.ok) {
      if (section === sectionToDelete) {
        setSection(strategy === 'move' ? destination! : 'All');
      }
      setActiveBookmark(nextActiveBookmark);
      setKeyboardSelection(false);
      if (!corruptBackup) setError(null);
      setExternalConflict(null);
      setSectionDialog(null);
      restoreFocusSafely(modalTriggerRef.current);
      if (options?.overwriteExternalConflict && conflictForBackup) {
        setStatusToast({
          title: 'Changes saved',
          detail: 'External tab version backed up to History',
        });
      }
      return null;
    }
    return 'Browser storage is full, blocked, or unavailable.';
  };

  const cancelSectionDialog = () => {
    setSectionDialog(null);
    convergeFromDiskIfNeeded();
    restoreFocusSafely(modalTriggerRef.current);
  };

  const copyBookmarkUrl = (bookmark: Bookmark) => {
    const url = normalizeUrl(bookmark.url);
    if (!url || !navigator.clipboard?.writeText) {
      setError({
        title: 'Couldn’t copy URL',
        detail: 'Clipboard access is unavailable in this browser context.',
      });
      return;
    }

    void navigator.clipboard.writeText(url).then(
      () => {
        setStatusToast({ title: 'Copied URL', detail: bookmark.title });
      },
      () => {
        setError({
          title: 'Couldn’t copy URL',
          detail: 'Clipboard access was denied by the browser.',
        });
      },
    );
  };

  const openContextMenu = (
    target: ContextMenuTarget,
    anchor: { x: number; y: number },
    openedBy: 'pointer' | 'keyboard',
    trigger: HTMLElement | null,
  ) => {
    contextMenuTriggerRef.current = trigger;
    contextMenuIdRef.current += 1;
    if (target.kind === 'bookmark') {
      setKeyboardSelection(openedBy === 'keyboard');
      setActiveBookmark(target.bookmark);
    }
    setContextMenu({
      id: contextMenuIdRef.current,
      anchor,
      openedBy,
      target,
    });
  };

  const closeContextMenu = (restoreFocus: boolean) => {
    setContextMenu(null);
    if (!restoreFocus) return;
    restoreFocusSafely(contextMenuTriggerRef.current);
  };

  const handleElementContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    target: ContextMenuTarget,
  ) => {
    if (isAnyModalVisible) return;
    event.preventDefault();
    event.stopPropagation();
    const isKeyboardCoords = event.clientX === 0 && event.clientY === 0;
    const rect = event.currentTarget.getBoundingClientRect();
    const anchor = isKeyboardCoords
      ? { x: rect.left + 12, y: rect.bottom + 4 }
      : { x: event.clientX, y: event.clientY };
    openContextMenu(
      target,
      anchor,
      isKeyboardCoords ? 'keyboard' : 'pointer',
      event.currentTarget,
    );
  };

  const handleElementContextKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    target: ContextMenuTarget,
  ) => {
    if (isAnyModalVisible) return;
    if (
      event.key === 'ContextMenu'
      || (event.key === 'F10' && event.shiftKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      openContextMenu(
        target,
        { x: rect.left + 16, y: rect.bottom + 4 },
        'keyboard',
        event.currentTarget,
      );
    }
  };

  const reopenContextMenuAt = (x: number, y: number) => {
    const hit = document
      .elementsFromPoint(x, y)
      .find(
        (el) =>
          !el.classList.contains('app-context-backdrop')
          && !el.closest('.app-context-menu'),
      );
    const bookmarkEl = hit?.closest<HTMLElement>('.app-bookmark');
    if (bookmarkEl) {
      const idx = Number(bookmarkEl.dataset.appBookmarkIndex);
      const targetBookmark = Number.isInteger(idx) ? matches[idx] : undefined;
      if (targetBookmark) {
        openContextMenu(
          { kind: 'bookmark', bookmark: targetBookmark },
          { x, y },
          'pointer',
          bookmarkEl,
        );
        return;
      }
    }

    const sectionEl = hit?.closest<HTMLElement>(
      '.app-section-nav button[data-drop-section], .app-group-heading[data-section-heading]',
    );
    const sectionName =
      sectionEl?.dataset.dropSection ?? sectionEl?.dataset.sectionHeading;
    if (sectionEl && sectionName) {
      openContextMenu(
        { kind: 'section', section: sectionName },
        { x, y },
        'pointer',
        sectionEl,
      );
      return;
    }

    setContextMenu(null);
  };

  const chooseFile = () => {
    if (!corruptBackup) setError(null);
    resetDropState();
    setExportMenuOpen(false);
    fileRef.current?.click();
  };

  const exportJson = () => {
    closeExportMenu(true);
    downloadTextFile(
      'bookmarks.json',
      JSON.stringify(bookmarks, null, 2),
      'application/json',
    );
    setStatusToast({ title: 'Exported JSON', detail: 'bookmarks.json' });
  };

  const exportHtml = () => {
    closeExportMenu(true);
    downloadTextFile(
      'bookmarks.html',
      serializeBookmarksHtml(bookmarks),
      'text/html;charset=utf-8',
    );
    setStatusToast({ title: 'Exported browser HTML', detail: 'bookmarks.html' });
  };

  const clearPendingEditorClose = () => {
    if (editorCloseTimerRef.current !== null) {
      window.clearTimeout(editorCloseTimerRef.current);
      editorCloseTimerRef.current = null;
    }
  };

  const openEditor = () => {
    clearPendingEditorClose();
    captureModalOpenContext();
    captureEditBaseline(bookmarks);
    setExportMenuOpen(false);
    setEditorRepairMode(false);
    setEditorContent(JSON.stringify(bookmarks, null, 2));
    setEditorError(null);
    setEditorClosing(false);
    setEditorOpen(true);
  };

  const openRepairBackup = () => {
    if (!corruptBackup) return;
    clearPendingEditorClose();
    if (!snapshotDialog) {
      captureModalOpenContext();
    }
    captureEditBaseline(bookmarks);
    setSnapshotDialog(false);
    setExportMenuOpen(false);
    setEditorRepairMode(true);
    setEditorContent(corruptBackup.raw);
    let diagnostic: AppError | null = null;
    try {
      parseEditorBookmarks(corruptBackup.raw);
    } catch (parseErr) {
      diagnostic = formatBookmarkError(
        parseErr,
        corruptBackup.raw,
        'Repair corrupt backup',
      );
    }
    setEditorError(diagnostic);
    setEditorClosing(false);
    setEditorOpen(true);
  };

  const closeEditor = (shouldConverge = true) => {
    if (editorClosing || !editorOpen) return;
    setEditorClosing(true);
    if (shouldConverge) {
      convergeFromDiskIfNeeded();
    }
    clearPendingEditorClose();
    editorCloseTimerRef.current = window.setTimeout(() => {
      editorCloseTimerRef.current = null;
      setEditorOpen(false);
      setEditorClosing(false);
      setEditorRepairMode(false);
      restoreFocusSafely(modalTriggerRef.current);
    }, 180);
  };

  useEffect(() => {
    closeEditorRef.current = closeEditor;
  });

  const saveEditor = (overwriteExternalConflict = false) => {
    if (!editorOpen || editorClosing) return;

    let nextBookmarks: Bookmark[];
    try {
      nextBookmarks = parseEditorBookmarks(editorContent);
    } catch (saveError) {
      setEditorError(
        formatBookmarkError(saveError, editorContent, 'Couldn’t save changes'),
      );
      return;
    }

    const { blocked, conflictForBackup } = checkPreWriteConflict(
      overwriteExternalConflict,
    );
    if (blocked) return;

    const nextHash = computeBookmarksHash(nextBookmarks);
    const currentHash = computeBookmarksHash(bookmarks);
    if (nextHash === currentHash && !editorRepairMode && !overwriteExternalConflict) {
      setEditorError(null);
      closeEditor(false);
      return;
    }

    const snapshotRequests: SnapshotRequest[] = [];
    if (overwriteExternalConflict && conflictForBackup) {
      snapshotRequests.push({
        trigger: 'external-conflict',
        label: 'External tab changes before overwrite',
        bookmarks: conflictForBackup.externalBookmarks,
      });
    }
    if (bookmarks.length > 0) {
      snapshotRequests.push({
        trigger: 'pre-editor-save',
        label: 'Before JSON edit',
      });
    }

    const result = persistWithMeta(nextBookmarks, null, {
      snapshots: snapshotRequests,
      clearCorruptBackup: editorRepairMode,
    });
    if (!result.ok) {
      setEditorError(storageError('Couldn’t save changes'));
      return;
    }

    const repaired = editorRepairMode;
    setSection('All');
    setQuery('');
    setActiveBookmark(nextBookmarks[0] ?? null);
    setKeyboardSelection(false);
    if (repaired || !corruptBackup) setError(null);
    setExternalConflict(null);
    setEditorError(null);
    closeEditor(false);

    if (overwriteExternalConflict && conflictForBackup) {
      setStatusToast({
        title: 'Changes saved',
        detail: 'External tab version backed up to History',
      });
    } else if (repaired) {
      setStatusToast({
        title: 'Backup repaired',
        detail: `${nextBookmarks.length} bookmark${nextBookmarks.length === 1 ? '' : 's'} restored`,
      });
    }
  };

  const handleRestoreSnapshot = (snapshot: BookmarkSnapshot): string | null => {
    const nextBookmarks = snapshot.bookmarks.map(cloneBookmark);
    const snapshotRequests: SnapshotRequest[] = bookmarks.length > 0
      ? [{ trigger: 'pre-restore', label: formatPreRestoreLabel(snapshot) }]
      : [];

    const result = persistWithMeta(nextBookmarks, null, {
      snapshots: snapshotRequests,
    });
    if (!result.ok) {
      return 'Browser storage is full, blocked, or unavailable. Existing bookmarks were not changed.';
    }

    setSection('All');
    setQuery('');
    setActiveBookmark(nextBookmarks[0] ?? null);
    setKeyboardSelection(false);
    if (!corruptBackup) setError(null);
    closeSnapshotDialog();
    setStatusToast({
      title: 'Snapshot restored',
      detail: `#${shortBookmarksHash(snapshot.hash)} · ${snapshot.label}`,
    });
    return null;
  };

  const handleCreateCheckpoint = (label: string): string | null => {
    const result = createCheckpoint(label);
    if (!result.ok) {
      return result.status === 'skipped-empty'
        ? 'Add bookmarks before saving a checkpoint.'
        : 'Browser storage is full, blocked, or unavailable.';
    }
    const saved = result.snapshot;
    setStatusToast({
      title: result.status === 'upgraded' ? 'Checkpoint updated' : 'Checkpoint saved',
      detail: saved
        ? `#${shortBookmarksHash(saved.hash)} · ${saved.label}`
        : label.trim() || 'Manual checkpoint',
    });
    return null;
  };

  const handleDeleteSnapshot = (snapshotId: string): string | null => {
    const ok = deleteSnapshot(snapshotId);
    if (!ok) {
      return 'Could not delete snapshot from browser storage.';
    }
    return null;
  };

  const handleDismissCorruptBackup = () => {
    dismissCorruptBackup();
    setError(null);
    setStatusToast({ title: 'Corrupt backup dismissed' });
  };

  const dropActive = dropMode !== null;
  const dropHeading = dropMode === 'url' ? URL_DROP_HEADING : DROP_HEADING;
  const dropCopy = dropMode === 'url' ? URL_DROP_COPY : DROP_COPY;
  const activeUrlDropSection = dropMode === 'url'
    ? resolveDropSection(urlDropSection, section)
    : null;

  return (
    <div className="app-page">
      <input
        ref={fileRef}
        type="file"
        accept="application/json,text/html,.json,.html,.htm"
        hidden
        onChange={handleFile}
      />

      {bookmarks.length === 0 ? (
        <main
          className={`app-empty${dropActive ? ' is-drop-active' : ''}`}
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
                  reserve={EMPTY_COPY}
                  codeToken="bookmarks.json"
                />
              </p>
            </div>
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
                Choose JSON or HTML
                <span className="app-load-arrow" aria-hidden="true">↗</span>
              </button>
              <button
                type="button"
                className="app-load-button"
                tabIndex={dropActive ? -1 : undefined}
                onClick={() => openBookmarkDialog({
                  mode: 'add',
                  initialSection: 'Uncategorized',
                })}
              >
                Add manually
                <span className="app-load-arrow" aria-hidden="true">＋</span>
              </button>
              {(snapshots.length > 0 || corruptBackup !== null) && (
                <button
                  type="button"
                  className={`app-load-button${corruptBackup ? ' has-rescue-dot' : ''}`}
                  tabIndex={dropActive ? -1 : undefined}
                  onClick={openSnapshotDialog}
                >
                  History{snapshots.length > 0 ? ` (${snapshots.length})` : ''}
                </button>
              )}
            </div>
            {error && (
              <ErrorNotice
                error={error}
                onDismiss={() => setError(null)}
                action={corruptBackup
                  ? { label: 'Repair backup', onClick: openRepairBackup }
                  : undefined}
                className="app-file-error"
              />
            )}
          </section>
        </main>
      ) : (
        <div
          className="app-shell"
          onDragEnter={(event) => handleDragEnter(event, true)}
          onDragOver={(event) => handleDragOver(event, true)}
          onDragLeave={handleDragLeave}
          onDrop={(event) => { void handlePageDrop(event, true); }}
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
                  data-drop-section={name}
                  style={{ animationDelay: `${(index + 1) * 55}ms` }}
                  className={`${section === name ? 'is-active' : ''}${
                    draggedSection === name ? ' is-dragging' : ''
                  }${
                    dragTarget?.name === name
                      ? ` is-drop-${dragTarget.position}`
                      : ''
                  }${
                    activeUrlDropSection === name ? ' is-url-drop-target' : ''
                  }${
                    bookmarkDropSection === name ? ' is-bookmark-drop-target' : ''
                  }`}
                  aria-pressed={section === name}
                  title="Drag to reorder"
                  onDragStart={(event) => {
                    if (contextMenu) setContextMenu(null);
                    if (exportMenuOpen) setExportMenuOpen(false);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(SECTION_DRAG_TYPE, name);
                    event.dataTransfer.setData('text/plain', name);
                    setDraggedSection(name);
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

                    const dragged = draggedBookmarkRef.current;
                    if (dragged && dragged.section !== name) {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = 'move';
                      updateBookmarkDropTarget(null);
                      updateBookmarkDropSection(name);
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
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedSection(null);
                    setDragTarget(null);
                  }}
                  onContextMenu={(event) =>
                    handleElementContextMenu(event, { kind: 'section', section: name })}
                  onKeyDown={(event) =>
                    handleElementContextKeyDown(event, { kind: 'section', section: name })}
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
                  onClick={() => openSectionDialog({ mode: 'rename', section })}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => openSectionDialog({ mode: 'delete', section })}
                >
                  Remove
                </button>
              </div>
            )}

            {error && (
              <ErrorNotice
                error={error}
                onDismiss={() => setError(null)}
                action={corruptBackup
                  ? { label: 'Repair backup', onClick: openRepairBackup }
                  : undefined}
                className="app-sidebar-error"
              />
            )}

            <div className="app-data-actions">
              <button type="button" onClick={chooseFile}>
                Import
              </button>
              <button
                ref={exportButtonRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                onClick={() => setExportMenuOpen((open) => !open)}
              >
                Export
              </button>
              <button type="button" onClick={openEditor}>
                Edit JSON
              </button>
              <button
                type="button"
                title="History (h)"
                className={corruptBackup ? 'has-rescue-dot' : undefined}
                onClick={openSnapshotDialog}
              >
                History
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
                      onClick={() => openBookmarkDialog({
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
                  onClick={() => openBookmarkDialog({
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
              {[...groupedMatches].map(([sectionName, items]) => {
                const seenKeys = new Map<string, number>();
                return (
                  <section
                    key={sectionName}
                    data-drop-section={sectionName}
                    className={`app-group${
                      activeUrlDropSection === sectionName ? ' is-url-drop-target' : ''
                    }${
                      bookmarkDropSection === sectionName ? ' is-bookmark-drop-target' : ''
                    }`}
                    onDragOver={(event) => {
                      const dragged = draggedBookmarkRef.current;
                      if (dragged && dragged.section !== sectionName) {
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = 'move';
                        updateBookmarkDropTarget(null);
                        updateBookmarkDropSection(sectionName);
                      }
                    }}
                  >
                    <div
                      className="app-group-heading"
                      data-section-heading={sectionName}
                      onContextMenu={(event) =>
                        handleElementContextMenu(event, {
                          kind: 'section',
                          section: sectionName,
                        })}
                    >
                      <h2>{sectionName}</h2>
                      <span>{String(items.length).padStart(2, '0')}</span>
                    </div>
                    <div className="app-bookmark-list">
                      {items.map((bookmark) => {
                        const bookmarkIndex = matchIndices.get(bookmark) ?? -1;
                        const baseKey = `${bookmark.url}-${bookmark.title}`;
                        const occurrence = seenKeys.get(baseKey) ?? 0;
                        seenKeys.set(baseKey, occurrence + 1);
                        const key = occurrence === 0 ? baseKey : `${baseKey}-${occurrence}`;
                        const dropClass = bookmarkDropTarget?.bookmark === bookmark
                          ? ` is-drop-${bookmarkDropTarget.position}`
                          : '';
                        return (
                          <a
                            key={key}
                            draggable
                            href={normalizeUrl(bookmark.url)}
                            data-app-bookmark-index={bookmarkIndex}
                            className={`app-bookmark${
                              bookmark === inspected
                                ? ` is-current${keyboardSelection ? ' is-keyboard-current' : ''}`
                                : ''
                            }${
                              draggedBookmark === bookmark ? ' is-dragging' : ''
                            }${dropClass}`}
                            onMouseEnter={() => {
                              setKeyboardSelection(false);
                              setActiveBookmark(bookmark);
                            }}
                            onFocus={() => {
                              setKeyboardSelection(true);
                              setActiveBookmark(bookmark);
                            }}
                            onDragStart={(event) => {
                              if (contextMenu) setContextMenu(null);
                              if (exportMenuOpen) setExportMenuOpen(false);
                              event.dataTransfer.effectAllowed = 'copyMove';
                              event.dataTransfer.setData(BOOKMARK_DRAG_TYPE, '1');
                              event.dataTransfer.setData(
                                'text/uri-list',
                                normalizeUrl(bookmark.url),
                              );
                              event.dataTransfer.setData(
                                'text/plain',
                                normalizeUrl(bookmark.url),
                              );
                              draggedBookmarkRef.current = bookmark;
                              setDraggedBookmark(bookmark);
                            }}
                            onDragOver={(event) => {
                              const source = draggedBookmarkRef.current;
                              if (!source || query.trim()) return;
                              const position = getBookmarkDropPosition(
                                event,
                                event.currentTarget,
                              );
                              if (
                                reorderBookmark(bookmarks, source, bookmark, position)
                                === bookmarks
                              ) {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = 'move';
                              updateBookmarkDropSection(null);
                              updateBookmarkDropTarget({ bookmark, position });
                            }}
                            onDragEnd={resetBookmarkDragState}
                            onContextMenu={(event) =>
                              handleElementContextMenu(event, {
                                kind: 'bookmark',
                                bookmark,
                              })}
                            onKeyDown={(event) =>
                              handleElementContextKeyDown(event, {
                                kind: 'bookmark',
                                bookmark,
                              })}
                          >
                            <img
                              src={bookmark.iconUrl || getFaviconUrl(bookmark.url, 64)}
                              alt=""
                              draggable={false}
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
                );
              })}

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
                    onClick={() => openBookmarkDialog({
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
                  It will land in {resolveDropSection(urlDropSection, section)}
                </small>
              </div>
            </div>
          )}

          {dropMode === 'file' && (
            <div className="app-url-drop-hint" role="status">
              <span aria-hidden="true">↗</span>
              <div>
                <strong>Drop file to import</strong>
                <small>Review changes in Import Studio (.json or .html)</small>
              </div>
            </div>
          )}

          {exportMenuOpen && (
            <>
              <div
                className="app-export-backdrop"
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.preventDefault();
                  closeExportMenu(false);
                }}
              />
              <div
                ref={exportMenuRef}
                className="app-export-popover"
                role="menu"
                aria-label="Export bookmarks"
                style={{ left: exportMenuPos.left, top: exportMenuPos.top }}
                onKeyDown={handleExportMenuKeyDown}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="app-context-menu-item"
                  onClick={exportJson}
                >
                  <span>JSON backup</span>
                  <small>.json</small>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="app-context-menu-item"
                  onClick={exportHtml}
                >
                  <span>Browser HTML</span>
                  <small>.html</small>
                </button>
              </div>
            </>
          )}

          {contextMenu && (
            <ContextMenu
              key={contextMenu.id}
              anchor={contextMenu.anchor}
              openedBy={contextMenu.openedBy}
              target={contextMenu.target}
              sections={[...sectionCounts.keys()]}
              onOpenNewTab={(bookmark) => {
                closeContextMenu(contextMenu.openedBy === 'keyboard');
                window.open(normalizeUrl(bookmark.url), '_blank', 'noopener,noreferrer');
              }}
              onCopyUrl={(bookmark) => {
                closeContextMenu(contextMenu.openedBy === 'keyboard');
                copyBookmarkUrl(bookmark);
              }}
              onEditBookmark={(bookmark) => {
                const trigger = contextMenuTriggerRef.current;
                closeContextMenu(false);
                openBookmarkDialog({ mode: 'edit', bookmark }, trigger);
              }}
              onMoveBookmark={(bookmark, targetSection) => {
                closeContextMenu(false);
                moveBookmarkSection(bookmark, targetSection);
              }}
              onDeleteBookmark={(bookmark) => {
                closeContextMenu(false);
                deleteBookmark(bookmark);
              }}
              onAddBookmarkToSection={(targetSection) => {
                const trigger = contextMenuTriggerRef.current;
                closeContextMenu(false);
                openBookmarkDialog({ mode: 'add', initialSection: targetSection }, trigger);
              }}
              onRenameSection={(targetSection) => {
                const trigger = contextMenuTriggerRef.current;
                closeContextMenu(false);
                openSectionDialog({ mode: 'rename', section: targetSection }, trigger);
              }}
              onRemoveSection={(targetSection) => {
                const trigger = contextMenuTriggerRef.current;
                closeContextMenu(false);
                openSectionDialog({ mode: 'delete', section: targetSection }, trigger);
              }}
              onReopenAt={reopenContextMenuAt}
              onClose={closeContextMenu}
            />
          )}
        </div>
      )}

      {(undoState || statusToast) && (
        <div className="app-toast-stack">
          {undoState && (
            <UndoNotice undo={undoState} onUndo={undoLastChange} />
          )}
          {statusToast && (
            <div className="app-status-toast" role="status">
              <div>
                <strong>{statusToast.title}</strong>
                {statusToast.detail && <small>{statusToast.detail}</small>}
              </div>
            </div>
          )}
        </div>
      )}

      {bookmarkDialog && (
        <BookmarkDialog
          key={
            bookmarkDialog.mode === 'edit'
              ? `edit-${bookmarkDialog.revision}`
              : `add-${bookmarkDialog.revision}`
          }
          bookmark={bookmarkDialog.mode === 'edit' ? bookmarkDialog.bookmark : undefined}
          initialSection={bookmarkDialog.mode === 'add'
            ? bookmarkDialog.initialSection
            : bookmarkDialog.bookmark.section}
          sections={[...sectionCounts.keys()]}
          conflict={externalConflict}
          onLoadExternal={handleLoadExternalChanges}
          onCancel={cancelBookmarkDialog}
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
          conflict={externalConflict}
          onLoadExternal={handleLoadExternalChanges}
          onCancel={cancelSectionDialog}
          onRename={renameSection}
          onDelete={deleteSection}
        />
      )}

      {importMergeDialog && (
        <ImportMergeDialog
          fileName={importMergeDialog.fileName}
          format={importMergeDialog.format}
          existingBookmarks={bookmarks}
          incomingBookmarks={importMergeDialog.bookmarks}
          skippedNonHttpCount={importMergeDialog.skippedNonHttpCount}
          intraFileDuplicateCount={importMergeDialog.intraFileDuplicateCount}
          conflict={externalConflict}
          onLoadExternal={handleLoadExternalChanges}
          onCancel={cancelImportMerge}
          onCommit={commitImportMerge}
        />
      )}

      {snapshotDialog && (
        <SnapshotDialog
          snapshots={snapshots}
          liveBookmarks={bookmarks}
          corruptBackup={corruptBackup}
          onClose={closeSnapshotDialog}
          onRestore={handleRestoreSnapshot}
          onCreateCheckpoint={handleCreateCheckpoint}
          onDeleteSnapshot={handleDeleteSnapshot}
          onRepairCorruptBackup={openRepairBackup}
          onDismissCorruptBackup={handleDismissCorruptBackup}
        />
      )}

      {editorOpen && (
        <div
          className={`app-editor-backdrop${editorClosing ? ' is-closing' : ''}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor(true);
          }}
        >
          <section
            ref={editorDialogRef}
            tabIndex={-1}
            className={`app-editor${editorClosing ? ' is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-editor-title"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.defaultPrevented) return;
              if (
                (event.ctrlKey || event.metaKey)
                && event.key.toLowerCase() === 's'
              ) {
                event.preventDefault();
                if (externalConflict) {
                  focusConflictBanner(editorDialogRef.current);
                  setEditorError({
                    title: 'External conflict pending',
                    detail: 'Resolve the external tab conflict above first.',
                  });
                  return;
                }
                saveEditor(false);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeEditor(true);
              }
            }}
          >
            <header>
              <div>
                <p className="app-kicker">
                  {editorRepairMode ? 'Backup recovery' : 'Local data'}
                </p>
                <h2 id="app-editor-title">
                  {editorRepairMode ? 'Repair backup JSON' : 'Edit JSON'}
                </h2>
              </div>
              <div className="app-editor-actions">
                <button type="button" onClick={() => closeEditor(true)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="is-primary"
                  disabled={externalConflict !== null}
                  onClick={() => saveEditor(false)}
                >
                  {editorRepairMode ? 'Save & restore' : 'Save changes'}
                </button>
              </div>
            </header>
            {externalConflict && (
              <ExternalConflictBanner
                conflict={externalConflict}
                onLoadExternal={handleLoadExternalChanges}
                onSaveMine={() => {
                  setEditorError(null);
                  saveEditor(true);
                }}
                className="app-editor-conflict"
              />
            )}
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
