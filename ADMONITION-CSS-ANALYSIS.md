# Admonition CSS Analysis: Material vs Editor Injected Styles

## 1. Page Structure (http://localhost:8765/)

The index page contains three admonitions in the "Admonition Support" section:

```html
<div class="admonition note">
  <p class="admonition-title">Note</p>
  <p>This is a note admonition. ...</p>
</div>

<div class="admonition warning">
  <p class="admonition-title">Custom Title</p>
  <p>Admonitions with custom titles work too.</p>
</div>

<div class="admonition danger">
  <p class="admonition-title">Danger</p>
  <p>This is a note common in mkdocs.</p>
</div>
```

These live inside `<article class="md-typeset">` in the read-only view.

---

## 2. Material Theme `.md-typeset .admonition` Styling

From `assets/stylesheets/main.8608ea7d.min.css` (MkDocs Material 9.6.5):

### Base admonition
```css
.md-typeset .admonition,
.md-typeset details {
  background-color: var(--md-admonition-bg-color);
  border: .075rem solid #448aff;
  border-radius: .2rem;
  box-shadow: var(--md-shadow-z1);
  color: var(--md-admonition-fg-color);
  display: flow-root;
  font-size: .64rem;
  margin: 1.5625em 0;
  padding: 0 .6rem;
  page-break-inside: avoid;
  transition: box-shadow 125ms;
}
.md-typeset .admonition,
.md-typeset details {
  box-shadow: none;
}
```

### Admonition title
```css
.md-typeset .admonition-title,
.md-typeset summary {
  background-color: #448aff1a;
  border: none;
  font-weight: 700;
  margin: 0 -.6rem;
  padding-bottom: .4rem;
  padding-top: .4rem;
  padding-left: 2rem;   /* [dir=ltr] */
  padding-right: .6rem;
  position: relative;
  border-left-width: .2rem;
  border-top-left-radius: .1rem;
  border-top-right-radius: .1rem;
}
```

**Summary of Material styles:**
- **Border:** `.075rem solid #448aff` (base), `.2rem` on title
- **Background:** `var(--md-admonition-bg-color)` (body), `#448aff1a` (title)
- **Padding:** `0 .6rem` (body), `0.4rem .6rem` + `2rem` left (title)
- **Margin:** `1.5625em 0`
- **Font-size:** `.64rem`
- **Border-radius:** `.2rem` (body), `.1rem` (title corners)
- **Box-shadow:** `none` (overridden from `var(--md-shadow-z1)`)

---

## 3. Editor Injected CSS

The plugin injects two `<style>` blocks (in `plugin.py`):

1. **editor.css** (first)
2. **admonition.css** (second)

Both are injected into the page when the WYSIWYG editor is active. The editable area gets `class="md-editable-area"` and, when Material theme is detected, also `class="md-typeset"` (see `editor.js` lines 842–845).

---

## 4. Rules That Match When Editable Area Has `class="md-editable-area md-typeset"`

### 4.1 From admonition.css — `.md-editable-area .admonition` (no `:not(.md-typeset)`)

| Selector | Properties | Overrides Material? |
|----------|------------|---------------------|
| `.md-editable-area .admonition`<br>`.md-editable-area details[class]` | `position: relative` | No — Material does not set `position` on admonitions. This adds layout for the settings gear. |
| `.md-editable-area details[class] > summary` | `cursor: text`<br>`list-style: none` | Partially — Material styles summary; these add/edit UX. |
| `.md-editable-area details[class] > summary::-webkit-details-marker` | `display: none` | Yes — hides native marker. |
| `.md-editable-area details[class] > summary::marker` | `display: none`<br>`content: ''` | Yes — hides native marker. |
| `.md-editable-area .admonition.inline`<br>`.md-editable-area details[class].inline` | `float: left`<br>`width: 40%`<br>`margin-right: 1em`<br>`margin-top: 0` | Yes — for inline placement only. |
| `.md-editable-area .admonition.inline.end`<br>`.md-editable-area details[class].inline.end` | `float: right`<br>`margin-right: 0`<br>`margin-left: 1em` | Yes — for inline-end placement only. |

