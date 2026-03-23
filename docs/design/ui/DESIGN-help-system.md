# Help System — Design Document

## Overview

The help system provides a context-sensitive, tabbed reference for all keyboard shortcuts and editing behaviors in the WYSIWYG editor. It is a **read-only informational modal** (Layer 5) that renders content from a single markdown source file (`docs/help-reference.md`). Each H2 heading in the source becomes a separate navigable tab — the modal never presents a long unified document.

All code lives in `live-wysiwyg-integration.js`.

## Architecture

### Single Source File

`mkdocs_live_wysiwyg_plugin/help-reference.md` is the sole source of truth for all help content. It lives inside the Python package directory so it ships with pip installs. The file uses a structured convention:

- **H1** (`# Help Reference`): Document title, not rendered in the modal.
- **H2** (`## Tab Name`): Each H2 heading becomes a **tab** in the help modal. The heading text is the tab label.
- **Context comment** (`<!-- context: content|nav|all -->`): An HTML comment immediately after the H2 heading declares which editing context the tab belongs to. Recognized values:
  - `content` — shown when the user is focused on content editing (WYSIWYG or Markdown areas)
  - `nav` — shown when the user is focused on the navigation menu (nav edit mode)
  - `all` — shown in every context
- **Body content**: Everything between one H2 and the next is the tab's body. This is raw markdown rendered on the fly via `marked.parse()`.

### Build-Time Injection

`plugin.py` reads `help-reference.md` (sibling file in the same package directory) at build time and injects the raw markdown string as `liveWysiwygHelpContent` in the JS preamble. No pre-rendering — the client parses and renders sections on demand.

### Client-Side Parsing

On first open, `_parseHelpSections()` splits the raw markdown by H2 headings and extracts:

```javascript
[
  { title: "General", context: "all", markdown: "..." },
  { title: "Content Shortcuts", context: "content", markdown: "..." },
  { title: "Nav Shortcuts", context: "nav", markdown: "..." },
  // ...
]
```

Results are cached — parsing happens only once.

### Client-Side Rendering

Each tab's markdown body is rendered via `marked.parse(section.markdown, { gfm: true })` when the tab is first selected. Rendered HTML is cached per section. The output supports all markdown features: tables, admonitions, code blocks, lists, inline formatting.

The rendered HTML is inserted into a non-editable container (`<div>` without `contenteditable`). The help modal is purely informational — no editing capability.

## Modal UI (Layer 5)

### Visual Structure

