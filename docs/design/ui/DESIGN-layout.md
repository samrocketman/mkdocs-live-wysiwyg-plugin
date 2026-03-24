# Layout Subsystem

The Layout subsystem is the **single authority** for all positioning, dimension, animation, scroll, z-index stacking, dropdown dismissal, and DOM reparenting techniques across the WYSIWYG editor. Other subsystems define *what* needs to be positioned; Layout defines *how*.

Cursor rule: `.cursor/rules/layout.mdc`

## Structural Grid and Container Layout

### Focus Mode Three-Column Grid

```
┌── .live-wysiwyg-focus-overlay (position:fixed; inset:0; z-index:99990) ───────┐
│ ┌── .live-wysiwyg-focus-header (height:2.4rem) ────────────────────────────┐  │
│ └──────────────────────────────────────────────────────────────────────────┘  │
│ ┌── .live-wysiwyg-focus-main (flex:1; overflow-y:auto) ────────────────────┐  │
│ │ ┌── .live-wysiwyg-focus-grid (max-width:61rem; display:flex) ──────────┐ │  │
│ │ │ 15.8rem+         flex-grow:1               12.1rem                   │ │  │
│ │ │ sidebar-left     content                   toc (sticky)              │ │  │
│ │ └──────────────────────────────────────────────────────────────────────┘ │  │
│ └────────────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Element | Dimensions | Notes |
|---|---|---|
| `.live-wysiwyg-focus-grid` | `max-width:61rem; display:flex` | Matches `md-main__inner md-grid` |
| `.live-wysiwyg-focus-sidebar-left` | `width:calc(15.8rem + var(--_nav-extend,0px))` | `--_nav-extend` = `clamp(0px,(100vw - 61rem)/2 - 2em,10rem)` |
| `.live-wysiwyg-focus-content` | `flex-grow:1; min-width:0` | Matches `md-content` |
| `.live-wysiwyg-focus-toc` | `width:12.1rem; position:sticky; top:0` | Matches `md-sidebar--secondary` |

### Width Alignment (Unfocused Mode)

Editing surfaces use **negative horizontal margins** (`-10px`) to extend through the `10px` padding on `div.live-edit-controls`, matching the readonly HTML content width. See `layout.mdc` for the full mechanism.

### Responsive Breakpoints

| Breakpoint | Effect |
|---|---|
| `< 76.25em` | Left sidebar (nav menu) hidden |
| `< 60em` | Right sidebar (TOC) hidden |

New responsive behavior must use these breakpoints or declare new ones in this document.

## Z-Index Registry

Every z-index value in the codebase. New z-index values must be added here before use.

| z-index | Element(s) | Source |
|---|---|---|
| `-1` | Header topic animations (behind) | `_getFocusModeCSS` |
| `0` | Header topic active state | `_getFocusModeCSS` |
| `1` | TOC sticky, nav item focus outline | `_getFocusModeCSS` |
| `2` | TOC toggle, nav item border, `.md-image-settings-btn` | `_getFocusModeCSS`, `editor.css` |
| `3` | `.md-image-resize-handle`, `.md-image-dimension-label` | `editor.css` |
| `4` | `.live-wysiwyg-focus-header` | `_getFocusModeCSS` |
| `5` | `.md-code-lang-btn`, `.md-code-btn-group-advanced`, `.md-code-settings-btn`, `.md-admonition-settings-btn` | `editor.css` |
| `50` | `.live-wysiwyg-nav-status` | `_getFocusModeCSS` |
| `100` | `.md-heading-dropdown` (normal mode) | `editor.css` |
| `99989` | `.live-wysiwyg-early-overlay` | `plugin.py`, `_getFocusModeCSS` |
| `99990` | `.live-wysiwyg-focus-overlay`, `.live-wysiwyg-nav-transition-overlay` | `_getFocusModeCSS` |
| `99993` | `.live-wysiwyg-dead-link-panel` | `_getFocusModeCSS` |
| `99995` | `.live-wysiwyg-focus-settings-dropdown`, `.live-wysiwyg-page-submenu`, `.live-wysiwyg-mermaid-overlay`, `.live-wysiwyg-history-overlay`, `.live-wysiwyg-history-fullsize-preview` | `_getFocusModeCSS` |
| `99996` | `.live-wysiwyg-nav-popup`, `.live-wysiwyg-asset-preview-popup` | `_getFocusModeCSS` |
| `99998` | `.md-link-chain-indicator` | JS inline style |
| `99999` | `.md-table-grid-selector`, `.md-contextual-table-toolbar`, `.md-code-lang-dropdown`, `.md-code-settings-dropdown`, `.md-admonition-settings-dropdown`, `.md-link-settings-dropdown`, `.md-image-insert-dropdown`, `.md-image-gear-dropdown`, `.live-wysiwyg-nav-dialog`, `.live-wysiwyg-selection-edit-popup`, `.live-wysiwyg-emoji-autocomplete`, `.md-admonition-dropdown`, `.live-wysiwyg-nav-review-popup`, `.live-wysiwyg-asset-lightbox`, `.live-wysiwyg-history-branch-popup`, `.live-wysiwyg-history-hover-preview` | `editor.css`, `_getFocusModeCSS`, JS inline styles |
| `100000` | `.live-wysiwyg-toast` | `_getFocusModeCSS` |
| `100001` | `#live-wysiwyg-pipeline-progress` | JS inline style |
| `100002` | `#live-wysiwyg-post-save-notifications` | JS inline style |
| `100003` | `.live-wysiwyg-help-overlay` | `_getFocusModeCSS` |
| `999999` | Admonition details confirm overlay (`_showAdmonitionDetailsConfirm`) | JS inline style |

