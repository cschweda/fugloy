# Phase 1: Core Decoder and Loaders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm monorepo whose CLI prints a linear-sweep listing of any .CMD or raw binary and a detokenized listing of any .BAS, backed by a generated Z80 opcode table, a 64K memory image, content-detected loaders, synthetic fixture writers, and real-program tests.

**Architecture:** `packages/z80` generates every Z80 encoding from the x/y/z/p/q decomposition into per-prefix template tables and decodes bytes into structured instructions. `packages/disasm` owns the memory image, the .CMD/.BAS/raw loaders, format detection, the linear sweep, and listing text; it has no Node or DOM dependency. `packages/cli` is the only package that touches `fs`.

**Tech Stack:** pnpm 10 workspaces, Node 22, TypeScript strict (ESM only), Vitest, tsup for `dist/`, tsx for scripts. No runtime dependencies in `z80` or `disasm`.

**Spec:** `docs/Fugloy-Project-Plan.md` (sections Input formats, Pass 1 "Decoder", Testing, Stack, Appendix) plus `docs/phase-1-kickoff.md` and `CLAUDE.md`.

## Global Constraints

- pnpm monorepo, Node 22 LTS, TypeScript strict, ESM only, Vitest (CLAUDE.md "Stack and layout").
- `packages/z80` and `packages/disasm` have no runtime dependencies, no DOM, no Node APIs (CLAUDE.md).
- The 64K image is a `Uint8Array(65536)` with a parallel `Uint8Array` bitmap; never a sparse map (CLAUDE.md).
- Opcode tables are generated, never hand-edited (CLAUDE.md).
- Detect file format from content, never from extension (CLAUDE.md).
- Addresses print as `$3C00` in prose/comments and `3C00H` in emitted assembly (CLAUDE.md).
- `.CMD` `01` length byte counts the two address bytes and wraps: 0 → 254 data bytes, 1 → 255, 2 → 256 (plan).
- `.BAS` line: 2-byte next pointer, 2-byte line number, body, `00`; two zero bytes end the program; line N's body is at `ptr(N-1) + 4` (plan).
- Undocumented opcodes other than SLL and the IX/IY half registers decode as `DB` bytes (kickoff step 1).
- Hidden-code detection is phase 2; lines that fail to parse are reported as "unparsed" with address and length (kickoff step 4).
- Tests that need copyrighted programs skip when the folder is absent (CLAUDE.md). Programs are currently in `fixtures/real/` (gitignored); the docs say `sample/`. Both are gitignored and both are searched.
- Commit messages: imperative, one line, phase-prefixed (`p1: ...`), no AI attribution trailers (user's global CLAUDE.md).
- Do not start phase 2 (recursive descent, labels, hint files, emitters beyond the listing).

## Review Focus

Inputs the spec implies but no kickoff bullet names, each pinned to a test in the owning task:

1. A `DD`/`FD` prefix followed by an opcode that does not use HL/H/L/(HL) (for example `DD 00`, `DD EB`, `DD DD`): must decode as a one-byte `DB 0DDH` and the next byte must decode normally, so the sweep never desynchronizes. (Task 2)
2. A load block whose address plus length passes `$FFFF`: must wrap modulo 64K and be flagged, not throw. (Task 4)
3. A load block that runs past end of file (truncated record), or a record type outside `01`–`10`/`1F`: must stop with a warning and count the remainder as trailing bytes, not crash. (Task 5)
4. A `.BAS` line whose body contains a `00` before the position its next pointer implies (hidden code): the chain must still be followed by pointers and the line reported as unparsed with its address and length. (Task 7)
5. An instruction that would extend past the end of a loaded run (last byte of a block is `CD`): the sweep must emit `DB` for the remaining bytes and not read unloaded memory. (Task 9)

---

## File structure

```
package.json                      workspace root: scripts test/typecheck/build/fixtures
pnpm-workspace.yaml               packages/*
tsconfig.base.json                strict, ES2022, NodeNext-free "bundler" resolution, customConditions ["source"]
tsconfig.test.json                type-checks packages/*/test and scripts with node types
vitest.config.ts                  include packages/*/test/**/*.test.ts, alias @fugloy/* → src
.gitignore                        + sample/
packages/z80/
  package.json                    @fugloy/z80, exports: source → src/index.ts, default → dist/index.js
  tsconfig.json                   src only, types: []
  src/types.ts                    Operand, Flow, Instruction, Template
  src/tables.ts                   x/y/z/p/q generator → per-prefix Template[256]
  src/decode.ts                   decode(read, address) → Instruction
  src/format.ts                   hex helpers, formatOperand, formatInstruction
  src/index.ts                    public exports
  test/reference/build-reference.ts   independent flat-table builder (dev script)
  test/reference/z80.txt          committed reference, 1792 lines
  test/exhaustion.test.ts         every encoding vs reference
  test/decode.test.ts             operand values, rel targets, truncation, prefix-noop
  test/format.test.ts             hex style
packages/disasm/
  package.json                    @fugloy/disasm, depends on @fugloy/z80 workspace:*
  src/memory.ts                   MemoryImage, Block, Overlap, Run
  src/cmd.ts                      isCmd, loadCmd, record parser
  src/bas.ts                      isBas, loadBas, chain parser
  src/tokens.ts                   TOKENS table 80..FB
  src/detokenize.ts               detokenize(body) → text/ok/reason
  src/raw.ts                      loadRaw
  src/detect.ts                   detectFormat
  src/sweep.ts                    linearSweep(image) → ListingLine[]
  src/listing.ts                  render functions for cmd/bas/raw
  src/index.ts
  test/writers/cmd-writer.ts      synthetic .CMD record writer
  test/writers/basic-tokenizer.ts synthetic BASIC tokenizer + program writer
  test/fixtures.ts                every synthetic fixture by name → bytes
  test/fixtures.test.ts           committed files match writer output
  test/memory.test.ts
  test/cmd.test.ts                one test per loader rule
  test/bas.test.ts
  test/detokenize.test.ts
  test/detect.test.ts
  test/sweep.test.ts
  test/listing.test.ts
  test/real/samples.ts            resolveSample(), skipIfMissing()
  test/real/cmd.test.ts           appendix table assertions
  test/real/bas.test.ts
  scripts/write-fixtures.ts       writes fixtures/synthetic/
packages/cli/
  package.json                    @fugloy/cli, bin fugloy
  src/main.ts                     arg parsing, fs, dispatch
  src/index.ts                    run(argv, io) for tests
  bin/fugloy.js                   #!/usr/bin/env node; import ../dist/main.js
  test/cli.test.ts
fixtures/synthetic/cmd/*.cmd, fixtures/synthetic/bas/*.bas, fixtures/synthetic/README.md
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.test.json`, `vitest.config.ts`, `.gitignore` (modify), `packages/{z80,disasm,cli}/package.json`, `packages/*/tsconfig.json`, `packages/*/src/index.ts`, `fixtures/synthetic/README.md`

**Interfaces:**
- Produces: `pnpm test` (vitest run), `pnpm typecheck`, `pnpm build`, `pnpm fixtures`; `@fugloy/z80`, `@fugloy/disasm`, `@fugloy/cli` resolvable in tests via alias to `src/index.ts`.

- [ ] **Step 1: Write a smoke test in each package** (`packages/z80/test/smoke.test.ts`) that imports `VERSION` from `../src/index.ts` and from `@fugloy/z80`, expecting `'0.1.0'`. Same for disasm (importing `@fugloy/z80` through it).
- [ ] **Step 2: Run `pnpm test`; expect failure** (no packages installed / no index).
- [ ] **Step 3: Write the config files.** Root `package.json`:

```json
{
  "name": "fugloy", "private": true, "type": "module", "packageManager": "pnpm@10.33.4",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run", "test:watch": "vitest",
    "typecheck": "tsc -b packages/z80 packages/disasm packages/cli && tsc -p tsconfig.test.json",
    "build": "pnpm -r --filter './packages/*' run build",
    "fixtures": "tsx packages/disasm/scripts/write-fixtures.ts",
    "fugloy": "node packages/cli/bin/fugloy.js"
  },
  "devDependencies": { "@types/node": "^22", "tsup": "latest", "tsx": "latest", "typescript": "latest", "vitest": "latest" }
}
```

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target/module ES2022`, `moduleResolution bundler`, `customConditions ["source"]`, `isolatedModules`, `declaration`, `composite`. Package tsconfigs: `include: ["src"]`, `types: []`, `lib: ["ES2022"]` (disasm/z80) or `types: ["node"]` (cli). Package `exports`: `{ ".": { "source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`; build script `tsup src/index.ts --format esm --dts --clean`. `vitest.config.ts`: `test.include: ['packages/*/test/**/*.test.ts']`, `resolve.alias` for the three packages to their `src/index.ts`.
- [ ] **Step 4: `pnpm install`, `pnpm test`, `pnpm typecheck`; expect pass.**
- [ ] **Step 5: Commit** `p1: scaffold pnpm monorepo with z80, disasm, cli packages`.

---

### Task 2: Z80 opcode table and decoder

**Files:**
- Create: `packages/z80/src/types.ts`, `src/tables.ts`, `src/decode.ts`, `src/format.ts`, `src/index.ts`
- Test: `packages/z80/test/decode.test.ts`, `test/format.test.ts`

**Interfaces (produces):**

```ts
export type Reg8 = 'A'|'B'|'C'|'D'|'E'|'H'|'L'|'I'|'R'|'IXH'|'IXL'|'IYH'|'IYL';
export type Reg16 = 'AF'|'BC'|'DE'|'HL'|'SP'|'IX'|'IY'|"AF'";
export type Cond = 'NZ'|'Z'|'NC'|'C'|'PO'|'PE'|'P'|'M';
export type Operand =
  | { kind: 'reg'; reg: Reg8 } | { kind: 'reg16'; reg: Reg16 }
  | { kind: 'ind'; reg: 'BC'|'DE'|'HL'|'SP'|'IX'|'IY'|'C' }
  | { kind: 'idx'; reg: 'IX'|'IY'; disp: number }
  | { kind: 'imm8'; value: number } | { kind: 'imm16'; value: number }
  | { kind: 'mem'; addr: number } | { kind: 'port'; value: number }
  | { kind: 'rel'; disp: number; target: number }
  | { kind: 'cc'; cond: Cond } | { kind: 'bit'; bit: number }
  | { kind: 'rst'; addr: number } | { kind: 'im'; mode: 0|1|2 }
  | { kind: 'byte'; value: number };
export interface Flow { kind: 'next'|'jump'|'call'|'return'|'halt'; conditional: boolean; indirect: boolean }
export interface Instruction {
  mnemonic: string; operands: Operand[]; length: number; bytes: number[];
  cycles: number; cyclesNotTaken?: number; flow: Flow; documented: boolean; truncated?: boolean;
}
export type Reader = (index: number) => number | undefined;   // index relative to instruction start
export function decode(read: Reader, address?: number): Instruction;
export function decodeAt(bytes: ArrayLike<number>, offset: number, address?: number, end?: number): Instruction;
export function formatInstruction(ins: Instruction): string;  // 'LD A,(IX+05H)'
export function hexByte(n: number): string;  // '0DDH'
export function hexWord(n: number): string;  // '0A000H'
export function hex4(n: number): string;     // 'A000' (address column)
export const TABLES: { base: Template[]; cb: Template[]; ed: Template[]; dd: Template[]; fd: Template[]; ddcb: Template[]; fdcb: Template[] };
```

**Generator rules** (`tables.ts`), from x=bits 7-6, y=5-3, z=2-0, p=y>>1, q=y&1:

- r = [B,C,D,E,H,L,(HL),A]; rp = [BC,DE,HL,SP]; rp2 = [BC,DE,HL,AF]; cc = [NZ,Z,NC,C,PO,PE,P,M]; alu = [ADD A, ADC A, SUB, SBC A, AND, XOR, OR, CP]; rot = [RLC,RRC,RL,RR,SLA,SRA,SLL,SRL]; bli = LDI/CPI/INI/OUTI, LDD/CPD/IND/OUTD, LDIR/CPIR/INIR/OTIR, LDDR/CPDR/INDR/OTDR.
- Unprefixed, CB, ED exactly as in the decoding document; cycles per Zilog manual (table in `tables.ts` next to each rule). Conditional forms carry `cyclesNotTaken`: JR cc 12/7, DJNZ 13/8, RET cc 11/5, CALL cc 17/10, JP cc 10/10, LDIR family 21/16.
- ED undocumented (x=0, x=3, x=2 non-block, ED70, ED71, NEG/RETN/IM duplicates, ED77, ED7F) → `DB 0EDH,xxH`, length 2, documented=false, cycles 8 (12 for ED70/71, 14 for RETN dups).
- DD/FD tables are produced by substituting into the unprefixed table: HL→IX, (HL)→(IX+d) (length +1, cycles per IX table), H/L→IXH/IXL only when no (HL) operand is present. Opcodes unchanged by substitution (including `EB` EX DE,HL, `76` HALT, `DD`, `FD`, `ED`) become `DB 0DDH`, length 1, cycles 4, documented=false. `CB` → DDCB table.
- DDCB/FDCB: `DD CB d op`; z=6 forms are rot/BIT/RES/SET on (IX+d) (23/20/23 cycles); z≠6 → `DB 0DDH,0CBH,dd,opH`, length 4, documented=false.
- Flow: JP nn jump; JP cc,nn jump conditional; JR e jump; JR cc,e / DJNZ jump conditional; JP (HL)/(IX)/(IY) jump indirect; CALL nn call; CALL cc call conditional; RST call; RET/RETI/RETN return; RET cc return conditional; HALT halt; everything else next.

- [ ] **Step 1: Write failing decode tests** (`test/decode.test.ts`):

```ts
import { decodeAt, formatInstruction } from '../src/index.js';
const d = (bytes: number[], addr = 0) => decodeAt(bytes, 0, addr);
const t = (bytes: number[], addr = 0) => formatInstruction(d(bytes, addr));
it('decodes LD HL,nn little-endian', () => { const i = d([0x21, 0x00, 0x3c]); expect(i.length).toBe(3); expect(i.operands[1]).toEqual({ kind: 'imm16', value: 0x3c00 }); expect(t([0x21,0x00,0x3c])).toBe('LD HL,3C00H'); });
it('computes JR targets from the address', () => { expect(t([0x18, 0xfe], 0x4000)).toBe('JR 4000H'); expect(t([0x20, 0x05], 0x4000)).toBe('JR NZ,4007H'); expect(t([0x10, 0x80], 0x4000)).toBe('DJNZ 3F82H'); });
it('decodes (IX+d) with signed displacement and LD (IX+d),n byte order', () => { expect(t([0xdd, 0x36, 0xff, 0x12])).toBe('LD (IX-01H),12H'); expect(t([0xfd, 0x7e, 0x7f])).toBe('LD A,(IY+7FH)'); });
it('keeps H/L when the other operand is (IX+d)', () => { expect(t([0xdd, 0x66, 0x02])).toBe('LD H,(IX+02H)'); expect(t([0xdd, 0x74, 0x02])).toBe('LD (IX+02H),H'); expect(t([0xdd, 0x65])).toBe('LD IXH,IXL'); });
it('treats a DD prefix on an unaffected opcode as a one-byte DB', () => { for (const op of [0x00, 0xeb, 0x76, 0xdd, 0xed, 0xfd]) { const i = d([0xdd, op]); expect(i.length).toBe(1); expect(i.documented).toBe(false); expect(formatInstruction(i)).toBe('DB 0DDH'); } });
it('includes SLL and renders undocumented ED as DB', () => { expect(t([0xcb, 0x30])).toBe('SLL B'); expect(t([0xdd,0xcb,0x05,0x36])).toBe('SLL (IX+05H)'); expect(t([0xed, 0x70])).toBe('DB 0EDH,70H'); expect(d([0xed,0x70]).length).toBe(2); expect(t([0xdd,0xcb,0x05,0x00])).toBe('DB 0DDH,0CBH,05H,00H'); });
it('reports control flow', () => { expect(d([0xc3,0,0]).flow).toEqual({ kind:'jump', conditional:false, indirect:false }); expect(d([0xe9]).flow.indirect).toBe(true); expect(d([0xc8]).flow).toEqual({ kind:'return', conditional:true, indirect:false }); expect(d([0xcf]).flow.kind).toBe('call'); expect(d([0x76]).flow.kind).toBe('halt'); expect(d([0xc4,0,0]).cyclesNotTaken).toBe(10); });
it('returns a one-byte DB when bytes run out', () => { const i = decodeAt([0xcd, 0x00], 0, 0x5000, 2); expect(i.length).toBe(1); expect(i.truncated).toBe(true); expect(formatInstruction(i)).toBe('DB 0CDH'); });
```

- [ ] **Step 2: Run; expect FAIL** (module not found).
- [ ] **Step 3: Implement** `types.ts`, `tables.ts` (generator), `decode.ts`, `format.ts`, `index.ts`.
- [ ] **Step 4: Run; expect PASS.** Also `pnpm typecheck`.
- [ ] **Step 5: Commit** `p1: generate Z80 opcode tables and decoder`.

---

### Task 3: Exhaustion test against an independent reference

**Files:**
- Create: `packages/z80/test/reference/build-reference.ts`, `packages/z80/test/reference/z80.txt`, `packages/z80/test/exhaustion.test.ts`

**Reference format**, one line per encoding, 7 prefixes × 256 = 1792 lines, operand filler n=12H, nn=3412H, d=12H, e=12H, decoded at address 0000:

```
00 | NOP | 1 | 4 | next | doc
20 12 | JR NZ,0014H | 2 | 12/7 | jump? | doc
DD 00 | DB 0DDH | 1 | 4 | next | undoc
DD CB 12 06 | RLC (IX+12H) | 4 | 23 | next | doc
```

Flow column: `next`, `jump`, `jump?`, `jump*` (indirect), `call`, `call?`, `ret`, `ret?`, `halt`.

- [ ] **Step 1: Write `build-reference.ts`** from flat 256-entry string tables (unprefixed, CB, ED, DD with IX, DDCB with IX; FD/FDCB by textual IX→IY substitution) and flat cycle tables, with the same filler convention. It must not import from `src/`.
- [ ] **Step 2: Generate `z80.txt`** with `tsx packages/z80/test/reference/build-reference.ts > packages/z80/test/reference/z80.txt`.
- [ ] **Step 3: Write `exhaustion.test.ts`**: for each prefix and opcode 0..255, build the byte sequence with filler, `decodeAt(..., 0)`, render the line, compare to the reference line. Report all mismatches in one assertion message.
- [ ] **Step 4: Run; resolve every mismatch** by checking the Zilog manual rule; fix whichever side is wrong (generator or flat table), never the committed text by hand.
- [ ] **Step 5: Commit** `p1: add Z80 opcode exhaustion test with committed reference`.

---

### Task 4: Memory image

**Files:**
- Create: `packages/disasm/src/memory.ts`; Test: `packages/disasm/test/memory.test.ts`

**Interfaces (produces):**

```ts
export interface Block { index: number; start: number; length: number; end: number; wrapped: boolean }  // end inclusive
export interface Overlap { block: number; earlier: number; start: number; end: number }
export interface Run { start: number; end: number; length: number }
export class MemoryImage {
  readonly bytes: Uint8Array;     // 65536
  readonly loaded: Uint8Array;    // 65536, 0 or 1
  readonly blocks: Block[]; readonly overlaps: Overlap[];
  load(addr: number, data: ArrayLike<number>): Block;
  isLoaded(addr: number): boolean;
  read(addr: number): number | undefined;   // undefined when not loaded
  runs(): Run[];
  lowestLoaded(): number | null;
}
```

- [ ] **Step 1: Failing tests:** load writes bytes and bitmap; two blocks record extents in order; a later block overwrites and records an overlap with the exact intersection; adjacent blocks merge into one run; non-adjacent blocks make two runs; a block at `$FFFE` of 4 bytes wraps to `$0000`–`$0001` with `wrapped: true`; `read` of an unloaded address is `undefined`; `lowestLoaded` of an empty image is `null`.
- [ ] **Step 2: Run; FAIL. Step 3: Implement. Step 4: PASS. Step 5: Commit** `p1: add 64K memory image with load bitmap and block log`.

---

### Task 5: Synthetic .CMD writer and .CMD loader

**Files:**
- Create: `packages/disasm/test/writers/cmd-writer.ts`, `src/cmd.ts`, `test/fixtures.ts`, `test/cmd.test.ts`, `scripts/write-fixtures.ts`, `test/fixtures.test.ts`, `fixtures/synthetic/cmd/*.cmd`

**Interfaces:**

```ts
// writer (test only)
export class CmdWriter { load(addr: number, data: ArrayLike<number>): this; transfer(addr: number): this; endNoTransfer(): this;
  header(name: string): this; copyright(text: string): this; record(type: number, payload: ArrayLike<number>): this; raw(bytes: ArrayLike<number>): this; bytes(): Uint8Array }
// loader
export type CmdRecord =
  | { type: 1; offset: number; lengthByte: number; addr: number; dataLength: number; block: number }
  | { type: 2; offset: number; addr: number } | { type: 3; offset: number }
  | { type: 5; offset: number; name: string } | { type: 0x1f; offset: number; text: string }
  | { type: number; offset: number; payloadLength: number };   // 04, 06..10
export interface CmdModule { format: 'cmd'; image: MemoryImage; entry: number | null; entrySource: 'transfer'|'lowest'|'none';
  executable: boolean; name?: string; copyright?: string; records: CmdRecord[]; trailing: number; warnings: string[] }
export function isCmd(bytes: Uint8Array): boolean;
export function loadCmd(bytes: Uint8Array): CmdModule;
```

Record rules: `01` data length = lengthByte − 2, +256 when ≤ 0. Every other typed record has a length byte where 0 means 256. `02` reads the address from the 2 payload bytes, stops. `03` stops, `executable=false`. `05` name (trailing spaces trimmed), `1F` text. `04`, `06`–`10` skipped and logged. Unknown type or truncated record → warning, stop. Bytes after the stop are `trailing`. No `02`/`03` seen → entry = lowest loaded address, `entrySource: 'lowest'`, warning.

- [ ] **Step 1: Write the writer, then one fixture per rule in `test/fixtures.ts`:** `len-wrap-254`, `len-wrap-255`, `len-wrap-256` (blocks of 254/255/256 bytes; plus `small-block` of 1 byte), `overlap` (patch inside an earlier block), `out-of-order` (high block first), `non-contiguous` (two runs), `missing-02` (EOF after loads), `end-03` (03 record), `trailing-bytes` (junk after 02), `header-05`, `copyright-1f`, `pds-records` (one of each 04, 06..10 with payloads, including a 256-byte payload via length 0), `truncated`, `unknown-type`, `wraps-ffff`.
- [ ] **Step 2: One test per rule** asserting image contents, blocks, runs, overlaps, entry, name/copyright, trailing count, warnings, and `isCmd`. Plus `isCmd` false for a BASIC file, random text, an empty buffer.
- [ ] **Step 3: Run; FAIL. Step 4: Implement `cmd.ts`. Step 5: PASS.**
- [ ] **Step 6: `scripts/write-fixtures.ts`** writes every fixture to `fixtures/synthetic/cmd/<name>.cmd`; `fixtures.test.ts` asserts each committed file equals the writer's bytes. Run `pnpm fixtures`, commit the files.
- [ ] **Step 7: Commit** `p1: add .CMD loader, synthetic writer, and fixtures`.

---

### Task 6: BASIC tokenizer (test writer) and token table

**Files:**
- Create: `packages/disasm/src/tokens.ts`, `test/writers/basic-tokenizer.ts`; Test: `test/tokenizer.test.ts`

**Interfaces:**

```ts
export const TOKENS: readonly string[];            // index 0 = 0x80 'END' ... index 123 = 0xFB "'"
export const TOKEN_BYTES: ReadonlyMap<string, number>;
// writer
export function tokenizeLine(text: string): Uint8Array;   // body bytes, no header, no terminator
export interface BasicLineSpec { number: number; text?: string; raw?: ArrayLike<number> }
export function writeBasic(lines: BasicLineSpec[], base: number, opts?: { header?: boolean; trailing?: ArrayLike<number> }): Uint8Array;
```

Tokenizer rules: longest keyword match at each position outside literal regions, case-insensitive, with `'` emitted as `3A 93 FB` and `ELSE` as `3A 95`; inside `"..."` copy; after `REM`/`'` copy to end; after `DATA` copy to `:` (quotes tracked). `raw` lines take bytes verbatim (hidden code).

- [ ] **Step 1: Tests:** `TOKENS.length === 124`, `TOKENS[0]==='END'`, `TOKENS[123]==="'"`, `TOKEN_BYTES.get('PRINT')===0xB2`; `tokenizeLine('PRINT"HI"')` = `B2 22 48 49 22`; `FOR I=1 TO 10` → `81 20 49 D5 31 20 BD 20 31 30`; `REM FOR` keeps `FOR` literal; `DATA FOR,1:PRINT` keeps `FOR` literal and tokenizes `PRINT`; `'` → `3A 93 FB`; `IF A THEN 1 ELSE 2` → `... 3A 95 ...`; `writeBasic([{number:10,text:'END'}], 0x6000)` = `FF 07 60 0A 00 80 00 00 00` (pointer = base + 5 + 2? compute: line is at 6000, length 4+1+1=6, next pointer 6006), with `header:false` omitting FF.
- [ ] **Step 2–5: FAIL, implement, PASS, commit** `p1: add BASIC token table and synthetic tokenizer`.

---

### Task 7: .BAS loader and detokenizer

**Files:**
- Create: `src/detokenize.ts`, `src/bas.ts`; Test: `test/detokenize.test.ts`, `test/bas.test.ts`; fixtures `fixtures/synthetic/bas/*.bas`

**Interfaces:**

```ts
export interface Detokenized { text: string; ok: boolean; reason?: string }
export function detokenize(body: Uint8Array): Detokenized;   // body excludes header; may include trailing 00
export interface BasLine { number: number; addr: number; offset: number; length: number; body: Uint8Array; text: string; parsed: boolean; reason?: string }
export interface BasProgram { format: 'bas'; base: number; header: boolean; lines: BasLine[]; end: number; image: MemoryImage; trailing: number; warnings: string[] }
export function isBas(bytes: Uint8Array): boolean;
export function loadBas(bytes: Uint8Array): BasProgram;
```

Chain rules: optional `FF`; base = ptr(1) − size(line 1) where size is found at the first `00` after the 4-byte header, re-tried at each later `00` until the chain validates (pointers strictly increasing, in bounds, ending with `00 00`). `length` = bytes from the pointer to the end of the line as implied by the next pointer. `parsed=false` when the last byte is not `00`, a `00` occurs earlier, or an `FC`–`FF` byte appears outside a literal region. Detokenize: tokens to text, `3A 95`→`ELSE`, `3A 93 FB`→`'`, literal regions as in Task 6, non-printable bytes as `{hh}`.

- [ ] **Step 1: Detokenize tests** (inverse of Task 6 cases, plus `{80}` escaping inside strings, `ok=false` for `FC` outside strings, `ok=false` for embedded `00`).
- [ ] **Step 2: Fixtures:** the same 6-line program written from `$62C8` and `$7000` (`bas/prog-62c8.bas`, `bas/prog-7000.bas`), one with `header:false`, one with a raw hidden-code line (`bas/hidden-code.bas`: line 20 raw `C3 00 00 C9 00 3E`), one with trailing bytes. Tests: both bases decode to identical texts and line numbers; `base` equals the save address; `addr` of line N = `ptr(N-1)`, body at `+4`; image bytes at `base` equal the file bytes after the header; the hidden line is `parsed:false` with correct `addr`/`length`; `isBas` false for a .CMD fixture and for random bytes.
- [ ] **Step 3–5: FAIL, implement, PASS. Add fixtures to `write-fixtures.ts` and `fixtures.test.ts`, run `pnpm fixtures`.**
- [ ] **Step 6: Commit** `p1: add .BAS loader and detokenizer with fixtures`.

---

### Task 8: Format detection and raw loader

**Files:**
- Create: `src/detect.ts`, `src/raw.ts`; Test: `test/detect.test.ts`

```ts
export type Format = 'cmd' | 'bas' | 'raw';
export function detectFormat(bytes: Uint8Array): Format;   // cmd first, then bas, else raw
export interface RawModule { format: 'raw'; image: MemoryImage; entry: number }
export function loadRaw(bytes: Uint8Array, base: number): RawModule;
```

- [ ] Tests: each synthetic CMD fixture → `cmd`; each BAS fixture → `bas`; `[0x21,0,0x3c,0xc9]` → `raw`; empty → `raw`; a BAS file whose first byte happens to be `01` (line pointer low byte) is still `bas` because the CMD chain fails. `loadRaw` makes one block at base.
- [ ] Commit `p1: add content-based format detection and raw loader`.

---

### Task 9: Linear sweep and listing text

**Files:**
- Create: `src/sweep.ts`, `src/listing.ts`; Test: `test/sweep.test.ts`, `test/listing.test.ts`

```ts
export interface ListingLine { addr: number; bytes: number[]; text: string; comment?: string }
export interface Section { run: Run; lines: ListingLine[] }
export function linearSweep(image: MemoryImage): Section[];
export function renderCmdListing(mod: CmdModule, opts?: { source?: string }): string;
export function renderRawListing(mod: RawModule): string;
export function renderBasListing(prog: BasProgram): string;
```

Listing line: `hex4(addr)  bytes padded to 11  text`. Each section starts with `        ORG 6000H`. The entry address line gets comment `; entry`. Header comments list blocks, runs, overlaps (`; block 2 $9267-$9269 patches block 0`), name, copyright, trailing bytes, warnings. BAS listing: header with base, header byte, line count, unparsed count; each line `NNN text`; unparsed lines `NNN [unparsed: 37 bytes at $6E12: reason]`.

- [ ] Tests: sweep of `21 00 3C C9` at `$6000` gives two lines with correct bytes/text; a run ending in `CD` yields `DB 0CDH` with `truncated`; two runs give two sections with ORG; the entry comment appears; the BAS listing matches an expected string for the `$62C8` fixture.
- [ ] Commit `p1: add linear sweep and listing renderers`.

---

### Task 10: CLI

**Files:**
- Create: `packages/cli/src/main.ts`, `src/index.ts`, `bin/fugloy.js`; Test: `packages/cli/test/cli.test.ts`

```ts
export interface Io { stdout(s: string): void; stderr(s: string): void; readFile(path: string): Promise<Uint8Array> }
export async function run(argv: string[], io: Io): Promise<number>;   // exit code
```

Usage: `fugloy <file> [--base <hex>]`. Raw without `--base` → stderr message, exit 2. Missing file → exit 1. `--help`.

- [ ] Tests with a fake `Io`: CMD fixture prints `ORG` and the entry comment; BAS fixture prints line 10; raw with `--base 5200` prints `5200`; raw without base exits 2 with message.
- [ ] `pnpm build` then `pnpm fugloy fixtures/synthetic/cmd/non-contiguous.cmd` prints the listing.
- [ ] Commit `p1: add fugloy CLI`.

---

### Task 11: Real-program tests

**Files:**
- Create: `packages/disasm/test/real/samples.ts`, `test/real/cmd.test.ts`, `test/real/bas.test.ts`

`resolveSample(name)` searches `<repo>/sample/` then `<repo>/fixtures/real/` recursively by basename; `skipIfMissing(name)` → `it.skip` when absent. Expected table from the plan appendix (inclusive ranges):

| file | runs | entry | extra |
|---|---|---|---|
| asylum1a.cmd | 6000–9D66 | 9D1C | |
| asylum1b.cmd | 6300–B248 | B112 | trailing 823 |
| asylum1c.cmd | A000–EF48 | EE12 | |
| asylum1d.cmd | 5200–A148 | A012 | |
| asylum1e.cmd | 4016–4017, 5200–A020 | A012 | name present |
| asylum1f.cmd | 6100–ADA6 | AD92 | |
| asylum16.cmd | 8000–BFEF | 8000 | |
| asylum32.cmd | 4016–4017, 8000–CE20 | CE12 | |
| asylum1g.cmd | 3C00–3FFF, 62F3–B13A | B117 | |
| asylumd.bad | 8000–CE20, D000–D114 | CE12 | overlaps 9267–9269, B01C–B01E |
| volcano.cmd | 3C00–4005, 52E9–9142 | 9134 | |
| GO.CMD | F000–F0BD | F000 | 190 bytes |
| ARMOUR.III | 8000–B8FF | B801 | overlap B801–B80F |
| valkyr*.bas | base in [62C8, 6F00] | `GOTO 248` in text | 257 lines |

- [ ] Tests assert runs, entry, overlaps, trailing exactly; every CMD sweeps without throwing and the sweep's byte count equals the loaded byte count; every BAS has 257 lines, base in range, a line containing `GOTO 248`, line 250 containing `POKE` and `195`.
- [ ] Commit `p1: add real-program snapshot tests (skip when samples absent)`.

---

### Task 12: Report

- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, and the CLI on one real file. Write the report: what passes, what was ambiguous in the plan, what in the plan looks wrong. Update `docs/Fugloy-Project-Plan.md` only where a decision was superseded (none expected in phase 1); note doc discrepancies rather than silently editing.
