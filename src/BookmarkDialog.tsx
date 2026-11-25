import { useState, type FormEvent } from 'react';
import { normalizeAlias, normalizeSearchUrl, normalizeUrl } from './lib.ts';
import type { Bookmark } from './bookmarks.ts';

interface BookmarkDialogProps {
  bookmark?: Bookmark;
  initialSection: string;
  sections: string[];
  onCancel: () => void;
  onSave: (bookmark: Bookmark) => string | null;
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
  field: 'subsection' | 'description' | 'iconUrl' | 'tier' | 'product',
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
  onCancel,
  onSave,
}: BookmarkDialogProps) {
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [url, setUrl] = useState(bookmark?.url ?? '');
  const [section, setSection] = useState(bookmark?.section ?? initialSection);
  const [subsection, setSubsection] = useState(bookmark?.subsection ?? '');
  const [alias, setAlias] = useState(bookmark?.alias ?? '');
  const [searchUrl, setSearchUrl] = useState(bookmark?.searchUrl ?? '');
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanedTitle = title.trim();
    const cleanedUrl = url.trim();
    const cleanedSection = section.trim();

    if (!cleanedTitle) {
      setError('Add a bookmark title.');
      return;
    }
    if (!normalizeUrl(cleanedUrl)) {
      setError('Enter a valid http:// or https:// address.');
      return;
    }
    if (!cleanedSection) {
      setError('Choose or enter a section.');
      return;
    }
    if (cleanedSection.toLocaleLowerCase() === 'all') {
      setError('“All” is reserved for the complete directory.');
      return;
    }
    if (iconUrl.trim() && !normalizeUrl(iconUrl)) {
      setError('Icon URL must use http:// or https://.');
      return;
    }

    const cleanedAlias = alias.trim();
    const cleanedSearchUrl = searchUrl.trim();
    const normalizedAlias = cleanedAlias ? normalizeAlias(cleanedAlias) : '';
    const normalizedSearchUrl = cleanedSearchUrl ? normalizeSearchUrl(cleanedSearchUrl) : '';

    if (cleanedAlias && !normalizedAlias) {
      setError('Shortcut must be 1–32 letters, numbers, or hyphens (e.g. gh or my-docs).');
      return;
    }
    if (cleanedSearchUrl && !normalizedSearchUrl) {
      setError('Site search URL must be a valid http:// or https:// address containing %s.');
      return;
    }
    if (normalizedSearchUrl && !normalizedAlias) {
      setError('Add a shortcut (!bang) to use a site search URL.');
      return;
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
    if (normalizedAlias) nextBookmark.alias = normalizedAlias;
    else delete nextBookmark.alias;

    if (normalizedSearchUrl) nextBookmark.searchUrl = normalizedSearchUrl;
    else delete nextBookmark.searchUrl;

    setOptionalString(nextBookmark, 'subsection', subsection);
    setOptionalString(nextBookmark, 'description', description);
    setOptionalString(nextBookmark, 'iconUrl', iconUrl);
    setOptionalString(nextBookmark, 'tier', tier);
    setOptionalString(nextBookmark, 'product', product);
    setOptionalList(nextBookmark, 'categories', categories);
    setOptionalList(nextBookmark, 'capabilities', capabilities);
    setOptionalList(nextBookmark, 'formats', formats);
    setOptionalList(nextBookmark, 'pros', pros);
    setOptionalList(nextBookmark, 'cons', cons);

    const saveError = onSave(nextBookmark);
    if (saveError) setError(saveError);
  };

  return (
    <div
      className="app-form-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="app-form-dialog app-bookmark-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-bookmark-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
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
              <label>
                <span>Shortcut (!bang)</span>
                <input
                  placeholder="gh"
                  value={alias}
                  onChange={(event) => setAlias(event.target.value)}
                />
                <small>Optional jump &amp; search token (e.g. gh).</small>
              </label>
              <label>
                <span>Site search URL</span>
                <input
                  inputMode="url"
                  placeholder="https://example.com/search?q=%s"
                  value={searchUrl}
                  onChange={(event) => setSearchUrl(event.target.value)}
                />
                <small>Optional — include %s for query (requires shortcut).</small>
              </label>
              <label className="is-wide">
                <span>Description</span>
                <textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
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
            <button type="submit" className="is-primary">
              {bookmark ? 'Save changes' : 'Add bookmark'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
