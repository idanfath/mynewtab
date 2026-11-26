import type { AppError, UndoState } from './useBookmarks.ts';
import type { ExternalSyncConflict } from './storageSync.ts';

export function ErrorNotice({
  error,
  onDismiss,
  action,
  className = '',
}: {
  error: AppError;
  onDismiss: () => void;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={`app-error-notice ${className}`.trim()} role="alert">
      <div>
        <strong>{error.title}</strong>
        <p>{error.detail}</p>
        {action && (
          <button
            type="button"
            className="app-error-notice-action"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="app-error-notice-dismiss"
        aria-label="Dismiss error"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}

export function ExternalConflictBanner({
  conflict,
  onLoadExternal,
  onSaveMine,
  saveMineLabel = 'Save mine',
  className = '',
}: {
  conflict: ExternalSyncConflict;
  onLoadExternal: () => void;
  onSaveMine?: () => void;
  saveMineLabel?: string;
  className?: string;
}) {
  const { added, changed, removed } = conflict.summary;
  const parts: string[] = [];
  if (added > 0) parts.push(`+${added} added`);
  if (changed > 0) parts.push(`~${changed} changed`);
  if (removed > 0) parts.push(`-${removed} removed`);
  const summaryText = parts.length > 0 ? parts.join(' · ') : 'Order changed';

  return (
    <div
      className={`app-conflict-banner ${className}`.trim()}
      role="alert"
    >
      <div className="app-conflict-copy">
        <strong>Bookmarks changed in another tab</strong>
        <p>{summaryText}. Load the latest version or overwrite (external version will be backed up to History).</p>
      </div>
      <div className="app-conflict-actions">
        <button type="button" onClick={onLoadExternal}>
          Load external changes
        </button>
        {onSaveMine && (
          <button type="button" className="is-primary" onClick={onSaveMine}>
            {saveMineLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function UndoNotice({ undo, onUndo }: { undo: UndoState; onUndo: () => void }) {
  return (
    <div className="app-undo-toast" role="status">
      <div>
        <strong>{undo.title}</strong>
        <small>{undo.detail}</small>
      </div>
      <button type="button" onClick={onUndo}>Undo</button>
    </div>
  );
}

export function MetaList({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null;
  return (
    <div className="app-meta-row">
      <dt>{label}</dt>
      <dd>{values.join(' · ')}</dd>
    </div>
  );
}
