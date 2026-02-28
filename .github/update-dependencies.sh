#!/bin/bash
set -euxo pipefail

download-utilities.sh --update .github/download-utilities.yml
download-utilities.sh --checksum -I Linux:aarch64 -I Linux:x86_64 -I Darwin:arm64 -I Darwin:x86_64 .github/download-utilities.yml
