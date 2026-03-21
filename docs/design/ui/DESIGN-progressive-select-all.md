# Progressive Select All — Design Document

## Overview

Progressive Select All is a context-aware Ctrl+A / Cmd+A handler that expands the selection through a hierarchy of increasingly larger scopes rather than immediately selecting the entire document. This gives users fine-grained control over what they select, and integrates with the block cut/copy system to prevent document corruption when clipboard operations encounter partial block selections.

All code lives in `live-wysiwyg-integration.js`.

## Selection Hierarchy

Repeated Ctrl+A presses walk the `targetRanges` array from smallest to largest scope. The first range not already covered by the current selection is applied.

### Range construction order

1. **Admonition body** — If the cursor is inside an admonition body (not the title), select the body content only (excludes `.admonition-title` and UI elements like `.md-admonition-settings-btn`). Built by `_buildAdmonitionBodyRange`.
2. **Ancestor selectable targets** — Walk from the cursor's element up to `ea` (editable area). For each node matching `_isSelectableTarget`, build a range via `_buildTargetRange`. This covers inline code, `<pre>`, `.md-code-block`, `.admonition`, `P`, `H1`–`H6`, `LI`, `TD`, `TH`, `UL`, `OL`, `TABLE`, `BLOCKQUOTE`.
3. **Current heading section** — If the cursor's top-level child is a heading, select from the heading through all content until the next same-or-higher-level heading. Built by `_buildHeadingSectionRange`.
4. **Parent heading sections** — Walk backwards through preceding headings at progressively higher levels (H4 → H3 → H2 → H1), each time extending from that heading through all content in its section. Built by `_buildHeadingSectionRange`.
5. **Full document** — Select the entire editable area. Built by `_buildTargetRange(ea)`.

### Node resolution

The handler resolves the anchor node to a meaningful element before building ranges:

- If the anchor is the editable area itself, find the first element child at or after the range's start offset.
- If the anchor is a whitespace-only text node, resolve to the nearest element sibling or parent.
- Text nodes resolve to their `parentNode`.

## Key Functions

### Shared helpers (top-level scope)

| Function | Purpose |
|----------|---------|
| `_isCodeUINode(n)` | Returns true for code block UI nodes (lang button, settings button, copy button, etc.) that should be excluded from selections. |
| `_isSelectableTarget(node, ea)` | Returns true for nodes that represent selectable scope boundaries: inline `CODE`, `PRE`, `.md-code-block`, `.md-code-title`, `.md-code-lang`, `.admonition`, `P`, `H1`–`H6`, `LI`, `TD`, `TH`, `UL`, `OL`, `TABLE`, `BLOCKQUOTE`, and the editable area itself. |
| `_buildTargetRange(target)` | Builds a Range covering a target element's content. For `PRE` elements, excludes code UI nodes and trailing newlines. For other elements, uses `selectNodeContents`. |
| `_buildAdmonitionBodyRange(ad)` | Builds a Range covering admonition body content only, skipping `.admonition-title` and zero-width-space text nodes. |
| `_buildHeadingSectionRange(siblings, startIdx, endIdx)` | Builds a Range from `siblings[startIdx]` through `siblings[endIdx]`. Used for heading section selection. |
| `_selectionCoversRange(sel, targetRange)` | Returns true if the current selection fully covers (is equal to or larger than) the target range. Uses `compareBoundaryPoints`. |
| `_selectionCrossesTitleBoundary(sel)` | Returns true if the selection crosses an admonition title (`.admonition-title`) or code block title (`.md-code-title`) boundary — one endpoint is inside the title, the other is outside. Used by cut/copy to gate auto-expansion (Cardinal Rule 2). |
| `_buildProgressiveRanges(sel, ea)` | Builds the ordered `targetRanges` array for a given selection and editable area. Returns the array smallest-to-largest. Single source of truth for the range hierarchy used by both Ctrl+A and cut/copy auto-expansion. |

