#!/bin/bash
# Created by Sam Gleske
# Wed Apr  2 11:56:47 EDT 2025
# GNU bash, version 3.2.57(1)-release (arm64-apple-darwin23)
# Python 3.13.1

set -euo pipefail

# since rapidly developing I'll track this at the top for now
WYSIWYG_VERSION=0.3.21
YML_INSTALL_FILES_VERSION="v3.8"

# GITHUB_DOWNLOAD_MIRROR=...
# RAW_GITHUB_DOWNLOAD_MIRROR=...
yq_mirror="${GITHUB_DOWNLOAD_MIRROR:-https://github.com}"
export GITHUB_DOWNLOAD_MIRROR yq_mirror

# set SKIP_NEXUS=1 if you don't want to download from Nexus on VPN.
TECHDOCS_HOST="${TECHDOCS_HOST:-127.0.0.1}"
# if not defined, then TECHDOCS_PORT TECHDOCS_WEBSOCKET_PORT will be determined
export TECHDOCS_HOST TECHDOCS_PORT TECHDOCS_WEBSOCKET_PORT

# Returns desired port if available, otherwise a random available user-space
# port (1024-65535).  Exits non-zero on each unavailable attempt so the caller
# can retry via an until loop.
available_port() {
  local port="${1:-}"
  if [ -z "$port" ]; then
    port=$(( RANDOM % 64511 + 1024 ))
  fi
  if ! nc -z "$TECHDOCS_HOST" "$port" 2>/dev/null; then
    echo "$port"
    return 0
  fi
  return 1
}

# Resolve a port: try the desired default, fall back to random available port.
# Usage: resolve_port <default>
resolve_port() {
  local retries=0 port
  until port="$(available_port "${1:-}")"; do
    retries=$(( retries + 1 ))
    if [ "$retries" -ge 100 ]; then
      echo "ERROR: Could not find an available port after 100 attempts." >&2
      exit 1
    fi
    set -- ""
    sleep .1
  done
  echo "$port"
}

resolve_ports() {
  if [ -z "${TECHDOCS_PORT:-}" ]; then
    TECHDOCS_PORT="$(resolve_port 8000)"
  fi
  if [ -z "${TECHDOCS_WEBSOCKET_PORT:-}" ]; then
    TECHDOCS_WEBSOCKET_PORT="$(resolve_port 8484)"
  fi
}

default_ports() {
  TECHDOCS_PORT="${TECHDOCS_PORT:-8000}"
  TECHDOCS_WEBSOCKET_PORT="${TECHDOCS_WEBSOCKET_PORT:-8484}"
}

uv_download_yaml() {
cat <<'UV_DOWNLOAD_YAML'
versions:
  uv: 0.10.7
  yq: 4.52.4
checksums:
  uv:
    unknown-linux-gnu:
      x86_64: 3b9d43bace955a409eb6f012b0932a4935534bdb54b85b9fd696cabbb15979a0
      aarch64: ad4f54ea470da62875ba5c45d4bd8e0bd0271989c68ce3335bbea26a5a6706e8
    apple-darwin:
      aarch64: e7a5bf88df262cdf04ee035ac75dc91b753316dab29730ab4c08e03c40d11c7e
      x86_64: 9ce2a8d60b251ef51f3469ba80ac362f6dcf5a25f6871024385e2c6aa13e201f
  yq:
    darwin:
      arm64: 6bfa43a439936644d63c70308832390c8838290d064970eaada216219c218a13
      amd64: d72a75fe9953c707d395f653d90095b133675ddd61aa738e1ac9a73c6c05e8be
    linux:
      arm64: 4c2cc022a129be5cc1187959bb4b09bebc7fb543c5837b93001c68f97ce39a5d
      amd64: 0c4d965ea944b64b8fddaf7f27779ee3034e5693263786506ccd1c120f184e8c

defaults: &defaults
  dest: '${DESTINATION_DIR:-/usr/local/bin}'
  perm: '0755'
  update: |
    owner="$(awk -F/ '{print $4"/"$5}' <<< "${download}")"
    export download=https://github.com/"${owner}"/releases/latest
    eval "${default_download_head}" |
    awk '$1 ~ /[Ll]ocation:/ { gsub(".*/[^0-9.]*", "", $0); print;exit}'

utility:
  uv:
    <<: *defaults
    # uv uses different naming: x86_64/aarch64 and unknown-linux-gnu/apple-darwin
    os:
      Linux: unknown-linux-gnu
      Darwin: apple-darwin
    arch:
      Darwin:
        arm64: aarch64
    download: '${GITHUB_DOWNLOAD_MIRROR:-https://github.com}/astral-sh/uv/releases/download/${version}/uv-${arch}-${os}.tar.gz'
    extract: tar -xzC ${dest}/ --no-same-owner --strip-components=1 uv-${arch}-${os}/uv
  yq:
    <<: *defaults
    os:
      Linux: linux
      Darwin: darwin
    arch:
      x86_64: amd64
      aarch64: arm64
      Darwin:
        i386: amd64
    download: '${GITHUB_DOWNLOAD_MIRROR:-https://github.com}/mikefarah/yq/releases/download/v${version}/yq_${os}_${arch}'
UV_DOWNLOAD_YAML
}

