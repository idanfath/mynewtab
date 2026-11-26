import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Bookmark } from './bookmarks.ts';
import { normalizeAlias, normalizeSearchUrl } from './lib.ts';
import {
  BUILT_IN_BANGS,
  SEARCH_ENGINE_PRESETS,
  resolvePreservedCustomBangHomeUrl,
  type CustomBang,
  type OmnibarSettings,
  type SearchEnginePresetId,
} from './omnibar.ts';

interface SearchSettingsDialogProps {
  settings: OmnibarSettings;
  bookmarks: Bookmark[];
  onCancel: () => void;
  onSave: (next: OmnibarSettings) => string | null;
}

interface CustomBangDraft {
  id: number;
  trigger: string;
  label: string;
  searchUrl: string;
  initialSearchUrl?: string;
  homeUrl?: string;
}

const PRESET_ORDER: readonly Exclude<SearchEnginePresetId, 'custom'>[] = [
  'duckduckgo',
  'google',
  'brave',
  'kagi',
  'perplexity',
];

export default function SearchSettingsDialog({
  settings,
  bookmarks,
  onCancel,
  onSave,
}: SearchSettingsDialogProps) {
  const [defaultEngine, setDefaultEngine] = useState<SearchEnginePresetId>(
    settings.defaultEngine,
  );
  const [customSearchName, setCustomSearchName] = useState(
    settings.customSearchName ?? '',
  );
  const [customSearchUrl, setCustomSearchUrl] = useState(
    settings.customSearchUrl ?? '',
  );
  const nextIdRef = useRef(settings.customBangs.length + 1);
  const [customBangs, setCustomBangs] = useState<CustomBangDraft[]>(() =>
    settings.customBangs.map((bang, index) => ({
      id: index + 1,
      trigger: bang.trigger,
      label: bang.label,
      searchUrl: bang.searchUrl,
      initialSearchUrl: bang.searchUrl,
      homeUrl: bang.homeUrl,
    })),
  );
  const [disabledBuiltInBangs, setDisabledBuiltInBangs] = useState<Set<string>>(
    () =>
      new Set(
        (settings.disabledBuiltInBangs ?? [])
          .map((trigger) => normalizeAlias(trigger))
          .filter(Boolean),
      ),
  );
  const [error, setError] = useState('');

  const dialogRef = useRef<HTMLElement>(null);
  const addBangButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, []);

  const addRow = () => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setCustomBangs((rows) => [
      ...rows,
      { id, trigger: '', label: '', searchUrl: '' },
    ]);
  };

  const updateRow = (
    id: number,
    field: 'trigger' | 'label' | 'searchUrl',
    value: string,
  ) => {
    setCustomBangs((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const removeRow = (id: number) => {
    setCustomBangs((rows) => rows.filter((row) => row.id !== id));
    window.requestAnimationFrame(() => {
      (addBangButtonRef.current ?? dialogRef.current)?.focus();
    });
  };

  const toggleBuiltInBang = (trigger: string) => {
    setDisabledBuiltInBangs((current) => {
      const next = new Set(current);
      if (next.has(trigger)) next.delete(trigger);
      else next.add(trigger);
      return next;
    });
  };

  const enableAllBuiltInBangs = () => {
    setDisabledBuiltInBangs(new Set());
  };

  const disableAllBuiltInBangs = () => {
    setDisabledBuiltInBangs(new Set(BUILT_IN_BANGS.map((bang) => bang.trigger)));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const next: OmnibarSettings = {
      version: 1,
      defaultEngine,
      customBangs: [],
    };

    const trimmedName = customSearchName.trim();
    if (trimmedName) {
      next.customSearchName = trimmedName;
    }

    const trimmedCustomUrl = customSearchUrl.trim();
    if (defaultEngine === 'custom') {
      const normalizedCustomUrl = normalizeSearchUrl(trimmedCustomUrl);
      if (!normalizedCustomUrl) {
        setError(
          'Custom search URL must be a valid http:// or https:// address containing %s.',
        );
        return;
      }
      next.customSearchUrl = normalizedCustomUrl;
    } else if (trimmedCustomUrl) {
      const normalizedCustomUrl = normalizeSearchUrl(trimmedCustomUrl);
      if (normalizedCustomUrl) {
        next.customSearchUrl = normalizedCustomUrl;
      }
    }

    const seenTriggers = new Set<string>();
    const validatedBangs: CustomBang[] = [];

    for (let i = 0; i < customBangs.length; i += 1) {
      const row = customBangs[i];
      const rawTrigger = row.trigger.trim();
      const rawLabel = row.label.trim();
      const rawSearchUrl = row.searchUrl.trim();

      if (!rawTrigger && !rawLabel && !rawSearchUrl) continue;

      const normalizedTrigger = normalizeAlias(rawTrigger);
      if (!normalizedTrigger) {
        setError(
          `Custom !bang row ${i + 1}: trigger must be 1–32 letters, numbers, or hyphens.`,
        );
        return;
      }
      if (seenTriggers.has(normalizedTrigger)) {
        setError(
          `Duplicate custom !bang trigger “!${normalizedTrigger}”. Each trigger must be unique.`,
        );
        return;
      }
      if (!rawLabel) {
        setError(`Custom !bang “!${normalizedTrigger}” needs a display name.`);
        return;
      }
      const normalizedSearch = normalizeSearchUrl(rawSearchUrl);
      if (!normalizedSearch) {
        setError(
          `Custom !bang “!${normalizedTrigger}” needs a valid http:// or https:// search URL containing %s.`,
        );
        return;
      }

      seenTriggers.add(normalizedTrigger);
      const preservedHome = resolvePreservedCustomBangHomeUrl(
        row.homeUrl,
        row.initialSearchUrl,
        normalizedSearch,
      );
      const entry: CustomBang = {
        trigger: normalizedTrigger,
        label: rawLabel,
        searchUrl: normalizedSearch,
      };
      if (preservedHome) {
        entry.homeUrl = preservedHome;
      }
      validatedBangs.push(entry);
    }

    next.customBangs = validatedBangs;
    const orderedDisabled = BUILT_IN_BANGS
      .map((bang) => bang.trigger)
      .filter((trigger) => disabledBuiltInBangs.has(trigger));
    if (orderedDisabled.length > 0) {
      next.disabledBuiltInBangs = orderedDisabled;
    }
    const saveError = onSave(next);
    if (saveError) setError(saveError);
  };

  const activeCustomTriggers = new Set(
    customBangs
      .map((row) => normalizeAlias(row.trigger))
      .filter(Boolean),
  );
  const enabledBuiltInCount = BUILT_IN_BANGS.reduce(
    (count, bang) => count + (disabledBuiltInBangs.has(bang.trigger) ? 0 : 1),
    0,
  );

  return (
    <div
      className="app-form-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="app-form-dialog app-search-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-search-settings-title"
        tabIndex={-1}
      >
        <form onSubmit={submit}>
          <header>
            <div>
              <p className="app-kicker">Omnibar</p>
              <h2 id="app-search-settings-title">Search settings</h2>
            </div>
            <button type="button" className="app-form-close" onClick={onCancel}>
              Cancel
            </button>
          </header>

          <div className="app-form-body">
            <div className="app-form-grid">
              <label className="is-wide">
                <span>Default search engine</span>
                <select
                  autoFocus
                  value={defaultEngine}
                  onChange={(event) =>
                    setDefaultEngine(event.target.value as SearchEnginePresetId)}
                >
                  {PRESET_ORDER.map((id) => (
                    <option key={id} value={id}>
                      {SEARCH_ENGINE_PRESETS[id].label}
                    </option>
                  ))}
                  <option value="custom">Custom search URL</option>
                </select>
                <small>
                  Used for web search fallback and Shift+Enter in the omnibar.
                </small>
              </label>

              {defaultEngine === 'custom' && (
                <>
                  <label>
                    <span>Engine name</span>
                    <input
                      placeholder="Startpage"
                      value={customSearchName}
                      onChange={(event) => setCustomSearchName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Search URL (%s)</span>
                    <input
                      inputMode="url"
                      placeholder="https://www.startpage.com/sp/search?query=%s"
                      value={customSearchUrl}
                      onChange={(event) => setCustomSearchUrl(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>

            <div className="app-bang-section">
              <div className="app-bang-section-header">
                <div>
                  <span className="app-bang-section-label">Custom !bangs</span>
                  <p className="app-bang-section-hint">
                    Type <code>!trigger query</code> or <code>trigger query</code> in the omnibar.
                  </p>
                </div>
                <button
                  ref={addBangButtonRef}
                  type="button"
                  className="app-bang-add-button"
                  onClick={addRow}
                >
                  + Add !bang
                </button>
              </div>

              {customBangs.length > 0 ? (
                <div className="app-bang-list">
                  {customBangs.map((row) => {
                    const rowTrigger = normalizeAlias(row.trigger);
                    const shadowBookmark = rowTrigger
                      ? bookmarks.find(
                          (b) =>
                            normalizeAlias(b.alias ?? '') === rowTrigger
                            && Boolean(normalizeSearchUrl(b.searchUrl ?? '')),
                        )
                      : undefined;
                    const jumpShadowBookmark = rowTrigger && !shadowBookmark
                      ? bookmarks.find(
                          (b) => normalizeAlias(b.alias ?? '') === rowTrigger,
                        )
                      : undefined;

                    return (
                      <div key={row.id} className="app-bang-item">
                        <div className="app-bang-row">
                          <input
                            aria-label="Trigger"
                            placeholder="docs"
                            value={row.trigger}
                            onChange={(event) =>
                              updateRow(row.id, 'trigger', event.target.value)}
                          />
                          <input
                            aria-label="Display name"
                            placeholder="Company Docs"
                            value={row.label}
                            onChange={(event) =>
                              updateRow(row.id, 'label', event.target.value)}
                          />
                          <input
                            aria-label="Search URL"
                            inputMode="url"
                            placeholder="https://docs.example.com/search?q=%s"
                            value={row.searchUrl}
                            onChange={(event) =>
                              updateRow(row.id, 'searchUrl', event.target.value)}
                          />
                          <button
                            type="button"
                            className="app-bang-remove-button"
                            aria-label={`Remove ${row.trigger || 'custom bang'}`}
                            onClick={() => removeRow(row.id)}
                          >
                            Remove
                          </button>
                        </div>
                        {shadowBookmark && (
                          <p className="app-bang-shadow-note">
                            Shadowed by bookmark “{shadowBookmark.title}” (!{rowTrigger} uses its site search URL).
                          </p>
                        )}
                        {jumpShadowBookmark && (
                          <p className="app-bang-shadow-note">
                            Note: bare !{rowTrigger} opens bookmark “{jumpShadowBookmark.title}”; !{rowTrigger} &lt;query&gt; uses this !bang.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="app-form-hint">
                  No custom !bangs yet. Bookmarks with a shortcut and site search URL also act as !bangs.
                </p>
              )}
            </div>

            <details className="app-form-details" open>
              <summary>
                Built-in !bangs ({enabledBuiltInCount}/{BUILT_IN_BANGS.length} enabled)
              </summary>
              <div className="app-builtin-bangs-header">
                <p className="app-bang-section-hint">
                  Toggle individual built-in shortcuts on or off. Active custom !bangs and bookmark shortcuts still take priority.
                </p>
                <div className="app-builtin-bangs-actions">
                  <button
                    type="button"
                    className="app-bang-bulk-button"
                    disabled={disabledBuiltInBangs.size === 0}
                    onClick={enableAllBuiltInBangs}
                  >
                    Enable all
                  </button>
                  <button
                    type="button"
                    className="app-bang-bulk-button"
                    disabled={disabledBuiltInBangs.size === BUILT_IN_BANGS.length}
                    onClick={disableAllBuiltInBangs}
                  >
                    Disable all
                  </button>
                </div>
              </div>
              <div className="app-builtin-bangs">
                {BUILT_IN_BANGS.map((bang) => {
                  const isEnabled = !disabledBuiltInBangs.has(bang.trigger);
                  const bookmarkSearchOverride = bookmarks.find(
                    (b) =>
                      normalizeAlias(b.alias ?? '') === bang.trigger
                      && Boolean(normalizeSearchUrl(b.searchUrl ?? '')),
                  );
                  const bookmarkJumpOverride = !bookmarkSearchOverride
                    ? bookmarks.find(
                        (b) => normalizeAlias(b.alias ?? '') === bang.trigger,
                      )
                    : undefined;
                  const customOverride = activeCustomTriggers.has(bang.trigger);

                  let statusNote = '';
                  if (!isEnabled) {
                    if (bookmarkSearchOverride) {
                      statusNote = `Built-in off · bookmark “${bookmarkSearchOverride.title}” active`;
                    } else if (customOverride) {
                      statusNote = 'Built-in off · custom !bang active';
                    } else if (bookmarkJumpOverride) {
                      statusNote = `Built-in off · bookmark “${bookmarkJumpOverride.title}” active`;
                    } else {
                      statusNote = 'Disabled';
                    }
                  } else if (bookmarkSearchOverride) {
                    statusNote = `Overridden by bookmark “${bookmarkSearchOverride.title}”`;
                  } else if (customOverride) {
                    statusNote = 'Overridden by custom !bang';
                  } else if (bookmarkJumpOverride) {
                    statusNote = `Bookmark “${bookmarkJumpOverride.title}”`;
                  }

                  return (
                    <label
                      key={bang.trigger}
                      className={`app-builtin-bang-row${!isEnabled ? ' is-disabled' : ''}`}
                    >
                      <span className="app-builtin-bang-main">
                        <input
                          type="checkbox"
                          role="switch"
                          checked={isEnabled}
                          aria-label={`Enable !${bang.trigger} (${bang.label})`}
                          onChange={() => toggleBuiltInBang(bang.trigger)}
                        />
                        <span className="app-bang-toggle" aria-hidden="true" />
                        <code>!{bang.trigger}</code>
                        <span>{bang.label}</span>
                      </span>
                      {statusNote && <small>{statusNote}</small>}
                    </label>
                  );
                })}
              </div>
            </details>

            {error && (
              <p className="app-form-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <footer>
            <button type="submit" className="is-primary">
              Save settings
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
