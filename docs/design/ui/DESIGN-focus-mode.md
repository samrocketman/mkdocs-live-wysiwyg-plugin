# Focus Mode — Design Document

## Purpose

Focus Mode provides a distraction-free fullscreen editing experience that **emulates the read-only Material theme page layout**. The content area matches the exact width and positioning of `md-content`, flanked by sidebars that mirror the read-only page. The left sidebar contains a full navigation menu (Material theme only), the right sidebar holds a live dynamic table of contents, and a themed header bar shows the current heading as the user scrolls — just like the Material theme's header-topic behavior.

## Layout: Emulating the Read-Only Page

Focus Mode replicates the Material theme's three-column grid layout:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Header (md-header style: --md-primary-fg-color background)              │
│  [☰nav] [☰toolbar] [☰toc]  [site title ←→ current H1/H2]     [🎨] [✕]│
├──────────────────────────────────────────────────────────────────────────┤
│  (collapsible drawer: mode toggle, content, save, discard, settings,     │
│   WYSIWYG toolbar)                                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                       max-width: 61rem (md-grid)                         │
│  ┌──────────────┬──────────────────────────┬──────────────┐              │
│  │ Left sidebar │  Center                  │ Right        │              │
│  │ (nav menu)   │  (contenteditable area)  │ (dynamic TOC)│              │
│  │ 15.8rem+     │  flex-grow: 1            │ 12.1rem      │              │
│  │ collapsible  │  matches md-content      │ collapsible  │              │
│  │              │                          │              │              │
│  └──────────────┴──────────────────────────┴──────────────┘              │
└──────────────────────────────────────────────────────────────────────────┘
```

### Mapping to Material Theme Classes

| Focus Mode Element | Emulates | Key Dimensions |
|---|---|---|
| `.live-wysiwyg-focus-overlay` | Full page | `position:fixed; inset:0; z-index:99990` |
| `.live-wysiwyg-focus-header` | `md-header md-header--shadow` | `height:2.4rem; background-color:var(--md-primary-fg-color)` |
| `.live-wysiwyg-focus-header-title` | `md-header__title` | `flex-grow:1; font-size:.9rem; line-height:2.4rem` |
| `.live-wysiwyg-focus-header-ellipsis` | `md-header__ellipsis` | `height:100%; position:relative` |
| `.live-wysiwyg-focus-header-topic` | `md-header__topic` | Dual-topic slide transition (same cubic-bezier as Material) |
| `.live-wysiwyg-focus-main` | `md-main` | `flex:1; overflow-y:auto` |
| `.live-wysiwyg-focus-grid` | `md-main__inner md-grid` | `max-width:61rem; margin:auto; display:flex` |
| `.live-wysiwyg-focus-sidebar-left` | `md-sidebar md-sidebar--primary` | `width:calc(15.8rem + var(--_nav-extend,0px))` — extends up to 25.8rem on wide viewports |
| `.live-wysiwyg-focus-content` | `md-content` | `flex-grow:1; min-width:0; margin:0 .8rem` |
| `.live-wysiwyg-focus-toc` | `md-sidebar md-sidebar--secondary` | `width:12.1rem; position:sticky; top:0` |

The `--_nav-extend` CSS variable is defined on `.live-wysiwyg-focus-grid` as `clamp(0px, (100vw - 61rem) / 2 - 2em, 10rem)`. On wide viewports it extends the left sidebar into the space beyond the 61rem max-width, making room for deeper nav trees.

## Entry and Exit

### Entry Points

| Trigger | Condition |
|---|---|
| **Focus Mode toolbar button** (expand icon, right end of toolbar) | Editor must be active |
| **Browser fullscreen** (`fullscreenchange` event) | Editor is enabled (cookie/autoload) AND page is in edit mode (not read-only). If the editor is disabled, the event is ignored. |
| **Editor activation** | Focus mode always launches when the editor activates (regardless of settings). This includes manual Edit button clicks, auto-launch, and early overlay reconnection. |
| **"Auto-launch editor" setting** (`live_wysiwyg_autolaunch`) | When enabled, auto-clicks the Edit button on page load, which then enters focus mode |

### Exit Points

| Trigger | Notes |
|---|---|
| **X button** (upper-right corner of header bar) | Styled in theme header color |
| **Escape key** | Captured in capture phase, prevents propagation |
| **`destroyWysiwyg()`** | Calls `exitFocusMode()` first if active |

Browser fullscreen exit does **not** auto-exit focus mode. The user must explicitly exit.

`exitFocusMode()` deletes the `live_wysiwyg_focus_nav` setting so that subsequent page navigations do not re-enter focus mode. The setting is only set to `'1'` by intentional reload paths (nav save, AJAX navigation fallback, popstate) that should preserve the focus mode session.

## Overlay Structure

```
div.live-wysiwyg-focus-overlay (position:fixed, inset:0, z-index:99990)
├── div.live-wysiwyg-focus-header (md-header style)
│   ├── div.live-wysiwyg-focus-header-left
│   │   ├── button.live-wysiwyg-focus-nav-toggle (hamburger rotated 90°)
│   │   ├── button.live-wysiwyg-focus-drawer-toggle (hamburger icon)
│   │   └── button.live-wysiwyg-focus-toc-toggle (hamburger rotated 90°)
│   ├── div.live-wysiwyg-focus-header-title
│   │   └── div.live-wysiwyg-focus-header-ellipsis
│   │       ├── div.live-wysiwyg-focus-header-topic (site title, bold)
│   │       └── div.live-wysiwyg-focus-header-topic (dynamic H1/H2)
│   ├── button.live-wysiwyg-focus-palette (theme toggle, if Material palette exists)
│   └── button.live-wysiwyg-focus-close (✕)
├── div.live-wysiwyg-focus-toolbar-drawer
│   ├── div.live-wysiwyg-focus-drawer-controls
│   │   ├── div.live-wysiwyg-focus-mode-toggle (WYSIWYG | Markdown)
│   │   ├── button (Page Management — Material only)
│   │   └── button.live-wysiwyg-focus-settings-btn (⚙ Settings gear)
│   └── div.live-wysiwyg-focus-drawer-toolbar-wrap
│       └── .md-toolbar (reparented from editor wrapper)
└── div.live-wysiwyg-focus-main (scrollable, like md-main)
    └── div.live-wysiwyg-focus-grid (max-width:61rem, like md-grid)
        ├── div.live-wysiwyg-focus-sidebar-left (nav menu, collapsible)
        │   └── nav.md-nav.md-nav--primary (built by _buildNavMenu)
        ├── div.live-wysiwyg-focus-content (flex-grow:1, like md-content)
        │   └── .md-wysiwyg-editor-wrapper (reparented)
        └── div.live-wysiwyg-focus-toc (12.1rem, sticky, collapsible)
            └── nav.md-nav.md-nav--secondary
                ├── label.md-nav__title ("Table of contents")
                └── ul.md-nav__list
                    └── li.md-nav__item > a.md-nav__link > span.md-ellipsis