uv() {
  if type -P uv &> /dev/null; then
    command uv "$@"
  elif [ -x ~/.techdocs/uv ]; then
    command ~/.techdocs/uv "$@"
  else
    (
      mkdir -p ~/.techdocs
      if [ ! -x ~/.techdocs/download-utilities.sh ]; then
        curl -fsSL -o ~/.techdocs/download-utilities.sh \
          "${RAW_GITHUB_DOWNLOAD_MIRROR:-https://raw.githubusercontent.com}/samrocketman/yml-install-files/${YML_INSTALL_FILES_VERSION}/download-utilities.sh"
        chmod +x ~/.techdocs/download-utilities.sh
      fi
      export DESTINATION_DIR=~/.techdocs yaml_file='-'
      uv_download_yaml | ~/.techdocs/download-utilities.sh uv
    )
    command ~/.techdocs/uv "$@"
  fi
}

yq() (
  if type -P yq &> /dev/null; then
    command yq "$@"
  elif [ -x ~/.techdocs/yq ]; then
    command ~/.techdocs/yq "$@"
  else
    (
      mkdir -p ~/.techdocs
      if [ ! -x ~/.techdocs/download-utilities.sh ]; then
        curl -fsSL -o ~/.techdocs/download-utilities.sh \
          "${RAW_GITHUB_DOWNLOAD_MIRROR:-https://raw.githubusercontent.com}/samrocketman/yml-install-files/${YML_INSTALL_FILES_VERSION}/download-utilities.sh"
        chmod +x ~/.techdocs/download-utilities.sh
      fi
      export DESTINATION_DIR=~/.techdocs yaml_file='-'
      uv_download_yaml | ~/.techdocs/download-utilities.sh yq
    )
    command ~/.techdocs/yq "$@"
  fi
)

pip() (
  if [ -z "${FORCE_PIP:-}" ]; then
    uv pip "$@"
  else
    command pip "$@"
  fi
)

cleanup_on() {
  if [ -n "${DOCS_DIR_AUTO_GENERATED:-}" ] && [ -z "${READONLY_MODE:-}" ]; then
    find docs -name '*.md' -type f | while IFS= read -r _doc; do
      _dest="$(sed -n '2s/^full_path: //p' "$_doc")"
      if [ -n "$_dest" ]; then
        if head -n 1 "$_doc" | grep -q '^---$'; then
          awk 'BEGIN{fm=0} /^---$/{fm++;next} fm>=2{print}' "$_doc" > "$_dest"
        else
          cp "$_doc" "$_dest"
        fi
      fi
    done
  fi
  if [ -n "${MKDOCS_YML_AUTO_GENERATED:-}" ]; then
    rm -f mkdocs.yml
    echo 'mkdocs.yml removed (was auto-generated).' >&2
  elif [ -f "${TMP_DIR}"/original-mkdocs.yml ]; then
    mv "${TMP_DIR}"/original-mkdocs.yml mkdocs.yml
    echo 'mkdocs.yml restored.' >&2
  fi
  # delete tmp as last step
  rm -rf "${TMP_DIR}"
  if [ ! "${1:-}" = 0 ] && [ -n "${expanded_help:-}" ]; then
cat >&2 <<'EOF'

Your command appears to have failed.  This is usually due to missing mkdocs
plugins.  This script supports adding additional plugins.

Example:
  techdocs-preview.sh add_plugins mkdocs-some-python-plugin

EOF
  fi
}
TMP_DIR="$(mktemp -d)"
mkdir "${TMP_DIR}/site"
export TMP_DIR
trap 'cleanup_on $?' EXIT

