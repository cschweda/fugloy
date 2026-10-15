# Phase 2A: Pass 1 and the Round-Trip Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recursive-descent Pass 1 over the memory image, a zmac emitter with absolute operands, a JSON IR, a Pass 1 listing, CLI flags for them, and a pinned-zmac harness that proves every synthetic fixture, every Z80 encoding, and every present real sample round-trips to an identical image and bitmap.

**Architecture:** Pass 1 writes a byte-kind map (`Uint8Array(65536)`) parallel to the image plus an instruction-start map and a table of decoded instructions; regions, basic blocks, the IR, the emitter, and the listing are views over it. The round-trip harness assembles emitted source with a zmac built from a pinned commit into gitignored `tools/`, loads the resulting `.cmd` with our own loader, and compares images, never files.

**Tech Stack:** TypeScript strict ESM in `packages/disasm` and `packages/cli`, Vitest, `@fugloy/z80` decoder/formatter, zmac (`gp48k/zmac` @ `050bbb1f9c608693d53b8827b991b5a9edc97a6b`, CC0) built by a shell script, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-15-phase2a-pass1-roundtrip-design.md` (binding), under `docs/Fugloy-Project-Plan.md` and `CLAUDE.md`.

## Global Constraints

- `packages/z80` and `packages/disasm` `src/`: no Node or DOM APIs, no runtime dependencies (CLAUDE.md). Harness and scripts are test-side or `scripts/`.
- The image stays a `Uint8Array(65536)` with a parallel bitmap; the kind map is the same shape (spec §3).
- Addresses print `$3C00` in prose and comments, `3C00H` in emitted assembly (CLAUDE.md).
- Descent path ends: `RET`/`RETI`/`RETN`, indirect `JP`, unconditional `JP`/`JR`, `HALT`; first decode wins; targets outside loaded memory are externals; the byte after `RST 08H` is data (spec §3).
- Emitted text must assemble back to the same bytes under the pinned zmac; otherwise emit `DB` (spec §3). Only `SLL` and IX/IY halves among undocumented forms are emitted as instructions.
- zmac pinned at `050bbb1f9c608693d53b8827b991b5a9edc97a6b`; `tools/` gitignored; tests skip without zmac except in CI, where `FUGLOY_REQUIRE_ZMAC=1` turns a skip into a failure (spec §4.9).
- Round-trip compares `bytes`, `loaded`, and `entry` (when the original has one), never files (spec §3).
- Loaders, memory image, and phase-1 listings are unchanged in behavior; `fugloy <file>` without flags now prints the Pass 1 listing for `.CMD` and raw files and the unchanged detokenized listing for `.BAS`.
- Commit messages: imperative, one line, `p2:` prefix, no AI attribution trailers.
- Nothing from sub-projects B or C: no labels, hints, strings, jump tables, hidden-code roots.

## Review Focus

Inputs the spec implies but the tasks' named tests might not exercise; each gets a test in its owning task:

1. A jump or call target in a different loaded run (non-contiguous image): descent must follow it across the gap. (Task 3)
2. A branch to its own address (`JR $`) and a two-instruction loop: descent must terminate without re-marking. (Task 3)
3. Two roots whose instruction streams overlap at different offsets (ARMOUR.III's patched `$B801` is this): first decode wins, the second path stops with an `overlap` diagnostic, and the emitter still covers every byte exactly once. (Tasks 3, 4)
4. An unknown run longer than eight bytes that ends one byte before an instruction start: `DB` rows must not swallow the instruction's first byte. (Task 4)
5. `--entry` pointing at unloaded memory or malformed: exit 2 with a message naming the flag, nothing printed to stdout. (Task 7)

---

## File structure

```
scripts/install-zmac.sh                     clone at pin, make, install tools/zmac/zmac (+COMMIT)
tools/                                      gitignored
.github/workflows/ci.yml                    bison, cache, zmac:install, FUGLOY_REQUIRE_ZMAC
packages/disasm/src/analysis/map.ts         Kind, ByteMap
packages/disasm/src/analysis/descent.ts     recursiveDescent, Pass1, Xref, Diagnostic
packages/disasm/src/analysis/regions.ts     regions(), basicBlocks(), Region, Block
packages/disasm/src/emit/zmac.ts            emitZmac
packages/disasm/src/ir.ts                   Ir, buildIr
packages/disasm/src/pipeline.ts             analyze(), Module, Analysis
packages/disasm/src/listing.ts              + renderPass1Listing
packages/disasm/src/index.ts                exports
packages/disasm/test/roundtrip/zmac.ts      findZmac, assemble, skipIfNoZmac, expectSameImage
packages/disasm/test/roundtrip/harness.test.ts
packages/disasm/test/roundtrip/table.test.ts        all 1792 encodings
packages/disasm/test/roundtrip/fixtures.test.ts     synthetic cmd/bas/raw
packages/disasm/test/roundtrip/real.test.ts         samples when present
packages/disasm/test/analysis/map.test.ts
packages/disasm/test/analysis/descent.test.ts
packages/disasm/test/analysis/regions.test.ts
packages/disasm/test/emit.test.ts
packages/disasm/test/ir.test.ts  (+ __snapshots__)
packages/disasm/test/pass1-listing.test.ts
packages/disasm/test/images.ts              hand-built image helper for analysis tests
packages/cli/src/index.ts                   --entry, --format, --sweep, -o
packages/cli/test/cli.test.ts               + flag tests
package.json                                "zmac:install"
```

---

### Task 1: Pinned zmac tooling and the assemble harness

**Files:**
- Create: `scripts/install-zmac.sh`, `packages/disasm/test/roundtrip/zmac.ts`, `packages/disasm/test/roundtrip/harness.test.ts`
- Modify: `package.json` (script), `.gitignore` (`tools/`), `.github/workflows/ci.yml`, `README.md` (one line under Use)

**Interfaces (produces):**

```ts
export function findZmac(): string | null;                 // FUGLOY_ZMAC, then <repo>/tools/zmac/zmac
export function skipIfNoZmac(): typeof it | typeof it.skip; // throws when FUGLOY_REQUIRE_ZMAC=1 and zmac is missing
export interface Assembled { module: CmdModule; listing: string }
export function assemble(source: string): Assembled;       // throws Error('zmac failed: ...') with zmac output and the source
export function expectSameImage(actual: MemoryImage, expected: MemoryImage): void; // first differing address in the message
```

- [ ] **Step 1: Write the failing harness test** (`packages/disasm/test/roundtrip/harness.test.ts`):

```ts
import { expect } from 'vitest';
import { assemble, skipIfNoZmac } from './zmac.js';

