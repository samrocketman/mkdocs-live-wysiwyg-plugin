# Raw HTML & HTML Comment Preservation

## Problem

Markdown documents may contain raw HTML tags and HTML comments that the WYSIWYG editor must preserve perfectly. Current behavior: `marked.parse()` passes raw HTML through to the WYSIWYG DOM, but the `_htmlToMarkdown` serializer does not recognize those elements and reconstructs them incorrectly (losing attributes, indentation, tag structure). HTML comments are stripped entirely by the browser's DOM parser (`innerHTML` discards comments). The `btoa`/`atob` Latin1 workaround for UTF-8 encoding and other browser-specific behavior is documented in [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md).

A further complication: `marked` processes content inside HTML blocks (started by tags like `<div>`) as markdown after blank lines. This means fenced code blocks, inline code, and other markdown syntax inside a `<div>` get converted to HTML elements by `marked`, then enhanced by the WYSIWYG's JavaScript (adding settings buttons, code block UI, etc.). The serializer then outputs this modified DOM, causing complete page corruption.

## Requirements

1. **Raw HTML tags** (block-level and inline) must round-trip perfectly: open tags, close tags, self-closing tags, attributes, indentation.
2. **HTML comments** (single-line and multi-line) must be preserved at their exact positions with original indentation.
3. **Markdown inside raw HTML** should be preserved. Block-level raw HTML elements are treated as opaque blobs to guarantee zero-diff. The WYSIWYG renders the HTML for visual display but marks it non-editable.
4. **Zero diff on save** when no edits are made to a document containing raw HTML.
5. **Indentation is sacred** -- original indentation of HTML tags and the markdown content within them must be preserved exactly, even if non-standard (e.g. 7 spaces).

## Architecture

The approach follows the established preprocessor/postprocessor pattern used by code blocks, list markers, table separators, and links. Raw HTML is handled at **two tiers**: block-level elements use whole-block capture, while inline elements use tag-by-tag annotation.

### Phase 1: Preprocessing (markdown -> annotated markdown)

`preprocessRawHtml(markdown)` first runs `extractRefDefsFromCommentBlocks`, then scans markdown line-by-line, skipping fenced code blocks (including indented fences inside list items) and admonition syntax lines. For each non-protected line it runs three passes in order:

#### 0. Reference definitions between HTML comments (`extractRefDefsFromCommentBlocks`)

Reference definitions between HTML comment pairs (e.g. `<!-- prettier-ignore-start -->` ... `<!-- prettier-ignore-end -->`) are not parsed by `marked` because the comment placeholders create a block context where ref defs are ignored. Before comment replacement, ref definitions between such pairs are extracted and moved to the end of the document so `marked` can resolve shortcut links like `[catalog import][catalog-import]`. The non-ref-def content between the comments is preserved; only ref def lines are moved.

#### 1a. Block-Level Raw HTML Capture (NEW)

When a line starts with a non-markdown, non-void HTML open tag (the first non-whitespace is `<tagname`), the preprocessor captures the **entire block** from the open tag to the matching close tag as a single unit.

**Strategy:** Encode the complete block (all lines from open to close, inclusive) as a single base64 string and replace with an opaque placeholder element.

```
      <div class="admonition note end">
      <p class="admonition-title">Note</p>
      Some **markdown** content with `inline code`.
      </div>
```
becomes:
```
      <div data-live-wysiwyg-raw-html-block="BASE64"></div>
```

The placeholder **preserves the original indentation** from the first line of the block. This is critical when the raw HTML is inside a list item or other indented context -- without the indentation, `marked` would see the placeholder as a top-level element, breaking the list structure.

The depth tracker `_countBlockTagDepth(line, tagName)` counts open/close tags of the same element on each line to handle nesting (e.g., `<div>` inside `<div>`). If the matching close tag is not found (unclosed block), the preprocessor falls through to the tag-by-tag approach.

**Why whole-block capture?** `marked` processes content inside HTML blocks as markdown after blank lines. Without whole-block capture, fenced code blocks and inline code inside a `<div>` get converted to HTML elements, then the WYSIWYG adds settings buttons, code block UI wrappers, etc. The serializer outputs this corrupted DOM. By encoding the entire block as base64, the content never reaches `marked` or the WYSIWYG enhancements.

#### 1b. HTML Comments (`_preprocessLineComments`)

HTML comments are invisible in the DOM (`innerHTML` strips them). Multi-line comments are especially fragile.