# merges user provided plugins in mkdocs.yml with techdocs-preview.sh plugins
merge_user_plugins() {
  yq '.plugins = .plugins + (load("'"${1}"'") | .plugins)'
}

# Add a markdown extension if not already present (as string or map key)
add_markdown_extension_if_missing() {
  local ext="$1"
  local config="$2"
  # Add markdown_extensions if missing
  if ! yq -e 'has("markdown_extensions")' "$config" &>/dev/null; then
    yq -i '.markdown_extensions = ["'"$ext"'"]' "$config"
    return
  fi
  # Only add if extension (string or map) is not already present
  if ! {
    yq '.markdown_extensions[] | select(. == "'"$ext"'" or (tag == "!!map" and has("'"$ext"'")))' \
      "$config" 2>/dev/null | \
      grep -q .
  }; then
    yq -i '.markdown_extensions = ((.markdown_extensions // []) + ["'"$ext"'"])' "$config"
  fi
}

# Add pymdownx.superfences with mermaid custom_fences if superfences is not
# already configured.  If the user already has pymdownx.superfences (as a
# string or map), their configuration is left untouched — they may have a more
# advanced custom_fences setup.
add_superfences_with_mermaid_if_missing() {
  local config="$1"
  # If pymdownx.superfences already present (string or map), leave it alone
  if yq -e 'has("markdown_extensions")' "$config" &>/dev/null && {
    yq '.markdown_extensions[] | select(. == "pymdownx.superfences" or (tag == "!!map" and has("pymdownx.superfences")))' \
      "$config" 2>/dev/null | \
      grep -q .
  }; then
    return
  fi
  # Write a YAML snippet with the !!python/name tag (cannot be constructed
  # inline in yq expressions) and load it for the merge.
  cat > "${TMP_DIR}"/superfences-mermaid.yml <<'SFEOF'
- pymdownx.superfences:
    custom_fences:
      - name: mermaid
        class: mermaid
        format: !!python/name:pymdownx.superfences.fence_code_format
SFEOF
  yq -i '.markdown_extensions = ((.markdown_extensions // []) + load("'"${TMP_DIR}"'/superfences-mermaid.yml"))' "$config"
}

