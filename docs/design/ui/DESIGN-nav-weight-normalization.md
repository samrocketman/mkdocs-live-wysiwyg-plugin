# Nav Weight Normalization

Normalization assigns sequential weights (100, 200, 300, ...) to siblings at a given level so the nav ordering matches the visual order. All normalization shares a single function — `_normalizeLevelWeights(sectionItem)` — that handles one level of the nav tree.

## Core Function: `_normalizeLevelWeights(sectionItem)`

Accepts a section item (to normalize that section's children) or `null` (to normalize the root level of `liveWysiwygNavData`). Handles all filtering, index child management, and weight assignment for that single level. Does not recurse into child sections.

### Resolving the Level

- If `sectionItem` is provided with `.children`, the level is `sectionItem.children` and `parentDir` is derived from `_getSectionFolderDir(sectionItem)`.
- If `sectionItem` is `null`, the level is `liveWysiwygNavData` and `parentDir` is `''` (root).

### Phase 1 — Build an Ordered List

Iterate the level's items and classify each:

| Item | Action |
|---|---|
| `_deleted` items | Skip |
| Pages with `isIndex === true` | Clear weight to `null` on both `item.weight` and `item._fm.weight`. Do not add to ordered list. Index pages never carry a weight. |
| Headless pages (`headless === true`) | Skip — not part of visible nav ordering |
| Regular pages | Add to ordered list |
| Sections with no visible markdown content (`_hasVisibleMdContent(children)` is false) | Skip — hidden-only sections are not weighted |
| Sections with visible content | Handle section's index child (see below), then add a proxy entry to the ordered list |

#### Section Index Child Handling

When a section with visible content is encountered, its index child determines how it enters the ordered list:

1. **Index child is a real content page** (not `retitled && empty`): Rename it to a content page (generate filename from title, mark `_renamed`, set `isIndex = false`). Create a new thin `retitled+empty` index page in its place and insert at position 0 of the section's children. Add both the thin index (as a proxy with `isIndex: true`) and the renamed content page (as a proxy) to the ordered list.

2. **Index child is already a thin index** (`retitled && empty`, or just exists): Add as a proxy entry with `isIndex: true`.

3. **Section uses `index_meta`** (no index child page, but `item.src_path && item.index_meta`): Add the section itself as a proxy with `useIndexMeta: true`.

4. **No index at all**: Create a new thin `retitled+empty` index page, insert at position 0 of the section's children, set `item.src_path` to the new index path, and add as a proxy entry with `isIndex: true`.

The `indexWeight` used for newly created thin index pages is derived from `liveWysiwygNavWeightConfig.frontmatter_defaults.index_weight` (default: `-10`).

### Phase 2 — Assign Weights

Iterate the ordered list. Each entry receives weight `(index + 1) * 100`:

| Entry type | Weight target |
|---|---|
| Proxy with `useIndexMeta` | `target.index_meta.weight` |
| Proxy for index page | `target.weight` and `target._fm.weight`. If the proxy has a `_section` ref with `index_meta`, update `section.index_meta.weight` as well. |
| Regular page entry | `entry.weight` and `entry._fm.weight` |

`_syncCurrentPageWeight(srcPath, weight)` is called for every weighted item to update the live editor's in-memory frontmatter if the item is the currently open page.

## Entry Points

All entry points delegate to `_normalizeLevelWeights`.

### `_applyNormalizeWeightsToNavData(items)` — Normalize All Nav Weights

Called from the "Normalize All Nav Weights" button and from migration. Normalizes the root level, then recurses into every section with visible content, calling `_normalizeLevelWeights` at each level.

### `_applyNormalizeFolderToNavData(sectionItem)` — Normalize Folder Weights

Called from the "Normalize Weights" button in section settings. Delegates directly to `_normalizeLevelWeights(sectionItem)` for a single-level normalization.

### Weight Adjustment on Move (in `_doArrowMove`)

After a move operation, `_doArrowMove` calls `_updateInMemoryWeightFromDom(item, moveDir)` to compute a midpoint weight for the moved item between its new neighbors. Only the moved item's weight changes; sibling weights are untouched. `_normalizeLevelWeights` is never auto-triggered during moves.

If the moved item is the currently edited page, `_syncCurrentPageWeight` syncs the new weight to the live editor's frontmatter. For all other items, the weight change is stored in-memory on `navData` and written to disk at save time.

Explicit normalization via menu actions (`_applyNormalizeWeightsToNavData`, `_applyNormalizeFolderToNavData`) and post-migration auto-normalize remain unchanged.

## Auto-Index Creation on Move

When an indexless section (folder with content but no `index.md`) is moved via arrow keys, the editor auto-creates a thin `index.md` for it before computing the new weight. Without an index, the section has no `src_path` and no `index_meta`, so `_updateInMemoryWeightFromDom` bails early (empty `srcPath` guard) and no weight is persisted at save time.

### Mechanism

In `_doArrowMove` (single-item) and `_doGroupArrowMove` (multi-select), after the move operation but before weight computation:

1. Check `item.type === 'section' && !_getItemSrcPath(item)`.
2. Derive `folderDir` from `_getSectionFolderDir(item)`. Skip if empty.
3. Create a thin index child page (`_new: true`, `isIndex: true`, `retitled: true`, `empty: true`) and splice it at position 0 of `item.children`.
4. Set `item.src_path` and `item.index_meta`.
5. Call `_updateInMemoryWeightFromDom` to compute the midpoint weight.
6. Sync the computed weight to `indexChild.weight`, `indexChild._fm.weight`, and `item.index_meta.weight`.
7. Queue a `create-page` op with the final weight in frontmatter.
8. Add a "Create index for ..." badge.

At save time, `_computeSavePlan` detects the new index child UID (not in original snapshot) and emits a `create-page` op + `set-frontmatter` op with the correct weight.

## Rules

1. **Moving an indexless section must auto-create an index.** Without an `index.md`, the section cannot carry a weight, and reordering has no persistent effect. Both `_doArrowMove` and `_doGroupArrowMove` must check for this and create the index transparently.

2. **Weight computation must follow index creation.** `_updateInMemoryWeightFromDom` requires a truthy `_getItemSrcPath(item)` to proceed. The index must be created and `item.src_path` set before calling the weight computation function.

3. **The `_fm.weight` on the index child must be synced after weight computation.** `_setItemWeight` updates `item.index_meta.weight` and `child.weight` but not `child._fm.weight`. The `_fm` field is what `_computeSavePlan` uses for `desiredFm`, so it must reflect the final computed weight.

## Items That Are Never Weighted

| Item type | Reason |
|---|---|
| Index pages (`isIndex === true`) | Weight cleared to `null`; they inherit position from their section |
| Headless pages | Hidden content, not part of visible nav ordering |
| Hidden-only sections | Sections containing only binary assets or headless pages |
| Deleted items (`_deleted`) | Pending removal |
