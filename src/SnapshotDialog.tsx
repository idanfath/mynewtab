import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { BACKUP_KEY, STORAGE_KEY, type Bookmark } from './bookmarks.ts';
import { serializeBookmarksHtml } from './bookmarkHtml.ts';
import {
  diffSnapshotAgainstLive,
  type BookmarkSnapshot,
  type CorruptBackupInfo,
  type SnapshotTrigger,
} from './snapshotVault.ts';
import { downloadTextFile, trapDialogTabKey } from './dialogFocus.ts';

interface SnapshotDialogProps {
  snapshots: BookmarkSnapshot[];
  liveBookmarks: Bookmark[];
  corruptBackup: CorruptBackupInfo | null;
  onClose: () => void;
  onRestore: (snapshot: BookmarkSnapshot) => string | null;
  onCreateCheckpoint: (label: string) => string | null;
  onDeleteSnapshot: (snapshotId: string) => string | null;
  onRepairCorruptBackup: () => void;
  onDismissCorruptBackup: () => void;
}

const TRIGGER_LABELS: Record<SnapshotTrigger, string> = {
  manual: 'Manual',
  'pre-import': 'Import',
  'pre-replace': 'Replace',
  'pre-editor-save': 'JSON',
  'pre-section-delete': 'Section',
  'pre-restore': 'Restore',
  'external-conflict': 'Conflict',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatKilobytes(byteLength: number): string {
  return `${Math.max(0.1, byteLength / 1024).toFixed(1)} KB`;
}

function slugifyFilenamePart(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || 'snapshot';
}

export default function SnapshotDialog({
  snapshots,
  liveBookmarks,
  corruptBackup,
  onClose,
  onRestore,
  onCreateCheckpoint,
  onDeleteSnapshot,
  onRepairCorruptBackup,
  onDismissCorruptBackup,
}: SnapshotDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(snapshots[0]?.id ?? null);
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [error, setError] = useState('');

  const selectedSnapshot = snapshots.find((s) => s.id === selectedId) ?? snapshots[0] ?? null;

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;
    const focusTarget = dialogEl.querySelector<HTMLElement>('.app-snapshot-create input')
      ?? dialogEl.querySelector<HTMLElement>('.app-snapshot-list [aria-selected="true"]')
      ?? dialogEl.querySelector<HTMLElement>('.app-snapshot-list [data-snapshot-id]')
      ?? dialogEl.querySelector<HTMLElement>('.app-rescue-actions .is-primary, .app-rescue-actions button')
      ?? dialogEl.querySelector<HTMLElement>('.app-form-close')
      ?? dialogEl;
    focusTarget.focus({ preventScroll: true });
  }, []);

  const selectedDiff = useMemo(
    () => (selectedSnapshot
      ? diffSnapshotAgainstLive(selectedSnapshot.bookmarks, liveBookmarks)
      : null),
    [selectedSnapshot, liveBookmarks],
  );

  const selectedSections = useMemo(() => {
    if (!selectedSnapshot) return [];
    const counts = new Map<string, number>();
    for (const bookmark of selectedSnapshot.bookmarks) {
      counts.set(bookmark.section, (counts.get(bookmark.section) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [selectedSnapshot]);

  const handleCreateCheckpoint = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const createError = onCreateCheckpoint(checkpointLabel);
    if (createError) {
      setError(createError);
      return;
    }
    setError('');
    setCheckpointLabel('');
    setSelectedId(null);
  };

  const handleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (snapshots.length === 0) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const currentIndex = selectedSnapshot
      ? snapshots.findIndex((s) => s.id === selectedSnapshot.id)
      : 0;
    const nextIndex = event.key === 'ArrowDown'
      ? (currentIndex + 1) % snapshots.length
      : currentIndex <= 0 ? snapshots.length - 1 : currentIndex - 1;
    const nextSnapshot = snapshots[nextIndex];
    setSelectedId(nextSnapshot.id);

    const listEl = event.currentTarget;
    const targetBtn = listEl.querySelectorAll<HTMLButtonElement>('[data-snapshot-id]')[nextIndex];
    targetBtn?.focus({ preventScroll: true });
    targetBtn?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div
      className="app-form-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="app-form-dialog app-snapshot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-snapshot-dialog-title"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.defaultPrevented) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (confirmingDiscard) {
              setConfirmingDiscard(false);
              return;
            }
            onClose();
            return;
          }
          trapDialogTabKey(event, dialogRef.current);
        }}
      >
        <div className="app-snapshot-shell">
          <header>
            <div>
              <p className="app-kicker">Local recovery</p>
              <h2 id="app-snapshot-dialog-title">Snapshot history</h2>
            </div>
            <button type="button" className="app-form-close" onClick={onClose}>
              Close
            </button>
          </header>

          <div className="app-form-body">
            {corruptBackup && (
              <div className="app-rescue-card" role="region" aria-label="Corrupt bookmark backup rescue">
                <div className="app-rescue-copy">
                  <p className="app-kicker">Corrupt backup detected</p>
                  <p>
                    {corruptBackup.failure === 'invalid'
                      ? 'Saved data is complete JSON but has invalid bookmark entries.'
                      : 'Saved data looks truncated or is not valid JSON.'}{' '}
                    ({formatKilobytes(corruptBackup.byteLength)} in{' '}
                    <code>{corruptBackup.source === 'backup-key' ? BACKUP_KEY : STORAGE_KEY}</code>).
                  </p>
                </div>
                <div className="app-rescue-actions">
                  <button
                    type="button"
                    className="is-primary"
                    onClick={onRepairCorruptBackup}
                  >
                    Open in JSON editor
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadTextFile(
                      'bookmarks-corrupt-backup.json',
                      corruptBackup.raw,
                      'application/json',
                    )}
                  >
                    Download raw file
                  </button>
                  {confirmingDiscard ? (
                    <>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          setConfirmingDiscard(false);
                          onDismissCorruptBackup();
                        }}
                      >
                        Confirm discard
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDiscard(false)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => setConfirmingDiscard(true)}
                    >
                      Dismiss backup
                    </button>
                  )}
                </div>
              </div>
            )}

            {liveBookmarks.length > 0 && (
              <form className="app-snapshot-create" onSubmit={handleCreateCheckpoint}>
                <input
                  value={checkpointLabel}
                  onChange={(event) => setCheckpointLabel(event.target.value)}
                  placeholder="Name a manual checkpoint…"
                  aria-label="Checkpoint label"
                  maxLength={80}
                />
                <button type="submit" className="is-primary">
                  Save checkpoint
                </button>
              </form>
            )}

            {snapshots.length === 0 ? (
              <div className="app-snapshot-empty">
                <p>No snapshots stored yet.</p>
                <small>
                  Checkpoints are created automatically before bulk imports, JSON edits, section removals, and restores.
                </small>
              </div>
            ) : (
              <div className="app-snapshot-grid">
                <div
                  className="app-snapshot-list"
                  role="listbox"
                  aria-label="Saved snapshots"
                  onKeyDown={handleListKeyDown}
                >
                  {snapshots.map((snapshot) => {
                    const isSelected = selectedSnapshot?.id === snapshot.id;
                    return (
                      <button
                        key={snapshot.id}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        data-snapshot-id={snapshot.id}
                        className={`app-snapshot-item${isSelected ? ' is-selected' : ''}`}
                        onClick={() => {
                          setSelectedId(snapshot.id);
                          setError('');
                        }}
                      >
                        <div className="app-snapshot-item-top">
                          <strong>{snapshot.label}</strong>
                          <span className={`app-snapshot-trigger is-${snapshot.trigger}`}>
                            {TRIGGER_LABELS[snapshot.trigger]}
                          </span>
                        </div>
                        <small>
                          {formatTimestamp(snapshot.createdAt)} · {snapshot.bookmarkCount} item{snapshot.bookmarkCount === 1 ? '' : 's'}
                        </small>
                      </button>
                    );
                  })}
                </div>

                {selectedSnapshot && selectedDiff && (
                  <div className="app-snapshot-detail">
                    <div className="app-snapshot-detail-head">
                      <div>
                        <h3>{selectedSnapshot.label}</h3>
                        <p className="app-snapshot-detail-meta">
                          {formatTimestamp(selectedSnapshot.createdAt)} ·{' '}
                          {selectedSnapshot.bookmarkCount} bookmark{selectedSnapshot.bookmarkCount === 1 ? '' : 's'} ·{' '}
                          {selectedSnapshot.sectionCount} section{selectedSnapshot.sectionCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className={`app-snapshot-trigger is-${selectedSnapshot.trigger}`}>
                        {TRIGGER_LABELS[selectedSnapshot.trigger]}
                      </span>
                    </div>

                    <div className="app-snapshot-diff" aria-live="polite">
                      {selectedDiff.isIdenticalToLive ? (
                        <span className="app-diff-badge is-unchanged">
                          Identical to current directory
                        </span>
                      ) : selectedDiff.orderChanged ? (
                        <span className="app-diff-badge is-changed">
                          Order changed · ={selectedDiff.unchangedCount} bookmarks
                        </span>
                      ) : (
                        <>
                          <span className="app-diff-badge is-added">
                            +{selectedDiff.restoredOrAddedCount} restored
                          </span>
                          <span className="app-diff-badge is-changed">
                            ~{selectedDiff.changedCount} changed
                          </span>
                          <span className="app-diff-badge is-removed">
                            -{selectedDiff.removedCount} removed
                          </span>
                          <span className="app-diff-badge is-unchanged">
                            ={selectedDiff.unchangedCount} unchanged
                          </span>
                        </>
                      )}
                    </div>

                    <div className="app-snapshot-sections">
                      {selectedSections.map(([sectionName, count]) => (
                        <span key={sectionName} className="app-snapshot-section-pill">
                          {sectionName} <small>{count}</small>
                        </span>
                      ))}
                    </div>

                    <div className="app-snapshot-detail-actions">
                      <button
                        type="button"
                        className="is-primary"
                        disabled={selectedDiff.isIdenticalToLive}
                        onClick={() => {
                          const restoreError = onRestore(selectedSnapshot);
                          if (restoreError) setError(restoreError);
                        }}
                      >
                        Restore snapshot
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadTextFile(
                          `bookmarks-${slugifyFilenamePart(selectedSnapshot.label)}.json`,
                          JSON.stringify(selectedSnapshot.bookmarks, null, 2),
                          'application/json',
                        )}
                      >
                        Export .json
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadTextFile(
                          `bookmarks-${slugifyFilenamePart(selectedSnapshot.label)}.html`,
                          serializeBookmarksHtml(selectedSnapshot.bookmarks),
                          'text/html;charset=utf-8',
                        )}
                      >
                        Export .html
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          const delError = onDeleteSnapshot(selectedSnapshot.id);
                          if (delError) setError(delError);
                          else setError('');
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && <p className="app-form-error" role="alert">{error}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
