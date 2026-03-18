# Theme Detection & CSS Variable Injection — Design Document

## Purpose

The WYSIWYG plugin must look visually consistent with the page's theme regardless of whether the theme is Material, Cinder, MkDocs default, or any other MkDocs-compatible theme. Rather than depending on the upstream `mkdocs-live-edit-plugin` to adopt CSS variables (an unmerged change), the WYSIWYG plugin owns all theming: it detects colors at runtime, sets CSS custom properties on `:root`, and injects a `<style>` block that overrides the upstream plugin's hardcoded colors.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Page loads with theme-provided CSS                          │
│  (Material sets --md-* vars; other themes do not)            │
└──────────────────────┬───────────────────────────────────────┘
                       │
            ┌──────────▼──────────┐
            │  _detectThemeColors │  Called once from replaceTextareaWithWysiwyg()
            └──────────┬──────────┘
                       │
          ┌────────────▼────────────┐
          │ Material vars present?  │
          └────┬───────────────┬────┘
             YES               NO
               │                │
   ┌───────────▼───────┐  ┌────▼─────────────────────┐
   │ Fill gaps only:   │  │ Sample computed styles:   │
   │ --md-footer-bg-*  │  │ • navbar bg/fg → primary  │
   │ --md-code-font-*  │  │ • body bg/fg → default    │
   │ (if theme lacks)  │  │ • <a> color → accent      │
   └───────────────────┘  │ • body font → text/code   │
                          │ Derive variants:           │
                          │ • darken/lighten/alpha     │
                          │ Set all on :root           │
                          └────────────────────────────┘
                       │
            ┌──────────▼──────────────────────┐
            │ <style id="live-wysiwyg-theme-  │  Injected alongside width overrides
            │          overrides">             │  in replaceTextareaWithWysiwyg()
            │ Overrides upstream hardcoded     │
            │ colors with var(--md-*, fallback)│
            └─────────────────────────────────┘
