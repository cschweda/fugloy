#!/usr/bin/env bash
# Downloads trsjs (trsemu-1.6.js, Peter Phillips's in-browser TRS-80 emulator, https://trsjs.48k.ca/)
# into tools/trsjs/, checked by SHA-256. Idempotent. It is the reference for emu phase 7's
# differential harness (packages/emu/test/diff/). It carries no license, so it is fetched on demand,
# used only locally, and never committed, bundled, or redistributed.
set -euo pipefail
URL=https://trsjs.48k.ca/trsemu-1.6.js
WANT=d6e5b270ba23d429c8fe548573b680a1c8b2b1a8e11d65886c4fb9778ac052fc
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/tools/trsjs"
NAME=trsemu-1.6.js
mkdir -p "$DEST"
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
if [ -f "$DEST/$NAME" ] && [ "$(sha "$DEST/$NAME")" = "$WANT" ]; then
  echo "$NAME already at $DEST/$NAME"
  exit 0
fi
curl -fsSL "$URL" -o "$DEST/$NAME.part"
GOT=$(sha "$DEST/$NAME.part")
if [ "$GOT" != "$WANT" ]; then
  rm -f "$DEST/$NAME.part"
  echo "install-trsjs: $NAME has SHA-256 $GOT, expected $WANT (the file at $URL changed; check it before pinning a new hash)" >&2
  exit 1
fi
mv "$DEST/$NAME.part" "$DEST/$NAME"
echo "fetched $NAME to $DEST/$NAME"
