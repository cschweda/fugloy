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
Version 0.1.0, built in the repository and **not published** in M1.

## port

```ts
import { port } from '@fugloy/recomp';

const result = port(cmdBytes, { model: 3, names, runtimeImport: '@fugloy/runtime/ops', source: 'invaders.cmd' });
if (result.ok) writeFile('invaders.port.js', result.js);   // and result.report
else console.error(result.errors.join('\n'));               // sentences: why it cannot be ported
```

`port(cmd, opts)` ports a `.CMD` program: `@fugloy/disasm` loads and analyses it (a hint file's text in
`opts.hints` applied; `opts.names`, a map from address to name, given to its addresses, over the hint
file's), its IR's blocks are grouped into routines, and each instruction is translated. The result is
`{ ok: true, js, report }` or `{ ok: false, errors }`. The same program, model, names and hints give the
same module, byte for byte.

The module imports the runtime's helpers as `o` from `opts.runtimeImport` and exports:

| Export | |
|---|---|
| `MODEL` | 1 or 3 |
| `DATA` | every non-code region of the loaded program as `[address, Uint8Array]`, in address order. No code byte is in it, and nothing in the port decodes Z80. |
| `ENTRY` | the entry routine |
| each routine, by name | `NAME(z, ret)`: a routine is the entry or a CALL or RST target; its blocks are those reached from its start by jumps and falling through (the address after a CALL included) without entering another routine's start. Named from `opts.names`, else the disassembler's symbols, else `SUB_XXXX`, made a JavaScript identifier; a hint note at its start is its JSDoc. |

Inside a routine the blocks are structured code where the control flow allows (see *Structure* below):
`while (true)` loops, `if`/`else`, `break` and `continue`, each block written once, in place. Where it does
not, they are the labelled cases of `for (;;) switch (b)`, in address order. One instruction is one
statement, with its address and assembly as a comment. Each block begins `z.at(addr);` and ends with `z.tick(t, r); z.q = 0|1;`: its T-states and R
increments, on each path a conditional transfer takes (`cyclesNotTaken` when not taken), and Q, whether its
last instruction wrote the flags. A block also ticks just before an instruction that reads the time
(`readsTime`), so `z.cycles` and `z.r` there are its own start; a repeating instruction's loop ticks each
iteration that repeats itself. Where the block goes:

| Transfer | Statement |
|---|---|
| to a block of the same routine (its own start included) | structured: the block's code in place, `continue` to a loop's head, or `break` to the code after a loop or a labelled block; labelled: `b = 0x7006; continue;` |
| into another routine's start | `return OTHER;` (the trampoline runs `OTHER` next, with the same `ret`) |
| a CALL or RST of a routine | the push of the return address, the tick, then `o.call(z, CALLEE, 0x7005);` and on to the block after it |
| a RET | the pop (into MEMPTR, as emu), the tick, then `o.ret(z, ret, 0x7010); return;`: a sentence if it popped anything but `ret` |
| to an address no block starts (a ROM routine, data) | `throw o.unknown(z, 0x0060, 0x7002);`, listed in `report.refused` |
| HALT | `throw o.halt(z, 0x7003);`, listed in `report.refused` |

A `JP (HL)`, `JP (IX)` or `JP (IY)` refuses the port (`ok: false`, a sentence naming its address), as does
an instruction `@fugloy/z80` decodes only as `DB`, a hint file that does not parse or apply or relocates a
region, and an entry that is not code.

`report`: `entry` (the entry routine's name), `routines` (`name`, `addr`, `blocks`, and `labelled`: true
when the blocks are a `switch`, false when the routine is structured), `data` (`DATA`'s addresses and lengths) and `refused` (each place that
throws when it runs, one sentence each).

`@fugloy/runtime`'s `load(z, port)` writes `DATA` into memory and `runPort(z, port)` runs `ENTRY` until it
returns (see its README).

### Structure

`structure(flow)` (`src/structure.ts`) decides a routine's shape from its control flow alone: its start and,
for each block, the blocks of the routine its code transfers to, one per transfer (`port()` takes them from
the code it writes, so a CALL that throws has no transfer to the block after it). After Ramsey's "Beyond
Relooper" (2022): the blocks in reverse postorder from the start, their dominators, and the dominator tree.

- A transfer backward in that order must go to a block that dominates its source, a loop's head; it is
  `continue`. Otherwise the flow is irreducible (a loop entered other than at its head), `structure` says
  which jump (`{ ok: false, why }`), and the routine stays labelled.
- A loop's head is written as `while (true)`, and the blocks it leaves to (a block outside the loop whose
  immediate dominator is inside) come after it, each after the outermost loop it leaves: the first is
  reached by `break`, the others by breaking a labelled block around the loop (`to_XXXX`).
