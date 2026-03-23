# Unified Content Undo — Design Document

## Overview

The WYSIWYG editor uses a DAG-based undo/redo system for document content. All changes in both WYSIWYG and markdown modes are tracked as line-level markdown diffs. The DAG never discards redo branches, enabling future non-linear branch navigation. The system is independent of the nav snapshot undo system and survives nav edit mode transitions.

All code lives in `live-wysiwyg-integration.js`.

## Problem

Browser native undo (`document.execCommand('undo')` / textarea undo) is mode-specific:

- **WYSIWYG mode**: the contenteditable undo stack tracks DOM mutations. Mode switches, `innerHTML` assignments, and DOM reparenting during nav edit transitions destroy the stack.
- **Markdown mode**: the textarea undo stack tracks text changes. Switching to WYSIWYG mode replaces the textarea content programmatically, which either clears or corrupts the stack.

After any mode switch or nav edit transition, `Cmd+Z` does nothing. The user loses their entire editing history. Browser-specific behavior of `execCommand('undo')` and contenteditable undo stacks is documented in [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md).

## Architecture

### DAG Data Structure

Content history is a directed acyclic graph (tree) where each node represents a document state. The root node stores the full markdown content; all other nodes store a line-level diff from their parent.

```
Global variables:
  _historyNodes = {}        // id → node (flat map for O(1) lookup)
  _historyCurrentId = null  // id of the current position in the DAG
  _historyRootMd = null     // full markdown at the root node
  _historyNextId = 0        // auto-incrementing node ID
  _historyTimer = null      // debounce timer for capture scheduling
  _historyLastMd = null     // markdown at _historyCurrentId (cached for fast diff)
```

### Node Format

```
{
  id: number,
  parentId: number | null,
  children: number[],        // ordered by creation time (oldest first)
  activeChildId: number | null,  // which child Cmd+Shift+Z follows
  diff: { ops: [...] } | null,  // null for root node only
  cursor: {
    mode: 'wysiwyg' | 'markdown',
    start: number,             // markdown: selectionStart
    end: number,               // markdown: selectionEnd
    semantic: object | null    // wysiwyg: captureSemanticSelection() result
  },
  timestamp: number,
  summary: string | null       // auto-generated human-readable change description
}
```

### Diff Format

Each diff contains an array of line-level operations:

```
{
  ops: [
    { type: 'replace', line: 5, count: 2, old: ['...', '...'], new: ['...'] },
    { type: 'insert', afterLine: 10, lines: ['...', '...'] },
    { type: 'delete', line: 15, count: 1, old: ['...'] }
  ]
}
```

- `replace`: lines `line` through `line + count - 1` are replaced with `new` lines
- `insert`: new lines are inserted after `afterLine` (0 = before first line)
- `delete`: `count` lines starting at `line` are removed; `old` stores them for undo

**Undo**: reverse each op (replace swaps old/new, insert → delete, delete → insert), applied in reverse order.

**Redo**: apply ops in forward order.

### Summary Generation

`_generateSummary(diff)` produces a human-readable string from the diff ops:

- Single-line text change → `"edited line N"`
- Multi-line insert between ``` delimiters → `"inserted code block"`
- Line starting with `#` added/changed → `"changed heading"`
- Admonition insert (`!!!`/`???`/`???+`) → `"inserted admonition"`
- List items added → `"added list items"`
- Fallback → `"edited N lines"`

## Markdown-Aware Construct Grouping

When computing a diff, multi-line markdown constructs that were inserted or deleted as a whole unit are grouped into a single op:

- **Code blocks**: lines between matching ` ``` ` delimiters
- **Admonitions**: `!!!`/`???`/`???+` line plus indented body lines
- **Blockquotes**: consecutive `> ` prefixed lines
- **Lists**: consecutive list items at the same or deeper indent level
- **Horizontal rules**: `---`, `***`, `___`

Grouping only applies when an entire construct appears or disappears in one diff. If the user edits a single line within a construct (e.g., changes code inside a code block), the diff contains only the changed lines — the construct is not grouped.

## Capture Points and Timing

### Debounced Capture (Typing)

`_scheduleHistoryCapture()` is called on every `input` event from both `editableArea` and `markdownArea`.

- **Regular characters**: reset a 500ms debounce timer
- **Word boundaries** (space, punctuation, Enter): flush immediately (captures the completed word/line), then start a new debounce window
- **Timer expiry**: capture snapshot

### Immediate Flush

`_flushHistoryCapture()` is called before any transition that could affect content or mode:

| Trigger | Location |
|---------|----------|
| Mode switch | `proto.switchToMode` in `patchSetValueAndGetValueForFrontmatter` |
| Nav edit mode entry | `_enterNavEditMode` |
| Mermaid mode exit (before direct DAG node) | `_applyCodeAndTeardown` in `_exitMermaidModeAsync` |
| Paste | `ea.addEventListener('paste', ...)` handlers |
| Toolbar format commands | `_handleToolbarClick`, `_insertCodeBlock`, `_wrapSelectionInBlockquote`, etc. |
| Nav menu drag-and-drop | `ea.addEventListener('drop', ...)` handler |

### Corruption Guard

Before creating a diff node, the current markdown is passed through `_doubleRenderCheck()` (md → html → md → html, compare normalized HTML). If the check fails:

1. Log `console.log('[UNDO] history capture skipped: double-render corruption detected')`
2. Skip this capture entirely
3. The content will be captured at the next successful checkpoint

This prevents storing diffs that would produce corrupted content on undo/redo restore.

## Undo / Redo Flow

### Undo (`Cmd+Z` with content editor focused)

1. If `_historyCurrentId` is the root node, do nothing
2. Flush any pending capture (so current typing is saved as a node first)
3. Get current node's diff, reverse-apply to reconstruct parent's markdown
4. Set editor content via `_historyApplyContent()` (works in whichever mode is active). This refreshes all preprocess data stores and runs DOM enhancers per the [Markdown Awareness](DESIGN-markdown-awareness.md) contract.
5. Restore cursor from parent node's stored cursor
6. Set `_historyCurrentId = parentId`, update `_historyLastMd` cache

### Redo (`Cmd+Shift+Z` / `Cmd+Y` with content editor focused)

1. If current node has no `activeChildId`, do nothing
2. Get activeChild's diff, apply forward to reconstruct child's markdown
3. Set editor content, restore cursor from child node
4. Set `_historyCurrentId = activeChildId`, update `_historyLastMd` cache

### New Change After Undo (Branching)

1. User undoes to node B, then starts typing
2. New node F is created as child of B
3. B's `activeChildId` is set to F (redo now follows the new branch)
4. B's old children (C, D, ...) remain in the tree — never discarded
5. B's `children` array becomes `[C, F]` (or `[C, D, F]` etc.)

## Cursor Preservation

Each node stores cursor at capture time:

- **Markdown mode**: `{ mode: 'markdown', start: selectionStart, end: selectionEnd, semantic: null }`
- **WYSIWYG mode**: `{ mode: 'wysiwyg', start: estimatedMdOffset, end: estimatedMdOffset, semantic: captureSemanticSelection(editableArea) }`

The WYSIWYG capture estimates a markdown character offset via `_estimateMdOffsetFromWysiwyg`, which counts the text length before the cursor in the editable area. This offset is approximate but enables meaningful cross-mode cursor placement.

On restore (`_restoreHistoryCursor(cursor, diff, mdContent, isRedo)`):

**Diff-based positioning is always preferred.** The cursor is placed at the **end** of the last changed line in the resulting content, so the user can immediately continue typing. This applies to both undo and redo, in both WYSIWYG and markdown modes.

1. **Diff available**: `_diffToMdOffset` computes the end-of-change-region offset. For **redo**, it tracks cumulative line shifts across all diff ops to find the end of the last inserted/replaced region in the child content. For **undo**, it finds the end of the last restored region in the parent content (replace/delete → end of old lines; insert → line before insertion point).
2. **Same mode, markdown** (fallback): `setSelectionRange(start, end)` using stored offsets.
3. **Same mode, WYSIWYG** (fallback): `restoreSelectionFromSemantic(editableArea, cursor.semantic)`.
4. **Stored offset** (fallback): uses `cursor.start` with `_placeCursorAtMdOffset`.
5. **Last resort**: focuses the editor at position 0.

`_placeCursorAtMdOffset` translates a markdown character offset to the appropriate cursor position for the current mode — directly for markdown (`setSelectionRange`), or by walking WYSIWYG block elements to find the corresponding block and placing the cursor at the end of that block's text.

## Keyboard Integration

Undo/redo is intercepted at two levels to ensure cross-browser compatibility:

### `beforeinput` listener (WYSIWYG mode — primary for Safari)

A `beforeinput` listener on the editable area intercepts `inputType === 'historyUndo'` and `inputType === 'historyRedo'`. This fires **before** the browser applies the native contenteditable undo/redo action, which is critical for Safari where the native undo executes before the `keydown` event fires. The listener calls `e.preventDefault()` and dispatches to `_contentUndo()` / `_contentRedo()`. A flag (`_undoViaBeforeinput`) prevents the subsequent `keydown` handler from double-dispatching.

### `keydown` handler (Tier 2 — all modes)

In `_globalKeydownRouter`, all `Cmd+Z` / `Cmd+Shift+Z` / `Cmd+Y` handling is unified in a single dispatch block that runs regardless of `_navEditMode` state. If the `beforeinput` listener already handled the event, the `keydown` handler skips dispatch and only calls `preventDefault()` + `stopImmediatePropagation()`.

1. **Content focus** (`TEXTAREA`, `INPUT`, or `contentEditable`): always dispatches to `_contentUndo()` / `_contentRedo()`. This works in both nav edit mode and normal mode, and is not gated by `dialogOpen` (so it works even when a link edit dialog is open).
2. **No content focus, no dialog open**: dispatches to `_navUndo()` / `_navRedo()` for nav snapshot undo.

The `keydown` handler remains necessary for markdown mode (textarea does not fire `beforeinput` with `historyUndo`) and as a fallback for browsers that do not support `beforeinput` input types.

## Persistence

The content undo DAG is persisted to `sessionStorage` under the key `live_wysiwyg_undo_dag`. This ensures undo/redo history survives page reloads (e.g., after a nav menu save). See [DESIGN-application-storage.md](../backend/DESIGN-application-storage.md) § sessionStorage Keys.

### Serialization Format

```
{
  srcPath: "docs/page.md",      // current document path (for validation)
  nodes: { ... },               // _historyNodes map
  currentId: 5,                 // _historyCurrentId
  rootMd: "# Title\n...",       // _historyRootMd (full root content)
  nextId: 12,                   // _historyNextId (auto-increment counter)
  lastMd: "# Title\n..."        // _historyLastMd (cached current content)
}
```

### Persist (`_persistContentHistory`)

Serializes the DAG state to `sessionStorage`. Called by `_autoSaveAndPersistHistory()` on every DAG mutation and by `_navigateAfterBatchComplete()` before page reload.

### Restore (`_restoreContentHistory`)

Restores the DAG from `sessionStorage`. Called during `enterFocusMode` after content backup restoration. Validates that the stored `srcPath` matches the current page. If the editor content has changed since persistence (e.g., server returned newer content), `_historyLastMd` is updated to match. Returns `true` on success.

### Relationship to Content Auto-Save

DAG persistence, disk auto-save, and DAG node creation are unified in a single pipeline. When a DAG node is created (via `_createHistoryNode`) or the user triggers undo/redo, `_autoSaveAndPersistHistory()` is called, which bundles:

1. `_persistContentHistory()` — DAG → `sessionStorage` (synchronous)
2. `_doFocusSaveBackground()` — content → disk (asynchronous, only if dirty)

No separate timers are used for auto-save or DAG persistence. They reuse the existing `_scheduleHistoryCapture` / `_flushHistoryCapture` debounce. See [DESIGN-uninterrupted-content-save.md](DESIGN-uninterrupted-content-save.md).

## Lifecycle

- **Initialization**: when `replaceTextareaWithWysiwyg` creates the editor, a root node is created with the initial markdown content. `_historyRootMd = initialValue`.
- **Focus mode entry**: `_restoreContentHistory()` is called after content backup restoration. If a persisted DAG exists for the current page, it replaces the freshly initialized DAG.
- **Page navigation**: `_loadContent()` resets the entire DAG (new root with loaded content). All previous history is discarded.
- **Auto-save**: every DAG mutation triggers `_autoSaveAndPersistHistory()`, which persists the DAG to `sessionStorage` and auto-saves dirty content to disk.
- **Pruning**: when total node count exceeds ~200, oldest leaf branches are pruned (nodes with no children that are not on the current path from root to `_historyCurrentId`).
- **Nav save reload**: `_navigateAfterBatchComplete` flushes pending captures and persists the DAG before the reload. `enterFocusMode` restores it afterwards.

## Extensibility for Non-Linear Redo

The DAG preserves all redo branches with metadata needed for a future branch navigation UI:

**Data at branch points:**
- `node.children` lists all branches (in creation order)
- Each child has `summary` and `timestamp` for branch picker display
- `node.activeChildId` marks the default redo path

**Helper functions (built now, consumed by future UI):**
- `_getHistoryBranchPoints()` — all nodes where `children.length > 1`
- `_getHistoryBranches(nodeId)` — `[{ childId, summary, timestamp, depth }]` for each child
- `_switchHistoryBranch(nodeId, childId)` — changes `activeChildId` for a future branch picker
- `_reconstructContentAtNode(nodeId)` — returns full markdown at any node (for preview)

## Relationship to Nav Snapshot Undo

Content undo and nav snapshot undo are completely independent:

| | Content Undo (this system) | Nav Snapshot Undo |
|---|---|---|
| **Tracks** | Document text changes | navData state (selections, moves, weights) |
| **Storage** | `_historyNodes` DAG | `_navSnapshots` array |
| **Dispatch** | `Cmd+Z` when content editor has focus (any mode, including nav edit) | `Cmd+Z` when no content focus and no dialog open |
| **Survives nav edit** | Yes (JS array in memory) | N/A (is the nav edit system) |

They never conflict: dispatch is determined solely by whether the active element is a content editor (`TEXTAREA`, `INPUT`, or `contentEditable`). Content focus always wins, regardless of `_navEditMode` state.

## Relationship to Content Auto-Save

The DAG's capture pipeline drives content auto-saving. See [DESIGN-uninterrupted-content-save.md](DESIGN-uninterrupted-content-save.md) for the full auto-save architecture. The DAG is persisted to `sessionStorage` — see [DESIGN-application-storage.md](../backend/DESIGN-application-storage.md) § sessionStorage Keys.

## Relationship to Markdown Awareness

`_historyApplyContent` must fulfill the [Markdown Awareness](DESIGN-markdown-awareness.md) content-loading contract. After restoring content:

1. **Preprocess stores are refreshed** from the restored markdown (`extractRefDefsFromCommentBlocks` then all 6 explicit preprocessors). This ensures subsequent `getValue()` calls use postprocessors that match the current content, preserving advanced code block fences, list markers, and other formatting.

2. **DOM enhancers run** in WYSIWYG mode (`populateRawHtmlBlocks`, `enhanceCodeBlocks`, `enhanceBasicPreBlocks`, `enhanceChecklists`, `enhanceAdmonitions`, `enhanceImages`). This ensures code blocks have their `.md-code-block` wrappers, title bars, and line number gutters after undo/redo — matching the same enhanced DOM that `setValue` and `switchToMode` produce.

The double render check (`_doubleRenderCheck`) is the corruption guard that prevents the Markdown Awareness round-trip from storing corrupted diffs. See [DESIGN-markdown-awareness.md](DESIGN-markdown-awareness.md) for the full contract.

## Rules

1. **Always flush before mode switch.** `_flushHistoryCapture()` must be called before `switchToMode` begins conversion. Failing to flush loses the pre-switch typing.

2. **Always flush before nav edit entry.** `_flushHistoryCapture()` must be called at the top of `_enterNavEditMode`. The DAG persists in memory across nav edit transitions.

3. **Never clear the DAG on nav edit exit.** The DAG is a JS array unaffected by DOM transitions. `_exitNavEditMode` must not touch `_historyNodes` or `_historyCurrentId`.

4. **Never clear the DAG on save.** Only clear on page navigation (`_loadContent` with new document).

5. **Cmd+Z in content editor always dispatches to content undo.** When `_hasEditFocus` is true, `Cmd+Z` must be `preventDefault`'d and routed to `_contentUndo()`. Browser native undo must never fire.

6. **Skip capture on corruption.** If `_doubleRenderCheck()` fails, skip the capture and log. Do not store a diff that could produce corrupted content on restore.

7. **Diffs are line-level, not character-level.** The unit of change is a line. Word-boundary grouping is achieved by controlling *when* captures happen (debounce timing), not by storing character-level diffs.

8. **Root node always stores full content.** `_historyRootMd` is the single source of truth for reconstructing any node's content by walking diffs from root.

9. **`activeChildId` determines default redo.** `Cmd+Shift+Z` always follows `activeChildId`. A future branch picker can change this via `_switchHistoryBranch`.

10. **Never discard redo branches.** Old children remain in the `children` array when new branches are created. Only pruning (lifecycle cap) removes nodes, and it only removes leaves not on the current path.

11. **Mermaid edits use direct DAG node creation.** `_applyCodeAndTeardown` flushes pending captures, replaces the mermaid fenced code block at the markdown level, and creates a DAG node directly — bypassing `_doubleRenderCheck`. This is safe because the edit is a known-good string replacement inside a fenced code block. `_historySetContent` applies the new markdown via the full content-loading contract. See [DESIGN-mermaid-mode.md](../../mermaid/DESIGN-mermaid-mode.md) § Undo-Redo DAG Integration.
