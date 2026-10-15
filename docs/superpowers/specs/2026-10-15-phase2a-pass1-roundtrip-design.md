# Phase 2, sub-project A: Pass 1 and the round-trip proof

Design spec, 2026-10-15. Implements the first third of phase 2 of
`docs/Fugloy-Project-Plan.md` ("Pass 1 and Pass 2"). Sub-projects B (labels
and the hint file) and C (hidden code and heuristics) get their own specs.

## 1. Goal

From any loaded image and its entry points, produce:

1. a typed map of which bytes are code, built by recursive descent;
2. zmac source whose assembly under a pinned zmac reproduces the original
   memory image and bitmap exactly;
3. a JSON intermediate representation (IR) of regions, basic blocks, and
   control-flow edges;
4. a listing that reflects the typed map.

Prove item 2 in the test suite and in CI with the pinned zmac. This is the
plan's kill-criterion proof ("a round-trip-clean listing of a synthetic
fixture"), so it comes before labels, hints, or heuristics.

**Done when:** every synthetic `.CMD`, `.BAS`, and raw fixture round-trips
(bytes, bitmap, and entry point equal), all 1792 Z80 encodings round-trip
through zmac individually, every real sample present on the machine
round-trips, and the CLI emits listing, zmac source, and IR for any file.

## 2. Non-goals

Labels and symbol tables, the hint file and overrides, string and jump-table
heuristics, hidden-code detection in `.BAS` files, and execution tracing.
Pass 1 output for a `.BAS` file in this sub-project is the program bytes as
`DB`; its hidden code gets roots in sub-project C.

## 3. Decisions

- **Byte-kind map, derived views.** Pass 1's primary result is a
  `Uint8Array(65536)` of kinds parallel to the image plus a parallel array
  marking instruction starts. Regions, basic blocks, and the IR are derived
  from it. Overrides (sub-project B) become writes into the same map.
- **Block ends.** A descent path ends at `RET`, `RETI`, `RETN`, `JP (HL)`,
  `JP (IX)`, `JP (IY)`, unconditional `JP` and `JR`, and `HALT`. The plan
  lists the first three groups; `HALT` is added because `DI`/`HALT` is the
  common "stop" idiom and falling through it would decode data as code and
  cascade bogus jump targets. Code after a `HALT` that an interrupt resumes
  needs a user entry point (`--entry`) until the hint file exists.
- **First decode wins.** A path that would overlap bytes already typed as
  code stops with a diagnostic instead of re-typing them.
- **Targets outside loaded memory are external references**, not errors:
  `RST` and ROM calls land in `$0000`–`$2FFF`, which is never loaded. They are
  recorded for sub-project B's symbol tables.
