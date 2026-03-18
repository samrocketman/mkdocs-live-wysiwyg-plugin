# Browser Compatibility — Design Document

## Overview

The WYSIWYG plugin targets three browser engines: **Blink** (Chrome, Edge, Opera), **Gecko** (Firefox), and **WebKit** (Safari). All browser-specific detection, normalization, and workarounds are centralized in `browser-compat.js`, which exposes `window.LiveWysiwygCompat` (captured as `var _compat` by the integration IIFE).

The compatibility layer is loaded before `vendor/editor.js` and patches `document.execCommand` and `document.queryCommandState` globally so that vendor code automatically routes through the normalization layer without modification.

## Architecture

```
plugin.py injects assets in order:
  1. marked.js
  2. admonition-ext.js
  3. browser-compat.js        ← NEW: patches globals, exposes LiveWysiwygCompat
  4. vendor/editor.js          ← calls document.execCommand (patched)
  5. live-wysiwyg-integration.js ← uses _compat.* APIs
```

### `browser-compat.js` Structure

Self-executing IIFE that:
1. Detects engine (blink/gecko/webkit) via CSS feature detection, not userAgent sniffing
2. Detects platform (mac/windows/linux) via `navigator.platform`
3. Patches `document.execCommand` globally with normalization logic
4. Patches `document.queryCommandState` globally with fallback walks
5. Exposes `window.LiveWysiwygCompat` with the full API surface

## API Surface

### Detection

| Property | Type | Description |
|---|---|---|
| `engine` | `'blink'\|'gecko'\|'webkit'\|'unknown'` | Detected rendering engine |
| `platform` | `'mac'\|'windows'\|'linux'` | Detected OS platform |

### Command Execution

| Method | Description |
|---|---|
| `exec(command, showUI, value)` | Normalized `execCommand` wrapper. Gecko: auto-wraps `formatBlock` values in angle brackets, post-normalizes `<b>`→`<strong>` and `<i>`→`<em>` |
| `nativeExec(command, showUI, value)` | Direct `document.execCommand` bypass (original, unpatched) |
| `queryCommandState(command)` | Normalized command state query. Gecko: fallback walk from anchor node for `bold`/`italic`/`strikeThrough` at element boundaries |
| `nativeQueryCommandState(command)` | Direct `document.queryCommandState` bypass (original, unpatched) |

### Keyboard

| Method | Description |
|---|---|
| `isComposing(e)` | Returns `true` when IME composition is active (`e.isComposing === true \|\| e.keyCode === 229`) |
| `isModifierCombo(e)` | Returns `true` when `e.metaKey \|\| e.ctrlKey` |
| `isPrintableKey(e)` | Returns `true` for printable single-character keys, excluding dead keys, process keys, and modifier combos |

### Clipboard

| Method | Description |
|---|---|
| `readClipboardText()` | Returns `Promise<string>`. Wraps `navigator.clipboard.readText()` with fallback to empty string. Consumes cached value from `cacheClipboardForGesture()` if available |
| `cacheClipboardForGesture()` | Pre-reads clipboard text synchronously during a user gesture for Safari compatibility. Must be called before `requestAnimationFrame` in click handlers |
| `getClipboardData(e, type)` | Wraps `(e.clipboardData \|\| window.clipboardData).getData(type)` with try/catch. Returns empty string on failure |
| `setClipboardData(e, type, data)` | Wraps `e.clipboardData.setData(type, data)` with try/catch |

### Location Guard

| Method | Description |
|---|---|
| `installLocationGuard(opts)` | Registers a location navigation guard. `opts.id`: unique string, `opts.isActive()`: returns truthy when guard should suppress, `opts.onIntercept`: optional callback when navigation is intercepted. Returns `{ remove: Function }` handle. Multiple guards can coexist; the first active guard wins |

### Range Utilities

| Method | Description |
|---|---|
| `getRangeRect(range)` | `getBoundingClientRect()` wrapper that handles Safari/Firefox zero-rect for collapsed ranges via temporary span insertion |
| `caretRangeFromPoint(x, y)` | Returns a `Range` at the given viewport coordinates. Blink/WebKit: delegates to `document.caretRangeFromPoint`. Gecko: uses `document.caretPositionFromPoint` and converts the `CaretPosition` to a `Range` |

