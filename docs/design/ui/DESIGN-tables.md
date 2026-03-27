# Tables — Design Document

## Overview

Tables span two code locations: `editor.js` owns the WYSIWYG DOM interactions (toolbar, insertion, alignment, settings popover) and `live-wysiwyg-integration.js` owns the markdown round-trip pipeline (preprocess/postprocess, balanced formatting, width management). This document describes both halves and how they coordinate.

For the round-trip contracts that tables share with other markdown constructs, see [DESIGN-markdown-awareness.md](DESIGN-markdown-awareness.md).

## Contextual Table Toolbar

Clicking a `<th>` or `<td>` inside the editable area activates the contextual table toolbar (`.md-contextual-table-toolbar`). The toolbar floats above the clicked cell and provides:

| Section | Buttons | Action |
|---------|---------|--------|
| Insert | Insert Row Above/Below, Insert Column Left/Right | DOM manipulation + `_finalizeUpdate` |
| Delete | Delete Row, Delete Column | Removes row/column or entire table if last one |
| Alignment | Left, Center, Right | Sets `style.textAlign` on all cells in the column |
| Settings | Gear icon | Opens the table settings popover |

Separators (`.md-ctt-separator`) visually divide the four sections.

### Delete behavior

- **Delete Row** (`_deleteRowWysiwyg`): Removes the current row. If the table has only 2 rows (header + one data row), the entire table is replaced with an empty paragraph. After deletion, focus moves to the same column in the nearest remaining row.
- **Delete Column** (`_deleteColumnWysiwyg`): Removes the column at `cellIndex` from every row. If the table has only one column, the entire table is replaced with an empty paragraph. After deletion, focus moves to the nearest remaining column in the same row.

### Activation and Dismissal

`_handleEditableAreaClickForTable` fires on every editable area click. It walks up from the click target to find a `<td>` or `<th>`, then records `currentTableSelectionInfo` (cell, row, table, indices) and shows the toolbar. Clicking outside any table cell or toolbar button dismisses the toolbar.

The toolbar ESC handler (`_handlePopupEscKey`) is registered on `document` at capture phase when the toolbar is shown, and removed when hidden. When the settings popover is open, ESC closes only the popover (not the toolbar) — a second ESC then closes the toolbar.

## Column Alignment

### Round-trip

Alignment flows through three stages:

1. **Markdown to HTML**: The `marked` renderer reads GFM alignment markers (`:---`, `:---:`, `---:`) from the separator row and emits `align` attributes on `<th>` and `<td>` elements.
2. **Normalization**: `_normalizeTableAlignAttrs(container)` converts `align` attributes to `style.textAlign` and removes the `align` attributes. This runs on every content-load path (`setValue`, `switchToMode`, `_historyApplyContent`, emoji reload).
3. **HTML to markdown**: The TABLE case in `_nodeToMarkdownRecursive` reads `_getCellAlign(cell)` (which checks `style.textAlign` first, then `align` attribute) from header cells and emits the corresponding separator markers.

### WYSIWYG editing

The alignment buttons call `_setColumnAlignment(alignment)`, which iterates all rows in the table and sets `style.textAlign` on the cell at the selected column index. Left alignment clears the style (default). The `align` attribute is always removed to prevent dual-source conflicts. `_updateAlignmentButtonStates` highlights the active alignment button by reading the header cell's alignment.

### Helper functions

| Function | Location | Purpose |
|----------|----------|---------|
| `_getCellAlign(cell)` | `editor.js` | Returns alignment from `style.textAlign` or `align` attribute |
| `_normalizeTableAlignAttrs(container)` | `editor.js` (exposed on `window`) | Converts `align` attrs to inline styles on load |

## Table Insertion

`_insertTableWysiwyg(rows, cols)` inserts a new table into the WYSIWYG DOM with the following placement logic:

1. If the cursor is in an **empty paragraph**, the paragraph is replaced by the table.
2. If the cursor is in a **non-empty block** (heading, paragraph, blockquote, list item), the table is inserted as a sibling after the block.
3. Otherwise, the table is inserted at the range position.

