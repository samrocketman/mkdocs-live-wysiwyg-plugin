# Keyboard Shortcuts and Behaviors

## Edit and Save

- Pressing period (`.`) in read mode (before opening the editor) opens the editor, similar to GitHub's keyboard shortcut.
- **Ctrl+S** (Windows/Linux) / **Cmd+S** (Mac) saves the document.

## Progressive Select All (Ctrl+A / Cmd+A)

Repeated presses expand the selection through a context-aware hierarchy:

1. Inside a **code block or admonition**: selects all code content (excludes UI elements).
2. Inside a **code block or admonition**: selects all content and title. **Pressing backspace** will delete the entire admonition or code block in this state.
3. Inside an **inline code** span: selects the inline code, then the containing paragraph.
4. On a **paragraph or heading**: selects the full element text.
5. Expands to all content under the **current section** heading.
6. Continues expanding up through **parent heading levels** (H4 -> H3 -> H2 -> H1).
7. Finally selects the **entire document**.

## Markdown Auto-Conversions

Typing markdown syntax in the WYSIWYG editor automatically converts it to the corresponding formatted element. The cursor is placed inside the new element so you can keep typing.

### Block-Level

| You type | Result |
|----------|--------|
| `# ` through `###### ` | Heading 1 through Heading 6 |
| `> ` | Block quote |
| `- ` or `* ` | Unordered list |
| `- [ ] ` or `* [ ] ` | Checklist (unchecked) |
| `- [x] ` or `* [x] ` | Checklist (checked) |
| `[ ] ` or `[x] ` in a single-item empty list | Converts list to checklist |
| `1. ` (any number) | Ordered list |
| `---`, `***`, or `___` | Horizontal rule (always inserts `---`) |
| `!!! ` or `!!! type ` | Admonition (note or specified type) |
| `??? ` or `??? type ` | Collapsible admonition (note or specified type) |

Block-level conversions trigger when you type the pattern at the start of an empty paragraph. For headings and lists, any remaining text after the prefix is preserved. Admonition types include: note, danger, warning, tip, hint, important, caution, error, attention, abstract, info, success, question, failure, bug, example, quote. Type `!!! ` then backspace to revert to the literal, then type a type name and space (e.g. `!!! danger `) to create that admonition type.

- **Backspace** on an empty converted element (heading, blockquote, admonition, list item, or the paragraph after a horizontal rule) reverts it to the original literal characters, including the trailing space where you typed one (e.g. `## ` restores `## `, not `##`). The cursor is placed at the end of the restored text.

### Inline

| You type | Result |
|----------|--------|
| `**text**` or `__text__` | **Bold** |
| `*text*` or `_text_` | *Italic* |
| `~~text~~` | ~~Strikethrough~~ |
| `` `text` `` | `Inline code` |
| `[text](url)` | [Link](url) |

Inline conversions trigger when you type the closing delimiter. The wrapped text must not be empty and must not start or end with a space. The cursor is placed immediately after the formatted element.

## Code Blocks

- Typing **three backticks** automatically inserts a basic code block.
- Wrapping a word or set of words with a **pair of backticks** converts it into inline code.
- **Enter** (3×) at the end of a code block exits onto a new paragraph. Trailing blank lines are removed. Pressing Enter in the middle of code content will never trigger an exit.
- **Backspace** on a completely empty code block deletes it.
- **Tab** inserts the configured indent (spaces or tab character) at the cursor.
- **Lang button** (upper-right) sets the code language. Custom languages are supported—type any name and press Enter.
- **Gear button** (next to lang) configures auto-indent: toggle on/off, choose spaces or tabs, and set indent size (2, 4, or 8). Settings persist across pages via cookie.

### Advanced Code Blocks (with title)

- **Enter** at the beginning of the title inserts a new paragraph before the code block.
- **Enter** elsewhere in the title (or on an empty title) moves the cursor into the code body.
- **Backspace** at the beginning of the title with content is a no-op.
- **Backspace** on an empty title converts the advanced code block to a basic one (no title or language).

## Admonitions

