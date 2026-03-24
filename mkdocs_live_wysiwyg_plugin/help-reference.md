# Help Reference

## General
<!-- context: all -->

### Opening the Editor

- Press `.` (period) in read mode to open the editor, similar to GitHub's keyboard shortcut.
- The editor opens in WYSIWYG mode by default. Toggle to Markdown mode with **Ctrl+.** (Cmd+. on Mac).

### Saving

| Shortcut | Action |
|----------|--------|
| Ctrl+S / Cmd+S | Save the document |
| Ctrl+. / Cmd+. | Toggle between WYSIWYG and Markdown modes |

In Focus Mode with "Remain in Focus Mode" enabled, saving triggers a seamless page reload.

### Modes

| Mode | Description |
|------|-------------|
| **Read-Only** | Default page load state. No editing. Press `.` or click Edit to enter edit mode. |
| **Unfocused** | Inline editor on the rendered page with the controls bar. |
| **Focus Mode** | Fullscreen editing overlay with nav sidebar, content area, and table of contents. Press ESC to exit. |
| **Mermaid Mode** | Full-screen diagram editor for mermaid code blocks. Overlays Focus Mode. |
| **History Mode** | Document History: visual DAG view of undo/redo history. Accessible via redo branch picker popup. |

### Help

| Shortcut | Action |
|----------|--------|
| Ctrl+? / Cmd+? | Open this help reference. Context-sensitive: opens to content or nav help depending on focus. |

## Content Shortcuts
<!-- context: content -->

### WYSIWYG Mode

| Shortcut | Action | Notes |
|----------|--------|-------|
| Ctrl+S / Cmd+S | Save page | Triggers upstream save |
| Ctrl+. / Cmd+. | Toggle WYSIWYG / Markdown mode | Works in both modes |
| Ctrl+Z / Cmd+Z | Undo | DAG content undo |
| Ctrl+Y / Cmd+Y | Redo | Also Ctrl+Shift+Z / Cmd+Shift+Z. Shows branch picker at branch points |
| Ctrl+B / Cmd+B | Bold | Toggle bold on selection |
| Ctrl+I / Cmd+I | Italic | Toggle italic on selection |
| Ctrl+A / Cmd+A | Select all | Progressive: block → section → document |
| Enter | New paragraph / bubble exit | See Block Elements tab |
| Enter (in inline element) | Split / escape inline element | See Inline & Emoji tab |
| Shift+Enter | Line break | Bypasses bubble behavior |
| ArrowRight (end of inline element) | Exit inline element rightward | Moves cursor after the element |
| ArrowLeft (start of inline element) | Exit inline element leftward | Moves cursor before the element |
| Backspace | Delete / revert markdown element | See Auto-Conversions tab |
| Tab | Indent list / next table cell / insert spaces | Context-dependent |
| Shift+Tab | Outdent list / previous table cell | Context-dependent |

### Markdown Mode

| Shortcut | Action | Notes |
|----------|--------|-------|
| Ctrl+S / Cmd+S | Save page | Triggers upstream save |
| Ctrl+. / Cmd+. | Toggle WYSIWYG / Markdown mode | Works in both modes |
| Ctrl+Z / Cmd+Z | Undo | DAG content undo |
| Ctrl+Y / Cmd+Y | Redo | Also Ctrl+Shift+Z / Cmd+Shift+Z. Shows branch picker at branch points |
| Ctrl+B / Cmd+B | Bold | Wraps selection in `**` |
| Ctrl+I / Cmd+I | Italic | Wraps selection in `*` |
| Tab | Indent list / insert spaces | Context-dependent |
| Shift+Tab | Outdent list | List items only |

### Focus Mode Additions

All shortcuts above apply in Focus Mode, plus:

| Shortcut | Action |
|----------|--------|
| ESC | Exit focus mode (returns to normal edit view) |

## Auto-Conversions
<!-- context: content -->

Typing markdown syntax in the WYSIWYG editor automatically converts it to the corresponding formatted element. The cursor is placed inside the new element so you can keep typing.

### Block-Level Conversions

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
| `!!! details ` | HTML details tag (collapsible, serializes as `<details>`) |

Block-level conversions trigger when you type the pattern at the start of an empty paragraph. For headings and lists, any remaining text after the prefix is preserved. Admonition types include: note, danger, warning, tip, hint, important, caution, error, attention, abstract, info, success, question, failure, bug, example, quote.

### Inline Conversions

