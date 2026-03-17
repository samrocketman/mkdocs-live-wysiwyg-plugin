# File Management — Design Document

## Overview

The focus mode navigation menu provides file management capabilities: moving pages, sections, and binary assets within the nav tree using arrow controls and keyboard shortcuts. Items can be moved individually or as a multi-select group via Cmd+Click (macOS) / Ctrl+Click (Windows/Linux). All movements operate on the in-memory `liveWysiwygNavData` tree and are persisted to disk through the unified save pipeline.

All code lives in `live-wysiwyg-integration.js` (movement, selection, save pipeline) and `editor.css` (visual feedback).

## Item Types

Three item types participate in nav tree management:

| Type | `item.type` | Has `src_path` | Has `children` | Has frontmatter | Save op for moves |
|------|-------------|----------------|----------------|-----------------|-------------------|
| Page | `'page'` | Yes (`.md`) | No | Yes (`_fm`) | `rename-page` (Batch 2) |
| Section | `'section'` | Yes (index `.md`) or empty | Yes | Via `index_meta` | `rename-folder` (Batch 1) |
| Asset | `'asset'` | Yes (binary) | No | No | `move-file` (Batch 1) |

Sections can be **indexed** (have an `index.md` with content) or **indexless** (no index, created with `skipIndex: true`). When a section is moved as a unit, its index moves with it. Indexless sections are created as intermediate wrappers during group movement when a child item carries a relative parent path.

## Single-Item Movement

### Entry point

All movement flows through `_handleArrowClick(item, itemType, direction, shiftKey)`. This function is called from:

- **Arrow button clicks** on nav item control buttons (left, up, down, right)
- **Keyboard arrow keys** in `_globalKeydownRouter` when `_navEditMode && _navKeyboardActiveItem` is set

`_handleArrowClick` determines the move variant and delegates to `_doArrowMove`, which calls the appropriate movement function.

### Movement functions

| Function | Trigger | Effect |
|----------|---------|--------|
| `_moveNavItemUp(item, shiftKey)` | Arrow Up | Swaps item with previous sibling. With Shift: moves into the deepest child of the previous section sibling |
| `_moveNavItemDown(item, shiftKey)` | Arrow Down | Swaps item with next sibling. With Shift: moves into the start of the next section sibling |
| `_moveNavItemLeft(item)` | Arrow Left | Moves item out of its parent section to the parent's sibling level |
| `_moveNavItemRight(item, shiftKey)` | Arrow Right | Moves item into the nearest adjacent section. With Shift: opens the "Create New Folder" dialog |
| `_moveNavItemUpDirect(item)` | Arrow Up (current page, no Shift) | Simple swap, no section entry |
| `_moveNavItemDownDirect(item)` | Arrow Down (current page, no Shift) | Simple swap, no section entry |

All six functions are **type-agnostic** — they work identically for pages, sections, and assets. They modify `liveWysiwygNavData` in memory and push descriptive ops to `_navBatchQueue`. None modify `item.src_path`.

### Batch queue ops from movement

| Op type | Pushed by | Fields |
|---------|-----------|--------|
| `move-up` | `_moveNavItemUp` | `{ item }` |
| `move-down` | `_moveNavItemDown` | `{ item }` |
| `move-into-section` | `_moveNavItemUp` (Shift), `_moveNavItemDown` (Shift) | `{ item, targetSection, position }` |
| `move-left` | `_moveNavItemLeft` | `{ item }` |
| `move-right` | `_moveNavItemRight` | `{ item, targetSection, position }` |
| `create-folder` | `_promptNewFolder` | `{ item, folderName, folderTitle, skipIndex, syntheticSection }` |

These ops are recorded in snapshots for undo/redo and used by `_computeSavePlan` to extract `createFolderOps`. The actual file moves are determined by the save pipeline's tree-position diff, not by replaying these ops.

### Post-move processing in `_doArrowMove`

After the movement function returns:

1. **Folder auto-expand/collapse**: if the item's parent section changed, the new parent (and its ancestors) are expanded (`_expanded = true`), and the old parent is collapsed
2. **Weight normalization**: sibling weights are normalized if the parent section is new/renamed or if any sibling lacks a weight
3. **Badge**: a "Reorder files" badge is added to the nav actions bar
4. **Focus**: `_setNavItemFocused(item)` marks the moved item as focused in navData
5. **Snapshot**: `_commitNavSnapshot()` captures the state and triggers `_renderNavFromSnapshot()`, which rebuilds the DOM, applies the `--focused` CSS class, and scrolls the focused item to center

### Keyboard state

