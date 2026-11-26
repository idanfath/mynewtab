import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeSelectPopoverPosition,
  findTypeaheadMatchIndex,
  resolveSelectKeyAction,
} from '../src/customSelectModel.ts';

test('resolveSelectKeyAction handles closed and open keyboard navigation and disabled options', () => {
  // Closed triggers open on Enter, Space, ArrowDown, ArrowUp, Home, End
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'Enter',
      selectedIndex: 2,
      activeIndex: -1,
      optionCount: 5,
    }),
    { type: 'open', activeIndex: 2 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: ' ',
      selectedIndex: 1,
      activeIndex: -1,
      optionCount: 5,
    }),
    { type: 'open', activeIndex: 1 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'Home',
      selectedIndex: 3,
      activeIndex: -1,
      optionCount: 5,
      disabledIndices: new Set([0]),
    }),
    { type: 'open', activeIndex: 1 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'End',
      selectedIndex: 1,
      activeIndex: -1,
      optionCount: 5,
      disabledIndices: new Set([4]),
    }),
    { type: 'open', activeIndex: 3 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'Escape',
      selectedIndex: 0,
      activeIndex: -1,
      optionCount: 5,
    }),
    { type: 'noop' },
  );

  // Open navigation wraps and skips disabled options
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'ArrowDown',
      selectedIndex: 0,
      activeIndex: 0,
      optionCount: 4,
      disabledIndices: new Set([1]),
    }),
    { type: 'move', activeIndex: 2 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'ArrowUp',
      selectedIndex: 0,
      activeIndex: 0,
      optionCount: 4,
      disabledIndices: new Set([3]),
    }),
    { type: 'move', activeIndex: 2 },
  );

  // Escape consumes event and restores trigger focus; Tab closes without consuming event
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'Escape',
      selectedIndex: 0,
      activeIndex: 2,
      optionCount: 4,
    }),
    { type: 'close', restoreTriggerFocus: true, consumeEvent: true },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'Tab',
      selectedIndex: 0,
      activeIndex: 2,
      optionCount: 4,
    }),
    { type: 'close', restoreTriggerFocus: false, consumeEvent: false },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'Enter',
      selectedIndex: 0,
      activeIndex: 2,
      optionCount: 4,
    }),
    { type: 'select', activeIndex: 2 },
  );

  // Empty or all-disabled options safely no-op
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'Enter',
      selectedIndex: -1,
      activeIndex: -1,
      optionCount: 0,
    }),
    { type: 'noop' },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'Enter',
      selectedIndex: 0,
      activeIndex: -1,
      optionCount: 2,
      disabledIndices: new Set([0, 1]),
    }),
    { type: 'noop' },
  );

  // Alt+ArrowUp closes an open select, consumes event, and restores trigger focus
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'ArrowUp',
      altKey: true,
      selectedIndex: 0,
      activeIndex: 2,
      optionCount: 4,
    }),
    { type: 'close', restoreTriggerFocus: true, consumeEvent: true },
  );

  // Closed ArrowDown / ArrowUp open at selectedIndex, or first/last enabled when selectedIndex is -1 or disabled
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'ArrowDown',
      selectedIndex: 2,
      activeIndex: -1,
      optionCount: 5,
    }),
    { type: 'open', activeIndex: 2 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'ArrowUp',
      selectedIndex: 2,
      activeIndex: -1,
      optionCount: 5,
    }),
    { type: 'open', activeIndex: 2 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'ArrowDown',
      selectedIndex: -1,
      activeIndex: -1,
      optionCount: 5,
      disabledIndices: new Set([0]),
    }),
    { type: 'open', activeIndex: 1 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'ArrowUp',
      selectedIndex: -1,
      activeIndex: -1,
      optionCount: 5,
      disabledIndices: new Set([4]),
    }),
    { type: 'open', activeIndex: 3 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'ArrowDown',
      selectedIndex: 1,
      activeIndex: -1,
      optionCount: 5,
      disabledIndices: new Set([0, 1]),
    }),
    { type: 'open', activeIndex: 2 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: false,
      key: 'ArrowUp',
      selectedIndex: 3,
      activeIndex: -1,
      optionCount: 5,
      disabledIndices: new Set([3, 4]),
    }),
    { type: 'open', activeIndex: 2 },
  );

  // Open Enter and Space return noop when activeIndex is -1 or points to a disabled option
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'Enter',
      selectedIndex: 0,
      activeIndex: -1,
      optionCount: 4,
    }),
    { type: 'noop' },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: ' ',
      selectedIndex: 0,
      activeIndex: -1,
      optionCount: 4,
    }),
    { type: 'noop' },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'Enter',
      selectedIndex: 0,
      activeIndex: 2,
      optionCount: 4,
      disabledIndices: new Set([2]),
    }),
    { type: 'noop' },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: ' ',
      selectedIndex: 0,
      activeIndex: 2,
      optionCount: 4,
      disabledIndices: new Set([2]),
    }),
    { type: 'noop' },
  );
});

test('findTypeaheadMatchIndex matches case-insensitively, wraps around, and skips disabled entries', () => {
  const options = [
    { label: 'DuckDuckGo' },
    { label: 'Google', disabled: true },
    { label: 'Brave Search' },
    { label: 'Kagi' },
    { label: 'Perplexity' },
  ];

  assert.equal(findTypeaheadMatchIndex(options, 'k', 0), 3);
  assert.equal(findTypeaheadMatchIndex(options, 'br', 3), 2);
  assert.equal(findTypeaheadMatchIndex(options, 'g', 0), -1); // Google is disabled
  assert.equal(findTypeaheadMatchIndex(options, '   ', 0), -1);
  assert.equal(findTypeaheadMatchIndex([], 'a', 0), -1);
});