# A CSV of plugins to be excluded.
# Usage: get_user_plugins "plugin1,plugin2,etc" < mkdocs.yml
get_user_plugins() {
  input=$(cat)
  if [ "$(echo "$input" | yq 'has("plugins")')" != "true" ]; then
    echo "plugins key does not exist" >&2
    return 1
  fi
  # Convert CSV to YAML array: "a,b,c" -> ["a", "b", "c"]
  if [ -z "${1:-}" ]; then
    exclude="[]"
  else
    # shellcheck disable=SC2001
    exclude="[\"$(echo "$1" | sed 's/,/", "/g')\"]"
  fi
  echo "$input" | \
    yq "($exclude) as \$exclude |
      .plugins |= map(
        select(
          (tag == \"!!str\" and ((\$exclude - [.]) | length) == (\$exclude | length)) or
          (tag == \"!!map\" and ((keys | map(select((\$exclude - [.]) | length == (\$exclude | length))) | length) == (keys | length))) or
          (tag != \"!!str\" and tag != \"!!map\")
        )
      ) | pick([\"plugins\"])"
}

install_techdocs() (
  if [ -f ~/.techdocs/current ] && [ "$(< ~/.techdocs/current)" = dev ]; then
    exit
  fi
  if [ -n "${FORCE_UPDATE:-}" ]; then
    true
  elif [ -d ~/.techdocs/python3 ]; then
    if [ -f ~/.techdocs/current ] && [ "$(< ~/.techdocs/current)" = "$WYSIWYG_VERSION" ]; then
      exit
    fi
  else
    mkdir -p ~/.techdocs
    uv venv --python 3.13 ~/.techdocs/python3
  fi
  # shellcheck disable=SC1090
  source ~/.techdocs/python3/bin/activate
  pip install \
    mkdocs-techdocs-core==1.5.3 \
    mkdocs-same-dir==0.1.3 \
    mkdocs-gen-files==0.5.0 \
    mkdocstrings==0.28.2 \
    mkdocstrings-python==1.16.2 \
    mkdocs-nav-weight==0.3.0 \
    griffe==1.6.0

  pip install websockets==16.0 \
    mkdocs-live-edit-plugin==0.4.1 \
    mkdocs-live-wysiwyg-plugin=="$WYSIWYG_VERSION"

  echo "$WYSIWYG_VERSION" > ~/.techdocs/current
)

serve() (
  # shellcheck disable=SC1090
  source ~/.techdocs/python3/bin/activate
  mkdocs_config > "${TMP_DIR}"/mkdocs.yml
  mv "${TMP_DIR}"/mkdocs.yml mkdocs.yml
  set -x
  TMPDIR="${TMP_DIR}" mkdocs serve \
    -f mkdocs.yml \
    -a "${TECHDOCS_HOST}:${TECHDOCS_PORT}" \
    --livereload \
    --open \
    "$@"
)
build() (
  # shellcheck disable=SC1090
  source ~/.techdocs/python3/bin/activate
  mkdocs_config | TMPDIR="${TMP_DIR}" mkdocs build -f - "$@"
)

mkdocs_config() {
  cp -a mkdocs.yml "${TMP_DIR}"/original-mkdocs.yml
  if ! {
    # get user plugins excluding search, etc
    get_user_plugins "search,techdocs-core,live-edit,live-wysiwyg" \
      < "${TMP_DIR}"/original-mkdocs.yml \
      > "${TMP_DIR}"/user-plugins.yml
  } &> /dev/null; then
    rm "${TMP_DIR}"/user-plugins.yml
  elif [ "$(yq '.plugins | length' "${TMP_DIR}"/user-plugins.yml)" -lt 1 ]; then
    rm "${TMP_DIR}"/user-plugins.yml
  fi
  # Resolve effective theme name
  local user_theme_name=material
  if [ -n "${USE_USER_THEME:-}" ]; then
    if yq -e '.theme | tag == "!!str"' "${TMP_DIR}"/original-mkdocs.yml &>/dev/null; then
      user_theme_name="$(yq '.theme' "${TMP_DIR}"/original-mkdocs.yml)"
    elif yq -e '.theme.name' "${TMP_DIR}"/original-mkdocs.yml &>/dev/null; then
      user_theme_name="$(yq '.theme.name' "${TMP_DIR}"/original-mkdocs.yml)"
    fi
  fi
  # Build plugins section; techdocs-core is material-only
  local nav_weight_plugin=""
  if [ -n "${MKDOCS_YML_AUTO_GENERATED:-}" ]; then
    nav_weight_plugin="
  - mkdocs-nav-weight"
  fi
  local plugins_block
  if [ "$user_theme_name" = "material" ]; then
    plugins_block="plugins:
  - search
  - techdocs-core:
      use_material_search: true
      use_pymdownx_blocks: true${nav_weight_plugin}
  - live-edit:
      user_docs_dir: \"${PWD}/docs\"
      websockets_port: ${TECHDOCS_WEBSOCKET_PORT}
  - live-wysiwyg"
  else
    plugins_block="plugins:
  - search${nav_weight_plugin}
  - live-edit:
      user_docs_dir: \"${PWD}/docs\"
      websockets_port: ${TECHDOCS_WEBSOCKET_PORT}
  - live-wysiwyg"
  fi
cat > "${TMP_DIR}"/rendered-mkdocs.yml <<EOF
################################################################################
# DO NOT EDIT THIS FILE while techdocs-preview.sh is running.
#
# WARNING: This entire mkdocs.yml file will be deleted.  The original will be
# restored overwriting this file when techdocs-preview.sh shuts down.
#
# If you want to edit your mkdocs.yml, then do so after shutting down
# techdocs-preview.sh and then restart the techdocs-preview.sh server.
################################################################################
$(yq 'del(.plugins)' < "${TMP_DIR}"/original-mkdocs.yml)
${plugins_block}
EOF
# site_url: 'http://${TECHDOCS_HOST}:${TECHDOCS_PORT}'
  if [ -n "${USE_USER_THEME:-}" ]; then
    # --theme: merge user theme on top of material defaults
    cat > "${TMP_DIR}"/theme.yml <<'THEME'
theme:
  name: material
THEME
    # Normalize string theme (e.g. "theme: material") to map form
    if yq -e '.theme | tag == "!!str"' "${TMP_DIR}"/rendered-mkdocs.yml &>/dev/null; then
      yq -i '.theme = {"name": .theme}' "${TMP_DIR}"/rendered-mkdocs.yml
    fi
    if yq -e '.theme' "${TMP_DIR}"/rendered-mkdocs.yml &>/dev/null; then
      yq '{"theme": (.theme * load("'"${TMP_DIR}"'/rendered-mkdocs.yml").theme)}' \
        "${TMP_DIR}"/theme.yml > "${TMP_DIR}"/merged-theme.yml
    else
      cp "${TMP_DIR}"/theme.yml "${TMP_DIR}"/merged-theme.yml
    fi
    yq -i '. * load("'"${TMP_DIR}"'/merged-theme.yml")' "${TMP_DIR}"/rendered-mkdocs.yml
    # Default palette only if material and user hasn't defined one
    if [ "$user_theme_name" = "material" ] && \
       ! yq -e '.theme.palette' "${TMP_DIR}"/rendered-mkdocs.yml &>/dev/null; then
      yq -i '.theme.palette = [
        {"media": "(prefers-color-scheme: light)", "scheme": "default", "toggle": {"icon": "material/brightness-7", "name": "Switch to dark mode"}},
        {"media": "(prefers-color-scheme: dark)", "scheme": "slate", "toggle": {"icon": "material/brightness-4", "name": "Switch to light mode"}}
      ]' "${TMP_DIR}"/rendered-mkdocs.yml
    fi
  else
    # No --theme: force material with default palette
    yq -i '.theme = {
      "name": "material",
      "palette": [
        {"media": "(prefers-color-scheme: light)", "scheme": "default", "toggle": {"icon": "material/brightness-7", "name": "Switch to dark mode"}},
        {"media": "(prefers-color-scheme: dark)", "scheme": "slate", "toggle": {"icon": "material/brightness-4", "name": "Switch to light mode"}}
      ]
    }' "${TMP_DIR}"/rendered-mkdocs.yml
  fi
  # techdocs-core overrides the theme in on_config; restore hook needed when present
  if [ "$user_theme_name" = "material" ]; then
    yq '.theme' "${TMP_DIR}"/rendered-mkdocs.yml > "${TMP_DIR}"/theme-config.yml
    cat > "${TMP_DIR}"/restore_theme.py <<'PYEOF'
import os
import yaml

def on_config(config):
    theme_file = os.path.join(os.environ.get('TMP_DIR', ''), 'theme-config.yml')
    if not os.path.exists(theme_file):
        return config
    with open(theme_file) as f:
        saved_theme = yaml.safe_load(f)
    if not saved_theme:
        return config
    for key, value in saved_theme.items():
        if key != 'name':
            config['theme'][key] = value
    return config
PYEOF
    yq -i '.hooks = ((.hooks // []) + ["'"${TMP_DIR}"'/restore_theme.py"])' \
      "${TMP_DIR}"/rendered-mkdocs.yml
  fi
  add_markdown_extension_if_missing admonition "${TMP_DIR}"/rendered-mkdocs.yml
  add_markdown_extension_if_missing pymdownx.details "${TMP_DIR}"/rendered-mkdocs.yml
  add_superfences_with_mermaid_if_missing "${TMP_DIR}"/rendered-mkdocs.yml
  if [ -f "${TMP_DIR}"/user-plugins.yml ]; then
    merge_user_plugins "${TMP_DIR}"/user-plugins.yml < "${TMP_DIR}"/rendered-mkdocs.yml
  else
    cat "${TMP_DIR}"/rendered-mkdocs.yml
  fi
}

add_plugins() (
  if [ "$#" -lt 1 ]; then
    echo 'ERROR: No pypi packages provided; at least one arg required.' >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source ~/.techdocs/python3/bin/activate
  set -x
  pip install "$@"
  set +x
  for _arg in "$@"; do
    case "$_arg" in -*) continue ;; esac
    if [ -d "$_arg"/mkdocs_live_wysiwyg_plugin ]; then
      echo dev > ~/.techdocs/current
      break
    fi
  done
)

init_data() {
cat << 'EO_EXAMPLE_DOCS'
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
EO_EXAMPLE_DOCS
}

base64_decode() {
  if command -v base64 &> /dev/null; then
    base64 -d 2>/dev/null || base64 -D
  elif command -v openssl &> /dev/null; then
    openssl enc -base64 -d -A
  else
    echo 'ERROR: No base64 decoder found (need base64 or openssl).' >&2
    return 1
  fi
}

init_docs() {
  if [ -f mkdocs.yml ]; then
    echo 'ERROR: mkdocs.yml already exists. Cannot init where documentation is already present.' >&2
    exit 1
  fi
  if [ -d docs ]; then
    echo 'ERROR: docs/ directory already exists. Cannot init where documentation is already present.' >&2
    exit 1
  fi
  init_data | base64_decode | gzip -d | tar xf -
  if [ ! -f .gitignore ]; then
    printf '%s\n' site > .gitignore
  elif ! grep -qx site .gitignore; then
    printf '%s\n' site >> .gitignore
  fi
  echo 'Initialized example MkDocs documentation.'
}

#
# MAIN
#
if [ -n "${SKIP_NEXUS:-}" ]; then
  unset pip
fi
# Parse flags
USE_USER_THEME=
USE_CURRENT_DIR=
READONLY_MODE=
ASSET_PATHS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --theme)
      USE_USER_THEME=1
      shift
      ;;
    -c|--current-dir)
      USE_CURRENT_DIR=1
      shift
      ;;
    -r|--readonly)
      READONLY_MODE=1
      shift
      ;;
    -a|--assets)
      shift
      until [ $# -eq 0 ] || [ ! -e "$1" ]; do
        ASSET_PATHS+=("$1")
        shift
      done
      ;;
    *)
      break
      ;;
  esac