### Z-Index Design Rationale

- **0–100**: In-content elements that layer relative to each other within the editable area.
- **99989**: Early overlay that appears before focus mode is fully initialized.
- **99990**: Focus overlay — the primary stacking context for all focus-mode UI.
- **99993–99996**: Panels and popups that float above the focus overlay but below editor dropdowns. The mermaid overlay (`.live-wysiwyg-mermaid-overlay` at 99995) is Layer 3, and the history overlay (`.live-wysiwyg-history-overlay` at 99995) is Layer 4 — both above the focus overlay (Layer 2). Mermaid and History share z-index 99995 because they are mutually exclusive per Cardinal Rule #9 (see [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md) § Layer-Level Mutual Exclusion).
- **99999**: All editor dropdowns share the same layer so they can overlap each other freely.
- **100000–100002**: Global UI elements (toast, progress bar, notifications) that must appear above everything.
- **100003**: Help modal (Layer 5) — above all editing surfaces and global UI. See [DESIGN-help-system.md](DESIGN-help-system.md).
- **999999**: Confirm overlays that block all interaction.

## Dropdown and Popup Positioning Contract

All dropdowns and popups must follow this universal pattern:

1. Get anchor position via `getBoundingClientRect()` on the trigger button/element.
2. Set `position: fixed` on the dropdown.
3. Position below the anchor: `top = rect.bottom + gap`.
4. If the dropdown extends beyond the viewport bottom, flip above: `top = rect.top - dropdownHeight - gap`.
5. Clamp horizontal position to stay within viewport bounds.

Participants: link settings, admonition settings, code settings, code lang, image insert, image gear, table grid selector, heading dropdown, emoji autocomplete, selection edit popup, nav review popup, dead link popup.

New dropdowns must follow this contract. The `z-index` must be `99999` (matching existing editor dropdowns) or registered in the z-index registry above if a different value is needed.

## Cross-Dropdown Dismissal Contract

`_dismissAllDropdowns()` is the centralized function that dismisses every active dropdown and popup. It calls:

- `dismissActiveSettingsDropdown()` (code settings)
- `dismissActiveLangDropdown()` (code language)
- `dismissAdmonitionSettingsDropdown()` (admonition gear)
- `dismissImageInsertDropdown()` (image insert)
- `dismissImageGearDropdown()` (image gear)
- `_dismissLinkDropdownFn()` (link settings — via closure variable)
- `_admonitionDropdownDismiss()` (admonition toolbar type picker)
- `hideSelectionEditPopup()` (selection edit popup)
- `_dismissHistoryBranchPopup()` (history branch picker popup)

