# Focus Mode — Design Document

## Purpose

Focus Mode provides a distraction-free fullscreen editing experience that **emulates the read-only Material theme page layout**. The content area matches the exact width and positioning of `md-content`, flanked by the same sidebar widths as the read-only page. A live, dynamic table of contents occupies the right sidebar, and a themed header bar shows the current heading as the user scrolls — just like the Material theme's header-topic behavior.

## Layout: Emulating the Read-Only Page

Focus Mode replicates the Material theme's three-column grid layout:

```
┌────────────────────────────────────────────────────────────────────┐
│  Header (md-header style: --md-primary-fg-color background)       │
│  [☰ Toolbar]  [site title ←→ current H1/H2 heading]         [✕]  │
├────────────────────────────────────────────────────────────────────┤
│  (collapsible drawer: mode toggle, save, exit, WYSIWYG toolbar)   │
├────────────────────────────────────────────────────────────────────┤
│                    max-width: 61rem (md-grid)                     │
│  ┌──────────┬──────────────────────────┬──────────────┐           │
│  │ Left     │  Center                  │ Right        │           │
│  │ sidebar  │  (contenteditable area)  │ (dynamic TOC)│           │
│  │ 12.1rem  │  flex-grow: 1            │ 12.1rem      │           │
│  │ (blank)  │  matches md-content      │ md-sidebar   │           │
│  │          │                          │ --secondary  │           │
│  └──────────┴──────────────────────────┴──────────────┘           │
└────────────────────────────────────────────────────────────────────┘
```

### Mapping to Material Theme Classes

| Focus Mode Element | Emulates | Key Dimensions |
|---|---|---|
| `.live-wysiwyg-focus-overlay` | Full page | `position:fixed; inset:0; z-index:999` |
| `.live-wysiwyg-focus-header` | `md-header md-header--shadow` | `height:2.4rem; background-color:var(--md-primary-fg-color)` |
| `.live-wysiwyg-focus-header-title` | `md-header__title` | `flex-grow:1; font-size:.9rem; line-height:2.4rem` |
| `.live-wysiwyg-focus-header-ellipsis` | `md-header__ellipsis` | `height:100%; position:relative` |
| `.live-wysiwyg-focus-header-topic` | `md-header__topic` | Dual-topic slide transition (same cubic-bezier as Material) |
| `.live-wysiwyg-focus-main` | `md-main` | `flex:1; overflow-y:auto` |
| `.live-wysiwyg-focus-grid` | `md-main__inner md-grid` | `max-width:61rem; margin:auto; display:flex` |
| `.live-wysiwyg-focus-sidebar-left` | `md-sidebar md-sidebar--primary` | `width:12.1rem` (blank space) |
| `.live-wysiwyg-focus-content` | `md-content` | `flex-grow:1; min-width:0; margin:0 .8rem` |
| `.live-wysiwyg-focus-toc` | `md-sidebar md-sidebar--secondary` | `width:12.1rem; position:sticky; top:0` |

## Entry and Exit

### Entry Points

| Trigger | Condition |
|---|---|
| **Focus Mode toolbar button** (expand icon, right end of toolbar) | Editor must be active |
| **Browser fullscreen** (`fullscreenchange` event) | Editor is enabled (cookie/autoload) AND page is in edit mode (not read-only). If the editor is disabled, the event is ignored. |

### Exit Points

| Trigger | Notes |
|---|---|
| **X button** (upper-right corner of header bar) | Styled in theme header color |
| **"Exit Focus Mode" button** in collapsible drawer | Secondary exit point |
| **Escape key** | Captured in capture phase, prevents propagation |
| **`destroyWysiwyg()`** | Calls `exitFocusMode()` first if active |

Browser fullscreen exit does **not** auto-exit focus mode. The user must explicitly exit.

## Overlay Structure

