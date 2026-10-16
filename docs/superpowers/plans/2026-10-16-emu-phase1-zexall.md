# Emu Phase 1: The Z80 Core Passes ZEXALL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/emu`'s Z80 core passes ZEXDOC and ZEXALL (all 67 groups each, the undocumented flags included), takes the same T-states as `@fugloy/z80`'s table for every opcode, and meets spec §4 where the exercisers cannot look: MEMPTR, the ED table, prefix chains, and the block I/O flags.

**Architecture:** The exercisers are CP/M programs. A test harness gives the core flat 64K RAM, traps BDOS functions 2 and 9 at `0005H`, and stops at a jump to `0000H`; a runner cuts the exerciser's group table down to one entry, so each of the 67 groups is its own Vitest test. The binaries are GPL-2.0, so they are downloaded pinned and hash-checked, the way zmac is built, and never committed. Every CPU fix is test-first: unit tests pin each rule, and the exerciser groups are the integration proof.

**Tech Stack:** Plain JavaScript ESM in `packages/emu` (no TypeScript, no Node or DOM APIs in `src/`); Vitest 5; `@fugloy/z80` as the timing reference, in tests only.

**Spec:** `docs/fugloy-emu-spec.md` — §4 (CPU), §10 (CPU tests: "ZEXALL and ZEXDOC via a CP/M BDOS shim — All 67 test groups OK, including undocumented flags"; "Per-instruction timing table vs. a known-good reference — Zero deviations"), §11 (phase 1: "Z80 core hardened — ZEXALL passes"), §2.2 (deterministic), §2.6 ("Correct before fast").

**Measured before planning (2026-10-16, this machine):**

- ZEXDOC passes 67/67: 46.6×10⁹ T-states in 408 s, 114 MHz effective.
- ZEXALL passes 65/67 in 402 s. The two failures:
  - `bit n,<b,c,d,e,h,l,(hl),a>`: CRC expected `5e020e98`, found `b560ef65`.
  - `<daa,cpl,scf,ccf>`: CRC expected `6d2dd213`, found `95dd98aa`.
- Group times: the three `aluop` groups take 173, 89, and 46 s; every other group takes 20 s or less; the last group alone takes 21 ms.
- The two causes:
  - `CPL` (`2FH`) never sets flags 3 and 5.
  - MEMPTR (`this.wz`) is not set by about twenty kinds of instruction, among them `LD SP,(nn)` (`ED 7B`). ZEXALL's harness runs that one just before every instruction under test, and `BIT n,(HL)` shows MEMPTR's high byte in flags 3 and 5.
- Gaps the exercisers cannot see:
  - `ED 70`, `ED 71`, the `NEG`/`RETN`/`IM` duplicates, and every undefined `ED` opcode reach `reportUnimplemented`. That costs 4 T-states (real: 8, or 12 for `70`/`71`, or 14 for the `RETN`s) and throws in strict mode.
  - A `DD` or `FD` before `DD`, `FD`, or `ED` runs the second byte as an opcode with HL swapped for IX: `DD DD 21 nn` loads HL.
  - `DD EB` and `DD D9` swap IX in.
  - `INI`/`IND`/`OUTI`/`OUTD` set only Z, N, 3 and 5.
  - Save states drop MEMPTR.
- Already right, and covered by phase 0's tests:
  - R counts every opcode fetch, prefixes included.
  - The EI delay, IM 1 and 2, NMI, HALT waking, the IFF restore on RETI/RETN, and `LD A,I`/`LD A,R` P/V.
  - MEMPTR for:
    - `LD A,(nn)` and its kin;
    - 16-bit `ADD`/`ADC`/`SBC`;
    - `RLD`/`RRD` and `CPI`/`CPD`;
    - DDCB.
- Speed is already 2.8× the 40 MHz the spec asks for.

## Global Constraints

- `packages/emu/src` stays plain JavaScript ESM with no Node or DOM APIs; the platform scan and the `node:vm` check keep passing.
- The exercisers stay out of git:
  - They are Frank Cringle's ZEXDOC and ZEXALL, GPL-2.0, from `agn453/ZEXALL` at commit `8f71d418bae69a476a5a0e5c6e122c8801b8d9f4`.
  - `pnpm zex:install` downloads them into the gitignored `tools/zex/`.
  - Their SHA-256: `zexdoc.com` `34923a7ed82285d3038b2d54bd64899e12173eebb61f9d07b4fc72e78af2ae8f`, `zexall.com` `6e2da55147a04f28d303d5da6a1e6b771557ac244653590a0f24a2d39c8537e8`.
  - Never commit them.
- The full exerciser run takes minutes, so the suites run only with `FUGLOY_ZEX=1`; the default `pnpm test` stays fast. `FUGLOY_REQUIRE_ZEX=1` turns a missing binary into a failure (CI).
- Stop at phase 1. Not in scope:
  - the `Machine` facade, Model I/4, devices, loaders, and any speed work (§2.6);
  - SCF/CCF taking flags 3 and 5 from the previous instruction's flags (Patrik Rak's z80test; ZEXALL's daa group never varies those F bits, its counter mask for F being `D7H`);
  - the flags of a repeating block instruction interrupted mid-run;
  - IM 0 with a bus byte other than `FFH` (the Model III bus reads `FFH`);
  - the §4 "Decode" row's sub-tables. Task 7 changes the spec to match the code (switch dispatch for prefixed opcodes) rather than the code to match the spec.
- New test files follow phase 0's own: single quotes, `import { describe, expect, it } from 'vitest'`. Edits to ported upstream files keep their double quotes.
- Commits: imperative, one line, prefixed `emu1:`, no AI co-author or session trailers.

## Review Focus

1. **A MEMPTR rule with its halves swapped or off by one.** Three forms are easy to get wrong:
   - `OUT (n),A`: the low byte is n+1, the high byte is A.
   - `IN A,(n)`: `(A<<8 | n) + 1`, using A before the read.
   - `IN B,(C)`: B is overwritten, so BC must be taken before.

   Task 3's table tests every member of every family.
2. **Prefix chains real code rarely uses but copy protection might:** `DD DD`, `DD FD`, `FD ED`, `DD EB`, `FD D9`, and an interrupt arriving between a lone prefix and its instruction. Task 5.
3. **An exerciser group that "passes" without running.** A mis-cut table prints only the banner. The runner demands the group's own 30-character label followed by `  OK`, and each suite also checks it found 67 groups. Task 1.
4. **Both outcomes of every conditional and repeating instruction, and every lone prefix,** must cost what the table says. Task 6.
5. **A save state taken mid-program must resume identically.** MEMPTR and the lone-prefix flag are CPU state. Tasks 3 and 5.

---

### Task 1: The exercisers, a CP/M harness, and a runner that runs one group at a time

**Files:**
- Create: `scripts/install-zex.sh`, `packages/emu/test/cpm.js`, `packages/emu/test/zex.js`, `packages/emu/test/cpm.test.js`, `packages/emu/test/exerciser/zexdoc.test.js`, `packages/emu/test/exerciser/zexall.test.js`
- Modify: `package.json` (script `zex:install`)

**Interfaces:**
- Produces, from `packages/emu/test/cpm.js`: `runCpm(program: Uint8Array, { maxTStates = 2e11 } = {}) → { output: string, tstates: number, exited: boolean }`.
- Produces, from `packages/emu/test/zex.js`:
  - `zexBinary(name: 'zexdoc.com' | 'zexall.com') → Uint8Array | null`;
  - `zexGroups(program) → { pointer: number, name: string, label: string }[]`, where `label` is the 30-character dot-padded name the exerciser prints;
  - `runZexGroup(program, index) → string`, the group's result line, e.g. `'ld (<bc,de>),a................  OK'`;
  - `ZEX_TIMEOUT` (ms).

- [ ] **Step 1: Write `scripts/install-zex.sh`**

```bash
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
```

Add `"zex:install": "bash scripts/install-zex.sh"` to the root `package.json` scripts, after `zmac:install`.

- [ ] **Step 2: Check the script both ways**

Run: `pnpm zex:install && pnpm zex:install`
Expected: two `fetched …` lines, then two `… already at …` lines.

Run: `sed -i.bak 's/34923a7e/34923a7f/' scripts/install-zex.sh && rm tools/zex/zexdoc.com; pnpm zex:install; echo "exit $?"; mv scripts/install-zex.sh.bak scripts/install-zex.sh && pnpm zex:install`
Expected: `install-zex: zexdoc.com has SHA-256 34923a7e…, expected 34923a7f…` and `exit 1`, with no `tools/zex/zexdoc.com` left behind; then the restored script fetches it again.

- [ ] **Step 3: Write the failing harness tests** — `packages/emu/test/cpm.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { runCpm } from './cpm.js';

describe('the CP/M harness', () => {
  it('prints with BDOS 9 up to the $ and with BDOS 2 from E, and ends at a jump to 0000H', () => {
    // 0100 LD DE,0112H / LD C,9 / CALL 5 / LD E,'!' / LD C,2 / CALL 5 / JP 0 / 0112 DB 'HI$'
    const program = Uint8Array.from([
      0x11, 0x12, 0x01, 0x0e, 0x09, 0xcd, 0x05, 0x00, 0x1e, 0x21, 0x0e, 0x02, 0xcd, 0x05, 0x00, 0xc3, 0x00, 0x00,
      0x48, 0x49, 0x24,
    ]);
    expect(runCpm(program)).toMatchObject({ output: 'HI!', exited: true });
  });

  it('gives up after maxTStates when the program never ends', () => {
    // 0100 JR 0100H
    expect(runCpm(Uint8Array.from([0x18, 0xfe]), { maxTStates: 1000 })).toMatchObject({ exited: false });
  });
});
```

