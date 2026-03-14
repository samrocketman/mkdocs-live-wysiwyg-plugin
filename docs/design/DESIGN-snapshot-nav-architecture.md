# Snapshot-Driven Nav Architecture — Design Document

## Overview

The focus mode navigation menu uses a centralized snapshot-driven architecture. All user actions modify `liveWysiwygNavData` in memory, then commit a snapshot. A single renderer (`_renderNavFromSnapshot`) rebuilds the DOM from the active snapshot. Saving computes a phased execution plan by diffing the initial snapshot against the active snapshot. Warnings and dead links are per-item properties on navData, tracked as part of snapshots, and persisted to localStorage only on save. Weight normalization is also a snapshot data mutation — weights are computed and applied to navData before snapshotting, and the standard diff handles all disk writes.

All code lives in `live-wysiwyg-integration.js`.

## Core Principles

1. **Actions only modify data.** No action handler touches the DOM. Actions modify `liveWysiwygNavData`, set data flags (`_renamed`, `_new`, `_originalPath`, `_warnings`, `_deadLinks`), then call `_commitNavSnapshot()`.
2. **DOM renders from active snapshot.** `_renderNavFromSnapshot()` applies `_navSnapshots[_navSnapshotIndex]` to globals and calls `_buildNavMenu`. All visual state — including caution icons — comes from data on navData items.
3. **Save computes a phased plan from diff.** No batch queue is maintained during editing. On save, `_computeSavePlan()` diffs snapshot 0 vs the active snapshot and produces a 2-batch execution plan.
4. **Content refactoring is a decoupled diff phase.** Link rewriting, title/weight updates, headless changes are computed from the diff and applied in Batch 2d, after all structural changes.
5. **UIDs for cross-snapshot matching.** Every navData item gets a stable `_uid` via `_generateUid()`. UIDs survive renames and moves, enabling robust diffing.
6. **Warnings are snapshot-tracked.** Per-item `_warnings` and `_deadLinks` arrays live on navData items. They are deep-cloned into snapshots and naturally participate in undo/redo.

## Snapshot System

### Data Structures

```
Global variables:
  _navSnapshots = []     // flat array of snapshot objects
  _navSnapshotIndex = -1 // index of active snapshot (-1 = none)
  _uidCounter = 0        // monotonic counter for _uid generation
```

Each snapshot captures the full editor state:

```
{
  navData: [...]              // deep-cloned nav tree (with _uid, _renamed, _new,
                              //   _originalPath, _warnings, _deadLinks)
  batchQueue: [...]           // shallow-cloned operation descriptors
  badges: [...]               // badge descriptors for the actions bar
  migrationPending: bool      // migration was staged
  focusTarget: string|null    // src_path to focus after save
  pendingFolderDelete: obj|null
  topWarnings: [...]          // top-level warning message strings
  topInfo: [...]              // top-level info message strings
  mkdocsYml: string|null      // virtual mkdocs.yml content
  originalMkdocsYml: string|null // virtual original mkdocs.yml
  hasNavKey: bool              // derived from _ymlHasNavKey(_virtualMkdocsYml)
  navWeightConfig: {           // plugin configuration state
    installed: bool,
    enabled: bool,
    default_page_weight: number,
    frontmatter_defaults: object|null
  }
}
```

### Lifecycle

**On page load** (in `enterFocusMode`):
1. `_assignUids(liveWysiwygNavData)` — walk tree, assign `_uid` to every item
2. `_applyStoredWarningsToNavData()` — read localStorage, apply `_warnings` / `_deadLinks` to items
3. `_buildNavMenu(sidebarLeft)` — first render
4. `_navSnapshots = [_takeNavSnapshot()]; _navSnapshotIndex = 0` — initial snapshot

**On user action:**
1. Action handler modifies `liveWysiwygNavData` (move, rename, delete, create, etc.)
2. Action handler calls `_commitNavSnapshot()`

**`_commitNavSnapshot()`:**
1. Discard everything after `_navSnapshotIndex` (trim redo history)
2. `_takeNavSnapshot()` — deep-clone current state
3. Push to `_navSnapshots`, advance `_navSnapshotIndex`
4. Call `_renderNavFromSnapshot()`

