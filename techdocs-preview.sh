#!/bin/bash
# Created by Sam Gleske
# Wed Apr  2 11:56:47 EDT 2025
# GNU bash, version 3.2.57(1)-release (arm64-apple-darwin23)
# Python 3.13.1

set -euo pipefail

# since rapidly developing I'll track this at the top for now
WYSIWYG_VERSION=0.3.26
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
  gh: 2.89.0
  uv: 0.11.2
  yq: 4.52.5
checksums:
  uv:
    unknown-linux-gnu:
      x86_64: 5c339318bf969cb34848d7616a0c9e6ab27478a8b5cb46dd3ae94d182ea5aa8d
      aarch64: 6df7e4d21f3bba10f46a202d0bd04e2c59408b0a7c8e71c352384f28a4f050f2
    apple-darwin:
      aarch64: 65910fd6aad18674516122e077a932248c672ff849dc2946045d69326480e3e6
      x86_64: 597464488a968dba4f4173ccf95728d000616b2730c8ee00657df5a58f7f3a68
    pc-windows-msvc:
      x86_64: 8881afb877996a1373a12e816395122a8d39a3ac06cd066272acdb49510cf0fe
      aarch64: 45ba7b72a7435343d650c73d21d65d2e8bdda47f6bd39af00e37f3cb70aa79ef
  yq:
    darwin:
      arm64: 45a12e64d4bd8a31c72ee1b889e81f1b1110e801baad3d6f030c111db0068de0
      amd64: 6e399d1eb466860c3202d231727197fdce055888c5c7bec6964156983dd1559d
    linux:
      arm64: 90fa510c50ee8ca75544dbfffed10c88ed59b36834df35916520cddc623d9aaa
      amd64: 75d893a0d5940d1019cb7cdc60001d9e876623852c31cfc6267047bc31149fa9
    windows:
      arm64: 236867affa7f18701d4c763cf16b6df962cf4f7e89a8570a5954cf94a38f41c7
      amd64: 47594981f3848a4b4447494adeca9555f908f7cf0a89c4da3fd0243a4631da1c
  gh:
    linux:
      arm64: cd07f11ff1cfe58ecc6c172c06fa2986d5574b1fe7e1e00229632d1f18b4b63d
      amd64: 540cffbf2146101a713284bc06427efbf370a40756c0356e3a0f8d1e038e7122
    macOS:
      arm64: 91d2de52d3aa2d87fe6b8baf18f20500031b337885642d2df225134bd0544acf
      amd64: b3cbc5defffe19cfe53b60232d325ed2c5cea57f1c1c1140e3e213e3b832a6c6
    windows:
      arm64: ''
      amd64: ''

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
    os:
      Linux: unknown-linux-gnu
      Darwin: apple-darwin
      Windows: pc-windows-msvc
    arch:
      arm64: aarch64
    extension:
      default: tar.gz
      pc-windows-msvc: zip
    download: '${GITHUB_DOWNLOAD_MIRROR:-https://github.com}/astral-sh/uv/releases/download/${version}/uv-${arch}-${os}.${extension}'
    extract:
      default: tar -xzC ${dest}/ --no-same-owner --strip-components=1 uv-${arch}-${os}/uv
      pc-windows-msvc: |
        {
          cat > /tmp/file.zip
          unzip -o -j -d ${dest} /tmp/file.zip uv.exe
        }
  yq:
    <<: *defaults
    os:
      Linux: linux
      Darwin: darwin
      Windows: windows
    arch:
      x86_64: amd64
      aarch64: arm64
      Darwin:
        i386: amd64
    extension:
      windows: .exe
    download: '${GITHUB_DOWNLOAD_MIRROR:-https://github.com}/mikefarah/yq/releases/download/v${version}/yq_${os}_${arch}${extension}'
  gh:
    <<: *defaults
    os:
      Linux: linux
      Darwin: macOS
      Windows: windows
    arch:
      x86_64: amd64
      aarch64: arm64
    extension:
      default: tar.gz
      macOS: zip
      windows: zip
    download: '${GITHUB_DOWNLOAD_MIRROR:-https://github.com}/cli/cli/releases/download/v${version}/gh_${version}_${os}_${arch}.${extension}'
    default_download_extract: |
      trap '[ ! -f /tmp/file.zip ] || rm -f /tmp/file.zip' EXIT
      curl -sSfL ${download} | ${extract}
    extract:
      macOS: |
        {
          cat > /tmp/file.zip
          unzip -o -j -d ${dest} /tmp/file.zip '*/bin/gh'
        }
      linux: tar -xzC ${dest}/ --no-same-owner --strip-components=2 gh_${version}_${os}_${arch}/bin/gh
      windows: |
        {
          cat > /tmp/file.zip
          unzip -o -j -d ${dest} /tmp/file.zip 'bin/gh.exe'
        }
    pre_command: |
      if [ "${checksum_failed:-true}" = true ]; then
        rm -f ${dest}/${utility}
      fi
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
H4sIAAAAAAACA+1a/2/bNhbPz/ormOSHttdYi504BYzDDjl3XXK77IpzgKIYhpiWaIuwJGokFcf3
19/nkZQsOym6AZfshlloG1t8fN/53ucxLZapSky8LvKDZ3tO8Vycn9PP/rthv/vTPcNB/6A/7F+c
nV6cDQbDg9P+YHh2esBOD17gqY3lGqrouiyF/jLd19b/oI+RVtyVvBAj9lnVmr1XSV2I0nIrVckm
WI2qvF7I0owixnqscPnSK/l9byXkIrORzQR2Y3EuuK21cIREmqjSglOcqFTEvCwVmIqo4BosVuWd
eMCqgZTAmaeFKiWJdV+rdUFkD3EqLJe52X5p6krouSiTRhxjCSKpirvtl7TJW1cIXXCZtu+xIefG
PLUwV3hjR+zwsFrbTJXfOA5PyY7djzuy8M7viv5g8adofvPMMuiMvxsOv3j+8eyc//758N0BG+7P
/8vEf67yVOhny4PfHv+zfn+4j/+Lx3+hFWpb2msqd5G+RP/vn/cHO/G/GA4H+/7/Ek+v14ustDk6
5OVM1ZZ9TzkgywUb+ySIfJsfsf7paUTUxxuSkCdMlowzn0RRBBjBEl4yl0xMixxdP+2QWsVMPQsp
F0fR8TH7kd+zG1HWUXSbifYbAwABuGC5mFvG81ytDFuDORhoofSCl/I/omXMDSuFSEUaM3Y9d4SZ
uheauX94uWbAMgWpSjyBX9D4IQN0r/KcGSHw11pYZUCcMq41yeNVJbgGy8vwXQuCB6xQ9+SAdAst
0Z66JAVGbjtBghXX6YhpcqHnyV7LWMTQI8W+N2wlIT3RgE4CPmwdw7wM4ZRtpHjndai6puYpm1xd
f7h9uysbHErY7iXxfMXX5gmBPhCXNSAUjElat2ox54lVGtZG0b8bt5PtpFlDtZI2cy/a2HlpDTtE
b92y6u40TM0ptm2ebHkU9n0AvXjgRZWLk8br/CmP9ILjnhA8lw9MQahu9xm2ymSSsVyWS8onaePo
4E/5bNV/SsqH/1XV//Xz3+DsfKf+nw/Ph/v6/8L1f1JXldLW1bdJW6EjLdw6VRJdi0gUlV2Hz01r
GITWcJtJgzKauGqYUOE1OKF+MHIF0nWYp+W4qitxMpvK8Gc9kb/D+X+mc/8rz//54Lz/GP/39+f/
d8F/15QL7CNfCBPg3nVptUprd6qj6PDwkP1SC+MOtCzRQQUTOLpHVyKvdgBRgCI470LfOQw0OnL3
LATzMqKXiePiIIFVVa9QxnpgZjKHt9DMs0eMY69GqYBhjgJO9btaiR1B00Ax9SQoQsBV23gy4KFS
rHYhHSzT4l5iQTxIYx+BPqiyZSWBVXeV5jCwFnR15KyjizbmPM1maw9NidmaLt0KVRvhgerRF27h
4iMH0L5LpfXgC5W2UWSDuQWWt9dclXVC1KpkVa0rZYSJf6tnCgXgW1FSOKB4zCYZSnhSWxP5qt/K
84DW2WIUbDcNITb22KgS5aKW5eifsqwfnHs/ofqQQLcx4/edLR5XTsdW51O2FOuYOACSU7be8ORf
Ewa/Ge9e3pXFZnUHlE7HN+/D/mgLT8K3Xg8n4u14yiT1n2rtFMMqhHjugTGtEzeQ0kxAg0Mrcq5V
gVyFn7BR1cETM8wvyBsg264tpN46xAwQVugk4+Wi0bRLSeETcOa6lRQC8AEON+xGpWIT/kTlOa+Q
ShROar3MJaWfoOgd9tIxndcdxUcUlx/EeqYwLmws9S6ZZHJu336YUipYtVjkfvyZk/DNVEe+8BlD
CXiyNRrQT/gYGQ4kTri8ZxBjQ6H0IuIpe00fGDSVKn3DDOxPMhfXbmLNhF0JjDKfPk+uP33+3oXo
JlwmIz/TkJqdGcbyGfTFgNFACl82CJFsVa7bXbpm8vRjWzjfu/XrEffm5JCDfqllsqQpUy54qJRG
po7cOafWKA0WHlE4EJ2xByZcl2zqb9mn3pNPCNoabypV1TQ8IeB+lgoIDKdAQCHHYy41CmsDzeDW
qwHeY1xdZOzqIpQDFGCkyr3I2U/dmv/z62PZ+frGbe9vZs85DrAvMY81LRXLFTJbUykkmHfSzqOS
9Es4VT7rjg3N1n5Mu+pvbAjNYZMGa1bgQPGlCDPcStWYfWeoU8uNY55QRZZBB9RPZzAUwB/eepuC
ppcur9BZ2omUMp9oKbWV3r2woITiM2M1RtsmqY5Cxvhe8GNz1dC5zthkUbv6tQuOE+a6kHeQq8Qn
TtVKC0N+aR2m5j4Yu22qlZTxALIfbM19e0UNQEBDFcyRulPS9hEgiKNBjHqN6sQR9ZyuTHKIFWlb
zICSqNA+WUv+Nm0i5gqja391tavKrt57iP78+D+VfKF5YZ5pBPja/e/w0fx/Nnx3tsf/L4z/xwT1
6FC+D+nQzvdn7dXvjf9laUNSEPltTfeDPO/gkAAaA3GbXoz9A+5uyqRdV0A8eOifhtZ9dxewu9vD
zV5zIUvFc66oaJIOu7RAA4mWM/REjBGuOnWFbnAtb3dQGjjrHepn7poDdVbTapWhflLdv6J2+ngz
FjcmRIZ+zx0c1LsfuFLv3gFpOOlaAn3+daa/nfFkiWa1NOw19r85okvsiYWZ3T0fUeANUf/9cvzD
5OPl+Dv64noEcCEBrNQzyxUgB3AGXsaO1Y27Lt2RTya+Cqq+on0rX89NxRPHJ1EEjm3A1cFCx2+s
uckix++nv/zMer1vO9q6T+4d1nbedBTxH3f2dl56GfTSfWoZwj8uAreaLvIJX0fROIThUbRa4IO2
7aJOCWWxk656nYM2I1EwEBnVZG/BH2RBnZfsl/RfEtCamjSh316IBqcYN0dsMEqgaZDCvrvsn/2z
f/6fn/8CnGmP6gAoAAA=
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