A trailing `<p>` with a zero-width space is always appended after the table to ensure the cursor has a landing point. This prevents tables from being absorbed into headings or other block elements.

The heading case in `_nodeToMarkdownRecursive` includes defensive splitting: if a `<table>` is found inside an `<h1>`–`<h6>` (which should never happen, but can if insertion logic fails), the table is emitted as a separate block with blank-line separation.

## Width Management

### Global width

A global table width limit (default 120 characters) is stored in `liveWysiwygSettings` under key `live_wysiwyg_table_width`. Two functions manage it:

| Function | Purpose |
|----------|---------|
| `_getGlobalTableWidth()` | Reads from settings, falls back to 120 |
| `_setGlobalTableWidth(w)` | Writes to settings |

Both are exposed on `window` for cross-file access.

### Minimal tables mode

A global boolean preference stored in `liveWysiwygSettings` under key `live_wysiwyg_minimal_tables` (default `"0"` = off). When enabled, `_formatBalancedTable` skips column expansion, producing the tightest possible ASCII table output. Capping at the max width still applies.

| Function | Purpose |
|----------|---------|
| `_getMinimalTables()` | Returns true if minimal tables mode is enabled |
| `_setMinimalTables(v)` | Writes the boolean preference |

Both are exposed on `window` for cross-file access.

### Per-table width

Individual tables can override the global width via the `data-table-width` DOM attribute. This value is:

- **Detected** by `preprocessTables` from consistently formatted tables (all rows the same length).
- **Set manually** by the user through the settings popover.
- **Auto-increased** by `_collectTableWidthsFromDOM` when content grows beyond the stored width (capped at the global limit).
- **Read** at serialize time and passed to `postprocessTables` as the effective width for formatting.

### Natural width auto-growth

`_computeNaturalTableWidth(tableEl)` computes the minimum ASCII table width from a DOM table's cell contents. It is exposed on `window` and used in two places:

1. **`_collectTableWidthsFromDOM`**: At serialize time, if a table's natural width exceeds its stored `data-table-width`, the attribute is auto-increased to `min(naturalWidth, globalWidth)`. This ensures tables expand to accommodate growing content without exceeding the global limit.
2. **`_showTableSettingsPopover`**: When the popover opens, it computes the natural width and displays `max(storedWidth, min(naturalWidth, globalWidth))`, updating the DOM attribute if the content has grown.

## Settings Popover

The settings popover (`.md-ctt-settings-popover`) is a settings dialog attached to the gear button in the contextual toolbar. It follows the [Dialog UX](DESIGN-popup-dialog-ux.md) settings dialog pattern — changes apply immediately with no explicit Apply button.

### Fields

| Field | Tab Index | Description |
|-------|-----------|-------------|
| Max width | 1 | Global max table width (number input, min 20). Saved on `change`. |
| Minimal tables | 2 | Checkbox: when enabled, tables use tightest possible widths (no expansion). Saved on `change`. |

### Keyboard behavior

Uses `_attachDialogKeyboard` with `category: 'settings'`:

- **ESC**: Dismisses the popover.
- **Enter**: Dismisses the popover.
- **Tab/Shift+Tab**: Navigates between fields in tab-index order.

### Dismissal

- **Click outside**: `mousedown` handler on `document` (capture phase) closes the popover when clicking outside the popover and gear button.
- **ESC layering**: When the popover is open, the toolbar's ESC handler defers to the popover. First ESC closes the popover; second ESC closes the toolbar.
- **Cleanup**: `_hideTableSettingsPopover` removes the `mousedown` listener from `document` and removes the popover DOM element.

## Balanced Formatting Pipeline

The formatting pipeline ensures consistent ASCII table layout on every markdown serialize. It lives in `live-wysiwyg-integration.js`.

### Preprocess (`preprocessTables`)

Runs when markdown enters the editor. Scans for GFM table blocks (header row + separator row + data rows) and stores each as:

| Field | Description |
|-------|-------------|
| `raw` | Original table text (verbatim) |
| `norm` | Whitespace-stripped content for matching |
| `detectedWidth` | Row length if all rows are the same length, else 0 |

### Postprocess (`postprocessTables`)

Runs when markdown leaves the editor. For each table in the output:

1. **Match**: Compare normalized content against preprocessed originals.
2. **Decide**:
   - Matched + all rows same length + no cursor markers + width unchanged: restore verbatim.
   - Matched + cursor markers present: reformat using current table lines (preserves markers).
   - Matched + inconsistent formatting or width changed: reformat using original lines.
   - Not matched (new or edited table): reformat using current lines.
3. **Format**: `_formatBalancedTable` produces aligned pipe columns with consistent cell padding.

### `_formatBalancedTable`

Accepts table lines and an optional width limit. Uses a dual-parse strategy:

| Parser | Function | Purpose |
|--------|----------|---------|
| Clean | `_parseTableCells` | Strips zero-width characters (`\u200B`, `\u200C`, `\u200D`); used for width math |
| Raw | `_parseTableCellsRaw` | Preserves all characters including cursor markers; used for output content |

Column widths are computed from clean cell lengths (minimum 3 per column). The formatter then adjusts widths to match the target width:

- **Capping** (total > limit): columns exceeding a fair share of available space are reduced.
- **Expansion** (total < limit): remaining space is distributed proportionally across columns based on their natural content widths. This ensures tables maintain their width after edits that reduce content.
- **Minimal mode**: when `_getMinimalTables()` returns true, expansion is skipped — columns stay at their natural widths. Capping still applies.

Padding respects alignment:

| Alignment | Padding |
|-----------|---------|
| Left (default) | Content + trailing spaces |
| Right | Leading spaces + content |
| Center | Split spaces around content |

The separator row uses alignment markers (`:---`, `:---:`, `---:`) sized to the column width.

### Cursor marker preservation

The WYSIWYG-to-Markdown mode switch (Boundary 2 in the [cursor-selection-preservation](../../../.cursor/rules/cursor-selection-preservation.mdc) cardinal rule) injects zero-width Unicode markers into the DOM before conversion: `CURSOR_MARKER` (`\u200C` x6) for selection start and `CURSOR_MARKER_END` (`\u200D` x6) for selection end. These markers flow through `_htmlToMarkdown` into the markdown text, including into table cells. Without special handling, the markers would inflate column width calculations and produce misaligned tables — or be stripped, losing the cursor position.

The dual-parse strategy ensures markers survive table formatting:

- `_parseTableCells` strips markers so they do not inflate column width calculations.
- `_parseTableCellsRaw` preserves markers so they appear in the formatted output.
- Padding is computed from clean lengths, so the formatted table has correct visual alignment despite containing invisible marker characters.
- `postprocessTables` detects cursor markers and forces reformatting (using current lines, not verbatim originals) so the markers are included in the output.

See [text-selection-architecture](../../../.cursor/rules/text-selection-architecture.mdc) for the full selection system architecture, including the independence of the three selection codepaths (read-only to edit, WYSIWYG to Markdown, focus mode transitions).

## CSS Classes

| Class | Element | Purpose |
|-------|---------|---------|
| `.md-contextual-table-toolbar` | `<div>` | Floating toolbar container |
| `.md-contextual-table-toolbar-button` | `<button>` | Individual toolbar button |
| `.md-ctt-button-active` | `<button>` | Active alignment button highlight |
| `.md-ctt-separator` | `<span>` | Visual separator between button groups |
| `.md-ctt-settings-popover` | `<div>` | Settings popover container |
| `.md-ctt-settings-label` | `<label>` | Field label in popover |
| `.md-ctt-settings-row` | `<div>` | Horizontal layout for inline label + input |
| `.md-ctt-settings-inline-label` | `<span>` | Inline text label within a settings row |
| `.md-ctt-settings-input` | `<input>` | Number input field |

