# Architecture Overview

The WYSIWYG plugin uses a snapshot-driven architecture where all content modifications flow through nav snapshots and a declarative save planner before reaching disk.

## High-Level Pipeline

```mermaid
flowchart LR
    ContentMod["Content Modification<br>and saving..."]
    NavSnaps["will update<br>Nav Snapshots."]
    SavePlanner["will use the<br>Declarative Save Planner"]

    subgraph Backend ["Backend disk"]
        WysiwygAPI["via<br>wysiwyg plugin API<br>rest server"]
        LiveEditAPI["or via<br>live edit plugin API<br>websocket server"]
    end

    ContentMod -->|"via Nav Ctrl+S"| NavSnaps
    ContentMod -->|"via content Ctrl+S"| SavePlanner
    NavSnaps -->|"Differences"| SavePlanner
    SavePlanner -->|"which writes to"| Backend
```

## Snapshot-Driven Architecture

```mermaid
flowchart TD
    navData["navData"]
    NavSnaps["Nav Snapshots.<br>Saving snapshot differences"]
    UndoRedo["undo-redo index"]
    NavRenderer["Nav Renderer"]
    SavePlanner["will use<br>Declarative Save Planner"]
    ComputeDiff["Compute content<br>differences,"]
    MinDisk["Minimal disk writes"]
    MigrateAll["Migrate all content"]
    SavingDocs["Saving Documents"]
    ContentWarnings["Content warnings"]
    NavWeightMigration["mkdocs-nav-weight migrate"]

    navData -->|"commits as"| NavSnaps
    UndoRedo -->|"tracks active"| NavSnaps
    NavRenderer -->|"renders from"| NavSnaps
    NavRenderer -->|"get active"| UndoRedo
    NavSnaps -->|"via Nav Ctrl+S"| SavePlanner
    SavePlanner -->|"which will"| ComputeDiff
    ComputeDiff -->|"write to disk with"| MinDisk
    MinDisk -->|"creates a snapshot diff to be written to disk"| MigrateAll
    MigrateAll -.- |"rewrites markdown content so there are no broken cross-document links"| MigrateAll
    SavingDocs -->|"via content Ctrl+S"| SavePlanner
    ContentWarnings -->|"display from"| NavSnaps
    ContentWarnings --> navData
    NavWeightMigration --> navData
    NavWeightMigration -->|"from mkdocs.yml nav"| NavSnaps
```

## Save Execution Pipeline

```mermaid
flowchart LR
    SavePlanner["Declarative Save Planner"]

    subgraph ExecGroup ["Execute saving content"]
        direction TB
        ComputeDiff["Compute content<br>differences,"]
        MinDisk["minimal disk writes,"]
        MigrateAll["Migrate all content"]

        ComputeDiff --> MinDisk
        MinDisk --> MigrateAll
    end

    subgraph BackendGroup ["Backend"]
        WysiwygAPI["wysiwyg plugin API server"]
        LiveEditAPI["live edit plugin API websocket server"]
    end

    SavePlanner -->|"write to disk with"| ExecGroup
    ComputeDiff -.- |"plans movement from current to desired state on disk"| ComputeDiff
    MinDisk -.- |"reorganizes files as fast as possible to desired state on disk"| MinDisk
    MigrateAll -.- |"rewrites markdown content so there are no broken cross-document links"| MigrateAll
    MinDisk --> BackendGroup
    MigrateAll --> BackendGroup
    BackendGroup -.- |"read and write content to disk"| BackendGroup
```

## Source of Truth

`liveWysiwygNavData` (and the snapshots derived from it) is the sole source of truth for all navigation operations — item positioning, movement, sibling lookup, weight computation, and save planning. The DOM is a rendering target rebuilt from the active snapshot on every change; it is never queried for item position, parent–child relationships, or ordering. DOM attributes (`data-nav-uid`, `data-nav-src-path`) exist only for event-to-data bridging (mapping click targets back to navData items) and post-operation visual focus (scrolling a moved item into view).

## More Information

For more detail see the following design documents.

- [DESIGN-centralized-keyboard.md](DESIGN-centralized-keyboard.md) -- Three-tier centralized keyboard handling architecture (dialog, global, editor).
- [DESIGN-declarative-save-planner.md](DESIGN-declarative-save-planner.md) -- Two-phase save architecture that separates desired end state from execution.
- [DESIGN-nav-migration.md](DESIGN-nav-migration.md) -- Migrating from mkdocs.yml nav key to mkdocs-nav-weight frontmatter-based ordering.
- [DESIGN-nav-weight-normalization.md](DESIGN-nav-weight-normalization.md) -- Nav weight normalization: rules, entry points, and the shared single-level algorithm.
- [DESIGN-popup-dialog-ux.md](DESIGN-popup-dialog-ux.md) -- Unified keyboard interaction model for all popups, dropdowns, and dialogs.
- [DESIGN-file-management.md](DESIGN-file-management.md) -- File management: single-item and multi-select group movement, unified save pipeline.
- [DESIGN-snapshot-nav-architecture.md](DESIGN-snapshot-nav-architecture.md) -- Centralized snapshot-driven architecture for the focus mode navigation menu.
