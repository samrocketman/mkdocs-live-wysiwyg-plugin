# Content Scanning — Design Document

## Overview

The Content Scanning subsystem is part of the WYSIWYG editor's Backend Subsystem. It handles dead link scanning (internal and external), outbound and inbound link rewriting after file moves, the double rendering check for content integrity, and exclusion zones that protect fenced code, inline code, and HTML comments from modification. All scanning and rewriting operations respect these zones and surface problems to the Cautions subsystem via reason strings.

## Link Rewriting

Link rewriting updates relative paths when documents or assets move. Two directions apply:

**Outbound rewriting** (`_rewriteLinksInContent`, `_rewriteOutboundLinks`): When a document moves, its internal relative links are updated to reflect the new directory. The rewriter computes new relative paths from the document's new location to each target.

**Inbound rewriting** (`_rewriteInboundLinks`, `_rewriteInboundLinksInPage`): When a document or asset moves, all other documents that reference it have their links updated. The link index (`liveWysiwygLinkIndex`) identifies referencing pages; each is fetched, rewritten, and written back.

**Asset link rewriting** (`_rewriteAllMovedLinksInPage`): When binary files move, the same infrastructure applies. Asset moves are included in the `allRenames` map alongside page moves. The rewriter handles `[text](path)`, `![alt](path)`, `<img src="path">`, and `[ref]: path`. It is extension-agnostic — any valid filename is handled.

**Anchor and query preservation**: `#section` and `?query` are split off before path rewriting, the path part is updated, and the suffix is reassembled. Heading-only links (`#anchor`) are always skipped as same-page references.

**Exclusion zones**: Code blocks, inline code, and HTML comments are never modified. See Exclusion Zones below.

## Exclusion Zones

Exclusion zones protect content from link rewriting and other scanning operations. `_findExclusionZones(content)` returns `[start, end]` ranges for:

- **Fenced code blocks**: Triple backticks or tildes (` ``` `, `~~~`)
- **Inline code**: Backtick-wrapped spans (`` `...` ``)
- **HTML comments**: `<!-- ... -->`

`_isInExclusionZone(offset, zones)` checks whether a character offset falls inside any zone. All link rewriting and dead link scanning uses these helpers to skip matches inside zones.

## Dead Link Scanning

`_scanDeadLinks(mode, options)` scans all pages for broken links via the link-checker server. Results flow through `_processDeadLinkResults` → `_finalizeDeadLinkResults` → `_commitDeadLinkResults`.

**Anchor validation**: When an internal link includes a `#fragment`, the scanner sends the fragment to the server alongside the path. The server reads the target file, extracts headings, computes slugs, and validates the fragment. See [DESIGN-heading-migration.md](../ui/DESIGN-heading-migration.md) for the anchor validation protocol and server-side heading extraction.

1. Set `_suppressWarningSnapshot = true`
2. For each page with dead links: `_addDeadLinksForPage(path, internal, external)` + `_addCautionPage(path, reason)` — both modify navData without committing
3. Set `_suppressWarningSnapshot = false`
4. `_commitNavSnapshot()` — single snapshot for the entire scan

**Options:**

| Option | Type | Purpose |
|--------|------|---------|
| `fileLayout` | `string[]` | Virtual file layout for the server — when provided, the server checks link targets against this set instead of the real filesystem |
| `filterTargets` | `object` | Map of deleted paths — only report dead links whose resolved target matches a key in this map |
| `quiet` | `boolean` | Skip overlay, wizard popup, unreferenced asset check, and toast. Used for background scans |
| `onComplete` | `function(deadByPage)` | Callback invoked after results are committed (or when no dead links are found) |

**Virtual file layout**: When `file_layout` is provided in the `POST /check-links` body, the server evaluates links against the virtual layout instead of the real filesystem. `_buildFileLayoutFromNav(deletedDirs)` walks `liveWysiwygNavData`, collects `src_path` for non-deleted items, includes directory paths for sections, supplements with `liveWysiwygAllMdSrcPaths` (excluding deleted paths), and returns a flat array of docs-relative path strings.

**Reason strings**: Dead link finder uses `"Internal dead links found"` and `"External dead links found"` as caution reasons.

## Post-Delete Impact Scan

When a page, asset, or folder is deleted in nav edit mode, `_scanDeleteImpact(deletedDirs)` runs a targeted internal dead link scan to identify pages that will have broken links as a result of the deletion. No confirmation popups are shown — the impact is surfaced as caution icons on affected nav items.

Flow:

1. Delete marks item as `_deleted` (or `_markSubtreeDeleted` for folders)
2. `_scanDeleteImpact(deletedDirs)` builds virtual file layout (excluding deleted items)
3. Collects `filterTargets` from `_deleted` items and deleted directory contents
4. Calls `_scanDeadLinks('internal', { fileLayout, filterTargets, quiet: true, onComplete })`
5. Server evaluates links against virtual layout
6. `_processDeadLinkResults` filters to links targeting deleted paths only
7. `_commitDeadLinkResults` adds dead links and caution reasons for affected pages

The `filterTargets` map ensures only *new* dead links caused by the deletion are surfaced. Pre-existing dead links to other targets are excluded.

## Double Rendering Check

The double rendering check (`_doubleRenderCheck`) performs an in-memory WYSIWYG↔Markdown round-trip to verify content integrity. It runs during batch operations (e.g., rename-page) after link rewriting.

**Mechanism**: Markdown → HTML (via `_markdownToHtml`) → Markdown (via `_htmlToMarkdown`) → HTML again. Both HTML outputs are normalized (whitespace, zero-width markers) and compared. If they differ, or if an error occurs, the check fails.

**Failure handling**: If the check fails, the batch operation continues and writes the **original unmodified content** (with no link rewrites applied). The page's `src_path` is recorded as a caution page. A caution icon appears in the nav menu.

**Bypass**: Normalization renames set `skipDoubleRenderCheck: true` because the content is only having links rewritten (string manipulation), not passing through WYSIWYG — the double render check is irrelevant and would block necessary renames.

**In-memory render mode**: `_inMemoryRenderMode = true` during the check. Image resolution, `data-orig-src`, and `enhanceImages` are skipped. `data-md-literal` must pass through unchanged.

## Case Sensitivity

- **Filesystem operations**: Delete-then-create for case-insensitive safety when renaming
- **Content and links**: Always case-sensitive (for Linux deployment)
- **Link matching**: Exact case-sensitive comparison
- **Filename generation**: Always lowercase

## Rules

1. Exclusion zones (fenced code, inline code, HTML comments) must never be modified by link rewriting or dead link scanning.
2. Link rewriting is case-sensitive. Path matching uses exact comparison.
3. Anchors (`#section`) and query strings (`?query`) are preserved during path rewriting.
4. Dead link scan uses virtual file layout from the nav snapshot when provided; the server checks against this set instead of the real filesystem.
5. Post-delete impact scan uses `filterTargets` to surface only new dead links caused by the deletion.
6. Double rendering check failure preserves original content and adds a caution icon.
7. Content Scanning surfaces problems to the Cautions subsystem via reason strings (`"Internal dead links found"`, `"External dead links found"`).
8. Only Content Scanning may remove its own caution reasons; use `_stripDeadLinkCautionReasons` or `_removeCautionReason` to filter matching entries only.
