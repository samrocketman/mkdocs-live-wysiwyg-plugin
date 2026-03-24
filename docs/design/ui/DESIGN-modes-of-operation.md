# Modes of Operation — Design Document

## Overview

The WYSIWYG editor operates in multiple modes. Each mode defines a distinct editing context, UI surface, and user interaction model.

| Mode | Description |
|---|---|
| **Readonly** | Default page load state. Content is rendered as static HTML. No editing surfaces active. |
| **Unfocused** | WYSIWYG editor rendered inline on the readonly page with the live-edit controls bar overlay. |
| **Focus** | Fullscreen overlay emulating the Material theme layout with nav sidebar, content area, and TOC. |
| **Mermaid** | Full-screen diagram editor for mermaid code blocks. Overlays Focus Mode with iframe embedding vendored mermaid-live-editor. |
| **History** | Document history DAG visualization with branch picker, full-screen overlay, and readonly preview. Overlays Focus Mode. See [DESIGN-history-mode.md](DESIGN-history-mode.md). |
| **Help** | Layer 5 informational overlay displaying context-sensitive keyboard shortcut reference. See [DESIGN-help-system.md](DESIGN-help-system.md). |

Planned future modes include Theme Mode.

## Mode Lifecycle

### Transitions and Triggers

| From | To | Trigger |
|---|---|---|
| Readonly | Unfocused | Edit button (accesskey e) or period (`.`) shortcut |
| Unfocused | Focus | Focus Mode toolbar button or browser fullscreen |
| Focus | Unfocused | X button or Escape key |
| Focus | Mermaid | Expand button on `.md-mermaid-block` |
| Mermaid | Focus | Close button, ESC, or Ctrl+S |
| Focus | History | "Document History" button in branch picker popup |
| History | Focus | Close button, ESC, backdrop click, or content restoration |
| Any | Help | Ctrl+? or help icon |
| Help | Previous | ESC, Enter, backdrop click, Ctrl+? |
| Unfocused | Readonly | Cancel button |

### Transition Diagram

```
                    ┌─────────────────────────────────────────┐
                    │                                         │
                    │  Edit button / period (.) shortcut        │
                    │                                         │
                    ▼                                         │
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│   Readonly   │────────▶│  Unfocused   │────────▶│    Focus     │
│              │         │              │         │              │
│  No editing  │         │  Inline      │         │  Fullscreen  │
│  surfaces    │         │  editor +    │         │  overlay     │
│              │         │  controls bar│         │              │
└──────────────┘         └──────────────┘         └──────────────┘
        ▲                         │                         │
        │                         │                         │
        │                         │  X button / Escape      │
        │                         │◀────────────────────────┘
        │                         │
        │                         │  Cancel button
        └─────────────────────────┘
```

## Cross-Mode Contracts

### Cursor Preservation

Every mode transition that affects the editing surface must preserve cursor position and text selection. The capture/restore pattern applies:

- **Readonly to Unfocused**: `storeSelectionIfReadMode` captures selection during `selectionchange`; `readonly_to_edit_mode_text_selection` applies it after the editor initializes.
- **Unfocused to Focus**: `_captureEditorSelection` before reparenting; `_restoreEditorSelection` after overlay is built.
- **Focus to Unfocused**: Same capture/restore on exit.
- **Unfocused to Readonly**: Cursor is discarded (user explicitly cancels editing).

### Contenteditable State

| Mode | Contenteditable | Notes |
|---|---|---|
| Readonly | N/A | No editable area |
| Unfocused | `true` on `.md-editable-area` | WYSIWYG mode; textarea in markdown mode |
| Focus | Same as Unfocused | Editor wrapper reparented, not recreated |

Browser fullscreen and contenteditable behavior vary across browsers. See [DESIGN-browser-compatibility.md](DESIGN-browser-compatibility.md) for cross-browser considerations.

### Overlay Management

| Mode | Overlay |
|---|---|
| Readonly | None |
| Unfocused | Controls bar (`.live-edit-controls`) from upstream live-edit-plugin |
| Focus | Fullscreen overlay (`.live-wysiwyg-focus-overlay`) |
| Mermaid | Fullscreen overlay (`.live-wysiwyg-mermaid-overlay`, z-index 99995) |
| History | Modal overlay (`.live-wysiwyg-history-overlay`, z-index 99995) |
| Help | Modal overlay (`.live-wysiwyg-help-overlay`, z-index 100003) |

