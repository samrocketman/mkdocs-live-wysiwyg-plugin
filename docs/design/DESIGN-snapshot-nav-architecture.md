# Snapshot-Driven Nav Architecture — Design Document

## Overview

The focus mode navigation menu uses a centralized snapshot-driven architecture. All user actions modify `liveWysiwygNavData` in memory, then commit a snapshot. A single renderer (`_renderNavFromSnapshot`) rebuilds the DOM from the active snapshot. Saving computes a phased execution plan by diffing the initial snapshot against the active snapshot. Warnings and dead links are per-item properties on navData, tracked as part of snapshots, and persisted to localStorage only on save. Weight normalization is also a snapshot data mutation — weights are computed and applied to navData before snapshotting, and the standard diff handles all disk writes.

All code lives in `live-wysiwyg-integration.js`.

## Core Principles

1. **Actions only modify data.** No action handler touches the DOM. Actions modify `liveWysiwygNavData`, set data flags (`_renamed`, `_new`, `_originalPath`, `_warnings`, `_deadLinks`), then call `_commitNavSnapshot()`.
2. **DOM renders from active snapshot.** `_renderNavFromSnapshot()` applies `_navSnapshots[_navSnapshotIndex]` to globals and calls `_buildNavMenu`. All visual state — including caution icons — comes from data on navData items.
3. **Save is a two-step process: desired state then disk planning.** No batch queue is maintained during editing. On save, `_computeSavePlan()` diffs snapshot 0 vs the active snapshot and produces a declarative desired state (where every page should end up, with what frontmatter). Then `_planDiskOperations()` converts that desired state into an optimized 2-batch execution plan, detecting folder renames to minimize disk writes.
4. **Content refactoring is a decoupled diff phase.** Link rewriting, title/weight updates, headless changes are computed from the diff and applied in Batch 2d, after all structural changes.
5. **UIDs for cross-snapshot matching.** Every navData item gets a stable `_uid` via `_generateUid()`. UIDs survive renames and moves, enabling robust diffing.
6. **Warnings are snapshot-tracked.** Per-item `_warnings` and `_deadLinks` arrays live on navData items. They are deep-cloned into snapshots and naturally participate in undo/redo.
7. **Single snapshot diff, declarative desired state.** The migration, normalization, and all user edits are expressed as mutations to `liveWysiwygNavData`. A single diff between snapshot 0 (original state) and the active snapshot (current state) produces a declarative desired state — not operations. The desired state describes where every page and section should end up, with what frontmatter and content. A separate disk planning phase then converts this into the minimum set of operations (folder renames, file moves, creates, deletes, frontmatter writes) needed to achieve that state.

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
  navData: [...]              // deep-cloned nav tree (with _uid, _fm, _renamed, _new,
                              //   _originalPath, _warnings, _deadLinks, _indexContent,
                              //   setContent)
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

**`_takeNavSnapshot()`:**
1. `_syncFmFields(navData)` — synchronize item-level fields into `_fm` objects
2. `_deepCloneNavData(navData)` — deep-clone the nav tree
3. Shallow-clone `_navBatchQueue`, copy all other global state

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
- `_fm` → shallow object copy (all values are primitives)
- `_warnings` → array of `{reason, renames}` objects, each copied
- `_deadLinks` → `{internal: [...], external: [...]}`, each link object copied
- All other properties → direct assignment (primitives, strings, booleans)

This includes `_indexContent` (string, copied by value) and `setContent` (string, copied by value).

### Discard / Exit

- **Discard**: Restore `_navSnapshots[0]` to navData. Reset to `[initial]; index = 0`. Re-render.
- **Exit after save**: `_persistWarningsFromSnapshot()` writes to localStorage, then `_exitNavEditMode(false)`.

## Virtualized Frontmatter (`_fm`)

### Purpose

Each page item in `navData` carries an `_fm` object representing its complete YAML frontmatter state. The `_fm` is the source of truth for what frontmatter will be written to disk on save. All frontmatter changes — weight updates, title changes, headless toggling, migration — are expressed as mutations to `_fm`.

