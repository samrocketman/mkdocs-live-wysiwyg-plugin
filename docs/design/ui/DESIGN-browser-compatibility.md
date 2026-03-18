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
| `bold` | Firefox may produce `<b>` instead of `<strong>` | Post-exec: walk editable ancestor and replace `<b>` with `<strong>` |
| `italic` | Firefox may produce `<i>` instead of `<em>` | Post-exec: walk editable ancestor and replace `<i>` with `<em>` |

### `queryCommandState` Normalization (Gecko)

Firefox may report `false` for `bold`/`italic`/`strikeThrough` when the cursor is at the boundary of the formatting element, where Chrome reports `true`. The patched `queryCommandState` walks up from the anchor node looking for the corresponding element tag names.

### IME Composition Guards

All three keyboard routers check `_compat.isComposing(e)` at the top:
- **Tier 2** (`_globalKeydownRouter`): prevents shortcut dispatch during composition
- **Tier 3** (`_editorKeydownRouter`): prevents Enter/Backspace/Space handlers during composition
- **Markdown history capture**: prevents word-boundary flush during composition

Firefox-specific: `e.key === 'Dead'` and `e.key === 'Process'` are handled by `isPrintableKey()` returning `false`.

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

## Cross-References

- `browser-compatibility.mdc` — Rule file with coding standards for using the compat layer
- `upstream-websocket-wrapper.mdc` — WebSocket redirect suppression
- `DESIGN-centralized-keyboard.md` — Keyboard routing architecture (Tier 1/2/3)
- `DESIGN-raw-html-preservation.md` — `innerHTML` comment stripping, `btoa`/`atob` workaround
- `DESIGN-application-storage.md` — `localStorage` quota handling
- `DESIGN-focus-mode.md` — Selection preservation across DOM reparenting
- `DESIGN-popup-dialog-ux.md` — Clipboard API in dropdown dialogs
- `DESIGN-focus-nav-menu.md` — Chrome location restrictions
- `DESIGN-modes-of-operation.md` — Fullscreen API usage
- `DESIGN-unified-content-undo.md` — `execCommand('undo')` and browser undo stack