test('computeSelectPopoverPosition places below when room exists, flips above near bottom, and clamps to viewport', () => {
  const below = computeSelectPopoverPosition({
    triggerRect: { top: 100, bottom: 140, left: 40, width: 260 },
    viewportWidth: 1024,
    viewportHeight: 768,
    estimatedHeight: 200,
  });
  assert.equal(below.placement, 'bottom');
  assert.equal(below.top, 146);
  assert.equal(below.left, 40);
  assert.equal(below.width, 260);

  const above = computeSelectPopoverPosition({
    triggerRect: { top: 680, bottom: 720, left: 900, width: 260 },
    viewportWidth: 1024,
    viewportHeight: 768,
    estimatedHeight: 200,
  });
  assert.equal(above.placement, 'top');
  assert.equal(above.top, 474);
  assert.equal(above.left, 756); // clamped to viewportWidth - width - margin (1024 - 260 - 8)

  // Tight viewport: availableSpace < 96 clamps maxHeight to 96 and keeps top >= margin
  const tight = computeSelectPopoverPosition({
    triggerRect: { top: 60, bottom: 100, left: 20, width: 200 },
    viewportWidth: 320,
    viewportHeight: 160,
    estimatedHeight: 240,
    margin: 8,
    gap: 6,
  });
  assert.equal(tight.maxHeight, 96);
  assert.ok(tight.top >= 8);
});

test('CustomSelect handles single enabled option surrounded by disabled options, accented Unicode typeahead, and 240x180 clamping', () => {
  const onlyMiddleDisabled = new Set([0, 1, 3, 4]);

  // Closed open keys all land on index 2 even when selectedIndex is -1 or disabled
  for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.deepEqual(
      resolveSelectKeyAction({
        isOpen: false,
        key,
        selectedIndex: 0,
        activeIndex: -1,
        optionCount: 5,
        disabledIndices: onlyMiddleDisabled,
      }),
      { type: 'open', activeIndex: 2 },
    );
  }

  // Open navigation wraps cleanly back to the sole enabled option (index 2)
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.deepEqual(
      resolveSelectKeyAction({
        isOpen: true,
        key,
        selectedIndex: 2,
        activeIndex: 2,
        optionCount: 5,
        disabledIndices: onlyMiddleDisabled,
      }),
      { type: 'move', activeIndex: 2 },
    );
  }
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'ArrowUp',
      selectedIndex: 2,
      activeIndex: 99,
      optionCount: 5,
      disabledIndices: onlyMiddleDisabled,
    }),
    { type: 'move', activeIndex: 2 },
  );
  assert.deepEqual(
    resolveSelectKeyAction({
      isOpen: true,
      key: 'Enter',
      selectedIndex: 2,
      activeIndex: 2,
      optionCount: 5,
      disabledIndices: onlyMiddleDisabled,
    }),
    { type: 'select', activeIndex: 2 },
  );

  // Unicode/accented typeahead (NFC and NFD decomposed forms, skipping disabled accented entries)
  const unicodeOptions = [
    { label: 'Éclair (Disabled)', disabled: true },
    { label: 'DuckDuckGo' },
    { label: 'Écosia' },
    { label: 'E\u0301cole' },
    { label: 'Über Search' },
  ];
  assert.equal(findTypeaheadMatchIndex(unicodeOptions, 'é', 0), 2);
  assert.equal(findTypeaheadMatchIndex(unicodeOptions, 'ÉC', 0), 2);
  assert.equal(findTypeaheadMatchIndex(unicodeOptions, 'e\u0301co', 0), 2);
  assert.equal(findTypeaheadMatchIndex(unicodeOptions, 'écol', 0), 3);
  assert.equal(findTypeaheadMatchIndex(unicodeOptions, 'üb', 0), 4);

  // Tiny 240x180 viewport clamping across trigger positions
  const tinyScenarios = [
    { top: 12, bottom: 44, left: 10, width: 280 },
    { top: 75, bottom: 105, left: -12, width: 260 },
    { top: 132, bottom: 164, left: 190, width: 100 },
  ];
  for (const triggerRect of tinyScenarios) {
    const pos = computeSelectPopoverPosition({
      triggerRect,
      viewportWidth: 240,
      viewportHeight: 180,
      estimatedHeight: 260,
      margin: 8,
      gap: 6,
    });
    assert.ok(pos.left >= 8, `left ${pos.left} < 8`);
    assert.ok(pos.left + pos.width <= 232, `right ${pos.left + pos.width} > 232`);
    assert.ok(pos.top >= 8, `top ${pos.top} < 8`);
    const renderedHeight = Math.min(260, pos.maxHeight);
    assert.ok(
      pos.top + renderedHeight <= 172,
      `bottom ${pos.top + renderedHeight} > 172`,
    );
  }

  // Ultra-tiny viewport (180x100) still clamps maxHeight within viewport bounds
  const ultraTiny = computeSelectPopoverPosition({
    triggerRect: { top: 40, bottom: 64, left: 10, width: 160 },
    viewportWidth: 180,
    viewportHeight: 100,
    estimatedHeight: 240,
    margin: 8,
    gap: 6,
  });
  assert.ok(ultraTiny.maxHeight <= 84);
  assert.ok(ultraTiny.top >= 8);
  assert.ok(ultraTiny.top + ultraTiny.maxHeight <= 92);
});
