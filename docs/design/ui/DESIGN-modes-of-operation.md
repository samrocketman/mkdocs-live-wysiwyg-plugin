# Modes of Operation — Design Document

## Overview

The WYSIWYG editor operates in three primary modes, with additional modes planned for future releases. Each mode defines a distinct editing context, UI surface, and user interaction model.

| Mode | Description |
|---|---|
| **Readonly** | Default page load state. Content is rendered as static HTML. No editing surfaces active. |
| **Unfocused** | WYSIWYG editor rendered inline on the readonly page with the live-edit controls bar overlay. |
| **Focus** | Fullscreen overlay emulating the Material theme layout with nav sidebar, content area, and TOC. |
| **Mermaid** | Full-screen diagram editor for mermaid code blocks. Overlays Focus Mode with iframe embedding vendored mermaid-live-editor. |

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

## Mode Hierarchy

### Layered Stack Model

Modes form a layered stack. Only one mode is active at a time. When a higher-layer mode activates, all lower layers are suppressed. When the higher mode exits, the lower mode resumes.

```
Layer 5:  Help Modal        (informational overlay, z-index 100003)
Layer 3:  Mermaid Mode      (full-screen diagram editor, overlays Focus, z-index 99995)
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
| 5 | Help | Ctrl+? or help icon (from any mode) | ESC, Enter, backdrop click, Ctrl+? | 100003 |

### Disk I/O Authority by Layer

| Layer | Disk I/O Pathway |
|---|---|
| 0 (Readonly) | None |
| 1 (Unfocused) | Upstream live-edit-plugin Save button (direct WebSocket) |
| 2 (Focus) | Declarative Save Planner exclusively (`_runBatchOps`) |
| 3 (Mermaid) | None (all changes in-memory; persisted when Focus Mode saves) |

In Focus Mode and above, no code path may perform disk writes outside the batch executor pipeline. This is enforced architecturally: all disk-writing functions (`_wsSetContents`, `_wsNewFile`, `_wsDeleteFile`, mutating `_apiPost`) are called only from `_execute*Op` functions dispatched by `_dispatchSingleOp` within `_runBatchOps`. See DESIGN-declarative-save-planner.md Invariant 10.

### Suppression Contract

When Layer N is active, all layers < N must have:

| Aspect | Suppression |
|---|---|
| **Scroll** | No scroll containers from lower layers respond to user input. `overflow: hidden` on body/documentElement. `overscroll-behavior: contain` on the active layer's scroll container. |
| **Keyboard shortcuts** | Lower-layer keyboard handlers must early-return or not fire. Handlers registered on `document` must guard with the active mode check. |
| **Event handlers** | Permanent document-level handlers from lower layers must check `isFocusModeActive` (or equivalent) and return early. |
| **UI** | Lower-layer overlays and controls are behind the higher layer's z-index. Not interactive. |

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
