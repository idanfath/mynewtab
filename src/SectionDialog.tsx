import { useRef, useState, type FormEvent } from 'react';
import type { ExternalSyncConflict } from './storageSync.ts';
import { ExternalConflictBanner } from './notices.tsx';
import { focusConflictBanner, trapDialogTabKey } from './dialogFocus.ts';

interface SectionDialogProps {
  mode: 'rename' | 'delete';
  section: string;
  count: number;
  otherSections: string[];
  conflict: ExternalSyncConflict | null;
  onLoadExternal: () => void;
  onCancel: () => void;
  onRename: (
    name: string,
    options?: { overwriteExternalConflict?: boolean },
  ) => string | null;
  onDelete: (
    strategy: 'move' | 'delete',
    destination?: string,
    options?: { overwriteExternalConflict?: boolean },
  ) => string | null;
}

export default function SectionDialog({
  mode,
  section,
  count,
  otherSections,
  conflict,
  onLoadExternal,
  onCancel,
  onRename,
  onDelete,
}: SectionDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [name, setName] = useState(section);
  const [strategy, setStrategy] = useState<'move' | 'delete'>(
    otherSections.length ? 'move' : 'delete',
  );
  const [destination, setDestination] = useState(otherSections[0] ?? '');
  const [error, setError] = useState('');

  const effectiveStrategy: 'move' | 'delete' = otherSections.length === 0
    ? 'delete'
    : strategy;
  const effectiveDestination = otherSections.includes(destination)
    ? destination
    : (otherSections[0] ?? '');

  const commitAction = (overwriteExternalConflict: boolean) => {
    const actionError = mode === 'rename'
      ? onRename(name.trim(), { overwriteExternalConflict })
      : onDelete(effectiveStrategy, effectiveDestination, { overwriteExternalConflict });
    if (actionError) setError(actionError);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (conflict) {
      focusConflictBanner(dialogRef.current);
      setError('Resolve the external tab conflict above first.');
      return;
    }
    commitAction(false);
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
        className="app-form-dialog app-section-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-section-dialog-title"
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
              <p className="app-kicker">Directory section</p>
              <h2 id="app-section-dialog-title">
                {mode === 'rename' ? 'Rename section' : 'Remove section'}
              </h2>
            </div>
            <button type="button" className="app-form-close" onClick={onCancel}>Cancel</button>
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
                commitAction(true);
              }}
            />
          )}

          <div className="app-form-body">
            {mode === 'rename' ? (
              <label className="app-form-field">
                <span>Section name</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            ) : (
              <fieldset className="app-section-choices">
                <legend>What should happen to {count} bookmark{count === 1 ? '' : 's'}?</legend>
                {otherSections.length > 0 && (
                  <label>
                    <input
                      type="radio"
                      name="section-action"
                      autoFocus={otherSections.length > 0}
                      checked={effectiveStrategy === 'move'}
                      onChange={() => setStrategy('move')}
                    />
                    <span>Move them to</span>
                    <select
                      value={effectiveDestination}
                      disabled={effectiveStrategy !== 'move'}
                      onChange={(event) => setDestination(event.target.value)}
                    >
                      {otherSections.map((sectionName) => (
                        <option key={sectionName} value={sectionName}>{sectionName}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  <input
                    type="radio"
                    name="section-action"
                    autoFocus={otherSections.length === 0}
                    checked={effectiveStrategy === 'delete'}
                    onChange={() => setStrategy('delete')}
                  />
                  <span>Delete every bookmark in “{section}”</span>
                </label>
              </fieldset>
            )}

            {error && <p className="app-form-error" role="alert">{error}</p>}
          </div>

          <footer>
            <button
              type="submit"
              className={mode === 'delete' && effectiveStrategy === 'delete' ? 'is-danger' : 'is-primary'}
              disabled={conflict !== null}
            >
              {mode === 'rename'
                ? 'Rename section'
                : effectiveStrategy === 'move' ? 'Move and remove' : 'Delete section'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
