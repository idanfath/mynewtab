import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Bookmark } from './bookmarks.ts';
import { normalizeAlias, normalizeSearchUrl } from './lib.ts';

export type ContextMenuTarget =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'section'; section: string };

interface ContextMenuProps {
  anchor: { x: number; y: number };
  openedBy: 'pointer' | 'keyboard';
  target: ContextMenuTarget;
  sections: string[];
  onOpenNewTab: (bookmark: Bookmark) => void;
  onSearchSite: (bookmark: Bookmark) => void;
  onCopyUrl: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onMoveBookmark: (bookmark: Bookmark, targetSection: string) => void;
  onDeleteBookmark: (bookmark: Bookmark) => void;
  onAddBookmarkToSection: (section: string) => void;
  onRenameSection: (section: string) => void;
  onRemoveSection: (section: string) => void;
  onReopenAt: (x: number, y: number) => void;
  onClose: (restoreFocus: boolean) => void;
}

const CONTEXT_TARGET_SELECTOR =
  '.app-bookmark, .app-section-nav button[data-drop-section], .app-group-heading';

export default function ContextMenu({
  anchor,
  openedBy,
  target,
  sections,
  onOpenNewTab,
  onSearchSite,
  onCopyUrl,
  onEditBookmark,
  onMoveBookmark,
  onDeleteBookmark,
  onAddBookmarkToSection,
  onRenameSection,
  onRemoveSection,
  onReopenAt,
  onClose,
}: ContextMenuProps) {
  const [view, setView] = useState<'root' | 'move'>('root');
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    maxHeight?: number;
  }>({ left: anchor.x, top: anchor.y });
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<
    'initial' | 'move-first' | 'move-trigger' | null
  >('initial');
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const otherSections = target.kind === 'bookmark'
    ? sections.filter((name) => name !== target.bookmark.section)
    : [];

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.max(120, viewportHeight - margin * 2);

    const rect = menu.getBoundingClientRect();
    const width = Math.min(rect.width, viewportWidth - margin * 2);
    const height = Math.min(rect.height, maxHeight);

    let left = anchor.x;
    if (left + width > viewportWidth - margin) {
      left = anchor.x - width;
    }
    left = Math.round(Math.max(margin, Math.min(left, viewportWidth - width - margin)));

    let top = anchor.y;
    if (top + height > viewportHeight - margin) {
      top = anchor.y - height;
    }
    top = Math.round(Math.max(margin, Math.min(top, viewportHeight - height - margin)));

    setPosition((current) => (
      current.left === left
      && current.top === top
      && current.maxHeight === maxHeight
        ? current
        : { left, top, maxHeight }
    ));
  }, [anchor, view]);

  useEffect(() => {
    const menu = menuRef.current;
    const focusKind = pendingFocusRef.current;
    if (!menu || !focusKind) return;
    pendingFocusRef.current = null;

    if (focusKind === 'move-first') {
      const firstSection = menu.querySelector<HTMLElement>('[data-menu-section]');
      firstSection?.focus({ preventScroll: true });
    } else if (focusKind === 'move-trigger') {
      const moveTrigger = menu.querySelector<HTMLElement>('[data-menu-action="move"]');
      moveTrigger?.focus({ preventScroll: true });
    } else if (openedBy === 'keyboard') {
      const firstItem = menu.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus({ preventScroll: true });
    } else {
      menu.focus({ preventScroll: true });
    }
  }, [openedBy, view]);

  useEffect(() => {
    const handleScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      onCloseRef.current(false);
    };
    const handleDismiss = () => onCloseRef.current(false);

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('blur', handleDismiss);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('dragstart', handleDismiss, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('blur', handleDismiss);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('dragstart', handleDismiss, true);
    };
  }, []);

  const enterMoveView = () => {
    if (!otherSections.length) return;
    pendingFocusRef.current = 'move-first';
    setView('move');
  };

  const returnToRootView = () => {
    pendingFocusRef.current = 'move-trigger';
    setView('root');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;

    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }

    const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    const active = document.activeElement as HTMLElement | null;
    const activeIndex = active ? items.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length;
      items[nextIndex].focus({ preventScroll: true });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prevIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      items[prevIndex].focus({ preventScroll: true });
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus({ preventScroll: true });
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus({ preventScroll: true });
    } else if (
      event.key === 'ArrowRight'
      && view === 'root'
      && active?.dataset.menuAction === 'move'
    ) {
      event.preventDefault();
      enterMoveView();
    } else if (event.key === 'ArrowLeft' && view === 'move') {
      event.preventDefault();
      returnToRootView();
    }
  };

  const menuLabel = target.kind === 'bookmark'
    ? `Actions for ${target.bookmark.title}`
    : `Actions for ${target.section} section`;

  return (
    <>
      <div
        className="app-context-backdrop"
        aria-hidden="true"
        onPointerDown={(event) => {
          if (event.pointerType !== 'touch' && event.button !== 2) {
            event.preventDefault();
            onClose(false);
          }
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose(false);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const hit = document
            .elementsFromPoint(event.clientX, event.clientY)
            .find((el) => el !== event.currentTarget && !menuRef.current?.contains(el));
          const targetEl = hit?.closest(CONTEXT_TARGET_SELECTOR);
          if (targetEl) {
            onReopenAt(event.clientX, event.clientY);
          } else {
            onClose(false);
          }
        }}
      />
      <div
        ref={menuRef}
        className="app-context-menu"
        role="menu"
        aria-label={menuLabel}
        tabIndex={-1}
        style={{
          left: position.left,
          top: position.top,
          maxHeight: position.maxHeight,
        }}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {target.kind === 'bookmark' && view === 'move' ? (
          <>
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-back"
              onClick={returnToRootView}
            >
              <span>‹ Back</span>
            </button>
            <div className="app-context-menu-divider" role="separator" />
            <div className="app-context-menu-header" aria-hidden="true">
              Move to
            </div>
            <div className="app-context-menu-list" role="none">
              {otherSections.map((sectionName) => (
                <button
                  key={sectionName}
                  type="button"
                  role="menuitem"
                  data-menu-section={sectionName}
                  className="app-context-menu-item"
                  onClick={() => onMoveBookmark(target.bookmark, sectionName)}
                >
                  <span>{sectionName}</span>
                </button>
              ))}
            </div>
          </>
        ) : target.kind === 'bookmark' ? (
          <>
            <div className="app-context-menu-header" aria-hidden="true">
              {target.bookmark.title}
            </div>
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item"
              onClick={() => onOpenNewTab(target.bookmark)}
            >
              <span>Open in new tab</span>
            </button>
            {normalizeAlias(target.bookmark.alias ?? '')
              && normalizeSearchUrl(target.bookmark.searchUrl ?? '') && (
              <button
                type="button"
                role="menuitem"
                className="app-context-menu-item"
                onClick={() => onSearchSite(target.bookmark)}
              >
                <span>Search {target.bookmark.title}…</span>
                <small>!{normalizeAlias(target.bookmark.alias ?? '')}</small>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item"
              onClick={() => onCopyUrl(target.bookmark)}
            >
              <span>Copy URL</span>
            </button>
            <div className="app-context-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item"
              onClick={() => onEditBookmark(target.bookmark)}
            >
              <span>Edit…</span>
            </button>
            {otherSections.length > 0 && (
              <button
                type="button"
                role="menuitem"
                data-menu-action="move"
                className="app-context-menu-item"
                onClick={enterMoveView}
              >
                <span>Move to…</span>
                <small aria-hidden="true">›</small>
              </button>
            )}
            <div className="app-context-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item is-danger"
              onClick={() => onDeleteBookmark(target.bookmark)}
            >
              <span>Delete</span>
            </button>
          </>
        ) : (
          <>
            <div className="app-context-menu-header" aria-hidden="true">
              {target.section}
            </div>
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item"
              onClick={() => onAddBookmarkToSection(target.section)}
            >
              <span>Add bookmark here…</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item"
              onClick={() => onRenameSection(target.section)}
            >
              <span>Rename…</span>
            </button>
            <div className="app-context-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="app-context-menu-item is-danger"
              onClick={() => onRemoveSection(target.section)}
            >
              <span>Remove…</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
