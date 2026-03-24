# History Mode — Design Document

## Overview

History Mode is a **Layer 4** editor mode that provides a visual interface to the DAG-based content undo/redo system. It gives users a top-down, git-like view of their document editing history with the ability to inspect and restore content from any traceable point in the current editing session.

All code lives in `live-wysiwyg-integration.js`.

## Mode Definition

| Property | Value |
|---|---|
| **Layer** | 4 |
| **Z-index** | 99995 (shared with Mermaid Mode — mutually exclusive per Cardinal Rule #9) |
| **Entry** | "Document History" button in branch picker popup, or programmatic call to `_enterHistoryMode()` |
| **Exit** | ESC, close button, backdrop click, content restoration, or parent mode exit |
| **Active flag** | `_historyModeActive` |
| **Overlay element** | `.live-wysiwyg-history-overlay` |
| **Disk I/O** | None (read-only inspection; restoration modifies in-memory DAG state only) |

## Mutual Exclusion

History Mode and Mermaid Mode are mutually exclusive (Cardinal Rule #9). Both overlay Focus Mode at z-index `99995` but cannot coexist:

- `_enterHistoryMode()` returns early if `_mermaidModeActive` is true.
- `enterMermaidMode()` returns early if `_historyModeActive` is true.
- `exitFocusMode()` calls `_exitHistoryMode()` before `exitMermaidMode()`.

## Three-Tier UI

History Mode presents three progressive levels of interaction:

### Tier 1: Branch Picker Popup (Way 1)

A transient popup that appears when `Cmd+Shift+Z` (redo) executes at a DAG branch point. This is not a full mode entry — it's a lightweight notification with interaction.

**Trigger**: `_contentRedo()` calls `_showHistoryBranchPopup()` either after redo at a DAG branch point (`children.length > 1`) or when no redo is available (`!activeChildId`). This ensures History Mode is always accessible via `Cmd+Shift+Z`.

**Behavior**:
- When redo is available: redo executes immediately on the `activeChildId` branch (default behavior unchanged). Popup shows all child branches of the branch point with summary, snippet, and relative timestamp. The active branch (just-followed) is highlighted.
- When no redo is available: popup shows "End of history" header with only the "Show All Redo History" option.
- Arrow Up/Down navigates between branches. Tab/Enter on a non-active branch undoes the just-executed redo, switches `activeChildId`, and redoes on the selected branch.
- ESC or click-outside dismisses (accepting the already-executed redo).
- Popup persists until the user performs typing or other editing (dismissed via `beforeinput` handler for non-undo/redo input types).
- "Show All Redo History" menu item (with expand icon) opens Tier 2 (full History Mode).
- Popup is positioned near the text caret, offset to the right edge, with viewport boundary clamping.

**Positioning**: The popup is placed near the text caret using `window.getSelection().getRangeAt(0).getBoundingClientRect()`, offset to the right edge to avoid obscuring the user's text. Viewport boundary clamping ensures the popup remains fully visible.

**Dismiss**: Registered in `_dismissAllDropdowns()` via `_dismissHistoryBranchPopup()`. Also dismissed by `beforeinput` handler when the user performs any editing (non-undo/redo input types).

**Z-index**: 99999 (same layer as other editor dropdowns).

### Tier 2: Document History Overlay (Way 2)

The full-screen DAG visualization overlay. This is the actual History Mode (Layer 4).

**UI Structure**:
- Modal dialog with backdrop (click-to-dismiss).
- Left panel: scrollable DAG visualization (SVG edges + DOM nodes).
- Right panel (40% width): preview of selected node's content.

**DAG Visualization**:
- Flipped layout: latest history at top, oldest at bottom. **Detailed** view: `_computeDagLayout()`. **Organic** compact tree: `_computeOrganicLayout()` via header toggle; see [Organic Tree View](#organic-tree-view).
- Active path is flat on the left (column 0). Branches fork to the right.
- SVG layer draws connection lines (edges). Active path uses thicker/brighter stroke.
- DOM layer positions node elements over the SVG. Each node shows a color-coded dot, summary text (up to 2 lines), and relative timestamp.
- Current node has accent-colored dot with glow plus a "You Are Here" dotted-line indicator extending to the right edge of the DAG with a pill-shaped label (`<-----(< You Are Here)`).

**Inline Crumple Accordion System**:

Container groups (consecutive edits within the same markdown block) are collapsed into inline crumple icon nodes that occupy a single row in the layout. This eliminates gaps and overlaps:

- **Crumple icon**: A zigzag fold SVG (`==\==/==\==`) representing compressed history. Clicking unfolds to reveal individual nodes.
- **Type-specific colors**: Code blocks = teal, admonitions = amber, blockquotes = purple, lists = green. Applied via `data-container-type` attribute.
- **Block context dotted outline**: When "You Are Here" is inside a container group, a dashed outline with the container label (e.g., "bash code block") wraps the current node and adjacent crumple icons.
- **Unfold animation**: Expanding a crumple triggers a staggered entrance animation (`scaleY(0)→scaleY(1)`) on the revealed nodes.

**Column Layout for Branches**:

| Column | Content |
|--------|---------|
| 0 | Active path (always visible, linear) |
| 1 | Branch entry points: single-branch crumple nodes or V-tree fork icons |
| 2+ | Expanded branch content (vertical layout) or V-tree branch picker |

- **Single branch**: Crumple icon at col 1 with the branch's first node summary and edit count. Clicking expands the branch vertically into col 2+.
- **V-tree (2+ branches from one point)**: Fork icon (`diverging arrows`) at col 1 with "Multiple histories (N)" label. Clicking shows branch options at col 2. Selecting an option replaces the picker with that branch's expanded history.
- **Mutual exclusivity**: Only one root-level branch can be expanded at a time. Expanding a new branch collapses the previous one. Within a branch, sub-crumples can be expanded (columns shift right, horizontal scroll available).

**Interaction**:
- **Hover** (200ms debounce): floating preview tooltip with markdown snippet, rendered HTML, and "Full Screen" button.
- **Click**: selects node, updates right preview panel.
- **Double-click**: restores content to that node and exits.
- **Arrow keys**: Up = parent, Down = active child, Left/Right = sibling branches.
- **Enter**: restores to selected node and exits.
- **ESC**: exits History Mode.

### Tier 3: Full-Size Readonly Preview (Way 3)

A full-viewport rendered preview of a specific history node's content. Overlays the DAG overlay within the same z-index layer.

**Trigger**: "Full Screen" button on hover tooltips or the preview panel.

**UI Structure**:
- Header with node summary, "Restore to this point" button, and "Close" button.
- Scrollable body with rendered HTML content (`contenteditable="false"`).
- Content is styled with Material theme typography for visual fidelity.

**Behavior**:
- ESC returns to the DAG overlay (does not exit History Mode).
- Enter restores to the previewed node and exits History Mode entirely.
- "Restore to this point" button does the same as Enter.

## Content Restoration

`_restoreToHistoryNode(nodeId)` enables jumping to any node in the DAG:

1. Flush pending captures (`_flushHistoryCapture()`).
2. Reconstruct markdown at the target node (`_reconstructContentAtNode(nodeId)`).
3. Set `_historyCurrentId = nodeId`.
4. Apply content via `_historySetContent(markdown, node.htmlSnapshot)`.
5. Sync `_historyLastMd` to absorb normalization drift.
6. Restore cursor from the node's stored cursor state.
7. Persist DAG and auto-save.

This is analogous to `_contentUndo`/`_contentRedo` but jumps directly to any node rather than walking one step along the parent/child chain.

## Preview Rendering Pipeline

All previews (hover tooltip, side panel, full-size) use the same pipeline:

1. `_reconstructContentAtNode(nodeId)` walks diffs from root to reconstruct full markdown.
2. `_stripFrontmatterForPreview(markdown)` removes YAML frontmatter — previews show only body content.
3. `_renderMarkdownPreview(markdown)` calls `marked.parse()` with GFM options (same parser used by the editor).
4. `_enhancePreviewContent(html)` strips interactive controls (expand buttons, settings gears) from the rendered HTML so the preview is readonly.
5. Results are cached in `_historyPreviewCache` (keyed by node ID) to avoid redundant reconstruction.
6. Cache is cleared on History Mode entry/exit.

Full-size preview additionally:
- Sets `contenteditable="false"` to prevent editing.
- Runs syntax highlighting post-processing for code blocks.
- Triggers `_renderMermaidPreview` for valid mermaid fenced code blocks.
- Styled with Material theme typography for visual fidelity.

## Keyboard Handling

| Context | Key | Action |
|---|---|---|
| Branch popup | Arrow Up/Down | Navigate branch items |
| Branch popup | Tab / Enter | Confirm selection (switch branch if different) |
| Branch popup | ESC | Dismiss popup |
| DAG overlay | Arrow Up | Navigate to parent node |
| DAG overlay | Arrow Down | Navigate to active child |
| DAG overlay | Arrow Left/Right | Navigate to sibling branches |
| DAG overlay | Enter | Restore to selected node |
| DAG overlay | ESC | Exit History Mode |
| Full-size preview | Enter | Restore to previewed node |
| Full-size preview | ESC | Close preview, return to DAG |

The branch popup uses inline keydown handlers. The DAG overlay uses `_attachHistoryOverlayKeyboard()`. The full-size preview has its own keydown listener.

## Suppression Contract

When History Mode is active (Layer 4), the suppression contract from [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md) applies:

- Lower-layer keyboard handlers do not fire (the overlay captures events).
- Lower-layer scroll containers are not interactive (overlay has `inset:0` and backdrop).
- The overlay's `z-index:99995` places it above Focus Mode (`99990`) but shares the layer with Mermaid Mode (mutually exclusive).

## Entry/Exit Lifecycle

### Entry (`_enterHistoryMode`)

1. Guard: return if `_historyModeActive` or `_mermaidModeActive`.
2. Set `_historyModeActive = true`.
3. Clear preview cache.
4. Reset DAG visualization state: `_historyDagActiveBranchKey = null`, `_historyDagVtreeSelectedBranch = {}`, `_historyDagAnimatingGroup = null`, `_historyDagViewMode = 'detailed'`.
5. Build overlay DOM via `_buildHistoryOverlay()`.
6. Render DAG, attach keyboard handler, focus overlay.

### Exit (`_exitHistoryMode`)

1. Guard: return if not `_historyModeActive`.
2. Set `_historyModeActive = false`.
3. Dismiss full-size preview if open.
4. Remove overlay from DOM.
5. Clear references and cache.

### Auto-Exit

`exitFocusMode()` calls `_exitHistoryMode()` first, same as the existing `exitMermaidMode()` pattern.

## State Variables

| Variable | Type | Purpose |
|---|---|---|
| `_historyModeActive` | boolean | Layer 4 mode active flag |
| `_historyOverlay` | Element | The overlay DOM element |
| `_historyBranchPopup` | Element | The branch picker popup element |
| `_historyBranchPopupTimer` | number | Auto-dismiss timer ID |
| `_historyBranchPopupHighlight` | number | Currently highlighted branch index |
| `_historyBranchPopupNodeId` | number | Branch point node ID for the popup |
| `_historyDagSelectedNodeId` | number | Currently selected node in DAG overlay |
| `_historyFullsizePreview` | Element | Full-size preview element |
| `_historyPreviewCache` | Object | nodeId → markdown cache for previews |
| `_historyDagActiveBranchKey` | string\|null | Currently expanded branch/V-tree key (mutual exclusivity) |
| `_historyDagVtreeSelectedBranch` | Object | bpKey → selected child ID for V-tree pickers |
| `_historyDagAnimatingGroup` | string\|null | Group key currently animating (cleared after render) |
| `_historyDagExpandedGroups` | Object | groupKey → boolean for expanded container groups |
| `_historyDagViewMode` | `'detailed'` \| `'organic'` | DAG panel rendering: full cards vs compact organic tree |

## Helper Functions

| Function | Purpose |
|---|---|
| `_formatRelativeTime(ts)` | Converts timestamp to "2m ago" format |
| `_getSnippetForNode(node)` | Extracts first ~60 chars from diff ops |
| `_renderMarkdownPreview(md)` | `marked.parse()` wrapper with fallback |
| `_stripFrontmatterForPreview(md)` | Removes YAML frontmatter before preview rendering |
| `_computeDagLayout()` | Three-phase detailed DAG layout (vertical branches, crumple zones, compact rows, edges) |
| `_computeContainerGroups(activePathList)` | Identifies consecutive active-path edits within the same markdown container |
| `_layoutBranchVertical(nodeId, preferCol, forkRow, positions, maxCol, colOccupied)` | Lays out an inactive subtree in vertical stacks in col 1+, with `colOccupied` collision resolution |
| `_computeOrganicLayout()` | Compact tree layout: center trunk + balanced L/R branches for organic view |
| `_renderOrganicDag(container)` | Renders organic view (dots + SVG edges) when `_historyDagViewMode === 'organic'` |
| `_createCrumpleSvg()` | Returns zigzag fold SVG (~40×16) for crumple icons |
| `_createVtreeForkSvg()` | Returns diverging arrows SVG (~24×20) for V-tree fork icons |
| `_renderDag(container)` | Builds SVG edges + DOM nodes (standard, crumple, fork, vtree-option) in container |
| `_navigateDag(key)` | Arrow key navigation within DAG |
| `_restoreToHistoryNode(nodeId)` | Direct restoration to any DAG node |
| `_enhancePreviewContent(html)` | Strips interactive controls from rendered preview HTML |
| `_generateSummary(diff)` | Produces human-readable, markdown-aware change descriptions |

## CSS

All CSS is injected via `_getFocusModeCSS()`. Key class prefixes:

- `.live-wysiwyg-history-branch-*` — branch picker popup
- `.live-wysiwyg-history-overlay`, `.live-wysiwyg-history-modal*` — DAG overlay
- `.live-wysiwyg-history-dag-*`, `.live-wysiwyg-dag-*` — DAG nodes and edges
- `.live-wysiwyg-dag-crumple` — inline crumple accordion icons (container groups and single branches)
- `.live-wysiwyg-dag-crumple-svg`, `.live-wysiwyg-dag-crumple-label` — crumple icon and text
- `.live-wysiwyg-dag-crumple.branch-crumple` — branch-specific amber crumple variant
- `.live-wysiwyg-dag-vtree-fork` — V-tree multi-branch fork nodes (purple)
- `.live-wysiwyg-dag-vtree-svg`, `.live-wysiwyg-dag-vtree-label` — fork icon and text
- `.live-wysiwyg-dag-vtree-option` — V-tree branch picker items
- `.live-wysiwyg-dag-block-outline` — dashed outline around "You Are Here" container context
- `.live-wysiwyg-dag-block-outline-title` — floating container label for the outline
- `.live-wysiwyg-dag-you-are-here` — dotted line with right-aligned label
- `.live-wysiwyg-dag-you-are-here-line`, `.live-wysiwyg-dag-you-are-here-label` — line and pill sub-elements
- `.live-wysiwyg-history-toggle-view-btn` — detailed ↔ organic tree view toggle in the modal header
- `.live-wysiwyg-dag-transitioning` — short-lived class on the DAG container during view-mode cross-fade (~350ms)
- `.live-wysiwyg-organic-wrapper`, `.live-wysiwyg-organic-svg` — organic view root and edge layer
- `.live-wysiwyg-organic-dot`, `.live-wysiwyg-organic-dot.active-path`, `.live-wysiwyg-organic-dot.current` — 10px dots; trunk vs glow current
- `.live-wysiwyg-organic-edge`, `.live-wysiwyg-organic-edge-active` — organic Bézier edges
- `.live-wysiwyg-history-hover-*` — hover preview tooltip
- `.live-wysiwyg-history-preview-*` — side preview panel
- `.live-wysiwyg-history-fullsize-*` — full-size readonly preview

Crumple nodes use `data-container-type` for type-specific colors:
- `code` → teal (`#009688` border, `rgba(0,150,136,.08)` bg)
- `admonition` → amber (`#ff8f00` border, `rgba(255,143,0,.08)` bg)
- `blockquote` → purple (`#7c4dff` border, `rgba(124,77,255,.08)` bg)
- `list` → green (`#43a047` border, `rgba(67,160,71,.08)` bg)
- `branch-crumple` → amber scheme (`#f59e0b`)

Animation keyframes:
- `@keyframes liveWysiwygGroupEnter` — node entrance with `scaleY(0)→scaleY(1)` and opacity fade, staggered via `animationDelay`.

All colors use `var(--md-*)` CSS variables with fallbacks for theme-agnostic rendering.

## DAG Layout Algorithm (`_computeDagLayout`)

The layout algorithm transforms the DAG into positioned nodes and Bézier edges for the **detailed** DAG view (`_historyDagViewMode === 'detailed'`). It runs in **three phases** and returns `nodes`, `edges`, `width`, `height`, and `groups`. The **organic** tree view uses a separate pipeline (`_computeOrganicLayout` / `_renderOrganicDag`); see [Organic Tree View](#organic-tree-view).

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `NODE_W` | 300 | Node width in pixels |
| `H_GAP` | 28 | Horizontal gap between columns |
| `V_GAP` | 20 | Vertical gap between rows |
| `CRUMPLE_H` | 40 | Height of crumple icon nodes |

### Phase 1: Full tree walk and vertical branch layout

1. **Active path** — Walk from the DAG root along the undo/redo spine, building `activePath` (set) and `activePathList` (ordered **oldest → newest**: root first, latest leaf last). Include nodes reachable from `_historyCurrentId` toward root and along `activeChildId` so the current position is always on the path.
2. **Column 0 and row indices** — Assign each active-path node **column 0**. In working row coordinates, **root = row 0** and the **latest leaf = highest row index** (rows increase down the spine in this coordinate system).
3. **Inactive subtrees** — For each active-path fork, every child **not** on the active path is laid out with **`_layoutBranchVertical`**: the subtree is ordered, placed in **consecutive rows** starting below the fork row, and assigned a column **≥ 1**. A **`colOccupied`** map (`"col:row"` → true) records occupied cells; if the preferred column conflicts with any row the subtree needs, the column index is incremented until the placement fits. **`maxCol`** tracks the rightmost column for width calculation.

### Phase 2: Crumple zones, `hiddenByZone`, and compact rows

1. **`_computeContainerGroups(activePathList)`** — Identifies consecutive active-path edits within the same markdown container (code block, admonition, blockquote, list). Each group yields a stable key and metadata for crumple UI.
2. **`hiddenByZone`** — For each **collapsed** group (not expanded in `_historyDagExpandedGroups`), all nodes after the **representative** (first node in the group) map from node id → group key in `hiddenByZone`. Those nodes are omitted from visible output in phase 3.
3. **Crumple zones** — Collapsed groups register a crumple zone with `repId`, `nodeIds`, type, and label for synthetic crumple nodes.
4. **Branch metadata** — `branchPoints`, synthetic branch crumples, V-tree forks, and V-tree option rows are positioned in the same row/column model (`fullPositions` / `syntheticNodes`), respecting `_historyDagActiveBranchKey` and `_historyDagVtreeSelectedBranch`.
5. **Visible rows and `compactMap`** — Collect all row indices that must remain visible (active-path nodes not in `hiddenByZone`, crumple representatives, expanded branch subtrees, fork/option rows, etc.). Sort them and build **`compactMap`**: full row index → dense index `0…n-1` so **gaps from hidden nodes collapse**. Final **`displayRow = totalCompactRows - 1 - compactRow`** maps into screen space so **newest history appears toward the top** of the overlay (Cardinal Rule #1).

### Phase 3: Layout nodes, edges, visibility, and “You Are Here”

1. **Visibility filter** — Only **visible** entries become DOM/SVG output: skip real nodes that are **`hiddenByZone`** or off-path branch nodes when that branch is collapsed (unless they are synthetic). Expanded branches include the full subtree marked visible in phase 2.
2. **`layoutNodes` and `edges`** — Visible positions convert to pixel `x` / `y` using `NODE_W`, `H_GAP`, `V_GAP`, and `CRUMPLE_H` where applicable. Parent/child pairs emit edge records for SVG.
3. **Bézier edges** — `_renderDag` draws **cubic Bézier** paths when source and target differ horizontally (shared mid-Y control points); same-column connections use straight **vertical** segments. Active-path edges use thicker, accent styling.
4. **“You Are Here”** — On the **current** node row, render the dotted horizontal indicator and pill label from the node’s right edge toward the DAG width.

### Layout Node Metadata Fields

| Field | Type | Description |
|-------|------|-------------|
| `isCrumple` | boolean | Container group crumple icon |
| `crumpleKey` | string | Group identifier |
| `crumpleType` | string | Container type (`code`, `admonition`, `blockquote`, `list`) |
| `crumpleLabel` | string | Human-readable label (e.g., "bash code block") |
| `crumpleCount` | number | Number of collapsed nodes |
| `crumpleNodeIds` | number[] | IDs of collapsed nodes |
| `isVtreeFork` | boolean | Multi-branch fork point |
| `vtreeParentId` | number | Active-path parent of the fork |
| `vtreeChildIds` | number[] | Branch child IDs |
| `vtreeBpKey` | string | Branch-point key for state tracking |
| `isVtreeOption` | boolean | Branch picker option in V-tree |
| `optionChildId` | number | Child ID this option represents |
| `optionSummary` | string | Summary text for the option |
| `optionCount` | number | Depth of the branch |
| `isBranchCrumple` | boolean | Single-branch crumple at col 1 |
| `branchKey` | string | Branch identifier |
| `branchChildId` | number | Root node of the branch |
| `branchCount` | number | Depth of the branch |
| `isSynthetic` | boolean | Not a real DAG node (crumple/fork/option) |

## Organic Tree View

The modal header includes a **view toggle** (`.live-wysiwyg-history-toggle-view-btn`): in detailed mode the label is **“Tree View”**; in organic mode it is **“Detailed View”**. Clicking flips **`_historyDagViewMode`** between `'detailed'` and `'organic'`, re-runs `_renderDag` on the DAG container, and applies **`.live-wysiwyg-dag-transitioning`** for ~350ms so the switch uses an **animated transition** between layouts. On History Mode entry, `_historyDagViewMode` resets to **`'detailed'`**.

When `_historyDagViewMode === 'organic'`, `_renderDag` calls **`_renderOrganicDag`** after **`_computeOrganicLayout()`** (the detailed three-phase algorithm above is skipped).

- **Compact dots** — Each node is a **10px** circle (`.live-wysiwyg-organic-dot`), centered on the layout coordinate with a −5px absolute offset. Tooltip/title uses the node summary; click/double-click behavior matches the detailed DAG (select / restore).
- **Center trunk** — The active path is a **vertical line** at fixed **`centerX`**: the spine of the tree.
- **Balanced L/R branches** — At each active-path fork, inactive children are queued with **alternating** `side` **−1 / +1** and stepped horizontally by `depth * STEP`, so branches grow **left and right** in balance. Deeper descendants continue with alternating sides per BFS expansion.
- **Current node** — The dot for `_historyCurrentId` adds **`.current`** for a **glow** treatment (distinct from `.active-path` trunk styling).
- **Edges** — SVG paths use the same **vertical vs cubic Bézier** rule as the detailed DAG, with organic-specific edge classes (`.live-wysiwyg-organic-edge` / `-active`).
- **Scroll** — After render, the **current** dot is **`scrollIntoView`** (`block`/`inline`: `center`) so the present state stays in view.

## Container Group Detection (`_computeContainerGroups`)

Detects consecutive active-path nodes whose diffs modify lines within the same markdown structure:

1. Reconstruct markdown at each node on the active path.
2. For each node, examine the diff ops to find the primary line range being modified.
3. Use regex patterns to detect if the modified lines fall within a fenced code block (`` ``` ``), admonition (`!!!`/`???`/`???+`), blockquote (`> `), or list (`- `/`* `/`1. `).
4. If consecutive nodes modify the same container (matched by type + starting line number), they form a group.
5. Minimum group size is 2 nodes.

Group labels are markdown-aware:
- Code blocks: language from the fence line (e.g., "bash code block")
- Admonitions: type from the marker (e.g., "note admonition")
- Blockquotes: "blockquote"
- Lists: "list"

## Summary Generation (`_generateSummary`)

Produces human-readable, markdown-aware descriptions for DAG node labels:

| Pattern | Summary Example |
|---------|-----------------|
| Mermaid code block created | "Mermaid diagram created" |
| Fenced code block with language | "python code block" |
| Heading changed/added | `"heading text"` (quoted) |
| Admonition inserted | "note admonition" |
| Blockquote added | "blockquote added" |
| List items added | "list items added" |
| Single-line edit | First few words of the changed text |
| Multi-line fallback | "edited N lines" |

These summaries appear in DAG nodes, crumple labels, branch picker items, and V-tree options.

## "You Are Here" Indicator

A horizontal dotted-line arrow that spans the full width of the DAG from the right edge of the current node to the far right:

```
(current node label) <-----(< You Are Here)
```

- Positioned at the current node's row.
- Starts at `currentNode.x + NODE_W/2 + 6` (right edge of node + gap).
- Width extends to `max(layout.width, 600) - startX`.
- Contains a flex-growing dotted line (2px dashed, primary color) and a pill-shaped label with a left-pointing arrow SVG.
- Z-index 0 (renders behind nodes but above the SVG edge layer).

## Cardinal Rules

1. **Latest history at top, oldest at bottom.** The active undo-redo branch always renders with the most recent history node at the top of the DAG UI and the oldest (root) at the bottom. The user reads chronologically from bottom to top.

2. **Active branch is linear at column 0.** The active history branch renders as a straight vertical line in the leftmost column (col 0). All inactive branches fork off to the right. The active path must never be displaced from col 0.

3. **Branch subtrees stack vertically; columns resolve collisions.** Inactive subtrees are placed by `_layoutBranchVertical` as **vertical** stacks in columns 1+. The **`colOccupied`** map prevents two subtrees from sharing the same `(col, row)` cells; when the preferred column is blocked, the algorithm advances to the next column. SVG edges may curve between columns, but **node placement** is grid-aligned vertical stacking, not a diagonal grid.

4. **Multi-branch history from a single node shows branch options.** When a node has multiple inactive branches, a V-tree fork icon appears. Clicking it reveals the available branches. When the user selects a branch, it expands upward in col 1 unless doing so would visually collide with another branch, in which case it expands upward in the next available column. Branch options are not locked to a fixed column — they render wherever space permits.

5. **Edges use smooth curved paths.** Connecting lines between history nodes render as smooth cubic Bézier curves, styled like mermaid git diagram arrows. Straight-column connections (same x) use vertical lines. Cross-column connections (branching/merging) use S-curves that depart and arrive vertically. Active-path edges use thicker, accent-colored strokes; inactive edges use thinner, muted strokes.

## Cross-References

- [DESIGN-unified-content-undo.md](DESIGN-unified-content-undo.md) — DAG data structure, helper functions, content reconstruction
- [DESIGN-modes-of-operation.md](DESIGN-modes-of-operation.md) — Layer 4 position, suppression contract, mutual exclusion
- [DESIGN-layout.md](DESIGN-layout.md) — Z-index registry (99995 shared with Mermaid, 99999 for branch popup)
- [DESIGN-centralized-keyboard.md](DESIGN-centralized-keyboard.md) — Keyboard tier integration
- [DESIGN-popup-dialog-ux.md](DESIGN-popup-dialog-ux.md) — Branch popup in dialog inventory
