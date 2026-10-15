#!/usr/bin/env bash
# Builds the pinned zmac (gp48k/zmac, CC0) into tools/zmac/zmac. Idempotent.
# Needs git, make, a C compiler, and bison. Tests use FUGLOY_ZMAC to name another binary.
set -euo pipefail
ZMAC_REPO=https://github.com/gp48k/zmac
ZMAC_COMMIT=050bbb1f9c608693d53b8827b991b5a9edc97a6b
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/tools/zmac"
if [ -x "$DEST/zmac" ] && [ "$(cat "$DEST/COMMIT" 2>/dev/null || true)" = "$ZMAC_COMMIT" ]; then
  echo "zmac $ZMAC_COMMIT already at $DEST/zmac"
  exit 0
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git clone -q "$ZMAC_REPO" "$WORK/zmac"
git -C "$WORK/zmac" checkout -q "$ZMAC_COMMIT"
# The Makefile names gcc, which is clang on macOS; the old-style C needs these flags there.
make -C "$WORK/zmac/src" zmac CC="${CC:-cc}" CFLAGS="${ZMAC_CFLAGS:--O2 -Wno-implicit-function-declaration -Wno-implicit-int -Wno-deprecated-non-prototype -Wno-return-type}"
mkdir -p "$DEST"
cp "$WORK/zmac/src/zmac" "$DEST/zmac"
echo "$ZMAC_COMMIT" > "$DEST/COMMIT"
echo "built zmac $ZMAC_COMMIT at $DEST/zmac"
