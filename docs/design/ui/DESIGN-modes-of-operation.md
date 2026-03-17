# Modes of Operation — Design Document

## Overview

The WYSIWYG editor operates in three primary modes, with additional modes planned for future releases. Each mode defines a distinct editing context, UI surface, and user interaction model.

| Mode | Description |
|---|---|
| **Readonly** | Default page load state. Content is rendered as static HTML. No editing surfaces active. |
| **Unfocused** | WYSIWYG editor rendered inline on the readonly page with the live-edit controls bar overlay. |
| **Focus** | Fullscreen overlay emulating the Material theme layout with nav sidebar, content area, and TOC. |

Planned future modes include Theme Mode and Mermaid Mode.

## Mode Lifecycle

### Transitions and Triggers

| From | To | Trigger |
|---|---|---|
| Readonly | Unfocused | Edit button (accesskey e) or period (`.`) shortcut |
| Unfocused | Focus | Focus Mode toolbar button or browser fullscreen |
| Focus | Unfocused | X button or Escape key |
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

### Overlay Management

| Mode | Overlay |
|---|---|
| Readonly | None |
| Unfocused | Controls bar (`.live-edit-controls`) from upstream live-edit-plugin |
| Focus | Fullscreen overlay (`.live-wysiwyg-focus-overlay`) |

## Future Modes

### Theme Mode

A dedicated mode for editing site theme configuration, colors, and styling. Features:

- Live visual preview of theme changes
- Color picker and variable editor
- Styling controls for typography, spacing, and layout
- Persists changes to theme configuration files

Entry and exit would follow the same lifecycle pattern: explicit triggers, cursor/state preservation where applicable, and cleanup on exit.

### Mermaid Mode

A dedicated mode for editing Mermaid diagrams. Features:

- Specialized editing surface for Mermaid syntax
- Diagram-specific tooling (node insertion, edge creation)
- Live preview of the rendered diagram
- Syntax assistance and validation

Entry would occur when the user focuses a Mermaid code block or invokes a diagram edit action. Exit would return to the parent editing context (Unfocused or Focus) with diagram content preserved.
