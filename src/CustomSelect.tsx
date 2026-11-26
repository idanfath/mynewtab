import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  computeSelectPopoverPosition,
  findTypeaheadMatchIndex,
  resolveSelectKeyAction,
  type SelectOption,
} from './customSelectModel.ts';

export interface CustomSelectProps<T extends string = string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  placeholder?: string;
}

export default function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  autoFocus = false,
  id,
  className,
  ariaLabel,
  ariaLabelledBy,
  placeholder = 'Select an option',
}: CustomSelectProps<T>) {
  const listboxId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const typeaheadBufferRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popoverPos, setPopoverPos] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    placement: 'bottom' | 'top';
  }>({ left: 0, top: 0, width: 200, maxHeight: 240, placement: 'bottom' });

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const disabledIndices = useMemo(() => {
    const set = new Set<number>();
    options.forEach((option, index) => {
      if (option.disabled) set.add(index);
    });
    return set;
  }, [options]);

  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  useEffect(() => {
    return () => {
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
    };
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const measuredHeight = listboxRef.current?.scrollHeight ?? options.length * 36 + 12;
    const next = computeSelectPopoverPosition({
      triggerRect: {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      estimatedHeight: measuredHeight,
    });
    setPopoverPos((current) => (
      current.left === next.left
      && current.top === next.top
      && current.width === next.width
      && current.maxHeight === next.maxHeight
      && current.placement === next.placement
        ? current
        : next
    ));
  }, [options.length]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    if (activeIndex < 0) return;
    const optionEl = listboxRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    optionEl?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  const commitOptionIndex = useCallback(
    (index: number) => {
      const picked = options[index];
      if (!picked || picked.disabled) return;
      onChange(picked.value);
      setIsOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    },
    [onChange, options],
  );

  const handleOpenKeyDown = useCallback(
    (
      event: globalThis.KeyboardEvent | KeyboardEvent<HTMLButtonElement>,
      restoreTriggerFocus: boolean,
    ) => {
      if (
        event.key.length === 1
        && !event.ctrlKey
        && !event.metaKey
        && !event.altKey
        && event.key !== ' '
      ) {
        event.preventDefault();
        if (typeaheadTimerRef.current !== null) {
          window.clearTimeout(typeaheadTimerRef.current);
        }
        const nextBuffer = `${typeaheadBufferRef.current}${event.key}`;
        typeaheadBufferRef.current = nextBuffer;
        typeaheadTimerRef.current = window.setTimeout(() => {
          typeaheadBufferRef.current = '';
          typeaheadTimerRef.current = null;
        }, 500);

        const startFrom = activeIndex >= 0 ? activeIndex : 0;
        let matchIdx = findTypeaheadMatchIndex(options, nextBuffer, startFrom);
        if (matchIdx < 0 && nextBuffer.length > 1) {
          typeaheadBufferRef.current = event.key;
          matchIdx = findTypeaheadMatchIndex(
            options,
            event.key,
            (startFrom + 1) % Math.max(1, options.length),
          );
        }
        if (matchIdx >= 0) {
          setActiveIndex(matchIdx);
        }
        if (restoreTriggerFocus) {
          triggerRef.current?.focus({ preventScroll: true });
        }
        return;
      }

      const action = resolveSelectKeyAction({
        isOpen: true,
        key: event.key,
        altKey: event.altKey,
        selectedIndex,
        activeIndex,
        optionCount: options.length,
        disabledIndices,
      });

      if (action.type === 'noop') return;

      if (action.type === 'move') {
        event.preventDefault();
        setActiveIndex(action.activeIndex);
        if (restoreTriggerFocus) {
          triggerRef.current?.focus({ preventScroll: true });
        }
        return;
      }

      if (action.type === 'select') {
        event.preventDefault();
        event.stopPropagation();
        commitOptionIndex(action.activeIndex);
        return;
      }

      if (action.type === 'close') {
        if (action.consumeEvent) {
          event.preventDefault();
          event.stopPropagation();
        }
        if (action.restoreTriggerFocus || restoreTriggerFocus) {
          triggerRef.current?.focus({ preventScroll: true });
        }
        setIsOpen(false);
      }
    },
    [activeIndex, commitOptionIndex, disabledIndices, options, selectedIndex],
  );

  const handleOpenKeyDownRef = useRef(handleOpenKeyDown);
  useLayoutEffect(() => {
    handleOpenKeyDownRef.current = handleOpenKeyDown;
  }, [handleOpenKeyDown]);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDownCapture = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target
        && (triggerRef.current?.contains(target) || listboxRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
      if (target instanceof Element && target.classList.contains('app-form-backdrop')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const handleDocumentKeyDownCapture = (event: globalThis.KeyboardEvent) => {
      if (disabled || event.isComposing) return;
      if (event.key === 'Escape' || (event.altKey && event.key === 'ArrowUp')) {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (document.activeElement !== triggerRef.current) {
        handleOpenKeyDownRef.current(event, true);
      }
    };

    const handleScrollCapture = (event: Event) => {
      if (event.target instanceof Node && listboxRef.current?.contains(event.target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleDismiss = () => setIsOpen(false);

    document.addEventListener('mousedown', handleMouseDownCapture, true);
    document.addEventListener('keydown', handleDocumentKeyDownCapture, true);
    window.addEventListener('scroll', handleScrollCapture, true);
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('blur', handleDismiss);
    return () => {
      document.removeEventListener('mousedown', handleMouseDownCapture, true);
      document.removeEventListener('keydown', handleDocumentKeyDownCapture, true);
      window.removeEventListener('scroll', handleScrollCapture, true);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('blur', handleDismiss);
    };
  }, [disabled, isOpen]);

  const handleToggleClick = () => {
    if (disabled) return;
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const startIdx = selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : options.findIndex((option) => !option.disabled);
    setActiveIndex(startIdx);
    setIsOpen(true);
  };

  const handleClosedKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      event.key.length === 1
      && !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && event.key !== ' '
    ) {
      event.preventDefault();
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
      const nextBuffer = `${typeaheadBufferRef.current}${event.key}`;
      typeaheadBufferRef.current = nextBuffer;
      typeaheadTimerRef.current = window.setTimeout(() => {
        typeaheadBufferRef.current = '';
        typeaheadTimerRef.current = null;
      }, 500);

      const startFrom = selectedIndex >= 0 ? selectedIndex : 0;
      let matchIdx = findTypeaheadMatchIndex(options, nextBuffer, startFrom);
      if (matchIdx < 0 && nextBuffer.length > 1) {
        typeaheadBufferRef.current = event.key;
        matchIdx = findTypeaheadMatchIndex(
          options,
          event.key,
          (startFrom + 1) % Math.max(1, options.length),
        );
      }
      if (matchIdx >= 0) {
        setActiveIndex(matchIdx);
        onChange(options[matchIdx].value);
      }
      return;
    }

    const action = resolveSelectKeyAction({
      isOpen: false,
      key: event.key,
      altKey: event.altKey,
      selectedIndex,
      activeIndex,
      optionCount: options.length,
      disabledIndices,
    });

    if (action.type === 'open') {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(action.activeIndex);
      setIsOpen(true);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.nativeEvent.isComposing) return;
    if (isOpen) {
      handleOpenKeyDown(event, false);
      return;
    }
    handleClosedKeyDown(event);
  };

  const portalHost = triggerRef.current?.closest('.app-page') ?? document.body;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        autoFocus={autoFocus}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          isOpen
          && activeIndex >= 0
          && activeIndex < options.length
          && !options[activeIndex]?.disabled
            ? `${listboxId}-opt-${activeIndex}`
            : undefined
        }
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={`app-select-trigger${isOpen ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        onClick={handleToggleClick}
        onKeyDown={handleKeyDown}
      >
        <span className="app-select-trigger-label">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span className="app-select-chevron" aria-hidden="true">▾</span>
      </button>

      {isOpen && createPortal(
        <div
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={`app-select-popover is-${popoverPos.placement}`}
          style={{
            left: popoverPos.left,
            top: popoverPos.top,
            width: popoverPos.width,
            maxHeight: popoverPos.maxHeight,
          }}
          onMouseUp={() => {
            if (document.activeElement !== triggerRef.current) {
              triggerRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value}
                id={`${listboxId}-opt-${index}`}
                role="option"
                data-option-index={index}
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                className={`app-select-option${isSelected ? ' is-selected' : ''}${
                  isActive ? ' is-active' : ''
                }${option.disabled ? ' is-disabled' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={() => {
                  if (!option.disabled) commitOptionIndex(index);
                }}
              >
                <span className="app-select-option-copy">
                  <span className="app-select-option-label">{option.label}</span>
                  {option.description && (
                    <small className="app-select-option-desc">{option.description}</small>
                  )}
                </span>
                <span className="app-select-check" aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
              </div>
            );
          })}
        </div>,
        portalHost,
      )}
    </>
  );
}