### Population

`_fm` is populated from `liveWysiwygFrontmatterMap` (a global injected by `plugin.py` containing full parsed frontmatter for every page). When items are created or modified:
- `_precomputeHiddenPages` sets `_fm` from `liveWysiwygFrontmatterMap` on hidden items
- `_applyMigrationToNavData` sets `_fm` on migrated items from `liveWysiwygFrontmatterMap` or from existing items
- Action handlers that modify weight, title, headless, etc. update the corresponding `_fm` fields

### Synchronization (`_syncFmFields`)

Called by `_takeNavSnapshot()` before cloning. Walks the entire nav tree and ensures `_fm` reflects the current item-level fields:

- `item.weight` → `_fm.weight` (deleted if null)
- `item.headless` → `_fm.headless` (deleted if not true)
- `item.retitled` → `_fm.retitled` (deleted if not true)
- `item.empty` → `_fm.empty` (deleted if not true)
- `item.title` → `_fm.title` (only if `_fm` already has `title` or item is `_new`)

This ensures the snapshot always contains a consistent `_fm` even when action handlers modify item-level fields directly without touching `_fm`.

### Key Ordering in `_buildFrontmatterFromFm`

When writing `_fm` to disk, key ordering is preserved from the original file:

1. Keys that existed in `origFm` (passed from the snapshot diff) are written in their original order
2. New keys not in `origFm` follow a positional rule: `title` is inserted first, `weight` is appended last
3. Keys whose values match `mkdocs-nav-weight` defaults are stripped (e.g., `weight: 0` when default is 0, `headless: false`)

### `newFrontmatter` Flag

When the snapshot diff detects that `origFm` has no `mkdocs-nav-weight` keys (`weight`, `headless`, `retitled`, `empty` are all `undefined`), the `set-frontmatter` op is flagged with `newFrontmatter: true`. The executor then reads the actual file content to discover any pre-existing non-nav-weight frontmatter keys (and their order), using `_parseFrontmatter(content).fields` as the effective `origFm`. This ensures existing frontmatter is preserved when nav-weight fields are added for the first time.

## Pre-Computation Content Scan (`_preComputationContentScan`)

### Purpose

Before migration or normalization, index pages that have body content (not just frontmatter) need to be identified so their content can be split into a separate page. The scan reads the full raw content of qualifying index files and stores it on the navData item as `_indexContent`.

### Mechanism

1. Walks `liveWysiwygNavData` looking for section children with `type: 'page'`, `isIndex: true`, and NOT already `retitled && empty` (thin indexes are skipped)
2. For each qualifying index, calls `_wsGetContents(item.src_path)` to read the full file content
3. Stores the raw content (frontmatter + body) as `item._indexContent`
4. Returns a Promise that resolves when all reads complete

### Snapshot Persistence

`_indexContent` is a string, so `_deepCloneNavData` copies it by value. It persists in snapshots and is used by `_applyMigrationToNavData` to extract body content when splitting indexes. The extracted body is stored as `setContent` on the content page item, which the `set-frontmatter` executor uses instead of reading from disk.

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

**Weight-exceeds warnings:** Rendered as direct DOM elements (not stored in `_warnings`). A `⚠` icon with `data-weight-caution="1"` appears inline when `item.weight > defaultPageWeight` and `item.isIndex` is false (section indexes are excluded from this warning). This is computed state, not user-generated — it appears/disappears based on current data without snapshot tracking.

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
| `_fm` | `_syncFmFields`, action handlers, migration | Complete frontmatter key-value map; source of truth for disk writes |
| `_indexContent` | `_preComputationContentScan`, `_scanClaimedIndexContent` | Full raw file content (frontmatter + body) for index pages; used to extract body for `setContent` |
| `setContent` | Migration `buildTree` | Body content (frontmatter stripped) for content pages split from indexes; carried in snapshot; executor writes this instead of reading from disk |
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