**`_renderNavFromSnapshot()`:**
1. Apply `_navSnapshots[_navSnapshotIndex]` data to globals via `_applySnapshotToGlobals`
2. Reset `_navEditActionsEl`
3. `_buildNavMenu(_navSidebarEl)` — full DOM rebuild from navData
4. If `_navSnapshots.length >= 2`: show Save/Discard/Undo/Redo bar, update button states

**Undo/Redo:**
- `_navUndo()`: decrement `_navSnapshotIndex` (min 0), call `_renderNavFromSnapshot()`
- `_navRedo()`: increment `_navSnapshotIndex` (max length-1), call `_renderNavFromSnapshot()`
- `_updateUndoRedoBtns()`: undo disabled at index 0, redo disabled at last index

### Button Visibility

- `_navSnapshots.length < 2` → no Save/Cancel/Undo/Redo (no changes made)
- `_navSnapshots.length >= 2` → buttons appear

### Deep Cloning

`_deepCloneNavData(items)` recursively clones the nav tree:
- `children` → recursed
- `index_meta` → shallow object copy
- `_warnings` → array of `{reason, renames}` objects, each copied
- `_deadLinks` → `{internal: [...], external: [...]}`, each link object copied
- All other properties → direct assignment (primitives, strings, booleans)

### Discard / Exit

- **Discard**: Restore `_navSnapshots[0]` to navData. Reset to `[initial]; index = 0`. Re-render.
- **Exit after save**: `_persistWarningsFromSnapshot()` writes to localStorage, then `_exitNavEditMode(false)`.

## Warning System

### Data Model

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

### Batch Suppression Flag

`_suppressWarningSnapshot` (global boolean). When `true`, `_addCautionPage` and `_addDeadLinksForPage` modify navData without calling `_commitNavSnapshot()`. The caller sets this flag, performs all warning operations, unsets it, then calls `_commitNavSnapshot()` once.

Used by `_commitDeadLinkResults` to add dead links for many pages as a single snapshot.

### Direct Mode Flag

`_warningDirectMode` (global boolean). When `true`, `_addCautionPage` and `_addDeadLinksForPage` bypass navData entirely and write directly to localStorage. Used during batch save execution, when the snapshot system has been finalized and errors need to persist across page reloads.

Set to `true` in `_executeNavBatchSave` before `_runBatchOps`. Reset to `false` in `_finishBatchSave`.

### Warning Flow

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

### Persistence Lifecycle

1. **Load**: `_applyStoredWarningsToNavData()` reads `_getCautionPages()` and `_getDeadLinkPages()` from localStorage, finds matching navData items by `src_path`, and sets `_warnings` / `_deadLinks` on them. This happens before the initial snapshot is taken, so snapshot 0 includes persisted warnings.

2. **Editing**: All warning operations (`_addCautionPage`, `_addDeadLinksForPage`, dead link scan, dismiss/resolve) modify navData items only. No localStorage writes.

3. **Save**: `_persistWarningsFromSnapshot()` calls `_collectNavWarnings()` and `_collectNavDeadLinks()` to walk the navData tree, extract warnings into the localStorage format, and write via `_setCautionPages` / `_setDeadLinkPages`.

4. **Batch save errors**: `_warningDirectMode = true`. `_addCautionPage` writes directly to localStorage so errors survive the page reload that follows batch save.

5. **Discard**: Restores snapshot 0 (which contains original warnings from load). No localStorage mutation needed.

### Rendering Warnings

Caution icons are rendered inline during `_buildNavItems`, not via a separate pass:

**Page items:** If `item._warnings` has entries, a `⚠` span (`.live-wysiwyg-nav-caution`) is appended to the page link. The `<li>` gets class `live-wysiwyg-nav-caution-item`. Clicking the icon calls `_showCautionPopup(icon, navItem)`.

**Section items:** If the section's own `_warnings` or its index child's `_warnings` has entries, a caution icon is appended to the section label.

**Weight-exceeds warnings:** Rendered as direct DOM elements (not stored in `_warnings`). A `⚠` icon with `data-weight-caution="1"` appears inline when `item.weight > defaultPageWeight`. This is computed state, not user-generated — it appears/disappears based on current data without snapshot tracking.

### Caution Popup

`_showCautionPopup(anchorEl, navItem)` reads from `navItem._warnings`:

- **Resolve**: Deletes `navItem._warnings` and `navItem._deadLinks`, hides dead link panel, calls `_commitNavSnapshot()`.
- **Resolve All**: Calls `_clearAllNavWarnings()` (recursive tree walk deleting `_warnings` and `_deadLinks` from all items), hides dead link panel, calls `_commitNavSnapshot()`.

Both actions create a snapshot, so they can be undone.

### Dead Link Panel

`_showDeadLinkPanel(tocEl, navItem)` reads from `navItem._deadLinks`:

- **Resolve single link**: `_resolveOneDeadLink(pagePath, kind, target)` — finds item by path, removes the link from `_deadLinks.internal` or `_deadLinks.external`, removes corresponding warning reason if that category is now empty, calls `_commitNavSnapshot()`.
- **Resolve Page**: Deletes `_deadLinks` and dead-link warning reasons from the item, calls `_commitNavSnapshot()`.
- **Resolve All**: `_clearAllNavDeadLinks()` recursively removes `_deadLinks` and dead-link warning reasons from all items, calls `_commitNavSnapshot()`.

### Dead Link Scan

`_scanDeadLinks(mode)` scans all pages for broken links via the link-checker server. Results flow through `_processDeadLinkResults` → `_commitDeadLinkResults`:

1. Set `_suppressWarningSnapshot = true`
2. For each page with dead links: `_addDeadLinksForPage(path, internal, external)` + `_addCautionPage(path, reason)` — both modify navData without committing
3. Set `_suppressWarningSnapshot = false`
4. `_commitNavSnapshot()` — single snapshot for the entire scan

### Helper Functions

| Function | Purpose |
|----------|---------|
| `_findNavItemByPath(srcPath, items)` | Recursive search in navData tree by `src_path` |
| `_removeNavWarningReason(item, reason)` | Remove a specific reason from `item._warnings`; delete array if empty |
| `_clearAllNavWarnings(items)` | Recursively delete `_warnings` and `_deadLinks` from all items |
| `_clearAllNavDeadLinks(items)` | Recursively delete `_deadLinks` and dead-link warning reasons |
| `_collectNavWarnings(items)` | Walk tree, return `[{path, reasons, renames}]` for localStorage format |
| `_collectNavDeadLinks(items)` | Walk tree, return `[{path, internal, external}]` for localStorage format |
| `_applyStoredWarningsToNavData()` | Read localStorage, apply to navData items (on load) |
| `_persistWarningsFromSnapshot()` | Write navData warnings to localStorage (on save) |

## Data Flags on NavData Items

| Flag | Set by | Meaning |
|------|--------|---------|
| `_uid` | `_assignUids` | Stable unique identifier for cross-snapshot matching |
| `_renamed` | Rename handlers | Renderer applies `.live-wysiwyg-nav-item--renamed` |
| `_new` | Create handlers | Renderer applies `.live-wysiwyg-nav-item--new` |
| `_originalPath` | Rename/move handlers | Original `src_path` before rename; used by diff |
| `_warnings` | `_addCautionPage`, dead link scan | Array of `{reason, renames}` — caution reasons |
| `_deadLinks` | `_addDeadLinksForPage` | `{internal: [...], external: [...]}` — dead link details |
| `_deleted` | Delete handlers | Item marked for deletion; excluded from nav render and diff |

## Nav Edit Modes

Tri-state `_navEditMode`:

| Value | Context | Content | Overlay |
|-------|---------|---------|---------|
| `false` | Default display | Editable | None |
| `'light'` | Weight/title/frontmatter changes | Editable | None |
| `'heavy'` | Move/rename/delete/create | Readonly | Readonly overlay |

Truthiness check `if (_navEditMode)` works for both `'light'` and `'heavy'`.

Escalation from `'light'` to `'heavy'` prompts user to save content first.

## Diff-Based Save (2-Batch Execution)

### `_computeSavePlan(originalSnap, currentSnap)`

Flattens both snapshots via `_flattenNavTree` (UID-keyed maps), then diffs:

### Batch 1: Folder Operations (API calls)

