#!/usr/bin/env bash
# Vendor mermaid.js and mermaid-live-editor into the plugin.
#
# Prerequisites: node (>=18), pnpm, git, curl
#
# Usage:
#   scripts/vendor-mermaid.sh
#
# This script is idempotent — running it again with the same
# version pins produces identical output.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$PROJECT_ROOT/mkdocs_live_wysiwyg_plugin/vendor"
WORK_DIR="$(mktemp -d)"

trap 'rm -rf "$WORK_DIR"' EXIT

# ── Version pins ──────────────────────────────────────────────
MERMAID_VERSION="11.4.1"
MERMAID_GIT_TAG="mermaid@${MERMAID_VERSION}"
LIVE_EDITOR_BRANCH="develop"

# ── 1. Vendor mermaid.js ─────────────────────────────────────
echo "==> Downloading mermaid.js v${MERMAID_VERSION}..."
curl -fsSL "https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js" \
  -o "$VENDOR_DIR/mermaid.min.js"

echo "==> Downloading mermaid LICENSE..."
curl -fsSL "https://raw.githubusercontent.com/mermaid-js/mermaid/${MERMAID_GIT_TAG}/LICENSE" \
  -o "$VENDOR_DIR/LICENSE.mermaid"

# ── 2. Build mermaid-live-editor ──────────────────────────────
echo "==> Cloning mermaid-live-editor (${LIVE_EDITOR_BRANCH})..."
git clone --depth 1 --branch "$LIVE_EDITOR_BRANCH" \
  https://github.com/mermaid-js/mermaid-live-editor.git \
  "$WORK_DIR/mermaid-live-editor"

cd "$WORK_DIR/mermaid-live-editor"

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Building with external services disabled..."
MERMAID_ANALYTICS_URL='' \
MERMAID_RENDERER_URL='' \
MERMAID_KROKI_RENDERER_URL='' \
MERMAID_IS_ENABLED_MERMAID_CHART_LINKS=false \
MERMAID_DOMAIN='' \
  pnpm build

BUILD_DIR="$WORK_DIR/mermaid-live-editor/docs"

# ── 3. Apply vendor patches ───────────────────────────────────
# All offline modifications, bridge injection, and sub-path fixes are
# handled by the dedicated patch script.  See patch-mermaid-vendor.py
# and DESIGN-vendor-subsystem.md for the full patch inventory.
echo "==> Applying vendor patches..."
python3 "$SCRIPT_DIR/patch-mermaid-vendor.py" "$BUILD_DIR"

# ── 4. Copy to vendor ────────────────────────────────────────
echo "==> Copying built output to vendor..."
rm -rf "$VENDOR_DIR/mermaid-live-editor"
cp -R "$BUILD_DIR" "$VENDOR_DIR/mermaid-live-editor"

# ── 5. Licensing ──────────────────────────────────────────────
echo "==> Copying LICENSE..."
cp "$WORK_DIR/mermaid-live-editor/LICENSE" \
   "$VENDOR_DIR/LICENSE.mermaid-live-editor"

echo "==> Generating NOTICES..."
{
  echo "NOTICES for mermaid-live-editor vendored build"
  echo "=============================================="
  echo ""
  echo "This file lists significant transitive dependencies bundled"
  echo "in the built output and their licenses."
  echo ""
  find "$WORK_DIR/mermaid-live-editor/node_modules" \
    -maxdepth 2 -name 'LICENSE*' -o -name 'license*' | \
    sort | head -100 | while read -r f; do
      pkg="$(echo "$f" | sed "s|.*/node_modules/||" | sed "s|/LICENSE.*||" | sed "s|/license.*||")"
      echo "- $pkg"
    done
} > "$VENDOR_DIR/NOTICES.mermaid-live-editor"

# ── 6. Offline audit ─────────────────────────────────────────
echo "==> Running offline audit..."
EXTERNAL_URLS=$(
  grep -rn 'https://' "$VENDOR_DIR/mermaid-live-editor/" \
    --include='*.js' --include='*.html' 2>/dev/null | \
    grep -v '//# sourceMappingURL' | \
    grep -v 'mermaid.js.org' || true
)

if [ -n "$EXTERNAL_URLS" ]; then
  echo "WARNING: External URLs found in built output:"
  echo "$EXTERNAL_URLS"
  echo ""
  echo "Review these URLs and address if they make network requests."
fi

echo "==> Done. Vendor mermaid assets updated."
