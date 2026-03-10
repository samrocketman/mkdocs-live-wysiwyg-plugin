# Keyboard Shortcuts

All keyboard shortcuts available in the WYSIWYG editor, organized by mode.

## Normal Edit Mode (WYSIWYG)

| Shortcut | Action | Notes |
|----------|--------|-------|
| Cmd+S / Ctrl+S | Save page | Triggers upstream save |
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
| Cmd+Z / Ctrl+Z | Undo | Standard textarea undo |
| Cmd+Y / Ctrl+Y | Redo | Also Cmd+Shift+Z / Ctrl+Shift+Z |
| Standard text shortcuts | Cut, Copy, Paste, Select All | Browser defaults |

## Focus Mode (WYSIWYG)

All Normal WYSIWYG shortcuts apply, plus:

| Shortcut | Action | Notes |
|----------|--------|-------|
| ESC | Exit focus mode | Returns to normal edit view |
| Cmd+S / Ctrl+S | Save page | With "Remain in Focus Mode" enabled, triggers seamless reload |

## Focus Mode (Markdown)

All Normal Markdown shortcuts apply, plus:

| Shortcut | Action | Notes |
|----------|--------|-------|
| ESC | Exit focus mode | Returns to normal edit view |
| Cmd+S / Ctrl+S | Save page | With "Remain in Focus Mode" enabled, triggers seamless reload |

## Focus Mode — Nav Edit Mode

When nav edit mode is active, content is read-only. These shortcuts apply:

| Shortcut | Action | Notes |
|----------|--------|-------|
| Cmd+S / Ctrl+S | Show nav menu Save confirmation | Does NOT save page content |
| ESC | Show nav menu Discard confirmation | Does NOT exit focus mode |
| Cmd+Z / Ctrl+Z | Undo last nav operation | Nav undo stack, not editor undo |
| Cmd+Y / Ctrl+Y | Redo last undone nav operation | Also Cmd+Shift+Z / Ctrl+Shift+Z |
| Arrow Up | Move selected nav item up | Within current folder |
| Arrow Down | Move selected nav item down | Within current folder |
| Arrow Left | Move to parent folder (outdent) | Hidden at root level |
| Arrow Right | Move into adjacent folder (indent) | Prompts for new folder if none exists |
| Shift+Arrow Up | Move into deepest child above | Drills into nested sections |
| Shift+Arrow Down | Move into first level of section below | Enters next section |
| Shift+Arrow Right | Always prompt for new/choose folder | Even when adjacent folders exist |

**Suppressed shortcuts** (no-op during nav edit mode): Enter bubble, Backspace revert, Bold, Italic, and all content-editing shortcuts.

## Read-Only Mode

No editing shortcuts. Text selection only.