## Diff-Based Save (2-Phase Planning + 2-Batch Execution)

The save process separates **what** the end state should look like from **how** to achieve it:

1. **`_computeSavePlan`** — produces a declarative desired state (where every page and section should end up, with what frontmatter and content)
2. **`_planDiskOperations`** — converts the desired state into an optimized 2-batch execution plan, detecting folder renames to minimize disk writes

### `_flattenNavTree`

Recursively walks the nav tree and produces a flat `{ uid → entry }` map. Each entry contains:

```
{
  item: <reference to navData item>,
  parentUid: <parent item's _uid or null>,
  index: <position among siblings>,
  srcPath: <page src_path or null>,
  folderDir: <section directory or null>,
  weight: <item weight>,
  title: <item title>,
  headless: <boolean>,
  parentDir: <parent section directory or ''>
}
```

Items with `_deleted: true` are excluded. The `item` reference preserves access to `_fm`, `setContent`, `_indexContent`, and all other data flags.

### Phase 1: Desired State Diff (`_computeSavePlan`)

Flattens both snapshots via `_flattenNavTree` (UID-keyed maps), compares them by UID, and produces a declarative output:

```
{
  pages: [
    {
      uid: <stable UID>,
      diskPath: <current on-disk path or null if new>,
      desiredPath: <target path or null if deleted>,
      desiredFm: <target _fm object>,
      origFm: <original _fm object>,
      setContent: <full raw content for split content pages or null>,
      createContent: <content for brand-new pages or null>,
      isNew: <boolean>,
      isDeleted: <boolean>,
      isIndex: <boolean>,
      newFrontmatter: <true when origFm had no nav-weight fields>
    },
    ...
  ],
  sections: [
    { uid, diskDir, desiredDir, isNew, isDeleted },
    ...
  ],
  convertOps: [...],       // pass-through: convert-folder-to-page, regenerate-index
  createFolderOps: [...],  // create-folder ops from batchQueue
  mkdocsYmlOps: [...]      // write-mkdocs-yml ops if yml changed
}
```

Key rules:
- **Moved pages**: `diskPath !== desiredPath` and neither is null
- **Deleted pages**: `desiredPath` is null
- **New pages**: `diskPath` is null, `createContent` carries file content (resolved from `batchQueue` create-page ops)
- **Content splits**: `setContent` carries the full raw content (body + existing frontmatter) for content pages split from indexes
- **`newFrontmatter`**: computed here from the original snapshot's `_fm` — true when `origFm` has none of the four nav-weight keys (`weight`, `headless`, `retitled`, `empty`)
- **No rename/move/delete operations**: only the desired end state

### Phase 2: Disk Operation Planning (`_planDiskOperations`)

Takes the desired state and computes the minimum disk operations to achieve it.

**Folder rename detection algorithm:**

1. Group all moved pages (`diskPath != desiredPath`, both non-null) by `sourceDir → destDir`
2. For each sourceDir, check if it qualifies as a folder rename:
   - All non-deleted pages from sourceDir go to the SAME destDir
   - Relative paths within the dir are preserved (`diskPath.slice(srcDir.length) === desiredPath.slice(destDir.length)`)
   - No pages from sourceDir are staying in sourceDir (unless deleted)
3. If all conditions met → single `rename-folder` op in Batch 1, all covered pages skipped in Batch 2
4. Sort folder renames deepest-first so child folders rename before parents

This approach detects folder renames purely from the page-level desired state. The snapshot diff never specifies renames — the planner discovers them.

### Batch 1: Folder Operations (API calls)

- **Folder renames**: Detected by the planner from page moves. Deepest folders renamed first. Executed via `_apiPost('/rename-folder', ...)`. The API server creates parent directories automatically (`mkdir(parents=True)`), so deep moves work without prior directory creation.
- **Folder deletes**: Sections deleted in the desired state that have no surviving descendant pages. Executed via `_apiPost('/delete-folder', ...)`.