### Rules

- Every dropdown open function must call `_dismissAllDropdowns()` as its first action.
- No ad-hoc dismiss calls — always use the centralized function.
- Mode switch (`switchToMode`) additionally calls `dismissImageSelection()` for image-related cleanup.
- New dropdown types must add their dismiss function to `_dismissAllDropdowns()`.

## Animation and Transition Catalog

| Element | Property | Duration | Easing | Trigger |
|---|---|---|---|---|
| Toolbar drawer | `max-height` (via `--_toolbar-h`) | `0.3s` | `ease-in-out` | Hamburger toggle |
| Focus grid (sync) | `min-height` | `0.3s` | `ease-in-out` | Drawer open/close (via `--_panel-h`) |
| Toolbar wrap (mode switch) | `maxHeight`, `padding`, `opacity` | `150ms` | `ease-in-out` | WYSIWYG/Markdown toggle (JS-driven via `_slideToolbarWrap`) |
| Content area crossfade | `opacity` | `80ms` out + `80ms` in | `ease-in` / `ease-out` | WYSIWYG/Markdown toggle (JS-driven via `_crossfadeContentSwitch`) |
| Left sidebar (markdown mode collapse) | `transform`, `opacity`, `width`, `margin` | `0.3s` | `ease-in-out` | WYSIWYG/Markdown toggle |
| Right sidebar / TOC (markdown mode collapse) | `transform`, `opacity`, `width`, `margin` | `0.3s` | `ease-in-out` | WYSIWYG/Markdown toggle |
| Nav sidebar (WYSIWYG mode) | `transform`, `opacity` | `0.3s` | `ease-in-out` | Nav toggle |
| Nav section expand/collapse | `grid-template-rows` | `0.25s` | `cubic-bezier(.4,0,.2,1)` | Section click |
| Header topic slide | `transform`, `opacity` | Material-matching cubic-bezier | cubic-bezier | Scroll-triggered heading change |
| Container auto-expand | dynamic `width`/CSS property | JS-driven via `_attachContainerExpandBehavior` | `0.3s ease-in-out` (CSS transition set by JS) | Text input exceeding container width |
| Pipeline progress bar | indeterminate animation | `1.5s` | `ease-in-out` | Batch save |
| Notification fade | `opacity`, `transform` | JS-driven | — | Post-save notifications |
| Transition overlay | `opacity` | JS-driven style manipulation | — | Page transitions |

New animations must use existing durations and easing values where possible. Introducing new timing requires documenting it here.

Toolbar drawer animation details are also referenced from [DESIGN-toolbars.md](DESIGN-toolbars.md). The Toolbar subsystem describes the hamburger toggle behavior; this document defines the animation timing. `.3s ease-in-out` is the standard duration for all slide transitions in the focus overlay.

The mode-switch animations (toolbar wrap slide and content crossfade) use shorter durations than the standard `.3s` because they are direct responses to user mode toggle actions where perceived responsiveness is critical. Both use the Web Animations API and run on the compositor thread, starting immediately on click before `switchToMode()` content conversion. See [DESIGN-toolbars.md](DESIGN-toolbars.md) "Mode Switch Animations" for the full flow.

## Scroll Container Management

### Mode-Dependent Scroll Containers

| Mode | Scroll Container | Notes |
|---|---|---|
| Normal (unfocused) | `editableArea` (`.md-editable-area`) | Direct scroll target |
| Focus mode (WYSIWYG) | `.live-wysiwyg-focus-main` | The three-column grid's scroll wrapper |
| Focus mode (Markdown) | `.live-wysiwyg-focus-main` | Same container, textarea fills content area |

`scrollToCenterCursor` auto-detects focus mode and redirects to the correct container. In focus mode the cursor is positioned at 15% from top; in normal mode at 50% (center).

### Scroll Preservation

Scroll position (`scrollTop`) is saved and restored across all mode transitions:
- Normal <-> Focus mode: `_captureEditorSelection` / `_restoreEditorSelection`
- WYSIWYG <-> Markdown: via `switchToMode` scroll save/restore
- Nav edit entry/exit: via cookie-based cursor state
- Nav sidebar: `_renderNavFromSnapshot` saves `scrollTop`, scrolls focused item to center via `requestAnimationFrame`, or restores previous `scrollTop` if no focused item

