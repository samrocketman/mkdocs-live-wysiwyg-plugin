# Image Insertion UI, Resize, and Settings

## Overview

Replaces the browser `<dialog>` image insertion UI with a dark dropdown matching the link-settings pattern. Adds in-WYSIWYG click-to-resize with locked aspect ratio, a gear-icon settings dropdown on every image, and full markdown round-trip for sized images.

## Image Insertion Dropdown

- Triggered by the toolbar image button (`.md-toolbar-button-image`).
- Uses the same `mousedown → savedRangeInfo → dropdown` flow as the link button.
- Dark themed dropdown (`md-image-insert-dropdown`) containing:
  - **URL** text input — accepts absolute or relative paths.
  - **Alt** text input.
  - **Size** range slider (10–100%) — percentage of the image's natural width.
  - **Insert** button.
- Dismiss on outside click or Escape key.

### Same-Origin URL Conversion

When the user types or pastes a URL whose origin matches `window.location.origin`, `_tryConvertToRelativeImageUrl` converts it to a relative path using the inverse of `resolveImageSrc`:

```
resolved absolute → pathname − parentDir pathname → relative path
```

This ensures the path round-trips correctly through `resolveImageSrc` / `data-orig-src`.

## Nav Menu Drag-and-Drop Insertion

Dragging an image asset from the focus mode nav sidebar into the editable area inserts an image, equivalent to the "Insert Image" toolbar action.

- **Drag source**: `draggable="true"` on the asset `<span>` in `_buildNavItems`. The `dragstart` handler sets a custom MIME type (`application/x-live-wysiwyg-asset`) containing the asset's `_uid`, `src_path`, `extension`, and `title`. A `text/plain` fallback is also set with the `src_path`.
- **Drop handler**: Uses `_compat.caretRangeFromPoint(e.clientX, e.clientY)` to determine the insertion position. Resolves the asset's disk path from snapshot 0 (`_navSnapshots[0].navData`) by `_uid` lookup, then computes a relative path via `computeRelativeImagePath(_getCurrentSrcPath(), diskSrcPath)` and a display URL via `resolveImageSrc(relativePath)`.
- **Image element**: `<img>` with `src`, `alt` (derived from filename), `data-orig-src` (relative path), and `data-size-syntax` (from user setting). Wrapped in `<p>` with a trailing `<p>` containing a zero-width space.
- **Post-insertion**: `enhanceImages(ea)` adds resize handles and gear. `_finalizeUpdate` syncs editor state.
- **Guard conditions**: WYSIWYG mode only. Only image assets (identified by the custom MIME type). Not available when group selection is active (`_hasAnyNavSelected()`). Snapshot 0 is the source of truth for disk paths.
- **`data-md-literal` is NOT set** — this is a toolbar-equivalent creation path. Backspace on a drag-dropped image deletes it rather than reverting to markdown.
- **History**: `_flushHistoryCapture()` is called before insertion to capture the pre-drop content state.

## `resolveImageSrc` and `data-orig-src` Round-Trip

- `resolveImageSrc(href)` resolves relative image paths via `new URL('..', document.baseURI)` to match MkDocs' directory-URL convention.
- The custom `marked` image renderer stores the original `href` in `data-orig-src` when `resolved !== href`.
- `_nodeToMarkdownRecursive` prefers `data-orig-src` over `src` so the author's original relative path is preserved in markdown output.

## Click-to-Resize

When the user clicks an `<img>` inside `editableArea`:

1. The image gets the `md-image-selected` class (blue outline).
2. A `md-image-resize-container` overlay is added to the wrapper with:
   - **4 corner handles** (`nw`, `ne`, `sw`, `se`) — each initiates a resize drag.
   - **Live dimension label** (`md-image-dimension-label`) showing `W x H`.
3. Dragging a corner handle:
   - Aspect ratio is locked: `height = width / (naturalWidth / naturalHeight)`.
   - Minimum width: 20px.
   - Both `width`/`height` HTML attributes and inline styles are updated live.
   - `_finalizeUpdate` is called on `mouseup`.
4. Clicking outside the image dismisses the selection.
5. Switching to markdown mode dismisses the selection.

## Gear Settings Dropdown

Each non-emoji image in `editableArea` is wrapped in `<span class="md-image-wrapper">` with a gear button (`.md-image-settings-btn`). The gear appears on hover/focus-within.

Clicking the gear opens a `md-image-gear-dropdown` containing:

- **Alt text** input — pre-filled from the image's current `alt`, updates on change.
- **Current dimensions** — read-only `W x H`.
- **Markdown attr syntax** checkbox — toggles between `data-size-syntax="attr"` and `"html"` (default).
- **Original size** button — removes `width`/`height`, resets inline styles.
- **Document size** button — restores `data-initial-width`/`data-initial-height` (captured on first `enhanceImages` call).

## `enhanceImages()` Lifecycle

Called in all the same locations as `enhanceCodeBlocks`:

- `patchSetValueAndGetValueForFrontmatter.setValue`
- `patchSetValueAndGetValueForFrontmatter.switchToMode` (wysiwyg branch)
- `patchSetValueAndSwitchToModeForLinkPrePost.switchToMode` (wysiwyg branch)
- `readonly_to_edit_mode_text_selection` post-processing
- Paste handling

For each `<img>` (excluding `data-emoji-shortcode` and raw HTML blocks):

1. Wrap in `<span class="md-image-wrapper" contenteditable="false">`.
2. Apply `width`/`height` as inline styles if attributes exist.
3. Capture `data-initial-width`/`data-initial-height` on first enhancement (never overwritten).
4. Compute `height` from aspect ratio if only `width` is present (attr_list images).
5. Add gear button.
6. Add click handler for resize overlay.

## Markdown Serialization

The patched `_nodeToMarkdownRecursive` handles three cases for `<img>`:

| Condition | Output |
|-----------|--------|
| No `width`/`height` | `![alt](src)\n\n` |
| `width` + `height`, `data-size-syntax="attr"` | `![alt](src){ width=N }\n\n` |
| `width` + `height`, default/html | `<img src="..." alt="..." width="N" height="N">\n\n` |

### Wrapper and Gear Skip

- `.md-image-settings-btn` — returns empty string.
- `.md-image-resize-container` — returns empty string.
- `.md-image-dimension-label` — returns empty string.
- `.md-image-wrapper` — unwraps: recursively serializes children (emits the `<img>` inside).

## Parsing `{ width=N }` (attr_list)

A regex pre-processor in the outermost `_markdownToHtml` patch converts:

```
![alt](src){ width=N }
```

to:

```html
<img src="resolved" alt="alt" width="N" data-orig-src="src" data-size-syntax="attr">
```

before passing to `marked`. This ensures the DOM has the correct attributes for `enhanceImages` to read.

## Raw HTML System: No Conflict

`img` is listed in `_isHtmlTagKnownToMarkdown`, so `<img>` tags are never captured by the raw HTML preprocessor (`_preprocessLineTags`). The WYSIWYG editor freely manipulates `<img>` elements without raw HTML interference.

## Focus Mode Compatibility

Image dropdowns and gear dropdowns use `position: fixed; z-index: 99999` to render above the focus mode overlay (`z-index: 99990`). See [DESIGN-layout.md](DESIGN-layout.md) for the authoritative z-index registry.
