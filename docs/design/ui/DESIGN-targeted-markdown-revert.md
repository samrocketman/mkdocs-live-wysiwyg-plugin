# Targeted Markdown Revert on Backspace

## Problem

The WYSIWYG editor allows users to create block and inline elements two ways: by typing markdown syntax directly (e.g., `# `, `> `, `` ``` ``, `**text**`) or by using WYSIWYG toolbar buttons. When an element is empty and the user presses Backspace, the editor reverts the element to its markdown text form so the user can re-edit the syntax.

However, this revert-to-markdown behavior is inappropriate for toolbar-created elements. A user who clicked a toolbar button to create a heading never typed `# ` and would not expect to see `# ` appear when they backspace. For toolbar-created elements, Backspace should simply delete the element.

## Terminology

- **Inline markdown typing**: the user types markdown syntax directly in the WYSIWYG editor (e.g., `# ` for heading, `> ` for blockquote, `` ``` `` for code block, `**text**` for bold). The editor auto-converts the syntax into the rendered element.
- **Toolbar creation**: the user clicks a toolbar button or uses a menu to insert an element (e.g., heading dropdown, bold button, code block button).
- **Revert**: replacing the element with a `<p>` containing the original markdown syntax text, allowing the user to re-edit it.
- **Delete**: removing the element entirely, replacing it with an empty `<p><br></p>`.
- **Unwrap**: for inline elements, removing the formatting node but keeping the text content as plain text.

## Discriminator: `data-md-literal`

The `data-md-literal` attribute is the discriminator between the two creation paths:

| Creation path | `data-md-literal` set? | Backspace behavior |
| ------------- | ---------------------- | ------------------ |
| Inline markdown typing | Yes (stores the original syntax) | Revert to markdown |
| Toolbar button | No | Delete / unwrap |
| Document load (markdown-to-HTML) | No | Delete / unwrap |
| Mode switch (WYSIWYG → Markdown → WYSIWYG) | No (lost in round-trip) | Delete / unwrap |

### Where `data-md-literal` is set

All inline markdown typing handlers set `data-md-literal` on the created element:

| Handler | Element | Example literal |
| ------- | ------- | --------------- |
| Triple backtick (~line 6763) | `<pre>` | `` ``` `` |
| Single/double backtick (~line 6634) | `<code>` | `` `text` ``, ` `` text `` ` |
| `doHeading` (~line 7297) | `<h1>`–`<h6>` | `# `, `## `, etc. |
| `doBlockquote` (~line 7312) | `<blockquote>` | `> ` |
| `doAdmonition` (~line 7354) | `<div.admonition>`, `<details>` | `!!! note `, `??? note `, `???+ note ` |
| `doList` (~line 7377) | `<ul>`, `<ol>` | `- `, `* `, `1. `, `- [ ] `, `- [x] ` |
| `handleListToChecklist` (~line 7425) | `<ul>` | `- [ ] `, `- [x] ` |
| `handleHorizontalRule` (~line 7454) | `<hr>` | `---`, `***`, `___` |
| `doInlineWrap` (~line 7575) | `<strong>`, `<em>`, `<del>` | `**text**`, `*text*`, `~~text~~` |
| `handleCloseParen` (~line 7544) | `<a>` | `[text](url)` |

### Where `data-md-literal` is NOT set

- `_insertCodeBlock` (toolbar code block)
- `insertAdmonition` (toolbar admonition)
- `_wrapSelectionInBlockquote` (toolbar blockquote)
- `createListInContainer` (toolbar list)
- `createLinkDropdown` / `doApply` (toolbar link)
- `execCommand('bold')`, `execCommand('italic')`, `execCommand('strikeThrough')` (toolbar inline formatting)
- `execCommand('formatBlock')` (toolbar headings, blockquotes)
- `execCommand('insertHorizontalRule')` (toolbar HR)
- `_markdownToHtml` / `marked.parse()` (document load, mode switch)
- Nav menu drag-and-drop image insertion (drop handler in editableArea)

All `execCommand` calls in the integration script use the compat layer. See [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md) for cross-browser contenteditable and execCommand behavior.

## Backspace Behavior

### Block elements

When a block element is empty and the user presses Backspace:

- **`data-md-literal` present**: Replace the element with `<p style="white-space: pre-wrap">` containing the stored literal. Cursor placed at end. This is the **revert** path.
- **`data-md-literal` absent**: Replace the element with `<p><br></p>`. Cursor placed at start. This is the **delete** path.

Applies to: headings, blockquotes, admonitions, details/collapsible, single-item lists, checklists, code blocks, horizontal rules.

### Inline elements

When the cursor is at a revert position (start, end, or immediately after a zero-width space) of an inline element and the user presses Backspace:

- **`data-md-literal` present**: Replace the element with a text node containing the stored literal (e.g., `` `text` ``). Cursor placed at end.
- **`data-md-literal` absent**: Replace the element with a text node containing just the plain text content (no markdown markers). This is the **unwrap** path.

Applies to: `<code>`, `<strong>`/`<b>`, `<em>`, `<del>`, `<a>`.

### Code block (separate handler)

The code block has a separate backspace handler (~line 8118) outside `handleRevertOnBackspace`. It fires when the code content is empty (`''` or `'\n'`):

- **`data-md-literal` present on `<pre>`**: Remove code block, insert `<p>` with the literal. Cursor at end.
- **`data-md-literal` absent**: Remove code block, insert `<p><br></p>`. Cursor at start.

### Horizontal rule

The HR handler fires when the cursor is in an empty `<p>` immediately after an `<hr>`:

- **`data-md-literal` present on `<hr>`**: Remove both HR and empty P, insert `<p>` with literal. Cursor at end.
- **`data-md-literal` absent**: Remove only the HR, keep the existing empty P. Cursor at start of the P.

## `setAdmonitionType` Guard

When the user changes an admonition's type via the settings dropdown, `setAdmonitionType` (~line 1382) updates `data-md-literal` to reflect the new type. This update must only occur if `data-md-literal` already exists on the element:

```javascript
if (adEl.hasAttribute('data-md-literal')) {
  adEl.setAttribute('data-md-literal', prefix + newType + ' ');
}
```

Without this guard, changing the type of a toolbar-created admonition would give it `data-md-literal`, incorrectly switching it to the "revert" path.

## Admonition Collapsible Conversion

`convertToCollapsible` (~line 1277) and `convertToNonCollapsible` (~line 1304) correctly copy `data-md-literal` from the old element to the new one only if it exists. No changes needed.

## Edge Cases

- **Mode switch**: `data-md-literal` is not preserved through WYSIWYG → Markdown → WYSIWYG round-trips because `_markdownToHtml` (via `marked.parse()`) does not set it. After a mode switch, all elements behave as toolbar-created (delete on backspace).
- **Document reload**: Same as mode switch. Elements loaded from the markdown source do not receive `data-md-literal`.
- **Nested containers**: A toolbar-created admonition containing an inline-typed blockquote: the admonition deletes on backspace, the blockquote reverts. Each element's behavior is independent based on its own `data-md-literal`.

## Handler Locations

| Handler | Location | Scope |
| ------- | -------- | ----- |
| `handleRevertOnBackspace` | ~line 7603 | Inline elements, checklist, heading, blockquote, admonition, details, list, HR |
| Code block backspace | ~line 8118 | Empty code block revert/delete |
| `setAdmonitionType` guard | ~line 1382 | Prevents toolbar admonitions from gaining `data-md-literal` |