```

## Two Branches of Detection

### Branch 1 — Material Theme (CSS variables already exist)

When `--md-primary-fg-color` is already defined on `:root` (by the Material theme), the detector takes a minimal path:

1. Check for `--md-footer-bg-color`. If absent, derive it by darkening `--md-primary-fg-color` by 10%.
2. Check for `--md-code-font-family`. If absent, fall back to the body's computed `fontFamily`.
3. Return an empty `colors` map (no overrides needed for focus mode overlay since the `:root` vars already work).

### Branch 2 — Non-Material Theme (no CSS variables)

When `--md-primary-fg-color` is not present, colors are sampled from computed styles:

| Source Element | Computed Property | CSS Variables Set |
|---|---|---|
| `document.body.children[0]` (navbar) | `backgroundColor` | `--md-primary-fg-color`, `--md-primary-fg-color--dark` (darken 15%), `--md-footer-bg-color` (darken 10%) |
| `document.body.children[0]` (navbar) | `color` | `--md-primary-bg-color` |
| `document.body` | `backgroundColor` | `--md-default-bg-color`, `--md-default-bg-color--light`, `--md-default-bg-color--lighter` |
| `document.body` | `color` | `--md-default-fg-color`, `--md-default-fg-color--light` (alpha 0.54), `--md-default-fg-color--lighter` (alpha 0.32), `--md-default-fg-color--lightest` (alpha 0.12) |
| First `a[href]` on page | `color` | `--md-accent-fg-color`, `--md-typeset-a-color` |
| `document.body` | `fontFamily` | `--md-text-font-family`, `--md-code-font-family` |

All derived variables are set on `document.documentElement.style` so they become available globally via `var()`.

### Variant Derivation Functions

| Function | Purpose | Algorithm |
|---|---|---|
| `_darken(rgb, factor)` | Darker shade | `channel * (1 - factor)` for each R/G/B |
| `_lighten(rgb, factor)` | Lighter tint | `channel + (255 - channel) * factor` |
| `_alpha(rgb, a)` | Transparent variant | `rgba(r, g, b, a)` |
| `_isLight(rgb)` | Light/dark classification | `luminance > 0.4` (WCAG relative luminance) |
| `_luminance(r, g, b)` | WCAG relative luminance | `0.2126*R + 0.7152*G + 0.0722*B` with sRGB linearization |

Light/dark classification determines whether background variants should darken (for light themes) or lighten (for dark themes).

## Injected Style Elements

### `<style id="live-wysiwyg-theme-overrides">`

Injected in **two layers** for zero-flash theming:

1. **Server-side** (`plugin.py` `on_page_content`): The style block is emitted as the first `<style>` tag in the injected assets, before the editor CSS and before any `<script>`. This ensures the overrides are parsed by the browser before the upstream `live-edit.css` can paint the controls with hardcoded colors. For Material themes, the `var()` references resolve immediately against the theme's own CSS variables. For non-Material themes, the fallback values in each `var()` apply until JS runs.

2. **Client-side** (`_ensureThemeOverrides()` in JS): Called from `ensureToggleButton()` (earliest plugin interaction with controls) and `replaceTextareaWithWysiwyg()`. Checks `getElementById('live-wysiwyg-theme-overrides')` — since the server already injected it, the JS skips creating a duplicate. The JS still calls `_detectThemeColors()` to set `:root` CSS variables for non-Material themes, at which point the `var()` references in the already-present style block resolve to the detected colors.

Overrides the upstream `mkdocs-live-edit-plugin`'s hardcoded styles with CSS-variable-based equivalents. All declarations use `!important` to override the upstream stylesheet regardless of source order.

| Selector | Properties Overridden | CSS Variables Used |
|---|---|---|
| `.live-edit-source` | `font-family`, `color`, `background`, `border-color` | `--md-code-font-family`, `--md-default-fg-color`, `--md-default-bg-color`, `--md-default-fg-color--lightest` |
| `button.live-edit-button` | `background`, `border`, `color` | `--md-primary-bg-color` |
| `button.live-edit-button:hover` | `background` | (static rgba) |
| `button.live-edit-save-button` | `background`, `border-color`, `color` | (static green values, preserved from upstream) |
| `button.live-edit-save-button:hover` | `background` | (static green) |
| `button.live-edit-cancel-button` | `background`, `border-color`, `color` | (static red values, preserved from upstream) |
| `button.live-edit-cancel-button:hover` | `background` | (static red) |
| `div.live-edit-controls` | `background` (gradient), `border-color`, `color` | `--md-primary-fg-color`, `--md-footer-bg-color`, `--md-primary-fg-color--dark`, `--md-primary-bg-color` |
| `.live-edit-label` | `color` | `--md-primary-bg-color` |
| `.live-edit-info-modal` | `background-color`, `border-color` | `--md-default-bg-color--light`, `--md-default-fg-color--lightest` |

### `<style id="live-wysiwyg-width-overrides">`

Separate style block for width alignment (documented in `DESIGN-layout.md` / `layout.mdc`). Not part of the theming system.

## Focus Mode Theming

Focus mode CSS (`_getFocusModeCSS()`) references the same `--md-*` variable set. Because `_detectThemeColors()` now sets these on `:root`, focus mode inherits them automatically.

Additionally, `_detectThemeColors()` returns a `colors` map. For non-Material themes this map is non-empty and is applied as inline `style.setProperty()` calls directly on the `.live-wysiwyg-focus-overlay` element. This provides a second layer of specificity for the focus mode overlay, ensuring variables are available even if some edge case prevents `:root` inheritance (e.g., Shadow DOM in future).

Focus mode CSS variables used:

| Variable | Elements |
|---|---|
| `--md-default-bg-color` | `.live-wysiwyg-focus-overlay`, `.live-wysiwyg-focus-content .md-wysiwyg-editor-wrapper`, `.live-wysiwyg-focus-exit-btn` |
| `--md-default-fg-color` | `.live-wysiwyg-focus-overlay`, `.live-wysiwyg-focus-exit-btn` |
| `--md-text-font-family` | `.live-wysiwyg-focus-overlay` |
| `--md-primary-fg-color` | `.live-wysiwyg-focus-header` |
| `--md-primary-bg-color` | `.live-wysiwyg-focus-header`, `.live-wysiwyg-focus-drawer-toggle`, `.live-wysiwyg-focus-close` |
| `--md-primary-fg-color--dark` | `.live-wysiwyg-focus-save-btn:hover` |
| `--md-default-bg-color--light` | `.live-wysiwyg-focus-toolbar-drawer`, `.live-wysiwyg-focus-mode-toggle button:not(.active)` |
| `--md-default-bg-color--lighter` | `.live-wysiwyg-focus-mode-toggle button:not(.active):hover`, `.live-wysiwyg-focus-exit-btn:hover` |
| `--md-default-fg-color--light` | `.live-wysiwyg-focus-mode-toggle button:not(.active)`, `.live-wysiwyg-focus-autofocus-label` |
| `--md-default-fg-color--lighter` | `.live-wysiwyg-focus-mode-toggle`, `.live-wysiwyg-focus-exit-btn`, `.live-wysiwyg-focus-autofocus-cb`, `.live-wysiwyg-focus-toc` scrollbar |
| `--md-default-fg-color--lightest` | `.live-wysiwyg-focus-toolbar-open .live-wysiwyg-focus-toolbar-drawer`, `.live-wysiwyg-focus-toc-link` border |
| `--md-accent-fg-color` | `.live-wysiwyg-focus-mode-toggle button.active`, `.live-wysiwyg-focus-save-btn`, `.live-wysiwyg-focus-autofocus-cb:checked`, `.live-wysiwyg-focus-toc-link.active` |

## Execution Order

1. **Server-side** (`plugin.py`): `<style id="live-wysiwyg-theme-overrides">` is emitted as the first asset in `on_page_content`. For Material themes, controls are fully themed from first paint. For non-Material themes, `var()` fallbacks provide reasonable defaults.
2. User enters edit mode — upstream `live-edit-plugin` creates the controls bar. The server-injected style overrides apply immediately.
3. WYSIWYG plugin JS loads and discovers the textarea via `observeForTextarea()`.
4. **`ensureToggleButton()`** is called — this calls **`_ensureThemeOverrides()`** which:
   - Runs `_detectThemeColors()` — sets CSS variables on `:root` for non-Material themes (idempotent via `_themeColorsDetected` flag). For Material themes, fills any missing derived variables.
   - Checks `getElementById('live-wysiwyg-theme-overrides')` — finds the server-injected element, so skips creating a duplicate.
5. For non-Material themes, the `var()` references in the already-present style block now resolve to detected colors (replacing the fallback values).
6. If the user activates the editor, `replaceTextareaWithWysiwyg()` calls `_ensureThemeOverrides()` again (no-op) and injects `<style id="live-wysiwyg-width-overrides">`.
7. If the user enters focus mode later, `_detectThemeColors()` is called again — the `_themeColorsDetected` flag prevents `:root` re-writes, but the returned `colors` map is applied to the overlay element.

## Cleanup

`destroyWysiwyg()` removes the width overrides style element:
- `document.getElementById('live-wysiwyg-width-overrides')` → remove

The theme overrides (`live-wysiwyg-theme-overrides`) are **not** removed by `destroyWysiwyg()`. The controls bar remains visible after the WYSIWYG editor is disabled (showing Edit, Rename, Delete, New buttons), and those buttons must stay themed. The theme style persists for the lifetime of the page.

The CSS variables set on `document.documentElement.style` are also **not** removed. They are harmless when the editor is inactive and would be re-set on next activation anyway.

## Complete CSS Variable Inventory

Every `--md-*` CSS variable that the WYSIWYG plugin references or generates:

| Variable | Source (Material) | Source (Non-Material) | Consumers |
|---|---|---|---|
| `--md-primary-fg-color` | Theme CSS | navbar `backgroundColor` | Controls gradient, focus header |
| `--md-primary-fg-color--dark` | Theme CSS | `_darken(navBg, 0.15)` | Controls border, focus save hover |
| `--md-primary-bg-color` | Theme CSS | navbar `color` | Button text, label, focus header text |
| `--md-footer-bg-color` | Theme CSS (or derived) | `_darken(navBg, 0.1)` | Controls gradient bottom |
| `--md-default-bg-color` | Theme CSS | body `backgroundColor` | Textarea bg, focus overlay bg |
| `--md-default-bg-color--light` | Theme CSS | `_darken/_lighten(bodyBg, 0.04/0.06)` | Info modal bg, focus drawer bg |
| `--md-default-bg-color--lighter` | Theme CSS | `_darken/_lighten(bodyBg, 0.07/0.1)` | Focus toggle hover |
| `--md-default-fg-color` | Theme CSS | body `color` | Textarea text, focus overlay text |
| `--md-default-fg-color--light` | Theme CSS | `_alpha(bodyFg, 0.54)` | Focus toggle inactive text |
| `--md-default-fg-color--lighter` | Theme CSS | `_alpha(bodyFg, 0.32)` | Focus toggle border, checkbox border |
| `--md-default-fg-color--lightest` | Theme CSS | `_alpha(bodyFg, 0.12)` | Textarea border, info modal border |
| `--md-accent-fg-color` | Theme CSS | first `<a>` `color` | Focus active toggle, save button, checkbox |
| `--md-typeset-a-color` | Theme CSS | first `<a>` `color` | Link styling in editable area |
| `--md-text-font-family` | Theme CSS | body `fontFamily` | Focus overlay font |
| `--md-code-font-family` | Theme CSS (or derived) | body `fontFamily` | Textarea font |

## Relationship to Upstream `mkdocs-live-edit-plugin`

The upstream plugin (`mkdocs-live-edit-plugin`) has hardcoded colors in `live-edit.css`. An unmerged commit on the upstream exists that replaces these with CSS variables and adds its own `_detectThemeVars()` function. The WYSIWYG plugin's theme overrides make this upstream change **unnecessary** — the `<style id="live-wysiwyg-theme-overrides">` block uses `!important` to override all upstream hardcoded values, and `_detectThemeColors()` ensures the CSS variables are available regardless of theme.

If the upstream eventually merges its own theming commit, the WYSIWYG plugin's overrides will still function correctly (they reference the same variables with `!important`). To retire the WYSIWYG overrides at that point, remove the `live-wysiwyg-theme-overrides` style injection and cleanup code, and remove the `:root` variable-setting logic from `_detectThemeColors()` (keeping only the focus mode overlay application).
