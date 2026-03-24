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
  htmlSnapshot: string | null,  // editableArea.innerHTML (WYSIWYG nodes only)
  cursor: {
    mode: 'wysiwyg' | 'markdown',
    start: number,             // markdown: selectionStart / estimated md offset
    end: number,               // markdown: selectionEnd / estimated md offset
    semantic: object | null,   // wysiwyg: captureSemanticSelection() result
    blockChildIndex: number,   // wysiwyg: index of block element in editableArea.childNodes
    innerOffset: number        // wysiwyg: text offset within that block element
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

`_generateSummary(diff)` produces a human-readable, markdown-aware string from the diff ops. Summaries appear in DAG nodes, crumple labels, branch picker items, and V-tree options:

- Mermaid fenced code block created → `"Mermaid diagram created"`
- Fenced code block with language → `"python code block"` (language extracted from fence)
- Line starting with `#` added/changed → `"heading text"` (quoted heading content)
- Admonition insert (`!!!`/`???`/`???+`) → `"note admonition"` (type extracted)
- Blockquote added → `"blockquote added"`
- List items added → `"list items added"`
- Single-line text change → first few words of the changed text
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

**WYSIWYG mode** uses a single `input` listener on `editableArea` that inspects `e.inputType` and `e.data` to decide `immediate` per-event. Word-boundary characters, paragraph inserts, paste, drop, format commands, and deletions all trigger `immediate=true`.

**Markdown mode** uses a two-listener strategy on `markdownArea` because `<textarea>` `input` events do not reliably provide `e.data` across browsers:

1. A `keydown` listener fires first and calls `_scheduleHistoryCapture(true)` for Space, Enter, and punctuation — capturing the completed word before the boundary character is inserted.
2. An `input` listener fires after and calls `_scheduleHistoryCapture(false)` — resetting the 500ms debounce timer for the next typing stretch.

The net behavior is equivalent: regular characters debounce at 500ms, word boundaries flush immediately.

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
| Backspace revert | `_ekh.mdAuto` — before `handleRevertOnBackspace` |
| Code block backspace (selection delete) | `_ekh.codeBlockBackspace` — before removing selected blocks |
| Code block backspace (empty revert) | `_ekh.codeBlockBackspace` — before replacing empty code block |
| Inline Enter/Arrow escape | `_ekh.inlineEnterEscape` — before DOM split |

### Post-Mutation Capture (Programmatic Conversions)

Programmatic DOM mutations that bypass the browser's input pipeline — inline typing auto-replacements, backspace reverts, and keydown-triggered block conversions — call `e.preventDefault()`, which suppresses the browser's `input` event. The history `input` listener never fires for these mutations, so the post-mutation state would never enter the DAG without explicit capture.

After each such mutation completes and `_finalizeUpdate` is called, `_scheduleHistoryCapture(true)` is called to immediately flush the post-mutation state into the DAG.

| Mutation | Location |
|----------|----------|
| Inline code conversion (`` ` ``, ` `` `, ` ``` `, etc.) | `_doInlineCodeConvert` — after `_finalizeUpdate` |
| Block code creation (` ``` ` at line start) | Capture-phase `input` handler — after `_finalizeUpdate` |
| Block conversions on Space keydown | `_ekh.mdAuto` — after `handleBlockConversions` succeeds |
| Backspace revert (all element types) | `_ekh.mdAuto` — after `handleRevertOnBackspace` succeeds |
| Code block backspace (selection delete) | `_ekh.codeBlockBackspace` — after `_finalizeUpdate` |
| Code block backspace (empty revert) | `_ekh.codeBlockBackspace` — after `_finalizeUpdate` |
| Inline typing conversions (bold, italic, strikethrough, links, HR, lists, headings) | Main `input` handler — after `converted && _finalizeUpdate` |

Without these post-mutation captures, the intermediate state between a conversion and its revert is invisible to the DAG. Example: typing `` ``` code ``` `` creates a `<code>` element, pressing Backspace reverts it to text. If the code-element state was never captured, `Cmd+Z` after the revert cannot restore it — the pre-conversion and post-revert markdown are identical, so `_flushHistoryCapture` inside `_contentUndo` sees no change and skips to the wrong ancestor node.

### Always-On HTML Snapshot Strategy

Every history node created in WYSIWYG mode stores `editableArea.innerHTML` as `htmlSnapshot`. This is unconditional — snapshots are captured regardless of whether the markdown round-trip is faithful or lossy.

**Why always-on:** The markdown round-trip (`_markdownToHtml` then `_htmlToMarkdown`) is inherently lossy for many DOM states — literal backtick text the parser reinterprets as fences, enhanced elements with `data-*` attributes, mermaid diagram wrappers, etc. Rather than trying to detect every edge case, always capturing the HTML eliminates all markdown-to-HTML drift during undo/redo restore. The snapshot is the exact DOM the user saw.

**Restore behavior:**

- **WYSIWYG mode**: `_historyApplyContent` sets `editableArea.innerHTML` from the snapshot, then runs all 6 DOM enhancers (idempotent) plus mermaid re-rendering for already-wrapped blocks. This bypasses `_markdownToHtml` entirely, so the restored DOM exactly matches what was captured.
- **Markdown mode**: Always uses the reconstructed markdown from diffs (correct as raw text regardless of HTML fidelity).

**History is never skipped.** The old `_doubleRenderCheck`-based skip (which dropped undo steps entirely) was replaced by always-on snapshots. A lost undo step is a user-visible bug; a snapshot is transparent.

**`_markdownRoundTripFaithful`** (`md → html → md`, compare normalized markdown) remains available. It strips YAML frontmatter before testing (frontmatter is not markdown and causes false negatives). It is used for diagnostic logging but does not gate history capture. The original `_doubleRenderCheck()` (`md → html → md → html`, compare HTML) remains for initial content-load validation but is no longer used for history capture.

### Immediate Post-Restore Sync

After any content restore (HTML snapshot or markdown-to-HTML), the DOM's `getValue()` output may differ slightly from the diff-reconstructed markdown due to enhancer normalization, attribute differences, or whitespace. Without correction, the next `_flushHistoryCapture()` would see this drift as a change, create a spurious node, and break the redo chain.

Both `_contentUndo` and `_contentRedo` sync `_historyLastMd` to `wysiwygEditor.getValue()` immediately after `_historySetContent` returns. Since `_historyApplyContent` runs all enhancers synchronously, `getValue()` is accurate at that point. This absorbs any normalization drift and ensures `_historyLastMd` always matches the actual DOM state. Subsequent user typing will diff correctly against this synced baseline.

This immediate sync replaces a previous deferred mechanism (`_historyJustRestored` flag) that had a race condition: if the user typed new content and pressed Cmd+Shift+Z before the deferred sync fired, the flag would absorb the user's typing as "drift" and allow redo to overwrite it.

## Undo / Redo Flow

### Undo (`Cmd+Z` with content editor focused)

1. If `_historyCurrentId` is the root node, do nothing
2. Flush any pending capture (so current typing is saved as a node first)
3. Get current node's diff, reverse-apply to reconstruct parent's markdown
4. Set editor content via `_historyApplyContent(parentMd, parent.htmlSnapshot)`. If the parent node has an HTML snapshot and the editor is in WYSIWYG mode, the snapshot restores the DOM directly (bypassing markdown parsing). Otherwise, `_markdownToHtml` produces HTML normally. Preprocess stores are always refreshed and DOM enhancers always run per the [Markdown Awareness](DESIGN-markdown-awareness.md) contract. `enhanceMermaidBlocks` re-renders any already-wrapped mermaid blocks whose preview containers are empty (from snapshot restore).
5. Sync `_historyLastMd` to `getValue()` immediately (absorbs normalization drift)
6. Restore cursor from parent node's stored cursor (block-child-first for snapshot nodes)
7. Set `_historyCurrentId = parentId`

### Redo (`Cmd+Shift+Z` / `Cmd+Y` with content editor focused)

1. Flush any pending capture (if the user typed after undo, this creates a new branch — redo stops)
2. If current node has no `activeChildId`, do nothing (covers both "no redo" and "new branch" cases)
3. Get activeChild's diff, apply forward to reconstruct child's markdown
4. Set editor content via `_historyApplyContent`
5. Sync `_historyLastMd` to `getValue()` immediately (absorbs normalization drift)
6. Restore cursor from child node (block-child-first for snapshot nodes)
7. Set `_historyCurrentId = activeChildId`

### New Change After Undo (Branching)

1. User undoes to node B, then starts typing
2. New node F is created as child of B
3. B's `activeChildId` is set to F (redo now follows the new branch)
4. B's old children (C, D, ...) remain in the tree — never discarded
5. B's `children` array becomes `[C, F]` (or `[C, D, F]` etc.)

## Cursor Preservation

### Capture (`_captureHistoryCursor`)

Each node stores cursor at capture time:

- **Markdown mode**: `{ mode: 'markdown', start: selectionStart, end: selectionEnd, semantic: null }`
- **WYSIWYG mode**: `{ mode: 'wysiwyg', start: estimatedMdOffset, end: estimatedMdOffset, semantic: captureSemanticSelection(editableArea), blockChildIndex: N, innerOffset: M }`

The WYSIWYG capture collects three independent cursor representations:

1. **`start`/`end`**: Approximate markdown character offset via `_estimateMdOffsetFromWysiwyg` (text length before cursor). Enables cross-mode cursor placement.
2. **`semantic`**: `captureSemanticSelection(editableArea)` result — block index + CSS class + text offset. Works well for elements with distinctive classes.
3. **`blockChildIndex` + `innerOffset`**: The index of the direct child block element of `editableArea` that contains the cursor, and the cumulative text offset within that block's text nodes. This is the most precise representation — it locates the cursor by structural position rather than semantic class, so it works for classless elements like empty `<p><br></p>` paragraphs.

The `blockChildIndex` is computed by walking `parentNode` from the selection's `startContainer` until reaching a direct child of `editableArea`, then finding that child's index in `childNodes`. The `innerOffset` is computed by walking text nodes within that block via `TreeWalker` and summing lengths until reaching the cursor's text node.

### Restore (`_restoreHistoryCursor`)

On restore (`_restoreHistoryCursor(cursor, diff, mdContent, isRedo)`), the strategy depends on whether the node has an HTML snapshot.

**For HTML snapshot nodes** (most WYSIWYG nodes), a block-child-first strategy is used:

1. **Block-child index** (primary): If `cursor.blockChildIndex` is valid (>= 0, within `editableArea.childNodes` range), locate that block element. Walk its text nodes with `TreeWalker` to place the cursor at `cursor.innerOffset`. If the block has no text nodes (e.g. `<p><br></p>`), place cursor at position 0 of the block. This is the most reliable strategy because it uses structural position, not content matching.
2. **Semantic** (fallback): `restoreSelectionFromSemantic(editableArea, cursor.semantic)`.
3. **Flat text offset** (fallback): `_placeCursorAtMdOffset(cursor.start, null)`.
4. **Last resort**: focus editor at position 0.

**For non-snapshot nodes** (markdown mode nodes, root node):

**Diff-based positioning is preferred.** The cursor is placed at the **end** of the last changed line in the resulting content.

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

## Non-Linear Redo UI (History Mode)

The DAG preserves all redo branches with metadata consumed by History Mode (Layer 4):

**Data at branch points:**
- `node.children` lists all branches (in creation order)
- Each child has `summary` and `timestamp` for branch picker display
- `node.activeChildId` marks the default redo path

**Helper functions (consumed by History Mode UI):**
- `_getHistoryBranchPoints()` — all nodes where `children.length > 1`
- `_getHistoryBranches(nodeId)` — `[{ childId, summary, timestamp, depth }]` for each child
- `_switchHistoryBranch(nodeId, childId)` — changes `activeChildId` for the branch picker
- `_reconstructContentAtNode(nodeId)` — returns full markdown at any node (for preview)
- `_restoreToHistoryNode(nodeId)` — jumps to any node (used by DAG overlay restore)
- `_computeContainerGroups(activePathList)` — identifies consecutive edits within the same markdown container for inline crumple accordion
- `_stripFrontmatterForPreview(md)` — removes YAML frontmatter before preview rendering

**Redo branch detection:** `_contentRedo()` shows the branch picker popup in two cases:
1. After redo at a branch point (`children.length > 1` on the pre-redo node) — popup shows alternative branches.
2. When no redo is available (`!activeChildId`) — popup shows "End of history" with a "Show All Redo History" entry point into History Mode.

This ensures `Cmd+Shift+Z` always provides access to History Mode, even when the user is at the latest node.

**Container group detection:** `_computeContainerGroups` analyzes consecutive active-path nodes to identify runs of edits within the same markdown structure (fenced code block, admonition, blockquote, list). Groups are collapsed into inline crumple accordion icons in the DAG visualization. See [DESIGN-history-mode.md](DESIGN-history-mode.md) § Container Group Detection.

For the full History Mode UI architecture (branch picker, DAG overlay, full-size preview, inline crumple accordion, V-tree forks), see [DESIGN-history-mode.md](DESIGN-history-mode.md).

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

3. **Mermaid blocks re-render** when restoring from HTML snapshots. `enhanceMermaidBlocks` detects already-wrapped `.md-mermaid-block` elements with empty `.md-mermaid-preview` containers (the asynchronous SVG rendering is lost during `innerHTML` assignment) and re-triggers the mermaid rendering pipeline. Expand button handlers are also re-attached.

The always-on HTML snapshot strategy (Rule 6) ensures that undo/redo always produces the exact DOM the user saw — the snapshot bypasses `_markdownToHtml` entirely in WYSIWYG mode. DOM enhancers still run after snapshot restore because they are idempotent and handle cases where the snapshot's interactive elements need re-initialization (mermaid previews, event handlers). See [DESIGN-markdown-awareness.md](DESIGN-markdown-awareness.md) for the full content-loading contract.

## Rules

1. **Always flush before mode switch.** `_flushHistoryCapture()` must be called before `switchToMode` begins conversion. Failing to flush loses the pre-switch typing.

2. **Always flush before nav edit entry.** `_flushHistoryCapture()` must be called at the top of `_enterNavEditMode`. The DAG persists in memory across nav edit transitions.

3. **Never clear the DAG on nav edit exit.** The DAG is a JS array unaffected by DOM transitions. `_exitNavEditMode` must not touch `_historyNodes` or `_historyCurrentId`.

4. **Never clear the DAG on save.** Only clear on page navigation (`_loadContent` with new document).

5. **Cmd+Z in content editor always dispatches to content undo.** When `_hasEditFocus` is true, `Cmd+Z` must be `preventDefault`'d and routed to `_contentUndo()`. Browser native undo must never fire.

6. **Always capture HTML snapshots in WYSIWYG mode.** `_createHistoryNode` must unconditionally store `editableArea.innerHTML` as `htmlSnapshot` when the editor is in WYSIWYG mode. This eliminates all markdown-to-HTML drift during undo/redo — the snapshot is the exact DOM the user saw. On restore in WYSIWYG mode, `_historyApplyContent` uses the snapshot (bypassing `_markdownToHtml`). On restore in markdown mode, the reconstructed markdown from diffs is used. Never gate snapshot capture on `_markdownRoundTripFaithful()` or any other fidelity check — always capture. A skipped snapshot is a potential undo corruption bug.

7. **Undo/redo must be markdown-aware.** The undo system is built on markdown diffs, but it must respect the reality that some DOM states don't survive a markdown round-trip (literal markdown syntax as text, enhanced elements with attributes, etc.). `_historyApplyContent` must fulfill the [Markdown Awareness](DESIGN-markdown-awareness.md) content-loading contract: refresh all 7 preprocess stores and run all 6 DOM enhancers after restoring content. The always-on HTML snapshot (Rule 6) bypasses the markdown parser to restore the actual DOM in WYSIWYG mode, eliminating round-trip fidelity concerns. The undo system must never produce a DOM state that differs from what the user saw when the state was captured.

8. **Diffs are line-level, not character-level.** The unit of change is a line. Word-boundary grouping is achieved by controlling *when* captures happen (debounce timing), not by storing character-level diffs.

9. **Root node always stores full content.** `_historyRootMd` is the single source of truth for reconstructing any node's content by walking diffs from root.

10. **`activeChildId` determines default redo.** `Cmd+Shift+Z` always follows `activeChildId`. A future branch picker can change this via `_switchHistoryBranch`.

11. **Never discard redo branches.** Old children remain in the `children` array when new branches are created. Only pruning (lifecycle cap) removes nodes, and it only removes leaves not on the current path.

12. **Mermaid edits use direct DAG node creation.** `_applyCodeAndTeardown` flushes pending captures, replaces the mermaid fenced code block at the markdown level, and creates a DAG node directly — bypassing the standard `_createHistoryNode` path. This is safe because the edit is a known-good string replacement inside a fenced code block (always round-trip faithful). `_historySetContent` applies the new markdown via the full content-loading contract. See [DESIGN-mermaid-mode.md](../../mermaid/DESIGN-mermaid-mode.md) § Undo-Redo DAG Integration.

13. **Programmatic DOM mutations must bracket with flush and capture.** Any code path that modifies the editor DOM programmatically (bypassing the browser's input pipeline) must call `_flushHistoryCapture()` **before** the mutation and `_scheduleHistoryCapture(true)` **after** `_finalizeUpdate`. This ensures the pre-mutation state is snapshotted and the post-mutation state is immediately captured. Without both calls, the DAG has a gap: the intermediate state is invisible to undo/redo. This applies to inline typing auto-replacements (backtick → `<code>`, `**` → `<strong>`, etc.), backspace reverts, code block backspace (selection delete and empty revert), and any future handler that calls `e.preventDefault()` and manipulates the DOM directly. If the pre-mutation flush finds that `_historyLastMd` already matches the current content (because the debounced input listener recently captured it), the flush is a no-op — this is intentional and harmless.

14. **Conversions with default content are atomic undo steps.** When a block conversion produces an element that includes default content — mermaid diagrams with the stateDiagram template, code blocks with language-specific stubs, admonitions with default titles, etc. — the replacement element and its default content must be captured as a single unified DAG node. A user pressing `Cmd+Z` must undo the entire conversion in one step, never landing on an intermediate state where the element exists but the default content is missing (e.g. an empty `` ```mermaid\n``` `` block).

15. **Block conversions must pre-flush with HTML snapshot safety.** The Space-keydown handler for `handleBlockConversions` calls `_flushHistoryCapture()` before the conversion to capture the pre-conversion typing state (e.g. `` ```mermaid ``, `## `, `> ``). The pre-conversion text is markdown syntax that the parser would reinterpret on round-trip (`` ```mermaid `` becomes a code fence), so `_markdownRoundTripFaithful` detects lossiness and stores an HTML snapshot. Undo from the converted element first reaches this snapshot node (restoring the literal typing text in the DOM) before reaching earlier states. The HTML snapshot fallback (Rule 6) makes this pre-flush safe: the snapshot preserves the exact DOM regardless of markdown round-trip fidelity.

16. **The DAG is mode-agnostic: undo/redo feature parity between WYSIWYG and markdown is mandatory.** Every DAG node stores a line-level markdown diff regardless of which mode created it. A node created during WYSIWYG editing must be undoable and redoable from markdown mode, and vice versa. `_contentUndo` and `_contentRedo` must not branch on the current mode when reconstructing content — they apply the same diff math and call `_historyApplyContent`, which renders in whichever mode is active. Only cursor restoration is mode-aware (`_restoreHistoryCursor` checks `cursor.mode` vs `currentMode`). When adding any new capture point, programmatic mutation handler, or undo/redo behavior, verify it works correctly when the user switches modes between the original edit and the undo/redo invocation.

17. **Markdown mode must have the same debounce and word-boundary capture behavior as WYSIWYG mode.** Both modes use the same `_scheduleHistoryCapture` / `_flushHistoryCapture` functions and the same 500ms debounce constant. The markdown textarea uses a two-listener strategy (`keydown` for immediate word-boundary flush, `input` for debounced regular-character capture) because `<textarea>` `input` events do not reliably provide `e.data`. Any change to capture timing or word-boundary detection must be applied to both modes.

18. **Immediate post-restore sync eliminates drift.** Both `_contentUndo` and `_contentRedo` must sync `_historyLastMd = wysiwygEditor.getValue()` immediately after `_historySetContent` returns. Since `_historyApplyContent` runs all enhancers synchronously, `getValue()` is accurate. This absorbs normalization drift (enhancer output, attribute differences, whitespace) so subsequent `_flushHistoryCapture()` calls only detect actual user edits. Do not use a deferred flag-based mechanism — a flag that defers sync to the next flush creates a race condition where user typing between the restore and the first flush is absorbed as "drift" and lost on redo.

19. **Block-child cursor is the primary restore strategy for HTML snapshot nodes.** When restoring cursor position from a node that has an `htmlSnapshot`, `_restoreHistoryCursor` must first try the `blockChildIndex` + `innerOffset` strategy before falling back to semantic or flat text offset. The block-child strategy locates the cursor by the structural index of the block element within `editableArea.childNodes` and the cumulative text offset within that block — this works for classless elements (empty paragraphs, plain text nodes) where semantic class matching fails. The fallback chain is: block-child index → semantic → flat text offset → position 0.

20. **Cursor capture must record block-child position.** `_captureHistoryCursor` must always compute `blockChildIndex` and `innerOffset` for WYSIWYG mode cursors. The block-child index is found by walking `parentNode` from `sel.getRangeAt(0).startContainer` to the direct child of `editableArea`. The inner offset is the cumulative text length from the start of that block element to the cursor position, computed via `TreeWalker(SHOW_TEXT)`. Both fields must be stored on the cursor object alongside `start`, `end`, and `semantic`.

21. **Mermaid diagrams must re-render on snapshot restore.** When `_historyApplyContent` restores an HTML snapshot containing already-wrapped mermaid blocks (`.md-mermaid-block`), the inline SVG in `.md-mermaid-preview` is empty (the snapshot captures the wrapper structure but mermaid rendering is asynchronous). `enhanceMermaidBlocks` must detect these empty-preview blocks, extract the source code from the hidden `<pre>` element, and re-trigger `_renderMermaidPreview`. It must also re-attach the expand button click handler (`__mermaidHandlerAttached` flag), which is lost during `innerHTML` restoration. Without this, mermaid diagrams appear as blank boxes after undo/redo.

22. **Synchronous cursor placement for mermaid diagram creation.** When `doCodeBlock` creates a mermaid diagram, the trailing `<p><br></p>` and cursor placement into that paragraph must be synchronous (not deferred via `requestAnimationFrame`). History capture runs immediately after `_finalizeUpdate`, and the cursor must already be in the trailing paragraph at capture time so that `_captureHistoryCursor` records the correct `blockChildIndex` and `innerOffset`. Asynchronous cursor placement causes the history node to capture the cursor at the wrong position (typically in the paragraph above the diagram), which breaks cursor restore on undo/redo.

23. **`_markdownRoundTripFaithful` must strip frontmatter.** The fidelity check must parse and strip YAML frontmatter before performing the `md → html → md` comparison. Frontmatter (e.g., `title: Home`) is not markdown content and the markdown parser will reinterpret it as headings or other constructs, causing false `NOT faithful` results on every capture. Use `parseFrontmatter()` to extract the body, and test only the body. Return `true` for empty/whitespace-only bodies.

24. **Redo must flush pending captures to respect new branches.** `_contentRedo()` must call `_flushHistoryCapture()` before checking `activeChildId`. If the user typed new content after undoing, the flush creates a new node (new branch from the current position), updating `_historyCurrentId` to the new node. The new node has no children, so `activeChildId` is null and redo correctly does nothing. Without this flush, redo follows the stale `activeChildId` of the pre-branch parent node and overwrites the user's new content. This is symmetric with `_contentUndo()`, which already flushes at the top.
