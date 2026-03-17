# Keyboard Shortcuts

All keyboard shortcuts available in the WYSIWYG editor, organized by mode.

## Normal Edit Mode (WYSIWYG)

| Shortcut | Action | Notes |
|----------|--------|-------|
| Cmd+S / Ctrl+S | Save page | Triggers upstream save |
| Cmd+. / Ctrl+. | Toggle WYSIWYG / Markdown mode | Works in both modes |
| Cmd+Z / Ctrl+Z | Undo | Editor undo stack |
| Cmd+Y / Ctrl+Y | Redo | Also Cmd+Shift+Z / Ctrl+Shift+Z |
| Cmd+B / Ctrl+B | Bold | Toggle bold on selection |
| Cmd+I / Ctrl+I | Italic | Toggle italic on selection |
| Enter | New paragraph / bubble exit | See enter-bubble-navigation rules |
| Shift+Enter | Line break | Bypasses bubble behavior |
| Backspace | Delete / revert markdown element | See targeted-markdown-revert rules |
| Tab | Indent in lists | List items only |
| Shift+Tab | Outdent in lists | List items only |

## Normal Edit Mode (Markdown)

| Shortcut | Action | Notes |
|----------|--------|-------|
| Cmd+S / Ctrl+S | Save page | Triggers upstream save |
| Cmd+. / Ctrl+. | Toggle WYSIWYG / Markdown mode | Works in both modes |
| Cmd+Z / Ctrl+Z | Undo | Standard textarea undo |
| Cmd+Y / Ctrl+Y | Redo | Also Cmd+Shift+Z / Ctrl+Shift+Z |
| Standard text shortcuts | Cut, Copy, Paste, Select All | Browser defaults |

## Focus Mode (WYSIWYG)

All Normal WYSIWYG shortcuts apply, plus:

| Shortcut | Action | Notes |
|----------|--------|-------|
| ESC | Exit focus mode | Returns to normal edit view |
| Cmd+S / Ctrl+S | Save page | With "Remain in Focus Mode" enabled, triggers seamless reload |
| Cmd+. / Ctrl+. | Toggle WYSIWYG / Markdown mode | Clicks the inactive mode toggle button |

## Focus Mode (Markdown)

All Normal Markdown shortcuts apply, plus:

| Shortcut | Action | Notes |
|----------|--------|-------|
| ESC | Exit focus mode | Returns to normal edit view |
| Cmd+S / Ctrl+S | Save page | With "Remain in Focus Mode" enabled, triggers seamless reload |
| Cmd+. / Ctrl+. | Toggle WYSIWYG / Markdown mode | Clicks the inactive mode toggle button |

## Focus Mode — Nav Edit Mode

When nav edit mode is active, content is read-only. These shortcuts apply:

### Keyboard

| Shortcut | Action | Notes |
|----------|--------|-------|
| Cmd+S / Ctrl+S | Save nav changes | Executes immediately (no confirmation dialog) |
| ESC | Discard nav changes | Exits nav edit mode immediately (no confirmation dialog) |
| Cmd+Z / Ctrl+Z | Undo last nav operation | Nav undo stack, not editor undo |
| Cmd+Y / Ctrl+Y | Redo last undone nav operation | Also Cmd+Shift+Z / Ctrl+Shift+Z |
| Arrow Up | Move focused nav item up | Within current folder; requires focused item |
| Arrow Down | Move focused nav item down | Within current folder; requires focused item |
| Arrow Left | Move to parent folder (outdent) | Hidden at root level; requires focused item |
| Arrow Right | Move into adjacent folder (indent) | Prompts for new folder if none exists; requires focused item |
| Shift+Arrow Up | Move into deepest child above | Drills into nested sections; requires focused item |
| Shift+Arrow Down | Move into first level of section below | Enters next section; requires focused item |
| Shift+Arrow Right | Always prompt for new/choose folder | Even when adjacent folders exist; requires focused item |

**Suppressed shortcuts** (no-op during nav edit mode): Enter bubble, Backspace revert, Bold, Italic, and all content-editing shortcuts.

### Mouse — Nav Menu Items

| Action | Target | Behavior |
|--------|--------|----------|
| Left click | Page (unmoved) | Navigates to page and loads its content; prompts save/discard if current page is dirty |
| Left click | Page (renamed/new) | No-op — file does not exist at its target path yet |
| Left click | Section | Toggles expand/collapse |
| Left click | Asset | No-op |
| Left click (with focus active) | Any item | Refocuses to the clicked item; clicking the already-focused item clears focus |
| Left click (with group selection) | Any item | Clears group selection and focuses the clicked item; clicking the sole selected+focused item clears the group |
| Cmd/Ctrl+Click | Any item | Toggles group selection; enters nav edit mode if not already active |

**Auto-exit**: When no item is focused, no group is selected, and there are no saveable changes, nav edit mode exits automatically.

## Read-Only Mode

No editing shortcuts. Text selection only.
