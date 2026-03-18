# Popup & Dialog UX — Design Document

## Overview

Every popup, dropdown, and modal dialog in the WYSIWYG editor follows a unified keyboard interaction model. The goal is to let content authors interact with any dialog entirely from the keyboard — opening, editing, confirming, and dismissing without reaching for the mouse.

This document codifies the universal rules, smart defaults, and per-dialog specifics.

All code lives in `live-wysiwyg-integration.js`.

## Universal Keyboard Rules

Two keys work identically in every popup:

| Key | Behavior |
|-----|----------|
| **Enter** | "I'm done." If the user has made changes (dirty), Enter confirms/submits. If the user has NOT made changes (clean), Enter aborts (same effect as ESC). **Exception:** when a `<button>` has focus, Enter activates that specific button (native browser behavior). |
| **ESC** | "Cancel." Close the dialog without applying anything. |

These rules apply when the cursor is on an input field, a checkbox, a select, or other non-button element inside the dialog. When a `<button>` has focus, Enter always activates that button — this lets users Tab to Cancel, Delete, or any other button and press Enter to deliberately activate it. There is no per-field Enter behavior (e.g., advancing to the next field) — Tab handles field navigation; Enter handles intent.

## Dialog Categories

Dialogs fall into four categories. Each category refines the universal rules based on its interaction model.

### Form Dialogs

Dialogs with input fields, checkboxes, or other editable state. The user is creating or modifying data.

- Track a `dirty` flag (starts `false`, set `true` on any `input`/`change` event).
- **Enter + dirty (non-button focused)** = confirm/submit (click the primary action button).
- **Enter + clean (non-button focused)** = abort (same as ESC).
- **Enter (button focused)** = activate the focused button (native behavior). The user can Tab to Cancel or any other button and press Enter to activate it directly.
- **ESC** = cancel/close without applying.
- Smart defaults that pre-fill fields count as dirty.
- Auto-focus the first input field on open.

### Confirmation Dialogs

Button-only dialogs where the user makes a yes/no/choice decision. No editable fields.

- **Enter (no button focused)** = confirm (click the primary/danger button). There is no "change" to track.
- **Enter (button focused)** = activate the focused button (native behavior). If the user Tabs to Cancel and presses Enter, Cancel fires — not the primary action.
- **ESC** = cancel/close (resolve `null`).
- Auto-focus the primary action button on open. Since auto-focus lands on the primary button, the first Enter always confirms — but the user can Tab to an alternate button and Enter activates that instead.

### Settings Dropdowns

Dropdowns where changes apply live (on toggle/click). No explicit "Apply" action.

- **Enter** = dismiss (changes are already applied).
- **ESC** = dismiss.
- Auto-focus the first interactive element on open.

### Informational Popups

Read-only or notification popups with optional action buttons.

- **ESC** = dismiss.
- **Enter (no button focused)** = click first action button if present, otherwise dismiss.
- **Enter (button focused)** = activate the focused button (native behavior).
- Auto-focus the first action button (if any) on open.

## Auto-Focus

Every dialog auto-focuses an element immediately after opening:

| Category | Focus Target |
|----------|-------------|
| Form dialog | First input field |
| Confirmation dialog | Primary action button |
| Settings dropdown | First toggle/checkbox |
| Informational popup | First action button (or close button) |

Focus is set via `requestAnimationFrame` to ensure the element is rendered before focus is applied.

## Tab Order

All interactive elements within a dialog have a logical tab order set via `tabIndex`. Tab moves forward through elements; Shift+Tab moves backward. The order follows the visual layout: inputs first, then checkboxes/toggles, then action buttons (confirm before cancel).

## Dirty Tracking

Form dialogs track whether the user has made any changes since the dialog opened.

### Mechanism

```
dirty = false  (on open)
dirty = true   (on any input/change event on form elements)
```

### Pre-filled fields

When a smart default pre-fills a field, the dialog starts dirty. This means Enter immediately confirms — the user does not need to manually edit the pre-filled value to "activate" the confirm action. If the user wants to reject the pre-filled defaults, ESC aborts.

### What counts as dirty

- Typing in any input or textarea (`input` event)
- Changing a checkbox or select (`change` event)
- Smart defaults that programmatically set field values

### What does NOT count as dirty

- Focusing an element
- Scrolling within the dialog
- Tab/Shift+Tab navigation between fields

## Smart Defaults

Smart defaults pre-fill dialog fields based on available context, reducing keystrokes for common operations. All smart defaults are overridable — the user can always change the pre-filled value.