| You type | Result |
|----------|--------|
| `**text**` or `__text__` | **Bold** |
| `*text*` or `_text_` | *Italic* |
| `~~text~~` | ~~Strikethrough~~ |
| `` `text` `` | `Inline code` (single backtick) |
| ```` `` text `` ```` | `Inline code` (double backtick — space after ` `` ` opens, space + ` `` ` closes; preserves inner single backticks) |
| ````` ``` text ``` ````` | `Inline code` (triple backtick — space after ` ``` ` opens, space + ` ``` ` closes; preserves inner single and double backticks) |
| `N backticks + space ... space + N backticks` | `Inline code` (4+ backticks — same pattern as double/triple; use more backticks to preserve longer runs inside) |
| `[text](url)` | [Link](url) |

Inline conversions trigger when you type the closing delimiter. The wrapped text must not be empty and must not start or end with a space.

### Backspace Revert

**Backspace** on an empty converted element (heading, blockquote, admonition, list item, or the paragraph after a horizontal rule) reverts it to the original literal characters, including the trailing space (e.g. `## ` restores `## `). The cursor is placed at the end of the restored text.

For **inline code** elements, backspace revert only triggers when the cursor is **immediately after** the code element (outside it). When the cursor is inside an inline code element, backspace deletes characters normally. Other inline elements (bold, italic, strikethrough, links) revert on backspace at either edge.

Elements created by toolbar buttons (not by typing markdown) are deleted on backspace instead of reverted.

## Block Elements
<!-- context: content -->

### Code Blocks