const test = skipIfNoZmac();

test('assembles a three-line program into a .cmd our loader reads back, entry included', () => {
  const { module } = assemble('\torg\t6000h\n\tld\ta,1\n\tret\n\tend\t6000h\n');
  expect(module.image.runs()).toEqual([{ start: 0x6000, end: 0x6002, length: 3 }]);
  expect(Array.from(module.image.bytes.subarray(0x6000, 0x6003))).toEqual([0x3e, 0x01, 0xc9]);
  expect(module.entry).toBe(0x6000);
  expect(module.entrySource).toBe('transfer');
});

test('accepts upper-case source with H-suffix hex, a lone DD prefix as DB, and both undocumented spellings', () => {
  const { module } = assemble('\tORG\t0A000H\n\tLD\tHL,3C00H\n\tDB\t0DDH\n\tSLL\tB\n\tLD\tA,IXH\n\tEND\t0A000H\n');
  expect(Array.from(module.image.bytes.subarray(0xa000, 0xa008))).toEqual([0x21, 0x00, 0x3c, 0xdd, 0xcb, 0x30, 0xdd, 0x7c]);
});

test('reports zmac errors with the offending source', () => {
  expect(() => assemble('\tbogus\n')).toThrow(/zmac failed[\s\S]*bogus/);
});
```

- [ ] **Step 2: Run it; expect the tests to be skipped** (no zmac yet): `pnpm vitest run packages/disasm/test/roundtrip` → `3 skipped`.

- [ ] **Step 3: Write `scripts/install-zmac.sh`:**

```bash
#!/usr/bin/env bash
# Builds the pinned zmac (gp48k/zmac, CC0) into tools/zmac/zmac. Idempotent.
# Needs git, make, a C compiler, and bison. Override the binary with FUGLOY_ZMAC.
set -euo pipefail
ZMAC_REPO=https://github.com/gp48k/zmac
ZMAC_COMMIT=050bbb1f9c608693d53b8827b991b5a9edc97a6b
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEST="$ROOT/tools/zmac"
if [ -x "$DEST/zmac" ] && [ "$(cat "$DEST/COMMIT" 2>/dev/null || true)" = "$ZMAC_COMMIT" ]; then
  echo "zmac $ZMAC_COMMIT already at $DEST/zmac"; exit 0
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
```

Add `"zmac:install": "bash scripts/install-zmac.sh"` to the root scripts, `tools/` to `.gitignore`, and run `pnpm zmac:install`. If clang rejects something, add the flag it names to the default `ZMAC_CFLAGS` and note it in the script comment. Expected: `built zmac 050bbb1f... at .../tools/zmac/zmac` and `tools/zmac/zmac --help` prints usage.

- [ ] **Step 4: Write `packages/disasm/test/roundtrip/zmac.ts`:**

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadCmd } from '../../src/cmd.js';
import type { CmdModule } from '../../src/cmd.js';
import type { MemoryImage } from '../../src/memory.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

export function findZmac(): string | null {
  const env = process.env['FUGLOY_ZMAC'];
  if (env !== undefined && env !== '' && existsSync(env)) return env;
  const local = join(repo, 'tools', 'zmac', 'zmac');
  return existsSync(local) ? local : null;
}

export function skipIfNoZmac(): typeof it | typeof it.skip {
  if (findZmac() !== null) return it;
  if (process.env['FUGLOY_REQUIRE_ZMAC'] === '1') throw new Error('zmac is required here (FUGLOY_REQUIRE_ZMAC=1) but was not found; run pnpm zmac:install');
  return it.skip;
}

export interface Assembled { module: CmdModule; listing: string }

/** Assembles zmac source into a .cmd and loads it with our own loader. */
export function assemble(source: string): Assembled {
  const zmac = findZmac();
  if (zmac === null) throw new Error('zmac not found: run pnpm zmac:install or set FUGLOY_ZMAC');
  const dir = mkdtempSync(join(tmpdir(), 'fugloy-zmac-'));
  try {
    const src = join(dir, 'prog.z');
    writeFileSync(src, source);
    try {
      execFileSync(zmac, ['--od', dir, '--oo', 'cmd,lst', src], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; message: string };
      throw new Error(`zmac failed: ${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? err.message}\nsource:\n${source}`);
    }
    const module = loadCmd(new Uint8Array(readFileSync(join(dir, 'prog.cmd'))));
    const listing = readFileSync(join(dir, 'prog.lst'), 'utf8');
    return { module, listing };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** Same loaded addresses and same bytes at every loaded address. */
export function expectSameImage(actual: MemoryImage, expected: MemoryImage): void {
  for (let a = 0; a < 0x10000; a++) {
    if (actual.loaded[a] !== expected.loaded[a]) {
      throw new Error(`bitmap differs at $${hex4(a)}: expected ${expected.loaded[a] ? 'loaded' : 'unloaded'}, got ${actual.loaded[a] ? 'loaded' : 'unloaded'}`);
    }
    if (expected.loaded[a] === 1 && actual.bytes[a] !== expected.bytes[a]) {
      throw new Error(`byte differs at $${hex4(a)}: expected ${expected.bytes[a]!.toString(16)}, got ${actual.bytes[a]!.toString(16)}`);
    }
  }
  expect(actual.runs()).toEqual(expected.runs());
}
```

- [ ] **Step 5: Run; expect 3 passed.** If `end 6000h` does not yield a transfer record (`entrySource` is `lowest`), read `doc.txt`'s `end` section in the clone and adjust the directive form in the emitter plan (Task 4) and this test; record the finding in the ledger.

- [ ] **Step 6: CI.** In `.github/workflows/ci.yml` after `pnpm install`:

```yaml
      - name: cache pinned zmac
        id: zmac
        uses: actions/cache@v4
        with:
          path: tools/zmac
          key: zmac-050bbb1f9c608693d53b8827b991b5a9edc97a6b-${{ runner.os }}
      - if: steps.zmac.outputs.cache-hit != 'true'
        run: sudo apt-get update && sudo apt-get install -y bison
      - run: pnpm zmac:install
```

