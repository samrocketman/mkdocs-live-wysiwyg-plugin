# Declarative Save Planner — Design Document

## Overview

The save process uses a two-phase architecture that separates **what** the end state should look like from **how** to achieve it:

1. **`_computeSavePlan`** — diffs snapshot 0 vs the active snapshot and produces a declarative desired state describing where every page and section should end up, with what frontmatter and content.
2. **`_planDiskOperations`** — converts the desired state into an optimized 2-batch execution plan, detecting folder renames to minimize disk writes.

This separation means the snapshot diff never specifies rename, move, or delete operations. It only describes the target state. The disk planner independently discovers optimizations (e.g., a single folder rename replacing many individual file moves).

All code lives in `live-wysiwyg-integration.js`.

## Motivation

The previous architecture had `_computeSavePlan` doing both: computing the diff and deciding how to execute it (folder renames, file renames, creates, deletes, frontmatter updates). This coupling caused bugs:

- The diff had to pre-compute folder renames and mark files as "covered by folder rename"
- The migration code (`_applyMigrationToNavData`) had to understand save mechanics (e.g., queuing `create-page` ops into `_navBatchQueue`)
- When the planned operations didn't match what actually needed to happen on disk, files were deleted or corrupted

The declarative approach eliminates this coupling: the diff describes the desired end state, and the planner figures out how to get there.

## Phase 1: Desired State Diff (`_computeSavePlan`)

### Input

Two snapshots: `originalSnap` (snapshot 0, the pre-edit state) and `currentSnap` (the active snapshot with all user edits).

Both are flattened via `_flattenNavTree` into UID-keyed maps. Each entry contains the `item` reference (preserving access to `_fm`, `setContent`, `_indexContent`, and all data flags), plus `srcPath`, `folderDir`, and other metadata.

### Output

```
{
  items: [
    {
      uid: <stable UID>,
      diskPath: <current on-disk path or null if new>,
      desiredPath: <target path or null if deleted>,
      itemType: <'page' or 'asset'>,
      desiredFm: <target _fm object or null for assets>,
      origFm: <original _fm object or null for assets>,
      setContent: <full raw content for split content pages or null>,
      createContent: <content for brand-new pages or null>,
      isNew: <boolean>,
      isDeleted: <boolean>,
      isIndex: <boolean (false for assets)>,
      newFrontmatter: <true when origFm had no nav-weight fields (false for assets)>
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

### Item Classification

The `items[]` array contains both pages and assets (`itemType` field distinguishes them). Desired paths are computed by `_computeDesiredItemPath`, which derives the target disk path from the item's position in the current nav tree rather than from `item.src_path` (which never changes during movement).

| Condition | Meaning |
|-----------|---------|
| `diskPath !== desiredPath`, both non-null | Item moved (page or asset) |
| `desiredPath` is null | Item deleted |
| `diskPath` is null | New item (`createContent` carries file content for pages) |
| `setContent` is non-null | Content split from index (body + existing frontmatter, pages only) |
| `diskPath === desiredPath` | Item stays in place (pages may still have frontmatter changes) |

### `batchQueue` Resolution

The snapshot's `batchQueue` is consumed during Phase 1:

- `create-page` entries are resolved into `createContent` on matching new page entries
- `create-folder` entries become `createFolderOps`
- `convert-folder-to-page` and `regenerate-index` entries become `convertOps`
- `mkdocs.yml` changes are detected by comparing `currentSnap.mkdocsYml` with `originalSnap.mkdocsYml` and produced as `mkdocsYmlOps`

### `newFrontmatter` Flag

Computed during Phase 1 by checking whether the original snapshot's `_fm` has any of the four `mkdocs-nav-weight` keys (`weight`, `headless`, `retitled`, `empty`). When all four are `undefined`, the flag is `true`, indicating nav-weight frontmatter is being added for the first time. The executor uses `op.fm` and `op.origFm` from the snapshot as the sole source of truth for frontmatter — it does not read disk frontmatter to override these values.

### Absorbed Section Index Handling (Content Split)

When Material for MkDocs `navigation.indexes` is active, section index pages are absorbed into the section object. The section item (not a page child) holds `src_path`, `_uid`, and `_indexContent`. During migration, `_applyMigrationToNavData` looks up the existing item via `existingByPath[indexPath]`.

If the match is a **section** (absorbed index), the split content page must be treated as a **new page** (`_new: true` with a fresh UID). Reusing the section's UID would cause `_computeSavePlan` to process it as a section entry (via `folderDir`) instead of a page, making the content page invisible to the save pipeline. The thin index always gets a new UID regardless.

If the match is a **page** (non-Material case), the split content page inherits the page's UID and is treated as a rename.

## Phase 2: Disk Operation Planning (`_planDiskOperations`)

### Input

The desired state from Phase 1.

### Output

```
{
  batch1: [...],              // folder-level ops (renames, deletes)
  batch2: [...],              // file-level ops + content migration
  precomputedRenames: {...}   // original path → post-folder-rename path
}
```

This is the same shape the batch executor (`_runBatchOps`) expects. The executor, dispatcher (`_dispatchSingleOp`), and all individual executors are unchanged.

### Folder Rename Detection Algorithm

```
1. Group all moved files (diskPath != desiredPath, both non-null) by:
   sourceDir = _getDir(diskPath)  →  destDir = _getDir(desiredPath)
   Both pages AND asset (binary) moves are included in this grouping.