- [ ] **Step 4: Run them and watch them fail**

Run: `pnpm -s vitest run packages/emu/test/cpm.test.js`
Expected: FAIL — `./cpm.js` cannot be found.

- [ ] **Step 5: Write `packages/emu/test/cpm.js`**

```js
/**
 * A CP/M stand-in for running .COM programs, the Z80 exercisers among them, on the core: flat
 * 64K RAM with the program at 0100H; BDOS at 0005H, with functions 2 (print E) and 9 (print the
 * $-terminated string at DE) trapped; a jump to 0000H ends the run. (0006H) holds FE00H, the top
 * of memory, where the BDOS jump lands on a RET.
 */
import { Z80CPU } from '../src/index.js';

export function runCpm(program, { maxTStates = 2e11 } = {}) {
  const mem = new Uint8Array(0x10000);
  mem.set(program, 0x100);
  mem.set([0xc3, 0x00, 0x00], 0x0000);
  mem.set([0xc3, 0x00, 0xfe], 0x0005);
  mem[0xfe00] = 0xc9;
  const cpu = new Z80CPU();
  cpu.strictMode = true;
  cpu.readMemory = (a) => mem[a];
  cpu.writeMemory = (a, v) => {
    mem[a] = v;
  };
  cpu.readPort = () => 0xff;
  cpu.writePort = () => {};
  cpu.reset();
  cpu.registers.SP = 0xfe00;
  cpu.registers.PC = 0x0100;
  let output = '';
  while (cpu.cycles < maxTStates) {
    const pc = cpu.registers.PC;
    if (pc === 0x0000) return { output, tstates: cpu.cycles, exited: true };
    if (pc === 0x0005) {
      if (cpu.registers.C === 2) output += String.fromCharCode(cpu.registers.E);
      else if (cpu.registers.C === 9) {
        for (let a = cpu.DE; mem[a] !== 0x24; a = (a + 1) & 0xffff) output += String.fromCharCode(mem[a]);
      }
    }
    cpu.executeInstruction();
  }
  return { output, tstates: cpu.cycles, exited: false };
}
```

Run: `pnpm -s vitest run packages/emu/test/cpm.test.js`
Expected: 2 passed.

- [ ] **Step 6: Write the failing runner tests** — add `import { runZexGroup, zexBinary, zexGroups } from './zex.js';` to the imports of `packages/emu/test/cpm.test.js`, and at its end:

```js
const zexdoc = zexBinary('zexdoc.com');

describe('the exerciser runner (pnpm zex:install)', () => {
  it.skipIf(zexdoc === null)('finds the 67 groups and their names in the binary', () => {
    const groups = zexGroups(zexdoc);
    expect(groups).toHaveLength(67);
    expect(groups[0].name).toBe('<adc,sbc> hl,<bc,de,hl,sp>');
    expect(groups[66]).toMatchObject({ name: 'ld (<bc,de>),a', label: 'ld (<bc,de>),a................' });
  });

  it.skipIf(zexdoc === null)('runs one group alone and returns its result line', () => {
    expect(runZexGroup(zexdoc, 66)).toBe('ld (<bc,de>),a................  OK');
  });
});
```

Run: `pnpm -s vitest run packages/emu/test/cpm.test.js`
Expected: FAIL — `./zex.js` cannot be found.

- [ ] **Step 7: Write `packages/emu/test/zex.js`**

```js
/**
 * ZEXDOC and ZEXALL, from tools/zex/ (pnpm zex:install). Each .COM begins JP start, and start
 * loads HL with the address of a table of test-group pointers that ends at a 0000H word. A group
 * descriptor is a flag-mask byte, three 20-byte machine states (base, counter mask, shifter
 * mask), and the expected 4-byte CRC: 65 bytes. The group's name follows, padded with dots to
 * 30 characters and ended by $; the exerciser prints it, then "  OK" or "  ERROR ...".
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCpm } from './cpm.js';

const TOOLS = new URL('../../../tools/zex/', import.meta.url);

/** A Vitest timeout per group: the largest takes about 3 minutes on a 2024 laptop. */
export const ZEX_TIMEOUT = 30 * 60_000;

/** The largest group needs about 2×10^10 T-states; one still running at this many has hung. */
const GROUP_TSTATES = 5e10;

export function zexBinary(name) {
  const path = fileURLToPath(new URL(name, TOOLS));
  if (existsSync(path)) return new Uint8Array(readFileSync(path));
  if (process.env.FUGLOY_REQUIRE_ZEX === '1') throw new Error(`${path} is missing: run pnpm zex:install`);
  return null;
}

/** The little-endian word at address `a` of a program loaded at 0100H. */
const word = (p, a) => p[a - 0x100] | (p[a - 0x100 + 1] << 8);

/** The group table: the first LD HL,nn after start whose nn is a run of 60 or more pointers ending at 0000H. */
function tableAddress(p) {
  if (p[0] !== 0xc3) throw new Error('not an exerciser: it does not begin with JP');
  const start = word(p, 0x101);
  for (let a = start; a < start + 64; a++) {
    if (p[a - 0x100] !== 0x21) continue;
    const t = word(p, a + 1);
    let n = 0;
    while (t + 2 * n + 1 - 0x100 < p.length && word(p, t + 2 * n) !== 0) n++;
    if (n >= 60) return t;
  }
  throw new Error('no group table after start');
}

export function zexGroups(p) {
  const t = tableAddress(p);
  const groups = [];
  for (let i = 0; word(p, t + 2 * i) !== 0; i++) {
    const pointer = word(p, t + 2 * i);
    const label = String.fromCharCode(...p.subarray(pointer + 65 - 0x100, pointer + 95 - 0x100));
    groups.push({ pointer, name: label.replace(/\.+$/, ''), label });
  }
  return groups;
}

/** Runs group `index` alone, the table cut to that one entry, and returns the line it printed. */
export function runZexGroup(p, index) {
  const t = tableAddress(p);
  const { pointer, label } = zexGroups(p)[index];
  const alone = p.slice();
  alone.set([pointer & 0xff, pointer >> 8, 0, 0], t - 0x100);
  const { output, exited } = runCpm(alone, { maxTStates: GROUP_TSTATES });
  if (!exited) throw new Error(`group ${index + 1} (${label}) did not finish in ${GROUP_TSTATES} T-states`);
  // This build ends its lines LF CR. A whole label, dots and all, cannot match another group's line.
  const line = output.split(/[\r\n]+/).find((l) => l.startsWith(label));
  if (line === undefined) throw new Error(`group ${index + 1} printed no result line: ${JSON.stringify(output)}`);
  return line;
}
```

Run: `pnpm -s vitest run packages/emu/test/cpm.test.js`
Expected: 4 passed (with `tools/zex/` present). Then `mv tools/zex tools/zex.off && pnpm -s vitest run packages/emu/test/cpm.test.js; mv tools/zex.off tools/zex`. Expected: 2 passed, 2 skipped.

- [ ] **Step 8: Write the exerciser suites** — `packages/emu/test/exerciser/zexdoc.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { runZexGroup, ZEX_TIMEOUT, zexBinary, zexGroups } from '../zex.js';

// ZEXDOC checks the documented flags. The full run takes about 7 minutes, so it waits for FUGLOY_ZEX=1.
const program = process.env.FUGLOY_ZEX === '1' ? zexBinary('zexdoc.com') : null;
const groups = program === null ? [] : zexGroups(program);

describe.skipIf(program === null)('ZEXDOC, group by group (FUGLOY_ZEX=1)', { timeout: ZEX_TIMEOUT }, () => {
  it('has 67 groups', () => {
    expect(groups).toHaveLength(67);
  });

  for (const [i, { name }] of groups.entries()) {
    it(`${String(i + 1).padStart(2, '0')} ${name}`, () => {
      expect(runZexGroup(program, i)).toMatch(/ {2}OK$/);
    });
  }
});
```

`packages/emu/test/exerciser/zexall.test.js` is the same file with `zexall.com`, `ZEXALL` in the describe title, and the comment `// ZEXALL checks every flag, bits 3 and 5 too. …`. The `has 67 groups` test keeps each describe non-empty however the loop turns out (an empty describe fails Vitest).

- [ ] **Step 9: Run both suites; see the two known failures**

Run: `FUGLOY_ZEX=1 pnpm -s vitest run packages/emu/test/exerciser 2>&1 | tail -25`
Expected, after about 7 minutes:
- ZEXDOC: 68 passed.
- ZEXALL: 66 passed and 2 failed. The failures are `10 bit n,<b,c,d,e,h,l,(hl),a>` (`ERROR **** crc expected:5e020e98 found:b560ef65`) and `13 <daa,cpl,scf,ccf>` (`… expected:6d2dd213 found:95dd98aa`).

Then run `pnpm -s test 2>&1 | tail -5`. Expected: green, with both exerciser files skipped.

- [ ] **Step 10: Commit**

```bash
git add scripts/install-zex.sh package.json packages/emu/test/cpm.js packages/emu/test/zex.js packages/emu/test/cpm.test.js packages/emu/test/exerciser
git commit -m "emu1: run ZEXDOC and ZEXALL group by group through a CP/M harness"
```

### Task 2: CPL sets flags 3 and 5

**Files:**
- Modify: `packages/emu/test/unit/cpu-xy-flags.test.js` (describe `X/Y from A on accumulator rotates and carry ops`), `packages/emu/src/cpu/z80cpu.js` (the `0x2f` handler, about line 1353)

**Interfaces:**
- Consumes: Task 1's ZEXALL suite, to verify.

- [ ] **Step 1: Write the failing test** — after `it("CCF copies A's bits 3/5", …)`, in that file's style:

```js
  it("CPL copies the complemented A's bits 3/5", () => {
    const c = cpuWithMemory([0x2f, 0x2f]);
    c.registers.A = 0x00; // -> 0xFF
    c.registers.F = 0x00;
    c.executeInstruction();
    expect(xy(c)).toBe(0x28);
    c.executeInstruction(); // -> 0x00
    expect(xy(c)).toBe(0x00);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-xy-flags.test.js -t CPL`
Expected: FAIL — `expected 0 to be 40`.

- [ ] **Step 3: Fix** — in the CPL handler, after `this.flagN = true;`:

```js
      this._xy(this.registers.A);
```

- [ ] **Step 4: Verify**

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-xy-flags.test.js`
Expected: all pass.

Run: `FUGLOY_ZEX=1 pnpm -s vitest run packages/emu/test/exerciser/zexall.test.js -t "daa,cpl"`
Expected: 1 passed (`13 <daa,cpl,scf,ccf>`), the rest skipped.

- [ ] **Step 5: Commit** — `git commit -am "emu1: set CPL's flags 3 and 5 from its result"`

### Task 3: MEMPTR by the documented rules, kept in save states

**Files:**
- Create: `packages/emu/test/unit/bare.js`, `packages/emu/test/unit/cpu-memptr.test.js`, `packages/emu/test/unit/cpu-state.test.js`
- Modify: `packages/emu/src/cpu/z80cpu.js` (the handlers in Step 4), `packages/emu/src/debug/state.js` (`CPU_SCALARS`, `restoreState`)

**Interfaces:**
- Produces: `bare(bytes: number[] | Uint8Array, setup?: (cpu, mem) => void) → { cpu, mem }` from `packages/emu/test/unit/bare.js`. It gives a strict-mode core over flat RAM, with `bytes` at `0100H`, PC there, and SP `FE00H`; Tasks 4–6 use it.
- Produces: `wz` saved and restored as CPU state.

The rules come from "MEMPTR, esoteric register of the ZiLOG Z80 CPU" by boo_boo and Vladimir Kladov. "Done" means the core already sets MEMPTR for that row.

| Instructions | MEMPTR after | In the core |
| --- | --- | --- |
| `LD A,(nn)`, `LD A,(BC)`, `LD A,(DE)` | the address + 1 | done |
| `LD (nn),A`, `LD (BC),A`, `LD (DE),A` | low = address + 1, high = A | done |
| `LD HL,(nn)`, `LD (nn),HL`, `ED` `LD rp,(nn)` and `LD (nn),rp`, `LD IX/IY,(nn)`, `LD (nn),IX/IY` | nn + 1 | `0x2a`, `0x22`, `ldBCnn`…`ldnnSP`, `executeIndexReg` `0x2a`/`0x22` |
| `EX (SP),HL/IX/IY` | the value taken from the stack | `0xe3` (DD/FD E3 reach it through the fallback) |
| `ADD/ADC/SBC HL,rp`, `ADD IX/IY,rp` | the first operand + 1 | done |
| `RLD`, `RRD` | HL + 1 | done |
| `JP nn`, `CALL nn`, `JP cc,nn` and `CALL cc,nn` (taken or not) | nn | `0xc3`, `0xcd`, the 8 JP cc and 8 CALL cc handlers |
| `JR e`; `JR cc,e` and `DJNZ e` when taken | the destination | `0x18`, the 4 JR cc handlers, `0x10` |
| `RET`, `RETI`, `RETN`; `RET cc` when taken | the return address | `0xc9`, `reti`, `retn`, the 8 RET cc handlers |
| `RST p` | p | the RST loop |
| `IN A,(n)` | (A before) × 256 + n + 1 | `0xdb` |
| `OUT (n),A` | low = n + 1, high = A | `0xd3` |
| `IN r,(C)`, `OUT (C),r` | BC before + 1 | `inrC`, `outCr` |
| any `(IX+d)`/`(IY+d)` operand | IX/IY + d | `indexedAddr` in `executeIndexReg`; DDCB done |
| `LDIR`/`LDDR` while repeating | its own address + 1 | `ldir`, `lddr` |
| `CPI`, `CPD` | MEMPTR + 1, − 1 | done |
| `CPIR`/`CPDR` | repeating: its own address + 1; otherwise as `CPI`/`CPD` | `cpir`, `cpdr` |
| `INI`/`INIR`, `IND`/`INDR` | BC before B counts down, + 1 / − 1 | `ini`, `ind` |
| `OUTI`/`OTIR`, `OUTD`/`OTDR` | BC after B counts down, + 1 / − 1 | `outi`, `outd` |
| `JP (HL)`, `LD SP,HL`, everything else | unchanged | — |

- [ ] **Step 1: Write the helper** — `packages/emu/test/unit/bare.js`:

```js
/**
 * A bare Z80 core for unit tests: flat 64K RAM with `bytes` at 0100H, PC there, SP at FE00H,
 * ports reading FFH, strict mode on (an unimplemented opcode throws). `setup(cpu, mem)` runs
 * last, to set registers and memory.
 */
import { Z80CPU } from '../../src/cpu/z80cpu.js';

export function bare(bytes, setup = () => {}) {
  const cpu = new Z80CPU();
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, 0x100);
  cpu.strictMode = true;
  cpu.readMemory = (a) => mem[a & 0xffff];
  cpu.writeMemory = (a, v) => {
    mem[a & 0xffff] = v & 0xff;
  };
  cpu.readPort = () => 0xff;
  cpu.writePort = () => {};
  cpu.reset();
  cpu.registers.PC = 0x100;
  cpu.registers.SP = 0xfe00;
  setup(cpu, mem);
  return { cpu, mem };
}
```

- [ ] **Step 2: Write the failing table test** — `packages/emu/test/unit/cpu-memptr.test.js`:

```js
/**
 * MEMPTR (WZ), the Z80's hidden address latch. Software sees it only through BIT n,(HL), whose
 * flags 3 and 5 come from its high byte, so a wrong value shows up as wrong flags; ZEXALL's
 * harness runs LD SP,(nn) just before each instruction under test. The rules are from "MEMPTR,
 * esoteric register of the ZiLOG Z80 CPU" (boo_boo and Vladimir Kladov).
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

const STALE = 0xbeef;
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** Runs the instruction at 0100H with MEMPTR first set to BEEFH; returns the core. */
function run(bytes, setup = () => {}) {
  const { cpu } = bare(bytes, (c, mem) => {
    c.wz = STALE;
    setup(c, mem);
  });
  cpu.executeInstruction();
  return cpu;
}

/** F that makes condition `cc` (0 NZ, 1 Z, 2 NC, 3 C, 4 PO, 5 PE, 6 P, 7 M) hold or not. */
function flagsFor(cc, holds) {
  const flag = [0x40, 0x40, 0x01, 0x01, 0x04, 0x04, 0x80, 0x80][cc];
  return (cc % 2 === 1) === holds ? flag : 0;
}

const stack1234 = (c, mem) => {
  c.registers.SP = 0x8000;
  mem[0x8000] = 0x34;
  mem[0x8001] = 0x12;
};

describe('MEMPTR after loads and stores through an address', () => {
  it('LD A,(nn), LD A,(BC), LD A,(DE): the address + 1 (already right)', () => {
    expect(run([0x3a, 0x34, 0x12]).wz).toBe(0x1235);
    expect(run([0x0a], (c) => { c.BC = 0x1234; }).wz).toBe(0x1235);
    expect(run([0x1a], (c) => { c.DE = 0x1234; }).wz).toBe(0x1235);
  });

  it('LD (nn),A, LD (BC),A, LD (DE),A: low byte the address + 1, high byte A (already right)', () => {
    expect(run([0x32, 0xff, 0x12], (c) => { c.registers.A = 0x56; }).wz).toBe(0x5600);
    expect(run([0x02], (c) => { c.BC = 0x1234; c.registers.A = 0x56; }).wz).toBe(0x5635);
    expect(run([0x12], (c) => { c.DE = 0x1234; c.registers.A = 0x56; }).wz).toBe(0x5635);
  });

  it('LD rp,(nn) and LD (nn),rp in every form: nn + 1', () => {
    const forms = [
      [0x2a], [0x22],
      [0xed, 0x4b], [0xed, 0x5b], [0xed, 0x6b], [0xed, 0x7b],
      [0xed, 0x43], [0xed, 0x53], [0xed, 0x63], [0xed, 0x73],
      [0xdd, 0x2a], [0xdd, 0x22], [0xfd, 0x2a], [0xfd, 0x22],
    ];
    for (const op of forms) expect(run([...op, 0x34, 0x12]).wz, hex(op)).toBe(0x1235);
    expect(run([0x22, 0xff, 0xff]).wz).toBe(0x0000);
  });

  it('EX (SP),HL, EX (SP),IX, EX (SP),IY: the value taken from the stack', () => {
    for (const op of [[0xe3], [0xdd, 0xe3], [0xfd, 0xe3]]) expect(run(op, stack1234).wz, hex(op)).toBe(0x1234);
  });
});

describe('MEMPTR after 16-bit arithmetic and the nibble rotates (already right)', () => {
  it('ADD/ADC/SBC HL,rp and ADD IX/IY,rp: the first operand + 1', () => {
    for (const op of [[0x09], [0xed, 0x4a], [0xed, 0x42]]) expect(run(op, (c) => { c.HL = 0x1000; }).wz, hex(op)).toBe(0x1001);
    expect(run([0xdd, 0x09], (c) => { c.IX = 0x2000; }).wz).toBe(0x2001);
    expect(run([0xfd, 0x09], (c) => { c.IY = 0x3000; }).wz).toBe(0x3001);
  });

  it('RLD and RRD: HL + 1', () => {
    for (const op of [[0xed, 0x6f], [0xed, 0x67]]) expect(run(op, (c) => { c.HL = 0x3000; }).wz, hex(op)).toBe(0x3001);
  });
});