```

## Header Buttons

The header contains three groups of controls:

### Left Group (`header-left`)

Three toggle buttons in a flex container with `gap: 4px`:

1. **Nav toggle** (`.live-wysiwyg-focus-nav-toggle`) — hamburger icon rotated 90° via CSS. Toggles `live-wysiwyg-focus-nav-collapsed` on the overlay. State persisted via `live_wysiwyg_focus_nav`.
2. **Toolbar toggle** (`.live-wysiwyg-focus-drawer-toggle`) — hamburger icon (no rotation). Toggles `live-wysiwyg-focus-toolbar-open` on the overlay. State persisted via `live_wysiwyg_focus_toolbar`.
3. **TOC toggle** (`.live-wysiwyg-focus-toc-toggle`) — hamburger icon rotated 90° via CSS. Toggles `live-wysiwyg-focus-toc-collapsed` on the overlay. State persisted via `live_wysiwyg_focus_toc`.

### Center

Title area with dual-topic slide transition (see "Header: Dynamic Heading Display" below).

### Right Group

- **Palette button** (`.live-wysiwyg-focus-palette`) — only present when the Material theme palette form exists. Mirrors the theme's color scheme toggle icon and behavior.
- **Close button** (`.live-wysiwyg-focus-close`) — `✕` character, calls `exitFocusMode()`.

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

## Collapsible Toolbar Drawer

- Default state: **open** (toolbar is visible on first use; state is persisted)
- Toggle: hamburger icon button (toolbar toggle) in the header left area
- Transition: `max-height` with `0.25s ease-in-out` (0 when closed, 260px when open)
- Contents: mode toggle, Page Management button (Material only), settings gear, and the WYSIWYG toolbar
- In **Markdown mode**, the toolbar wrap section is hidden (`display:none`) since WYSIWYG buttons don't apply; toggle, save, discard, and settings remain visible
- `_updateToolbarHeight` sets the `--_toolbar-h` CSS variable from the drawer's `scrollHeight`, which feeds into `--_panel-h` for panel height calculations

## Mode Toggle

The WYSIWYG/Markdown toggle in the drawer calls `wysiwygEditor.switchToMode()`. It:
- Reflects the current mode on entry
- Updates immediately when clicked
- Hides/shows the toolbar wrap section accordingly
- Keyboard shortcut: **Ctrl+.** (or Cmd+. on Mac)

When Markdown mode is active, the overlay gains the `focus-mode-markdown` class, which enables width-collapsing transitions on the sidebars (so the markdown textarea can expand into sidebar space when they are collapsed).

## Content Auto-Save

Focus mode uses automatic content saving — there are no Save or Discard buttons. Content is auto-saved to disk whenever the [Unified Content Undo](DESIGN-unified-content-undo.md) DAG captures a new history node (500ms debounce after typing pauses, or immediately at word boundaries). The undo/redo DAG is simultaneously persisted to `sessionStorage` so it survives page reloads.

**Ctrl+S** (or Cmd+S): If the nav menu has pending edits (`_isNavSaveable()`), triggers a nav menu save. Otherwise, flushes pending typing into a DAG node and forces an immediate disk save.

See [DESIGN-uninterrupted-content-save.md](DESIGN-uninterrupted-content-save.md) for the full auto-save architecture.

## Nav Sidebar (Left)

The left sidebar contains a full Material navigation menu built by `_buildNavMenu`. This is only available when the Material theme is detected (`_isMaterialThemeDetected()`); on non-Material themes the sidebar remains blank.

### Collapsible

- Toggle: nav toggle button (hamburger rotated 90°) in header-left
- State class: `live-wysiwyg-focus-nav-collapsed` on the overlay
- **WYSIWYG mode**: `transform: translateX(-100%)`, `opacity: 0`, `pointer-events: none` — sidebar slides out visually but retains layout width
- **Markdown mode**: additionally `width: 0`, `margin-left: 0`, `padding: 0` — sidebar collapses so the markdown textarea expands into the freed space
- Transition: `0.3s ease-in-out` for transform, opacity, width, and margin
- State persisted via `live_wysiwyg_focus_nav` setting

### AJAX Navigation

When the user navigates between pages via the nav sidebar while in focus mode, content is fetched via WebSocket (`_wsGetContents`) instead of a full page reload. `history.pushState` is used for back/forward navigation support. The `popstate` handler detects focus mode and uses AJAX navigation for the back/forward action.

## Dynamic Table of Contents (Right)

### Collapsible

The TOC panel occupies the right sidebar (12.1rem). It uses `position:sticky; top:0` so it stays visible as the user scrolls the main area. The TOC can be toggled via the TOC toggle button in the header.

- Toggle: TOC toggle button (hamburger rotated 90°) in header-left
- State class: `live-wysiwyg-focus-toc-collapsed` on the overlay
- **WYSIWYG mode**: `transform: translateX(100%)`, `opacity: 0`, `pointer-events: none` — sidebar slides out to the right but retains layout width
- **Markdown mode**: additionally `width: 0`, `margin-right: 0`, `padding: 0` — sidebar collapses so the markdown textarea expands into the freed space
- Transition: `0.3s ease-in-out` for transform, opacity, width, and margin
- State persisted via `live_wysiwyg_focus_toc` setting

### Building (`buildFocusToc`)

- In WYSIWYG mode: queries `wysiwygEditor.editableArea.querySelectorAll('h1, h2, h3, h4, h5, h6')`
- In Markdown mode: parses `#` heading lines from the markdown content
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

