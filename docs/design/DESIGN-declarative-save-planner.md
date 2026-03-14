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

### Page Classification

| Condition | Meaning |
|-----------|---------|
| `diskPath !== desiredPath`, both non-null | Page moved |
| `desiredPath` is null | Page deleted |
| `diskPath` is null | New page (`createContent` carries file content) |
| `setContent` is non-null | Content split from index (body + existing frontmatter) |
| `diskPath === desiredPath` | Page stays in place (may still have frontmatter changes) |

### `batchQueue` Resolution

The snapshot's `batchQueue` is consumed during Phase 1:

- `create-page` entries are resolved into `createContent` on matching new page entries
- `create-folder` entries become `createFolderOps`
- `convert-folder-to-page` and `regenerate-index` entries become `convertOps`
- `mkdocs.yml` changes are detected by comparing `currentSnap.mkdocsYml` with `originalSnap.mkdocsYml` and produced as `mkdocsYmlOps`

### `newFrontmatter` Flag

Computed during Phase 1 by checking whether the original snapshot's `_fm` has any of the four `mkdocs-nav-weight` keys (`weight`, `headless`, `retitled`, `empty`). When all four are `undefined`, the flag is `true`, telling the executor to read the actual file's existing frontmatter for key ordering instead of relying on the snapshot's `origFm`.

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
1. Group all moved pages (diskPath != desiredPath, both non-null) by:
   sourceDir = _getDir(diskPath)  →  destDir = _getDir(desiredPath)

2. For each sourceDir, check if it qualifies as a folder rename:
   a. All non-deleted pages from sourceDir go to the SAME destDir
   b. Relative paths within the dir are preserved:
      diskPath.slice(srcDir.length) === desiredPath.slice(destDir.length)
   c. No pages from sourceDir are staying in sourceDir (unless deleted)

3. If all conditions met → emit rename-folder op for Batch 1
   Mark all covered pages so Batch 2 skips individual renames

4. Sort folder renames deepest-first (child folders before parents)
```

This detects folder renames purely from page-level data. The snapshot never specifies renames — the planner discovers them. If some pages from a directory move to different destinations (or some stay behind), the planner falls back to individual file moves.

### Precomputed Renames

For each folder rename, the planner computes a `precomputedRenames` map: `{ originalPath → postFolderRenamePath }` for every page under the renamed folder. This is seeded into `_batchRenamedPaths` at the start of execution so that Batch 2 operations (e.g., `set-frontmatter`) can resolve chained renames via `_resolveChainedRename`.

### Batch 1: Folder Operations

| Op Type | Source | Executor |
|---------|--------|----------|
| `rename-folder` | Detected from page moves | `_executeRenameFolderOp` → `_apiPost('/rename-folder', ...)` |
| `delete-folder` | Deleted sections with no surviving pages | `_executeDeleteFolderOp` → `_apiPost('/delete-folder', ...)` |

After Batch 1, a `wait-for-rebuild` op triggers MkDocs to rebuild and the WebSocket to reconnect before Batch 2 begins.

### Batch 2: File Operations + Content Migration

Operations are ordered within Batch 2 as follows:

| Sub-phase | Op Types | Source |
|-----------|----------|--------|
| 2a | `write-mkdocs-yml` | `mkdocsYmlOps` |
| 2b | `delete-page` | Pages with `isDeleted: true` |
| 2c | `rename-page` | Moved pages NOT covered by folder renames |
| 2d | `convert-folder-to-page`, `regenerate-index`, `create-folder` | `convertOps` and `createFolderOps` pass-through |
| 2e | `create-page` | New pages with `createContent` |
| 2f | `set-frontmatter` | Pages with changed frontmatter or `setContent` |
| 2f | `rewrite-links` | Aggregated rename map + deleted paths |

### Frontmatter Diff Logic

For each non-deleted page, the planner compares `desiredFm` with `origFm`:

1. Check every key in `desiredFm` — if any value differs from `origFm`, mark as changed
2. Check every key in `origFm` — if any key is missing from `desiredFm`, mark as changed
3. If changed (or `setContent` is present), generate a `set-frontmatter` op with both `fm` and `origFm` for key ordering

### Link Rewrite Aggregation

The planner builds a combined rename map from:
- Folder renames (via `precomputedRenames`)
- Individual page moves (`diskPath → desiredPath`)

Plus a `deletedPaths` set from deleted pages. If either map is non-empty, a single `rewrite-links` op is appended to Batch 2f.

## Call Site: `_executeNavBatchSave`

```javascript
var desiredState = _computeSavePlan(originalSnap, activeSnap);
var plan = _planDiskOperations(desiredState);
// plan.batch1, plan.batch2, plan.precomputedRenames → _runBatchOps
```

The mkdocs.yml handling is inside `_computeSavePlan` (producing `mkdocsYmlOps`), not in the caller. The rest of `_executeNavBatchSave` (orderedOps construction, dirty-doc handling, `_runBatchOps` call) is unchanged.

## Execution Trace (Example)

Given: `steps/` → `pipeline-steps/`, with claimed index `steps/index.md` containing "Best practices" content → content at `pipeline-steps/best-practices.md`, thin index at `pipeline-steps/index.md`

**Phase 1 — Desired State:**
- Pages under `steps/` appear with `diskPath: 'steps/...'` and `desiredPath: 'pipeline-steps/...'`
- Content page: `diskPath: 'steps/index.md'`, `desiredPath: 'pipeline-steps/best-practices.md'`, `setContent: <full raw content>`
- Thin index: `diskPath: null`, `desiredPath: 'pipeline-steps/index.md'`, `createContent: <thin frontmatter>`, `isNew: true`

**Phase 2 — Disk Planning:**
- All pages in `steps/` move to `pipeline-steps/` with preserved relative paths → single `rename-folder steps/ → pipeline-steps/`
- Content page move (`pipeline-steps/index.md` → `pipeline-steps/best-practices.md`) has a different filename → NOT covered by folder rename → individual `rename-page`

**Execution:**
1. **Batch 1**: `rename-folder steps/ → pipeline-steps/`
2. **Batch 2c**: `rename-page pipeline-steps/index.md → pipeline-steps/best-practices.md`
3. **Batch 2e**: `create-page pipeline-steps/index.md` (thin index)
4. **Batch 2f**: `set-frontmatter` with `setContent` on content page; `set-frontmatter` on all other pages; `rewrite-links`

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
6. **`newFrontmatter` is computed from the snapshot, not from disk.** It uses the original snapshot's `_fm` to determine if nav-weight fields are being added for the first time.