describe('MEMPTR after jumps, calls, and returns', () => {
  it('JP nn and CALL nn: nn', () => {
    expect(run([0xc3, 0x34, 0x12]).wz).toBe(0x1234);
    expect(run([0xcd, 0x34, 0x12]).wz).toBe(0x1234);
  });

  it('JP cc,nn and CALL cc,nn: nn, whether or not they go', () => {
    for (let cc = 0; cc < 8; cc++) {
      for (const holds of [true, false]) {
        for (const op of [0xc2 | (cc << 3), 0xc4 | (cc << 3)]) {
          expect(run([op, 0x34, 0x12], (c) => { c.registers.F = flagsFor(cc, holds); }).wz, `${hex([op])} ${holds}`).toBe(0x1234);
        }
      }
    }
  });

  it('JR e, and JR cc,e and DJNZ e when they go: the destination; when they do not: unchanged', () => {
    expect(run([0x18, 0x05]).wz).toBe(0x0107);
    for (let cc = 0; cc < 4; cc++) {
      const op = 0x20 | (cc << 3);
      expect(run([op, 0x05], (c) => { c.registers.F = flagsFor(cc, true); }).wz, hex([op])).toBe(0x0107);
      expect(run([op, 0x05], (c) => { c.registers.F = flagsFor(cc, false); }).wz, hex([op])).toBe(STALE);
    }
    expect(run([0x10, 0x05], (c) => { c.registers.B = 2; }).wz).toBe(0x0107);
    expect(run([0x10, 0x05], (c) => { c.registers.B = 1; }).wz).toBe(STALE);
  });

  it('RET, RETI, RETN, and RET cc when it goes: the return address; RET cc that stays: unchanged', () => {
    for (const op of [[0xc9], [0xed, 0x4d], [0xed, 0x45]]) expect(run(op, stack1234).wz, hex(op)).toBe(0x1234);
    for (let cc = 0; cc < 8; cc++) {
      const op = 0xc0 | (cc << 3);
      const go = (holds) => (c, mem) => {
        stack1234(c, mem);
        c.registers.F = flagsFor(cc, holds);
      };
      expect(run([op], go(true)).wz, hex([op])).toBe(0x1234);
      expect(run([op], go(false)).wz, hex([op])).toBe(STALE);
    }
  });

  it('RST p: p', () => {
    for (let p = 0; p < 0x40; p += 8) expect(run([0xc7 | p]).wz, hex([0xc7 | p])).toBe(p);
  });

  it('JP (HL), JP (IX), and LD SP,HL leave it alone', () => {
    for (const op of [[0xe9], [0xdd, 0xe9], [0xf9]]) expect(run(op, (c) => { c.HL = 0x1234; c.IX = 0x1234; }).wz, hex(op)).toBe(STALE);
  });
});

describe('MEMPTR after port I/O', () => {
  it('IN A,(n): A before the read, times 256, plus n, plus 1', () => {
    expect(run([0xdb, 0xfe], (c) => { c.registers.A = 0x12; }).wz).toBe(0x12ff);
    expect(run([0xdb, 0xff], (c) => { c.registers.A = 0xff; }).wz).toBe(0x0000);
  });

  it('OUT (n),A: low byte n + 1, high byte A', () => {
    expect(run([0xd3, 0xff], (c) => { c.registers.A = 0x12; }).wz).toBe(0x1200);
    expect(run([0xd3, 0x34], (c) => { c.registers.A = 0x12; }).wz).toBe(0x1235);
  });

  it('IN r,(C) and OUT (C),r for every register: BC before the instruction + 1', () => {
    for (let r = 0; r < 8; r++) {
      if (r === 6) continue; // ED 70 and ED 71 arrive with the rest of the ED table (Task 4)
      for (const op of [0x40 | (r << 3), 0x41 | (r << 3)]) {
        expect(run([0xed, op], (c) => { c.BC = 0x12ff; }).wz, hex([0xed, op])).toBe(0x1300);
      }
    }
  });
});

describe('MEMPTR after (IX+d) and (IY+d) operands: the address', () => {
  it('loads, stores, arithmetic, INC, DEC, and LD (IX+d),n', () => {
    const forms = [[0x7e], [0x77], [0x86], [0xbe], [0x34], [0x35], [0x36, 0x99]];
    const index = [[0xdd, (c) => { c.IX = 0x2000; }], [0xfd, (c) => { c.IY = 0x2000; }]];
    for (const [prefix, set] of index) {
      for (const [op, ...rest] of forms) {
        expect(run([prefix, op, 0x05, ...rest], set).wz, hex([prefix, op])).toBe(0x2005);
        expect(run([prefix, op, 0xfb, ...rest], set).wz, hex([prefix, op, 0xfb])).toBe(0x1ffb);
      }
    }
  });

  it('BIT n,(IX+d) (already right)', () => {
    expect(run([0xdd, 0xcb, 0x05, 0x46], (c) => { c.IX = 0x2000; }).wz).toBe(0x2005);
  });
});

describe('MEMPTR after block instructions', () => {
  const block = (c, mem) => {
    c.HL = 0x3000;
    c.DE = 0x4000;
    c.registers.A = 0x22;
    mem[0x3000] = 0x11;
  };
  const withBC = (bc, more = () => {}) => (c, mem) => {
    block(c, mem);
    c.BC = bc;
    more(c);
  };

  it('LDIR and LDDR while they repeat: their own address + 1; on the last pass, and LDI and LDD: unchanged', () => {
    for (const op of [0xb0, 0xb8]) {
      expect(run([0xed, op], withBC(2)).wz, hex([0xed, op])).toBe(0x0101);
      expect(run([0xed, op], withBC(1)).wz, hex([0xed, op])).toBe(STALE);
    }
    for (const op of [0xa0, 0xa8]) expect(run([0xed, op], withBC(2)).wz, hex([0xed, op])).toBe(STALE);
  });

  it('CPI and CPD: MEMPTR + 1 and - 1 (already right)', () => {
    expect(run([0xed, 0xa1], withBC(2)).wz).toBe(STALE + 1);
    expect(run([0xed, 0xa9], withBC(2)).wz).toBe(STALE - 1);
  });

  it('CPIR and CPDR while they repeat: their own address + 1; when they stop: as CPI and CPD', () => {
    expect(run([0xed, 0xb1], withBC(2)).wz).toBe(0x0101);
    expect(run([0xed, 0xb9], withBC(2)).wz).toBe(0x0101);
    expect(run([0xed, 0xb1], withBC(1)).wz).toBe(STALE + 1);
    expect(run([0xed, 0xb9], withBC(1)).wz).toBe(STALE - 1);
    expect(run([0xed, 0xb1], withBC(2, (c) => { c.registers.A = 0x11; })).wz).toBe(STALE + 1); // found it
  });

  it('INI, INIR, IND, INDR: BC before B counts down, + 1 or - 1', () => {
    for (const [op, want] of [[0xa2, 0x1235], [0xb2, 0x1235], [0xaa, 0x1233], [0xba, 0x1233]]) {
      expect(run([0xed, op], withBC(0x1234)).wz, hex([0xed, op])).toBe(want);
    }
  });

  it('OUTI, OTIR, OUTD, OTDR: BC after B counts down, + 1 or - 1', () => {
    for (const [op, want] of [[0xa3, 0x1135], [0xb3, 0x1135], [0xab, 0x1133], [0xbb, 0x1133]]) {
      expect(run([0xed, op], withBC(0x1234)).wz, hex([0xed, op])).toBe(want);
    }
  });
});

