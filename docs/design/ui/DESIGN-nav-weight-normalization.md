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

### Auto-Normalize on Move (in `_handleArrowClick`)

After a move operation, `_handleArrowClick` checks whether any weightable sibling at the destination level lacks a weight. If so (or if the parent section is `_new` or `_renamed`), it calls `_normalizeLevelWeights(parentSection)` where `parentSection` is `null` for root-level items.

The trigger check applies the same filtering rules as `_normalizeLevelWeights`:
- Skip `_deleted` items.
- Skip all `isIndex` pages (they never carry weights).
- Skip `headless` pages.
- Skip sections whose children have no visible markdown content.
- If any remaining sibling has `_getItemWeight(sib) == null`, trigger normalization.

## Items That Are Never Weighted

| Item type | Reason |
|---|---|
| Index pages (`isIndex === true`) | Weight cleared to `null`; they inherit position from their section |
| Headless pages | Hidden content, not part of visible nav ordering |
| Hidden-only sections | Sections containing only binary assets or headless pages |
| Deleted items (`_deleted`) | Pending removal |