```
div.live-wysiwyg-focus-overlay (position:fixed, inset:0, z-index:999)
├── div.live-wysiwyg-focus-header (md-header style)
│   ├── div.live-wysiwyg-focus-header-left
│   │   └── button.live-wysiwyg-focus-drawer-toggle (hamburger icon)
│   ├── div.live-wysiwyg-focus-header-title
│   │   └── div.live-wysiwyg-focus-header-ellipsis
│   │       ├── div.live-wysiwyg-focus-header-topic (site title, bold)
│   │       └── div.live-wysiwyg-focus-header-topic (dynamic H1/H2)
│   └── button.live-wysiwyg-focus-close (✕)
├── div.live-wysiwyg-focus-toolbar-drawer
│   ├── div.live-wysiwyg-focus-drawer-controls
│   │   ├── div.live-wysiwyg-focus-mode-toggle (WYSIWYG | Markdown)
│   │   ├── button.live-wysiwyg-focus-save-btn (Save)
│   │   └── button.live-wysiwyg-focus-exit-btn (Exit Focus Mode)
│   └── div.live-wysiwyg-focus-drawer-toolbar-wrap
│       └── .md-toolbar (reparented from editor wrapper)
└── div.live-wysiwyg-focus-main (scrollable, like md-main)
    └── div.live-wysiwyg-focus-grid (max-width:61rem, like md-grid)
        ├── div.live-wysiwyg-focus-sidebar-left (12.1rem, blank)
        ├── div.live-wysiwyg-focus-content (flex-grow:1, like md-content)
        │   └── .md-wysiwyg-editor-wrapper (reparented)
        └── div.live-wysiwyg-focus-toc (12.1rem, sticky, always visible)
            └── nav.md-nav.md-nav--secondary
                ├── label.md-nav__title ("Table of contents")
                └── ul.md-nav__list
                    └── li.md-nav__item > a.md-nav__link > span.md-ellipsis
```

## Header: Dynamic Heading Display

The header replicates Material's dual-topic header behavior:

- **Topic 1** (always visible by default): Site title (extracted from `document.title`)
- **Topic 2** (slides in when scrolling): The current H1 and/or H2 heading text

