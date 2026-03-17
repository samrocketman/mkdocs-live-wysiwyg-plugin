# Cautions — Design Document

## Overview

Per-page warning system with scoped reason ownership. Each feature owns its reason strings. Resolution must only remove the caller's own reasons.

## Data Model

**Per-item on navData:**
```
item._warnings = [
  { reason: 'Internal dead links found', renames: 0 },
  { reason: 'Batch operation failed: ...', renames: 0 }
]

item._deadLinks = {
  internal: [{ text: 'Link text', target: 'relative/path.md' }],
  external: [{ text: 'Link text', target: 'https://...', status: 404, error: '' }]
}
```

**Top-level on snapshot:**
```
topWarnings: ['warning message', ...]
topInfo: ['info message', ...]
```

## Warning Flow

```
                    ┌─────────────────────────────────┐
                    │         localStorage             │
                    │  live_wysiwyg_caution_pages      │
                    │  live_wysiwyg_dead_links         │
                    └──────┬──────────────▲────────────┘
                           │              │
              on load      │              │  on save
      _applyStoredWarnings │              │  _persistWarningsFromSnapshot
              ToNavData()  │              │
                           ▼              │
                    ┌─────────────────────┴────────────┐
                    │     navData items                 │
                    │  item._warnings = [...]           │
                    │  item._deadLinks = {...}          │
                    │  item._fm = {...}                 │
                    │  item._indexContent = '...'       │
                    └──────┬──────────────▲────────────┘
                           │              │
           _takeNavSnapshot│              │ _applySnapshotToGlobals
                           ▼              │
                    ┌─────────────────────┴────────────┐
                    │     _navSnapshots[]               │
                    │     (deep-cloned navData)         │
                    └──────┬──────────────▲────────────┘
                           │              │
          _renderNavFrom   │              │  undo / redo
          Snapshot()       │              │  index ± 1
                           ▼              │
                    ┌─────────────────────┴────────────┐
                    │         DOM                       │
                    │  caution icons from _warnings     │
                    │  dead link panel from _deadLinks  │
                    └─────────────────────────────────────┘
```

## Persistence Lifecycle

1. **Load**: `_applyStoredWarningsToNavData()` reads `_getCautionPages()` and `_getDeadLinkPages()` from localStorage, finds matching navData items by `src_path`, and sets `_warnings` / `_deadLinks` on them. This happens before the initial snapshot is taken, so snapshot 0 includes persisted warnings.

2. **Editing**: All warning operations (`_addCautionPage`, `_addDeadLinksForPage`, dead link scan, dismiss/resolve) modify navData items only. No localStorage writes.

3. **Save**: `_persistWarningsFromSnapshot()` calls `_collectNavWarnings()` and `_collectNavDeadLinks()` to walk the navData tree, extract warnings into the localStorage format, and write via `_setCautionPages` / `_setDeadLinkPages`.

4. **Batch save errors**: `_warningDirectMode = true`. `_addCautionPage` writes directly to localStorage so errors survive the page reload that follows batch save.

5. **Discard**: Restores snapshot 0 (which contains original warnings from load). No localStorage mutation needed.

## Batch Suppression

`_suppressWarningSnapshot` (global boolean). When `true`, `_addCautionPage` and `_addDeadLinksForPage` modify navData without calling `_commitNavSnapshot()`. The caller sets this flag, performs all warning operations, unsets it, then calls `_commitNavSnapshot()` once.

Used by `_commitDeadLinkResults` to add dead links for many pages as a single snapshot.

## Direct Mode

`_warningDirectMode` (global boolean). When `true`, `_addCautionPage` and `_addDeadLinksForPage` bypass navData entirely and write directly to localStorage. Used during batch save execution, when the snapshot system has been finalized and errors need to persist across page reloads.

Set to `true` in `_executeNavBatchSave` before `_runBatchOps`. Reset to `false` in `_finishBatchSave`.

## Rendering

Caution icons are rendered inline during `_buildNavItems`, not via a separate pass:

**Page items:** If `item._warnings` has entries, a warning span (`.live-wysiwyg-nav-caution`) is appended to the page link. The `<li>` gets class `live-wysiwyg-nav-caution-item`. Clicking the icon calls `_showCautionPopup(icon, navItem)`.

**Section items:** If the section's own `_warnings` or its index child's `_warnings` has entries, a caution icon is appended to the section label.

**Weight-exceeds warnings:** Rendered as direct DOM elements (not stored in `_warnings`). A warning icon with `data-weight-caution="1"` appears inline when `item.weight > defaultPageWeight` and `item.isIndex` is false (section indexes are excluded from this warning). This is computed state, not user-generated — it appears/disappears based on current data without snapshot tracking.

## Caution Popup

`_showCautionPopup(anchorEl, navItem)` reads from `navItem._warnings`:

- **Resolve**: Deletes `navItem._warnings` and `navItem._deadLinks`, hides dead link panel, calls `_commitNavSnapshot()`.
- **Resolve All**: Calls `_clearAllNavWarnings()` (recursive tree walk deleting `_warnings` and `_deadLinks` from all items), hides dead link panel, calls `_commitNavSnapshot()`.

Both actions create a snapshot, so they can be undone.

## Dead Link Panel

`_showDeadLinkPanel(tocEl, navItem)` reads from `navItem._deadLinks`:

- **Resolve single link**: `_resolveOneDeadLink(pagePath, kind, target)` — finds item by path, removes the link from `_deadLinks.internal` or `_deadLinks.external`, removes corresponding warning reason if that category is now empty, calls `_commitNavSnapshot()`.
- **Resolve Page**: Deletes `_deadLinks` and dead-link warning reasons from the item, calls `_commitNavSnapshot()`.
- **Resolve All**: `_clearAllNavDeadLinks()` recursively removes `_deadLinks` and dead-link warning reasons from all items, calls `_commitNavSnapshot()`.

## Reason String Ownership

| Subsystem | Reason Strings |
|-----------|----------------|
| Content Scanning (Dead Link Finder) | `"Internal dead links found"`, `"External dead links found"` |
| Nav Migration | `"Link integrity may need attention"` |
| Unreferenced Asset Finder | `"Unreferenced asset"` |

## Helper Functions

| Function | Purpose |
|----------|---------|
| `_removeNavWarningReason(item, reason)` | Remove a specific reason from `item._warnings`; delete array if empty |
| `_clearAllNavWarnings(items)` | Recursively delete `_warnings` and `_deadLinks` from all items |
| `_clearAllNavDeadLinks(items)` | Recursively delete `_deadLinks` and dead-link warning reasons |
| `_collectNavWarnings(items)` | Walk tree, return `[{path, reasons, renames}]` for localStorage format |
| `_collectNavDeadLinks(items)` | Walk tree, return `[{path, internal, external}]` for localStorage format |
| `_applyStoredWarningsToNavData()` | Read localStorage, apply to navData items (on load) |
| `_persistWarningsFromSnapshot()` | Write navData warnings to localStorage (on save) |

## Rules

1. **Scoped resolution.** When resolving cautions, only remove reason strings owned by the calling feature. Never clear the entire caution entry or wipe all cautions indiscriminately.

2. **Preserve the entry if other reasons remain.** After removing your reasons, check if `reasons.length` is still > 0. Only delete the caution entry and remove the nav icon when the array is empty.

3. **Never call `_setCautionPages([])` from feature-specific resolve.** Clearing all cautions is only acceptable for an explicit "Resolve All Cautions" action in the caution popup itself.

4. **Nav icon removal requires empty reasons.** Only remove `.live-wysiwyg-nav-caution` icon and `.live-wysiwyg-nav-caution-item` class when the page's caution entry is fully deleted (no reasons left from any feature).

5. **Each feature owns its reason strings.** Document which reason strings a feature uses so other features do not accidentally match them.

6. **Batch suppression.** During batch operations that add many warnings, set `_suppressWarningSnapshot = true` before the loop, then call `_commitNavSnapshot()` once after all additions.

7. **Direct mode for batch save errors.** When `_warningDirectMode` is true, write directly to localStorage so errors survive the page reload that follows batch save.