and change the test step to `run: FUGLOY_REQUIRE_ZMAC=1 pnpm test`. Add one README line under Use: `pnpm zmac:install  # builds the pinned zmac into tools/ for the round-trip tests`.

- [ ] **Step 7: Full suite green locally, then commit** `p2: add pinned zmac build script and assemble harness`.

---

### Task 2: Byte-kind map

**Files:**
- Create: `packages/disasm/src/analysis/map.ts`, `packages/disasm/test/analysis/map.test.ts`

**Interfaces (produces):**

```ts
export const Kind = { Unknown: 0, Code: 1, Tail: 2, Byte: 3, Word: 4, String: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];
export class ByteMap {
  readonly kinds: Uint8Array;    // 65536
  readonly starts: Uint8Array;   // 65536
  kind(addr: number): Kind;
  isStart(addr: number): boolean;
  markCode(addr: number, length: number): void;   // Code at addr, Tail for the rest; wraps at $FFFF
  markByte(addr: number, length: number): void;
  overlapsCode(addr: number, length: number): boolean;
  isCode(addr: number): boolean;                  // Code or Tail
}
```

- [ ] **Step 1: Failing tests:**

```ts
import { describe, expect, it } from 'vitest';
import { ByteMap, Kind } from '../../src/analysis/map.js';

describe('ByteMap', () => {
  it('starts all unknown with no instruction starts', () => {
    const m = new ByteMap();
    expect(m.kinds.length).toBe(65536);
    expect(m.kind(0x6000)).toBe(Kind.Unknown);
    expect(m.isStart(0x6000)).toBe(false);
  });
  it('marks an instruction as Code then Tail and records its start', () => {
    const m = new ByteMap();
    m.markCode(0x6000, 3);
    expect([m.kind(0x6000), m.kind(0x6001), m.kind(0x6002), m.kind(0x6003)]).toEqual([Kind.Code, Kind.Tail, Kind.Tail, Kind.Unknown]);
    expect(m.isStart(0x6000)).toBe(true);
    expect(m.isStart(0x6001)).toBe(false);
    expect(m.isCode(0x6002)).toBe(true);
  });
  it('detects overlap with existing code anywhere in the range', () => {
    const m = new ByteMap();
    m.markCode(0x6002, 2);
    expect(m.overlapsCode(0x6000, 2)).toBe(false);
    expect(m.overlapsCode(0x6000, 3)).toBe(true);
    expect(m.overlapsCode(0x6003, 1)).toBe(true);
  });
  it('marks data bytes and wraps at $FFFF', () => {
    const m = new ByteMap();
    m.markByte(0xffff, 2);
    expect(m.kind(0xffff)).toBe(Kind.Byte);
    expect(m.kind(0x0000)).toBe(Kind.Byte);
  });
});
```

- [ ] **Step 2: RED. Step 3: implement. Step 4: GREEN + typecheck. Step 5: commit** `p2: add byte-kind map`.

---

### Task 3: Recursive descent

**Files:**
- Create: `packages/disasm/src/analysis/descent.ts`, `packages/disasm/test/analysis/descent.test.ts`, `packages/disasm/test/images.ts`

**Interfaces (produces):**

```ts
export type XrefKind = 'jump' | 'cjump' | 'call' | 'ccall' | 'rst';
export interface Xref { from: number; to: number; kind: XrefKind }
export type DiagnosticKind = 'overlap' | 'inside-instruction' | 'in-data' | 'truncated' | 'unloaded-root';
export interface Diagnostic { kind: DiagnosticKind; addr: number; from?: number; message: string }
export interface Pass1 {
  map: ByteMap; instructions: Map<number, Instruction>; roots: number[]; xrefs: Xref[];
  externals: number[]; indirectJumps: number[]; diagnostics: Diagnostic[];
}
export function recursiveDescent(image: MemoryImage, roots: number[]): Pass1;
/** Static target of a jump/call/rst, or null (indirect, or not a transfer). */
export function targetOf(ins: Instruction): number | null;
/** True when the path stops after this instruction. */
export function endsPath(ins: Instruction): boolean;
```

Test helper `test/images.ts`:

```ts
import { MemoryImage } from '../src/memory.js';
export function image(blocks: Record<number, number[]>): MemoryImage {
  const m = new MemoryImage();
  for (const [addr, bytes] of Object.entries(blocks)) m.load(Number(addr), bytes);
  return m;
}
```

- [ ] **Step 1: Failing tests** (`descent.test.ts`), one behavior each:

