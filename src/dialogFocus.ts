const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function isVisibleFocusable(el: HTMLElement): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.closest('[inert], [hidden]')) return false;

  const closedDetails = el.closest('details:not([open])');
  if (closedDetails && closedDetails.querySelector(':scope > summary') !== el) {
    return false;
  }

  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (el.offsetParent === null && style.position !== 'fixed') return false;
  return true;
}

export function trapDialogTabKey(
  event: {
    key: string;
    shiftKey: boolean;
    preventDefault: () => void;
  },
  containerEl: HTMLElement | null,
): void {
  if (event.key !== 'Tab' || !containerEl) return;

  const focusables = Array.from(
    containerEl.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isVisibleFocusable);

  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (event.shiftKey) {
    if (!active || active === first || !containerEl.contains(active)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    }
  } else if (!active || active === last || !containerEl.contains(active)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export function focusConflictBanner(containerEl: HTMLElement | null): boolean {
  if (!containerEl) return false;
  const actionButton = containerEl.querySelector<HTMLButtonElement>(
    '.app-conflict-banner button:not([disabled])',
  );
  if (!actionButton) return false;
  actionButton.focus({ preventScroll: true });
  return true;
}

export function restoreFocusSafely(el: HTMLElement | null): void {
  if (!el || !el.isConnected) return;
  window.requestAnimationFrame(() => {
    if (el.isConnected) {
      el.focus({ preventScroll: true });
    }
  });
}

export function downloadTextFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadTextFiles(
  files: ReadonlyArray<{ filename: string; content: string; mimeType: string }>,
  staggerMs = 120,
): void {
  files.forEach((file, index) => {
    if (index === 0) {
      downloadTextFile(file.filename, file.content, file.mimeType);
    } else {
      window.setTimeout(() => {
        downloadTextFile(file.filename, file.content, file.mimeType);
      }, index * staggerMs);
    }
  });
}