### Handler

| Function | Purpose |
|----------|---------|
| `_ekh.progressiveSelectAll(e)` | Ctrl+A keydown handler. Calls `_buildProgressiveRanges`, walks the array, applies the first range not already covered by the current selection. |

## Cut/Copy Auto-Expansion

### Problem

When a user manually selects text that partially spans a structural element (admonition, code block, blockquote, list) and presses Cmd+X or Cmd+C, `findSelectedBlock(sel)` returns `null` because no candidate block is fully covered by the selection. The cut/copy handlers return early without `preventDefault`, letting the browser's native operation corrupt the DOM.

### Solution

The cut and copy handlers in `blockCutPasteHandler` use `_buildProgressiveRanges` to auto-expand partial selections before the clipboard operation, but **only** when the selection crosses a structurally unsafe boundary (Cardinal Rule 2). When `findSelectedBlock` returns `null`, the selection is non-collapsed, and `_selectionCrossesTitleBoundary(sel)` returns true:

1. Build `targetRanges` via `_buildProgressiveRanges(sel, ea)`.
2. Get the current selection range.
3. Walk `targetRanges` to find the first range that fully **contains** the current selection (target starts at or before current start, target ends at or after current end).
4. Apply that range and re-run `findSelectedBlock`.
5. If a block is found, proceed with block-aware clipboard handling.
6. If no block is found even at document level, allow native browser behavior (existing fallthrough).

When the selection does not cross a title boundary, no auto-expansion occurs and the browser's native cut/copy behavior is used (Cardinal Rule 1).

### "Contains" check

A target range contains the current selection when:

```
targetRange.compareBoundaryPoints(Range.START_TO_START, currentRange) <= 0
targetRange.compareBoundaryPoints(Range.END_TO_END, currentRange) >= 0
```

This is the inverse of `_selectionCoversRange` — the target range covers the current selection rather than the selection covering the target range.

## Cardinal Rules

**Rule 1.** Ctrl+C and Ctrl+X MUST honor the user's selection as-is whenever the selection does not risk corrupting the document. Progressive select-all auto-expansion on cut/copy is a safety net, not the default behavior.

**Rule 2.** If a selection crosses the boundary of an admonition title (partially inside `.admonition-title` and partially outside) or partially spans a code block title (`.md-code-title`), then Ctrl+C or Ctrl+X MUST trigger progressive select-all auto-expansion to snap the selection to the nearest enclosing structural block. Cutting or copying a partial title fragment would corrupt the block structure on paste.

**Rule 3.** Progressive select-all auto-expansion MUST NOT be triggered by any mechanism other than Ctrl+C and Ctrl+X encountering a structurally unsafe partial selection. Ctrl+A walks the hierarchy normally; typing, deletion, and other editing operations must never invoke auto-expansion.

## Relationship to Other Subsystems

- **Keyboard** (`DESIGN-centralized-keyboard.md`): `_ekh.progressiveSelectAll` is invoked from the Tier 3 editor keydown router when Ctrl+A is pressed.
- **Block Cut/Copy** (`blockCutPasteHandler` IIFE): Uses `_buildProgressiveRanges` for auto-expansion of partial selections.
- **Targeted Markdown Revert** (`targeted-markdown-revert.mdc`): When progressive select-all selects an entire admonition or code block (body + title), pressing Backspace deletes the container. This works through the existing revert handlers, not through progressive select-all itself.
- **Markdown Awareness** ([DESIGN-markdown-awareness.md](DESIGN-markdown-awareness.md)): `_isSelectableTarget` depends on enhanced DOM elements (`.md-code-block`, `.admonition`, etc.) that are created by the DOM enhancer functions. If enhancement doesn't run after a content-loading path (e.g., undo/redo), the wrapper elements don't exist and selection scoping degrades to raw `<pre>` / `<div>` elements.