**Strategy:** Replace each HTML comment with an invisible placeholder element that survives `marked.parse()` and the DOM.

```
<!-- single line comment -->
```
becomes:
```
<span data-live-wysiwyg-html-comment="BASE64" style="display:none"></span>
```

The `data-live-wysiwyg-html-comment` attribute contains the base64-encoded original comment. For block-level comments (sole content on a line), the base64 includes the leading whitespace, preserving indentation. Trailing whitespace (including newlines after `-->`) is trimmed before encoding to avoid newline accumulation. The `style="display:none"` keeps it invisible in the WYSIWYG.

**Adjacent comment collapse:** When multiple block-level HTML comments span adjacent lines (with only blank lines between), they are collapsed into a single placeholder. The combined block is base64-encoded as one unit (e.g. `<!-- comment1 -->\n<!-- comment2 -->`). Trailing whitespace (including newlines after the last `-->`) is trimmed before encoding. This avoids extra block-level spacing from the DOM structure and preserves the exact newline layout when serializing back to markdown.

For multi-line comments (one `<!--` spanning to `-->` on a later line), the line-walker accumulates lines from `<!--` to `-->`, joins them, and base64-encodes the full comment (with leading whitespace for block-level) into a single `<span>` placeholder.

#### 1c. Inline Raw HTML Tags (`_preprocessLineTags`)

