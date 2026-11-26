import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { Bookmark } from './bookmarks.ts';
import type { BookmarkFileFormat } from './bookmarkHtml.ts';
import {
  previewBookmarkMerge,
  type BookmarkField,
  type MergeStrategy,
} from './bookmarkMerge.ts';
import type { ExternalSyncConflict } from './storageSync.ts';
import { ExternalConflictBanner } from './notices.tsx';
import { focusConflictBanner, trapDialogTabKey } from './dialogFocus.ts';

interface ImportMergeDialogProps {
  fileName: string;
  format: BookmarkFileFormat;
  existingBookmarks: Bookmark[];
  incomingBookmarks: Bookmark[];
  skippedNonHttpCount: number;
  intraFileDuplicateCount: number;
  pendingSettingsFileName?: string;
  conflict: ExternalSyncConflict | null;
  onLoadExternal: () => void;
  onCancel: () => void;
  onCommit: (
    strategy: MergeStrategy,
    options?: { overwriteExternalConflict?: boolean },
  ) => string | null;
}

const PREVIEW_ROW_LIMIT = 150;

const FIELD_LABELS: Record<BookmarkField, string> = {
  title: 'title',
  url: 'URL',
  section: 'section',
  shortcuts: 'shortcuts',
  searchUrl: 'query URL',
  subsection: 'group',
  description: 'description',
  iconUrl: 'icon',
  tier: 'tier',
  product: 'product',
  categories: 'categories',
  capabilities: 'capabilities',
  formats: 'formats',
  pros: 'pros',
  cons: 'cons',
};

const STRATEGY_OPTIONS: ReadonlyArray<{
  value: MergeStrategy;
  label: string;
  description: string;
}> = [
  {
    value: 'merge',
    label: 'Merge & Enrich',
    description: 'Keep existing bookmarks and order, fill missing metadata on matches, and add new URLs.',
  },
  {
    value: 'append',
    label: 'Add New Only',
    description: 'Insert new URLs only. Leave existing bookmarks untouched.',
  },
  {
    value: 'replace',
    label: 'Replace Directory',
    description: 'Overwrite directory with imported file. Current bookmarks are saved to History first.',
  },
];