describe('MEMPTR elsewhere', () => {
  it('ordinary instructions leave it alone', () => {
    const ops = [[0x00], [0x78], [0x34], [0x36, 0x99], [0x7e], [0xcb, 0x46], [0x76]];
    for (const op of ops) expect(run(op, (c) => { c.HL = 0x3000; }).wz, hex(op)).toBe(STALE);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-memptr.test.js`
Expected: the tests titled "(already right)", "JP (HL)…", and "ordinary instructions…" pass. Every other test fails, each on its first family member, with the message naming the bytes.

- [ ] **Step 4: Implement, family by family, rerunning the test after each.** Every new line masks to 16 bits.

  - **JP nn (`0xc3`)** and the **8 JP cc handlers** (`0xc2`, `0xca`, `0xd2`, `0xda`, `0xe2`, `0xea`, `0xf2`, `0xfa`), and the **8 CALL cc handlers** (`0xc4`, `0xcc`, `0xd4`, `0xdc`, `0xe4`, `0xec`, `0xf4`, `0xfc`). After `const high = …;`:

    ```js
          this.wz = (high << 8) | low;
    ```

  - **CALL nn (`0xcd`)**, after `const targetAddr = …;`:

    ```js
          this.wz = targetAddr;
    ```

  - **JR e (`0x18`)**, after the PC update; and in the taken branch of each **JR cc handler** (`0x20`, `0x28`, `0x30`, `0x38`) and of **DJNZ (`0x10`)**, after the PC update, before `return 12;`/`return 13;`:

    ```js
          this.wz = this.registers.PC;
    ```

  - **RET (`0xc9`)**, the taken branch of each **RET cc handler** (`0xc0`, `0xc8`, `0xd0`, `0xd8`, `0xe0`, `0xe8`, `0xf0`, `0xf8`), and **`reti()`** and **`retn()`**. After `this.registers.PC = (high << 8) | low;`:

    ```js
          this.wz = this.registers.PC;
    ```

  - **The RST loop.** After the push, where PC becomes `addr`:

    ```js
            this.wz = addr;
    ```

  - **LD (nn),HL (`0x22`)**, **LD HL,(nn) (`0x2a`)**, **`ldBCnn`, `ldDEnn`, `ldHLnn`, `ldSPnn`, `ldnnBC`, `ldnnDE`, `ldnnHL`, `ldnnSP`**, and **`executeIndexReg`'s `case 0x22` and `case 0x2a`**. After `const addr = (high << 8) | low;`:

    ```js
        this.wz = (addr + 1) & 0xffff;
    ```

  - **EX (SP),HL (`0xe3`)**. After `this.HL = temp;` (DD E3 and FD E3 run this handler with HL standing in for IX/IY):

    ```js
          this.wz = temp;
    ```

  - **OUT (n),A (`0xd3`)**. After reading `port`:

    ```js
          this.wz = (this.registers.A << 8) | ((port + 1) & 0xff);
    ```

  - **IN A,(n) (`0xdb`)**. After reading `port`, before A is overwritten:

    ```js
          this.wz = (((this.registers.A << 8) | port) + 1) & 0xffff;
    ```

  - **`inrC`** and **`outCr`**. As their first line, before IN B,(C) can change B:

    ```js
        this.wz = (this.BC + 1) & 0xffff;
    ```

  - **`indexedAddr` in `executeIndexReg`**. Its return becomes:

    ```js
          return (this.wz = (indexReg + (disp & 0x80 ? disp - 256 : disp)) & 0xffff);
    ```

  - **`ldir`, `lddr`, `cpir`, `cpdr`**. In the repeat branch, after `this.registers.PC = (this.registers.PC - 2) & 0xffff;` (PC is then the instruction's own address):

    ```js
          this.wz = (this.registers.PC + 1) & 0xffff;
    ```

  - **`ini`** and **`ind`**. As their first line, with `- 1` in `ind`:

    ```js
        this.wz = (this.BC + 1) & 0xffff;
    ```

  - **`outi`** and **`outd`**. After `this.registers.B = (this.registers.B - 1) & 0xff;`, with `- 1` in `outd`:

    ```js
        this.wz = (this.BC + 1) & 0xffff;
    ```

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-memptr.test.js`
Expected: all pass.

- [ ] **Step 5: Write the failing save-state tests** — `packages/emu/test/unit/cpu-state.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { restoreState, serializeState } from '../../src/debug/state.js';
import { TRS80System } from '../../src/machine/trs80-system.js';

const blank = () => new TRS80System({ romData: new Uint8Array(0x3800) });

describe('CPU state that only the flags show', () => {
  it('a save state keeps MEMPTR', () => {
    const saved = blank();
    saved.cpu.wz = 0x1234;
    const restored = blank();
    restoreState(restored, serializeState(saved));
    expect(restored.cpu.wz).toBe(0x1234);
  });

  it('a save from before emu phase 1, without MEMPTR, restores it as 0', () => {
    const state = serializeState(blank());
    delete state.cpu.wz;
    const restored = blank();
    restored.cpu.wz = 0xbeef;
    restoreState(restored, state);
    expect(restored.cpu.wz).toBe(0);
  });
});
```

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-state.test.js`
Expected: FAIL. The first test gets `0`, not `4660`; the second gets `48879`, not `0`.

- [ ] **Step 6: Keep MEMPTR in save states** — in `packages/emu/src/debug/state.js`, add `"wz",` to `CPU_SCALARS` after `"pendingEI",`. In `restoreState`, after `for (const key of CPU_SCALARS) cpu[key] = state.cpu[key];`:

```js
  cpu.wz ??= 0; // absent in version-1 saves from before emu phase 1
```

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-state.test.js packages/emu/test/integration/state.test.js`
Expected: all pass, or the integration file skipped without a ROM.

- [ ] **Step 7: The exercisers**

Run: `FUGLOY_ZEX=1 pnpm -s vitest run packages/emu/test/exerciser/zexall.test.js -t "bit n,<b"`
Expected: 1 passed.

Run: `FUGLOY_ZEX=1 pnpm -s vitest run packages/emu/test/exerciser 2>&1 | tail -8`
Expected, after about 7 minutes: 136 passed (68 + 68).

Then run `pnpm -s test 2>&1 | tail -5`. Expected: green.

- [ ] **Step 8: Commit**

```bash
git add packages/emu/test/unit/bare.js packages/emu/test/unit/cpu-memptr.test.js packages/emu/test/unit/cpu-state.test.js packages/emu/src/cpu/z80cpu.js packages/emu/src/debug/state.js
git commit -m "emu1: track MEMPTR by the documented rules and keep it in save states"
```

### Task 4: The rest of the ED table, and the block I/O flags

**Files:**
- Create: `packages/emu/test/unit/cpu-ed.test.js`
- Modify: `packages/emu/src/cpu/z80cpu.js` (`executeED`'s switch, `inrC`, `outCr`, `ini`, `ind`, `outi`, `outd`, and a new `_blockIOFlags`)

**Interfaces:**
- Consumes: `bare()` (Task 3); MEMPTR at the top of `inrC`/`outCr` (Task 3), which ED 70 and ED 71 now reach.

- [ ] **Step 1: Write the failing tests** — `packages/emu/test/unit/cpu-ed.test.js`:

```js
/**
 * The ED opcodes beyond the documented ones, and the flags of the block I/O instructions, from
 * Sean Young, "The Undocumented Z80 Documented" (v0.91) §3 and §4.3. ZEXALL cannot see these:
 * it runs none of the duplicates and no I/O.
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

/** Runs the instruction at 0100H; returns the core, its memory, and the T-states it took. */
function step(bytes, setup) {
  const { cpu, mem } = bare(bytes, setup);
  const t = cpu.executeInstruction();
  return { cpu, mem, t };
}

describe('ED duplicates', () => {
  it('ED 4C, 54, 5C, 64, 6C, 74, 7C are NEG', () => {
    const neg = step([0xed, 0x44], (c) => { c.registers.A = 0x01; });
    for (const op of [0x4c, 0x54, 0x5c, 0x64, 0x6c, 0x74, 0x7c]) {
      const { cpu, t } = step([0xed, op], (c) => { c.registers.A = 0x01; });
      expect([cpu.registers.A, cpu.registers.F, t], op.toString(16)).toEqual([neg.cpu.registers.A, neg.cpu.registers.F, 8]);
    }
  });

  it('ED 55, 5D, 65, 6D, 75, 7D are RETN', () => {
    for (const op of [0x55, 0x5d, 0x65, 0x6d, 0x75, 0x7d]) {
      const { cpu, t } = step([0xed, op], (c, mem) => {
        c.registers.SP = 0x8000;
        mem[0x8000] = 0x34;
        mem[0x8001] = 0x12;
        c.IFF1 = false;
        c.IFF2 = true;
      });
      expect([cpu.registers.PC, cpu.registers.SP, cpu.IFF1, t], op.toString(16)).toEqual([0x1234, 0x8002, true, 14]);
    }
  });

  it('ED 4E, 66, 6E set IM 0; ED 76 sets IM 1; ED 7E sets IM 2', () => {
    for (const [op, mode, from] of [[0x4e, 0, 2], [0x66, 0, 2], [0x6e, 0, 2], [0x76, 1, 0], [0x7e, 2, 0]]) {
      const { cpu, t } = step([0xed, op], (c) => { c.interruptMode = from; });
      expect([cpu.interruptMode, t], op.toString(16)).toEqual([mode, 8]);
    }
  });
});

describe('IN F,(C) and OUT (C),0', () => {
  it('ED 70 reads port C and sets the flags as IN r,(C) does, storing the byte nowhere', () => {
    const { cpu, mem, t } = step([0xed, 0x70], (c, m) => {
      c.readPort = () => 0x80;
      c.BC = 0x12fe;
      c.DE = 0x3456;
      c.HL = 0x3000;
      c.registers.A = 0x55;
      c.registers.F = 0x01;
      m[0x3000] = 0x99;
    });
    expect([cpu.BC, cpu.DE, cpu.HL, cpu.registers.A, mem[0x3000]]).toEqual([0x12fe, 0x3456, 0x3000, 0x55, 0x99]);
    expect(cpu.registers.F).toBe(0x81); // S from bit 7; Z, H, P/V (odd parity), N clear; C kept
    expect([cpu.wz, t]).toEqual([0x12ff, 12]);
  });

  it('ED 71 writes 0 to port C', () => {
    const writes = [];
    const { cpu, t } = step([0xed, 0x71], (c) => {
      c.writePort = (port, value) => writes.push([port, value]);
      c.BC = 0x12fe;
      c.registers.A = 0x55;
    });
    expect(writes).toEqual([[0xfe, 0x00]]);
    expect([cpu.wz, t]).toEqual([0x12ff, 12]);
  });
});

describe('undefined ED opcodes', () => {
  const defined = new Set([
    ...Array.from({ length: 0x40 }, (_, i) => 0x40 + i).filter((op) => op !== 0x77 && op !== 0x7f),
    0xa0, 0xa1, 0xa2, 0xa3, 0xa8, 0xa9, 0xaa, 0xab, 0xb0, 0xb1, 0xb2, 0xb3, 0xb8, 0xb9, 0xba, 0xbb,
  ]);

  it('each is a two-byte, 8-T-state NOP that changes nothing and logs nothing', () => {
    const log = [];
    for (let op = 0; op < 0x100; op++) {
      if (defined.has(op)) continue;
      const { cpu, t } = step([0xed, op], (c) => {
        c.log = (...entry) => log.push(entry);
        c.BC = 0x1234;
        c.DE = 0x5678;
        c.HL = 0x9abc;
        c.registers.A = 0xde;
        c.registers.F = 0xf0;
      });
      const after = [cpu.registers.PC, t, cpu.BC, cpu.DE, cpu.HL, cpu.registers.A, cpu.registers.F];
      expect(after, op.toString(16)).toEqual([0x102, 8, 0x1234, 0x5678, 0x9abc, 0xde, 0xf0]);
    }
    expect(log).toEqual([]);
  });
});

describe('block I/O flags', () => {
  // S, Z, 5, 3 from B after it counts down; N from bit 7 of the byte moved. k is that byte plus
  // C + 1 (INI), C - 1 (IND), or L after HL moves (OUTI, OUTD); H and C are set when k > 255,
  // and P/V is the parity of (k AND 7) XOR B.
  const ini = (c) => {
    c.readPort = () => 0xf5;
    c.BC = 0x0210;
    c.HL = 0x3000;
    c.registers.F = 0x00;
  };
  const outd = (c, mem) => {
    mem[0x3081] = 0xff;
    c.BC = 0x2910;
    c.HL = 0x3081;
    c.registers.F = 0x00;
  };

  it('INI: k = F5H + 11H carries; (6 XOR 1) has odd parity', () => {
    const { cpu, mem } = step([0xed, 0xa2], ini);
    expect([mem[0x3000], cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0xf5, 0x3001, 0x01, 0x13]);
  });

  it('IND: k = 01H + 0FH does not carry; B reaches 0', () => {
    const { cpu } = step([0xed, 0xaa], (c) => {
      c.readPort = () => 0x01;
      c.BC = 0x0110;
      c.HL = 0x3000;
      c.registers.F = 0x00;
    });
    expect([cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0x2fff, 0x00, 0x44]);
  });

  it('OUTI: k = 80H + L (00H after HL moves); S from B = 80H', () => {
    const { cpu } = step([0xed, 0xa3], (c, mem) => {
      mem[0x30ff] = 0x80;
      c.BC = 0x8110;
      c.HL = 0x30ff;
      c.registers.F = 0x00;
    });
    expect([cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0x3100, 0x80, 0x82]);
  });

  it('OUTD: k = FFH + L (80H after HL moves) carries; flags 5 and 3 from B = 28H', () => {
    const { cpu } = step([0xed, 0xab], outd);
    expect([cpu.HL, cpu.registers.B, cpu.registers.F]).toEqual([0x3080, 0x28, 0x3b]);
  });

  it('INIR and OTDR set the same flags on each pass', () => {
    const inir = step([0xed, 0xb2], ini);
    expect([inir.cpu.registers.PC, inir.cpu.registers.F]).toEqual([0x100, 0x13]);
    const otdr = step([0xed, 0xbb], outd);
    expect([otdr.cpu.registers.PC, otdr.cpu.registers.F]).toEqual([0x100, 0x3b]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-ed.test.js`
Expected:
- The duplicate, ED 70/71, and undefined tests fail with `Unimplemented opcode 0xED 0x4C at PC=0x0101` and its like.
- The flag tests fail on F: `0x02`, not `0x13`, and so on.

- [ ] **Step 3: Implement** — in `executeED`'s switch:

```js
      // NEG and its duplicates
      case 0x44:
      case 0x4c:
      case 0x54:
      case 0x5c:
      case 0x64:
      case 0x6c:
      case 0x74:
      case 0x7c:
        return this.neg();
```

Add `case 0x70:` to the `IN r,(C)` list and `case 0x71:` to the `OUT (C),r` list.

Add `case 0x55: case 0x5d: case 0x65: case 0x6d: case 0x75: case 0x7d:` above `case 0x45: // RETN`, each on its own line, as the file writes them.

Add `case 0x4e: case 0x66: case 0x6e:` above `case 0x46: // IM 0`, `case 0x76:` above `case 0x56:`, and `case 0x7e:` above `case 0x5e:`.

Replace `default: return this.reportUnimplemented(opcode, "0xED ");` with:

```js
      // Every other ED opcode does nothing for 8 T-states (Young §3.3)
      default:
        return 8;
```

In `inrC`, index 6 is `IN F,(C)`: the byte sets the flags and goes nowhere. Replace the `if (regIndex === 6) { this.writeMemory(this.HL, value); } else { … }` with:

```js
    if (regIndex !== 6) this.registers[regs[regIndex]] = value; // 6 is IN F,(C): flags only
```

In `outCr`, index 6 is `OUT (C),0`:

```js
    // 6 is OUT (C),0; an NMOS Z80, as in the Model I and III, sends 0 (CMOS parts send FFH)
    const value = regIndex === 6 ? 0 : this.registers[regs[regIndex]];
```

Both end `return 12;`. Add after `outCr`:

```js
  // Block I/O flags (Young §4.3): S, Z, 5, 3 from B after it counts down; N from bit 7 of the
  // byte moved; H and C from the carry out of k; P/V the parity of (k AND 7) XOR B.
  _blockIOFlags(value, k) {
    const b = this.registers.B;
    this.flagS = (b & 0x80) !== 0;
    this.flagZ = b === 0;
    this._xy(b);
    this.flagN = (value & 0x80) !== 0;
    this.flagH = k > 0xff;
    this.flagC = k > 0xff;
    this.flagPV = this.parity((k & 7) ^ b);
  }
```

In `ini`, `ind`, `outi`, and `outd`, replace the three lines `this.flagZ = …; this.flagN = …; this._xy(this.registers.B);` with:
- `this._blockIOFlags(value, value + ((port + 1) & 0xff));` in `ini`;
- `this._blockIOFlags(value, value + ((port - 1) & 0xff));` in `ind`;
- `this._blockIOFlags(value, value + this.registers.L);` in `outi` and `outd`, where L has already moved.

- [ ] **Step 4: Verify**

Run: `pnpm -s vitest run packages/emu/test/unit`
Expected: all pass, including `cpu-memptr.test.js`.

Run: `pnpm -s test 2>&1 | tail -5`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/emu/test/unit/cpu-ed.test.js packages/emu/src/cpu/z80cpu.js
git commit -m "emu1: complete the ED table and set every flag on the block I/O instructions"
```

### Task 5: Prefixes the next byte does not use

**Files:**
- Create: `packages/emu/test/unit/cpu-prefix.test.js`
- Modify: `packages/emu/src/cpu/z80cpu.js` (constructor, `reset`, `executeInstruction`, `interrupt`, `decodeAndExecute`, `executeDD`, `executeFD`, the fallback at the end of `executeIndexReg`), `packages/emu/src/debug/state.js`, `packages/emu/test/unit/cpu-state.test.js`

**Interfaces:**
- Consumes: `bare()` (Task 3).
- Produces: a DD or FD before DD, FD, or ED is one `executeInstruction` of 4 T-states and one R count, leaving PC on the next byte. Task 6's `measure()` counts on this.
- Produces: `cpu.afterPrefix: boolean`, which is true until the next step after such a prefix. `interrupt()` refuses while it is set, and save states keep it.

The real chip treats a DD or FD that another prefix or ED follows as a 4-T-state, one-fetch no-op. The next byte starts the opcode, and no interrupt is taken in between, since no instruction has ended. One step per prefix keeps each `executeInstruction` bounded even when execution runs into memory full of `DD`s. Before `EX DE,HL` and `EXX` the prefix is ignored.

- [ ] **Step 1: Write the failing tests** — `packages/emu/test/unit/cpu-prefix.test.js`:

```js
/**
 * DD and FD prefixes the next byte does not use (Young, "The Undocumented Z80 Documented" §3.6).
 * Before another DD, FD, or ED, the prefix is a 4-T-state no-op with one R count; the next byte
 * starts the opcode, with no interrupt taken in between. Before EX DE,HL or EXX it is ignored.
 */
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

/** Runs instructions until PC reaches `end`, at most 4; returns the T-states they took. */
function runTo(cpu, end) {
  const start = cpu.cycles;
  for (let n = 0; cpu.registers.PC !== end; n++) {
    if (n === 4) throw new Error(`PC is ${cpu.registers.PC.toString(16)}, not ${end.toString(16)}, after 4 steps`);
    cpu.executeInstruction();
  }
  return cpu.cycles - start;
}

describe('a prefix before another prefix or ED', () => {
  it('DD DD 21 nn loads IX; the first DD costs 4 T-states and one R count', () => {
    const { cpu } = bare([0xdd, 0xdd, 0x21, 0x34, 0x12], (c) => { c.registers.R = 0; });
    expect(runTo(cpu, 0x105)).toBe(18);
    expect([cpu.IX, cpu.HL, cpu.registers.R]).toEqual([0x1234, 0x0000, 3]);
  });

  it('DD FD 21 nn loads IY: the last prefix counts', () => {
    const { cpu } = bare([0xdd, 0xfd, 0x21, 0x34, 0x12], (c) => { c.registers.R = 0; });
    expect(runTo(cpu, 0x105)).toBe(18);
    expect([cpu.IY, cpu.IX, cpu.registers.R]).toEqual([0x1234, 0x0000, 3]);
  });

  it('FD ED A0 is LDI through HL, not IY', () => {
    const { cpu, mem } = bare([0xfd, 0xed, 0xa0], (c, m) => {
      c.HL = 0x3000;
      c.DE = 0x4000;
      c.BC = 1;
      c.IY = 0x5000;
      c.registers.R = 0;
      m[0x3000] = 0xab;
      m[0x5000] = 0xcd;
    });
    expect(runTo(cpu, 0x103)).toBe(20);
    expect([mem[0x4000], cpu.HL, cpu.IY, cpu.registers.R]).toEqual([0xab, 0x3001, 0x5000, 3]);
  });

  it('takes no interrupt between the lone prefix and the instruction it leads into', () => {
    const { cpu } = bare([0xdd, 0xdd, 0x21, 0x34, 0x12], (c) => {
      c.IFF1 = true;
      c.IFF2 = true;
      c.interruptMode = 1;
    });
    cpu.executeInstruction(); // the first DD, alone
    expect(cpu.interrupt()).toBe(false);
    cpu.executeInstruction(); // DD 21 34 12
    expect(cpu.registers.PC).toBe(0x105);
    expect(cpu.interrupt()).toBe(true);
    expect(cpu.registers.PC).toBe(0x0038);
  });

  it('runs a long string of DDs one prefix per step', () => {
    const { cpu } = bare(new Array(1000).fill(0xdd));
    expect(runTo(cpu, 0x101)).toBe(4);
  });
});

describe('a prefix before EX DE,HL or EXX', () => {
  it('DD EB exchanges DE and HL and leaves IX alone', () => {
    const { cpu } = bare([0xdd, 0xeb], (c) => {
      c.DE = 0x1122;
      c.HL = 0x3344;
      c.IX = 0x5566;
    });
    expect(runTo(cpu, 0x102)).toBe(8);
    expect([cpu.DE, cpu.HL, cpu.IX]).toEqual([0x3344, 0x1122, 0x5566]);
  });

  it('FD D9 exchanges BC, DE, HL with their shadows and leaves IY alone', () => {
    const { cpu } = bare([0xfd, 0xd9], (c) => {
      c.HL = 0x3344;
      c.registers.H_ = 0x77;
      c.registers.L_ = 0x88;
      c.IY = 0x5566;
    });
    expect(runTo(cpu, 0x102)).toBe(8);
    expect([cpu.HL, cpu.registers.H_, cpu.registers.L_, cpu.IY]).toEqual([0x7788, 0x33, 0x44, 0x5566]);
  });
});
```

Append to `packages/emu/test/unit/cpu-state.test.js`, inside its describe:

```js
  it('a save state keeps a lone prefix pending', () => {
    const saved = blank();
    saved.cpu.afterPrefix = true;
    const restored = blank();
    restoreState(restored, serializeState(saved));
    expect(restored.cpu.afterPrefix).toBe(true);
  });

  it('a save from before emu phase 1 restores with no prefix pending', () => {
    const state = serializeState(blank());
    delete state.cpu.afterPrefix;
    const restored = blank();
    restored.cpu.afterPrefix = true;
    restoreState(restored, state);
    expect(restored.cpu.afterPrefix).toBe(false);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-prefix.test.js packages/emu/test/unit/cpu-state.test.js`
Expected:
- The prefix-chain tests fail with `Unimplemented opcode 0xDD 0xDD …` (and `0xDD 0xFD`, `0xFD 0xED`).
- The long-string test fails the same way, and the interrupt test throws on its first step.
- The EB/D9 tests fail on the values: IX swapped in.
- The two new state tests fail on `afterPrefix`.

- [ ] **Step 3: Implement** — in the constructor next to `pendingEI`, and in `reset()`:

```js
    this.afterPrefix = false; // a DD or FD the next byte made a no-op; no interrupt until it runs
```

First line of `executeInstruction()`:

```js
    this.afterPrefix = false;
```

In `interrupt()`, the refusal becomes:

```js
    if (!this.IFF1 || this.pendingEI > 0 || this.afterPrefix) {
```

In `decodeAndExecute`, the DD and FD branches lose their `this.incrementR();`, since `executeDD`/`executeFD` now count the second fetch only when there is one:

```js
    if (opcode === 0xdd) {
      return this.executeDD();
    }
    if (opcode === 0xfd) {
      return this.executeFD();
    }
```

`executeDD` begins as below; `executeFD` is the same:

```js
  executeDD() {
    const opcode = this.readMemory(this.registers.PC);
    // Before another prefix or ED, DD is a 4-T-state no-op: leave PC on that byte, which starts
    // the next step, and take no interrupt before it (Young §3.6).
    if (opcode === 0xdd || opcode === 0xfd || opcode === 0xed) {
      this.afterPrefix = true;
      return 4;
    }
    this.registers.PC = (this.registers.PC + 1) & 0xffff;
    this.incrementR(); // the second opcode fetch
```

The rest of each method is unchanged.

In `executeIndexReg`'s fallback, before `const tempHL = this.HL;`:

```js
        // EX DE,HL and EXX ignore the prefix
        if (opcode === 0xeb || opcode === 0xd9) {
          return this.opcodeHandlers[opcode].call(this) + 4;
        }
```

In `packages/emu/src/debug/state.js`, add `"afterPrefix",` to `CPU_SCALARS` after `"wz",`. In `restoreState`, after the `cpu.wz ??= 0;` line:

```js
  cpu.afterPrefix ??= false; // likewise
```

- [ ] **Step 4: Verify**

Run: `pnpm -s vitest run packages/emu/test/unit`
Expected: all pass. That includes phase 0's R tests, since a `DD 21` still counts two fetches.

Run: `pnpm -s test 2>&1 | tail -5`
Expected: green.

Run: `FUGLOY_ZEX=1 pnpm -s vitest run packages/emu/test/exerciser 2>&1 | tail -8`
Expected: 136 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/emu/test/unit/cpu-prefix.test.js packages/emu/test/unit/cpu-state.test.js packages/emu/src/cpu/z80cpu.js packages/emu/src/debug/state.js
git commit -m "emu1: run a prefix the next byte does not use as the chip does"
```

### Task 6: Every opcode's T-states against @fugloy/z80

**Files:**
- Create: `packages/emu/test/unit/cpu-timing.test.js`
- Modify: `packages/emu/package.json` (`devDependencies`: `"@fugloy/z80": "workspace:*"`), `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `bare()` (Task 3); Task 5's one step per lone prefix before DD, FD, or ED; `decode(read, address?)` from `@fugloy/z80`.
  - `decode` returns `{ mnemonic, operands, length, cycles, cyclesNotTaken? }`; a condition operand is `{ kind: 'cc', cond: 'NZ' | 'Z' | 'NC' | 'C' | 'PO' | 'PE' | 'P' | 'M' }`.
  - A DD or FD that the next byte does not use decodes as a 1-byte `DB` of 4 cycles.
  - Undocumented ED opcodes decode as 2-byte `DB`s with their true cycles: 8, `ED 70`/`71` 12, and the `RETN`s 14.
  - Vitest resolves `@fugloy/z80` to its TypeScript source through the root `vitest.config.ts` alias. The devDependency records the link for pnpm.

- [ ] **Step 1: Add the devDependency** — add `"devDependencies": { "@fugloy/z80": "workspace:*" }` to `packages/emu/package.json`, then run `pnpm install`.

Expected: `pnpm-lock.yaml` gains the link, and nothing else changes.

- [ ] **Step 2: Write the test** — `packages/emu/test/unit/cpu-timing.test.js`:

```js
/**
 * Every opcode's T-states against @fugloy/z80's table (spec §10: zero deviations), both ways for
 * each conditional and repeating instruction. A DD or FD that the next byte does not use costs 4
 * T-states before it; before DD, FD, or ED the core runs it as a step of its own.
 */
import { decode } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const isIndexPrefix = (b) => b === 0xdd || b === 0xfd;

/** What @fugloy/z80 says `bytes` costs, each lone DD or FD costing 4 before what follows. */
function reference(bytes) {
  let at = 0;
  let before = 0;
  for (;;) {
    const ins = decode((k) => bytes[at + k]);
    if (!(ins.length === 1 && isIndexPrefix(bytes[at]))) {
      return { ins, taken: before + ins.cycles, notTaken: before + (ins.cyclesNotTaken ?? ins.cycles) };
    }
    before += ins.cycles;
    at += 1;
  }
}

const FLAG = { Z: 0x40, C: 0x01, PE: 0x04, M: 0x80 };
const CONDITION = { NZ: ['Z', false], Z: ['Z', true], NC: ['C', false], C: ['C', true], PO: ['PE', false], PE: ['PE', true], P: ['M', false], M: ['M', true] };
const COUNTS_B = new Set(['DJNZ', 'INIR', 'INDR', 'OTIR', 'OTDR']);
const COUNTS_BC = new Set(['LDIR', 'LDDR', 'CPIR', 'CPDR']);

/** Registers that make `ins` jump, call, return, or repeat (`go`), or not. */
function arrange(ins, go) {
  return (cpu) => {
    cpu.registers.A = 0x55; // differs from (HL), which is 00H, so CPIR and CPDR repeat
    const cc = ins.operands.find((o) => o.kind === 'cc');
    if (cc !== undefined) {
      const [flag, setMeansTrue] = CONDITION[cc.cond];
      cpu.registers.F = setMeansTrue === go ? FLAG[flag] : 0;
    }
    if (COUNTS_B.has(ins.mnemonic)) cpu.registers.B = go ? 2 : 1;
    if (COUNTS_BC.has(ins.mnemonic)) cpu.BC = go ? 2 : 1;
  };
}

/** The core's T-states over `bytes`: one step, plus one for each lone prefix before DD, FD, or ED. */
function measure(bytes, setup) {
  const { cpu } = bare(bytes, setup);
  let steps = 1;
  for (let k = 0; isIndexPrefix(bytes[k]) && [0xdd, 0xfd, 0xed].includes(bytes[k + 1]); k++) steps++;
  const start = cpu.cycles;
  for (let n = 0; n < steps; n++) cpu.executeInstruction();
  return cpu.cycles - start;
}

/** Every opcode: unprefixed, CB, ED, DD, FD, DDCB, FDCB, with operand bytes 05 00 00. */
function sequences() {
  const all = [];
  for (let op = 0; op < 0x100; op++) {
    if (op !== 0xcb && op !== 0xed && !isIndexPrefix(op)) all.push([op, 0x05, 0x00, 0x00]);
    all.push([0xcb, op], [0xed, op, 0x05, 0x00], [0xdd, op, 0x05, 0x00, 0x00], [0xfd, op, 0x05, 0x00, 0x00]);
    all.push([0xdd, 0xcb, 0x05, op], [0xfd, 0xcb, 0x05, op]);
  }
  return all;
}

describe('T-states', () => {
  it('match @fugloy/z80 for every opcode, both ways for each conditional and repeating one', () => {
    const deviations = [];
    for (const bytes of sequences()) {
      const { ins, taken, notTaken } = reference(bytes);
      for (const [go, want] of [[true, taken], [false, notTaken]]) {
        let got;
        try {
          got = measure(bytes, arrange(ins, go));
        } catch (e) {
          got = `threw ${e.message}`;
        }
        if (got !== want) deviations.push(`${hex(bytes)} ${ins.mnemonic}${go ? '' : ' (not taken)'}: core ${got}, z80 ${want}`);
      }
    }
    expect(deviations).toEqual([]);
  });
});
```

- [ ] **Step 3: Prove it catches a deviation**

Make JP nn (`0xc3`) return `11`. Run: `pnpm -s vitest run packages/emu/test/unit/cpu-timing.test.js`
Expected: FAIL, and the diff lists six deviations and no others:
- `c3 05 00 00 JP: core 11, z80 10` and its `(not taken)` twin;
- `dd c3 05 00 00 JP: core 15, z80 14` and its twin;
- `fd c3 05 00 00 JP: core 15, z80 14` and its twin.

The prefixed forms run the same handler, plus 4.

Restore `return 10;`.

- [ ] **Step 4: Run it for real**

Run: `pnpm -s vitest run packages/emu/test/unit/cpu-timing.test.js`
Expected: PASS.

Any deviation it lists is a core bug: fix the handler, under a unit test of its own that fails first, and rerun. The exception is a case where `@fugloy/z80` is shown wrong against Young's tables. Then fix its generator and exhaustion test (CLAUDE.md: tables are generated, never hand-edited), and ledger a ruling.

- [ ] **Step 5: Commit**

```bash
git add packages/emu/test/unit/cpu-timing.test.js packages/emu/package.json pnpm-lock.yaml
git commit -m "emu1: check every opcode's T-states against the z80 package's table"
```

### Task 7: CI and the docs

**Files:**
- Create: `.github/workflows/exerciser.yml`
- Modify: `.github/workflows/ci.yml`, `docs/fugloy-emu-spec.md` (§4, §10), `CLAUDE.md`, `README.md`, `CHANGELOG.md`, `packages/emu/README.md`

**Interfaces:**
- Consumes: `pnpm zex:install`, `FUGLOY_ZEX`, `FUGLOY_REQUIRE_ZEX` (Task 1).

- [ ] **Step 1: The exerciser workflow** — `.github/workflows/exerciser.yml`:

```yaml
name: Z80 exercisers

on:
  push:
    branches: [main]
    paths: ['packages/emu/**', 'scripts/install-zex.sh', '.github/workflows/exerciser.yml']
  pull_request:
    paths: ['packages/emu/**', 'scripts/install-zex.sh', '.github/workflows/exerciser.yml']
  schedule:
    - cron: '17 4 * * 1'
  workflow_dispatch:

jobs:
  zex:
    name: ZEXDOC and ZEXALL, group by group
    runs-on: ubuntu-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm zex:install
      - run: FUGLOY_ZEX=1 FUGLOY_REQUIRE_ZEX=1 pnpm vitest run packages/emu/test/exerciser
```

- [ ] **Step 2: Main CI runs the harness tests** — in `.github/workflows/ci.yml`, add `- run: pnpm zex:install` after `- run: pnpm zmac:install`. Change `- run: FUGLOY_REQUIRE_ZMAC=1 pnpm test` to:

```yaml
      - run: FUGLOY_REQUIRE_ZMAC=1 FUGLOY_REQUIRE_ZEX=1 pnpm test
```

That runs the runner's two quick tests, the table finder and the 21 ms last group, on every push. The exercisers themselves stay in their own workflow.

- [ ] **Step 3: The spec** — in `docs/fugloy-emu-spec.md` §4, replace the Decode row with:

```markdown
| Decode | Unprefixed opcodes from a 256-entry array of handlers; `CB`, `ED`, `DD`/`FD`, and `DDCB`/`FDCB` through switch statements. Sub-tables wait for a benchmark that needs them (§2.6): phase 1 measured about 114 MHz effective in Node, nearly 3× the target below |
```

After the table and its "Target speed" line, add:

```markdown
Phase 1 also models:

- **MEMPTR,** the hidden address latch that `BIT n,(HL)` shows in flags 3 and 5, by boo_boo and Vladimir Kladov's rules ("MEMPTR, esoteric register of the ZiLOG Z80 CPU"). Save states keep it.
- **Lone prefixes.** A `DD` or `FD` before another prefix or `ED` runs as a 4-T-state step, with no interrupt taken after it.
- **The block I/O flags** of Young's §4.3.

Not modeled, and invisible to ZEXALL:

- `SCF` and `CCF` taking flags 3 and 5 from the previous instruction's flags (Patrik Rak's z80test);
- the flags of a repeating block instruction interrupted mid-run;
- IM 0 with a bus byte other than `FFH` (the Model III's bus reads `FFH`).
```

In §10, after the table, add:

```markdown
The exercisers are GPL-2.0 and never committed. `pnpm zex:install` fetches them, pinned and hash-checked, into `tools/zex/`. `FUGLOY_ZEX=1` runs them as one Vitest test per group, and `.github/workflows/exerciser.yml` runs them in CI when `packages/emu` changes, and weekly. The timing check is `packages/emu/test/unit/cpu-timing.test.js`, against `@fugloy/z80`'s table.
```

- [ ] **Step 4: CLAUDE.md** — replace the "Current phase" paragraph with:

```markdown
Current phase: **emu phase 1 done** — the Z80 core in `packages/emu` passes
ZEXDOC and ZEXALL, all 67 groups each (`pnpm zex:install`, then `FUGLOY_ZEX=1`),
and its T-states match `@fugloy/z80` for every opcode. Next, per the Roadmap:
emu phase 2 (Model III devices and the `.CMD`/`.BAS`/`.CAS` loaders).
Disassembler phase 2 shipped as v0.2.0, phase 1 as v0.1.0.
```

In Roadmap item 2, change `Phase 0 is done; phase 1 is next.` to `Phases 0 and 1 are done; phase 2 is next.`

- [ ] **Step 5: README.md** — in the status paragraph, replace `Node. Next is its phase 1, a Z80 core that passes ZEXALL; phase 3's ROM and` with:

```markdown
Node; its phase 1 hardened the Z80 core, which now passes the ZEXDOC and
ZEXALL instruction exercisers. Next is its phase 2, the Model III devices and
program loaders; phase 3's ROM and
```

- [ ] **Step 6: CHANGELOG.md** — under `## [Unreleased]` → `### Added`, after the emu phase 0 entry:

```markdown
- `@fugloy/emu`, emu phase 1: the Z80 core passes ZEXDOC and ZEXALL, all 67
  groups each, run one Vitest test per group through a CP/M harness
  (`pnpm zex:install`, then `FUGLOY_ZEX=1`; CI runs them in `exerciser.yml`),
  and its T-states match `@fugloy/z80` for every opcode, both ways for each
  conditional. On the way:
  - `CPL` sets flags 3 and 5.
  - MEMPTR follows the documented rules, and save states keep it.
  - `IN F,(C)`, `OUT (C),0`, and the `NEG`, `RETN`, and `IM` duplicates exist,
    and the other undefined `ED` opcodes are 8-T-state NOPs.
  - A `DD` or `FD` before another prefix or `ED` is a 4-T-state step with no
    interrupt after it, and one before `EX DE,HL` or `EXX` is ignored.
  - The block I/O instructions set every flag.
```

- [ ] **Step 7: packages/emu/README.md** — append:

````markdown
## Testing the Z80 core

ZEXDOC and ZEXALL, Frank Cringle's Z80 instruction exercisers, are GPL-2.0, so
they are never committed. `pnpm zex:install` downloads them into the
gitignored `tools/zex/`, pinned to one commit of
[agn453/ZEXALL](https://github.com/agn453/ZEXALL) and checked by SHA-256. Then:

```sh
FUGLOY_ZEX=1 pnpm vitest run packages/emu/test/exerciser               # about 7 minutes, one test per group
FUGLOY_ZEX=1 pnpm vitest run packages/emu/test/exerciser -t "daa,cpl"  # one group
```

They run on `test/cpm.js`, a CP/M stand-in: the program at `0100H`, BDOS
functions 2 and 9 at `0005H`, and a jump to `0000H` to end.
`test/unit/cpu-timing.test.js` checks every opcode's T-states against
`@fugloy/z80`.
````

- [ ] **Step 8: Run everything and commit**

Run: `pnpm -s typecheck && pnpm -s test 2>&1 | tail -5 && pnpm -s build`
Expected: all green.

```bash
git add .github/workflows/exerciser.yml .github/workflows/ci.yml docs/fugloy-emu-spec.md CLAUDE.md README.md CHANGELOG.md packages/emu/README.md
git commit -m "emu1: run the Z80 exercisers in CI and record phase 1"
```