- **Folder renames**: Same `_uid`, different `folderDir`. Deepest children renamed first, parent last. Each rename-folder op carries a `files` array (`[{uid, path}]`) listing all pages under the old folder. The `/rename-folder` API accepts this list and returns `[{uid, new_path}]`, which the client uses to populate `_batchRenamedPaths` explicitly (UID-based tracking instead of prefix guessing).
- **Folder deletes**: Section `_uid` in original but not in current. Guarded: a folder is only deleted if **none** of its descendant files have UIDs in the current snapshot (i.e., all files are also being deleted, not moved elsewhere).
- **Folder link rewriting**: After each folder rename, a `rewrite-folder-links` op rewrites all relative links that reference the old folder path.

Executed via `_apiPost('/rename-folder', ...)` and `_apiPost('/delete-folder', ...)`. The API server creates parent directories automatically (`mkdir(parents=True)`), so deep moves like `steps/ → pipeline-steps/reference/` work without prior directory creation.

### Batch 2: File Operations + Content Migration (bulk WebSocket)

**2a. Delete files** — `_uid` in original, not in current → `_wsDeleteFile`

**2b. Move/rename files** — same `_uid`, different `srcPath`. **Skipped** if the file's move is fully explained by a folder rename from Batch 1 (i.e., replacing the old folder prefix with the new one in the original path produces the current path exactly). Files that change their filename or move to a different section than their folder rename target still get individual `rename-page` ops.

**2c. Convert ops + Create new files** — `_uid` in current, not in original → `_wsNewFile` + `_wsSetContents`. Also includes passthrough ops from the batch queue (`regenerate-index`, `consolidate-hidden`, `update-mkdocs-yml`). For new pages, `_computeSavePlan` checks the snapshot's `batchQueue` for a matching `create-page` op by path to get the correct content (e.g., thin index frontmatter).

**2d. Content migration** — after structural changes:
- Set frontmatter for changed weight/title/headless/retitled/empty
- Dead link warnings for deleted files (targeted, not full scan)

### Nav Weight Normalization (Snapshot-Driven)

Weight normalization is no longer a separate batch. Instead, normalization is a pure navData mutation performed before snapshotting:

- **`_applyNormalizeWeightsToNavData(items)`** — Recursively walks the entire nav tree. For each level, assigns sequential weights (100, 200, 300...) to all children. For sections with non-thin index pages (content index), the index is renamed to a slug-based filename, a new thin `index.md` is created with `_new = true`, and the renamed page gets `_renamed = true` and `_originalPath`. All changes are direct navData mutations.

- **`_applyNormalizeFolderToNavData(sectionItem)`** — Normalizes weights for a single section's direct children only (no recursion). Assigns sequential weights to pages and section index pages.

Both functions skip `_deleted` items. The standard `_computeSavePlan` diff then generates all necessary disk operations (weight frontmatter updates, file renames, file creates) from the snapshot diff.

The user triggers normalization through:
- **"Normalize All"** menu item → calls `_applyNormalizeWeightsToNavData`, adds badge, commits snapshot
- **Per-folder "Normalize Nav Weights"** settings button → calls `_applyNormalizeFolderToNavData`, adds badge, commits snapshot
- **Post-migration auto-normalize** → `_autoNormalizeAfterMigration` applies `_applyNormalizeWeightsToNavData` then immediately saves

### After All Batches

Close bulk WebSocket → wait for mkdocs rebuild → reload page.

## Persistent Changes Pipeline

`_changesPipeline` is a localStorage-backed array of multi-stage execution plans. Each stage contains batches with operations. The pipeline survives page reloads.

```
[{
  title: "Restructuring folders and files",
  batches: [
    { title: "Renaming folders", ops: [...], type: 'api', completed: false },
    { title: "Moving files", ops: [...], type: 'ws', completed: false },
    { title: "Rebalancing weights", ops: [...], type: 'ws', completed: false }
  ],
  completed: false
}]
```

On page reload, `_resumePipeline()` (called from `enterFocusMode` via `setTimeout`) checks for incomplete stages and continues execution with a centralized progress bar.

## Migration

Migration from `mkdocs.yml` nav to `mkdocs-nav-weight` is not a special case. It is a large virtual refactoring of navData that produces one snapshot. Save uses the standard diff infrastructure — `_computeSavePlan` generates folder renames, file moves, creates, and frontmatter updates from the snapshot diff.

### Flow