As the user scrolls the content:
- `_updateFocusHeaderHeadings()` scans headings relative to the scroll position
- When the user scrolls past an H1 or H2, the header title area transitions to show the heading text (same cubic-bezier animation as Material's `md-header__topic` transitions)
- The `--active` class on the title div triggers the CSS slide transition

## Reparenting Lifecycle

### Enter (`enterFocusMode`)

1. Save reference to toolbar's original parent
2. Reparent `wysiwygEditor.toolbar` → drawer toolbar wrap
3. Reparent `wysiwygEditor.editorWrapper` → focus content area
4. Remove `height` constraint from `.md-editor-content-area`

### Exit (`exitFocusMode`)

1. Reparent `wysiwygEditor.toolbar` → original parent (as first child)
2. Reparent `wysiwygEditor.editorWrapper` → `wysiwygContainer`
3. Restore `height` on `.md-editor-content-area`

The toolbar is the **same DOM element** moved between containers — never duplicated.

## Collapsible Menu

- Default state: **collapsed** (distraction-free)
- Toggle: hamburger icon button in the header left area
- Transition: `max-height` with `0.25s ease-in-out`
- Contents: mode toggle, save button, exit button, and the WYSIWYG toolbar
- In **Markdown mode**, the toolbar wrap section is hidden (`display:none`) since WYSIWYG buttons don't apply; toggle, save, and exit remain visible

## Mode Toggle

The WYSIWYG/Markdown toggle in the drawer calls `wysiwygEditor.switchToMode()`. It:
- Reflects the current mode on entry
- Updates immediately when clicked
- Hides/shows the toolbar wrap section accordingly

## Save Button

Delegates to the upstream save flow:
1. Calls `wysiwygEditor._finalizeUpdate()` to flush pending content
2. Clicks `.live-edit-save-button` (the upstream plugin's save button)

No cancel button is provided in focus mode.

## Dynamic Table of Contents

### Always Visible

The TOC panel is a **permanent fixture** of focus mode, occupying the right sidebar (12.1rem). It is never collapsed, hidden, or toggleable. It uses `position:sticky; top:0` so it stays visible as the user scrolls the main area.

### Building (`buildFocusToc`)

- Queries `wysiwygEditor.editableArea.querySelectorAll('h1, h2, h3, h4, h5, h6')`
- Strips `¶` (headerlink pilcrow) from heading text
- Generates Material-themed `<li>/<a>` structure with depth-based left-padding
- Each link carries `data-focus-toc-idx` for click targeting

### Live Updates

- `MutationObserver` on `editableArea` watches `childList`, `characterData`, `subtree`
- Debounced at 300ms to avoid excessive rebuilds during typing
- Preserves TOC scroll position across rebuilds

### Active Heading Tracking

- Scroll listener on `.live-wysiwyg-focus-main` (the main scrolling container)
- Determines the topmost heading at or above the viewport top (within 20px threshold)
- Applies `md-nav__link--active` to exactly one TOC link
- Auto-scrolls the TOC panel to keep the active link visible

### Click-to-Scroll

- `e.preventDefault()` on TOC link clicks
- `heading.scrollIntoView({ behavior: 'smooth', block: 'start' })` for browser-native smooth scrolling
- Places cursor at the heading for immediate editing

## Styling Contract

### CSS Variable Mandate

Every `color`, `background-color`, `border-color`, `font-family`, and `box-shadow` property uses the `var(--md-*, fallback)` pattern. No hardcoded color values exist without a CSS variable wrapper.

### Key Variable Mappings

| Element | Property | Variable |
|---|---|---|
| Header | background | `var(--md-primary-fg-color, #4051b5)` |
| Header | color | `var(--md-primary-bg-color, #fff)` |
| Header | box-shadow | Same as `md-header--shadow` |
| Drawer toggle | color | `var(--md-primary-bg-color, #fff)` |
| Close button | color | `var(--md-primary-bg-color, #fff)` |
| Overlay | background | `var(--md-default-bg-color, #fff)` |
| Overlay | color | `var(--md-default-fg-color, #333)` |
| Mode toggle active | background | `var(--md-accent-fg-color, #007bff)` |
| Save button | background | `var(--md-accent-fg-color, #007bff)` |
| TOC link | color | `var(--md-default-fg-color--light, #999)` |
| TOC active link | color | `var(--md-typeset-a-color, #007bff)` |
| TOC link hover | color | `var(--md-accent-fg-color, #007bff)` |

### Responsive Behavior

| Breakpoint | Change |
|---|---|
| `< 76.25em` | Left sidebar hidden, content gets `margin: 0 1.2rem` |
| `< 60em` | TOC hidden |

### Stylesheet Lifecycle

Injected as `<style id="live-wysiwyg-focus-mode-styles">` on enter, removed on exit.

## Cursor & Selection Preservation

Cursor position and text selection are preserved across both entering and exiting focus mode.

### Capture (`_captureEditorSelection`)

Called **before** any reparenting occurs. Returns a mode-specific snapshot:

- **Markdown mode**: `{ mode:'markdown', selectionStart, selectionEnd, scrollTop }` — offsets from the textarea plus scroll position of the markdown editor container.
- **WYSIWYG mode**: `{ mode:'wysiwyg', rangeData, semantic, scrollTop }` — direct DOM `Range` node references (primary) and a semantic descriptor from `captureSemanticSelection` (fallback), plus scroll position of the current scroll container.

### Restore (`_restoreEditorSelection`)

Called **after** reparenting completes and the overlay/normal layout is settled.

- **Markdown mode**: `setSelectionRange()` restores the cursor/selection; `scrollTop` is set on the markdown editor container.
- **WYSIWYG mode**: First attempts to recreate a `Range` from the saved node references (these survive reparenting since DOM nodes are moved, not cloned). If that fails (e.g., nodes invalidated), falls back to `restoreSelectionFromSemantic`. Scroll position is restored on the appropriate container (`.live-wysiwyg-focus-main` when entering focus mode, `editableArea` when exiting).

### Why Direct Range Restore Works

`enterFocusMode` and `exitFocusMode` reparent the editor wrapper — they move DOM nodes between parents using `appendChild` / `insertBefore`. The nodes themselves are never cloned or recreated. A `Range` whose `startContainer` / `endContainer` point into these nodes remains valid after reparenting because the node references don't change. This makes direct `Range` restore the fastest and most reliable mechanism.

## Invariants

1. Toolbar is restored to its original parent on exit
2. Editor wrapper is restored to `wysiwygContainer` on exit
3. `document.body.style.overflow` is restored on exit
4. Escape listener is removed on exit
5. MutationObserver is disconnected on exit
6. Scroll listener is removed on exit
7. Injected `<style>` element is removed on exit
8. `isFocusModeActive` is the single source of truth for focus mode state
9. Only one `md-nav__link--active` exists at a time
10. Auto-fullscreen is one-way: entering browser fullscreen can trigger focus mode, but exiting fullscreen does not exit focus mode
11. Auto-fullscreen is guarded: ignored when editor is disabled or page is in read mode
12. TOC is always visible — never collapsed, hidden, or toggleable
13. New toolbar buttons are automatically available in focus mode (toolbar is reparented, not duplicated)
14. Focus mode layout emulates the read-only Material theme page: same header, same 3-column grid, same sidebar widths, same content width
15. Header dynamically shows current H1/H2 heading text using the same dual-topic slide transition as Material's `md-header__topic`
16. Cursor/selection preserved on enter and exit: `enterFocusMode` and `exitFocusMode` must call `_captureEditorSelection` before reparenting and `_restoreEditorSelection` after. Both WYSIWYG and Markdown modes must preserve cursor position, text selection, and scroll position across focus mode transitions.