```ts
import { describe, expect, it } from 'vitest';
import { recursiveDescent } from '../../src/analysis/descent.js';
import { Kind } from '../../src/analysis/map.js';
import { image } from '../images.js';

const kinds = (p: ReturnType<typeof recursiveDescent>, from: number, n: number) => Array.from({ length: n }, (_, i) => p.map.kind(from + i));
const starts = (p: ReturnType<typeof recursiveDescent>) => [...p.instructions.keys()].sort((a, b) => a - b);

describe('recursiveDescent', () => {
  it('decodes straight-line code from the root and stops at RET, leaving the rest unknown', () => {
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9, 0xff, 0xff] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6003]);
    expect(kinds(p, 0x6000, 6)).toEqual([Kind.Code, Kind.Tail, Kind.Tail, Kind.Code, Kind.Unknown, Kind.Unknown]);
    expect(p.diagnostics).toEqual([]);
  });
  it('follows both arms of a conditional branch and records the xref', () => {
    // 6000 JR NZ,6004 ; 6002 NOP ; 6003 RET ; 6004 RET
    const p = recursiveDescent(image({ 0x6000: [0x20, 0x02, 0x00, 0xc9, 0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6002, 0x6003, 0x6004]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x6004, kind: 'cjump' }]);
  });
  it('queues a call target and continues after the call', () => {
    // 6000 CALL 6010 ; 6003 RET ; 6010 RET
    const p = recursiveDescent(image({ 0x6000: [0xcd, 0x10, 0x60, 0xc9], 0x6010: [0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6003, 0x6010]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x6010, kind: 'call' }]);
  });
  it('follows a target in another loaded run', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc3, 0x00, 0x70], 0x7000: [0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x7000]);
  });
  it('ends the path at an unconditional jump, an indirect jump, and HALT', () => {
    const jp = recursiveDescent(image({ 0x6000: [0x18, 0x01, 0x00, 0xc9] }), [0x6000]); // JR 6003 ; 6002 NOP unreachable ; 6003 RET
    expect(starts(jp)).toEqual([0x6000, 0x6003]);
    const ind = recursiveDescent(image({ 0x6000: [0xe9, 0x00] }), [0x6000]);
    expect(starts(ind)).toEqual([0x6000]);
    expect(ind.indirectJumps).toEqual([0x6000]);
    const halt = recursiveDescent(image({ 0x6000: [0xf3, 0x76, 0x00] }), [0x6000]);
    expect(starts(halt)).toEqual([0x6000, 0x6001]);
  });
  it('continues after a conditional return', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc8, 0x00, 0xc9] }), [0x6000]);
    expect(starts(p)).toEqual([0x6000, 0x6001, 0x6002]);
  });
  it('types the byte after RST 08H as data and continues after it', () => {
    const p = recursiveDescent(image({ 0x6000: [0xcf, 0x2c, 0xc9] }), [0x6000]);
    expect(kinds(p, 0x6000, 3)).toEqual([Kind.Code, Kind.Byte, Kind.Code]);
    expect(p.externals).toEqual([0x0008]);
    expect(p.xrefs).toEqual([{ from: 0x6000, to: 0x0008, kind: 'rst' }]);
  });
  it('records unloaded targets as externals, not errors', () => {
    const p = recursiveDescent(image({ 0x6000: [0xcd, 0x33, 0x00, 0xc9] }), [0x6000]);
    expect(p.externals).toEqual([0x0033]);
    expect(p.diagnostics).toEqual([]);
  });
  it('terminates on a self-loop and a two-instruction loop without re-marking', () => {
    const self = recursiveDescent(image({ 0x6000: [0x18, 0xfe] }), [0x6000]);
    expect(starts(self)).toEqual([0x6000]);
    const two = recursiveDescent(image({ 0x6000: [0x00, 0x18, 0xfd] }), [0x6000]); // NOP ; JR 6000
    expect(starts(two)).toEqual([0x6000, 0x6001]);
    expect(two.xrefs).toEqual([{ from: 0x6001, to: 0x6000, kind: 'jump' }]);
  });
  it('lets the first decode win and diagnoses a path that would overlap it', () => {
    // root A at 6000: LD HL,nn (3 bytes) ; root B at 6001 would decode 00 3C ...
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] }), [0x6000, 0x6001]);
    expect(starts(p)).toEqual([0x6000, 0x6003]);
    expect(p.diagnostics).toEqual([{ kind: 'inside-instruction', addr: 0x6001, message: 'target $6001 is inside the instruction at $6000' }]);
  });
  it('diagnoses a root that lands on a Tail of a later-decoded stream', () => {
    // 6000 LD HL,0FE18H ; 6003 RET ; root at 6004 decodes LD A,0C9H over 6004-6005 ; root at 6005 is then a Tail.
    const p = recursiveDescent(image({ 0x6000: [0x21, 0x18, 0xfe, 0xc9, 0x3e, 0xc9] }), [0x6000, 0x6004, 0x6005]);
    expect(starts(p)).toEqual([0x6000, 0x6003, 0x6004]);
    expect(p.diagnostics.map((d) => d.kind)).toEqual(['inside-instruction']);
  });
  it('diagnoses an overlap when a later path would cover already-typed code', () => {
    // 6003 RET is decoded first; the root at 6002 decodes LD B,n, whose operand byte is that RET.
    const q = recursiveDescent(image({ 0x6000: [0x00, 0x00, 0x06, 0xc9] }), [0x6003, 0x6002]);
    expect(starts(q)).toEqual([0x6003]);
    expect(q.diagnostics).toEqual([{ kind: 'overlap', addr: 0x6002, message: 'instruction at $6002 would overlap code at $6003' }]);
  });
  it('types a truncated instruction at the end of a run as data with a diagnostic', () => {
    const p = recursiveDescent(image({ 0x6000: [0x00, 0xcd] }), [0x6000]);
    expect(kinds(p, 0x6000, 2)).toEqual([Kind.Code, Kind.Byte]);
    expect(p.diagnostics).toEqual([{ kind: 'truncated', addr: 0x6001, message: 'instruction at $6001 runs past loaded memory' }]);
  });
  it('diagnoses an unloaded root and ignores a duplicate root', () => {
    const p = recursiveDescent(image({ 0x6000: [0xc9] }), [0x6000, 0x6000, 0x7000]);
    expect(p.roots).toEqual([0x6000, 0x7000]);
    expect(starts(p)).toEqual([0x6000]);
    expect(p.diagnostics).toEqual([{ kind: 'unloaded-root', addr: 0x7000, message: 'entry $7000 is not in loaded memory' }]);
  });
  it('resolves a root that lands inside an instruction decoded by another root in a stable order', () => {
    // Roots are processed in the order given: 6000 first decodes 1E 00 (LD E,0) covering 6001.
    const p = recursiveDescent(image({ 0x6000: [0x1e, 0x00, 0xc9] }), [0x6000, 0x6001]);
    expect(starts(p)).toEqual([0x6000, 0x6002]);
    expect(p.diagnostics[0]?.kind).toBe('inside-instruction');
  });
});
```

- [ ] **Step 2: RED** (module missing).

- [ ] **Step 3: Implement `descent.ts`:**

