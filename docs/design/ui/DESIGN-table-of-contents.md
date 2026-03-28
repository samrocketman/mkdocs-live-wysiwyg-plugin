# Table of Contents — Design Document

## Overview

The focus mode right sidebar contains a dynamic table of contents that mirrors the Material theme's secondary sidebar. It uses Material theme CSS classes, updates live as content changes, tracks the active heading on scroll, and supports click-to-scroll navigation.

## Layout

- **Container**: `.live-wysiwyg-focus-toc` — right sidebar panel
- **Width**: 12.1rem (matches `md-sidebar--secondary`)
- **Positioning**: `position: sticky; top: 0` so it stays visible as the user scrolls the main area
- **Structure**: `nav.md-nav.md-nav--secondary` with `label.md-nav__title` ("Table of contents") and `ul.md-nav__list` containing `li.md-nav__item > a.md-nav__link > span.md-ellipsis`

## Material Theme CSS Classes

The TOC uses Material theme classes for consistent styling:

- `md-nav`, `md-nav--secondary`
- `md-nav__title`, `md-nav__list`, `md-nav__item`, `md-nav__link`
- `md-ellipsis` for text truncation
- `md-nav__link--active` for the current heading (exactly one at a time)

## Building (`buildFocusToc`)

- **WYSIWYG mode**: Queries `editableArea.querySelectorAll('h1, h2, h3, h4, h5, h6')`
- **Markdown mode**: Parses `#` heading lines from the markdown content
- Strips `¶` (headerlink pilcrow) from heading text
- Generates Material-themed `<li>/<a>` structure with depth-based left-padding
- Each link carries `data-focus-toc-idx` for click targeting

## Live Updates

- `MutationObserver` on `editableArea` watches `childList`, `characterData`, `subtree`
- Debounced at 300ms to avoid excessive rebuilds during typing
- Preserves TOC scroll position across rebuilds
- Rebuilt on mode toggle (WYSIWYG ↔ Markdown) since the content source changes

## Active Heading Tracking

- Scroll listener on `.live-wysiwyg-focus-main` (the main scrolling container)
- Determines the topmost heading at or above the viewport top (within 20px threshold)
- Applies `md-nav__link--active` to exactly one TOC link
- Auto-scrolls the TOC panel to keep the active link visible

## Click-to-Scroll

- `e.preventDefault()` on TOC link clicks
- `heading.scrollIntoView({ behavior: 'smooth', block: 'start' })` for browser-native smooth scrolling
- Places cursor at the heading for immediate editing

When the user clicks a TOC heading and edits its text, the Heading Migration subsystem detects the rename when the cursor leaves the heading and stages cross-document anchor link rewrites. See [DESIGN-heading-migration.md](DESIGN-heading-migration.md) for the full migration flow.

See [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md) for cross-browser considerations around `scrollIntoView` and smooth scrolling.

## Collapsible Toggle

- Toggle: TOC toggle button (hamburger rotated 90°) in header-left
- State class: `live-wysiwyg-focus-toc-collapsed` on the overlay
- **WYSIWYG mode**: `transform: translateX(100%)`, `opacity: 0`, `pointer-events: none` — sidebar slides out to the right but retains layout width
- **Markdown mode**: Additionally `width: 0`, `margin-right: 0`, `padding: 0` — sidebar collapses so the markdown textarea expands into the freed space
- Transition: `0.3s ease-in-out` for transform, opacity, width, and margin
- State persisted via `live_wysiwyg_focus_toc` setting
- The TOC is always available; when collapsed it can be toggled back. It is never permanently hidden.

## Nav Edit Mode

During nav edit mode, the TOC remains visible but is non-interactive. The read-only overlay covers the content area and TOC panel. TOC links are non-clickable while the focus is on nav editing.

## Dead Link Panel

The dead link panel auto-expands a collapsed TOC before positioning (`_ensureTocUncollapsed`) so the panel can be placed correctly.

## Copy Heading Link

Each TOC entry has a small copy button (link icon) positioned to the left, following the same visibility pattern as nav sidebar settings gears.

### Visibility

- Hidden by default (`opacity: 0; pointer-events: none`)
- Appears on hover of the individual `md-nav__link` element (`opacity: 0.5`)
- Full opacity on direct hover of the button itself
- Positioned absolutely in the left gutter via `left: calc(.6rem - 13px)`, vertically centered

### Copy Behavior

Click copies `srcPath#slug` to the clipboard, where:

- `srcPath` is the current document's source path (from `_getCurrentSrcPath()`)
- `slug` is the heading's anchor slug (from `_headingSlugify(text)`, stored in `data-toc-slug`)

The last copied link is stored in `_lastCopiedHeadingLink` for the smart paste handler.

### Smart Paste

When the user pastes a copied heading link into selected text (in either WYSIWYG or Markdown mode), the paste handler intercepts and auto-converts the raw `srcPath#slug` into a properly formatted link:

- **Same page** (target `srcPath` matches current page): link is `#slug` (anchor-only)
- **Different page**: link is a relative path computed via `_computeRelativePath` with the `#slug` appended

In WYSIWYG mode, the selection is wrapped in an `<a>` element. In Markdown mode, the selection is replaced with `[selectedText](relativePath#slug)`.

## Invariants

1. Only one `md-nav__link--active` exists at a time
2. Scroll listener uses `.live-wysiwyg-focus-main` as the scroll container
3. TOC is rebuilt when switching between WYSIWYG and Markdown mode
4. TOC is non-interactive during nav edit mode

## Spacing Contract

TOC link spacing matches the nav sidebar for visual balance:

- `.md-nav__link`: `margin-top: .625em; padding: 0 .6rem`
- `.md-nav__list`: `padding: 0 .6rem .4rem`
- `.live-wysiwyg-focus-toc`: `line-height: 1.3; font-size: .7rem`

These values mirror the nav sidebar's `.md-nav__link` spacing. See [DESIGN-layout.md](DESIGN-layout.md) "Sidebar Spacing Contract" for the authoritative table.

## Width Extension

The TOC extends rightward beyond the grid's `max-width: 61rem` to use available screen real estate:

- `--_toc-extend: clamp(0px, (100vw - 61rem) / 2 - 2em, 10rem)` (defined on `.live-wysiwyg-focus-grid`)
- TOC width: `calc(12.1rem + var(--_toc-extend, 0px))`
- Negative right margin: `calc(-1 * var(--_toc-extend, 0px))`

The left edge of the TOC remains fixed next to the content area. Only the right edge extends outward. This mirrors the nav sidebar's `--_nav-extend` pattern. See [DESIGN-layout.md](DESIGN-layout.md) "TOC Width Extension".

## Layout Subsystem

TOC sticky positioning, sidebar width (`12.1rem`), scroll container contract (`.live-wysiwyg-focus-main`), and the `< 60em` responsive breakpoint are governed by the Layout subsystem. See [DESIGN-layout.md](DESIGN-layout.md) for the authoritative contracts.