2. For each sourceDir, check if it qualifies as a folder rename:
   a. All non-deleted files from sourceDir go to the SAME destDir
   b. Relative paths within the dir are preserved:
      diskPath.slice(srcDir.length) === desiredPath.slice(destDir.length)
   c. No files from sourceDir are staying in sourceDir (unless deleted)

3. If all conditions met → emit rename-folder op for Batch 1
   Mark all covered files so Batch 2 skips individual renames/moves

4. Sort folder renames deepest-first (child folders before parents)
```

This detects folder renames purely from file-level data (pages + assets). The snapshot never specifies renames — the planner discovers them. If some files from a directory move to different destinations (or some stay behind), the planner falls back to individual file moves.

Both pages and assets from the unified `items[]` array are included in the `dirMoves` / `filesByDiskDir` analysis using their actual UIDs. The `coveredByFolderRename` set covers both page UIDs and asset UIDs. A separate loop over `items` where `itemType === 'asset'` emits `move-file` ops for assets NOT covered by a folder rename.

### Precomputed Renames

For each folder rename, the planner computes a `precomputedRenames` map: `{ originalPath → postFolderRenamePath }` for every page under the renamed folder. This is seeded into `_batchRenamedPaths` at the start of execution so that Batch 2 operations (e.g., `set-frontmatter`) can resolve chained renames via `_resolveChainedRename`.

### Batch 1: Folder Operations + Asset Moves

| Op Type | Source | Executor |
|---------|--------|----------|
| `rename-folder` | Detected from page + asset moves | `_executeRenameFolderOp` → `_apiPost('/rename-folder', ...)` |
| `delete-folder` | Deleted sections with no surviving items (pages or assets) | `_executeDeleteFolderOp` → `_apiPost('/delete-folder', ...)` |
| `move-file` | Asset moves not covered by folder renames | `_executeMoveFileOp` → `_apiPost('/move-file', ...)` |

Asset (binary) file moves are always handled by the API server, never the WebSocket. After moving, `_executeMoveFileOp` updates `_batchRenamedPaths` and `_updateLinkIndexForMove` so chained operations resolve correctly.

Folder deletes include a safety check: before emitting a `delete-folder` op, the planner iterates `items[]` to verify no non-deleted items (pages or assets) have `diskPath` or `desiredPath` under the folder prefix. This prevents deleting directories that contain files being moved elsewhere.

After Batch 1, a `wait-for-rebuild` op triggers MkDocs to rebuild and the WebSocket to reconnect before Batch 2 begins.

### Batch 2: File Operations + Content Migration

Operations are ordered within Batch 2 as follows:

| Sub-phase | Op Types | Source |
|-----------|----------|--------|
| 2a | `write-mkdocs-yml` | `mkdocsYmlOps` |
| 2b | `delete-page`, `delete-file` | Items with `isDeleted: true` (branched by `itemType`) |
| 2c | `rename-page` | Moved pages NOT covered by folder renames |
| 2d | `convert-folder-to-page`, `regenerate-index`, `create-folder` | `convertOps` and `createFolderOps` pass-through |
| 2e | `create-page` | New pages with `createContent` |
| 2f | `set-frontmatter` | Pages with changed frontmatter or `setContent` |
| 2f | `rewrite-links` | Aggregated rename map + deleted paths (pages + assets) |

### Frontmatter Diff Logic

For each non-deleted page, the planner compares `desiredFm` with `origFm`:

1. Check every key in `desiredFm` — if any value differs from `origFm`, mark as changed
2. Check every key in `origFm` — if any key is missing from `desiredFm`, mark as changed
3. If changed (or `setContent` is present), generate a `set-frontmatter` op with both `fm` and `origFm` for key ordering

### Link Rewrite Aggregation

The planner builds a combined rename map from:
- Folder renames (via `precomputedRenames`)
- All item moves where `diskPath !== desiredPath` (single loop over `items[]`, covering both pages and assets)

Plus a `deletedPaths` set from deleted items. If either map is non-empty, a single `rewrite-links` op is appended to Batch 2f.

Asset moves are included in the rename map so that markdown content referencing binary files (e.g., `[Download PDF](../assets/guide.pdf)`, `![Diagram](images/arch.png)`) is automatically rewritten when the referenced file moves. The rewriter is extension-agnostic — any non-markdown file with a valid filename is handled.

## Call Site: `_executeNavBatchSave`

```javascript
var desiredState = _computeSavePlan(originalSnap, activeSnap);
var plan = _planDiskOperations(desiredState);
// plan.batch1, plan.batch2, plan.precomputedRenames → _runBatchOps
```

The mkdocs.yml handling is inside `_computeSavePlan` (producing `mkdocsYmlOps`), not in the caller. The rest of `_executeNavBatchSave` (orderedOps construction, dirty-doc handling, `_runBatchOps` call) is unchanged.

## Execution Trace (Example)

Given: `steps/` → `pipeline-steps/`, with claimed index `steps/index.md` containing "Best practices" content → content at `pipeline-steps/best-practices.md`, thin index at `pipeline-steps/index.md`

### Case A: Non-Material (index is a page child)

**Phase 1 — Desired State:**
- Pages under `steps/` appear with `diskPath: 'steps/...'` and `desiredPath: 'pipeline-steps/...'`
- Content page: `diskPath: 'steps/index.md'`, `desiredPath: 'pipeline-steps/best-practices.md'`, `setContent: <full raw content>` (inherits old index UID → rename)
- Thin index: `diskPath: null`, `desiredPath: 'pipeline-steps/index.md'`, `createContent: <thin frontmatter>`, `isNew: true`

**Phase 2 — Disk Planning:**
- All pages in `steps/` move to `pipeline-steps/` with preserved relative paths → single `rename-folder steps/ → pipeline-steps/`
- Content page move (`pipeline-steps/index.md` → `pipeline-steps/best-practices.md`) has a different filename → NOT covered by folder rename → individual `rename-page`

**Execution:**
1. **Batch 1**: `rename-folder steps/ → pipeline-steps/`
2. **Batch 2c**: `rename-page pipeline-steps/index.md → pipeline-steps/best-practices.md`
3. **Batch 2e**: `create-page pipeline-steps/index.md` (thin index)
4. **Batch 2f**: `set-frontmatter` with `setContent` on content page; `set-frontmatter` on all other pages; `rewrite-links`

### Case B: Material `navigation.indexes` (index absorbed into section)

When the index is absorbed, `existingByPath[indexPath]` returns the section item. The split content page gets `_new: true` with a fresh UID.

**Phase 1 — Desired State:**
- Content page: `diskPath: null`, `desiredPath: 'pipeline-steps/best-practices.md'`, `setContent: <full raw content>`, `isNew: true`
- Thin index: `diskPath: null`, `desiredPath: 'pipeline-steps/index.md'`, `createContent: <thin frontmatter>`, `isNew: true`
- The section UID maps section-to-section (folder rename); no UID collision

**Execution:**
1. **Batch 1**: `rename-folder steps/ → pipeline-steps/` (the old `steps/index.md` moves to `pipeline-steps/index.md`)
2. **Batch 2e**: `create-page pipeline-steps/best-practices.md` (empty); `create-page pipeline-steps/index.md` (thin index, overwrites the moved file)
3. **Batch 2f**: `set-frontmatter` with `setContent` on content page (writes body + frontmatter); `set-frontmatter` on all other pages; `rewrite-links`

## Binary (Asset) File Handling

### Unified Items Array

Asset moves and deletes are represented in the same `items[]` array as pages. An asset entry has `itemType: 'asset'` with `diskPath`, `desiredPath`, and `isDeleted` fields following the same semantics as page entries. The desired path is computed by `_computeDesiredItemPath` from the asset's position in the current nav tree, not from `item.src_path` (which remains unchanged during movement). Page-only fields (`desiredFm`, `origFm`, `setContent`, `createContent`, `newFrontmatter`) are `null`/`false` for assets.

### Execution via API Server

All binary file operations use the API server (`api_server.py`), never the WebSocket:

- **`move-file`** — `_executeMoveFileOp` calls `_apiPost('/move-file', { old_path, new_path })`. The API server creates parent directories automatically (`mkdir(parents=True)`), moves the file, and returns the result. After moving, `_batchRenamedPaths[oldPath] = newPath` and `_updateLinkIndexForMove(oldPath, newPath)` are called so chained operations resolve correctly.
- **`delete-file`** — `_executeDeleteFileOp` calls `_apiPost('/delete-file', { path })`. The API server verifies the file is within `docs_dir`, rejects `.md` files, and unlinks the file. After deletion, `_batchDeletedPaths[path] = true` is set so downstream operations skip the file.

### Link Rewriting for Binary Files

Asset moves are included in `allRenames` alongside page moves and `precomputedRenames` from folder renames. The `rewrite-links` op's `renameMap` therefore includes binary file paths. When `_executeRewriteLinksOp` runs, it checks every page's references in the link index against the rename map — binary file targets that moved are resolved and the referencing pages are rewritten.

The rewriter (`_rewriteAllMovedLinksInPage`) and the link index builder (`_extract_refs`) are both extension-agnostic. Any local file reference in markdown (links, images, img tags, reference definitions) is captured and rewritten regardless of the target file's extension.

### Folder Rename Coverage

Assets are included in the same `dirMoves` / `filesByDiskDir` analysis as pages (both are entries in the unified `items[]` array). If a folder rename covers an asset's move (same source dir, same dest dir, preserved relative path), the asset does not generate a separate `move-file` op — the folder rename handles it. The `coveredByFolderRename` check filters these out.

### Migration Asset Carry-Over

`_applyMigrationToNavData` replaces the entire `liveWysiwygNavData` with a new tree built from the migration's `navStructure`. Since the `buildTree` function only processes pages and sections, asset items would be lost. Before the replacement, all existing asset items are collected from the old navData and re-inserted into the new tree:

1. Collect all `type: 'asset'` items from the old `liveWysiwygNavData`
2. For each asset, determine the target directory by applying `folderRenameMap` (if the asset's parent directory was renamed during migration, update its `src_path` and mark `_renamed`)
3. Find the matching section in `newNavData` via `_findSectionChildren`, or create synthetic sections via `_ensureSectionForDirIn` if no match exists
4. Insert the asset into the target section

This ensures binary files survive the migration without generating spurious delete operations in the save planner.

## What Does NOT Change

- `_applyMigrationToNavData` — still produces snapshot navData with the same structure
- `_flattenNavTree` — still flattens navData for comparison
- All executor functions (`_executeRenamePageOp`, `_executeCreatePageOp`, `_executeDeletePageOp`, `_executeRenameFolderOp`, `_executeSetFrontmatterOp`, etc.)
- `_dispatchSingleOp` — unchanged
- `_runBatchOps` — unchanged
- `_takeNavSnapshot` / `_syncFmFields` — unchanged
- Snapshot data structure (navData items with `_fm`, `setContent`, `_new`, `_renamed`, etc.)

## Invariants

1. **The desired state is declarative.** It describes the end state, not the steps to get there. No rename, move, or delete operations appear in the desired state.
2. **The disk planner is deterministic.** Given the same desired state, it always produces the same execution plan.
3. **Folder renames are discovered, not prescribed.** The planner analyzes page moves to detect folder renames. The snapshot diff and migration code never need to know about folder renames.
4. **The planner output matches the executor's expected input.** `{ batch1, batch2, precomputedRenames }` — the same shape as the old `_computeSavePlan` output. No executor changes needed.
5. **`setContent` and `createContent` carry all data needed for writes.** The planner and executor never need to read from disk for pages with these fields.
6. **The snapshot is the sole source of truth for frontmatter.** `_executeSetFrontmatterOp` uses `op.fm` and `op.origFm` from the snapshot to build the YAML frontmatter. The file is read only to extract the body content. The executor does not read disk frontmatter to override snapshot values.
7. **Headless pages are excluded from weight normalization.** `_applyNormalizeWeightsToNavData`, `_normalizeChildWeightsInMemory`, and `_autoNormalizeSiblingWeights` all skip pages with `item.headless === true`. Headless pages must never receive a weight — they exist outside the ordered navigation.
8. **Auto-normalize waits for hidden page precomputation.** `_autoNormalizeAfterMigration` polls `_navHiddenPagesPrecomputed` before proceeding. This ensures `_precomputeHiddenPages` has finished adding hidden pages (with `headless: true`) to `liveWysiwygNavData` before weight normalization runs. Without this, a race condition causes headless pages to appear as regular pages and receive weights.
9. **All planning inputs come from snapshots, never DOM.** Both `_computeSavePlan` and `_planDiskOperations` operate exclusively on navData snapshots flattened via `_flattenNavTree`. No DOM element, attribute, or query result influences the desired state or disk plan. The DOM is rebuilt after save as part of the page reload cycle.
