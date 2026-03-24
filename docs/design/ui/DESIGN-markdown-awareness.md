# Markdown Awareness — Design Document

## Overview

The WYSIWYG editor operates on HTML internally but markdown is the source of truth. "Markdown awareness" is the set of mechanisms that preserve markdown fidelity through the HTML round-trip and ensure all content-loading paths produce a fully enhanced, structurally correct DOM. Multiple subsystems depend on this — any code path that sets `editableArea.innerHTML` from markdown must participate.

All code lives in `live-wysiwyg-integration.js`.

## The Round-Trip Problem

`_markdownToHtml` (marked renderer) and `_htmlToMarkdown` (DOM walker) are lossy. The HTML round-trip normalizes markdown constructs that have multiple valid representations:

- **Fence style**: `~~~` becomes `` ``` ``
- **Info-string attributes**: `title="foo"`, `linenums="1"`, `hl_lines="2 3"` are stored as `data-*` attributes on `<pre>` but `_htmlToMarkdown` must explicitly read them back
- **List markers**: `*`, `+` become `-`
- **Ordered list numbering**: `1.`, `2.`, `3.` become `1.`, `1.`, `1.`
- **Table separators**: column alignment markers are normalized
- **Horizontal rule style**: `***`, `___` become `---`
- **Inline code backtick count**: preserved via run-length fence calculation (longest backtick run + 1)
- **Reference links**: `[text][ref]` with `[ref]: url` become inline `[text](url)`
- **Raw HTML blocks**: stripped or mangled by the markdown parser

Without mitigation, editing a document in WYSIWYG mode and saving would silently rewrite the user's preferred markdown style.

## Two Pillars

### Pillar 1: Preprocess/Postprocess Round-Trip

Seven pairs of functions capture markdown-specific formatting before HTML conversion and restore it after. Each pair stores its data on the editor instance and matches blocks by content during restoration.

| Store | Preprocessor | Postprocessor | What it preserves |
|-------|-------------|---------------|-------------------|
| `_liveWysiwygCodeBlockData` | `preprocessCodeBlocks` | `postprocessCodeBlocks` | Fence style, language, title, linenums, hl_lines, indented blocks |
| `_liveWysiwygLinkData` | `preprocessMarkdownLinks` | `postprocessMarkdownLinks` | Inline vs reference links, ref definitions |
| `_liveWysiwygListMarkerData` | `preprocessListMarkers` | `postprocessListMarkers` | Marker style (`*`, `-`, `+`, `1.`) and checklist syntax |
| `_liveWysiwygTableSepData` | `preprocessTableSeparators` | `postprocessTableSeparators` | Table separator line formatting |
| `_liveWysiwygHrData` | `preprocessHorizontalRules` | `postprocessHorizontalRules` | HR style (`---`, `***`, `___`) |
| `_liveWysiwygInlineCodeData` | `preprocessInlineCode` | `postprocessInlineCode` | Multi-line inline code spans |
| `_liveWysiwygRawHtmlData` | `preprocessRawHtml` | `postprocessRawHtml` | Raw HTML blocks and comments |

**Lifecycle**: Preprocessors run when markdown enters the editor (`setValue`, `switchToMode`). Postprocessors run when markdown leaves the editor (`getValue`, `switchToMode` to markdown). The stores must always reflect the current document content — stale stores cause content-matching failures that silently lose formatting.

**Special case**: `_liveWysiwygRawHtmlData` is populated automatically inside the `patchMarkdownToHtmlForRawHtml` wrapper on `_markdownToHtml`. Any code path that calls `_markdownToHtml` gets raw HTML data for free. The other 6 stores must be refreshed explicitly.

**Ref-def extraction**: `extractRefDefsFromCommentBlocks` must run before `preprocessMarkdownLinks`. Reference definitions inside HTML comment blocks (used to hide them from the marked parser) must be extracted first so the link preprocessor can discover them.

### Pillar 2: DOM Enhancement

Six functions add interactive UI to raw HTML elements after `_markdownToHtml` produces the base HTML. Without enhancement, the WYSIWYG surface is missing critical interactive affordances and `_htmlToMarkdown` may not find expected wrapper elements.

| Function | What it adds |
|----------|-------------|
| `populateRawHtmlBlocks` | Restores raw HTML content from placeholders into the DOM |
| `enhanceCodeBlocks` | `.md-code-block` wrapper, title bar, line numbers gutter, copy button, language dropdown, settings button |
| `enhanceBasicPreBlocks` | Language button on plain `<pre>` elements without `data-*` attributes |
| `enhanceChecklists` | Interactive checkbox `<input>` elements on list items |
| `enhanceAdmonitions` | Settings button, collapsible toggle for `<details>` admonitions |
| `enhanceImages` | Resize handles, gear dropdown for image settings |

**Why enhancement matters for the round-trip**: `_htmlToMarkdown` reads the title from the `.md-code-title` element inside the `.md-code-block` wrapper. Without enhancement, no `.md-code-title` exists, and title edits made before undo cannot be read back. The `data-title` attribute on `<pre>` still holds the value set by `_markdownToHtml`, but any user edits to the title bar are lost.

## The Content-Loading Contract

Any function that loads markdown content into the WYSIWYG editable area must:

1. Parse frontmatter via `parseFrontmatter`
2. Run `extractRefDefsFromCommentBlocks` on the body
3. Refresh all 7 preprocess stores from the body markdown
4. Convert body to HTML via `_markdownToHtml`
5. Set `editableArea.innerHTML`
6. Run all 6 DOM enhancers on `editableArea`

### Code paths

| Code path | Preprocesses | Enhances | Notes |
|-----------|-------------|----------|-------|
| `setValue` (initial load) | Yes (`patchSetValueAndSwitchToModeForLinkPrePost`) | Yes (`patchSetValueAndGetValueForFrontmatter`) | Two patch layers |
| `switchToMode('wysiwyg')` | Yes (`patchSetValueAndSwitchToModeForLinkPrePost`) | Yes (`patchSetValueAndGetValueForFrontmatter`) | Markdown-to-WYSIWYG toggle |
| `_historyApplyContent` | Yes | Yes | Undo/redo content restore |
| Nav menu drag-and-drop | No | `enhanceImages` only | Single image inserted; only image enhancement needed |

## `data-*` Attribute Bridge

`_markdownToHtml` stores markdown metadata on DOM elements via `data-*` attributes. `_htmlToMarkdown` reads them back during HTML-to-markdown conversion. This bridge allows the HTML DOM to carry markdown metadata that would otherwise be lost in the round-trip.

| Attribute | Set by | Read by | Purpose |
|-----------|--------|---------|---------|
| `data-lang` | `_markdownToHtml` code renderer | `_htmlToMarkdown` PRE handler | Code block language |
| `data-title` | `_markdownToHtml` code renderer | `_htmlToMarkdown` PRE handler | Code block title |
| `data-linenums` | `_markdownToHtml` code renderer | `_htmlToMarkdown` PRE handler | Line number start |
| `data-hl-lines` | `_markdownToHtml` code renderer | `_htmlToMarkdown` PRE handler | Highlighted lines |
| `data-md-literal` | Inline typing handlers | Backspace revert handlers | Original markdown syntax for revert |

`data-md-literal` is documented in [targeted-markdown-revert.mdc](../../../.cursor/rules/targeted-markdown-revert.mdc). It is distinct from the preprocess/postprocess system — it stores the original typed markdown syntax on individual DOM elements so Backspace can revert to the literal markdown text.

## Double Render Check

`_doubleRenderCheck(markdown)` performs markdown → HTML → markdown → HTML and compares the two HTML outputs after whitespace normalization. If they differ, the markdown content would be corrupted by a round-trip.

Previously used by the Content History subsystem to gate history capture (skipping when the check failed). This is **no longer used for history capture gating** — the Content History subsystem now uses always-on HTML snapshots to eliminate round-trip drift entirely (see [DESIGN-unified-content-undo.md](DESIGN-unified-content-undo.md) Rule 6). The double render check remains available for initial content-load validation and diagnostic purposes.

## Markdown Round-Trip Fidelity Check

`_markdownRoundTripFaithful(markdown)` performs markdown → HTML → markdown and compares the normalized results. Unlike the double render check (which compares two HTML outputs), this compares two markdown outputs to detect when markdown content cannot survive the HTML round-trip.

The function strips YAML frontmatter before testing (frontmatter is not markdown and causes false negatives). Returns `true` for empty or whitespace-only bodies.

Used for diagnostic logging in the Content History subsystem but does **not** gate capture or snapshot creation. All WYSIWYG history nodes unconditionally capture HTML snapshots regardless of this check's result.

## Relationship to Other Subsystems

- **Content History** ([DESIGN-unified-content-undo.md](DESIGN-unified-content-undo.md)): The DAG captures markdown via `getValue()` (which runs postprocessors) and restores via `_historyApplyContent` (which must run preprocessors + enhancers per the content-loading contract). Every WYSIWYG-mode node also stores an HTML snapshot (`editableArea.innerHTML`) unconditionally, which is used as the primary restore mechanism in WYSIWYG mode — bypassing `_markdownToHtml` entirely to eliminate round-trip drift. DOM enhancers still run after snapshot restore for re-initialization of interactive elements (mermaid preview re-rendering, event handler re-attachment). The undo system is aware of markdown construct boundaries when capturing intermediate typing states: pre-flush before block conversions captures literal markdown syntax (e.g. `` ```mermaid ``) as HTML snapshot nodes, preserving the exact DOM even though the markdown parser would reinterpret the syntax on round-trip. This ensures undo can walk through every intermediate state including partially-typed markdown constructs that straddle code block fence boundaries.