export default function ImportMergeDialog({
  fileName,
  format,
  existingBookmarks,
  incomingBookmarks,
  skippedNonHttpCount,
  intraFileDuplicateCount,
  pendingSettingsFileName,
  conflict,
  onLoadExternal,
  onCancel,
  onCommit,
}: ImportMergeDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [strategy, setStrategy] = useState<MergeStrategy>('merge');
  const [error, setError] = useState('');

  const preview = useMemo(
    () => previewBookmarkMerge(existingBookmarks, incomingBookmarks, strategy),
    [existingBookmarks, incomingBookmarks, strategy],
  );

  const hasAnyEffectiveChanges = preview.hasEffectiveChanges || Boolean(pendingSettingsFileName);
  const visibleRows = preview.affectedRows.slice(0, PREVIEW_ROW_LIMIT);
  const hiddenRowCount = Math.max(0, preview.affectedRows.length - visibleRows.length);

  const commit = (overwriteExternalConflict: boolean) => {
    if (!hasAnyEffectiveChanges) {
      onCancel();
      return;
    }
    const commitError = onCommit(strategy, { overwriteExternalConflict });
    if (commitError) setError(commitError);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (conflict && hasAnyEffectiveChanges) {
      focusConflictBanner(dialogRef.current);
      setError('Resolve the external tab conflict above first.');
      return;
    }
    commit(false);
  };

  const submitLabel = !hasAnyEffectiveChanges
    ? 'Close (no changes)'
    : !preview.hasEffectiveChanges && pendingSettingsFileName
      ? 'Import search settings'
      : strategy === 'merge'
        ? 'Merge bookmarks'
        : strategy === 'append'
          ? `Add ${preview.addedCount} new`
          : 'Replace directory';

  const submitClass = !preview.hasEffectiveChanges || strategy !== 'replace'
    ? 'is-primary'
    : 'is-danger';

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
        className="app-form-dialog app-merge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-merge-dialog-title"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === 'Enter' && conflict !== null && hasAnyEffectiveChanges) {
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
        <form onSubmit={handleSubmit}>
          <header>
            <div className="app-merge-header-copy">
              <p className="app-kicker">Import studio</p>
              <h2 id="app-merge-dialog-title">Review bookmark import</h2>
              <div className="app-merge-source">
                <span className="app-merge-format-pill">{format.toUpperCase()}</span>
                <code>{fileName}</code>
                <span className="app-merge-source-meta">
                  {incomingBookmarks.length} item{incomingBookmarks.length === 1 ? '' : 's'}
                  {intraFileDuplicateCount > 0
                    ? ` · ${intraFileDuplicateCount} duplicate${intraFileDuplicateCount === 1 ? '' : 's'} merged`
                    : ''}
                  {skippedNonHttpCount > 0
                    ? ` · ${skippedNonHttpCount} non-web skipped`
                    : ''}
                </span>
              </div>
              {pendingSettingsFileName && (
                <div className="app-merge-source app-merge-settings-companion">
                  <span className="app-merge-format-pill">SETTINGS</span>
                  <code>{pendingSettingsFileName}</code>
                  <span className="app-merge-source-meta">
                    Search settings will also be imported
                  </span>
                </div>
              )}
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
              onSaveMine={hasAnyEffectiveChanges
                ? () => {
                  setError('');
                  commit(true);
                }
                : undefined}
              saveMineLabel="Import anyway"
            />
          )}

          <div className="app-form-body">
            <fieldset className="app-merge-strategies">
              <legend>Import strategy</legend>
              <div className="app-merge-strategy-grid">
                {STRATEGY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`app-merge-strategy-card${strategy === option.value ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="merge-strategy"
                      value={option.value}
                      autoFocus={option.value === 'merge'}
                      checked={strategy === option.value}
                      onChange={() => {
                        setStrategy(option.value);
                        setError('');
                      }}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="app-merge-stats" aria-live="polite">
              <span className="app-diff-badge is-added">+{preview.addedCount} added</span>
              <span className="app-diff-badge is-changed">
                ~{preview.changedCount} {strategy === 'merge' ? 'enriched' : 'modified'}
              </span>
              <span className="app-diff-badge is-unchanged">={preview.unchangedCount} unchanged</span>
              {strategy === 'replace' ? (
                <span className="app-diff-badge is-removed">-{preview.removedCount} removed</span>
              ) : (
                <span className="app-diff-badge is-kept">{preview.localKeptCount} local kept</span>
              )}
              {preview.orderChanged && (
                <span className="app-diff-badge is-changed">Order changed</span>
              )}
            </div>

            <div className="app-merge-preview" tabIndex={0} aria-label="Affected bookmarks preview">
              {!preview.hasEffectiveChanges ? (
                <p className="app-merge-empty">
                  {pendingSettingsFileName
                    ? `Directory already matches under selected strategy. Search settings from “${pendingSettingsFileName}” will still be imported.`
                    : 'Directory already matches this import under selected strategy.'}
                </p>
              ) : preview.orderChanged && visibleRows.length === 0 ? (
                <p className="app-merge-empty">
                  All bookmarks match existing entries, but section or item order will be updated.
                </p>
              ) : (
                <ul className="app-merge-row-list">
                  {visibleRows.map((row, index) => {
                    const symbol = row.kind === 'added'
                      ? '+'
                      : row.kind === 'removed'
                        ? '-'
                        : '~';
                    const fieldSummary = row.changedFields && row.changedFields.length > 0
                      ? row.changedFields.map((field) => FIELD_LABELS[field]).join(', ')
                      : '';
                    return (
                      <li
                        key={`${row.kind}-${row.bookmark.url}-${index}`}
                        className={`app-merge-row is-${row.kind}`}
                      >
                        <span className="app-merge-row-symbol" aria-hidden="true">{symbol}</span>
                        <div className="app-merge-row-main">
                          <strong>{row.bookmark.title}</strong>
                          <small>
                            {row.bookmark.section}
                            {row.bookmark.subsection ? ` / ${row.bookmark.subsection}` : ''}
                            {fieldSummary ? ` · ${fieldSummary}` : ''}
                          </small>
                        </div>
                      </li>
                    );
                  })}
                  {hiddenRowCount > 0 && (
                    <li className="app-merge-row-overflow">
                      …and {hiddenRowCount} more change{hiddenRowCount === 1 ? '' : 's'}
                    </li>
                  )}
                </ul>
              )}
            </div>

            {error && <p className="app-form-error" role="alert">{error}</p>}
          </div>

          <footer>
            <button
              type="submit"
              className={submitClass}
              disabled={conflict !== null && hasAnyEffectiveChanges}
            >
              {submitLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