## Mode Hierarchy

### Layered Stack Model

Modes form a layered stack. Only one mode is active at a time. When a higher-layer mode activates, all lower layers are suppressed. When the higher mode exits, the lower mode resumes.

```
Layer 5:  Help Mode         (informational overlay, z-index 100003; exclusively reserved)
Layer 4:  History Mode      (document history DAG + preview, z-index 99995)
Layer 3:  Mermaid Mode      (full-screen diagram editor, z-index 99995)
Layer 2:  Focus Mode        (fullscreen overlay, own scroll, own shortcuts)
Layer 1:  Unfocused Mode    (inline editor, controls bar, page scroll)
Layer 0:  Readonly Mode     (static HTML, page scroll, no editing)

Future:
Layer 4+: Theme Mode (override Focus or peer with Focus)
```

| Layer | Mode | Entry | Exit | Z-index |
|---|---|---|---|---|
| 0 | Readonly | — | — | — |
| 1 | Unfocused | Edit button / period shortcut | Cancel button | — |
| 2 | Focus | Focus Mode toolbar / fullscreen | X button / Escape | 99990 |
| 3 | Mermaid | Expand button on mermaid code block (from Focus Mode only) | Close button, ESC, Ctrl+S | 99995 |
| 4 | History | "Document History" button in branch picker popup | ESC, close button, backdrop click, content restore | 99995 |
| 5 | Help | Ctrl+? or help icon (from any mode) | ESC, Enter, backdrop click, Ctrl+? | 100003 |

### Disk I/O Authority by Layer

| Layer | Disk I/O Pathway |
|---|---|
| 0 (Readonly) | None |
| 1 (Unfocused) | Upstream live-edit-plugin Save button (direct WebSocket) |
| 2 (Focus) | Declarative Save Planner exclusively (`_runBatchOps`) |
| 3 (Mermaid) | None (all changes in-memory; persisted when Focus Mode saves) |
| 4 (History) | None (read-only inspection; restoration modifies in-memory DAG only) |
| 5 (Help) | None |

In Focus Mode and above, no code path may perform disk writes outside the batch executor pipeline. This is enforced architecturally: all disk-writing functions (`_wsSetContents`, `_wsNewFile`, `_wsDeleteFile`, mutating `_apiPost`) are called only from `_execute*Op` functions dispatched by `_dispatchSingleOp` within `_runBatchOps`. See DESIGN-declarative-save-planner.md Invariant 10.

### Suppression Contract

When Layer N is active, all layers < N must have:

| Aspect | Suppression |
|---|---|
| **Scroll** | No scroll containers from lower layers respond to user input. `overflow: hidden` on body/documentElement. `overscroll-behavior: contain` on the active layer's scroll container. |
| **Keyboard shortcuts** | Lower-layer keyboard handlers must early-return or not fire. Handlers registered on `document` must guard with the active mode check. |
| **Event handlers** | Permanent document-level handlers from lower layers must check `isFocusModeActive` (or equivalent) and return early. |
| **UI** | Lower-layer overlays and controls are behind the higher layer's z-index. Not interactive. |

### Layer-Level Mutual Exclusion (Cardinal Rule #9)

Editor modes at the same layer are mutually exclusive. Within each layer of the mode hierarchy (Layers 0–5), only one editor mode may be active at a time. Mutually exclusive modes at the same layer share a single z-index value, since they can never coexist. Entry into one mode at a layer must be blocked while another mode at that layer is active.

This principle applies exclusively to editor modes — not to non-modal UI elements such as dropdowns, toasts, popups, or progress bars, which have their own z-index assignments independent of the mode hierarchy.

**Current z-index sharing:**

| Z-index | Modes | Relationship |
|---|---|---|
| 99995 | Mermaid (Layer 3), History (Layer 4) | Mutually exclusive — both overlay Focus Mode |
| 100003 | Help (Layer 5) | Exclusively reserved — overlays all other modes |

**Guard implementation:**

- `_enterHistoryMode()`: returns early if `_mermaidModeActive`.
- `enterMermaidMode()`: returns early if `_historyModeActive`.
- `exitFocusMode()`: exits both History and Mermaid modes before tearing down Focus Mode.
- Future modes at Layer 3 or 4 must add analogous guards against all other modes at their layer.

