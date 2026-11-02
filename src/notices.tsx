import type { AppError, UndoState } from './useBookmarks';

export function ErrorNotice({
  error,
  onDismiss,
  className = '',
}: {
  error: AppError;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div className={`app-error-notice ${className}`.trim()} role="alert">
      <div>
        <strong>{error.title}</strong>
        <p>{error.detail}</p>
      </div>
      <button type="button" aria-label="Dismiss error" onClick={onDismiss}>
        ×
      </button>
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