### Fullscreen

| Property | Description |
|---|---|
| `fullscreenElement()` | Returns the current fullscreen element across vendor prefixes (`fullscreenElement`, `webkitFullscreenElement`, `mozFullScreenElement`) |
| `fullscreenEvents` | Array of fullscreen change event names: `['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange']` |

## Workaround Catalog

### `execCommand` Normalization (Gecko)

| Command | Issue | Fix |
|---|---|---|
| `formatBlock` | Firefox requires `<H1>` not `H1` | Auto-wrap value in angle brackets when `engine === 'gecko'` |
| `bold` | Firefox may produce `<b>` instead of `<strong>` | Post-exec: walk editable ancestor and replace `<b>` with `<strong>` (with selection save/restore) |
| `italic` | Firefox may produce `<i>` instead of `<em>` | Post-exec: walk editable ancestor and replace `<i>` with `<em>` (with selection save/restore) |

### `queryCommandState` Normalization (Gecko)

Firefox may report `false` for `bold`/`italic`/`strikeThrough` when the cursor is at the boundary of the formatting element, where Chrome reports `true`. The patched `queryCommandState` walks up from the anchor node looking for the corresponding element tag names.

### IME Composition Guards

All three keyboard routers check `_compat.isComposing(e)` at the top:
- **Tier 2** (`_globalKeydownRouter`): prevents shortcut dispatch during composition
- **Tier 3** (`_editorKeydownRouter`): prevents Enter/Backspace/Space handlers during composition
- **Markdown history capture**: prevents word-boundary flush during composition

Firefox-specific: `e.key === 'Dead'` and `e.key === 'Process'` are handled by `isPrintableKey()` returning `false`.

### Native Undo Timing (Safari)

Safari executes the native contenteditable undo/redo action before the `keydown` event fires. A `keydown`-only interception of Cmd+Z arrives too late — Safari has already applied its native undo to the DOM. The fix is a `beforeinput` event listener on the editable area that intercepts `inputType === 'historyUndo'` and `inputType === 'historyRedo'`. The `beforeinput` event fires before the native action on all browsers. A flag (`_undoViaBeforeinput`) prevents the subsequent `keydown` handler from double-dispatching. See `DESIGN-unified-content-undo.md`.

### Formatting Shortcuts (Safari/Firefox)

Cmd+B (bold) and Cmd+I (italic) previously relied on the browser's native `contenteditable` keyboard handling with no explicit JavaScript handler. This failed in Safari and Firefox because:

- **Firefox**: Cmd+B opens the Bookmarks sidebar; the browser-level shortcut can intercept the key before `contenteditable` processes it.
- **Safari/Firefox**: The global `document.execCommand` patch may interfere with the browser's internal Cmd+B/I dispatch path.
- **All browsers**: Native handling bypasses `_finalizeUpdate()` (editor state is not updated) and `_compat.exec()` (Gecko `<b>`→`<strong>` normalization does not run).

**Fix**: Explicit keyboard shortcut handlers in the Tier 3 `_editorKeydownRouter` (WYSIWYG) and `_markdownKeydownRouter` (Markdown) call `e.preventDefault()` to suppress any conflicting browser shortcut, then route through `_compat.exec('bold'/'italic')` for proper cross-browser normalization. Tab/Shift+Tab were also extracted from the vendor `editor.js` into the keyboard subsystem for the same reasons.

### Gecko Tag Normalization Selection Loss

When `_normalizeTagName` replaces `<b>` with `<strong>` (or `<i>` with `<em>`) after a Gecko `execCommand`, the function moves child nodes from the old element to a newly created replacement element via `appendChild` before inserting it into the DOM with `replaceChild`. During the `appendChild` phase the selected text nodes are temporarily in a detached subtree, which causes Firefox to clear the browser Selection.

**Fix**: `_normalizeTagName` saves the Selection Range data (`startContainer`, `startOffset`, `endContainer`, `endOffset`) before the replacement loop and restores it after. Since `appendChild` moves (not copies) DOM node objects, the saved node references remain valid — they are the same JavaScript objects, now parented under the new element. The restore is wrapped in try/catch so unexpected node invalidation degrades to selection loss rather than an error.

