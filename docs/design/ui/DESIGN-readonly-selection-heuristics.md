# Read-Only to Edit Mode: Text Selection Heuristics

## Problem

When a user selects text in the **read-only rendered HTML page** and then switches to **edit mode** (WYSIWYG or Markdown), the selection must be preserved. This is non-trivial because:

1. **Rendered HTML ≠ Markdown source.** Markdown formatting characters (`` ` ``, `#`, `**`, etc.) are absent in the rendered output. Selecting `Ctrl+A` in rendered HTML corresponds to `` `Ctrl+A` `` in the markdown source.
2. **Non-text elements.** Emoji images (`<img data-emoji-shortcode="heart_eyes">`) render visually but have no text content in `range.toString()`. Browser-specific behavior of `Range.toString()` and the selectionchange API is documented in [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md).
3. **Embedded `<script>` and `<style>` tags.** The plugin injects CSS and JS inside the `<article>` element. DOM methods like `root.textContent` include this source code, corrupting context.
4. **Headerlink anchors.** MkDocs renders `<a class="headerlink">¶</a>` inside headings. The `¶` character appears in `range.toString()` but has no markdown equivalent.
5. **Whitespace differences.** Rendered HTML has single newlines (or none) between block elements; markdown uses `\n\n`. `range.toString()` whitespace does not match markdown whitespace.
6. **Arbitrary HTML structure.** MkDocs plugins can inject custom HTML that differs from the markdown source in unpredictable ways.

## Design Principle

Read-only selection handling and edit-mode selection handling (WYSIWYG ↔ Markdown toggle) are **always treated as separate, independent codepaths**. Changes to one must never affect the other.

## Architecture

### Step 1: Build Pseudo-Markdown from DOM

`buildPseudoMarkdown(root)` walks the read-only DOM and reconstructs a best-effort markdown document. This pseudo-markdown closely mirrors the actual markdown body, providing a bridge between the rendered HTML and the source.

**Element conversions:**

| HTML Element | Pseudo-Markdown Output |
|---|---|
| `<h1>` ... `<h6>` | `# ` ... `###### ` prefix + `\n\n` |
| `<p>` | `\n\n` ... `\n\n` |
| `<strong>`, `<b>` | `**` ... `**` |
| `<em>`, `<i>` | `*` ... `*` |
| `<code>` (inline) | `` ` `` ... `` ` `` |
| `<img data-emoji-shortcode>` | `:shortcode:` |
| `<img>` (other) | alt text |
| `<ul>` / `<ol>` / `<li>` | `- ` or `1. ` prefixed items |
| `<blockquote>` | `> ` prefix |
| `<pre>` | Fenced code block (` ``` `) |
| `<hr>` | `---` |
| `<br>` | `\n` |

**Skipped elements:**

- `<script>`, `<style>`
- `<a class="headerlink">` (the `¶` anchor)
- `<td class="linenos">` (code block line numbers)
- Editor UI classes (`.live-edit-controls`, `.live-edit-source`, etc.)

**Hash table:** Non-text elements (`<img>`) are tracked in a hash table mapping to known WYSIWYG equivalents (e.g., emoji shortcodes). The shortcode text is written directly into the pseudo-markdown output.

**Inter-block whitespace:** Text nodes containing only whitespace between block elements are skipped to avoid duplicating the newlines that `ensureTrailingNewlines` already manages.

### Step 2: Build Searchable Text

`buildSearchable(text)` takes a markdown string (the actual body or the pseudo-markdown) and produces a whitespace-normalized, formatting-stripped version with a position map back to the original. This allows selections that span across block boundaries (lists, blockquotes, headings, etc.) to match, since `range.toString()` returns plain text without structural markers.

**Stripping rules (at line start):**

- Heading markers (`# ` through `###### `)
- Blockquote markers (`> `, including nested `> > `)
- Unordered list markers (`- `, `+ `, `* `)
- Ordered list markers (`1. `, `2. `, etc.)
- Indented list markers (`  - `, `  + `, `  * `, `  N. `, `    - `, etc., for nested lists)
- Indent (4 spaces, for code blocks / nested content)
- Admonition lines (`!!! type` or `??? type` / `???+ type` — entire line skipped)

**Stripping rules (anywhere):**

- HTML comments (`<!-- ... -->`) — skipped entirely so invisible content does not block matches
- Backticks (inline code delimiters)
- `**` (bold markers)
- All whitespace collapsed to single spaces

**Output:** `{ text: normalizedString, posMap: [originalIndex, ...] }` where `posMap[i]` gives the index in the original string for character `i` in the searchable string.

### Step 3: Normalize Selected Text

`normalizeForSearch(text)` prepares the user's selected text (from `range.toString()`) for matching:

1. Strip `¶` characters (from headerlink anchors)
2. Collapse all whitespace to single spaces
3. Trim

### Step 4: Body Source for Search

**Critical:** Both `applyPendingReadModeSelection` and `readonly_to_edit_mode_text_selection` must use `markdownArea.value` when available, not `editor.getValue()`.

When in WYSIWYG mode, `getValue()` returns `_htmlToMarkdown(editableArea)` — the serialized DOM. The raw HTML handling patches replace raw HTML blocks with placeholders (e.g. `\u0000__RAWHTMLBLOCK_0__\u0000`). Searching for the user's selected text in that serialized output fails because the actual text may be inside a placeholder. `markdownArea.value` holds the source markdown used to render the editor (including raw HTML), so the search runs against the correct content.

### Step 5: Search and Map Back

`readonly_to_edit_mode_text_selection(editor)` orchestrates the search in tiers:

```
readonly_to_edit_mode_text_selection(editor)
│
├─ Tier 0: applyPendingReadModeSelection(editor)
│   └─ Existing behavior: direct markdown search + emoji shortcode conversion
│      Returns true → done (no pseudo-markdown built)
│
├─ Tier 1: Search actual markdown body directly
│   └─ buildSearchable(body) → searchable body
│   └─ findInSearchable(searchable, normSel, normCtx)
│   └─ posMap maps hits back to body positions
│
├─ Tier 1b: Same with emoji shortcode conversion
│
├─ Tier 2: Build pseudo-markdown from DOM, cross-reference
│   └─ buildPseudoMarkdown(articleEl) → pseudo-md
│   └─ buildSearchable(pseudo-md) → searchable pseudo-md
│   └─ Find normSel in searchable pseudo-md
│   └─ Extract the matching substring from the pseudo-md (WITH formatting)
│   └─ Search that formatted substring in the actual body
│   └─ Falls back to normalized search if exact match fails
│
└─ Apply selection to editor
    └─ Discard pseudo-markdown and searchable structures
```

### Disambiguation

`findInSearchable` handles multiple matches by scoring each against the normalized context (`contextBefore`, `contextAfter`) using suffix/prefix overlap scoring, same as `findSelectedTextInContent`.

### Selection Application

Once positions in the markdown body are determined:

- **Markdown mode:** `textarea.setSelectionRange(start + frontmatterLen, end + frontmatterLen)`
- **WYSIWYG mode:** Insert `CURSOR_SPAN_ATTR` / `CURSOR_SPAN_ATTR_END` marker spans into the markdown at the found positions, convert to HTML via `_markdownToHtml`, then resolve marker spans to DOM Range positions via `findAndStripCursorMarkerPositions`.

### Supporting Fixes

| Function | Fix |
|---|---|
| `rangeToTextWithImgAlt` | Skips `SCRIPT` and `STYLE` nodes when extracting text from a cloned Range fragment |
| `visibleTextContent(el)` | Extracts `textContent` excluding `<script>` and `<style>` descendants |
| `getSelectionContext` | Uses `visibleTextContent(root)` instead of `root.textContent` |

## Why This Works

The core insight is that most inline text in rendered HTML is an exact substring of the markdown source — the markdown just has *extra* characters (formatting markers). By stripping those extras from both the markdown body and the pseudo-markdown, and normalizing whitespace, we can match `range.toString()` output against either representation. When we find a match in the pseudo-markdown, we extract the *formatted* substring (with `#`, `**`, `` ` `` intact) and search for it in the actual body — a high-precision match since it includes the formatting.

**Cross-element selection:** When the user selects text spanning multiple blocks (e.g., from the end of one list item to the start of another, or across a heading and paragraph), `range.toString()` returns concatenated plain text without list markers, blockquote prefixes, or other structural syntax. `buildSearchable` strips these block-level markers at line boundaries so the searchable text aligns with what the user selected.

**Raw HTML:** HTML comments (`<!-- ... -->`) are invisible in the rendered page but appear in the markdown source. `buildSearchable` skips them entirely so selections that traverse across comments (e.g., from a heading through a comment to a list item) match correctly.

## Relationship to Edit-Mode Selection

The **edit-mode selection system** (WYSIWYG ↔ Markdown toggle) is completely separate and must remain so:

- Uses zero-width Unicode cursor markers injected into the DOM
- Uses `CURSOR_SPAN_ATTR` HTML spans spliced into markdown source
- Uses `capturedMarkdownSelection` for textarea blur persistence
- Uses `restoreSelectionFromSemantic` as a fallback

None of these mechanisms are used or affected by the read-only selection heuristics.

## Integration with Raw HTML Handling

The raw HTML preservation patches (`preprocessRawHtml`, `_nodeToMarkdownRecursive` placeholders) interact with selection in two ways:

1. **Markdown → WYSIWYG (edit-mode selection):** Cursor span markers (`<span data-live-wysiwyg-cursor></span>`) must be converted to placeholders *before* `preprocessRawHtml` runs. Otherwise `_preprocessLineTags` wraps them as raw HTML, and the cursor marker patch never sees them. The raw HTML patch therefore replaces cursor spans with `LIVEWYSIWYG_CURSOR_9X7K2` / `LIVEWYSIWYG_CURSOR_END_9X7K2` at the start of its `_markdownToHtml` wrapper.

2. **WYSIWYG → Markdown (serialization):** Cursor spans must be stripped during `_nodeToMarkdownRecursive` and `_serializeElementAsHtml`. When a cursor span was wrapped by raw HTML preprocessing, its matching close-tag comment (`<!--live-wysiwyg-raw-close:...-->`) must also be suppressed — otherwise `</span>` leaks into the markdown output.