done
export USE_USER_THEME
case "${1:-}" in
  -h|--help|help)
    cat<<'EOF'
SYNOPSIS
  techdocs-preview.sh
  techdocs-preview.sh [-c|--current-dir] [-r|--readonly] [-a|--assets path...]
  techdocs-preview.sh serve [additional mkdocs options]
  techdocs-preview.sh build [additional mkdocs options]
  techdocs-preview.sh add_plugins [mkdocs-pypi-package...]
  techdocs-preview.sh build --help
  techdocs-preview.sh serve --help
  techdocs-preview.sh init
  techdocs-preview.sh uninstall
  techdocs-preview.sh upgrade

DESCRIPTION
  Run techdocs or create a techdocs preview using a lightweight python
  environment.

  With no options "serve" is the default and a browser link will be opened.

  If no docs/ directory exists, one is auto-generated from top-level *.md
  files (e.g. README.md).  Each file gets a title: frontmatter header
  preserving its filename.  On exit, edited files are restored to the
  project root with frontmatter stripped and docs/ is removed.

OPTIONS
  -a, --assets path...
    Copy additional files or directories into the auto-generated docs/
    directory using tar.  Accepts one or more existing paths following the
    flag; consumption stops at the first non-existent path or next flag.
    Complements -c for providing images or other assets to markdown content.

    Example:
      techdocs-preview.sh -c -a images/ diagrams/arch.png

  -c, --current-dir
    Force auto-generation of a temporary docs/ directory from *.md files in
    the current directory, even if a docs/ directory already exists.  The
    existing docs/ directory is left untouched; a temporary one is created
    instead.  Useful for editing standalone markdown files like README.md.
    On exit, edited files are restored to the current directory with
    frontmatter stripped and the temporary docs/ is removed.

  -r, --readonly
    Only meaningful with -c.  Prevents edited files from being copied back
    to the original directory on exit.  All changes made in the temporary
    docs/ directory are discarded.  Useful for testing or previewing without
    risk of modifying the source files.

  --theme
    Prioritize the theme defined in your mkdocs.yml.  Without this flag the
    Material theme with a default light/dark palette is always used regardless
    of mkdocs.yml settings.  With this flag, your mkdocs.yml theme.name,
    theme.palette, and other theme options take precedence.

