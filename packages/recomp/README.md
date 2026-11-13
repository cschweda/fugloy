# @fugloy/recomp

Turns a TRS-80 program into a readable JavaScript port: one function per routine of the original, one
statement per instruction, running on [`@fugloy/runtime`](../runtime/README.md)'s machine state. A port
holds no Z80 interpreter and none of the program's code bytes, and every block's T-states and R increments
are exact against [`@fugloy/emu`](../emu/README.md), the emulator a port is refereed against.

TypeScript compiled to plain ESM, with no DOM, no Node APIs, and no runtime dependencies beyond
`@fugloy/z80` and `@fugloy/disasm`. It is part of Fugløy's Part 2, the port and the remake (design:
[`docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md);
milestone M1's plan:
[`docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md)).
Version 0.1.0, built in the repository and **not published** in M1. So far it translates single
instructions; grouping them into blocks, routines and a module comes in the plan's next task.

## translate

```ts
import { decodeAt } from '@fugloy/z80';
import { translate } from '@fugloy/recomp';

const ins = decodeAt(Uint8Array.of(0x80), 0, 0x5000);   // ADD A,B at $5000
translate(ins, 0x5000, { qPrev: null });
// { lines: ['z.a = o.add8(z, z.a, z.b);'], writesFlags: true, flow: 'next', cycles: 4, r: 1 }
```

`translate(ins, at, ctx)` turns one decoded instruction at address `at` into JavaScript statements over the
machine state `z` and the runtime's helpers `o` (`@fugloy/runtime/ops`). It translates every byte sequence
`@fugloy/z80` decodes to an instruction, documented or not (SLL, the IXH/IXL forms, `ED 63` and `ED 6B`):
800 of them. A sequence `@fugloy/z80` reads only as a `DB` fallback (a DD or FD on an opcode it does not
change, an empty ED slot, DD CB d with a register other than `(IX+d)`) is refused with a sentence naming its
address and bytes. The translator is a table from the mnemonic and its operands' kinds to a line template;
it names no opcode byte.

### The `Translation`

| Field | |
|---|---|
| `lines` | Statements, run in order. |
| `writesFlags` | True when the instruction writes the flags as emu counts it (`flagsWritten`): not for POP AF or EX AF,AF', which load F without writing it as flags. The next instruction's `ctx.qPrev`. |
| `flow` | `'next'`, `'jump'`, `'call'`, `'return'` or `'halt'`, as `@fugloy/z80` gives it. |
| `cond` | A conditional transfer's condition, a boolean JavaScript expression evaluated **after** `lines` (DJNZ's is `z.b !== 0`, over B after its decrement; the rest read `z.f`). True when taken. |
| `taken` | Statements a conditional transfer runs after `lines` only when `cond` is true: CALL cc's push, RET cc's pop, JR cc's and DJNZ's MEMPTR. |
| `target` | The address a transfer names (JP, JR, DJNZ, CALL, RST). |
| `targetExpr` | A computed target, an expression evaluated after `lines` and `taken`: `z.hl`, `z.ix` or `z.iy` for JP (rr); `z.wz` for RET, RET cc, RETI and RETN, whose lines pop the return address into MEMPTR. |
| `cycles` | The T-states the tick after the instruction adds: a conditional transfer's when taken; a repeating instruction's last iteration (16). |
| `cyclesNotTaken` | The T-states when `cond` is false; present exactly when `cond` is (JP cc's and CALL cc's are their own, 10). |
| `r` | The R increments the tick after the instruction adds: 1, or 2 with a prefix (DD CB and FD CB too); 0 for LD R,A, whose write replaces its fetches' increments. |
| `repeats` | LDIR, LDDR, CPIR, CPDR, INIR, INDR, OTIR, OTDR: the lines are a `for (;;)` loop of the one-iteration helper that ticks each iteration that repeats itself, `z.tick(21, 2)`, where it ends; `cycles` and `r` are the last iteration's. A repeating LDIR, LDDR, CPIR or CPDR iteration sets MEMPTR to the instruction's address + 1 and takes F's bits 5 and 3 from that address's high byte, as emu's `_xyRepeat` does. |
| `readsTime` | IN and OUT in every form (the block and repeating ones too), LD A,R and LD R,A: the lines read or replace `z.cycles` or `z.r` (a port write is stamped with `z.cycles`; LD A,R reads R as `(z.r & 0x80) \| ((z.r + 2) & 0x7f)`), so they assume both are current to the instruction's own start, and a block ticks its earlier instructions just before it. |

Every other instruction's lines leave `z.cycles` and `z.r` alone, so a block may tick all of them at once at
its end, adding the `cycles` and `r` of each (the ticks inside a repeating loop add in too: R's count is a
sum, modulo 128, that keeps bit 7).

`ctx.qPrev` is Q for SCF and CCF, whose bits 5 and 3 are A's or-ed with F's own when the instruction before
left the flags alone: 1 when the previous instruction in the same block wrote the flags (its `writesFlags`),
0 when it did not, and `null` at a block's start, where the statement reads `z.q`, which the block before
leaves (1 when its last instruction wrote the flags).

MEMPTR (`z.wz`) is set wherever emu sets it: an indexed operand's statements set it to `IX+d` or `IY+d`
first and use it as the address, BIT n,(HL) takes bits 5 and 3 from its high byte, and EX (SP),rr writes the
high byte before the low.

### What it does not model

- **EI's delay.** EI sets both flip-flops at once; on a Z80, and in emu (`pendingEI`), interrupts are
  enabled only after the instruction that follows it. A port takes no interrupts in M1, so nothing can see
  the difference; the test compares EI with emu after EI and one NOP.
- What the runtime does not model (interrupts, the devices it lists).

## How it is checked

`test/translate.test.ts` runs every one of the 800 instructions from 64 seeded states each (four of them
edges where SP and the operands wrap at `$FFFF`/`$0000`) on emu's core over a flat 64K bus and its
translation on the runtime's flat machine, and requires equal every register, F, MEMPTR, IFF1, IFF2 and the
interrupt mode, the PC the transfer reaches, the 64K, every memory write in order, every port read and write
(with the T-state of each write), the T-states, R, `writesFlags` against emu's own `flagsWritten`, and
`readsTime` and `repeats` against the lists above; each conditional transfer both taken and not taken. The
repeating instructions also run a full BC = 3 (B = 3) with every iteration's state and 64K compared. SCF and
CCF are run after an instruction that writes the flags and two that do not (one of them POP AF), with
`qPrev` from it and with `qPrev` null and `z.q` from it.

MIT, as the rest of Fugløy.