### Principles

1. **Derive from context.** Use the item, selection, page state, or sibling data that is already available when the dialog opens.
2. **Prefer the common case.** The default should match what most users would type most of the time.
3. **Pre-filling counts as dirty.** Enter immediately confirms when defaults are present, because the most common action is to accept them.
4. **Graceful degradation.** If the context needed for a smart default is unavailable, fall back to empty/placeholder. Never block the dialog from opening.

### Per-Dialog Smart Defaults

#### Create New Folder (`_promptNewFolder`)

| Field | Default | Source |
|-------|---------|--------|
| Folder name | Slugified item title or filename | `item.title` -> `getting-started`; asset filename -> `diagram` |
| Display name | Item title or capitalized filename | `item.title` (pages); `diagram.png` -> `Diagram` (assets) |
| "Only create folder" | Checked when `item.type === 'asset'` | Non-page files cannot serve as section index pages |
| Dialog title | "...for this file:" when asset | Contextual wording |

The slug uses only lowercase alphanumeric characters and hyphens, matching the existing folder name input sanitizer.

#### Create New Page (`_showNewPageDialog`)

| Field | Default | Source |
|-------|---------|--------|
| Weight | Next logical value | `max(sibling weights) + 100`, or config default, or `100` |

Weight is computed from the parent section's children via `_findSectionByDir`. When no siblings exist, falls back to `liveWysiwygNavWeightConfig.frontmatter_defaults.weight` or `100`.

#### Image Gear (`_showImageGearDropdown`)

| Field | Default | Source |
|-------|---------|--------|
| Alt text (when empty) | Derived from image `src` | `architecture-diagram.png` -> `architecture diagram` |

Only applies when alt is empty on open. Strips path, removes extension, replaces hyphens and underscores with spaces.

#### Insert Link (`createLinkDropdown`)

| Field | Default | Source |
|-------|---------|--------|
| URL (new links only) | Clipboard content if URL | `navigator.clipboard.readText()` (async, graceful fallback) |

Only attempted when creating a new link (not editing an existing one) and the URL field would be the default `https://`. If clipboard read fails (permissions denied, non-URL content), the field keeps its default. This is async and runs after the initial focus. Browser-specific clipboard behavior (including Safari user-gesture timing) is documented in [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md).

#### Insert Image (`createImageInsertDropdown`)

| Field | Default | Source |
|-------|---------|--------|
| Alt text (when URL is set manually) | Derived from URL filename | `docs/images/flow-chart.png` -> `flow chart` |

Triggered on the Insert click or URL blur when alt is empty and a URL has been typed or pasted manually (not via autocomplete, which already has this behavior). Same filename-to-alt logic as the image gear dropdown.

## Dialog Inventory

### Form Dialogs

| Dialog | Function | Auto-Focus | Tab Order |
|--------|----------|------------|-----------|
| Create New Folder | `_promptNewFolder` | nameInput | nameInput -> titleInput -> onlyFolderCb -> createBtn -> cancelBtn |
| Rename Page | `_showRenameDialog` | filenameInput | filenameInput -> titleInput -> renameBtn -> cancelBtn |
| Create New Page | `_showNewPageDialog` | filenameInput | filenameInput -> titleInput -> weightInput -> contentInput -> confirmBtn -> cancelBtn |
| Image Gear | `_showImageGearDropdown` | altInput | altInput -> attrSyntaxCb -> inlineCb -> originalBtn -> docSizeBtn |
| Insert/Edit Link | `createLinkDropdown` | urlInput | urlInput -> textInput -> removeBtn -> applyBtn |
| Insert Image | `createImageInsertDropdown` | urlInput | urlInput -> altInput -> sizeSlider -> applyBtn |
| Nav Settings Gear | `_buildSettingsContent` | first field | type/weight -> checkboxes -> rename input -> action buttons (Apply, Delete, Create folder index, etc. — Enter only activates these when tabbed to) |

### Confirmation Dialogs

| Dialog | Function | Auto-Focus | Tab Order |
|--------|----------|------------|-----------|
| Admonition Details Confirm | `_showAdmonitionDetailsConfirm` | proceedBtn | proceedBtn -> cancelBtn |
| Nav Dialog | `_showNavDialog` | primary/danger/first btn | sequential through buttons |
| Nav Dialog (HTML body) | `_showNavDialogHtml` | primary/danger/first btn | sequential through buttons |
| Dead Link Wizard | `_showDeadLinkAnalysisWizard` | applyBtn | toggles -> includeAllBtn -> applyBtn |

### Settings Dropdowns