- **Progressive Select All** ([DESIGN-progressive-select-all.md](DESIGN-progressive-select-all.md)): `_isSelectableTarget` must recognize all enhanced DOM elements (`.md-code-block`, `.admonition`, etc.) for the selection hierarchy to work correctly. If enhancement doesn't run after content restoration, the wrapper elements don't exist and selection scoping degrades to raw `<pre>` / `<div>` elements.

- **Targeted Markdown Revert** ([targeted-markdown-revert.mdc](../../../.cursor/rules/targeted-markdown-revert.mdc)): `data-md-literal` is a markdown awareness mechanism — it stores the original markdown syntax on DOM elements so Backspace can revert to it. This is independent of the preprocess/postprocess system.

## Rules

1. **Every content-loading code path must refresh preprocess data and run DOM enhancers.** If a function sets `editableArea.innerHTML` from markdown, it must update all 7 `_liveWysiwyg*Data` stores and call all 6 enhance functions. Partial loading (setting innerHTML without preprocessing or enhancing) is a bug.

2. **Preprocess stores must match the current content.** Stale stores cause content-matching failures in postprocessors, which can silently lose formatting (e.g., advanced code block fences degrading to basic fences).

3. **DOM enhancers must run after every `innerHTML` assignment in WYSIWYG mode.** Without enhancement, code blocks lack `.md-code-block` wrappers, checklists lack interactive checkboxes, admonitions lack settings buttons, and images lack resize handles.