```ts
import { decode } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { MemoryImage } from '../memory.js';
import { ByteMap, Kind } from './map.js';

const $ = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

export function targetOf(ins: Instruction): number | null {
  if (ins.flow.kind !== 'jump' && ins.flow.kind !== 'call') return null;
  if (ins.flow.indirect) return null;
  for (const op of ins.operands) {
    if (op.kind === 'imm16') return op.value;
    if (op.kind === 'rel') return op.target;
    if (op.kind === 'rst') return op.addr;
  }
  return null;
}

export function endsPath(ins: Instruction): boolean {
  const f = ins.flow;
  if (f.kind === 'halt') return true;
  if (f.kind === 'return') return !f.conditional;
  if (f.kind === 'jump') return f.indirect || !f.conditional;
  return false;
}

const isRst08 = (ins: Instruction): boolean => ins.mnemonic === 'RST' && ins.operands[0]?.kind === 'rst' && ins.operands[0].addr === 0x08;

export function recursiveDescent(image: MemoryImage, rootsIn: number[]): Pass1 {
  const map = new ByteMap();
  const instructions = new Map<number, Instruction>();
  const xrefs: Xref[] = [];
  const externals = new Set<number>();
  const indirectJumps: number[] = [];
  const diagnostics: Diagnostic[] = [];
  const roots = [...new Set(rootsIn.map((r) => r & 0xffff))];
  const work: number[] = [];
  for (const r of roots) {
    if (image.isLoaded(r)) work.push(r);
    else diagnostics.push({ kind: 'unloaded-root', addr: r, message: `entry ${$(r)} is not in loaded memory` });
  }
  const enqueue = (from: number, to: number, kind: XrefKind): void => {
    xrefs.push({ from, to, kind });
    if (image.isLoaded(to)) work.push(to);
    else externals.add(to);
  };
  while (work.length > 0) {
    let addr = work.shift()!;
    if (map.isStart(addr)) continue;
    if (map.kind(addr) === Kind.Tail) {
      const owner = ownerOf(map, addr);
      diagnostics.push({ kind: 'inside-instruction', addr, message: `target ${$(addr)} is inside the instruction at ${$(owner)}` });
      continue;
    }
    if (map.kind(addr) === Kind.Byte) {
      diagnostics.push({ kind: 'in-data', addr, message: `target ${$(addr)} is typed as data` });
      continue;
    }
    for (;;) {
      if (!image.isLoaded(addr) || map.isStart(addr)) break;
      const ins = decode((i) => image.read(addr + i), addr);
      if (ins.truncated === true) {
        map.markByte(addr, 1);
        diagnostics.push({ kind: 'truncated', addr, message: `instruction at ${$(addr)} runs past loaded memory` });
        break;
      }
      if (map.overlapsCode(addr, ins.length)) {
        diagnostics.push({ kind: 'overlap', addr, message: `instruction at ${$(addr)} would overlap code at ${$(firstCode(map, addr, ins.length))}` });
        break;
      }
      map.markCode(addr, ins.length);
      instructions.set(addr, ins);
      let next = (addr + ins.length) & 0xffff;
      const target = targetOf(ins);
      if (ins.flow.kind === 'call' && target !== null) enqueue(addr, target, ins.operands[0]?.kind === 'rst' ? 'rst' : ins.flow.conditional ? 'ccall' : 'call');
      if (ins.flow.kind === 'jump' && target !== null) enqueue(addr, target, ins.flow.conditional ? 'cjump' : 'jump');
      if (ins.flow.kind === 'jump' && ins.flow.indirect) indirectJumps.push(addr);
      if (isRst08(ins) && image.isLoaded(next)) { map.markByte(next, 1); next = (next + 1) & 0xffff; }
      if (endsPath(ins)) break;
      addr = next;
    }
  }
  return { map, instructions, roots, xrefs, externals: [...externals].sort((a, b) => a - b), indirectJumps, diagnostics };
}
```

with `ownerOf(map, addr)` walking back to the nearest start and `firstCode(map, addr, len)` returning the first Code/Tail address in the range. Duplicate work-list entries are harmless because `isStart` short-circuits; use `shift()` (FIFO) so root order is stable.

- [ ] **Step 4: GREEN; typecheck. Step 5: commit** `p2: add recursive descent pass`.

---

### Task 4: zmac emitter and the table-wide round trip

**Files:**
- Create: `packages/disasm/src/emit/zmac.ts`, `packages/disasm/test/emit.test.ts`, `packages/disasm/test/roundtrip/table.test.ts`
- Modify: `packages/disasm/src/index.ts`

**Interfaces (produces):**

```ts
export interface EmitOptions { source?: string; addresses?: boolean }   // addresses: '; 6000' comment column, default false
export function emitZmac(image: MemoryImage, pass1: Pass1, entry: number | null, opts?: EmitOptions): string;
/** Encodings zmac re-spells to different bytes; emitted as DB. Keyed by the first two bytes. */
export const BYTE_EXACT_EXCEPTIONS: ReadonlySet<string>;   // e.g. 'ED63', 'ED6B'
export function instructionLine(ins: Instruction): string; // '\tLD\tHL,3C00H' or '\tDB\t0EDH,63H,...'
```

- [ ] **Step 1: Failing emitter tests** (`emit.test.ts`, no zmac needed):

```ts
import { describe, expect, it } from 'vitest';
import { decodeAt } from '@fugloy/z80';
import { recursiveDescent } from '../src/analysis/descent.js';
import { emitZmac, instructionLine } from '../src/emit/zmac.js';
import { image } from './images.js';

describe('emitZmac', () => {
  it('writes one ORG per run, instructions, DB rows, and END with the entry', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9], 0x7000: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    const text = emitZmac(img, recursiveDescent(img, [0x6000]), 0x6000, { source: 'x.cmd' });
    expect(text).toBe([
      '; x.cmd: Fugløy pass 1, 2 runs, 15 bytes, entry 6000H',
      '\tORG\t6000H',
      '\tLD\tHL,3C00H',
      '\tLD\t(HL),41H',
      '\tRET',
      '\tORG\t7000H',
      '\tDB\t00H,01H,02H,03H,04H,05H,06H,07H',
      '\tDB\t08H',
      '\tEND\t6000H',
      '',
    ].join('\n'));
  });
  it('ends a DB row before an instruction start even mid-row', () => {
    // 9 unknown bytes then code at 7009 reached from a root at 7009
    const img = image({ 0x7000: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0xc9] });
    const text = emitZmac(img, recursiveDescent(img, [0x7009]), null);
    expect(text).toContain('\tDB\t01H,02H,03H,04H,05H,06H,07H,08H\n\tDB\t09H\n\tRET\n');
    expect(text.trimEnd().endsWith('\tEND')).toBe(true);
  });
  it('emits data bytes typed by RST 08H as DB on their own row', () => {
    const img = image({ 0x6000: [0xcf, 0x2c, 0xc9] });
    expect(emitZmac(img, recursiveDescent(img, [0x6000]), 0x6000)).toContain('\tRST\t08H\n\tDB\t2CH\n\tRET\n');
  });
  it('renders byte-exact exceptions and undocumented DB forms as DB', () => {
    expect(instructionLine(decodeAt([0xed, 0x63, 0x00, 0x40], 0))).toBe('\tDB\t0EDH,63H,00H,40H');
    expect(instructionLine(decodeAt([0xed, 0x6b, 0x00, 0x40], 0))).toBe('\tDB\t0EDH,6BH,00H,40H');
    expect(instructionLine(decodeAt([0xdd, 0x00], 0))).toBe('\tDB\t0DDH');
    expect(instructionLine(decodeAt([0xed, 0x70], 0))).toBe('\tDB\t0EDH,70H');
    expect(instructionLine(decodeAt([0x22, 0x00, 0x40], 0))).toBe('\tLD\t(4000H),HL');
    expect(instructionLine(decodeAt([0xcb, 0x30], 0))).toBe('\tSLL\tB');
    expect(instructionLine(decodeAt([0xdd, 0x7c], 0))).toBe('\tLD\tA,IXH');
  });
  it('covers every loaded byte exactly once when two roots overlap', () => {
    const img = image({ 0x6000: [0x00, 0x00, 0x06, 0xc9, 0xc9] });
    const text = emitZmac(img, recursiveDescent(img, [0x6003, 0x6002]), 0x6003);
    expect(text).toContain('\tDB\t00H,00H,06H\n\tRET\n\tRET\n');
  });
  it('is deterministic', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] });
    const p = recursiveDescent(img, [0x6000]);
    expect(emitZmac(img, p, 0x6000)).toBe(emitZmac(img, p, 0x6000));
  });
});
```