SUB_COMMANDS
  init
    Initialize example MkDocs documentation in the current directory.  Creates
    mkdocs.yml and docs/ from a built-in template.  Errors if either already
    exists.  Also adds "site" to .gitignore if not already present.

  add_plugin
    Alias to add_plugins.

  add_plugins
    pip install new plugins.  If uv available, then uv pip install.  Additional
    options will be passed through to "pip install" or "uv pip install".

  build
    Runs mkdocs build.  Additional options will be passed through to mkdocs
    build.

  serve
    Runs mkdocs serve.  Additional options will be passed through to mkdocs
    serve.

  uninstall
    Deletes ~/.techdocs directory.  Where the virtualenv is stored.

  upgrade
    pip install mkdocs packages again in case there's upgrades within this
    script.  If uv available, then uv pip install will be run to upgrade mkdocs
    packages.

EXAMPLES
  Render a mkdocs site.

    techdocs-preview.sh

  If there's errors, then you may need to add extra mkdocs plugins from pypi.

    techdocs-preview.sh add_plugins \
      mdx_breakless_lists mkdocs-awesome-pages-plugin \
      mkdocs-exclude mkdocs-macros-plugin

  You can also upgrade existing python dependencies if the ones provided by
  this script are not new enough for you.  It's a pass-through to pip install.

    techdocs-preview.sh add_plugins --upgrade mkdocs