This fix is required by the Cursor & Selection Preservation cardinal rule (`cursor-selection-preservation.mdc`). The Keyboard subsystem (`keyboard.mdc`, `DESIGN-centralized-keyboard.md`) relies on `_compat.exec()` returning with the selection intact for formatting shortcuts (Cmd+B, Cmd+I).

### Clipboard API Differences

- **Safari**: Enforces strict user-gesture timing for `navigator.clipboard.readText()`. The `cacheClipboardForGesture()` method pre-reads clipboard text synchronously within the click handler before `requestAnimationFrame`.
- **Firefox**: `clipboardData.getData()`/`setData()` may throw in sandbox/iframe contexts or with untrusted events. All access is wrapped in try/catch via `getClipboardData`/`setClipboardData`.
- **Legacy**: `window.clipboardData` fallback for older browsers is included in `getClipboardData`.

### Location Property Override (Chrome)

Chrome does not allow `Object.defineProperty(location, ...)` on `Location.prototype` properties. The location guard uses try/catch around each property override. Two guards coexist via a callback list:
- **Reload guard**: silently blocks navigation during batch operations
- **Focus mode guard**: intercepts navigation and triggers `_onExternalRebuild()`

See `upstream-websocket-wrapper.mdc` for the WebSocket-level redirect suppression that complements the location guard.

### Collapsed Range `getBoundingClientRect` (Safari/Firefox)

Safari and Firefox can return a zero-width, zero-height `DOMRect` for `getBoundingClientRect()` on collapsed ranges. `getRangeRect()` detects this and inserts a temporary zero-width space span, measures its rect, then removes the span and normalizes the range.

### Selection After DOM Reparenting (WebKit)

Safari may invalidate Range node references when DOM nodes are moved between parents (focus mode enter/exit). The restore function (`_restoreEditorSelection`) verifies `sel.rangeCount > 0` after `addRange()` on WebKit and falls back to semantic restore if the selection was silently dropped.

### CSS Vendor Prefixes

All JS-injected styles include both prefixed and unprefixed equivalents:
- `-webkit-appearance` / `appearance`
- `-webkit-mask-*` / `mask-*`
- `-webkit-backdrop-filter` / `backdrop-filter`
- `-webkit-user-select` / `user-select` (in `editor.css`)

### `innerHTML` Comment Stripping

`innerHTML` strips HTML comments in all browsers. The raw HTML preservation system uses base64 encoding to protect comments. See `DESIGN-raw-html-preservation.md`.

### `btoa`/`atob` Latin1 Limitation

`btoa()` only handles Latin1 characters. The raw HTML preservation system uses `encodeURIComponent` + `unescape` for the full Unicode range. See `DESIGN-raw-html-preservation.md`.

### `localStorage` Quota and Private Browsing

`localStorage.setItem` may throw due to quota exhaustion or private browsing restrictions. All `setItem` calls are wrapped in try/catch. See `DESIGN-application-storage.md`.

### Fullscreen API Vendor Prefixes

Three event names (`fullscreenchange`, `webkitfullscreenchange`, `mozfullscreenchange`) and three element properties (`fullscreenElement`, `webkitFullscreenElement`, `mozFullScreenElement`) are consolidated in `_compat.fullscreenEvents` and `_compat.fullscreenElement()`.

### `scrollIntoView` Smooth Behavior

`scrollIntoView({ behavior: 'smooth' })` is used in focus mode and TOC navigation. Behavior is consistent across modern Blink/Gecko/WebKit. No workaround needed for currently supported browser versions.

### Gecko Nav Menu Item Spacing

Nav menu items in Firefox render with inconsistent vertical spacing across item types (index pages, regular pages, collapsed folders, expanded folders) while Chrome and Safari render evenly. Three factors contribute:

1. **`em`-based margins**: `margin-top: .625em` on `.md-nav__link` produces different subpixel values in Gecko due to font-size inheritance at different nesting depths.
2. **`visibility: collapse` on non-table elements**: Gecko has historically treated `visibility: collapse` differently from Blink on grid items, potentially contributing residual height even when `grid-template-rows: 0fr`.
3. **Nested list padding**: `.md-nav__list` bottom padding (`.4rem`) combined with item `margin-top` creates uneven gaps between sections.

**Fix**: Engine-conditional CSS in `_getFocusModeCSS()`, gated by `_compat.engine === 'gecko'`:
- Override `margin-top` to `9px` (fixed pixel value instead of `em`)
- Add `min-height: 0` on collapsed section child navs
- Reduce nested list `padding-bottom` to `.25rem`

See [DESIGN-layout.md](DESIGN-layout.md) "Browser-Specific Layout Normalization" section for the full pattern and override table.

### `caretRangeFromPoint` vs `caretPositionFromPoint` (Gecko)

Blink and WebKit provide `document.caretRangeFromPoint(x, y)` which returns a `Range`. Gecko provides only `document.caretPositionFromPoint(x, y)` which returns a `CaretPosition` object with `offsetNode` and `offset` properties — `caretRangeFromPoint` does not exist in Firefox. The compat method normalizes both to a `Range`:

- Blink/WebKit: return `document.caretRangeFromPoint(x, y)` directly
- Gecko: call `document.caretPositionFromPoint(x, y)`, create a `Range`, call `setStart(pos.offsetNode, pos.offset)`, collapse to start

Used by the nav menu drag-and-drop image insertion to determine where to insert the `<img>` element at the drop coordinates.

### DataTransfer Protected Mode During Drag Events

During `dragover`, `dragenter`, and `dragleave` events, the drag data store is in "protected mode" per the HTML spec. The `dataTransfer.types` array is accessible, but `dataTransfer.getData()` returns an empty string.

- Blink/WebKit/Edge: follow the spec strictly — `getData()` returns `''`
- Gecko: non-standard — allows `getData()` during drag events

The integration code must only use `e.dataTransfer.types.includes(mimeType)` in `dragover`/`dragenter` handlers. `getData()` is only called in the `drop` handler. Never rely on Firefox's non-standard early data access.

### Safari Custom MIME Type Same-Origin Restriction

Safari stores custom MIME types (non-standard types like `application/x-live-wysiwyg-asset`) in a WebKit-internal UTI (`com.apple.WebKit.custom-pasteboard-data`) and restricts access to same-origin contexts. Standard types (`text/plain`, `text/html`, `text/uri-list`) are unrestricted.

Since the nav menu drag source and the editable area drop target are on the same page, the same-origin restriction does not affect this feature. The `text/plain` fallback data set in `dragstart` is accessible even in cross-origin scenarios.

### `DataTransfer.items` Unreliable in Safari

Safari does not always populate `DataTransfer.items` during drag events. All type-checking during `dragover`/`dragenter` must use `e.dataTransfer.types` (a `DOMStringList`), never `e.dataTransfer.items`. Actual data retrieval uses `e.dataTransfer.getData()` in the `drop` handler only.

## Cross-References

- `browser-compatibility.mdc` — Rule file with coding standards for using the compat layer
- `cursor-selection-preservation.mdc` — Cardinal rule: compat layer DOM operations must preserve the browser Selection
- `upstream-websocket-wrapper.mdc` — WebSocket redirect suppression
- `DESIGN-centralized-keyboard.md` — Keyboard routing architecture (Tier 1/2/3); selection preservation contract for formatting shortcuts
- `DESIGN-layout.md` — Browser-specific layout normalization section; engine-conditional CSS pattern for fixing cross-browser rendering differences
- `DESIGN-raw-html-preservation.md` — `innerHTML` comment stripping, `btoa`/`atob` workaround
- `DESIGN-application-storage.md` — `localStorage` quota handling
- `DESIGN-focus-mode.md` — Selection preservation across DOM reparenting
- `DESIGN-popup-dialog-ux.md` — Clipboard API in dropdown dialogs
- `DESIGN-focus-nav-menu.md` — Chrome location restrictions
- `DESIGN-modes-of-operation.md` — Fullscreen API usage
- `DESIGN-unified-content-undo.md` — `execCommand('undo')` and browser undo stack