- Any other block is written where the one transfer that reaches it is, or, when two or more reach it (where
  an `if`/`else`'s arms meet), after a labelled block around its dominator's code, reached by `break`.
- No block is written twice. A block no transfer reaches (the one after a CALL to an address no block
  starts) is left out, with a comment saying so.

The emitter then makes it plainer without changing what runs: a `break` or `continue` that falling off the
end reaches anyway is dropped, an `if` whose arm ends by breaking a labelled block that the code after it
also reaches takes that code as its `else`, a labelled block nothing breaks is unwrapped, and a `break` or
`continue` names its loop (`loop_XXXX`) only when it is not the innermost. Labels come from addresses
alone. Every block still begins with `z.at(addr)`, once each time it runs, and runs its statements, tick and
`z.q` in the same order as labelled: the referee, which compares at each `z.at`, judges it.

```js
export function START(z, ret) {
  z.at(0x7000); // START
  z.hl = 0x3C00;                                    // $7000  LD HL,3C00H
  z.bc = 0x0400;                                    // $7003  LD BC,0400H
  z.tick(20, 2); z.q = 0;
  while (true) {
    z.at(0x7006); // FILL
    z.write(z.hl, 0xBF);                            // $7006  LD (HL),0BFH
    …
    if ((z.f & 0x40) === 0) {                       // $700C  JR NZ,FILL
      z.wz = 0x7006;
      z.tick(42, 6); z.q = 0;
      continue;
    }
    z.tick(37, 6); z.q = 0;
    break;
  }
  while (true) {
    z.at(0x700E); // WAIT
    z.wz = 0x700E;                                  // $700E  JR WAIT
    z.tick(12, 1); z.q = 0;
  }
}
```

(Lesson 1, White out, as ported.)

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
- **Interrupts.** A port takes none: on the Model I, with interrupts enabled, emu takes the 40 Hz interrupt
  at `$0038` and the port carries on without it. `port()` lists each EI in the report's `refused` (`$XXXX: EI
  enables interrupts, which a port does not take (M1)`) and still returns `ok: true`.
- **Self-modifying code.** M1 translates none, and `port()` does not look for it: the referee finds it, as a
  write by emu into a byte of the program's code, and refuses the run. A port of a program that patches its
  own code, run without the referee, would run the unpatched code.
- **A block reached from two routines** is translated in each, so its statements appear twice.
- What the runtime does not model (interrupts, the devices it lists).

## The referee

A port is proved the same program by running it beside `@fugloy/emu`: `test/referee.ts` (test code, since emu
is a devDependency) exports

```ts
const result = await referee({ cmd, model: 3, names, steps: check.steps });
// { ok: true, cycles, blocks, frames }
// { ok: false, report, at: { routine, block, cycles }, field }
```

`names` maps an address to a name or to every name there (`allNamesOf` in `test/helpers.ts` gives an
assembled program's own labels so): `port()` names each address by the first, and a `pcIn` step finds its
label among all of them, so a label that shares its address with another is found.

It boots emu on Fugløy's stub ROM (never the user's ROM), loads the program, ports it with `names`, and gives
the port's `Z` emu's registers and 64K, but with every byte the `.CMD` loads put back as a standalone port has
it: none of the code bytes (they read as `load` leaves them, 0 in RAM), and `DATA` written by `load`. Then
the port runs with `z.at` replaced. At each block start emu is stepped until its T-states reach the port's,
and there must be equal: the T-states, emu's PC and the block's address, every register, F, R, MEMPTR, the
interrupt state and Q, and every byte either machine wrote since the block before. At the first block start
of each frame (1/60 s of emu's `clockHz`) video RAM is compared, and at the end the 64K, the keyboard as each
reads it from the keys held; the one address range never compared is the Model I's Expansion Interface,
`$37E0`–`$37EF`, whose 40 Hz latch emu sets with time and which the runtime refuses to touch.

`steps` are a `check.json`'s (`run`, `press`, `release`, `row`, `cell`, `pcIn`, as
`packages/asm/test/lessons.test.ts` documents them). Each applies at the first block start at or after its
T-state from the entry, on both machines: a key to both keyboards; `row` and `cell` checked on both, `pcIn`
on emu's PC, its labels read from `names`. The run ends at the first block start at or after the last `run`,
or when the program returns to the stub's `RETURNED` (steps not yet due then apply to both as they stopped).
`cycles` count T-states from the entry; `blocks` the block starts compared; `frames` how many of them
compared video RAM. Steps it cannot judge by throw a sentence before anything runs: a step that is not one
of those forms, steps with no `run` (the run would end at the first block start, having compared that block
alone), and a `pcIn` label `names` does not hold.

It stops at the first of these, with a sentence in `report` and the block start in `at` (after a return,
routine `''` and block `RETURNED`):

| `field` | |
|---|---|
| `cycles`, `pc`, `a` … `hl_`, `wz`, `iff1`, `iff2`, `im`, `q` | a difference at a block start: both values, the block before and emu's last instruction in it, and the first byte of the program's code emu read as data, if any (a port has no code bytes, so a program that reads its own code is stopped at the first register or byte that read changes) |
| `mem[$XXXX]` | a byte either machine wrote that differs, or one the end's compare finds |
| `code` | `self-modifying code: $XXXX written by the instruction at $YYYY (M1 does not translate it)`: emu wrote into a byte of the program's code, by any instruction, whether or not the byte runs again |
| `refusal` | what the port refused as it ran, in the port's sentence; for a device, emu is stepped through the block to the same access, which names the instruction |
| `port` | `port()` refused the program: its sentences |
| `row N`, `cell $XXXX`, `pcIn` | a check step that does not hold, on either machine |

It does not compare the port's sound or cassette records (writes to port `$FF`, `z.sound`) with emu's: no
Learn program uses IN or OUT. Milestone M2 adds the comparison for Sea Dragon's sound.

## The Learn programs

`test/learn.test.ts` is milestone M1's proof: every lesson (seven) and every Build Space Invaders chapter
(twelve) under `apps/web/content/learn/`, found as `packages/asm/test/lessons.test.ts` finds them, on each
model its `check.json` names (all nineteen name both, so 38 runs), is assembled with `@fugloy/asm`, ported
with its own labels as the names, and run by the referee through its `check.json` steps. Each run must be
`ok`, last at least as long as the steps' `run`s add up to (no Learn program returns to the stub), and
compare video RAM at least once a frame. All 38 pass, in about 61 s on one core of an M-series Mac
(chapter 8, 236 million T-states, about 12.5 s; about 19 million T-states a second). It needs neither zmac
nor a user's ROM, so it runs in CI with the rest of the suite.

The 38 ports: 129 routines and 717 blocks on each model, all 129 structured and none `labelled` (as of M1's
Task 6), 486,570 bytes of JavaScript in all (572,788 when every routine was a `switch`, in Task 5); the
largest is chapter 12's, 38,481 bytes (976 lines, 18 routines). No port lists a place that refuses as it runs, and no
program writes into its own code (the referee would have stopped it).

`fugloy port <program.cmd> --model 1|3 [--hints <file>] [-o <dir>]` (`packages/cli`) writes a port and its
report from the command line.

## How it is checked

`test/referee.test.ts` runs the referee over the programs below on both models, and plants what it must
catch: an `add8` whose H is wrong (stopped in F at the block after the first ADD), a block's tick one T-state
or one R increment short (stopped in `cycles` or `r` at the next block), a byte written differently, a
store, a block move and a push into the program's code and a write into code that never runs again (each
refused as self-modifying), a program that reads its own code into a register and one into memory, a key
pressed by a step (the wait loop ends at the same T-state on both), the check steps (a `pcIn` on a label that
shares its address with another included), the refusals, and the steps it refuses to judge by (none with a
`run`, a malformed step, a `pcIn` label not given).

`test/port.test.ts` assembles programs with `@fugloy/asm` (a straight line, a DJNZ count, conditional JP
and JR both ways, CALL and RET three deep with CALL cc and RET cc both ways, two routines jumping into each
other a thousand times, a table read with `LD A,(HL)`, a `.CMD` of two blocks, an if/else diamond run both
ways, a loop left from a loop inside it, and a loop entered below its head) and runs each on emu (the stub
ROM booted and the program loaded, as the Learn checks do) and as its port on the runtime, from emu's
registers and 64K at the entry, on the Model III and the Model I. Every block must start where emu starts an
instruction at the same T-state with the same R; at the end every register, F, R, MEMPTR, Q, the interrupt
state, the T-states and the 64K must be equal. It also checks that `DATA` is exactly the program's `DB` bytes
and `load` writes nothing else, that the module is the same when ported twice, that two routines jumping into
each other leave the JavaScript stack as deep as it was, and the sentences for a `JP (HL)`, an unknown target,
a RET to the wrong address and a device the runtime does not model.

`test/structure.test.ts` checks the shapes: the straight line, DJNZ, diamond and nested-loop programs have
no `switch`, every routine structured, and pass the referee on both models; the loops, the diamond's
`if`/`else` and the nested loop's labelled `break` read as quoted; the loop entered below its head stays a
`switch`, labelled in its report, and passes the referee; lesson 1's port has no `switch` and its loops read
as loops; and in every Learn port a routine is `labelled` exactly when its text has a `switch`.

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
