import { useRef, useState, type FormEvent } from 'react';
import { normalizeAlias, normalizeSearchUrl, normalizeUrl } from './lib.ts';
import {
  getBookmarkShortcuts,
  type Bookmark,
  type BookmarkShortcut,
} from './bookmarks.ts';
import type { ExternalSyncConflict } from './storageSync.ts';
import { ExternalConflictBanner } from './notices.tsx';
import { focusConflictBanner, trapDialogTabKey } from './dialogFocus.ts';

interface ShortcutRowDraft {
  id: number;
  alias: string;
  queryUrl: string;
}

interface BookmarkDialogProps {
  bookmark?: Bookmark;
  initialSection: string;
  sections: string[];
  conflict: ExternalSyncConflict | null;
  onLoadExternal: () => void;
  onCancel: () => void;
  onSave: (
    bookmark: Bookmark,
    options?: { overwriteExternalConflict?: boolean },
  ) => string | null;
}

function buildInitialShortcutRows(bookmark?: Bookmark): ShortcutRowDraft[] {
  if (!bookmark) return [];
  const existing = getBookmarkShortcuts(bookmark);
  if (existing.length > 0) {
    return existing.map((shortcut, index) => ({
      id: index + 1,
      alias: shortcut.alias,
      queryUrl: shortcut.queryUrl ?? '',
    }));
  }
  const orphanSearch = bookmark.searchUrl?.trim() ?? '';
  if (orphanSearch) {
    return [{ id: 1, alias: '', queryUrl: orphanSearch }];
  }
  return [];
}