- [ ] **Step 2: Failing table round trip** (`roundtrip/table.test.ts`):

```ts
import { expect } from 'vitest';
import { TABLES, decodeAt } from '@fugloy/z80';
import { instructionLine } from '../../src/emit/zmac.js';
import { assemble, skipIfNoZmac } from './zmac.js';

const test = skipIfNoZmac();
const SECTIONS: { prefix: number[]; cb: boolean; table: keyof typeof TABLES }[] = [
  { prefix: [], cb: false, table: 'base' }, { prefix: [0xcb], cb: false, table: 'cb' }, { prefix: [0xed], cb: false, table: 'ed' },
  { prefix: [0xdd], cb: false, table: 'dd' }, { prefix: [0xfd], cb: false, table: 'fd' },
  { prefix: [0xdd, 0xcb], cb: true, table: 'ddcb' }, { prefix: [0xfd, 0xcb], cb: true, table: 'fdcb' },
];

test('every encoding emitted by instructionLine assembles back to its own bytes', () => {
  const bytes: number[] = [];
  const lines: string[] = ['\tORG\t0'];
  for (const s of SECTIONS) {
    for (let op = 0; op < 256; op++) {
      if (TABLES[s.table][op]!.prefix !== undefined) continue;
      const stream = s.cb ? [...s.prefix, 0x12, op] : [...s.prefix, op, 0x12, 0x34];
      const ins = decodeAt(stream, 0, bytes.length);          // address = running offset, so JR targets are consistent
      lines.push(instructionLine(ins));
      bytes.push(...ins.bytes);
    }
  }
  lines.push('\tEND\t0');
  const { module } = assemble(`${lines.join('\n')}\n`);
  const got = Array.from(module.image.bytes.subarray(0, bytes.length));
  const firstDiff = got.findIndex((b, i) => b !== bytes[i]);
  expect(firstDiff, firstDiff >= 0 ? `first difference at offset ${firstDiff}: ${lines[1 + offsetToLine(bytes, firstDiff)]}` : '').toBe(-1);
  expect(module.image.runs()).toEqual([{ start: 0, end: bytes.length - 1, length: bytes.length }]);
});
```

with `offsetToLine` mapping a byte offset back to its line index (accumulate lengths). The message names the failing instruction so each zmac disagreement becomes an entry in `BYTE_EXACT_EXCEPTIONS` or a spelling change.

- [ ] **Step 3: Implement `emit/zmac.ts`:**

```ts
import { formatInstruction, hexByte, hexWord } from '@fugloy/z80';
import type { Instruction } from '@fugloy/z80';
import type { MemoryImage } from '../memory.js';
import type { Pass1 } from '../analysis/descent.js';

/** Encodings the pinned zmac assembles to different (shorter) bytes; emitted as DB so the image round-trips. */
export const BYTE_EXACT_EXCEPTIONS: ReadonlySet<string> = new Set(['ED63', 'ED6B']);

const key = (ins: Instruction): string => ins.bytes.slice(0, 2).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
const dbRow = (bytes: number[]): string => `\tDB\t${bytes.map(hexByte).join(',')}`;

export function instructionLine(ins: Instruction): string {
  if (ins.mnemonic === 'DB' || BYTE_EXACT_EXCEPTIONS.has(key(ins))) return dbRow(ins.bytes);
  const text = formatInstruction(ins);
  const space = text.indexOf(' ');
  return space < 0 ? `\t${text}` : `\t${text.slice(0, space)}\t${text.slice(space + 1)}`;
}

export function emitZmac(image: MemoryImage, pass1: Pass1, entry: number | null, opts: EmitOptions = {}): string {
  const runs = image.runs();
  const out: string[] = [];
  const loaded = runs.reduce((n, r) => n + r.length, 0);
  out.push(`; ${opts.source === undefined ? '' : `${opts.source}: `}Fugløy pass 1, ${runs.length} run${runs.length === 1 ? '' : 's'}, ${loaded} bytes, ${entry === null ? 'no entry' : `entry ${hexWord(entry)}`}`);
  for (const run of runs) {
    out.push(`\tORG\t${hexWord(run.start)}`);
    let addr = run.start;
    let pending: number[] = [];
    const flush = (): void => { while (pending.length > 0) { out.push(dbRow(pending.slice(0, 8))); pending = pending.slice(8); } };
    while (addr <= run.end) {
      const ins = pass1.instructions.get(addr);
      if (ins !== undefined) {
        flush();
        out.push(opts.addresses === true ? `${instructionLine(ins)}\t; ${hexWord(addr)}` : instructionLine(ins));
        addr += ins.length;
      } else {
        pending.push(image.bytes[addr]!);
        if (pending.length === 8) flush();
        addr++;
      }
    }
    flush();
  }
  out.push(entry === null ? '\tEND' : `\tEND\t${hexWord(entry)}`);
  return `${out.join('\n')}\n`;
}
```