EOF
    exit
    ;;
esac
if {
  case "${1:-}" in
    add_plugin*|upgrade|uninstall|init)
      false
      ;;
    *)
      [ ! -f mkdocs.yml ]
      ;;
  esac
}; then
  # Generate minimal mkdocs.yml for serve/build; will be removed on exit
  if [ -z "${site_name:-}" ]; then
    site_name="${PWD##*/}"
  fi
  printf 'site_name: "%s"\ndocs_dir: docs\n' "${site_name}" > mkdocs.yml
  export MKDOCS_YML_AUTO_GENERATED=1
fi
if { [ ! -d docs ] || [ -n "${USE_CURRENT_DIR:-}" ]; } && {
  case "${1:-}" in
    uninstall|add_plugin*|init)
      false
      ;;
    *)
      true
      ;;
  esac
}; then
  # Auto-generate docs/ from top-level *.md files
  # shellcheck disable=SC2046
  set -- $(printf '%s\n' *.md)
  if [ "$1" = '*.md' ]; then
    echo 'No *.md files found in the current directory.' >&2
    exit 1
  fi
  mkdir "${TMP_DIR}/docs"
  for _md in "$@"; do
    printf -- '---\nfull_path: %s\ntitle: %s\n---\n' "${PWD}/$_md" "$_md" | cat - "$_md" > "${TMP_DIR}/docs/$_md"
  done
  unset _md
  set --
  if [ ${#ASSET_PATHS[@]} -gt 0 ]; then
    tar -c "${ASSET_PATHS[@]}" | tar -xC "${TMP_DIR}/docs"
  fi
  export DOCS_DIR_AUTO_GENERATED=1
  export site_name="${PWD##*/}"
  if [ -n "${READONLY_MODE:-}" ]; then
    site_name="READONLY ${site_name}"
  fi
  pushd "${TMP_DIR}" > /dev/null
  if [ -x ~1/"$0" ]; then
    DOCS_DIR_AUTO_GENERATED="" ~1/"$0" || true
  else
    DOCS_DIR_AUTO_GENERATED="" "${0}" || true
  fi
  popd > /dev/null
  if [ -n "${READONLY_MODE:-}" ]; then
    echo 'Read-only mode: changes discarded.' >&2
  else
    find "${TMP_DIR}"/docs -name '*.md' -type f | while IFS= read -r _doc; do
      _dest="$(sed -n '2s/^full_path: //p' "$_doc")"
      if [ -n "$_dest" ]; then
        if head -n 1 "$_doc" | grep -q '^---$'; then
          awk 'BEGIN{fm=0} /^---$/{fm++;next} fm>=2{print}' "$_doc" > "$_dest"
        else
          cp "$_doc" "$_dest"
        fi
      fi
    done
    echo 'Edited markdown files restored.' >&2
  fi
  unset DOCS_DIR_AUTO_GENERATED
  exit
fi
if [ "${1:-}" = init ]; then
  shift
  init_docs
  exit
fi
export expanded_help=1
if [ "${1:-}" = add_plugins ] || [ "${1:-}" = add_plugin ]; then
  shift
  install_techdocs
  add_plugins "$@"
elif [ "${1:-}" = upgrade ]; then
  FORCE_UPDATE=1 install_techdocs
elif [ "${1:-}" = build ]; then
  shift
  default_ports
  install_techdocs
  build "$@"
elif [ "${1:-}" = uninstall ]; then
  (
    set -x
    rm -rf ~/.techdocs
  )
else
  if [ "${1:-}" = serve ]; then
    shift
  fi
  resolve_ports
  install_techdocs
  serve "$@"
fi