function splitList(value: string): string[] | undefined {
  const values = value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function setOptionalString(
  bookmark: Bookmark,
  field: 'subsection' | 'description' | 'tier' | 'product',
  value: string,
) {
  const cleaned = value.trim();
  if (cleaned) bookmark[field] = cleaned;
  else delete bookmark[field];
}

function setOptionalList(
  bookmark: Bookmark,
  field: 'categories' | 'capabilities' | 'pros' | 'cons' | 'formats',
  value: string,
) {
  const cleaned = splitList(value);
  if (cleaned) bookmark[field] = cleaned;
  else delete bookmark[field];
}

export default function BookmarkDialog({
  bookmark,
  initialSection,
  sections,
  conflict,
  onLoadExternal,
  onCancel,
  onSave,
}: BookmarkDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const addShortcutButtonRef = useRef<HTMLButtonElement>(null);
  const shortcutInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [url, setUrl] = useState(bookmark?.url ?? '');
  const [section, setSection] = useState(bookmark?.section ?? initialSection);
  const [subsection, setSubsection] = useState(bookmark?.subsection ?? '');
  const [shortcutRows, setShortcutRows] = useState<ShortcutRowDraft[]>(() =>
    buildInitialShortcutRows(bookmark),
  );
  const nextShortcutIdRef = useRef(shortcutRows.length + 1);
  const [description, setDescription] = useState(bookmark?.description ?? '');
  const [iconUrl, setIconUrl] = useState(bookmark?.iconUrl ?? '');
  const [tier, setTier] = useState(bookmark?.tier ?? '');
  const [product, setProduct] = useState(bookmark?.product ?? '');
  const [categories, setCategories] = useState(bookmark?.categories?.join(', ') ?? '');
  const [capabilities, setCapabilities] = useState(bookmark?.capabilities?.join(', ') ?? '');
  const [formats, setFormats] = useState(bookmark?.formats?.join(', ') ?? '');
  const [pros, setPros] = useState(bookmark?.pros?.join(', ') ?? '');
  const [cons, setCons] = useState(bookmark?.cons?.join(', ') ?? '');
  const [error, setError] = useState('');

  const addShortcutRow = () => {
    const id = nextShortcutIdRef.current;
    nextShortcutIdRef.current += 1;
    setShortcutRows((rows) => [...rows, { id, alias: '', queryUrl: '' }]);
    setError('');
    window.requestAnimationFrame(() => {
      shortcutInputRefs.current.get(id)?.focus();
    });
  };

  const updateShortcutRow = (
    id: number,
    field: 'alias' | 'queryUrl',
    value: string,
  ) => {
    setShortcutRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeShortcutRow = (id: number) => {
    const removeIdx = shortcutRows.findIndex((row) => row.id === id);
    const nextRows = shortcutRows.filter((row) => row.id !== id);
    setShortcutRows(nextRows);
    setError('');
    window.requestAnimationFrame(() => {
      const targetRow = nextRows[removeIdx] ?? nextRows[removeIdx - 1];
      if (targetRow) {
        shortcutInputRefs.current.get(targetRow.id)?.focus();
      } else {
        (addShortcutButtonRef.current ?? dialogRef.current)?.focus();
      }
    });
  };

  const buildValidatedBookmark = (): Bookmark | null => {
    const cleanedTitle = title.trim();
    const cleanedUrl = url.trim();
    const cleanedSection = section.trim();

    if (!cleanedTitle) {
      setError('Add a bookmark title.');
      return null;
    }
    if (!normalizeUrl(cleanedUrl)) {
      setError('Enter a valid http:// or https:// address.');
      return null;
    }
    if (!cleanedSection) {
      setError('Choose or enter a section.');
      return null;
    }
    if (cleanedSection.toLocaleLowerCase() === 'all') {
      setError('“All” is reserved for the complete directory.');
      return null;
    }

    const cleanedIcon = iconUrl.trim();
    let normalizedIcon = '';
    if (cleanedIcon) {
      normalizedIcon = normalizeUrl(cleanedIcon);
      if (!normalizedIcon) {
        setError('Icon URL must use http:// or https://.');
        return null;
      }
    }

    const validatedShortcuts: BookmarkShortcut[] = [];
    const seenAliases = new Set<string>();
    for (const row of shortcutRows) {
      const cleanedAlias = row.alias.trim();
      const cleanedQueryUrl = row.queryUrl.trim();
      if (!cleanedAlias && !cleanedQueryUrl) continue;

      if (!cleanedAlias && cleanedQueryUrl) {
        setError('Add a shortcut (!bang) to use a query URL.');
        return null;
      }

      const normalizedAlias = normalizeAlias(cleanedAlias);
      if (!normalizedAlias) {
        setError(
          'Shortcut must be 1–32 letters, numbers, or hyphens (e.g. gh or my-docs).',
        );
        return null;
      }
      if (seenAliases.has(normalizedAlias)) {
        setError(`Duplicate shortcut “!${normalizedAlias}” on this bookmark.`);
        return null;
      }

      let normalizedQueryUrl = '';
      if (cleanedQueryUrl) {
        normalizedQueryUrl = normalizeSearchUrl(cleanedQueryUrl);
        if (!normalizedQueryUrl) {
          setError(
            'Query URL must be a valid http:// or https:// address containing %s.',
          );
          return null;
        }
      }

      seenAliases.add(normalizedAlias);
      validatedShortcuts.push(
        normalizedQueryUrl
          ? { alias: normalizedAlias, queryUrl: normalizedQueryUrl }
          : { alias: normalizedAlias },
      );
    }

    const resolvedSection = sections.find(
      (name) => name.toLocaleLowerCase() === cleanedSection.toLocaleLowerCase(),
    ) ?? cleanedSection;

    const nextBookmark: Bookmark = {
      ...bookmark,
      title: cleanedTitle,
      url: cleanedUrl,
      section: resolvedSection,
    };
    delete nextBookmark.alias;
    delete nextBookmark.searchUrl;
    if (validatedShortcuts.length > 0) {
      nextBookmark.shortcuts = validatedShortcuts;
    } else {
      delete nextBookmark.shortcuts;
    }

    setOptionalString(nextBookmark, 'subsection', subsection);
    setOptionalString(nextBookmark, 'description', description);
    if (normalizedIcon) {
      nextBookmark.iconUrl = normalizedIcon;
    } else {
      delete nextBookmark.iconUrl;
    }
    setOptionalString(nextBookmark, 'tier', tier);
    setOptionalString(nextBookmark, 'product', product);
    setOptionalList(nextBookmark, 'categories', categories);
    setOptionalList(nextBookmark, 'capabilities', capabilities);
    setOptionalList(nextBookmark, 'formats', formats);
    setOptionalList(nextBookmark, 'pros', pros);
    setOptionalList(nextBookmark, 'cons', cons);

    return nextBookmark;
  };

  const commitSave = (overwriteExternalConflict: boolean) => {
    const nextBookmark = buildValidatedBookmark();
    if (!nextBookmark) return;
    const saveError = onSave(nextBookmark, { overwriteExternalConflict });
    if (saveError) setError(saveError);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (conflict) {
      focusConflictBanner(dialogRef.current);
      setError('Resolve the external tab conflict above first.');
      return;
    }
    commitSave(false);
  };

  return (
    <div
      className="app-form-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="app-form-dialog app-bookmark-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-bookmark-dialog-title"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === 'Enter' && conflict !== null) {
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (!target || !target.closest('.app-conflict-banner, button, textarea, summary')) {
              event.preventDefault();
              focusConflictBanner(dialogRef.current);
              setError('Resolve the external tab conflict above first.');
              return;
            }
          }
          trapDialogTabKey(event, dialogRef.current);
        }}
      >
        <form onSubmit={submit}>
          <header>
            <div>
              <p className="app-kicker">Directory entry</p>
              <h2 id="app-bookmark-dialog-title">
                {bookmark ? 'Edit bookmark' : 'Add bookmark'}
              </h2>
            </div>
            <button type="button" className="app-form-close" onClick={onCancel}>
              Cancel
            </button>
          </header>

          {conflict && (
            <ExternalConflictBanner
              conflict={conflict}
              onLoadExternal={() => {
                setError('');
                onLoadExternal();
              }}
              onSaveMine={() => {
                setError('');
                commitSave(true);
              }}
            />
          )}

          <div className="app-form-body">
            <div className="app-form-grid">
              <label>
                <span>Title</span>
                <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                <span>URL</span>
                <input
                  inputMode="url"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label>
                <span>Section</span>
                <input
                  list="app-bookmark-sections"
                  value={section}
                  onChange={(event) => setSection(event.target.value)}
                />
                <datalist id="app-bookmark-sections">
                  {sections.map((name) => <option key={name} value={name} />)}
                </datalist>
                <small>Choose an existing section or type a new name.</small>
              </label>
              <label>
                <span>Group</span>
                <input value={subsection} onChange={(event) => setSubsection(event.target.value)} />
              </label>
              <label className="is-wide">
                <span>Description</span>
                <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
            </div>

            <div className="app-shortcut-section">
              <div className="app-bang-section-header">
                <div>
                  <span className="app-bang-section-label">Shortcuts (!bangs)</span>
                  <p className="app-bang-section-hint">
                    Optional — use <code>%s</code> in Query URL for query or prompt.
                  </p>
                </div>
                <button
                  ref={addShortcutButtonRef}
                  type="button"
                  className="app-bang-add-button"
                  onClick={addShortcutRow}
                >
                  {shortcutRows.length === 0 ? '+ Add shortcut' : '+ Add another shortcut'}
                </button>
              </div>

              {shortcutRows.length > 0 && (
                <div className="app-shortcut-list">
                  {shortcutRows.map((row, index) => (
                    <div key={row.id} className="app-shortcut-row">
                      <input
                        ref={(el) => {
                          if (el) shortcutInputRefs.current.set(row.id, el);
                          else shortcutInputRefs.current.delete(row.id);
                        }}
                        aria-label={`Shortcut ${index + 1} trigger`}
                        placeholder="gh"
                        value={row.alias}
                        onChange={(event) =>
                          updateShortcutRow(row.id, 'alias', event.target.value)}
                      />
                      <input
                        aria-label={`Shortcut ${index + 1} query URL`}
                        inputMode="url"
                        placeholder="https://example.com/search?q=%s"
                        value={row.queryUrl}
                        onChange={(event) =>
                          updateShortcutRow(row.id, 'queryUrl', event.target.value)}
                      />
                      <button
                        type="button"
                        className="app-bang-remove-button"
                        aria-label={`Remove ${row.alias.trim() || `shortcut ${index + 1}`}`}
                        onClick={() => removeShortcutRow(row.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <details className="app-form-details">
              <summary>More details</summary>
              <div className="app-form-grid">
                <label>
                  <span>Product</span>
                  <input value={product} onChange={(event) => setProduct(event.target.value)} />
                </label>
                <label>
                  <span>Tier</span>
                  <input value={tier} onChange={(event) => setTier(event.target.value)} />
                </label>
                <label className="is-wide">
                  <span>Icon URL</span>
                  <input inputMode="url" value={iconUrl} onChange={(event) => setIconUrl(event.target.value)} />
                </label>
                <label>
                  <span>Categories</span>
                  <textarea rows={2} value={categories} onChange={(event) => setCategories(event.target.value)} />
                </label>
                <label>
                  <span>Capabilities</span>
                  <textarea rows={2} value={capabilities} onChange={(event) => setCapabilities(event.target.value)} />
                </label>
                <label>
                  <span>Formats</span>
                  <textarea rows={2} value={formats} onChange={(event) => setFormats(event.target.value)} />
                </label>
                <label>
                  <span>Pros</span>
                  <textarea rows={2} value={pros} onChange={(event) => setPros(event.target.value)} />
                </label>
                <label className="is-wide">
                  <span>Cons</span>
                  <textarea rows={2} value={cons} onChange={(event) => setCons(event.target.value)} />
                </label>
              </div>
              <p className="app-form-hint">Separate list values with commas or new lines.</p>
            </details>

            {error && <p className="app-form-error" role="alert">{error}</p>}
          </div>

          <footer>
            <button type="submit" className="is-primary" disabled={conflict !== null}>
              {bookmark ? 'Save changes' : 'Add bookmark'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