### Scroll Listeners

| Listener | Container | Purpose |
|---|---|---|
| `_focusContentScrollHandler` | `.live-wysiwyg-focus-main` | TOC active heading tracking (20px threshold), dynamic header H1/H2 |
| `_smoothScrollTo` | Various | Animated scroll with easing for programmatic scroll |
| Nav scroll-to-focused | `_navScrollWrap` | Centers focused `<li>` in `requestAnimationFrame` |

## DOM Reparenting Lifecycle

### Enter Focus Mode

1. Save `_focusOriginalToolbarParent = wysiwygEditor.toolbar.parentNode`
2. Move toolbar: `toolbarWrap.appendChild(wysiwygEditor.toolbar)` into focus drawer
3. Move editor wrapper: `contentArea.appendChild(wysiwygEditor.editorWrapper)` into focus content area

### Exit Focus Mode

1. Move toolbar back: `_focusOriginalToolbarParent.insertBefore(wysiwygEditor.toolbar, firstChild)`
2. Move editor wrapper back: `wysiwygContainer.appendChild(wysiwygEditor.editorWrapper)`

**Invariants:**
- Toolbar is the **same DOM element** — never cloned or recreated.
- Exit order is toolbar first, then editor wrapper. Reversing this breaks cursor preservation.
- `_captureEditorSelection` must run before reparenting; `_restoreEditorSelection` must run after.
- `_flushHistoryCapture()` must run before mode switch begins.
- Nav edit cleanup must run before focus mode cleanup.

### Dropdown Host Selection

- In focus mode: dropdowns append to `_focusOverlay` or use `position:fixed` to escape.
- In normal mode: dropdowns append to `document.body` or the editable area.

## Auto-Expansion Contract

`_attachContainerExpandBehavior` monitors input fields for content exceeding their container width (`scrollWidth > clientWidth`). When triggered, it sets a CSS transition and expands the container dynamically.

All dialogs with text input fields must use this pattern or an equivalent auto-expansion mechanism. Input fields in dropdowns must not clip or overflow — they must grow to accommodate the content.

## `editor.css` Layout Inventory

The vendor stylesheet (`mkdocs_live_wysiwyg_plugin/vendor/editor.css`) contains structural CSS for:

- Toolbar flex-wrap layout (`.md-toolbar`, `.md-toolbar-group`)
- Editor wrapper flex column (`.md-wysiwyg-editor-wrapper`)
- Editable area sizing (`.md-editable-area`, `.md-editor-content-area`)
- Dropdown positioning and sizing (all `.*-dropdown` selectors)
- Image resize handles and dimension labels
- Code block button positioning
- Table grid selector

Colors in `editor.css` are owned by the Theme subsystem. Layout owns only the structural properties (display, position, width, height, margin, padding, flex, grid, overflow, z-index).

## Sidebar Spacing Contract

Both sidebars (nav and TOC) use consistent vertical spacing for item links:

| Property | Nav (`.live-wysiwyg-focus-sidebar-left`) | TOC (`.live-wysiwyg-focus-toc`) |
|---|---|---|
| `margin-top` | `.625em` | `.625em` |
| `line-height` | `1.3` | `1.3` |
| `font-size` | `.7rem` | `.7rem` |
| List padding | `padding: 0 .6rem .4rem` | `padding: 0 .6rem .4rem` |

Gecko-specific overrides normalize the nav sidebar (see Browser-Specific Layout Normalization below).

## TOC Width Extension

The TOC sidebar extends rightward beyond the grid's `max-width` to use available screen space:

- `--_toc-extend: clamp(0px, (100vw - 61rem) / 2 - 2em, 10rem)` defined on `.live-wysiwyg-focus-grid`
- TOC width: `calc(12.1rem + var(--_toc-extend, 0px))`
- Negative right margin: `calc(-1 * var(--_toc-extend, 0px))` pulls the TOC rightward without affecting flex layout

This mirrors the nav sidebar's `--_nav-extend` pattern for the left side.