- **`RST 08H` inline byte.** The byte after `RST 08H` is typed as data and
  skipped (the ROM's syntax-check idiom, plan "Heuristics"). No other `RST`
  takes a byte.
- **Absolute operands.** The emitter writes `JP 6005H`, not labels. Labels
  arrive with sub-project B and must keep the round trip green.
- **Byte-exact spelling.** An instruction is emitted as text only when zmac
  assembles that text back to the same bytes. Encodings zmac would shorten
  (the redundant `ED 63` and `ED 6B` forms of `LD (nn),HL` and `LD HL,(nn)`)
  and anything zmac rejects are emitted as `DB`. The table-wide test (§7)
  finds every such case; the list is recorded in the emitter with a comment,
  never discovered by users.
- **Undocumented spelling (plan open question, now decided).** Only `SLL` and
  the IX/IY half registers are emitted as instructions, spelled the way the
  pinned zmac accepts them (`ixh`, `ixl`, `iyh`, `iyl`; `sl1` or `sll` as the
  table test shows). Everything else undocumented is `DB`. The plan's open
  question is closed in the same change.
- **Pinned zmac, built from source.** `gp48k/zmac` at commit
  `050bbb1f9c60` (master, 2024-03-01, CC0). Built by a repo script into
  `tools/zmac/`, which is gitignored; CI builds it the same way; round-trip
  tests skip when it is absent, as the sample tests do. `FUGLOY_ZMAC`
  overrides the binary path.
- **Image comparison, never file comparison.** zmac writes a TRS-80 `.cmd`;
  the harness loads it with our own `.CMD` loader and compares `bytes`,
  `loaded`, and `entry`. Record layout is irrelevant by design.

## 4. Components and interfaces

All new code is in `packages/disasm` unless noted. No Node or DOM APIs in
`src/`; the harness and scripts are test-side.

### 4.1 `src/analysis/map.ts`

```ts
export const Kind = { Unknown: 0, Code: 1, Tail: 2, Byte: 3, Word: 4, String: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];
// A plain const object, not a const enum, so it survives isolatedModules.
// Word and String are reserved for sub-projects B and C; A uses Unknown, Code, Tail, Byte.
export class ByteMap {
  readonly kinds: Uint8Array;   // 65536
  readonly starts: Uint8Array;  // 65536, 1 at an instruction's first byte
  kind(addr: number): Kind;
  isStart(addr: number): boolean;
  markCode(addr: number, length: number): void;   // Code at addr, Tail after
  markByte(addr: number, length: number): void;
  /** True when any byte in [addr, addr+length) is already Code or Tail. */
  overlapsCode(addr: number, length: number): boolean;
}
```

### 4.2 `src/analysis/descent.ts`

```ts
export type XrefKind = 'jump' | 'cjump' | 'call' | 'ccall' | 'rst';
export interface Xref { from: number; to: number; kind: XrefKind }
export type DiagnosticKind = 'overlap' | 'inside-instruction' | 'in-data' | 'truncated';
export interface Diagnostic { kind: DiagnosticKind; addr: number; from?: number; message: string }
export interface Pass1 {
  map: ByteMap;
  instructions: Map<number, Instruction>;   // keyed by start address
  roots: number[];
  xrefs: Xref[];
  externals: number[];        // targets outside loaded memory, sorted, unique
  indirectJumps: number[];    // addresses of JP (HL)/(IX)/(IY)
  diagnostics: Diagnostic[];
}
export interface DescentOptions { entries?: number[] }
export function recursiveDescent(image: MemoryImage, roots: number[], opts?: DescentOptions): Pass1;
```

Algorithm: a worklist seeded with the roots (deduplicated, loaded ones only;
an unloaded root is a diagnostic). For each address popped: skip if already an
instruction start; diagnostic `inside-instruction` if it is a `Tail`,
`in-data` if it is a `Byte`. Otherwise decode linearly with a reader that
returns `undefined` for unloaded addresses:

- a truncated decode types the byte as `Byte`, records `truncated`, and ends
  the path;
- an instruction overlapping existing code records `overlap` and ends the
  path without marking;
- otherwise mark the instruction, store it, then act on its flow: `call`
  queues the target and continues; `rst` queues the fixed target and
  continues (after skipping the inline byte for `RST 08H`); conditional
  jumps queue the target and continue; unconditional jumps queue the target
  and end the path; indirect jumps, returns, and `HALT` end the path;
  conditional returns continue.

Every queued target that is not loaded goes to `externals` instead of the
worklist. Termination: each address is marked at most once and the worklist
only holds unmarked addresses, so the loop is bounded by the loaded size.

### 4.3 `src/analysis/regions.ts`

```ts
export type RegionKind = 'code' | 'bytes' | 'unknown';
export interface Region { kind: RegionKind; start: number; end: number }   // inclusive end
export interface Block { start: number; end: number; succ: { to: number; kind: XrefKind | 'next' | 'external' }[] }
export function regions(image: MemoryImage, map: ByteMap): Region[];   // within loaded runs, in address order
export function basicBlocks(pass1: Pass1): Block[];
```

A block starts at a root, a jump or call target, or the instruction after a
path-ending instruction, and ends at a path-ending instruction or just before
the next block start. Successors come from the stored instructions' flow.

### 4.4 `src/emit/zmac.ts`

```ts
export interface EmitOptions { source?: string; comments?: boolean }
export function emitZmac(image: MemoryImage, pass1: Pass1, entry: number | null, opts?: EmitOptions): string;
```

Output shape:

```
; non-contiguous.cmd — Fugløy pass 1, 2 runs, entry 6000H
        ORG     6000H
        LD      HL,3C00H
        LD      (HL),41H
        RET
        ORG     7000H
        DB      00H,01H,02H,03H,04H,05H,06H,07H
        END     6000H
```

Rules: one `ORG` per loaded run; instruction text from `@fugloy/z80`'s
formatter with the byte-exact exceptions of §3 rendered as `DB`; unknown and
`Byte` bytes as `DB` rows of at most 8 bytes that never cross an instruction
start or a run end; `END` with the entry address when there is one, bare
`END` otherwise; a comment column is optional (`; 6000` addresses) and off by
default because it is noise for the round trip. Tabs between columns; zmac
accepts upper case throughout.

### 4.5 `src/ir.ts`

```ts
export interface Ir {
  fugloyIr: 1;
  source?: string;
  format: 'cmd' | 'bas' | 'raw';
  entry: number | null;
  roots: number[];
  loaded: { start: number; end: number }[];
  regions: Region[];
  blocks: Block[];
  xrefs: Xref[];
  externals: number[];
  indirectJumps: number[];
  diagnostics: Diagnostic[];
}
export function buildIr(mod: CmdModule | BasProgram | RawModule, pass1: Pass1, source?: string): Ir;
```

Addresses are plain numbers. The web app (phase 4) and Part 2 read this;
sub-project B adds `symbols`. The version field changes only on a breaking
shape change.

### 4.6 `src/listing.ts` (extended)

`renderPass1Listing(mod, pass1, opts)`: the phase-1 column layout (`ADDR
BYTES  TEXT`) with instruction rows from `pass1.instructions` and `DB` rows for
everything else, a header naming the roots, reached bytes as a count and a
percentage of loaded bytes, external targets as a count, and every
diagnostic as a `; note:` line. The existing linear-sweep renderers remain for
`--sweep`.

### 4.7 `src/pipeline.ts`

```ts
export type Module = CmdModule | BasProgram | RawModule;
export interface AnalyzeOptions { entries?: number[] }
export interface Analysis { module: Module; pass1: Pass1; entry: number | null; roots: number[] }
export function analyze(mod: Module, opts?: AnalyzeOptions): Analysis;
```

Roots are the module's entry (when not null) plus `opts.entries`. A `.BAS`
module has no entry, so its analysis has no roots and its image is all
`Unknown`.

### 4.8 CLI (`packages/cli`)

```
fugloy <file> [--base <hex>] [--entry <hex>]... [--format listing|zmac|ir] [--sweep] [-o <path>]
```

- `--format listing` (default) prints the Pass 1 listing; for a `.BAS` file
  the detokenized listing is unchanged from phase 1.
- `--format zmac` prints the emitter's source; `--format ir` prints JSON.
- `--sweep` selects the phase-1 linear sweep listing instead of Pass 1.
- `--entry` may repeat; values accept the same hex forms as `--base`. An
  unloaded entry is an error (exit 2).
- `-o` writes to a file instead of stdout; everything else is unchanged.
- When a file has no entry and no `--entry`, the listing is all `DB` and the
  header says so and names both flags.

### 4.9 zmac tooling (test-side and scripts)

- `scripts/install-zmac.sh`: clones `gp48k/zmac` at the pinned commit into a
  temporary directory, runs `make zmac` in `src/` (bison and a C compiler
  required; on macOS the Makefile's `gcc` is clang, and the script passes the
  flags the old-style C needs, found when it is first built), and installs
  the binary at `tools/zmac/zmac`. Idempotent; `pnpm zmac:install` runs it.
- `packages/disasm/test/roundtrip/zmac.ts`: `findZmac()` (`FUGLOY_ZMAC`, then
  `tools/zmac/zmac`), `assemble(source) → { image, entry, listing, stderr }`
  (writes to a temp dir, runs zmac with output options for a `.cmd`, loads it
  with `loadCmd`), and `skipIfNoZmac()`.
- CI: a step that installs bison, runs the script with the binary cached by
  commit SHA, and runs the suite with zmac present. The job fails if the
  round-trip tests were skipped there, so CI cannot go green by accident.
- `tools/` is gitignored.

## 5. Data flow

```
file bytes → detectFormat → loadCmd | loadBas | loadRaw → Module
Module + entries → analyze → Pass1 (map, instructions, xrefs, diagnostics)
Pass1 → regions / basicBlocks → Ir → JSON
Pass1 → emitZmac → source → [zmac] → .cmd → loadCmd → image' == image?
Pass1 → renderPass1Listing → text
```

The loaders and the memory image are unchanged. `@fugloy/z80` is unchanged
except for an optional spelling hook if the table test shows zmac wants
`sl1`.

## 6. Error handling

- Descent never throws on program content: every anomaly is a `Diagnostic`
  carried through the IR and the listing.
- The emitter never throws on a valid `Pass1`; a byte it cannot spell is a
  `DB`.
- The CLI reports bad flags and unloaded entries with exit 2, unreadable
  files with exit 1, as today.
- In tests, a zmac failure reports zmac's stderr and the offending source
  path; a missing zmac skips with a message naming `pnpm zmac:install`.

## 7. Testing

Test-first for every unit, following the phase-1 pattern (writers, fixtures,
one test per rule).

- **Descent unit tests** on hand-built images: fall-through; both arms of a
  conditional branch; call target queued and fall-through continued; `RST 08H`
  inline byte typed as data; unconditional jump ends the path; `JP (HL)`
  recorded and ends the path; `RET` ends, `RET cc` continues; `HALT` ends; a
  loop revisits without re-marking; an overlap diagnostic; an
  inside-instruction diagnostic; an external target recorded, not queued; a
  truncated instruction at a run end typed as data; an unloaded root
  diagnosed.
- **Regions and blocks** derived from a known map; block boundaries at
  targets and after path ends; successors by kind.
- **Emitter** text: `ORG` per run, `DB` rows of eight that stop at an
  instruction start, `END` with and without an entry, each byte-exact
  exception emitted as `DB`.
- **IR**: shape and a committed snapshot for one synthetic fixture.
- **Listing**: header, reached percentage, diagnostics, `DB` rows.
- **CLI**: each flag, the no-entry message, `-o`.
- **Round trip, synthetic** (zmac): every `.CMD` and `.BAS` fixture and three
  raw images; equality of `bytes`, `loaded`, and `entry`.
- **Round trip, table** (zmac): all 1792 encodings emitted at successive
  addresses in one file, assembled once, bytes compared; this is what decides
  the §3 exception list and the undocumented spellings.
- **Round trip, real** (zmac and samples present): every appendix load module
  and the Valkyrie files as `DB`.
- **Determinism**: emitting twice gives identical text.

## 8. Risks

- zmac's old-style C may not build cleanly with current clang; mitigation is
  the flag set recorded in the script, found at first build.
- zmac's `.cmd` writer might split or order blocks unexpectedly; the harness
  compares images, so only a zmac bug that drops bytes would show, and it
  would show as a failing test.
- Descent on real programs will type some data as code (jump tables, inline
  parameters beyond `RST 08H`); that is expected in A, surfaces as odd
  listings, and is what sub-projects B and C address. The round trip is
  unaffected because bytes are bytes.

## 9. Sequencing inside A

1. zmac tooling and harness (install script, `assemble`, skip helper, CI),
   proven by assembling a hand-written three-line program.
2. Byte map and descent with unit tests.
3. Emitter with the table-wide round-trip test, resolving the exception list
   and spellings.
4. Regions, blocks, IR.
5. Pass 1 listing and the pipeline.
6. CLI flags.
7. Fixture and real-sample round trips; update the plan's open-questions
   list and `CHANGELOG.md`.
