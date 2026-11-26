export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

export type SelectKeyAction =
  | { type: 'open'; activeIndex: number }
  | { type: 'move'; activeIndex: number }
  | { type: 'select'; activeIndex: number }
  | { type: 'close'; restoreTriggerFocus: boolean; consumeEvent: boolean }
  | { type: 'noop' };

function findFirstEnabled(
  optionCount: number,
  disabledIndices?: ReadonlySet<number>,
): number {
  for (let i = 0; i < optionCount; i += 1) {
    if (!disabledIndices?.has(i)) return i;
  }
  return -1;
}

function findLastEnabled(
  optionCount: number,
  disabledIndices?: ReadonlySet<number>,
): number {
  for (let i = optionCount - 1; i >= 0; i -= 1) {
    if (!disabledIndices?.has(i)) return i;
  }
  return -1;
}

function findNextEnabled(
  startIndex: number,
  direction: 1 | -1,
  optionCount: number,
  disabledIndices?: ReadonlySet<number>,
): number {
  if (optionCount <= 0) return -1;
  let index = startIndex;
  for (let step = 0; step < optionCount; step += 1) {
    index = (index + direction + optionCount) % optionCount;
    if (!disabledIndices?.has(index)) return index;
  }
  return -1;
}

export function resolveSelectKeyAction(params: {
  isOpen: boolean;
  key: string;
  altKey?: boolean;
  selectedIndex: number;
  activeIndex: number;
  optionCount: number;
  disabledIndices?: ReadonlySet<number>;
}): SelectKeyAction {
  const {
    isOpen,
    key,
    altKey = false,
    selectedIndex,
    activeIndex,
    optionCount,
    disabledIndices,
  } = params;

  if (optionCount <= 0) return { type: 'noop' };

  const firstEnabled = findFirstEnabled(optionCount, disabledIndices);
  if (firstEnabled < 0) return { type: 'noop' };
  const lastEnabled = findLastEnabled(optionCount, disabledIndices);
  const hasValidSelected = selectedIndex >= 0
    && selectedIndex < optionCount
    && !disabledIndices?.has(selectedIndex);
  const safeSelected = hasValidSelected ? selectedIndex : firstEnabled;

  if (!isOpen) {
    if (key === 'Enter' || key === ' ') {
      return { type: 'open', activeIndex: safeSelected };
    }
    if (key === 'ArrowDown') {
      return { type: 'open', activeIndex: hasValidSelected ? selectedIndex : firstEnabled };
    }
    if (key === 'ArrowUp') {
      return { type: 'open', activeIndex: hasValidSelected ? selectedIndex : lastEnabled };
    }
    if (key === 'Home') {
      return { type: 'open', activeIndex: firstEnabled };
    }
    if (key === 'End') {
      return { type: 'open', activeIndex: lastEnabled };
    }
    return { type: 'noop' };
  }

  if (key === 'Escape' || (altKey && key === 'ArrowUp')) {
    return { type: 'close', restoreTriggerFocus: true, consumeEvent: true };
  }

  if (key === 'Tab') {
    return { type: 'close', restoreTriggerFocus: false, consumeEvent: false };
  }

  if (key === 'Enter' || key === ' ') {
    if (
      activeIndex < 0
      || activeIndex >= optionCount
      || disabledIndices?.has(activeIndex)
    ) {
      return { type: 'noop' };
    }
    return { type: 'select', activeIndex };
  }

  if (key === 'ArrowDown') {
    const base = activeIndex >= 0 && activeIndex < optionCount ? activeIndex : -1;
    const next = base < 0
      ? firstEnabled
      : findNextEnabled(base, 1, optionCount, disabledIndices);
    return next >= 0 ? { type: 'move', activeIndex: next } : { type: 'noop' };
  }

  if (key === 'ArrowUp') {
    const base = activeIndex >= 0 && activeIndex < optionCount ? activeIndex : 0;
    const prev = activeIndex < 0
      ? lastEnabled
      : findNextEnabled(base, -1, optionCount, disabledIndices);
    return prev >= 0 ? { type: 'move', activeIndex: prev } : { type: 'noop' };
  }

  if (key === 'Home') {
    return { type: 'move', activeIndex: firstEnabled };
  }

  if (key === 'End') {
    return { type: 'move', activeIndex: lastEnabled };
  }

  return { type: 'noop' };
}

export function findTypeaheadMatchIndex(
  options: ReadonlyArray<Pick<SelectOption, 'label' | 'disabled'>>,
  query: string,
  startIndex: number,
): number {
  const normalized = query.trim().normalize('NFC').toLocaleLowerCase();
  if (!normalized || options.length === 0) return -1;

  const count = options.length;
  const origin = startIndex >= 0 && startIndex < count ? startIndex : 0;
  for (let offset = 0; offset < count; offset += 1) {
    const index = (origin + offset) % count;
    const option = options[index];
    if (option.disabled) continue;
    if (option.label.trim().normalize('NFC').toLocaleLowerCase().startsWith(normalized)) {
      return index;
    }
  }
  return -1;
}

export function computeSelectPopoverPosition(params: {
  triggerRect: { top: number; bottom: number; left: number; width: number };
  viewportWidth: number;
  viewportHeight: number;
  estimatedHeight: number;
  margin?: number;
  gap?: number;
}): {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: 'bottom' | 'top';
} {
  const {
    triggerRect,
    viewportWidth,
    viewportHeight,
    estimatedHeight,
    margin = 8,
    gap = 6,
  } = params;

  const maxAllowedWidth = Math.max(120, viewportWidth - margin * 2);
  const width = Math.round(Math.min(Math.max(triggerRect.width, 140), maxAllowedWidth));
  const left = Math.round(
    Math.max(margin, Math.min(triggerRect.left, viewportWidth - width - margin)),
  );

  const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - gap - margin);
  const spaceAbove = Math.max(0, triggerRect.top - gap - margin);
  const preferBottom = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove;

  const placement: 'bottom' | 'top' = preferBottom ? 'bottom' : 'top';
  const availableSpace = placement === 'bottom' ? spaceBelow : spaceAbove;
  const minHeightFloor = Math.min(96, Math.max(48, viewportHeight - margin * 2));
  const maxHeight = Math.round(Math.max(minHeightFloor, Math.min(280, availableSpace)));
  const renderedHeight = Math.min(estimatedHeight, maxHeight);

  const rawTop = placement === 'bottom'
    ? triggerRect.bottom + gap
    : triggerRect.top - gap - renderedHeight;
  const top = Math.round(
    Math.max(margin, Math.min(rawTop, viewportHeight - renderedHeight - margin)),
  );

  return { left, top, width, maxHeight, placement };
}