- `_navKeyboardActiveItem`: the nav data item currently selected for keyboard movement. Set in `_doArrowMove`. Cleared by `_clearNavGroup`. When set, arrow keys in `_globalKeydownRouter` dispatch to `_handleArrowClick`
- Focus is tracked as `item._focused` on navData items, not as a separate DOM reference. The renderer applies `.live-wysiwyg-nav-item--focused` and `_renderNavFromSnapshot` scrolls to the focused item

### New folder creation

`_promptNewFolder(item)` opens a dialog for folder name/title. On confirmation:

1. Creates a synthetic section (`type: 'section'`, `_new: true`, `_expanded: true`)
2. Replaces the item in the nav tree with the synthetic section containing the item as its child
3. Pushes a `create-folder` op to `_navBatchQueue`
4. Commits a snapshot

## Unified Save Pipeline

The save pipeline converts in-memory tree changes to disk operations. It uses a **unified item model** where pages and assets are processed through the same code path for move detection.

### Desired path computation: `_computeDesiredItemPath`

A shared helper computes the desired disk path for any item (page or asset) from its position in the current nav tree:

```
function _computeDesiredItemPath(uid, currFlat, resolveDesiredDir)
  1. Look up the item in currFlat
  2. Extract the filename from its srcPath (last path segment)
  3. If the item has a parent section, resolve the parent's desired directory
  4. Return parentDir + '/' + fileName (or just fileName for root-level items)
```

This replaces the previous approach where `desiredPath` was set to `currE.srcPath` (which never changes when an item moves between sections) and the separate `_sectionDirRenameMap` lookup for assets.

### `_computeSavePlan` output: unified `items[]`

The desired state uses a single `items` array for both pages and assets:

```
{
  items: [
    {
      uid,
      diskPath,           // from origFlat (null for new)
      desiredPath,        // from _computeDesiredItemPath (null for deleted)
      itemType,           // 'page' or 'asset'
      isNew, isDeleted,
      isIndex,            // page-only (false for assets)
      desiredFm, origFm,  // page-only (null for assets)
      setContent,         // page-only (null for assets)
      createContent,      // page-only (null for assets)
      newFrontmatter      // page-only (false for assets)
    },
    ...
  ],
  sections: [...],
  convertOps: [...],
  createFolderOps: [...],
  mkdocsYmlOps: [...]
}
```

The previous separate fields (`assetMoves`, `assetDeletes`, `currentAssetPaths`) are eliminated. Asset moves and deletes are expressed as items with `diskPath !== desiredPath` or `isDeleted: true`, using the same representation as pages.

### `_planDiskOperations` with unified items

All loops iterate `desiredState.items` and branch by `itemType` only where the emitted op type differs:

| Operation | Pages | Assets |
|-----------|-------|--------|
| Folder rename detection | Included in `dirMoves` analysis | Included in `dirMoves` analysis |
| Move | `rename-page` (Batch 2) | `move-file` (Batch 1) |
| Delete | `delete-page` (Batch 2) | `delete-file` (Batch 2) |
| Create | `create-page` (Batch 2) | Skipped (assets not created via nav) |
| Content migration | `set-frontmatter` (Batch 2) | Skipped (no frontmatter) |
| Link rewrite map | `diskPath → desiredPath` | `diskPath → desiredPath` |

Folder delete checks iterate items to find living children (both pages and assets) instead of checking separate `currentAssetPaths`.

### Batch ordering

- **Batch 1**: folder renames, folder deletes, asset moves
- `wait-for-rebuild`
- **Batch 2**: mkdocs.yml writes, deletes, page moves, converts, create-folders, creates, content migration

## Multi-Select Group Movement

### Interaction model

- **Cmd+Click** (macOS) / **Ctrl+Click** (Windows/Linux) toggles nav items into or out of a selection group
- The **last item clicked** is the visual focal — it receives scroll centering and highlight
- On **arrow key press**, the focal auto-promotes to the **shallowest-depth** selected item (first in tree order at that depth). The group moves as a structural unit around this promoted focal
- **Escape** clears the group selection (items stay in their moved positions). A second Escape triggers the normal nav discard flow
- Any item type (page, section, asset) can be selected

### Selection modes

Each selection entry tracks one of two modes:

- **individual**: a single page, section, or asset. If deeper than the group's shallowest level, carries its relative parent path (intermediate indexless folders created at the destination)
- **section**: a folder including its index and ALL children. Created by Cmd+clicking a section label. Children move implicitly

**Auto-promotion**: when individually-selected items accumulate to cover all non-index children of a section, the selection auto-promotes to section mode (whole folder move including index).

**Downgrade**: Cmd+clicking a child out of a whole-section selection removes that child and converts the entry to individual selections of the remaining children.

