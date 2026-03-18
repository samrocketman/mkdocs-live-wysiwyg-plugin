# Unfocused Mode — Design Document

## Purpose

Unfocused Mode is the inline editing state: the WYSIWYG editor is rendered on the readonly page with the live-edit controls bar overlay. The user edits content in place without entering fullscreen Focus Mode.

## Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  div.live-edit-controls (controls bar)                                    │
│  [Live Edit:] [Edit] [Save] [Cancel] [Rename] [Delete] [New] [Toggle]     │
├─────────────────────────────────────────────────────────────────────────┤
│  .live-edit-wysiwyg-wrapper (or .live-edit-source in markdown mode)       │
│  Content-editable area or markdown textarea                               │
└─────────────────────────────────────────────────────────────────────────┘
```

The controls bar and editing surface replace or overlay the readonly content area. The upstream `mkdocs-live-edit-plugin` provides the controls bar structure; the WYSIWYG plugin injects the toggle button and replaces the textarea with the WYSIWYG editor when enabled.

## Controls Bar

### Gradient and Theming

The controls bar uses a gradient background defined in the theme overrides:

- `background: linear-gradient(to bottom, var(--md-primary-fg-color), var(--md-footer-bg-color))`
- `border-color: var(--md-primary-fg-color--dark)`
- `color: var(--md-primary-bg-color)`

The upstream `live-edit-plugin` sets `padding: 5px 10px` on `div.live-edit-controls`. Theme detection and overrides are documented in `DESIGN-theme-detection.md`.

### Button Positioning

Buttons and the "Live Edit:" label remain in their original positions when the editor is enabled or disabled. The WYSIWYG plugin does not modify controls bar padding. Width alignment is achieved via negative margins on the editing surfaces, not by shifting the controls bar.

### Toggle Button Injection

`ensureToggleButton` injects a toggle button into the controls bar, placed after the `.live-edit-label` (or as first child if no label). The button switches between WYSIWYG and plain textarea modes. It is inserted when `observeForTextarea` runs and when the editor is first activated. `removeToggleButton` removes it on destroy.

## Width Alignment

The editing surfaces use negative horizontal margins (`margin-left: -10px; margin-right: -10px`) to extend through the controls bar padding and match the width of the readonly content. Affected selectors:

- `.live-edit-controls.live-edit-editing .live-edit-source`
- `.live-edit-controls.live-edit-editing .live-edit-wysiwyg-wrapper`

See `layout.mdc` and `DESIGN-theme-detection.md` for full details.

## Transition to Focus Mode

The user enters Focus Mode via:

1. **Focus Mode toolbar button**: Expand icon at the right end of the WYSIWYG toolbar. Calls `enterFocusMode()`.
2. **Browser fullscreen**: When the page is in edit mode and the editor is enabled, the `fullscreenchange` event triggers `enterFocusMode()` if the document enters fullscreen.

`enterFocusMode` reparents the toolbar and editor wrapper into the focus overlay. The same DOM nodes are moved; they are not recreated. Cursor and selection are captured before reparenting and restored after the overlay is built.

## Relationship to Upstream

Unfocused Mode depends on the upstream `mkdocs-live-edit-plugin` for:

- The controls bar DOM structure (`.live-edit-controls`)
- The Edit, Save, Cancel, Rename, Delete, New buttons
- The textarea (`.live-edit-source`) that the WYSIWYG plugin replaces

The WYSIWYG plugin augments the controls bar with the toggle button and replaces the textarea with the WYSIWYG editor wrapper when the user enables the editor.

## Layout Subsystem

Width alignment via negative margins, controls bar padding constraints, and dynamic style overrides are governed by the Layout subsystem. See [DESIGN-layout.md](DESIGN-layout.md) for the authoritative contracts.

## Scroll Suppression During Focus Mode

When focus mode is active (Layer 2 in the mode hierarchy), unfocused mode's document-level scrolling is disabled via `overflow: hidden` on both `document.body` and `document.documentElement`. Permanent document-level event handlers registered by unfocused mode (e.g., `selectionchange`, `mousedown`, `scroll` in `captureReadModeSelectionOnChange`) include `if (isFocusModeActive) return;` guards to prevent execution during focus mode.

See [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md) for the full mode hierarchy and suppression contract.