### Batch 2: File Operations + Content Migration (bulk WebSocket)

**2a. mkdocs.yml writes** — if the virtual `mkdocs.yml` differs from the original.

**2b. Delete files** — pages with `isDeleted: true` → `_wsDeleteFile`

**2c. Move/rename files** — pages where `diskPath !== desiredPath`, NOT covered by a folder rename from Batch 1. The `rename-page` executor reads the file, rewrites outbound links, deletes the old file, and creates the new file.

**Index content splitting** uses the standard op ordering: the content page (which reuses the original index's UID) generates a `rename-page` that moves the file to the content page path. This vacates the index path. Then in batch 2e, a `create-page` fills the vacated index path with thin frontmatter-only content. Finally in batch 2f, `set-frontmatter` with `setContent` writes the body (from the snapshot) with merged nav-weight frontmatter to the content page. The user can freely move the content page anywhere after staging — the standard diff handles it.

**2d. Convert ops** — passthrough ops from the batchQueue (`regenerate-index`, `convert-folder-to-page`). Also includes `create-folder` ops for new sections.

**2e. Create new files** — pages with `isNew: true` and `createContent` → `_wsNewFile` + `_wsSetContents`.

**2f. Content migration** — after structural changes:
- `set-frontmatter` for pages with changed frontmatter or `setContent`. When `setContent` is present, the executor uses it as the body instead of reading from disk, merging any frontmatter in `setContent` with the nav-weight fields from `_fm`. The `newFrontmatter` flag ensures correct key ordering when nav-weight fields are added for the first time.
- `rewrite-links` — a single op carrying `renameMap` (aggregated from all renames: folder + individual) and `deletedPaths`.

### Precomputed Renames

`_planDiskOperations` computes a `precomputedRenames` map from folder renames, mapping original page paths to their post-folder-rename paths. This is seeded into `_batchRenamedPaths` at the start of batch execution so that subsequent file-level operations (e.g., `set-frontmatter`) can resolve chained renames via `_resolveChainedRename`.

### Frontmatter Diff Logic

For each page in the desired state that is not deleted, `_planDiskOperations` compares `desiredFm` with `origFm`:

1. Check every key in `desiredFm` — if any value differs from `origFm`, mark as changed
2. Check every key in `origFm` — if any key is missing from `desiredFm`, mark as changed
3. If changed (or `setContent` is present), generate a `set-frontmatter` op with both `fm` and `origFm` for key ordering

The `newFrontmatter` flag (computed in Phase 1 from the snapshot's `origFm`) tells the executor to read the actual file's frontmatter keys for ordering instead of relying on the snapshot's `origFm`.

### Nav Weight Normalization (Snapshot-Driven)

Weight normalization is not a separate batch. Normalization is a pure navData mutation performed before snapshotting:

- **`_applyNormalizeWeightsToNavData(items)`** — Recursively walks the entire nav tree. For each level, assigns sequential weights (100, 200, 300...) to all children. For sections with non-thin index pages (content index), the index is renamed to a slug-based filename, a new thin `index.md` is created with `_new = true`, and the renamed page gets `_renamed = true` and `_originalPath`. All changes are direct navData mutations.

- **`_applyNormalizeFolderToNavData(sectionItem)`** — Normalizes weights for a single section's direct children only (no recursion). Assigns sequential weights to pages and section index pages.

Both functions skip `_deleted` items and update `item._fm.weight` alongside `item.weight`. The standard two-phase save process then generates all necessary disk operations from the snapshot diff.

The user triggers normalization through:
- **"Normalize All"** menu item → calls `_applyNormalizeWeightsToNavData`, adds badge, commits snapshot
- **Per-folder "Normalize Nav Weights"** settings button → calls `_applyNormalizeFolderToNavData`, adds badge, commits snapshot
- **Post-migration auto-normalize** → `_autoNormalizeAfterMigration` applies `_applyNormalizeWeightsToNavData` then immediately saves

### After All Batches

Close bulk WebSocket → wait for mkdocs rebuild → reload page.

## Op Dispatch Table

`_dispatchSingleOp(op)` routes each operation to its executor:

| Op Type | Executor | Phase |
|---------|----------|-------|
| `wait-for-rebuild` | `_waitForRebuildAndReconnect` | Between batch 1 and 2 |
| `save-content` | `_executeSaveContentOp` | Before nav ops |
| `write-mkdocs-yml` | `_wsSetContents` (direct) | Batch 2a |
| `move-up` / `move-down` | `_executeMoveWeightOp` | Batch 2c |
| `move-left` / `move-right` / `move-into-section` | `_executeMoveFolderOp` | Batch 2c |
| `delete-page` | `_executeDeletePageOp` | Batch 2b |
| `rename-page` | `_executeRenamePageOp` | Batch 2c |
| `regenerate-index` | `_executeRegenerateIndexOp` | Batch 2d |
| `create-folder` | `_executeCreateFolderOp` | Batch 2d |
| `convert-folder-to-page` | `_executeConvertFolderToPageOp` | Batch 2d |
| `create-page` | `_executeCreatePageOp` | Batch 2e |
| `rename-folder` | `_executeRenameFolderOp` | Batch 1 |
| `delete-folder` | `_executeDeleteFolderOp` | Batch 1 |
| `rewrite-links` | `_executeRewriteLinksOp` | Batch 2f |
| `set-headless` | `_executeSetHeadlessOp` | Batch 2f |
| `set-frontmatter` | `_executeSetFrontmatterOp` | Batch 2f |

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

Migration from `mkdocs.yml` nav to `mkdocs-nav-weight` is not a special case. It is a large virtual refactoring of navData that produces one snapshot. Save uses the standard two-phase infrastructure — `_computeSavePlan` produces the desired state, then `_planDiskOperations` detects folder renames and generates the minimum set of disk operations.

### Flow

1. `_startMigrationFlow()` → reads `mkdocs.yml`, parses nav structure, computes target tree
2. `_scanClaimedIndexContent(tree.claimedIndexPaths)` → reads full content of claimed index files not yet scanned, stores as `_indexContent` on navData items
3. Confirmation dialog shown (all data already in memory)
4. `_applyMigrationToNavData(navStructure, allMdSrcPaths)` → synchronously mutates `liveWysiwygNavData` to match the target structure; extracts body from `_indexContent` into `setContent` on content page items
5. Sets `_navMigrationPending = true`, adds badge
6. `_commitNavSnapshot()` — one snapshot for the entire migration, containing all data needed for the save

The user sees the migrated nav and can undo, redo, or further edit before saving.

**Content pre-scanning.** Two scans populate `_indexContent`: (a) `_preComputationContentScan` runs at page load and scans existing `isIndex` items; (b) `_scanClaimedIndexContent` runs in `_startMigrationFlow` before the dialog and scans claimed index paths from the nav YAML that weren't `isIndex` in the pre-migration navData. Both are async but complete before the migration is staged. By the time the user clicks "Stage Migration", all content is in memory.

### `_applyMigrationToNavData` Internals

**UID mapping for sections.** Builds a directory rename map from `tree.pages`: for each page, `_getDir(oldPath)` and `_getDir(targetPath)` identify the old and new directories. If all pages from one old directory go to one new directory, that's tracked in `folderRenameMap`. Old section items are collected by directory (`existingSectionsByDir`). When building a new section for `secDir`, if a matching old directory exists in `folderRenameMap`, the old section's `_uid` is reused and `_new` is not set. This UID preservation is what allows `_planDiskOperations` to later detect the folder rename — it sees pages under the same UID'd section moving from one directory to another and can emit a single `rename-folder` op instead of individual file moves.

**Split content pages.** For each section that claims an existing `index.md` as a nav entry, `splitContentPages` records the split metadata: `oldPath`, `targetPath`, `title`, `weight`. This data is used by `buildTree` when processing claimed indexes.

**Index content splitting via `setContent`.** When `buildTree` encounters a claimed index path whose existing item has `_indexContent` (populated by the pre-scans), it creates two items:

1. **Content page item**: Reuses the original item's `_uid`, gets the new `src_path` (slug-based filename), `_renamed: true`, `_originalPath`, and `setContent` (the body extracted from `_indexContent` with frontmatter stripped). The diff sees "same UID, different path" and generates a `rename-page`. The `set-frontmatter` op carries `setContent` so the executor writes the body with merged nav-weight frontmatter.
2. **Thin index item**: Gets a new `_uid` and `_new: true`. A `create-page` op is queued in `_navBatchQueue` with the thin index frontmatter-only content.

The content page keeps the original UID so the desired state describes it as a moved page (`diskPath !== desiredPath`). The thin index has a new UID so it appears as a new page with `createContent`. The disk planner orders `rename-page` (batch 2c) before `create-page` (batch 2e), so the index path is vacated first, then the thin index is created there. The `setContent` on the content page's `set-frontmatter` op means the executor writes the body from the snapshot (no disk read needed), merging any existing frontmatter in the body with nav-weight fields. The user can freely move the content page to any location after staging — the standard desired-state diff handles it.

**Hidden page marking.** After `buildTree` completes, a `placedPaths` set is built by walking the new nav tree and collecting all `src_path` and `_originalPath` values. Pages in `allMdSrcPaths` that are not in `placedPaths` are appended to the tree with `headless: true` in their `_fm`. This is more reliable than `tree.inNavPaths` (which only contains old nav paths) because it accounts for newly created items (thin indexes) and renamed items. Their UIDs are preserved from the original navData when available.

**Batch queue passthrough ops.** `update-mkdocs-yml` (to remove the `nav` key) and `consolidate-hidden` (to move headless docs closer to referencing pages) are placed in `_navBatchQueue`. `_computeSavePlan` resolves these into the desired state's `convertOps` and `mkdocsYmlOps`, and `_planDiskOperations` passes them through to the execution plan.

### Execution Trace (Example)

Given: `steps/` → `pipeline-steps/`, with claimed index `steps/index.md` containing "Best practices" content → content at `pipeline-steps/best-practices.md`, thin index at `pipeline-steps/index.md`

**Phase 1 — Desired State** (`_computeSavePlan`):
- Existing pages under `steps/` appear with `diskPath: 'steps/...'` and `desiredPath: 'pipeline-steps/...'`
- Content page: `diskPath: 'steps/index.md'`, `desiredPath: 'pipeline-steps/best-practices.md'`, `setContent: <full raw content>`
- Thin index: `diskPath: null`, `desiredPath: 'pipeline-steps/index.md'`, `createContent: <thin frontmatter>`, `isNew: true`

**Phase 2 — Disk Planning** (`_planDiskOperations`):
- Detects all pages in `steps/` moving to `pipeline-steps/` with preserved relative paths → emits `rename-folder steps/ → pipeline-steps/`
- Content page move (`pipeline-steps/index.md` → `pipeline-steps/best-practices.md`) is NOT covered by the folder rename (filename changed) → emits `rename-page`

**Execution:**
1. **Batch 1**: `rename-folder steps/ → pipeline-steps/`. API moves entire folder. Client seeds `_batchRenamedPaths`.
2. **Batch 2c - rename**: `rename-page` moves `pipeline-steps/index.md` (resolved from folder rename) → `pipeline-steps/best-practices.md`.
3. **Batch 2e - creates**: `create-page` writes thin index (frontmatter-only) to `pipeline-steps/index.md` (now vacated by the rename).
4. **Batch 2f - content migration**: `set-frontmatter` with `setContent` on the content page writes body (from snapshot) + merged nav-weight frontmatter. `set-frontmatter` on all other pages for titles, weights, headless flags. `rewrite-links` for all renames and deletes.

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
