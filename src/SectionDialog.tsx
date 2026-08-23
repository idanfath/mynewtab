import { useState, type FormEvent } from 'react';

interface SectionDialogProps {
  mode: 'rename' | 'delete';
  section: string;
  count: number;
  otherSections: string[];
  onCancel: () => void;
  onRename: (name: string) => string | null;
  onDelete: (strategy: 'move' | 'delete', destination?: string) => string | null;
}

export default function SectionDialog({
  mode,
  section,
  count,
  otherSections,
  onCancel,
  onRename,
  onDelete,
}: SectionDialogProps) {
  const [name, setName] = useState(section);
  const [strategy, setStrategy] = useState<'move' | 'delete'>(
    otherSections.length ? 'move' : 'delete',
  );
  const [destination, setDestination] = useState(otherSections[0] ?? '');
  const [error, setError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const actionError = mode === 'rename'
      ? onRename(name.trim())
      : onDelete(strategy, destination);
    if (actionError) setError(actionError);
  };

  return (
    <div
      className="app-form-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="app-form-dialog app-section-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-section-dialog-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
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
                      checked={strategy === 'move'}
                      onChange={() => setStrategy('move')}
                    />
                    <span>Move them to</span>
                    <select
                      value={destination}
                      disabled={strategy !== 'move'}
                      onChange={(event) => setDestination(event.target.value)}
                    >
                      {otherSections.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                )}
                <label>
                  <input
                    type="radio"
                    name="section-action"
                    checked={strategy === 'delete'}
                    onChange={() => setStrategy('delete')}
                  />
                  <span>Delete every bookmark in “{section}”</span>
                </label>
              </fieldset>
            )}

            {error && <p className="app-form-error" role="alert">{error}</p>}
          </div>

          <footer>
            <button type="submit" className={mode === 'delete' && strategy === 'delete' ? 'is-danger' : 'is-primary'}>
              {mode === 'rename'
                ? 'Rename section'
                : strategy === 'move' ? 'Move and remove' : 'Delete section'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
