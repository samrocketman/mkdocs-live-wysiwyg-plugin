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
| `99995` | `.live-wysiwyg-focus-settings-dropdown`, `.live-wysiwyg-page-submenu` | `_getFocusModeCSS` |
| `99996` | `.live-wysiwyg-nav-popup` | `_getFocusModeCSS` |
| `99998` | `.md-link-chain-indicator` | JS inline style |
| `99999` | `.md-table-grid-selector`, `.md-contextual-table-toolbar`, `.md-code-lang-dropdown`, `.md-code-settings-dropdown`, `.md-admonition-settings-dropdown`, `.md-link-settings-dropdown`, `.md-image-insert-dropdown`, `.md-image-gear-dropdown`, `.live-wysiwyg-nav-dialog`, `.live-wysiwyg-selection-edit-popup`, `.live-wysiwyg-emoji-autocomplete`, `.md-admonition-dropdown`, `.live-wysiwyg-nav-review-popup` | `editor.css`, `_getFocusModeCSS`, JS inline styles |
| `100000` | `.live-wysiwyg-toast` | `_getFocusModeCSS` |
| `100001` | `#live-wysiwyg-pipeline-progress` | JS inline style |
| `100002` | `#live-wysiwyg-post-save-notifications` | JS inline style |
| `999999` | Admonition details confirm overlay (`_showAdmonitionDetailsConfirm`) | JS inline style |

### Z-Index Design Rationale

- **0–100**: In-content elements that layer relative to each other within the editable area.
- **99989**: Early overlay that appears before focus mode is fully initialized.
- **99990**: Focus overlay — the primary stacking context for all focus-mode UI.
- **99993–99996**: Panels and popups that float above the focus overlay but below editor dropdowns.
- **99999**: All editor dropdowns share the same layer so they can overlap each other freely.
- **100000–100002**: Global UI elements (toast, progress bar, notifications) that must appear above everything.
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

### Rules

- Every dropdown open function must call `_dismissAllDropdowns()` as its first action.
- No ad-hoc dismiss calls — always use the centralized function.
- Mode switch (`switchToMode`) additionally calls `dismissImageSelection()` for image-related cleanup.
- New dropdown types must add their dismiss function to `_dismissAllDropdowns()`.

## Animation and Transition Catalog

| Element | Property | Duration | Easing | Trigger |
|---|---|---|---|---|
| Toolbar drawer | `max-height` | `0.25s` | `ease-in-out` | Hamburger toggle |
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