4. **`extractRefDefsFromCommentBlocks` must run before preprocessing.** Reference definitions inside HTML comment blocks must be extracted before `preprocessMarkdownLinks` can discover them.

5. **`_liveWysiwygRawHtmlData` is updated inside `_markdownToHtml` automatically.** Code paths that call `_markdownToHtml` get raw HTML data for free. The other 6 stores must be refreshed explicitly.

6. **Progressive Select All depends on enhanced DOM.** `_isSelectableTarget` recognizes `.md-code-block`, `.admonition`, and other enhanced wrappers. If enhancement doesn't run, the selection hierarchy degrades to raw elements and the cut/copy auto-expansion chain can break.

7. **New preprocess/postprocess pairs must be added to all content-loading paths.** If a new pair is introduced, it must be added to `setValue`, `switchToMode`, `_historyApplyContent`, and `getValue`.

8. **Ordered list numbering style must be preserved across WYSIWYG ↔ Markdown transitions.** If the document uses repeating `1.` markers (the `all-ones` style detected by `preprocessListMarkers`), then switching to markdown via `_htmlToMarkdown` and back must reproduce repeating `1.` markers — never incrementing `1.`, `2.`, `3.`. The `olStyle` field in `_liveWysiwygListMarkerData` records the document's style; `postprocessListMarkers` must honor it.

9. **New ordered lists must follow the document's existing numbering style.** When a document contains any repeating `1.` ordered lists (`olStyle === 'all-ones'`), newly inserted ordered lists (via toolbar, inline typing, or any other mechanism) must use repeating `1.` markers to match. Do not mix incrementing and repeating styles within a single document.
