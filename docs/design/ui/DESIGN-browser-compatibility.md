# Browser Compatibility — Design Document

## Overview

This document serves as a centralized catalog of browser-specific quirks and workarounds used by the WYSIWYG plugin. Browser conditionals are currently scattered across the codebase. The full inventory will be populated as browser-specific code is identified during future refactoring.

## Known Quirks

### Chrome

- **Location object non-configurable properties**: `window.location` properties (`reload`, `assign`, `replace`, `href`) are non-configurable on the `Location` prototype. `Object.defineProperty(location, ...)` throws `TypeError`. Direct assignment is silently ignored. See `chrome-location-restrictions.mdc` and the WebSocket redirect suppression in `upstream-websocket-wrapper.mdc`.
- **contenteditable selection handling**: Differences in how `contenteditable` elements handle selection and cursor placement compared to other browsers.

### Safari

- **Range/Selection API variations**: Safari may exhibit different behavior for `Range` and `Selection` APIs, particularly around `contenteditable` and reparented DOM nodes.

### Firefox

- **execCommand behavior differences**: `document.execCommand` may behave differently for bold, italic, and other formatting commands.

### All Browsers

- **Clipboard API variations**: `navigator.clipboard` availability and behavior differ across browsers and contexts (secure vs non-secure, user gesture requirements).
- **IME composition handling**: Input method editor (composition) events and cursor behavior during composition vary. Care must be taken to avoid firing handlers mid-composition.

## Future Direction

Refactor browser conditionals into centralized detection and abstraction. As browser-specific code is identified during future refactoring, add entries to this catalog and consider introducing a small compatibility layer (e.g., `_browserCompat` or similar) to isolate workarounds.