### State

Selection and focus state lives on navData items, not in separate global variables:

- `item._focused` (boolean): the currently focused item for keyboard navigation and scrolling
- `item._selected` (boolean): whether the item is part of a multi-select group
- `item._groupMode` (string): `'individual'` or `'section'` — the selection type for the item

These properties are set by mutation helpers (`_setNavItemFocused`, `_toggleNavGroupItem`, `_clearAllNavSelected`) and persist in snapshots via `_deepCloneNavData`. Every state change calls `_commitNavSnapshot()`, making all selection and focus changes undoable.

`_navKeyboardActiveItem` is set to the focused item during selection and to the promoted focal when an arrow key fires.

### Cmd/Ctrl+Click handling

The `<a>` click handler (page links) and section label click handler are modified. When `(e.metaKey || e.ctrlKey)` and `_navEditMode`:

**Adding a page/asset:**

1. Set `item._selected = true` and `item._groupMode = 'individual'` on the navData item
2. Set `_focused` on the clicked item via `_setNavItemFocused(item)`
3. Check auto-promotion: if all non-index siblings in the parent section are now selected, convert individual entries to section mode
4. `_commitNavSnapshot()` — renderer applies `--selected` CSS and scrolls to the focused item

**Adding a section:**

1. Set `item._selected = true` and `item._groupMode = 'section'` on the section's navData item
2. Set `_focused` on the section via `_setNavItemFocused(item)`
3. Set `item._expanded = false` on the section to auto-collapse it
4. `_commitNavSnapshot()` — renderer applies `--selected` to the section `<li>` (individual file outlines are suppressed when a parent folder is selected)

**Removing a page/asset:**

1. If it was part of a section selection: downgrade — clear section's `_selected`/`_groupMode`, set individual `_selected`/`_groupMode` on each remaining child
2. Otherwise: clear `_selected` and `_groupMode` on the item
3. `_commitNavSnapshot()`. If no items remain selected, group mode is inactive

**Removing a section:**

1. Clear `_selected` and `_groupMode` on the section and all implicit children in navData
2. `_commitNavSnapshot()`. If no items remain selected, group mode is inactive

Default behavior (navigation / expand-collapse) is prevented when the modifier is held.

### Focal point promotion

When an arrow key is pressed with an active group:

1. Compute the depth of each top-level selection (items whose parent is not also selected)
2. Find the minimum depth
3. Among items at that depth, pick the first in depth-first tree order
4. Set `_focused` on the promoted focal via `_setNavItemFocused(item)`
5. `_commitNavSnapshot()` triggers re-render and scroll-to-center for the promoted focal

### Group movement algorithm

Group movement is a structural tree operation. Up/Down and Left/Right use different strategies.

#### Up/Down (vertical reorder)

1. **Promote focal** to shallowest depth
2. **Extract non-focal items** from their current tree positions
3. **Move the focal item** using the existing single-item movement function (`_moveNavItemUp` / `_moveNavItemDown`). This establishes the insertion point
4. **Re-insert sibling items** at the same level as the focal, adjacent to it, preserving their original relative order
5. **Single `_commitNavSnapshot`** after all placements

#### Left/Right (lateral move with auto-directory creation)

Left/Right group movement preserves relative directory structure by auto-creating intermediate indexless directories at the destination. This simplifies the selection: individual files in child folders are boxed into folder selections that can then be moved as units.

1. **Promote focal** to shallowest depth
2. **Compute relative parent chains** (`_computeRelativeParentChains`): for each selected item, trace the chain of ancestor sections between the item and the focal depth. Items at the focal depth have an empty chain. Items deeper carry a chain like `[sectionA, sectionB]`
3. **Extract non-focal items** from their current tree positions
4. **Move the focal item** using the existing single-item movement function (`_moveNavItemLeft` / `_moveNavItemRight`). This establishes the destination level
5. **Create or reuse directories** at the destination. Walk unique relative parent chains from shallowest to deepest:
   - If a section with the matching folder name already exists at the target level: **reuse** it
   - If not: **create** an indexless synthetic section (`_new: true`, `skipIndex: true`) via `_createIndexlessSectionSilent` and push a `create-folder` op to `_navBatchQueue`
6. **Place items** into their target sections. Standalone items (empty parent chain) go at the same level as the focal
7. **Rebuild the selection group** (`_clearAllNavSelected` then re-select):
   - **Newly created** directories become section-mode selections (`_selected: true, _groupMode: 'section'`)
   - Items placed into **reused** directories remain individual selections
   - Standalone items at the focal level remain individual selections