## Content Area Gutter

`.live-wysiwyg-focus-content` uses `margin: 0 .2rem 1.2rem` to keep a minimal gap between the content and both sidebars. The `< 76.25em` responsive override uses `margin-left: 1.2rem; margin-right: 1.2rem` when sidebars are hidden.

## Scroll Isolation

When focus mode is active, document-level scrolling is suppressed:

- `overflow: hidden` on both `document.body` and `document.documentElement` (saved/restored on enter/exit)
- `overscroll-behavior: contain` on `.live-wysiwyg-focus-main` prevents scroll chaining

See [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md) for the mode hierarchy suppression contract.

## Markdown Vertical Fill

In markdown mode (`.focus-mode-markdown` class on the overlay), vertical gaps are eliminated so the textarea fills the available space:

| Override | Value | Reason |
|---|---|---|
| `.live-wysiwyg-focus-grid` `margin-top` | `0` | Remove top gap between drawer and grid |
| `.live-wysiwyg-focus-grid` `min-height` | `100%` | Fill entire main area |
| `.live-wysiwyg-focus-content` `padding-top`, `margin-top`, `margin-bottom` | `0` | Remove internal spacing |
| `.md-markdown-editor-container` `height` | `auto !important` | Override hardcoded calc |
| `.md-markdown-editor-container` `flex` | `1 1 0 !important` | Fill remaining vertical space |
| Sidebar `max-height` | `var(--_panel-h, calc(100vh - 2.4rem))` | Full viewport height (no grid margin subtraction) |

WYSIWYG mode layout is unchanged — all overrides are scoped via `.focus-mode-markdown`.

## Browser-Specific Layout Normalization

When layout rendering differs across browser engines, the fix is implemented as engine-conditional CSS in `_getFocusModeCSS()`, gated by `_compat.engine`. The Browser Compatibility subsystem (`browser-compat.js`) provides the engine detection; Layout owns the CSS rules.

### Pattern

```javascript
var css = '' + /* ... base CSS ... */ '';

if (_compat.engine === 'gecko') {
  css += /* Gecko-specific overrides */;
}

return css;
```

### Current Engine-Specific Overrides

| Engine | Target | Override | Reason |
|---|---|---|---|
| Gecko | `.md-nav__link` | `margin-top:9px` (replaces `.625em`) | `em`-based margins produce different subpixel values in Gecko at nested font-size inheritance depths |
| Gecko | `.md-nav__item--nested>.md-nav` | `min-height:0` | Gecko may contribute residual height to grid items with `visibility:collapse` even when `grid-template-rows:0fr` |
| Gecko | `.md-nav__item--nested>.md-nav>.md-nav__list` | `padding-bottom:.25rem` (replaces `.4rem`) | Normalizes gap between last child of expanded section and next sibling item |

See [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md) for the full workaround catalog and the "Gecko Nav Menu Item Spacing" entry.

## Cross-References

- [DESIGN-focus-mode.md](DESIGN-focus-mode.md) — focus mode grid, scroll, reparenting, sidebar collapse
- [DESIGN-toolbars.md](DESIGN-toolbars.md) — drawer animation, reparenting
- [DESIGN-table-of-contents.md](DESIGN-table-of-contents.md) — sticky positioning, scroll tracking
- [DESIGN-focus-nav-menu.md](DESIGN-focus-nav-menu.md) — nav sidebar width, controls positioning, section animation
- [DESIGN-popup-dialog-ux.md](DESIGN-popup-dialog-ux.md) — dropdown positioning contract
- [DESIGN-image-insertion-resize.md](DESIGN-image-insertion-resize.md) — z-index, fixed positioning, resize handles
- [DESIGN-unfocused-mode.md](DESIGN-unfocused-mode.md) — width alignment
- [DESIGN-snapshot-nav-architecture.md](DESIGN-snapshot-nav-architecture.md) — notification positioning
- [DESIGN-theme-detection.md](DESIGN-theme-detection.md) — overlay inline styles (layout aspect)
- [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md) — engine detection for layout normalization
- [DESIGN-help-system.md](DESIGN-help-system.md) — z-index 100003 for Layer 5 help modal