## Settings Dropdown

A gear button (⚙) in the drawer controls opens a dropdown with a single persistent checkbox:

- **Auto-launch editor** (`live_wysiwyg_autolaunch`) — When enabled, auto-clicks the Edit button on page load, entering focus mode automatically. When disabled, the page loads in readonly mode. Manually clicking the Edit button always enters focus mode regardless of this setting.

## Palette Button

When the Material theme palette form exists (`form.md-header__option[data-md-component="palette"]`), a palette button is added to the header. It mirrors the current theme label's icon and title, and clicking it triggers the Material palette toggle (light/dark mode switch).

## Page Management Button

In the drawer controls (Material theme only), a "Page Management" button triggers the page management submenu for creating, renaming, and deleting pages.

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl/Cmd+S** | Nav save (if nav edits pending), else flush + disk save |
| **Ctrl/Cmd+.** | Toggle WYSIWYG / Markdown mode |
| **Escape** | Exit focus mode / dismiss dialogs |

## Scroll Behavior

`scrollToCenterCursor` auto-detects focus mode and redirects WYSIWYG scroll operations to `.live-wysiwyg-focus-main` (the focus overlay's scroll container) instead of `editableArea`. The scroll fraction differs from normal mode:

| Mode | Focus Mode Position | Normal Mode Position |
|---|---|---|
| WYSIWYG | 15% from top | 50% (center) |
| Markdown | 25% from top | 50% (center) |

## Styling Contract

### CSS Variable Mandate

Every `color`, `background-color`, `border-color`, `font-family`, and `box-shadow` property uses the `var(--md-*, fallback)` pattern. No hardcoded color values exist without a CSS variable wrapper.

### Key Variable Mappings

| Element | Property | Variable |
|---|---|---|
| Header | background | `var(--md-primary-fg-color, #4051b5)` |
| Header | color | `var(--md-primary-bg-color, #fff)` |
| Header | box-shadow | Same as `md-header--shadow` |
| Nav toggle | color | `var(--md-primary-bg-color, #fff)` |
| Drawer toggle | color | `var(--md-primary-bg-color, #fff)` |
| TOC toggle | color | `var(--md-primary-bg-color, #fff)` |
| Close button | color | `var(--md-primary-bg-color, #fff)` |
| Overlay | background | `var(--md-default-bg-color, #fff)` |
| Overlay | color | `var(--md-default-fg-color, #333)` |
| Mode toggle active | background | `var(--md-accent-fg-color, #007bff)` |
| Save button | background | `var(--md-accent-fg-color, #007bff)` |
| TOC link | color | `var(--md-default-fg-color--light, #999)` |
| TOC active link | color | `var(--md-typeset-a-color, #007bff)` |
| TOC link hover | color | `var(--md-accent-fg-color, #007bff)` |

### Dynamic CSS Variables

| Variable | Source | Purpose |
|---|---|---|
| `--_nav-extend` | `clamp(0px, (100vw - 61rem) / 2 - 2em, 10rem)` | Extends left sidebar width on wide viewports |
| `--_toolbar-h` | `drawerEl.scrollHeight` | Tracks toolbar drawer height for panel calculations |
| `--_panel-h` | Derived from toolbar height | Controls panel and sidebar max-height |

### Responsive Behavior

| Breakpoint | Change |
|---|---|
| `< 76.25em` | Left sidebar hidden, nav toggle hidden, content gets `margin: 0 1.2rem` |
| `< 60em` | TOC hidden, TOC toggle hidden |

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

`enterFocusMode` and `exitFocusMode` reparent the editor wrapper — they move DOM nodes between parents using `appendChild` / `insertBefore`. The nodes themselves are never cloned or recreated. A `Range` whose `startContainer` / `endContainer` point into these nodes remains valid after reparenting because the node references don't change. This makes direct `Range` restore the fastest and most reliable mechanism. Safari and other browsers may have quirks with Range/Selection after DOM operations; see [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md).

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
12. New toolbar buttons are automatically available in focus mode (toolbar is reparented, not duplicated)
13. Focus mode layout emulates the read-only Material theme page: same header, same 3-column grid, same content width
14. Header dynamically shows current H1/H2 heading text using the same dual-topic slide transition as Material's `md-header__topic`
15. Cursor/selection preserved on enter and exit: `enterFocusMode` and `exitFocusMode` must call `_captureEditorSelection` before reparenting and `_restoreEditorSelection` after. Both WYSIWYG and Markdown modes must preserve cursor position, text selection, and scroll position across focus mode transitions.
16. Nav sidebar requires Material theme — `_buildNavMenu` returns early on non-Material themes, leaving the sidebar blank
17. All three toggle states (nav, toolbar, TOC) persist across page reloads and focus mode re-entry via `_getSetting`/`_setSetting`
18. Dead link panel auto-expands a collapsed TOC before positioning (`_ensureTocUncollapsed`)
19. AJAX navigation in focus mode avoids full page reloads — content is fetched via WebSocket and loaded in place

## Layout Subsystem

Grid dimensions, reparenting lifecycle, scroll containers, z-index stacking, sidebar widths, responsive breakpoints, and animation timing are governed by the Layout subsystem. See [DESIGN-layout.md](DESIGN-layout.md) for the authoritative contracts.

## Scroll Isolation

When focus mode is active, document-level scrolling is completely suppressed:

- `document.body.style.overflow` and `document.documentElement.style.overflow` are both set to `'hidden'` on entry
- Both values are saved before entry and restored on exit
- `.live-wysiwyg-focus-main` uses `overscroll-behavior: contain` to prevent scroll chaining from the focus overlay to the underlying page

This is required by the Mode Hierarchy suppression contract (see [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md)). All scroll interactions in focus mode must target `.live-wysiwyg-focus-main`, not `document` or `window`.
