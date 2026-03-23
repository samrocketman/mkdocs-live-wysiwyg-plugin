# Toolbars — Design Document

## Overview

The WYSIWYG toolbar (`.md-toolbar`) is a single DOM element that is reparented between containers when switching between normal and focus mode. It is never duplicated. In focus mode, the toolbar lives inside a collapsible drawer with mode toggle, save/discard, settings, and optional Page Management controls.

## Single DOM Element

The toolbar is the same DOM element moved between containers. On enter focus mode it is reparented from its original parent to `.live-wysiwyg-focus-drawer-toolbar-wrap`. On exit it is restored to its original parent as first child. New toolbar buttons added to the toolbar are automatically available in focus mode because the toolbar is reparented, not cloned.

## Collapsible Toolbar Drawer

- **Default state**: Open (toolbar visible on first use; state persisted via `live_wysiwyg_focus_toolbar`)
- **Toggle**: Hamburger icon button (`.live-wysiwyg-focus-drawer-toggle`) in the header left area
- **Transition**: `max-height` with `0.3s ease-in-out` (0 when closed, `var(--_toolbar-h, 260px)` when open)
- **State class**: `live-wysiwyg-focus-toolbar-open` on the overlay
- **Contents**: Mode toggle, Page Management button (Material only), save button, discard button, settings gear, and the WYSIWYG toolbar
- **Height tracking**: `_updateToolbarHeight` sets the `--_toolbar-h` CSS variable from the drawer's `scrollHeight`, which feeds into `--_panel-h` for panel height calculations

## Drawer Controls

| Control | Description |
|---------|-------------|
| Mode toggle | WYSIWYG \| Markdown; calls `switchToMode()`; keyboard shortcut Ctrl+. (Cmd+. on Mac) |
| Page Management | Material theme only; opens page management submenu (create, rename, delete) |
| Save | Delegates to `_doFocusModeSave()`; keyboard shortcut Ctrl+S (Cmd+S on Mac) |
| Discard | Resets content to last saved state |
| Settings | Gear button; opens dropdown with persistent checkboxes |

## Mode Toggle

- Reflects the current mode on focus mode entry
- Updates immediately when clicked
- Hides the toolbar wrap section in Markdown mode (`display:none` as resting state) since WYSIWYG buttons do not apply
- Toggle, save, discard, and settings remain visible in Markdown mode
- Keyboard shortcut: Ctrl+. (Cmd+. on Mac)
- When Markdown mode is active, the overlay gains `focus-mode-markdown` for width-collapsing transitions on sidebars

### Mode Switch Animations

Two JS-driven animations run in parallel when the user clicks a mode toggle button:

**Toolbar wrap slide** (`_slideToolbarWrap`): The toolbar wrap slides out (WYSIWYG to Markdown) or slides in (Markdown to WYSIWYG) using the Web Animations API. Duration: `150ms`, easing: `ease-in-out`. Animates `maxHeight`, `paddingTop`, `paddingBottom`, and `opacity`. The CSS `display:none` class (`focus-markdown-mode`) is applied as the resting state only after the slide-out animation finishes, and removed before the slide-in animation starts.

**Content area crossfade** (`_crossfadeContentSwitch`): The content area (`.md-editor-content-area`) fades out over `80ms` (`ease-in`), the mode switch runs at opacity 0 (hiding the content conversion), then fades in over `80ms` (`ease-out`). Total: `160ms`.

Both animations start immediately on button click — before `switchToMode()` runs — so the user sees instant visual feedback. The toolbar slide is fire-and-forget (runs on the compositor). The crossfade wraps `switchToMode()` + `syncModeToggle()` so the heavy content conversion is invisible.

`_updateToolbarHeight` is called after each mode switch to recalculate `--_toolbar-h`, since the toolbar wrap visibility change alters the drawer's content height.

Initial focus mode entry uses instant `display:none` (no animation) when entering in Markdown mode.

## Content Auto-Save

Content is auto-saved to disk whenever the undo/redo DAG captures a new history node (500ms debounce). There are no Save or Discard buttons in the drawer. See [DESIGN-uninterrupted-content-save.md](DESIGN-uninterrupted-content-save.md).

## Settings Dropdown

The gear button (`.live-wysiwyg-focus-settings-btn`) opens a dropdown with a single persistent checkbox:

- **Auto-launch editor** (`live_wysiwyg_autolaunch`) — When enabled, auto-clicks the Edit button on page load, entering focus mode automatically. When disabled, the page loads in readonly mode.

## Page Management Button

In the drawer controls, a "Page Management" button appears only when the Material theme is detected. It triggers the page management submenu for creating, renaming, and deleting pages.

## Reparenting Lifecycle

### Enter Focus Mode

1. Save reference to toolbar's original parent
2. Reparent `wysiwygEditor.toolbar` to drawer toolbar wrap
3. Reparent `wysiwygEditor.editorWrapper` to focus content area

### Exit Focus Mode

1. Reparent `wysiwygEditor.toolbar` to original parent (as first child)
2. Reparent `wysiwygEditor.editorWrapper` to `wysiwygContainer`

## Invariants

1. The toolbar is a single DOM element — never duplicated
2. The toolbar is reparented between normal and focus mode containers
3. New toolbar buttons are automatically available in focus mode
4. In Markdown mode, the toolbar wrap section is hidden; drawer controls remain visible
5. Mode toggle reflects the current editor mode on entry and after each switch
6. Mode switch animations (toolbar slide + content crossfade) start immediately on click, before content conversion
7. `_updateToolbarHeight` must be called after every mode switch to keep `--_toolbar-h` accurate

## Three-Column Spacing Balance

The toolbar drawer sits above the three-column layout (nav sidebar, content, TOC). When the drawer opens or closes, the content area shifts vertically. The toolbar drawer animation (`.3s ease-in-out` on `max-height`) is synchronized with a matching transition on `.live-wysiwyg-focus-grid`'s `min-height` so the content slides smoothly in sync with the drawer.

The `--_toolbar-h` CSS variable (set by `_updateToolbarHeight` from the drawer's `scrollHeight`) flows into `--_panel-h`, which in turn governs sidebar `max-height` and content area `min-height`. This chain ensures all three columns resize together when the drawer state changes.

## Layout Subsystem Dependency

Toolbar reparenting order, drawer animation timing, and flex-wrap layout are governed by the Layout subsystem. The toolbar drawer's open/close animation timing and easing are defined in the Layout subsystem's Animation and Transition Catalog. This document describes *what* animates; [DESIGN-layout.md](DESIGN-layout.md) defines *how* (duration, easing, synchronized transitions).

- Drawer animation: `max-height .3s ease-in-out` (via `--_toolbar-h`)
- Grid sync: `min-height .3s ease-in-out` on `.live-wysiwyg-focus-grid`
- Standard focus overlay slide duration: `.3s ease-in-out`