- Typing **three backticks** (` ``` `) inserts a code block.
- **Code block with language**: type ` ``` `, press **Backspace** to revert, type a language keyword (e.g. `python`, `bash`, `yaml`), then press **Space**. The code block is created with the language pre-set.
- **Mermaid shortcut**: typing ` ```mermaid ` (via the backspace-revert flow above) inserts a mermaid code block pre-filled with a default state diagram.
- **Enter** (3×) at the end of a code block exits onto a new paragraph. Trailing blank lines are removed.
- **Backspace** on a completely empty code block deletes it.
- **Tab** inserts the configured indent (spaces or tab character).
- **Lang button** (upper-right) sets the code language. Custom languages are supported.
- **Gear button** configures auto-indent: toggle on/off, choose spaces or tabs, set indent size (2, 4, or 8).

#### Advanced Code Blocks (with title)

- **Enter** at the beginning of the title inserts a new paragraph before the code block.
- **Enter** elsewhere in the title moves the cursor into the code body.
- **Backspace** on an empty title converts to a basic code block.

### Admonitions

- The **gear button** opens settings: change Type, placement, collapsible, collapsed, hide title, and details tag.
- **Enter** (3×) at the end of admonition body exits onto a new paragraph.
- **Backspace** on an admonition with an empty body deletes it.
- Exiting a list inside an admonition requires only one more Enter to exit the admonition.

#### Admonition Types

Available types: note, danger, warning, tip, hint, important, caution, error, attention, abstract, info, success, question, failure, bug, example, quote.

#### Admonition Titles

- **Enter** at the beginning of the title inserts a new paragraph before the admonition.
- **Enter** elsewhere in the title moves the cursor into the admonition body.
- **Backspace** at the beginning of the title is a no-op.

### Block Quotes

- **Enter** (3×) at the end of a block quote exits onto a new paragraph.
- Exiting a nested element (list, admonition, code block) inside a block quote lands inside the block quote. Each nested exit grants credit — only one more Enter exits the block quote.
- Code blocks and admonitions can be nested inside block quotes and vice versa (indefinite nesting).

### Lists

- **Enter** (2×) on an empty list item at the end exits the list. Works for unordered, ordered, and checklists.
- Items can be added in the middle without triggering exit.
- **Tab** indents a list item; **Shift+Tab** outdents.

### Horizontal Rules

- Type `---`, `***`, or `___` to insert a horizontal rule.

## Inline & Emoji
<!-- context: content -->

### Inline Code

- Wrapping text with a **pair of backticks** (`` `text` ``) converts to inline code.
- **Double backtick** inline code: type ` `` ` then **Space** to open, type content, then **Space** + ` `` ` to close. Preserves single backticks inside the content.
- **Triple backtick** inline code: type ` ``` ` then **Backspace** (reverts the code block) then **Space** to open, type content, then **Space** + ` ``` ` to close. Preserves single and double backticks inside the content. Mid-line triple backticks followed by Space also open inline mode directly.
- **4+ backtick** inline code: same space-delimited pattern works for any number of backticks (4, 5, 6, ...). Use more backticks when the content contains longer consecutive backtick runs.
- The **Inline Code** toolbar button toggles inline code off if the cursor is on existing inline code.

### Inline Element Navigation

Arrow keys and Enter have special behavior when the cursor is inside any inline element (code, bold, italic, strikethrough, link):

| Key | Cursor Position | Behavior |
|-----|-----------------|----------|
| **ArrowRight** | End of inline element | Exits the element — cursor lands after it in the same paragraph |
| **ArrowLeft** | Start of inline element | Exits the element — cursor lands before it in the same paragraph |
| **Enter** | Left edge | Moves the inline element (and everything after it) to a new line; original line keeps content before the element |
| **Enter** | Right edge | Inserts a new line below; content after the element moves to the new line |
| **Enter** | Middle | Splits the inline element at the cursor; left half stays, right half moves to a new line |
| **Shift+Enter** | Anywhere | Normal line break (bypasses inline escape) |

Arrow escape and Enter splitting work inside paragraphs, headings, list items, admonitions, and block quotes.

### Emoji

Emoji shortcodes (e.g. `:heart_eyes:`, `:white_check_mark:`) and unicode emoji are supported. Unicode emoji already present in the document are preserved as-is.

#### Shortcode Completion

- Typing `:` followed by at least **2 characters** opens an autocomplete popup.
- **Arrow Up / Arrow Down** navigates the list.
- **Enter** or **Tab** inserts the selected emoji.
- **Escape** dismisses the popup.
- Typing the closing `:` of a valid shortcode immediately converts it.

#### Emoji Picker (Ctrl+Space / Cmd+Space)

- **Ctrl+Space** / **Cmd+Space** opens the full emoji picker at the cursor.
- Type to filter by name.
- **Backspace** removes filter characters.
- The picker is disabled inside code blocks.

#### Round-Trip Behavior

- **WYSIWYG → Markdown**: emoji images convert back to `:shortcode:` text.
- **Markdown → WYSIWYG**: `:shortcode:` text converts to emoji images.
- Selection is preserved across mode switches.

## Select All
<!-- context: content -->

Repeated **Ctrl+A / Cmd+A** presses expand the selection through a context-aware hierarchy:

1. Inside a **code block or admonition**: selects all code content (excludes UI elements).
2. Inside a **code block or admonition**: selects all content and title. **Pressing backspace** will delete the entire element.
3. Inside an **inline code** span: selects the inline code, then the containing paragraph.
4. On a **paragraph or heading**: selects the full element text.
5. Expands to all content under the **current section** heading.
6. Continues expanding up through **parent heading levels** (H4 → H3 → H2 → H1).
7. Finally selects the **entire document**.

## Nav Shortcuts
<!-- context: nav -->

When nav edit mode is active, content is read-only. These keyboard shortcuts apply:

| Shortcut | Action | Notes |
|----------|--------|-------|
| Ctrl+S / Cmd+S | Save nav changes | Executes immediately |
| ESC | Discard nav changes | Exits nav edit mode immediately |
| Ctrl+Z / Cmd+Z | Undo last nav operation | Nav undo stack, not editor undo |
| Ctrl+Y / Cmd+Y | Redo last undone nav operation | Also Ctrl+Shift+Z / Cmd+Shift+Z |
| Arrow Up | Move focused item up | Within current folder |
| Arrow Down | Move focused item down | Within current folder |
| Arrow Left | Move to parent folder (outdent) | Hidden at root level |
| Arrow Right | Move into adjacent folder (indent) | Prompts for new folder if none exists |
| Shift+Arrow Up | Move into deepest child above | Drills into nested sections |
| Shift+Arrow Down | Move into first level of section below | Enters next section |
| Shift+Arrow Right | Always prompt for new/choose folder | Even when adjacent folders exist |

**Suppressed shortcuts**: Enter bubble, Backspace revert, Bold, Italic, Tab, and all content-editing shortcuts are disabled during nav edit mode.

## Nav Mouse
<!-- context: nav -->

### Mouse Actions on Nav Menu Items

| Action | Target | Behavior |
|--------|--------|----------|
| Left click | Page (unmoved) | Navigates to page and loads its content |
| Left click | Page (renamed/new) | No-op — file doesn't exist at target path yet |
| Left click | Section | Toggles expand/collapse |
| Left click | Asset | No-op |
| Left click (with focus) | Any item | Refocuses to clicked item; clicking focused item clears focus |
| Left click (with group) | Any item | Clears group selection and focuses clicked item |
| Ctrl/Cmd+Click | Any item | Toggles group selection; enters nav edit mode if not active |

### Auto-Exit

When no item is focused, no group is selected, and there are no saveable changes, nav edit mode exits automatically.