**Layer 5 reservation:** Layer 5 is exclusively reserved for Help Mode. Help documentation must be capable of overlaying every other editor mode.

### Audit Findings

The following permanent document-level handlers were identified as leaking into focus mode and required guards:

| Handler | Event | Target | Fix |
|---|---|---|---|
| Read-mode selection capture | `selectionchange` | `document` | `if (isFocusModeActive) return;` |
| Read-mode mousedown capture | `mousedown` (capture) | `document` | `if (isFocusModeActive) return;` |
| Selection edit popup hide | `scroll` (capture) | `document` | `if (isFocusModeActive) return;` |

Already properly isolated (no changes needed): global keydown router (intentional multi-mode branching), editor/markdown keydown (on elements inside overlay), TOC scroll handler (on `.live-wysiwyg-focus-main`), fullscreen handler (has guard), popstate handler (has guard).

### Future Mode Guidance

New modes must:

1. Declare their layer position relative to existing layers
2. On entry: suppress all lower layers per the suppression contract
3. On exit: resume the lower layer's functionality
4. Follow the same lifecycle pattern (explicit triggers, cursor preservation, cleanup)

## Future Modes

### Theme Mode

A dedicated mode for editing site theme configuration, colors, and styling. Features:

- Live visual preview of theme changes
- Color picker and variable editor
- Styling controls for typography, spacing, and layout
- Persists changes to theme configuration files

Entry and exit would follow the same lifecycle pattern: explicit triggers, cursor/state preservation where applicable, and cleanup on exit.

### History Mode (Layer 4)

History Mode provides a visual interface to the DAG-based content undo/redo system with three tiers:

- **Branch picker popup** (Tier 1): caret-positioned popup when redo hits a branch point or at end of history. Shows branch options and "Show All Redo History" entry point.
- **Document History overlay** (Tier 2): full-screen DAG visualization with inline crumple accordion, V-tree branch forks, column-based layout, and preview panel.
- **Full-size readonly preview** (Tier 3): full-viewport rendered content inspection with mermaid/code rendering.

Key properties:

- **Overlays Focus Mode** with modal DAG diagram and preview UI
- **`_historyModeActive` flag** — guards mode-specific behavior
- **Mutually exclusive with Mermaid Mode** — both share z-index 99995 (Cardinal Rule #9)
- **Read-only**: no disk writes; content restoration modifies in-memory DAG state
- **Auto-exits when Focus Mode exits** — `exitFocusMode()` calls `_exitHistoryMode()` first
- **Inline crumple accordion**: consecutive edits within the same markdown container are collapsed into crumple icon nodes. Clicking unfolds the hidden nodes.
- **V-tree forks**: multi-branch points show a fork icon; clicking opens a branch picker; selecting a branch shows its history diagonally.
- **"You Are Here" indicator**: dotted-line arrow across the full DAG width at the current node.
- **Frontmatter-free previews**: all preview rendering strips YAML frontmatter.

For full architecture, DAG layout algorithm, inline crumple system, and keyboard handling, see [DESIGN-history-mode.md](DESIGN-history-mode.md).

### Mermaid Mode (Layer 3)

Mermaid Mode is a full-screen diagram editor for mermaid code blocks. It overlays Focus Mode with an iframe embedding the vendored mermaid-live-editor.

- **Full-screen diagram editor** for mermaid code blocks
- **Overlays Focus Mode** with iframe embedding vendored mermaid-live-editor
- **All changes in-memory only** — no direct disk writes; standard save pipeline persists changes
- **`_mermaidModeActive` flag** — guards mode-specific behavior
- **Keyboard suppression**: ESC exits mermaid mode; Ctrl+S exits mermaid mode; all other shortcuts suppressed
- **Scroll suppression** — same pattern as Focus Mode (`overflow: hidden` on body/documentElement, saved and restored on exit)
- **Auto-exits when Focus Mode exits** — `exitFocusMode()` calls `exitMermaidMode()` first

For full architecture, entry/exit details, postMessage protocol, and integration points, see [DESIGN-mermaid-mode.md](../mermaid/DESIGN-mermaid-mode.md).
