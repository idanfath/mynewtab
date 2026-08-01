import type { BookMark, BookMarks } from './types';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
} from 'react';
import Fuse from 'fuse.js';
import Header from './components/Header';
import BookmarkList from './components/BookmarkList';
import EditorModal from './components/EditorModal';
import {
    getFaviconUrl,
    loadBookmarks,
    normalizeUrl,
    parseBookmarks,
    saveBookmarks,
} from './lib';
import icon from '../icon.png';

function openUrl(url: string, newTab = false) {
    const destination = normalizeUrl(url);
    if (!destination) return;

    if (newTab) {
        window.open(destination, '_blank', 'noopener,noreferrer');
    } else {
        window.location.assign(destination);
    }
}

function App() {
    const [bookmarks, setBookmarks] = useState<BookMarks>(() => loadBookmarks());
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editorContent, setEditorContent] = useState('');
    const [editorError, setEditorError] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const searchInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        saveBookmarks(bookmarks);
    }, [bookmarks]);

    useEffect(() => {
        if (!isEditorOpen) searchInputRef.current?.focus();
    }, [isEditorOpen]);

    useEffect(() => {
        const focusSearch = (event: globalThis.KeyboardEvent) => {
            if (
                event.key !== '/' ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                isEditorOpen
            ) {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (
                target?.isContentEditable ||
                ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
            ) {
                return;
            }

            event.preventDefault();
            searchInputRef.current?.focus();
        };

        document.addEventListener('keydown', focusSearch);
        return () => document.removeEventListener('keydown', focusSearch);
    }, [isEditorOpen]);

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return [];

        const allBookmarks: (BookMark & { category: string })[] = [];
        Object.entries(bookmarks).forEach(([category, bookmarkList]) => {
            bookmarkList.forEach((bookmark) => {
                allBookmarks.push({ ...bookmark, category });
            });
        });

        return new Fuse(allBookmarks, {
            keys: ['title', 'description', 'url'],
            threshold: 0.4,
        })
            .search(searchQuery)
            .map((result) => result.item);
    }, [searchQuery, bookmarks]);

    const searchDestination = () => {
        const selectedBookmark = searchResults[selectedIndex];
        return selectedBookmark?.url ||
            `https://www.google.com/search?q=${encodeURIComponent(searchQuery.trim())}`;
    };

    const handleSearchSubmit = (event: FormEvent) => {
        event.preventDefault();
        if (searchQuery.trim()) openUrl(searchDestination());
    };

    const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown' && searchResults.length) {
            event.preventDefault();
            setSelectedIndex((current) => (current + 1) % searchResults.length);
        } else if (event.key === 'ArrowUp' && searchResults.length) {
            event.preventDefault();
            setSelectedIndex((current) =>
                current <= 0 ? searchResults.length - 1 : current - 1,
            );
        } else if (event.key === 'Escape') {
            setSearchQuery('');
            setSelectedIndex(-1);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (searchQuery.trim()) openUrl(searchDestination(), true);
        }
    };

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        setSelectedIndex(-1);
    };

    const handleEditorOpen = () => {
        setEditorContent(JSON.stringify(bookmarks, null, 2));
        setEditorError('');
        setIsEditorOpen(true);
    };

    const handleEditorCancel = useCallback(() => {
        setIsEditorOpen(false);
        setEditorError('');
    }, []);

    const handleEditorContentChange = (value: string) => {
        setEditorContent(value);
        setEditorError('');
    };

    const handleEditorSave = () => {
        try {
            const nextBookmarks = parseBookmarks(editorContent);
            if (!saveBookmarks(nextBookmarks)) {
                setEditorError('Bookmarks could not be saved. Export a backup and try again.');
                return;
            }

            setBookmarks(nextBookmarks);
            setIsEditorOpen(false);
            setEditorError('');
        } catch (error) {
            setEditorError(
                error instanceof Error ? error.message : 'Bookmarks are invalid.',
            );
        }
    };

    const handleExport = () => {
        const data = new Blob([JSON.stringify(bookmarks, null, 2)], {
            type: 'application/json',
        });
        const downloadUrl = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = 'bookmarks.json';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    };

    return (
        <div className="min-h-screen p-6">
            <Header onEdit={handleEditorOpen} />

            <EditorModal
                isOpen={isEditorOpen}
                content={editorContent}
                error={editorError}
                onSave={handleEditorSave}
                onCancel={handleEditorCancel}
                onExport={handleExport}
                onContentChange={handleEditorContentChange}
            />

            <div className="max-w-2xl mx-auto flex justify-center mb-8">
                <img src={icon} alt="" />
            </div>
            <div className="max-w-2xl mx-auto mb-8">
                <form onSubmit={handleSearchSubmit} className="relative">
                    <input
                        ref={searchInputRef}
                        type="search"
                        value={searchQuery}
                        onChange={(event) => handleSearchChange(event.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search bookmarks or enter query for Google..."
                        aria-label="Search bookmarks or Google"
                        aria-controls="search-results"
                        aria-expanded={searchResults.length > 0}
                        aria-activedescendant={
                            selectedIndex >= 0 ? `search-result-${selectedIndex}` : undefined
                        }
                        role="combobox"
                        autoComplete="off"
                        className="w-full px-4 py-3 text-lg border border-neutral-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />

                    {searchQuery && searchResults.length > 0 && (
                        <div
                            id="search-results"
                            role="listbox"
                            className="absolute top-full left-0 right-0 bg-white border border-gray-300 rounded-lg mt-1 max-h-64 overflow-y-auto z-10 shadow-lg"
                        >
                            {searchResults.map((bookmark, index) => (
                                <button
                                    id={`search-result-${index}`}
                                    key={`${bookmark.category}-${bookmark.url}-${bookmark.title}`}
                                    type="button"
                                    role="option"
                                    aria-selected={index === selectedIndex}
                                    className={`w-full px-4 py-2 flex items-center text-left hover:bg-gray-100 cursor-pointer ${
                                        index === selectedIndex ? 'bg-blue-100' : ''
                                    }`}
                                    onMouseMove={() => setSelectedIndex(index)}
                                    onClick={() => openUrl(bookmark.url)}
                                >
                                    <img
                                        src={bookmark.customIconUrl || getFaviconUrl(bookmark.url)}
                                        alt=""
                                        className="w-4 h-4 mr-3 rounded-sm"
                                    />
                                    <span className="flex-1">
                                        <span className="block text-sm font-medium text-gray-900">
                                            {bookmark.title}
                                            <span className="text-xs text-gray-500 capitalize">
                                                {' '}· {bookmark.category}
                                            </span>
                                        </span>
                                        {bookmark.description && (
                                            <span className="block text-xs text-gray-500">
                                                {bookmark.description}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </form>
            </div>

            <BookmarkList bookmarks={bookmarks} />
        </div>
    );
}

export default App;
