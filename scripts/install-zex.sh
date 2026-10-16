#!/usr/bin/env bash
# Downloads ZEXDOC and ZEXALL (Frank Cringle's Z80 instruction exercisers, GPL-2.0, from
# agn453/ZEXALL) into tools/zex/, pinned to one commit and checked by SHA-256. Idempotent.
# They are never committed.
set -euo pipefail
ZEX_COMMIT=8f71d418bae69a476a5a0e5c6e122c8801b8d9f4
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/tools/zex"
mkdir -p "$DEST"
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
fetch() {
  local name=$1 want=$2
  if [ -f "$DEST/$name" ] && [ "$(sha "$DEST/$name")" = "$want" ]; then
    echo "$name already at $DEST/$name"
    return
  fi
  curl -fsSL "https://raw.githubusercontent.com/agn453/ZEXALL/$ZEX_COMMIT/$name" -o "$DEST/$name.part"
  local got
  got=$(sha "$DEST/$name.part")
  if [ "$got" != "$want" ]; then
    rm -f "$DEST/$name.part"
    echo "install-zex: $name has SHA-256 $got, expected $want" >&2
    exit 1
  fi
  mv "$DEST/$name.part" "$DEST/$name"
  echo "fetched $name to $DEST/$name"
}
fetch zexdoc.com 34923a7ed82285d3038b2d54bd64899e12173eebb61f9d07b4fc72e78af2ae8f
fetch zexall.com 6e2da55147a04f28d303d5da6a1e6b771557ac244653590a0f24a2d39c8537e8