1. `_startMigrationFlow()` → reads `mkdocs.yml`, parses nav structure, shows confirmation dialog
2. `_applyMigrationToNavData(navStructure, allMdSrcPaths)` → mutates `liveWysiwygNavData` to match the target structure
3. Sets `_navMigrationPending = true`, adds badge
4. `_commitNavSnapshot()` — one snapshot for the entire migration

The user sees the migrated nav and can undo, redo, or further edit before saving.

### `_applyMigrationToNavData` Internals

**UID mapping for folder renames.** Builds a directory rename map from `tree.pages`: for each page, `_getDir(oldPath)` and `_getDir(targetPath)` identify the old and new directories. If all pages from one old directory go to one new directory, that's a folder rename (stored in `folderRenameMap`). Old section items are collected by directory (`existingSectionsByDir`). When building a new section for `secDir`, if a matching old directory exists in `folderRenameMap`, the old section's `_uid` is reused and `_new` is not set. This makes `_computeSavePlan` generate `rename-folder` ops instead of delete + individual file moves.

**Claimed index handling.** When a section has an existing `index.md` in the nav (a "claimed index"), the content is split: the existing page keeps its UID but gets a new `src_path` (renamed to a slug-based filename), and a new thin `index.md` is created. The thin index goes into `_navBatchQueue` as a `create-page` op with frontmatter content (`title`, `retitled: true`, `empty: true`, `weight`). No `regenerate-index` op is used — the content move is handled by the navData diff (same UID, different `srcPath` → `rename-page`).

**Hidden page marking.** Pages not in the nav structure are appended to the tree with `headless: true`. Their UIDs are preserved from the original navData when available.

**Batch queue passthrough ops.** `update-mkdocs-yml` (to remove the `nav` key) and `consolidate-hidden` (to move headless docs closer to referencing pages) are placed in `_navBatchQueue` for passthrough via `_computeSavePlan`.

### Execution Trace (Example)

Given: `steps/` → `pipeline-steps/reference/`, with claimed index `steps/index.md` → content at `pipeline-steps/reference/best-practices.md`

1. **Batch 1**: `rename-folder steps/ → pipeline-steps/reference/` with file UID list. API creates `pipeline-steps/reference/` (parents auto-created), moves folder. Response provides new file paths. Client updates `_batchRenamedPaths`.
2. **Batch 1**: `rewrite-folder-links` rewrites all references to `steps/` → `pipeline-steps/reference/`.
3. **Batch 2 - moves**: Most files are skipped (covered by folder rename). `steps/index.md → pipeline-steps/reference/best-practices.md` still gets a `rename-page` (filename changed). Resolves via `_batchRenamedPaths` to read from `pipeline-steps/reference/index.md`.
4. **Batch 2 - creates**: `create-page pipeline-steps/reference/index.md` with thin index frontmatter.
5. **Batch 2 - content migration**: `set-frontmatter` on all pages for titles, weights, headless flags.

## Document Content Saving via Batch System

### Motivation

All saving in focus mode — both navigation changes and document content — flows through the 2-batch execution system (`_runBatchOps`). The progress bar, reload guard, WebSocket management, and rebuild waiting are exclusively owned by the batch runner. The upstream `mkdocs-live-edit-plugin` save button is no longer used in focus mode.

### `save-content` Op Type

Document content saving uses a dedicated batch operation:

```
{ type: 'save-content', src_path: 'path/to/page.md', content: '...', title: 'Page Title' }
```

`_dispatchSingleOp` routes this to `_executeSaveContentOp(op)`, which calls `_wsSetContents(op.src_path, op.content)`. The op label shown in the progress bar is `Saving 'Page Title'`.

### `_runBatchOps` Options

`_runBatchOps(contentEl, orderedOps, focusTarget, options)` accepts an optional fourth argument:

| Option | Type | Purpose |
|--------|------|---------|
| `title` | string | Override the initial progress status message (default: `'Saving nav changes...'`) |
| `skipLinkIndex` | boolean | Skip `_fetchLinkIndex()` — unnecessary for pure content saves |
| `onComplete` | function(failures) | If provided, `_finishBatchSave` calls this instead of navigating/reloading. The status element is removed from the container before calling. |

When `onComplete` is absent, `_finishBatchSave` follows the default behavior: nav-specific cleanup, success/error status display, and page navigation/reload.

### Focus Mode Document Save Flow

`_doFocusSave()` builds a single `save-content` op and runs it through `_runBatchOps` with `onComplete`:

