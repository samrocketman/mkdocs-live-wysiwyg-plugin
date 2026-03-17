# Nav-to-Weight Migration

## Overview

When a site uses the `nav` key in `mkdocs.yml` to define navigation structure, migrating to `mkdocs-nav-weight` (frontmatter-based ordering) requires restructuring the filesystem to match the nav hierarchy. The `nav` key allows arbitrary virtual groupings — pages from any directory can appear under any section heading — but `mkdocs-nav-weight` derives hierarchy from the filesystem. The migration resolves this mismatch by moving files to match the declared nav structure.

## Trigger

The migration is triggered from the focus mode nav menu when both `mkdocs-nav-weight` is enabled and a `nav` key exists in `mkdocs.yml`. A warning icon appears; clicking it offers a "Migrate to mkdocs-nav-weight" button.

## Data Model

The migration operates entirely on `liveWysiwygNavData` and snapshots. `_applyMigrationToNavData` synchronously mutates the navData tree — it does not query or modify the DOM. The nav menu DOM is rebuilt from the resulting snapshot via `_renderNavFromSnapshot()` after the migration is staged. The save planner (`_computeSavePlan` / `_planDiskOperations`) then diffs snapshots to produce disk operations. No DOM element, attribute, or query result influences migration logic.

## Seven Phases

The migration executes as a batch operation with seven sequential phases. All phases run within a single batch save — the user sees a progress overlay and can review results before the final rebuild.

### Phase 1: Duplicate Detection

Before any work begins, scan the parsed nav structure for duplicate page paths. A page appearing more than once in the `nav` key would cause conflicting moves.

- Walk the nav tree recursively, collecting every `page.path`.
- If any path appears more than once, show a scrollable error dialog listing the duplicates and abort.
- The dialog uses `_showNavDialogHtml` so the list can scroll if large.

### Phase 2: Build Relative Link Index

Read every markdown file in the docs directory and parse relative links from each. This index is used in Phase 4 and Phase 7 to rewrite links when files move.

- For each `src_path` in `liveWysiwygAllMdSrcPaths`, read via `_wsGetContents`.
- Extract all relative link targets: `[text](target)`, `![alt](target)`, `<img src="target">`, `[ref]: target`.
- Skip absolute URLs (`http://`, `https://`, `#`, `mailto:`, `data:`).
- Skip targets inside exclusion zones (fenced code, inline code, HTML comments).
- Resolve each relative target against the file's directory to get an absolute docs-relative path.
- Store as `linkIndex[src_path] = [{ raw, resolved }]`.

This is the same link index structure used by `_rewriteInboundLinks`.

### Phase 3: Create Directory Structure

Compute the target directory tree from the nav structure and create all required directories (via index.md files). Existing directories are reused.

#### Section-to-directory mapping

Each `section` node in the nav tree maps to a directory. The directory name is derived by slugifying the section title: lowercase, non-alphanumeric characters replaced with hyphens, leading/trailing hyphens stripped.

```
nav:                               target directory:
- Getting Started:          →      getting-started/
  - Tutorials:              →      getting-started/tutorials/
- API Reference:            →      api-reference/
```

#### Index.md handling

Each section needs an `index.md`. Two cases:

1. **Section has an index.md child in the nav.** The existing index.md is always split via a `regenerate-index` op: its content is renamed to a slug-based page (using `_generateFilename` from its nav title), and a new thin `index.md` is created with `retitled: true`, `empty: true`, and the section title. The renamed content page receives its own title and weight in Phase 6. This follows the same pattern as `_queueRenameAndRegenerateIndex` during normalization.

2. **Section has no index.md child.** Create a new thin `index.md`:
   ```yaml
   ---
   title: Section Title
   retitled: true
   empty: true
   ---
   ```

#### Non-index pages named index.md

If a page reference in the nav points to an `index.md` but it's NOT the section's own index (e.g., `errors/index.md` listed as a leaf page under a different section), rename it to a slug-based filename derived from its title. This prevents collisions with the target section's `index.md`.

### Phase 4: Move Documents

Move every page referenced in the nav to its target location. The target path is determined by the section hierarchy:

```
nav:                                          target path:
- Home: index.md                    →         index.md (no move)
- Overview: overview.md             →         overview.md (no move)
- Getting Started:
  - Setup: setup/index.md           →  split: getting-started/setup.md (content)
                                              getting-started/index.md (thin, created)
  - Install: install.md             →         getting-started/install.md
  - Quickstart: guides/quick.md     →         getting-started/quick.md
- API Reference:
  - Auth: auth/api.md               →         api-reference/api.md
```

For each page where `oldPath !== targetPath`:

1. Read content via `_wsGetContents`.
2. Rewrite outbound relative links using `_rewriteLinksInContent(content, oldPath, targetPath)`.
3. Delete old file via `_wsDeleteFile`.
4. Create new file via `_wsNewFile` + `_wsSetContents`.
5. Update `_batchRenamedPaths` and `_batchDeletedPaths`.
6. Rewrite inbound links in all other files that reference the moved page, using the link index from Phase 2 and `_rewriteInboundLinks`.

This uses the existing `rename-page` op type, which already handles all of the above.

#### Root index.md

The root `index.md` is never moved and never receives a weight. It only receives a title if one is specified in the nav key (e.g., `- Home: index.md` sets `title: Home`).

### Phase 5: Mark Hidden Documents

Any markdown file in the docs directory that is NOT referenced in the nav key is marked as headless:

```yaml
---
headless: true
---
```

This uses the existing `set-headless` op type.

### Phase 6: Set Titles and Weights

Set frontmatter `title` and `weight` on every page according to its position in the nav:

- **Section indexes:** `title` = section title, `retitled: true`, `weight` = section's position among its parent's children (100, 200, 300...).
- **Regular pages:** `title` from the nav key, `weight` = position among siblings (100, 200, 300...).
- **Root index.md:** Title only, no weight (its position is controlled by the `index_weight` config).

Weight numbering uses increments of 100. Sections and pages at the same level share the same weight sequence:

```
- Home: index.md               →  no weight (root index)
- Overview: overview.md         →  weight: 100
- Getting Started:              →  getting-started/index.md weight: 200
  - Install: install.md         →  weight: 100 (within getting-started/)
  - Quickstart: quick.md        →  weight: 200 (within getting-started/)
- API Reference:                →  api-reference/index.md weight: 300
```

Finally, remove the `nav` key from `mkdocs.yml` (and from `$TMPDIR/original-mkdocs.yml` if it exists) using the `update-mkdocs-yml` op with `_removeNavKeyFromYaml` transform.

### Phase 7: Consolidate Hidden Documents

After all nav pages are in their final positions, re-evaluate relative links across all markdown files. For each hidden (headless) document, determine whether it can be moved closer to the documents that reference it:

1. For each hidden document, find all files that contain relative links pointing to it (using the link index rebuilt after Phase 4 moves).
2. Resolve each inbound link to determine which directory the referencing file "expects" the hidden doc to be in (i.e., the directory that would make the link a same-directory reference like `hidden.md` instead of `../hidden.md`).
3. If ALL inbound links agree on the same target directory, move the hidden document there and rewrite all links.
4. If inbound links disagree (different referencing files would need the hidden doc in different directories), skip it — no move is possible without breaking some links.

This phase is opportunistic: it improves link locality where possible but never breaks existing links.

## Batch Op Types Used

| Phase | Op Types |
|-------|----------|
| 3 | `regenerate-index` (split claimed index → content page + thin index), `create-page` (new thin index) |
| 4 | `rename-page` (document moves with link rewriting) |
| 5 | `set-headless` |
| 6 | `set-frontmatter`, `update-mkdocs-yml` |
| 7 | `rename-page` (hidden doc consolidation) |

## Phase Ordering in Batch Executor

The migration pushes all ops into `_navBatchQueue`. The existing batch executor (`_executeNavBatchSave`) already orders ops by phase:

1. `create-page` runs before `rename-page`
2. `rename-page` and `set-frontmatter` run in the same phase
3. `set-headless` runs in the rename/frontmatter phase
4. `update-mkdocs-yml` runs last

The migration must push ops in the correct order within each phase group so that dependencies are satisfied (e.g., create a directory's index.md before moving pages into that directory).

## Confirmation Dialog

Before starting, the migration shows a summary dialog:

- Number of new index.md files to create
- Number of documents to move
- Number of pages that will receive titles/weights
- Number of unlisted pages to mark headless
- Number of hidden documents eligible for consolidation
- Note that the `nav` key will be removed from mkdocs.yml
- Note that relative links will be updated automatically

## Error Handling

- **Duplicate nav entries:** Hard stop before any work. User must fix mkdocs.yml manually.
- **Move failures:** Individual rename-page failures are logged, the page gets a caution icon, but the batch continues.
- **Link rewrite failures:** Same as move failures — logged and cautioned, batch continues.
- **WebSocket disconnection:** Batch aborts with partial state; user sees failure summary.

## Functions

| Function | Purpose |
|----------|---------|
| `_migrationCheckDuplicates(navStructure)` | Phase 1: returns array of duplicate paths |
| `_migrationSectionSlug(title)` | Slugify section title for directory name |
| `_migrationComputeTargetTree(navStructure)` | Compute full target tree: pages, indexes, moves |
| `_buildMigrationOps(navStructure, allMdSrcPaths)` | Generate ordered batch ops for all 7 phases |
| `_startMigrationFlow()` | Orchestrate: parse nav, check dupes, show dialog, queue ops |
| `_showNavDialogHtml(htmlContent, buttons)` | Dialog variant accepting HTML for scrollable content |