## Relationship to Other Subsystems

- **Markdown Awareness** ([DESIGN-markdown-awareness.md](DESIGN-markdown-awareness.md)): Tables are one of 7 preprocess/postprocess pairs. The table pair (`preprocessTables` / `postprocessTables`) is documented in the markdown awareness design as part of the round-trip contract. The `data-table-width` attribute is listed in the `data-*` attribute bridge.

- **Dialog UX** ([DESIGN-popup-dialog-ux.md](DESIGN-popup-dialog-ux.md)): The settings popover follows the settings dialog pattern — no Apply button, changes apply immediately, Enter/ESC both dismiss, auto-focus, explicit tab order, and click-outside dismissal via `_attachDialogKeyboard`.

- **Cursor & Selection Preservation** ([cursor-selection-preservation.mdc](../../../.cursor/rules/cursor-selection-preservation.mdc)): The dual-parse strategy in `_formatBalancedTable` preserves cursor markers through table formatting, ensuring cursor position survives WYSIWYG-to-Markdown mode switches (Boundary 2) even when tables are reformatted. The table formatting pipeline is one of the few subsystems that must be explicitly aware of cursor markers because it rewrites content that may contain them.

- **Text Selection Architecture** ([text-selection-architecture.mdc](../../../.cursor/rules/text-selection-architecture.mdc)): Tables interact with the edit-mode selection codepath. The `injectMarkerAtCaretInEditable` function places markers into table cell text nodes; `_htmlToMarkdown` serializes them into the markdown table lines; `postprocessTables` and `_formatBalancedTable` must preserve them through reformatting; and `findAndStripCursorMarkerPositions` resolves them back to DOM positions after Markdown-to-WYSIWYG conversion.

- **Read-Only Selection Heuristics** ([DESIGN-readonly-selection-heuristics.md](DESIGN-readonly-selection-heuristics.md)): When the user selects text spanning table cells in the read-only rendered page and switches to edit mode, the pseudo-markdown builder (`buildPseudoMarkdown`) must produce table-like output so the selection search can locate the corresponding position in the markdown source. This is a separate codepath from the edit-mode cursor markers used in the dual-parse strategy.

- **Content History** ([DESIGN-unified-content-undo.md](DESIGN-unified-content-undo.md)): `_normalizeTableAlignAttrs` runs in `_historyApplyContent` to ensure alignment attributes are normalized after undo/redo restore.

## Rules

1. **Tables must be block-level siblings, never nested inside inline containers.** `_insertTableWysiwyg` inserts tables as siblings after block elements. The heading case in `_nodeToMarkdownRecursive` defensively splits nested tables into separate blocks.

2. **Alignment flows through `style.textAlign`, not the `align` attribute.** All content-load paths call `_normalizeTableAlignAttrs` to convert `align` to `style.textAlign`. WYSIWYG editing and markdown serialization both read and write `style.textAlign`.

3. **Unchanged, consistently formatted tables are restored verbatim.** `postprocessTables` matches table content against preprocess snapshots. Byte-for-byte restoration prevents the editor from introducing formatting diffs on content the user did not touch.

4. **Modified or inconsistently formatted tables are balanced.** `_formatBalancedTable` produces aligned pipe columns up to the effective width limit (per-table > detected > global).

5. **Per-table width auto-grows with content.** `_collectTableWidthsFromDOM` increases `data-table-width` when the table's natural minimum width exceeds the stored value, capped at the global limit. The user never sees truncated columns from a stale width setting.

6. **Cursor markers must not affect column width calculations.** `_parseTableCells` (used for width math) strips zero-width characters. `_parseTableCellsRaw` (used for output content) preserves them. This dual-parse strategy is the only mechanism that allows both cursor tracking and table formatting to coexist.

7. **The settings popover follows the Dialog UX settings pattern.** Changes apply immediately on interaction. ESC and Enter both dismiss. Click-outside dismisses. Tab navigates fields. The first input is auto-focused.
