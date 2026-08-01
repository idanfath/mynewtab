import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import Fuse from 'fuse.js';
import icon from '../../icon.png';
import { getFaviconUrl, normalizeUrl } from '../lib';
import { parseTestBookmarks, type TestBookmark } from './bookmarks';
import './TestPage.css';

const SESSION_KEY = 'newtab-test-bookmarks';

function loadSessionBookmarks(): TestBookmark[] {
    try {
        const content = sessionStorage.getItem(SESSION_KEY);
        return content ? parseTestBookmarks(content) : [];
    } catch {
        return [];
    }
}

function MetaList({ label, values }: { label: string; values?: string[] }) {
    if (!values?.length) return null;
    return (
        <div className="test-meta-row">
            <dt>{label}</dt>
            <dd>{values.join(' · ')}</dd>
        </div>
    );
}

function tierRank(tier: string): string {
    return tier.toUpperCase().replace('-TIER', '').trim();
}

function TestPage() {
    const [bookmarks, setBookmarks] = useState<TestBookmark[]>(loadSessionBookmarks);
    const [query, setQuery] = useState('');
    const [section, setSection] = useState('All');
    const [activeBookmark, setActiveBookmark] = useState<TestBookmark | null>(null);
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
                searchRef.current?.focus();
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
        const searched = query.trim()
            ? new Fuse(bookmarks, {
                keys: [
                    'title',
                    'url',
                    'section',
                    'subsection',
                    'description',
                    'categories',
                    'capabilities',
                    'pros',
                    'cons',
                    'formats',
                    'tier',
                    'product',
                ],
                threshold: 0.35,
            }).search(query).map((result) => result.item)
            : bookmarks;

        return section === 'All'
            ? searched
            : searched.filter((bookmark) => bookmark.section === section);
    }, [bookmarks, query, section]);

    const groupedMatches = useMemo(() => {
        const groups = new Map<string, TestBookmark[]>();
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

        setActiveBookmark(matches[nextIndex]);
        window.requestAnimationFrame(() => {
            document.querySelector(`[data-test-bookmark-index="${nextIndex}"]`)
                ?.scrollIntoView({ block: 'nearest' });
        });
    };

    const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const nextBookmarks = parseTestBookmarks(await file.text());
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextBookmarks));
            setBookmarks(nextBookmarks);
            setSection('All');
            setQuery('');
            setActiveBookmark(nextBookmarks[0] ?? null);
            setError('');
        } catch (fileError) {
            setError(fileError instanceof Error ? fileError.message : 'Could not read file.');
        } finally {
            event.target.value = '';
        }
    };

    if (!bookmarks.length) {
        return (
            <main className="test-empty test-page">
                <img src={icon} alt="" className="test-empty-mark" />
                <p className="test-kicker">UI laboratory / local session</p>
                <h1>Bring your index.</h1>
                <p className="test-empty-copy">
                    Load <code>bookmarks.json</code> from your computer. It stays in this
                    browser tab and never enters the project.
                </p>
                <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={handleFile}
                />
                <button className="test-load-button" onClick={() => fileRef.current?.click()}>
                    Choose bookmarks.json
                </button>
                {error && <p className="test-file-error">{error}</p>}
                <a href="/" className="test-back-link">Return to current page</a>
            </main>
        );
    }

    return (
        <div className="test-shell test-page">
            <aside className="test-sidebar">
                <a href="/test" className="test-brand" aria-label="Reload test page">
                    <img src={icon} alt="" />
                    <span>Index</span>
                </a>

                <nav className="test-section-nav" aria-label="Bookmark sections">
                    <button
                        className={section === 'All' ? 'is-active' : ''}
                        onClick={() => setSection('All')}
                    >
                        <span>Everything</span><small>{bookmarks.length}</small>
                    </button>
                    {[...sectionCounts].map(([name, count]) => (
                        <button
                            key={name}
                            className={section === name ? 'is-active' : ''}
                            onClick={() => setSection(name)}
                        >
                            <span>{name}</span><small>{count}</small>
                        </button>
                    ))}
                </nav>

            </aside>

            <main className="test-main">
                <header className="test-header">
                    <div>
                        <p className="test-kicker">Personal directory</p>
                        <h1>{section === 'All' ? 'Everything' : section}</h1>
                    </div>
                    <label className="test-search">
                        <span className="test-search-mark">/</span>
                        <input
                            ref={searchRef}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
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
                                }
                            }}
                            placeholder="Find title, category, capability…"
                            aria-label="Search test bookmarks"
                        />
                        <small>{matches.length}</small>
                    </label>
                </header>

                {error && <p className="test-inline-error">{error}</p>}

                <div className="test-directory">
                    {[...groupedMatches].map(([sectionName, items]) => (
                        <section key={sectionName} className="test-group">
                            <div className="test-group-heading">
                                <h2>{sectionName}</h2>
                                <span>{String(items.length).padStart(2, '0')}</span>
                            </div>
                            <div className="test-bookmark-list">
                                {items.map((bookmark) => {
                                    const bookmarkIndex = matches.indexOf(bookmark);
                                    return (
                                    <a
                                        key={`${bookmark.url}-${bookmark.title}`}
                                        href={normalizeUrl(bookmark.url)}
                                        data-test-bookmark-index={bookmarkIndex}
                                        className={bookmark === inspected ? 'test-bookmark is-current' : 'test-bookmark'}
                                        onMouseEnter={() => setActiveBookmark(bookmark)}
                                        onFocus={() => setActiveBookmark(bookmark)}
                                    >
                                        <img
                                            src={bookmark.iconUrl || getFaviconUrl(bookmark.url, 64)}
                                            alt=""
                                        />
                                        <span className="test-bookmark-copy">
                                            <strong>{bookmark.title}</strong>
                                            <small>
                                                {bookmark.subsection || bookmark.description || bookmark.product || bookmark.url}
                                            </small>
                                        </span>
                                        <span className="test-bookmark-tail">
                                            {bookmark.tier && (
                                                <em
                                                    className="test-tier"
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
                        <div className="test-no-results">
                            <span>00</span>
                            <h2>No destination found.</h2>
                            <button onClick={() => { setQuery(''); setSection('All'); }}>
                                Reset search
                            </button>
                        </div>
                    )}
                </div>
            </main>

            <aside className="test-inspector" aria-live="polite">
                {inspected && (
                    <div className="test-inspector-inner">
                        <p className="test-kicker">In focus</p>
                        <img
                            src={inspected.iconUrl || getFaviconUrl(inspected.url, 128)}
                            alt=""
                            className="test-inspector-icon"
                        />
                        <h2>{inspected.title}</h2>
                        <p className="test-inspector-url">{new URL(normalizeUrl(inspected.url)).hostname}</p>
                        {(inspected.description || inspected.product) && (
                            <p className="test-inspector-description">
                                {inspected.description || inspected.product}
                            </p>
                        )}
                        <dl>
                            {inspected.subsection && (
                                <div className="test-meta-row">
                                    <dt>Group</dt><dd>{inspected.subsection}</dd>
                                </div>
                            )}
                            {inspected.tier && (
                                <div className="test-meta-row">
                                    <dt>Tier</dt>
                                    <dd>
                                        <span
                                            className="test-tier"
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
                        <a href={normalizeUrl(inspected.url)} className="test-open-link">
                            Open destination <span>↗</span>
                        </a>
                    </div>
                )}
            </aside>
        </div>
    );
}

export default TestPage;