- [ ] **Step 4: Run the emitter tests (GREEN) and the table round trip.** For each line zmac disagrees on, decide: a genuine re-encoding → add its key to `BYTE_EXACT_EXCEPTIONS` and extend the emitter test; a spelling zmac rejects (if `SLL` were rejected, use `SL1` via a spelling map applied in `instructionLine`) → fix and extend the test. Re-run until green. Record every exception in the file's comment and the ledger.
- [ ] **Step 5: Export, typecheck, full suite. Commit** `p2: add zmac emitter proven byte-exact against every encoding`.

---

### Task 5: Regions, basic blocks, and the IR

**Files:**
- Create: `packages/disasm/src/analysis/regions.ts`, `packages/disasm/src/ir.ts`, `packages/disasm/test/analysis/regions.test.ts`, `packages/disasm/test/ir.test.ts`

**Interfaces (produces):**

```ts
export type RegionKind = 'code' | 'bytes' | 'unknown';
export interface Region { kind: RegionKind; start: number; end: number }
export interface Block { start: number; end: number; succ: { to: number; kind: XrefKind | 'next' | 'external' }[] }
export function regions(image: MemoryImage, map: ByteMap): Region[];
export function basicBlocks(pass1: Pass1): Block[];
export interface Ir { fugloyIr: 1; source?: string; format: 'cmd' | 'bas' | 'raw'; entry: number | null; roots: number[];
  loaded: { start: number; end: number }[]; regions: Region[]; blocks: Block[]; xrefs: Xref[]; externals: number[];
  indirectJumps: number[]; diagnostics: Diagnostic[] }
export type Module = CmdModule | BasProgram | RawModule;                  // defined here; Task 6 imports it
export function buildIr(mod: Module, pass1: Pass1, source?: string): Ir;
```

- [ ] **Step 1: Failing tests:**

```ts
// regions.test.ts
it('splits a run into code, bytes, and unknown regions in address order', () => {
  const img = image({ 0x6000: [0xcf, 0x2c, 0xc9, 0xff, 0xff], 0x7000: [0xc9] });
  const p = recursiveDescent(img, [0x6000]);
  expect(regions(img, p.map)).toEqual([
    { kind: 'code', start: 0x6000, end: 0x6000 }, { kind: 'bytes', start: 0x6001, end: 0x6001 },
    { kind: 'code', start: 0x6002, end: 0x6002 }, { kind: 'unknown', start: 0x6003, end: 0x6004 },
    { kind: 'unknown', start: 0x7000, end: 0x7000 },
  ]);
});
it('cuts blocks at targets and after path ends, with successors by kind', () => {
  // 6000 JR NZ,6004 ; 6002 NOP ; 6003 RET ; 6004 CALL 6010 ; 6007 JP 6003 ; 6010 RET
  const img = image({ 0x6000: [0x20, 0x02, 0x00, 0xc9, 0xcd, 0x10, 0x60, 0xc3, 0x03, 0x60], 0x6010: [0xc9] });
  expect(basicBlocks(recursiveDescent(img, [0x6000]))).toEqual([
    { start: 0x6000, end: 0x6001, succ: [{ to: 0x6004, kind: 'cjump' }, { to: 0x6002, kind: 'next' }] },
    { start: 0x6002, end: 0x6002, succ: [{ to: 0x6003, kind: 'next' }] },
    { start: 0x6003, end: 0x6003, succ: [] },
    { start: 0x6004, end: 0x6006, succ: [{ to: 0x6010, kind: 'call' }, { to: 0x6007, kind: 'next' }] },
    { start: 0x6007, end: 0x6009, succ: [{ to: 0x6003, kind: 'jump' }] },
    { start: 0x6010, end: 0x6010, succ: [] },
  ]);
});
it('marks a successor outside loaded memory as external', () => {
  const img = image({ 0x6000: [0xcd, 0x33, 0x00, 0xc9] });
  expect(basicBlocks(recursiveDescent(img, [0x6000]))[0]!.succ).toEqual([{ to: 0x0033, kind: 'external' }, { to: 0x6003, kind: 'next' }]);
});
// ir.test.ts
it('builds a versioned IR for the non-contiguous fixture and matches the committed snapshot', () => {
  const mod = loadCmd(CMD_FIXTURES['non-contiguous']!());
  const ir = buildIr(mod, recursiveDescent(mod.image, [mod.entry!]), 'non-contiguous.cmd');
  expect(ir.fugloyIr).toBe(1);
  expect(ir.format).toBe('cmd');
  expect(ir.entry).toBe(0x6000);
  expect(JSON.parse(JSON.stringify(ir))).toMatchSnapshot();
});
```

Block rules: block starts = roots ∪ loaded xref targets ∪ the instruction after any instruction whose flow kind is not `next`; walk instruction starts in address order; a block ends at any instruction whose flow kind is not `next` (jump, call, return, halt), or just before the next block start; the `next` successor is present only when the following address is an instruction start and the last instruction does not end the path; transfer successors (`call`, `ccall`, `rst`, `jump`, `cjump`, or `external` when the target is unloaded) are listed before `next`.

- [ ] **Step 2–5: RED, implement, GREEN (commit the snapshot), commit** `p2: derive regions, basic blocks, and the JSON IR`.

---

### Task 6: Pass 1 listing and the pipeline

**Files:**
- Create: `packages/disasm/src/pipeline.ts`, `packages/disasm/test/pass1-listing.test.ts`
- Modify: `packages/disasm/src/listing.ts`, `packages/disasm/src/index.ts`

**Interfaces (produces):**

```ts
import type { Module } from './ir.js';   // re-exported from the package index
export interface AnalyzeOptions { entries?: number[] }
export interface Analysis { module: Module; pass1: Pass1; entry: number | null; roots: number[] }
export function analyze(mod: Module, opts?: AnalyzeOptions): Analysis;
export function renderPass1Listing(analysis: Analysis, opts?: RenderOptions): string;
```

Listing format: the phase-1 columns (`6000  21 00 3C      LD HL,3C00H`), `; entry` on root lines, `DB` rows for unknown and data bytes (eight per row, same cutting rules as the emitter), header lines:

```
; non-contiguous.cmd: load module, 2 blocks, 2 runs, 14 bytes, entry $6000 (transfer address)
; pass 1: roots $6000; 6 of 14 bytes reached (43%); 0 external targets; 0 notes
```

then one `; note: <message>` per diagnostic, then the block lines and warnings exactly as the phase-1 header prints them, then `ORG` sections. When there are no roots: `; pass 1: no roots; use --entry <hex> or --sweep`.

- [ ] **Step 1: Failing tests:** header lines for the non-contiguous fixture (with entry) and for `end-03` (no roots message); a `DB` row for the unreached `$7000` run; `; entry` on the root line; one `; note:` for an overlap case built from `writeBasic`-free hand image via `loadRaw`; `analyze` with `entries` adds roots and diagnoses an unloaded one; `analyze` on a `.BAS` program has no roots.
- [ ] **Step 2–5: RED, implement, GREEN, commit** `p2: add pass 1 listing and analysis pipeline`.

---

### Task 7: CLI flags

**Files:**
- Modify: `packages/cli/src/index.ts`, `packages/cli/test/cli.test.ts`, `README.md` (Use section), `CHANGELOG.md` (Unreleased)

**Interfaces:**

```
fugloy <file> [--base <hex>] [--entry <hex>]... [--format listing|zmac|ir] [--sweep] [-o <path>]
```

`Io` gains `writeFile(path: string, text: string): Promise<void>`. Behavior per spec §4.8; `--format` other than the three values → exit 2 naming the flag; `--entry` malformed or unloaded → exit 2 naming the flag and the address, nothing on stdout; `.BAS` with `--format listing` prints the phase-1 BASIC listing; `.BAS` with `zmac`/`ir` works (all `DB`, no roots).

- [ ] **Step 1: Failing tests** for: default listing is Pass 1 (contains `; pass 1:`); `--sweep` prints the old listing (no `; pass 1:` line); `--format zmac` output starts with `; ` and contains `\tORG\t6000H` and `\tEND\t6000H`; `--format ir` parses as JSON with `fugloyIr === 1`; `--entry 7000` on the non-contiguous fixture makes `$7000` bytes decode as code; `--entry zz` → exit 2, stderr mentions `--entry`, stdout empty; `--entry 9000` (unloaded) → exit 2 naming `$9000`, stdout empty; `--format pdf` → exit 2; `-o` writes the file and prints nothing; a `.BAS` fixture with `--format zmac` round-trips through `assemble` when zmac is present (reuse `skipIfNoZmac`).
- [ ] **Step 2–5: RED, implement, GREEN, commit** `p2: add --entry, --format, --sweep, and -o to the CLI`.

---

### Task 8: Fixture and real-sample round trips, docs

**Files:**
- Create: `packages/disasm/test/roundtrip/fixtures.test.ts`, `packages/disasm/test/roundtrip/real.test.ts`
- Modify: `docs/Fugloy-Project-Plan.md` (close the undocumented-spelling open question; keep the hint-file and multi-file questions), `CHANGELOG.md`, `README.md` (status line), `CLAUDE.md` if a convention changed

- [ ] **Step 1: Failing fixture round trips:**

```ts
const test = skipIfNoZmac();
for (const [name, make] of Object.entries(CMD_FIXTURES)) {
  test(`cmd/${name} round-trips through zmac to the same image, bitmap, and entry`, () => {
    const mod = loadCmd(make());
    const a = analyze(mod);
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.entry, { source: name }));
    expectSameImage(back.image, mod.image);
    if (mod.entrySource === 'transfer') expect(back.entry).toBe(mod.entry);
  });
}
for (const [name, make] of Object.entries(BAS_FIXTURES)) {
  test(`bas/${name} round-trips as DB with a bare END`, () => {
    const prog = loadBas(make());
    const a = analyze(prog);
    const source = emitZmac(prog.image, a.pass1, a.entry, { source: name });
    expect(source.trimEnd().endsWith('\tEND')).toBe(true);
    expectSameImage(assemble(source).module.image, prog.image);
  });
}
const RAW: [string, number, number[]][] = [
  ['program', 0x5200, [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9]],
  ['pattern-300', 0x7000, pattern(300)],
  ['ends-in-cd', 0x6000, [0x3e, 0x01, 0xcd]],
];
for (const [name, base, bytes] of RAW) {
  test(`raw/${name} round-trips from its base with the entry there`, () => {
    const mod = loadRaw(Uint8Array.from(bytes), base);
    const a = analyze(mod);
    const { module: back } = assemble(emitZmac(mod.image, a.pass1, a.entry, { source: name }));
    expectSameImage(back.image, mod.image);
    expect(back.entry).toBe(base);
  });
}
```

- [ ] **Step 2: Failing real round trips** (`real.test.ts`): every file in the appendix table (Task 11 of the phase-1 plan lists them) and the 13 Valkyrie files, guarded by `skipIfMissing(file)` and `skipIfNoZmac()` (compose: skip when either is missing); assert `expectSameImage` and entry equality; also assert `reached > 0` for every `.CMD` and print nothing else.
- [ ] **Step 3: Run; fix whatever the real programs expose** (expected candidates: an emitter exception missed by the table test is impossible by construction, so failures here point at descent or at zmac's `.cmd` writer; investigate with the `.lst` from `assemble`).
- [ ] **Step 4: Docs.** Plan: replace the open question "Which undocumented opcodes to emit and how to spell them" with the decision and the exception list; CHANGELOG Unreleased: Added (pass 1, emitter, IR, listing, CLI flags, zmac harness), Changed (default listing is Pass 1; `--sweep` for the old one); README Use section gains the new flags and `pnpm zmac:install`; CLAUDE.md current-phase line unchanged (still phase 2).
- [ ] **Step 5: Full suite with `FUGLOY_REQUIRE_ZMAC=1`, typecheck, build, commit** `p2: prove fixture and real-program round trips; close the undocumented-spelling question`.

---

### Task 9: Report

- [ ] Run everything once more, then report: round-trip results per fixture class and per real file, the final byte-exact exception list and spelling decision, descent coverage percentages for the real samples (informational), every ledger ruling, and what sub-project B needs from this (externals and xrefs feed labels; the kind map takes overrides).