Raw HTML tags that are NOT standard markdown elements and appear mid-line (or on lines that didn't trigger block capture) are annotated individually.

**Strategy:** Scan each line for HTML tags using the regex `/<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(\/?)>/g`. For each match:

- Skip tags inside inline code spans (`` `...` ``).
- Skip tags known to markdown (`_isHtmlTagKnownToMarkdown` checks against: `p`, `br`, `hr`, `em`, `strong`, `del`, `s`, `strike`, `b`, `i`, `u`, `h1`-`h6`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `a`, `img`, `table`, `thead`, `tbody`, `tr`, `th`, `td`, `input`, `sup`, `sub`).
- **Open tags:** inject `data-live-wysiwyg-raw-html="BASE64"` attribute. The base64 includes leading whitespace if the tag is the first non-whitespace on the line (preserves indentation).
- **Close tags:** append a sidecar DOM comment `<!--live-wysiwyg-raw-close:BASE64-->` immediately after the close tag.
- **Self-closing tags:** inject `data-live-wysiwyg-raw-html="BASE64"` attribute (same as open tags).

**Return value:** `{ markdown: annotatedString, comments: [...], tags: [...] }`.

### Phase 2: Marked Parse (no changes needed)

`marked.parse()` passes raw HTML through unchanged. Block-level placeholders (`<div data-live-wysiwyg-raw-html-block>`) survive as empty divs. Comment placeholders and inline tag annotations also survive.

### Phase 3: WYSIWYG Display

After `marked.parse()` and DOM insertion, `populateRawHtmlBlocks(editableArea)` runs **before** all other enhancement functions:

- Finds all `[data-live-wysiwyg-raw-html-block]` elements.
- Decodes the base64 attribute and sets `innerHTML` to the decoded HTML (rendering it visually).
- Sets `contenteditable="false"` and `pointer-events: none` to prevent editing and interaction.
- Adds subtle visual styling (dashed border, reduced opacity) to indicate the block is preserved HTML.

The `enhanceAdmonitions` function skips elements inside raw HTML blocks (via `_isInsideRawHtmlBlock` check) to prevent adding settings buttons to non-interactive content.

Comment placeholders (`<span data-live-wysiwyg-html-comment>`) are hidden via `display:none`. Inline tag annotations render normally.

### Phase 4: Serialization (HTML -> markdown)

The `_nodeToMarkdownRecursive` patch detects annotated elements early in the function, before any other node-type checks:

#### 4a. Block-Level Raw HTML (highest priority)

When encountering any element with `data-live-wysiwyg-raw-html-block`:
- Base64-decode the attribute value.
- Return the decoded block verbatim + newline.
- **Do not recurse into children** -- the base64 blob is the authoritative content.

#### 4b. DOM Comment Nodes (nodeType === 8)

- If the comment has `_liveWysiwygConsumed` flag set, return `''` (already consumed by the open-tag handler).
- If the comment data starts with `live-wysiwyg-raw-close:`, base64-decode the rest and return the original close tag + newline.
- Otherwise return `''` (ignore unknown DOM comments).

#### 4c. HTML Comment Placeholders

When encountering any element (nodeType === 1) with `data-live-wysiwyg-html-comment`:
- Base64-decode the attribute value.
- Return the decoded comment verbatim + newline.

#### 4d. Inline Raw HTML Open/Self-Closing Tags

When encountering any element with `data-live-wysiwyg-raw-html`:
- Base64-decode the attribute to get the original tag string (including preserved indentation).
- Serialize child nodes, with special handling:
  - **Annotated children** (having `data-live-wysiwyg-raw-html` or `data-live-wysiwyg-html-comment`): handled by the normal recursive serializer path.
  - **Non-annotated element children**: serialized via `_serializeElementAsHtml`, preserving tag names, attributes, and inner content.
  - **Text nodes**: output `textContent` directly.
  - **Sidecar close-tag comments**: skipped (handled by close-tag search below).
- Search forward through `nextSibling` for the matching `live-wysiwyg-raw-close:` DOM comment. Decode and set `_liveWysiwygConsumed = true`.
- Return: original open tag + newline + child content + close tag + newline.

**Priority order:** `data-live-wysiwyg-raw-html-block` > `data-live-wysiwyg-html-comment` > `data-live-wysiwyg-raw-html` > all other handlers.

### Phase 5: Postprocessing

`postprocessRawHtml(markdown, rawHtmlData)` runs after `_htmlToMarkdown` and before final output. It calls `restoreRefDefsToCommentBlocks` to reverse the extraction done in Phase 1: ref definitions that were moved to the end for `marked` parsing are restored between their original HTML comment pairs (e.g. between `<!-- prettier-ignore-start -->` and `<!-- prettier-ignore-end -->`), preserving the original document structure and avoiding extra newlines.

## Data Flow

```
Original markdown
       |
       v
preprocessRawHtml()          -- block capture, annotate inline tags, replace comments
       |
       v
_markdownToHtml()            -- marked.parse (block placeholders pass through as empty divs)
       |
       v
populateRawHtmlBlocks()      -- decode & render block HTML as non-editable visual preview
       |
       v
WYSIWYG DOM                  -- user edits markdown content normally (raw HTML blocks locked)
       |
       v
_htmlToMarkdown()            -- patched serializer: blocks→decoded blob, inline→decoded tags
       |
       v
postprocessRawHtml()         -- restore ref defs between comment pairs
       |
       v
Final markdown (zero diff)
```

## Integration Points

All changes are in `live-wysiwyg-integration.js`:

1. **`preprocessRawHtml(markdown)`** -- returns `{ markdown, comments, tags }`.
2. **`populateRawHtmlBlocks(editableArea)`** -- decodes block placeholders and renders visual preview (called before all enhancement functions).
3. **`postprocessRawHtml(markdown, rawHtmlData)`** -- calls `restoreRefDefsToCommentBlocks` to restore ref defs between HTML comment pairs.
4. **`patchMarkdownToHtmlForRawHtml`** -- patches `_markdownToHtml` to run `preprocessRawHtml` before all other markdown-to-HTML patches (emoji, cursor markers). Stores the result as `this._liveWysiwygRawHtmlData`.
5. **`patchSetValueAndSwitchToModeForLinkPrePost` `switchToMode`** -- calls `postprocessRawHtml` when switching to markdown mode.
6. **`patchGetValueForListMarkers` `getValue`** -- calls `postprocessRawHtml` before returning final markdown.
7. **`_nodeToMarkdownRecursive` patch** (in `patchAdmonitionHtmlToMarkdown`) -- handles block-level raw HTML, comment placeholders, inline raw HTML, and sidecar close-tag comments.

### Helper Functions

- **`_b64Encode(str)`** / **`_b64Decode(str)`** -- UTF-8-safe base64 encoding/decoding via `btoa`/`atob` with `encodeURIComponent`/`decodeURIComponent` wrappers.
- **`_isHtmlTagKnownToMarkdown(tag)`** -- returns `true` for tags that markdown natively generates (should not be annotated).
- **`_countBlockTagDepth(line, tagName)`** -- counts open/close tags of a specific element on a single line. Open tags increment depth, close tags decrement, self-closing tags are neutral. Used by the block capture to track nesting.
- **`_isInsideRawHtmlBlock(el)`** -- walks up the DOM tree to check if an element is inside a `data-live-wysiwyg-raw-html-block` container. Used by `enhanceAdmonitions` to skip enhancement of content inside raw HTML blocks.
- **`_preprocessLineComments(line, lines, idx, comments, result)`** -- handles single-line and multi-line HTML comment detection and replacement. For block-level comments, collapses adjacent comment lines (with only blank lines between) into one placeholder. Trailing whitespace is trimmed before encoding. Includes leading whitespace in base64 for block-level comments.
- **`extractRefDefsFromCommentBlocks(markdown)`** -- moves ref definitions from between HTML comment pairs to the end of the document so `marked` can parse shortcut links.
- **`restoreRefDefsToCommentBlocks(markdown)`** -- restores ref definitions between their original HTML comment pairs when serializing back to markdown.
- **`_preprocessLineTags(line, tags, result)`** -- scans a line for all raw HTML tags (open, close, self-closing) and annotates them. Protects inline code spans from processing. Skips markdown autolinks (`<https://...>`, `<user@example.com>`).
- **`_serializeElementAsHtml(node)`** -- recursively reconstructs an element's HTML string (tag name, attributes, children). Used by the inline raw HTML serializer to preserve non-annotated child elements inside annotated tags. Strips internal `data-live-wysiwyg-*` attributes from output.
- **`populateRawHtmlBlocks(editableArea)`** -- post-DOM-insertion function that decodes block placeholders, sets innerHTML, marks as non-editable, and applies visual styling.

### Constants

- `RAW_HTML_ATTR = 'data-live-wysiwyg-raw-html'` -- inline tag annotation
- `RAW_HTML_CLOSE_PREFIX = 'live-wysiwyg-raw-close:'` -- sidecar close-tag comment prefix
- `RAW_HTML_COMMENT_ATTR = 'data-live-wysiwyg-html-comment'` -- comment placeholder
- `RAW_HTML_BLOCK_ATTR = 'data-live-wysiwyg-raw-html-block'` -- whole-block capture placeholder

## Edge Cases

- **Block-level raw HTML with blank lines**: the whole-block capture encodes everything between open and close tags, preventing `marked` from processing content after blank lines as markdown.
- **Block-level raw HTML containing markdown**: fenced code blocks, inline code, headings etc. inside raw HTML `<div>` elements are preserved verbatim (not processed by marked or WYSIWYG).
- **Unclosed block-level raw HTML**: if the depth tracker doesn't find the matching close tag, the block capture is abandoned and the line falls through to inline tag annotation.
- **Self-closing tags** (`<custom-widget/>`): detected and encoded as single units with `data-live-wysiwyg-raw-html`. No close-tag sidecar needed.
- **Inline HTML within paragraphs** (`<span class="x">text</span>`): both the open `<span>` and close `</span>` are annotated within the same line. The serializer outputs them verbatim around the text content.
- **HTML comments after reference links**: comments at the end of the document (common for linter directives) are preserved at their exact line positions.
- **Reference definitions between HTML comments**: ref defs between pairs like `<!-- prettier-ignore-start -->` and `<!-- prettier-ignore-end -->` are extracted to the end for `marked` parsing, then restored between the comments during postprocessing. `postprocessMarkdownLinks` uses a single newline (not `\n\n`) when inserting ref defs after an HTML comment line to avoid extra blank lines.
- **HTML comments within markdown blocks**: e.g., `<!-- TODO -->` between paragraphs. The placeholder `<span>` is a block-level break point.
- **Adjacent block comments**: All block-level comments (sole content on a line) collapse when adjacent (with only blank lines between). Trailing whitespace after the last `-->` is trimmed before base64 encoding.
- **Nested raw HTML**: e.g., `<div><div>markdown</div></div>`. The depth tracker correctly handles nested tags of the same type.
- **Raw HTML that matches known elements** (e.g., `<div class="admonition note">`): block capture takes priority; WYSIWYG enhancements are skipped inside raw HTML blocks.
- **Indented raw HTML**: the preprocessor captures leading whitespace in the base64 encoding. For block capture, the entire block including indentation is encoded.
- **Tags inside inline code spans**: protected by the code-span detection in `_preprocessLineTags`; they are not annotated.
- **Tags inside fenced code blocks**: protected by the line-by-line fenced-code tracker in `preprocessRawHtml`; they are not annotated. The fence regex `^(\s*)(\`{3,}|~{3,})` handles indented fences.
- **WYSIWYG enhancements inside raw HTML blocks**: `enhanceAdmonitions` skips elements inside `[data-live-wysiwyg-raw-html-block]` via `_isInsideRawHtmlBlock`. The block is marked `contenteditable="false"` and `pointer-events: none`.

## Implementation Quirks

### Block-level vs inline: two tiers of raw HTML handling

The preprocessor uses two strategies depending on where the HTML appears:

1. **Block-level** (tag is first non-whitespace on a line, not known to markdown, not void): Entire block from open tag to matching close tag is encoded as a single base64 blob in `data-live-wysiwyg-raw-html-block`. Content is never processed by `marked` or WYSIWYG enhancements. Serializer outputs the decoded blob verbatim.

2. **Inline** (tag appears mid-line, or block detection was skipped): Individual tags are annotated with `data-live-wysiwyg-raw-html` or sidecar comments. Content between tags IS processed by `marked` and editable in the WYSIWYG. Serializer reconstructs the original tags from base64 annotations.

Block capture runs BEFORE comment and inline tag processing. Lines consumed by block capture are not processed by the comment or tag handlers.

### Base64 encoding preserves indentation for both tags and comments

When a raw HTML tag or comment is the first non-whitespace on a line (i.e., it's block-level), the base64-encoded string includes the leading whitespace. For block capture, the ENTIRE block (all lines with original indentation) is encoded as-is.

For inline tags, the logic is in `_preprocessLineTags`:

```javascript
var onlyWhitespace = /^[ \t]*$/.test(prefixText);
var originalForEncode = (onlyWhitespace && lastIdx === 0) ? prefixText + fullTag : fullTag;
```

For comments, the same pattern applies in `_preprocessLineComments`. When multiple block-level comments are adjacent (with only blank lines between), they are collapsed into one encoded block. Trailing whitespace (including newlines after the last `-->`) is trimmed before encoding.

```javascript
var isBlockComment = !before.trim() && !after.trim();
// When block-level: collect adjacent comment lines, encode as one, trim trailing newlines
var originalForEncode = isBlockComment ? before + comment : comment;
```

### Close tags use sidecar DOM comments because they cannot carry attributes

HTML close tags like `</div>` have no place for a `data-*` attribute. Instead, the preprocessor appends a DOM comment immediately after:

```
</div><!--live-wysiwyg-raw-close:BASE64-->
```

### The `_liveWysiwygConsumed` flag prevents double-output of close tags

When the open-tag handler searches forward through siblings for the matching close-tag sidecar, it sets `nextSib._liveWysiwygConsumed = true`.

### UTF-8 base64 encoding uses a URI-component roundtrip

JavaScript's `btoa` only handles Latin1 characters. `_b64Encode` uses `btoa(unescape(encodeURIComponent(str)))` and `_b64Decode` uses `decodeURIComponent(escape(atob(str)))`.

### Markdown autolinks (`<https://...>`) are not raw HTML

The tag regex in `_preprocessLineTags` skips any "tag" whose content starts with `://` (URL autolink) or `@` (email autolink).

### Bare URLs are preserved by the serializer

When `marked` converts a bare URL into `<a href="url">url</a>`, the serializer detects that the link text matches the href and outputs just the bare URL text instead of wrapping it as `[url](url)`.

### Reference link definitions and HTML comments

Reference definitions between HTML comment pairs (e.g. `<!-- prettier-ignore-start -->` ... `<!-- prettier-ignore-end -->`) are extracted by `extractRefDefsFromCommentBlocks` before `marked` parses, then restored by `restoreRefDefsToCommentBlocks` in `postprocessRawHtml` when serializing. This allows shortcut links to render on initial load.

Reference link definitions are re-appended by `postprocessMarkdownLinks` when missing from the serialized output. When inserting before HTML comments, a single newline is used (not `\n\n`) when the preceding line is an HTML comment, to avoid extra blank lines.

`postprocessMarkdownLinks` checks each ref def individually by name (case-insensitive) against the result, only appending ref defs that are not already present.

`dryDuplicateInlineLinks` skips inline links where the link text matches the URL (bare URL pattern).

### Admonition type names are normalized to lowercase

The `marked.js` admonition tokenizer lowercases the type name (`match[2].toLowerCase()`).

## Testing Criteria

The user's quality check: open a document with HTML, switch between modes, save without editing. There must be **zero diff** on the HTML parts.