- The **gear button** on an admonition opens settings: change **Type** (note, danger, warning, etc.), placement (standalone/inline), collapsible, collapsed, and hide title. Switching type preserves all content, title, and other settings.
- **Enter** (3×) at the end of admonition body content exits onto a new paragraph. Trailing empty paragraphs are cleaned up.
- **Backspace** on an admonition with an empty body deletes the entire admonition.
- Exiting a list inside an admonition requires only a single enter press to exit the admonition if the list is at the end.

### Admonition Titles

- **Enter** at the beginning of the title inserts a new paragraph before the admonition.
- **Enter** elsewhere in the title moves the cursor into the admonition body. On an empty title, the default type name is restored (e.g., "Note").
- **Backspace** at the beginning of the title (with or without content) is a no-op.

## Block Quotes

- **Enter** (3×) at the end of a block quote exits onto a new paragraph.
- Exiting a list, admonition, or code block inside a block quote lands inside the block quote (not outside it). Each nested exit grants credit—only one more Enter is needed to exit the block quote (if the line is blank). If the block quote is inside an admonition, exiting the block quote grants admonition credit—one more Enter exits the admonition.
- Code blocks and admonitions can be inserted inside block quotes and vice versa (indefinite nesting).
- Content inside block quotes does not inherit block quote italic/color styling.

## Lists

- **Enter** (2×) on an empty list item at the end of the list exits the list. This works for unordered, ordered, and checklists.
- Items can be added in the middle of a list without triggering the exit behavior.

## Inline Code

- Clicking the **Inline Code** toolbar button toggles inline code off if the cursor is on existing inline code or the selection spans multiple inline code elements.

## Emoji :heart_eyes:

Emoji :100: shortcodes (e.g. `:heart_eyes:`, `:white_check_mark:`) or 💯 unicode is supported. Unicode emoji already present in the document are preserved as-is.

### Shortcode Completion

- Typing `:` followed by at least **2 characters** opens an autocomplete popup with matching emoji. Continue typing to narrow results.
- Typing the closing `:` of a valid shortcode (e.g. `:fire:`) immediately converts it to the emoji image.
- **Arrow Up / Arrow Down** navigates the autocomplete list (the focused item scrolls into view).
- **Enter** or **Tab** inserts the selected emoji.
- **Escape** dismisses the autocomplete popup.
- Clicking an item in the popup inserts that emoji.

### Emoji Picker (Ctrl+Space / Cmd+Space)

- **Ctrl+Space** (Windows/Linux) / **Cmd+Space** (Mac) opens the full emoji picker at the cursor position.
- Type to filter the list by name.
- **Backspace** removes filter characters; clearing the filter shows all emoji again.
- **Arrow Up / Arrow Down**, **Enter / Tab**, **Escape**, and click work the same as shortcode completion.
- If a trailing `:` is present before the cursor (e.g. after typing a colon and then pressing Ctrl+Space), inserting an emoji replaces the colon.
- The picker is disabled inside code blocks.

### Rendering

- Shortcodes are rendered as `<img>` tags using the Emojione CDN, matching the MkDocs pymdownx.emoji output:

  ```html
  <img alt="😍" class="emojione" src="https://cdnjs.cloudflare.com/ajax/libs/emojione/2.2.7/assets/svg/1f60d.svg" title=":heart_eyes:">
  ```

- Shortcodes inside fenced code blocks, inline code, and `<pre>` / `<code>` elements are not converted.
- Unicode emoji in the original markdown are left untouched—they are not converted to shortcodes or images and will round-trip through the editor without creating a git diff.

### Mode Switching

- Switching from **WYSIWYG → Markdown** converts emoji images back to their `:shortcode:` text.
- Switching from **Markdown → WYSIWYG** converts `:shortcode:` text back to emoji images.
- Selection is preserved across mode switches: selecting an emoji image in WYSIWYG selects the corresponding `:shortcode:` in markdown, and vice versa.

### Read-Mode Selection

- Selecting an emoji in read mode and entering the editor will select the corresponding `:shortcode:` in markdown mode or the emoji image in WYSIWYG mode.