1. Finalize editor state → sync to textarea
2. Build `save-content` op with page path, content, and title derived from `document.title`
3. Call `_runBatchOps` with `{ title: "Saving '...'...", skipLinkIndex: true, onComplete: fn }`
4. `onComplete` resets pristine content via `_resetPristineContent`, syncs build epoch, and resolves the returned Promise

The function returns a Promise, preserving the chaining API used by callers (`_doFocusModeSave`, `_navigateToPage`, `_ensureNavEditReady`, `_onExternalRebuild`).

### Combined Nav + Document Save

When `_executeNavBatchSave` detects dirty document content (via `wysiwygEditor._isDocDirty()`), it prepends a `save-content` op to the ordered operations array. The document is saved as the first operation, followed by all navigation changes. Since the batch completes with a page reload, no pristine reset is needed.

### Dirty Detection API

`wysiwygEditor._isDocDirty()` compares the textarea value against `_pristineContent`. This replaces the previous pattern of checking the upstream save button's `live-edit-hidden` class to determine dirty state. All callers (`_navigateToPage`, `_ensureNavEditReady`, `_onExternalRebuild`, nav popup Apply button) use this method.

### Upstream Save Button Suppression

In focus mode, the upstream save/cancel button visibility toggling in `onUpdate` is gated behind `!isFocusModeActive`. The buttons remain permanently hidden in focus mode — only the focus mode Save button (`live-wysiwyg-focus-save-btn`) triggers saves. Outside focus mode, the upstream buttons continue to function normally.

### Progress Bar Ownership

The progress bar infrastructure (`_showNavStatus`, `_updateNavProgress`) is exclusively called from `_runBatchOps` and `_finishBatchSave`. No other code references or controls these functions. The pipeline progress bar (`_showPipelineProgress`, `_hidePipelineProgress`) is exclusively called from `_executePipelineStage`. This ensures all progress visualization is owned by the batch execution system.

## Post-Save Notification Queue

### Purpose

The batch system supports an optional post-save notification queue. Messages are persisted across page reloads in `localStorage` and displayed when focus mode initializes. This provides user feedback for operations that span reloads (batch saves, migrations) without blocking the UI.

### Message Types

| Type | Icon | Behavior |
|------|------|----------|
| `success` | Green checkmark | Auto-dismissed after 5 seconds |
| `warning` | Yellow warning | Auto-dismissed after 5 seconds |
| `info` | Blue info circle | Auto-dismissed after 5 seconds |
| `error` | Red cross | Persistent — requires manual dismiss |

When error messages are present, the entire notification panel stays visible until the user clicks "Dismiss." Non-error messages appear first in the list; error messages are sorted to the end.

### API

| Function | Purpose |
|----------|---------|
| `_queuePostSaveMessage(type, text)` | Append a message to the localStorage-backed queue |
| `_showPostSaveMessages()` | Read, display, and clear all queued messages |
| `_displayNotifications(messages)` | Render a notification panel from a message array |

### Queue Storage

Key: `live_wysiwyg_post_save_messages` in `localStorage`. Value: JSON array of `{type, text}` objects. Cleared after display.

### Integration Points

**`_finishBatchSave`** (default navigation path, not `onComplete`):
- On success: queues a `success` message. Callers can set `options.successMessage` to override the default `'All changes saved.'` text.
- On errors: queues each failure as an `error` message (in addition to existing caution-page tracking).

**Migration result** (`_showMigrationResultIfPending`):
- Reads the `live_wysiwyg_migration_result` cookie and converts it to a queued `success` or `warning` message. No longer uses `_showNavDialog`.

**Focus mode entry** (`enterFocusMode`):
- After the migration chain completes (or immediately if no migration is in progress), calls `_showMigrationResultIfPending()` followed by `_showPostSaveMessages()`.
- During intermediate migration steps (normalize, adjust weight), notifications are deferred until the chain completes. Messages accumulate in the queue and are displayed together at the end.

### Rendering

`_displayNotifications` creates a fixed-position panel at `top: 12px; right: 12px; z-index: 100002` with:
- A header (shown when there are multiple messages or errors) summarizing the result
- A scrollable message list with type-specific icons
- A "Dismiss" button in the footer
- Fade-in on appearance; fade-out on dismiss or auto-dismiss