8. **Single `_commitNavSnapshot`** after all placements — triggers `_renderNavFromSnapshot()`, which rebuilds the nav DOM from navData (including `_selected` and `_focused` state), scrolls the focused item to center

The create/reuse/rebuild cycle is the same whether moving outward (Left) or inward (Right). Subsequent lateral moves of the same group simply move the boxed-up folder selections, which are already simplified from the first move.

#### Shift+Right (explicit new folder)

Shift+Right always opens `_promptNewFolder` with all group items, bypassing the auto-directory logic. This allows the user to choose a custom folder name.

### Escape behavior

Two-tier escape in `_globalKeydownRouter`:

1. If `_hasAnyNavSelected()` returns true or `_navKeyboardActiveItem` is set: `_clearAllNavSelected()` and `_clearNavItemFocused()` clear all selection and focus state on navData items, then `_commitNavSnapshot()`. Items stay in their moved positions
2. If no group is active: trigger the normal `_confirmNavDiscard()` flow

### Click behavior in nav edit mode

All three item types (page, section, asset) follow the same click pattern in nav edit mode:

1. **Cmd/Ctrl+Click**: toggles group selection via `_toggleNavGroupItem`
2. **Regular click with active group** (`_hasAnyNavSelected()` true): clears the group selection and focuses the clicked item
3. **Regular click without active group**: focuses the clicked item (sections also toggle expand/collapse)

This ensures the user can always move focus to any item by clicking, regardless of whether a group was previously active. Each click calls `_setNavItemFocused(navItem)` + `_commitNavSnapshot()` so the focus change is captured in a snapshot and undoable.

## Nav Controls in Group Mode

When `_hasAnyNavSelected()` returns true (any navData item has `_selected = true`):

- **Focal item**: shows only the 4 movement arrow buttons. The target icon and settings gear are hidden (`display: none`)
- **Other selected items**: all nav control buttons are rendered with `visibility: hidden` (not `display: none`) to preserve horizontal layout spacing
- **Non-selected items**: nav controls remain in their normal state

A parent-level class `live-wysiwyg-nav-group-active` on `_navSidebarEl` activates CSS rules for the visibility changes. `_buildNavMenu` applies or removes this class based on `_hasAnyNavSelected()` during each render.

## Rules

1. **Movement functions are type-agnostic.** `_moveNavItemUp/Down/Left/Right` must work identically for pages, sections, and assets. Never branch on `item.type` inside these functions.

2. **`item.src_path` is never updated during movement.** Movement functions only modify tree position (splicing items between arrays). The save pipeline computes desired paths from tree position via `_computeDesiredItemPath`.

3. **`_computeDesiredItemPath` is the sole source of truth for desired paths.** Both pages and assets use this helper. Never compute desired paths from `item.src_path` or `_sectionDirRenameMap` for individual items.

4. **The `items[]` array in the desired state is unified.** Pages and assets share the same entry shape. Branching by `itemType` occurs only in `_planDiskOperations` where the emitted op type differs (e.g., `rename-page` vs `move-file`).

5. **Asset moves go in Batch 1, page moves in Batch 2.** Asset moves use the API server (`/move-file`), which can execute before MkDocs rebuilds. Page moves need the WebSocket and content rewriting, which happen after rebuild.

6. **Group movement is structural, not per-item iteration.** The focal item is moved using the single-item movement function to establish the insertion point. Other items are placed relative to the focal item. Do not call `_moveNavItemUp/Down` in a loop for each group member.

7. **Focal point promotes to shallowest depth on move.** The visual focal (last clicked) and the movement focal (shallowest depth, first in tree order) are distinct. Promotion happens only when an arrow key is pressed, not at selection time.

8. **Intermediate folders are always indexless.** When a group move recreates a parent path structure, intermediate wrapper sections use `skipIndex: true`. The only exception is when the section itself is part of the group as a whole-section selection.

9. **Auto-promotion preserves intent.** When all non-index children of a section are individually selected, the selection auto-promotes to a section selection so the index moves with the folder. Cmd+clicking a child out of a section selection downgrades to individual selections of the remaining children.

10. **Escape clears selection before discard.** When a group or keyboard focus is active, the first Escape clears selection state only (items stay in place, snapshots untouched). The second Escape triggers `_confirmNavDiscard`.

11. **Group CSS uses `visibility: hidden` for non-focal controls.** This preserves horizontal spacing so items don't shift position when controls are hidden. Only the focal item's target icon and settings gear use `display: none`. All visual state derives from navData properties applied by the renderer.

12. **Snapshots capture group moves atomically.** A single `_commitNavSnapshot` is called after all items in the group are placed. Undo reverts the entire group move in one step.