| Dialog | Function | Auto-Focus | Tab Order |
|--------|----------|------------|-----------|
| Code Block Settings | `createSettingsDropdown` | autoIndentBtn | autoIndentBtn -> spacesBtn -> tabsBtn -> size buttons |
| Admonition Settings | `createAdmonitionSettingsDropdown` | typeSelect | typeSelect -> placement -> collapsible -> collapsed -> detailsTag -> hideTitle |
| Focus Mode Settings | `_createSettingsDropdown` | first checkbox | autolaunchCb -> autofocusCb -> focusRemainCb |
| Page Submenu | `_createPageSubmenu` | first item | sequential through items |

### Informational Popups

| Dialog | Function | Auto-Focus | Notes |
|--------|----------|------------|-------|
| Nav Popup | `_showNavPopup` | first button | ESC + Enter |
| Caution Popup | `_showCautionPopup` | Resolve btn | ESC only |
| Review Changes | `_showReviewChangesPopup` | first element | Already has ESC |
| Dead Link Panel | `_showDeadLinkPanel` | close btn | ESC to dismiss |
| Asset Preview | `_showAssetPreviewPopup` | Expand btn | Small preview with expand; ESC + Enter |
| Asset Lightbox | `_showAssetLightbox` | Close btn | Modal image/text viewer; ESC to dismiss, click-outside backdrop |

### Excluded (No Changes)

| Dialog | Function | Reason |
|--------|----------|--------|
| Selection Edit Popup | `showSelectionEditPopup` | Non-modal transient popup, not keyboard-driven |
| Emoji Autocomplete | `showEmojiAutocomplete` | Keyboard handled by parent input handler |
| Language Dropdown | `createLangDropdown` | Already has full keyboard support |

## Rules

1. **Enter and ESC work from the dialog container.** The handler is on the dialog container, not on individual elements. No element-specific Enter handlers that advance between fields. When a button has focus, Enter defers to native behavior (see rule 11).

2. **Tab navigates, Enter confirms.** Field-to-field navigation uses Tab/Shift+Tab. Enter always expresses intent (confirm or abort), never advances to the next field.

3. **Dirty tracking determines Enter behavior.** In form dialogs, Enter + dirty = confirm, Enter + clean = abort. Pre-filled smart defaults count as dirty.

4. **Auto-focus is mandatory.** Every dialog must focus an element on open. The user should be able to immediately interact without clicking.

5. **Tab order must be explicit.** Set `tabIndex` on all interactive elements in logical order. Do not rely on implicit DOM order unless it already matches the desired sequence.

6. **Smart defaults are overridable.** Pre-filled values are suggestions, not mandates. The user can always clear and type their own value.

7. **Smart defaults degrade gracefully.** If the context for a default is unavailable (missing item data, clipboard permission denied, no siblings for weight), fall back to empty/placeholder without errors or blocked UI.

8. **`preventDefault` and `stopPropagation` on Enter and ESC.** Both keys must be fully consumed by the dialog handler to prevent interference with document-level handlers (nav edit ESC, Ctrl+S, content editing guards). Exception: when a button has focus, Enter is not intercepted (see rule 11).

9. **Confirmation dialogs confirm on Enter by default.** There is no dirty tracking for button-only dialogs. Since auto-focus lands on the primary button, the first Enter confirms. If the user Tabs to a different button, Enter activates that button instead (rule 11).

10. **Settings dropdowns dismiss on both Enter and ESC.** Changes are already applied live. Both keys close the dropdown.

11. **Button focus overrides dialog-level Enter.** When a `<button>` inside the dialog has focus, Enter must not be intercepted by the dialog-level handler. Instead, the native browser behavior fires the focused button's click handler. This lets users Tab to any button (Cancel, Delete, Create folder index, etc.) and press Enter to activate it. The dialog-level Enter logic (dirty-aware confirm, dismiss, etc.) only applies when a non-button element (input, checkbox, select, or the dialog itself) has focus.

## Implementation

All dialog keyboard handling is implemented through `_attachDialogKeyboard(container, opts)` — a centralized function that encapsulates the rules above. See [DESIGN-centralized-keyboard.md](DESIGN-centralized-keyboard.md) for the full architecture and function signature.

## Layout Subsystem

Dropdown and popup positioning (z-index, `position:fixed`, viewport flip), cross-dropdown dismissal (`_dismissAllDropdowns()`), and text field auto-expansion are governed by the Layout subsystem. See [DESIGN-layout.md](DESIGN-layout.md) for the authoritative contracts.