### 4.2 From editor.css — `.md-editable-area` (no `:not(.md-typeset)`)

| Selector | Properties | Overrides Material? |
|----------|------------|---------------------|
| `.md-editable-area blockquote pre`<br>`.md-editable-area blockquote .md-code-block`<br>`.md-editable-area blockquote .admonition` | `font-style: normal`<br>`color: inherit` | Yes — overrides blockquote's italic for admonitions inside blockquotes. Intentional. |
| `.md-editable-area .admonition .md-admonition-settings-btn`<br>`.md-editable-area details[class] .md-admonition-settings-btn` | `position: absolute`<br>`top: 6px`<br>`right: 6px`<br>`background`<br>`border`<br>`border-radius`<br>`font-size`<br>`padding`<br>`opacity`<br>`z-index`<br>etc. | No — targets the settings gear button, not the admonition itself. |
| `.md-editable-area .admonition:hover > .md-admonition-settings-btn`<br>etc. | `opacity: 1` | No — settings button visibility. |

---

## 5. Rules That Do NOT Match When `md-typeset` Is Present

All fallback styles in admonition.css use `.md-editable-area:not(.md-typeset)`:

- Base admonition: `margin`, `padding`, `border-radius`, `border-left`, `background-color`, `color`
- `.admonition-title`: `font-weight`, `margin`, `padding`, `::before` transform
- Per-type colors (`.note`, `.warning`, `.danger`, etc.): `border-left-color`, `background-color`
- All `<details>` fallback styles

These do **not** apply when the editable area has `md-typeset`, so Material's admonition styling is preserved.

---

## 6. Direct Answer to Your Questions

### Q: What CSS rules from the editor's injected styles would still match and override Material's `.md-typeset .admonition` styling when the editable area has `class="md-editable-area md-typeset"`?

**Rules that match and apply:**

1. **admonition.css**
   - `position: relative` on `.md-editable-area .admonition` and `.md-editable-area details[class]` — additive, does not override Material's visual styles.
   - `cursor: text`, `list-style: none`, `display: none` on `details > summary` and its markers — for editing UX; do not change Material's main admonition appearance.
   - Inline placement rules (`.inline`, `.inline.end`) — only for inline admonitions; override margin/float for that layout.

2. **editor.css**
   - `.md-editable-area blockquote .admonition` — `font-style: normal`, `color: inherit` — only for admonitions inside blockquotes; overrides blockquote italic.

**None of these override Material's core admonition styling** (border, background, padding, margin, font-size, border-radius, box-shadow, or `.admonition-title` appearance) when the editable area has both classes.

### Q: Are there any `.md-editable-area .admonition` rules (without `:not(.md-typeset)`) that would override Material's rules?

**Yes, but only in limited cases:**

1. **Inline admonitions** — `.md-editable-area .admonition.inline` and `.inline.end` set `float`, `width`, and `margin`, which override Material's default block layout for those variants.
2. **Admonitions inside blockquotes** — `.md-editable-area blockquote .admonition` overrides inherited `font-style` and `color` from the blockquote.
3. **Collapsible details** — `.md-editable-area details[class] > summary` and its marker rules override native summary/marker styling for editing.

**No** — there are no `.md-editable-area .admonition` rules (without `:not(.md-typeset)`) that override Material's main admonition box styling (border, background, padding, margin, font-size, border-radius, box-shadow) or the `.admonition-title` bar styling.

---

## 7. Screenshots

Browser MCP tools were not available in this session. To verify:

1. Open http://localhost:8765/ in a browser.
2. Scroll to the "Admonition Support" section to see note, warning, and danger admonitions.
3. Click **Edit** to enter WYSIWYG mode — the editable area will have `class="md-editable-area md-typeset"`, and admonitions should look the same as in read-only mode, with the addition of the settings gear on hover.