```
┌── .live-wysiwyg-help-overlay (position:fixed; inset:0; z-index:100003) ──────┐
│ ┌── .live-wysiwyg-help-backdrop (click to dismiss) ───────────────────────┐  │
│ │                                                                          │  │
│ │  ┌── .live-wysiwyg-help-modal ────────────────────────────────────────┐  │  │
│ │  │ ┌── .live-wysiwyg-help-header ──────────────────────────────────┐  │  │  │
│ │  │ │  "Help Reference"                                       [X]  │  │  │  │
│ │  │ └──────────────────────────────────────────────────────────────┘  │  │  │
│ │  │ ┌── .live-wysiwyg-help-tabs ────────────────────────────────────┐  │  │  │
│ │  │ │  [General] [Content Shortcuts] [Auto-Conversions] [...]       │  │  │  │
│ │  │ └──────────────────────────────────────────────────────────────┘  │  │  │
│ │  │ ┌── .live-wysiwyg-help-body (overflow-y:auto) ─────────────────┐  │  │  │
│ │  │ │                                                               │  │  │  │
│ │  │ │  (rendered markdown content for active tab)                   │  │  │  │
│ │  │ │                                                               │  │  │  │
│ │  │ └──────────────────────────────────────────────────────────────┘  │  │  │
│ │  └────────────────────────────────────────────────────────────────────┘  │  │
│ │                                                                          │  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Tab Bar

The tab bar displays only tabs relevant to the current context:

| Context | Tabs shown |
|---------|-----------|
| Content editing | All tabs with `context: all` or `context: content` |
| Nav edit mode | All tabs with `context: all` or `context: nav` |

Tabs are rendered as clickable buttons. The active tab has a visual indicator (bottom border highlight). Clicking a tab switches the body content immediately (no animation).

### Context-Sensitive Opening

When the help modal opens, it determines the current context and pre-selects the first context-specific tab (not the "General" tab):

| User focus | Detected context | Pre-selected tab |
|-----------|-----------------|-----------------|
| WYSIWYG editable area | `content` | First `content` tab (e.g. "Content Shortcuts") |
| Markdown textarea | `content` | First `content` tab |
| Nav sidebar / nav edit mode active | `nav` | First `nav` tab (e.g. "Nav Shortcuts") |
| Elsewhere / read-only | `all` | First `all` tab (e.g. "General") |

### Keyboard Interaction

The help modal uses `_attachDialogKeyboard` with category `informational`:

| Key | Action |
|-----|--------|
| ESC | Dismiss the help modal |
| Enter | Dismiss the help modal |
| Arrow Left / Arrow Right | Navigate between tabs |

### Dismissal

- ESC key
- Enter key
- Click the X button
- Click the backdrop (outside the modal)

## Entry Points

### Help Icon (Focus Mode Header)

A `?` help icon button is placed in the focus mode header, between the palette toggle (if present) and the close button. It uses the same styling as `.live-wysiwyg-focus-close` (header button pattern). Clicking it opens the help modal with context detection.

### Keyboard Shortcut: Ctrl+? (Ctrl+Shift+/)

Registered in `_globalKeydownRouter` (Tier 2). The shortcut:

1. Checks if the help modal is already open — if so, dismisses it (toggle behavior).
2. Determines context from `document.activeElement`:
   - If inside `.md-editable-area` or a `<textarea>` (markdown area) → `content`
   - If `_navEditMode` is true → `nav`
   - Otherwise → `all`
3. Calls `_showHelp(context)`.

The shortcut works in all modes: unfocused, focus, mermaid (parent-side), and even read-only (shows General tab).

### Tier 2 Priority Position

The Ctrl+? check is placed **after** Ctrl+S and Ctrl+. but **before** nav edit arrows, so it is always reachable regardless of nav edit state. The help modal's own keyboard handler (Tier 1 via `_attachDialogKeyboard`) handles ESC/Enter dismissal.

## Layer 5 Position

### Mode Hierarchy Extension

```
Layer 5:  Help Modal         (informational overlay, z-index 100003)
Layer 3:  Mermaid Mode       (full-screen diagram editor, z-index 99995)
Layer 2:  Focus Mode         (fullscreen overlay, z-index 99990)
Layer 1:  Unfocused Mode     (inline editor, controls bar)
Layer 0:  Readonly Mode      (static HTML, no editing)
```

The help modal sits above all editing surfaces including mermaid mode, toasts, and progress indicators. It is below the extreme confirm overlay (z-index 999999).

### Z-Index

| z-index | Element |
|---------|---------|
| 100003 | `.live-wysiwyg-help-overlay` |

This value is registered in the Layout subsystem's z-index registry ([DESIGN-layout.md](DESIGN-layout.md)).

### Suppression Contract

When the help modal is open:

- **Scroll**: Document and focus-mode scroll are unaffected (the modal has its own scroll in `.live-wysiwyg-help-body`). The backdrop prevents interaction with underlying content.
- **Keyboard**: The `_helpModalOpen` flag causes `_globalKeydownRouter` to yield for most shortcuts. ESC and Ctrl+? are still handled (to dismiss). The modal's own Tier 1 handler manages internal keyboard navigation.
- **UI**: The modal's z-index (100003) places it above all editor UI. The semi-transparent backdrop visually dims underlying content.

## State Management

| Flag | Type | Set by | Cleared by |
|------|------|--------|------------|
| `_helpModalOpen` | boolean | `_showHelp()` | `_dismissHelp()` |
| `_helpSections` | array | `_parseHelpSections()` (cached) | Never (persists for session) |
| `_helpRenderedCache` | object | Tab selection (per section) | Never (persists for session) |

## Styling

The help modal inherits theme colors via CSS variables with fallbacks, following the same pattern as all other editor UI. Key styling decisions:

- Modal width: `min(90vw, 56rem)` — wide enough for tables, constrained on small screens
- Modal height: `min(85vh, 44rem)` — tall enough for content, leaves breathing room
- Tab bar: horizontal scroll if tabs overflow, no wrapping
- Body: `overflow-y: auto` with styled scrollbar
- Tables inherit Material theme table styling where available
- Code blocks use `var(--md-code-bg-color)` background

## Cross-References

- [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md) — Layer hierarchy and suppression contract
- [DESIGN-centralized-keyboard.md](DESIGN-centralized-keyboard.md) — Tier 2 routing for Ctrl+?, Tier 1 for modal keyboard
- [DESIGN-popup-dialog-ux.md](DESIGN-popup-dialog-ux.md) — `_attachDialogKeyboard` integration (informational category)
- [DESIGN-layout.md](DESIGN-layout.md) — Z-index registry (100003)
- [DESIGN-toolbars.md](DESIGN-toolbars.md) — Help icon in focus header
- [DESIGN-theme-detection.md](DESIGN-theme-detection.md) — CSS variable fallbacks for modal styling

## Rules

1. **Single source of truth.** All help content comes from `mkdocs_live_wysiwyg_plugin/help-reference.md`. The modal does not contain any hardcoded text. To update help content, edit the markdown file.

2. **Tabs, not a document.** The modal displays one tab's content at a time. It never renders the full markdown file as a single scrollable document. Each H2 section is an independent tab.

3. **Read-only.** The help modal is purely informational. No `contenteditable`, no editing capability, no form fields. The body container is a plain `<div>`.

4. **Context-sensitive opening.** `_showHelp(context)` filters tabs and pre-selects the first context-specific tab. The context is determined by `document.activeElement` and `_navEditMode` at the time of invocation.

5. **Client-side markdown rendering.** Section markdown is rendered via `marked.parse()` on first view. Rendered HTML is cached per section for the session. No server-side pre-rendering.

6. **Layer 5 is always accessible.** The help modal can be opened from any mode (readonly, unfocused, focus, mermaid parent-side). It does not require focus mode to be active.

7. **Dismiss on any intent.** ESC, Enter, X button, backdrop click, and Ctrl+? (toggle) all dismiss the modal. The user should never feel trapped.

8. **No interference with editing.** While the help modal is open, content editing shortcuts are suppressed. When dismissed, the editor state is exactly as it was before opening — no cursor movement, no content changes, no mode transitions.
