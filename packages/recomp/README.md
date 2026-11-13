# @fugloy/recomp

Turns a TRS-80 program into a readable JavaScript port: one function per routine of the original, one
statement per instruction, running on [`@fugloy/runtime`](../runtime/README.md)'s machine state. A port
holds no Z80 interpreter and none of the program's code bytes, and every block's T-states and R increments
are exact against [`@fugloy/emu`](../emu/README.md), the emulator a port is refereed against.

TypeScript compiled to plain ESM, with no DOM, no Node APIs, and no runtime dependencies beyond
`@fugloy/z80` and `@fugloy/disasm`. It is part of Fugløy's Part 2, the port and the remake (design:
[`docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/specs/2026-10-23-part2-port-and-remake-design.md);
milestone M1's plan:
[`docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/plans/2026-10-23-part2-m1-port-pipeline.md);
M2's, Sea Dragon's port:
[`docs/superpowers/plans/2026-11-13-part2-m2-sea-dragon-port.md`](https://github.com/cschweda/fugloy/blob/main/docs/superpowers/plans/2026-11-13-part2-m2-sea-dragon-port.md)).
Version 0.1.0, built in the repository and **not published** in M1 or M2.

## port

```ts
import { port } from '@fugloy/recomp';

const result = port(cmdBytes, { model: 3, names, runtimeImport: '@fugloy/runtime/ops', source: 'invaders.cmd', standins });
if (result.ok) writeFile('invaders.port.js', result.js);   // and result.report
else console.error(result.errors.join('\n'));               // sentences: why it cannot be ported
```

`port(cmd, opts)` ports a `.CMD` program: `@fugloy/disasm` loads and analyses it (a hint file's text in
`opts.hints` applied; `opts.names`, a map from address to name, given to its addresses, over the hint
file's), its IR's blocks are grouped into routines, and each instruction is translated. The result is
`{ ok: true, js, report }` or `{ ok: false, errors }`. The same program, model, names, hints, stand-ins and
trace give the same module, byte for byte.

`opts.standins` (M2) maps the address of a ROM routine `@fugloy/runtime` stands in for to its name:
`new Map([...standins(model)].map(([addr, s]) => [addr, s.name]))`, from the runtime's `standins` (recomp
does not depend on the runtime, so it takes the names). On the Model III that is `$0060`, `DELAY`; the
Model I has none in M2. Without it, any CALL into the ROM is refused, as in M1. `fugloy port` passes the
model's.

`opts.trace` (M2) is the program's port trace (`parseTrace`; see *The trace and the census*): the code bytes
it rewrites, its **cells**. Each is matched to the byte of its instruction it is, from the IR's instruction
that covers it and `@fugloy/z80`'s decoding of it: an index displacement, an immediate (a port number counts
as one), a byte of a word operand, or the opcode. A rewritten operand is read from its cell in memory when its
instruction runs, and a rewritten opcode makes its instruction a choice between the instructions the trace
saw (both below); a cell that is a prefix byte, lies in no decoded instruction, or lies in two (pass 1
holding overlapping decodes), refuses the port with a sentence naming it. A trace taken of another program or
another model is refused. Without a trace the port assumes the program rewrites none of its code, and a standalone port
throws at a write into it.

The module imports the runtime's helpers as `o` from `opts.runtimeImport` and exports:

| Export | |
|---|---|
| `MODEL` | 1 or 3 |
| `DATA` | every non-code region of the loaded program as `[address, Uint8Array]`, in address order, at the addresses the program runs at. No code byte is in it, and nothing in the port decodes Z80. |
| `CODE` | the program's code as `[first, last]` address ranges (inclusive), in address order: the IR's code regions at run addresses, a relocated program's loader left out. None of their bytes is carried; `load` installs a write guard over them. |
| `CELLS` | the trace's cells as `[address, byte]`, in address order, each with its byte as the program loads it: a rewritten operand's initial value, which the program treats as data, or a swapped opcode's, the stored state of its choice. Empty with no trace. These are the only code bytes a port holds. |
| `ENTRY` | the entry routine: the file's transfer address, or for a relocated program the hint file's entry (below) |
| each routine, by name | `NAME(z, ret)`: a routine is the entry, a CALL or RST target, or a continuation (the instruction after a `POP` that drops a return address, M2: below); its blocks are those reached from its start by jumps and falling through (the address after a CALL included) without entering another routine's start. Named from `opts.names`, else the disassembler's symbols, else `SUB_XXXX`, made a JavaScript identifier; a hint note at its start is its JSDoc. |

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
| into the entry's start, when the entry's first block loads SP with a constant before any CALL, RET, PUSH or POP (M2) | the tick, then `throw o.reset(L497F);`: the program discards its whole stack, so every routine running is left and the top-level trampoline runs the entry. Listed in `report.resets`. A jump from the entry routine to its own start stays a jump within it |
| on from a `POP` the trace says dropped a return address (M2) | the `POP`'s ordinary statement, the block's tick and Q, then `throw o.unwind(1, SUB_4BAD, 0x4BAC);` (below) |
| a CALL or RST of a routine | the push of the return address, the tick, then `o.call(z, CALLEE, 0x7005);` and on to the block after it |
| a CALL of a ROM routine in `opts.standins` | the tick, then `o.standin(z, 0x0060, 0x4EAF); // $4EAC  CALL 0060H  ; $DELAY, the runtime's stand-in` (which pushes the return address itself, runs the stand-in and pops it) and on to the block after it; a CALL cc keeps its MEMPTR statement and runs `o.standin` on its taken path. Listed in `report.standins`, not `refused` |
| a RET | the pop (into MEMPTR, as emu), the tick, then `o.ret(z, ret, 0x7010); return;`: a sentence if it popped anything but `ret` |
| to an address no block starts (a ROM routine with no stand-in, data) | `throw o.unknown(z, 0x0050, 0x7002);`, listed in `report.refused` |
| a `JP nn` whose target the program rewrites | `z.wz = z.mem[0x509B] \| z.mem[0x509C] << 8; // $509A  JP L509D  ; rewritten as it runs: read from $509B, $509C`, the tick, then `if (z.wz === 0x509D) { … } else { if (z.wz === 0x50C1) { … } else { throw o.unknown(z, z.wz, 0x509A, [0x509D, 0x50C1], 0x509B); } }`: a transfer for each target (below), structured as a conditional jump's arms, and for any other value a sentence naming the JP, the value, the byte rewritten (the low byte's address when both are, the high byte's when it alone is) and the targets the trace saw |
| an instruction whose opcode the program rewrites | `switch (z.mem[0x525E]) { case 0xC2: …; break; case 0xCA: …; break; default: throw o.variant(z, 0x525E, [0xC2, 0xCA], 'JP NZ,L52F8'); }`, the site a block of its own: each case is that instruction translated as a block's last, with its own tick, Q and transfer (below) |
| HALT | `throw o.halt(z, 0x7003);`, listed in `report.refused` |

A `JP (HL)`, `JP (IX)` or `JP (IY)` refuses the port (`ok: false`, a sentence naming its address), as does
an instruction `@fugloy/z80` decodes only as `DB`, a hint file that does not parse or apply, and an entry
that is not code.

**A rewritten operand** (M2) stays one statement on one line that reads its cell, with the cell's address in
the code and the original assembly in the comment, `; rewritten as it runs: read from $XXXX` after it. A
displacement is sign-extended as the decoder does it, `z.wz = (z.iy + ((z.mem[0x49C1] ^ 0x80) - 0x80)) &
0xffff;`, with MEMPTR and the T-states as the unpatched instruction's; an immediate is `z.mem[0x7005]`; a word
is `z.mem[lo] | z.mem[lo + 1] << 8` when both its bytes are cells, and when one alone is (a program may rewrite
only the low byte), that byte from memory and the other the constant it was loaded with (`z.mem[0x7010] |
0x5000`), since a code byte that is not a cell is not carried and cannot change. A rewritten `JP nn`'s
targets are the words the trace attests (the low byte's values with the high byte's, or with the byte as
loaded where it is not a cell; when both bytes took several values the trace cannot say which went
together, and the port is refused rather than guess), and the word as loaded where a block starts there.
Each must be a block of the IR (an `entry` hint decodes code only such a jump reaches, as `seadrg01.hints`
does at `$50C1`); one that is not refuses the port, naming it. The targets are the jump's block's successors,
so they join its routine and the routine stays structured. An instruction whose rewritten operand its
statement cannot read so (a `JR`'s or `DJNZ`'s displacement, an `IN`/`OUT` port number, a `CALL`'s or a `JP
cc`'s target) refuses the port with a sentence naming it.

**A swapped opcode** (M2; the plan's first "Claude's call"). Where the program rewrites an instruction's
opcode (Sea Dragon swaps `JP NZ,nn` and `JP Z,nn` at `$525E`, `LD (HL),A` and `NOP` at `$5174`, `CALL 6212H`
and `RET` at `$5AEA`), `port()` decodes one instruction for each value the trace saw at the cell and for the
value as loaded (which runs before the first write), by value, each with `@fugloy/z80` from the bytes as
loaded with the cell's byte replaced; their operands are translated into the code, never carried. The
variants may differ in length, each falling through to its own `at + length` (while `$5AEA` holds `RET`,
the two bytes after it are never run, and nothing makes them an instruction start). The site is a block of
its own whose successors are every variant's (a fall-through, a jump's target, a call's target and return
point); `port()` gives the site and those successors to `@fugloy/disasm` as roots, so each starts a block and
code only a variant reaches is analysed as code, then sets the block's successors before grouping routines.
`emit` writes `switch (z.mem[cell])` with a case per value, each that instruction's ordinary statements, tick
(its own T-states and R, taken or not taken), Q and transfer: a CALL through the trampoline (or
`o.standin`), a RET with `o.ret`'s check. A case that falls through ends `break;`, and a jump inside a case
names its loop's label, since a bare `break` would leave the switch. The `switch` is on a cell, not on a
block: the routine stays structured around it. A value the port has no case for throws `o.variant`'s
sentence (`the opcode at $525E (of JP NZ,L52F8 as loaded) is $00, which the trace did not see there (the
port knows $C2 and $CA); run the census over a session that reaches this`), which, like an unseen JP target, is not in `refused`; nothing
is decoded as the port runs. A value `@fugloy/z80` reads only as `DB`, one that makes the cell a prefix, a
variant that takes in another rewritten byte or a byte that is not code the disassembly decoded, a site that
is not a block of its own, and a successor where no block starts each refuse the port with a sentence. So
does a successor whose root would take bytes from the program's own code: the analysis works the roots it is
given before the hint file's entries, so a variant's successor can be decoded first, inside an instruction
the program runs, and push it out; `port()` requires every instruction of the analysis without the roots to
be in the analysis with them, at the same address and length, and otherwise names the variant and the
instruction it would displace.
`report.cells` gives each opcode cell its `variants`, the instructions by value.

**A dropped return address.** A program may throw away the return address a CALL pushed: Sea Dragon's
title loop calls `TITLE_FRAME`, which on ENTER goes to `$4BAC POP AF`, and the title loop is left for good.
The census lists such a `POP` in the trace's `drops`. `port()` ends the `POP`'s block with it and starts a
routine, the continuation, at the instruction after it (named as any routine is: `opts.names`, the
disassembler's symbols, else `SUB_XXXX`; Sea Dragon's is `SUB_4BAD`); the `POP`'s block ends `throw
o.unwind(1, SUB_4BAD, 0x4BAC);` after its tick. The trampoline running the routine is the one whose return
address the program dropped: it rethrows the unwind with one level fewer, and the trampoline above it, with
none left, goes on with the continuation, with its own `ret`, as the Z80 goes on a level up. `POP`s in a row
that each drop one end one block after the last, `o.unwind(2, CONTINUATION, 0x5509, 0x550A)` (each `POP`'s
address, in order), and leave two trampolines. A drop the trace names where the port translates no `POP`
(another instruction, a swapped opcode's site, the loader) refuses the port with a sentence; one that reaches
the top-level trampoline with levels left (the program popped the address the port was started with) throws
a sentence as the port runs, naming the `POP` that took that address (of a run, not always the last). A drop the trace does not
list (Sea Dragon's two `POP AF` at `$550A`/`$550B` never ran) leaves the port expecting the address, and its
next `RET` throws `o.ret`'s sentence, which says the census may need a session that reaches the `POP`.

The entry needs no trace for its own case (Ruling 10): when its first block loads SP with a constant before
any CALL, RET, PUSH or POP (Sea Dragon's `DI / LD SP,4495H` at `$497F`; an `LD SP,nn` whose operand is one of
the trace's cells loads whatever the program last wrote there, an SP it saved, say, so it makes no reset), a
transfer back to it from another
routine discards the whole Z80 stack, so it is `throw o.reset(ENTRY)`, which every trampoline but the
top-level one passes on, and that one runs the entry with the return address the port started with. Sea
Dragon goes back to `$497F` at GAME OVER (`$6042`), on SHIFT+BREAK from inside nested calls (`$4CC6`) and at
`$602D`; before this each game left its frames behind for good. An entry that touches the stack first, or
never loads SP, gets an ordinary `return ENTRY;`.

**A relocated program.** When the file loads a program at one address and a loader moves it to where it
runs (Sea Dragon's `seadrg01.cmd`: loaded at `$5200`, moved to `$497F` by 15 bytes at `$8881`), the hint
file's `relocate` line has `@fugloy/disasm` analyse it at its run addresses. `ENTRY` is then the routine at
the hint file's `entry` inside the relocated range (none there refuses the port with a sentence; of
several, the one the program's code reaches from the file's transfer address, so that an entry hint for code
only a rewritten jump reaches, such as Sea Dragon's `$50C1`, is not taken for the start; two or more reached
refuse it), `DATA` is sliced from the analysis image at the run addresses, and the loader, the
file's transfer routine and the blocks it reaches outside the relocated range, is not translated: the port
starts at the program's own entry with its data already where the loader would have put it, and the
module's first comment and `report.loader` say so. What the loader leaves in the registers is the host's
business, as any port's start state is.

`report`: `entry` (the entry routine's name), `entryAddr` (its address), `loader` (only for a relocated
program: the loader's `addr`, `length` in bytes and a one-line `note`), `routines` (`name`, `addr`,
`blocks`, and `labelled`: true when the blocks are a `switch`, false when the routine is structured),
`data` (`DATA`'s `addr`, `length` and `kind`: `data` for a region the hint file types as data, `unknown` for
one the analysis did not reach, the string heuristic's guesses included, since the disassembler types no
data from the code's references), `refused` (each place that throws when it runs, one sentence each),
`standins` (each ROM routine the port calls a stand-in for, in address order: its `addr`, `name` and the
`sites`, the addresses of its CALLs in order) and `cells` (M2: each of the trace's cells, in address order:
its `addr`, the `instruction` it is a byte of, its `kind`, `disp`, `imm`, `word` or `opcode`, the
`values` the trace saw written, and for an opcode its `variants`, each instruction the port chooses between,
as assembly, by value; `CELLS` holds each one's initial byte), `drops` (M2: each of the trace's drops, in
address order: the `POP`'s `at` and the `continuation` routine's name, the same for `POP`s in a row) and
`resets` (each transfer back to an entry that reloads SP, written `o.reset`, in address order: its `at` and a
one-sentence `note`) and `rom` (M2: the trace's ROM reads, the ROM bytes the program reads as data, by
address, each its `addr` and `value`; the module exports them as `ROM`, `[address, byte]`, and the runtime's
`load` puts them in memory, so a port needs no ROM of anyone's; one past the model's ROM refuses the port). A rewritten JP's unseen target and a swapped opcode's unseen value throw only if they
are ever reached, so they are not in `refused`.

`@fugloy/runtime`'s `load(z, port)` stores `ROM` straight into memory, writes `DATA` and `CELLS` and installs
the write guard over `CODE`, and `runPort(z, port)` runs `ENTRY` until it returns (see its README).

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
| `targetExpr` | A computed target, an expression evaluated after `lines` and `taken`: `z.hl`, `z.ix` or `z.iy` for JP (rr); `z.wz` for RET, RET cc, RETI and RETN, whose lines pop the return address into MEMPTR, and for a JP nn whose target is rewritten, whose lines read it into MEMPTR. |
| `targets` | For a JP nn whose target is rewritten (`ctx.cells.word` and `ctx.targets` given): the targets it may hold, `ctx.targets`; `emit` writes a transfer to each and `o.unknown`'s sentence otherwise. |
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

`ctx.cells` (M2) gives the operands the program rewrites, by where they are: `disp`, a displacement's byte;
`imm`, an immediate's; `word`, a word operand's low byte, with `half` `'lo'` or `'hi'` when only that byte of
it is rewritten. Each is read from `z.mem` as described under *port*; `ctx.targets` are a rewritten `JP nn`'s.
A cell the instruction's statements do not read throws a sentence naming it, so no rewritten operand is ever
translated as the constant it was loaded with.

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
- **Self-modifying code.** A rewritten operand the trace names is read from memory, and a swapped opcode is a
  choice between the instructions the trace saw there (M2). Any other write into code is refused where it
  happens: by the referee, as a write by emu into a byte of the program's code, and in a standalone port by
  `load`'s write guard, which throws `self-modifying code: $XXXX written (the trace does not name it; run the
  census over a session that reaches this)` at the write, so a port never runs on with stale code. A path
  the census's sessions never took may rewrite a byte the trace does not name; a longer session finds it.
- **A ROM byte the trace does not name.** A standalone port's ROM space holds only its module's `ROM`
  bytes (M2, from the census's sessions); any other ROM byte reads as `$00`, silently: a path the sessions
  never took that reads another ROM byte as data goes on with `$00`. The referee gives its port the same ROM
  space, so there the read stops the run at the first register or byte it changes, against emu's ROM.
- **A block reached from two routines** is translated in each, so its statements appear twice.
- What the runtime does not model (interrupts, the devices it lists).

## The referee

A port is proved the same program by running it beside `@fugloy/emu`: `test/referee.ts` (test code, since emu
is a devDependency) exports

```ts
const result = await referee({ cmd, model: 3, names, hints, trace, steps: check.steps });
// { ok: true, cycles, blocks, frames }
// { ok: false, report, at: { routine, block, cycles }, field }
```

`names` maps an address to a name or to every name there (`allNamesOf` in `test/helpers.ts` gives an
assembled program's own labels so): `port()` names each address by the first, and a `pcIn` step finds its
label among all of them, so a label that shares its address with another is found.

It boots emu on Fugløy's stub ROM, loads the program, ports it with `names` (and the
hint file's text in `hints`, if given), runs emu until its PC first equals `report.entryAddr` (at once, but
for a relocated program, whose loader runs first), and there gives the port's `Z` emu's registers and 64K,
but with every byte the `.CMD` loads, and every byte of the program's code and `DATA` at its run addresses,
put back as a standalone port has it: none of the code bytes (they read as `load` leaves them, 0 in RAM), and
`DATA` written by `load`. The program's code is the IR's code regions at the run addresses (from `prepare`
in `src/port.ts`, which `port()` is built on), less the loader's. That is set straight into the port's
memory before `load`, so the write guard `load` installs never fires on the referee's own set-up. `trace`
(M2), given to `port()` too, names the code bytes the program rewrites: `load` puts their initial values in,
emu may write them, and each is compared with the port's like any byte written. The port's ROM space (below
`$3800` on the Model III, `$3000` on the Model I) is not emu's either (Ruling 13): it is what `load` leaves in a
standalone port, the module's `ROM` (the trace's ROM reads, taken on the game stub ROM) and `$00` everywhere
else, and it is never compared (a write there is lost on both machines). A ROM byte the program reads that the
module does not carry, or carries with another value than emu's ROM holds, so reaches a register as
something else on the port, and the run stops there: on the user's ROM, where Sea Dragon's `$0003` is `$15`
and the module's `$00`, no register depends on it, and the sessions pass. Then
the port runs with `z.at` replaced. At each block start emu is stepped until its T-states reach the port's,
and there must be equal: the T-states, emu's PC and the block's address, every register, F, R, MEMPTR, the
interrupt state and Q, and every byte either machine wrote since the block before (outside the ROM space). At the first block start
of each frame (1/60 s of emu's `clockHz`) video RAM and the sound are compared, and at the end the 64K and the
sound, the keyboard as each reads it from the keys held; the one address range never compared is the Model I's Expansion Interface,
`$37E0`–`$37EF`, whose 40 Hz latch emu sets with time and which the runtime refuses to touch. For a relocated
program the end's compare also leaves out the bytes the loader left behind (what the `.CMD` loads that is
neither the program's code nor its `DATA` at its run addresses: the file's copy outside the run range, and
the loader), which are no part of the port; a read of one still differs at the next block start, and a
write to one is compared as any other.

`rom` (M2) chooses the ROM emu runs and with it the stand-ins `port()` is given: `'stub'`, the default,
Fugløy's stub and no stand-ins, as the Learn checks run; `'game'`, the game stub ROM (`test/game-rom.ts`'s
`gameStubRom(model)`: the stub's source with `@fugloy/runtime`'s `STANDINS_Z` appended, Fugløy's own Z80
for the stand-ins at the ROM's addresses, so emu runs a call to `$0060` through code that takes the ROM's
time), booted as the stub is, and the runtime's stand-ins; or a ROM's bytes, locally the user's, and the
stand-ins: emu boots it to BASIC's READY before the load (`bootToReady` in `test/helpers.ts`: ENTER at Cass?
and Memory Size?), as a user loads a program, and the program returns, if it does, to the word on the stack
at its entry. A game is refereed on `'game'` in CI, never on the user's ROM.

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
| `sound` | a write to port `$FF` that differs (M2): `sound: write N to port $FF since the last compare (of E on emu, P on the port): port $XX at T-state T, emu …`, at a frame's first block start or at the end |
| `code` | `self-modifying code: $XXXX written by the instruction at $YYYY (M1 does not translate it)`: emu wrote into a byte of the program's code that is not one of the trace's cells, by any instruction, whether or not the byte runs again. When the port's write guard refuses the write first, emu is stepped through the block to its own write, which this sentence names. |
| `refusal` | what the port refused as it ran, in the port's sentence; for a device, emu is stepped through the block to the same access, which names the instruction |
| `port` | `port()` refused the program: its sentences |
| `entry` | emu did not reach `report.entryAddr` within 10 million instructions of the load |
| `row N`, `cell $XXXX`, `pcIn` | a check step that does not hold, on either machine |

The sound (M2) is every write to port `$FF`, the cassette port, which is the machine's only sound: emu's
`m.sound` and the runtime's `z.sound` record each with its T-state and byte. At each compare the writes since
the last must be the same list on both, and both are emptied. emu's ring keeps the newest 65,536 and counts
what it drops; between two compares a program makes a few thousand writes at most, and if it ever dropped one
the compare would stop, not miss it. The boot's and the loader's writes, before the entry, are not compared.

## The trace and the census

What a program does that its bytes do not say, the code bytes it rewrites, code it reaches only through a
rewritten jump, the return addresses it drops and the ROM bytes it reads as data, is found by watching it run:
a **port trace**, a small JSON file ([`docs/port-trace-format.md`](../../docs/port-trace-format.md)). `src/trace.ts`
exports the `PortTrace` type, `parseTrace(text, programSha256)` (pure; a sentence for text that is not a
trace, another format version, or a trace taken of another program) and `formatTrace(trace)`, the file's
text. `port()` reads it as `opts.trace` (rewritten operands from M2 Task 4, swapped opcodes from Task 5,
dropped return addresses from Task 6; see *port*).

The census (`tools/census.ts`, which needs `@fugloy/emu`, so it lives in `tools/`, run with `tsx` and
typechecked with the tests, never in `src/`) plays a program's scripted sessions, each on a fresh machine from
the program's entry (after a relocated program's loader has moved it), and watches with `m.debug`: coverage
for the bytes that ran, a write hook for each byte written (and the return addresses each CALL pushes), and a
read hook for the `POP` that takes one off the stack and for the ROM bytes read as data.

```sh
pnpm census examples/sea-dragon/seadrg01.cmd --hints examples/sea-dragon/seadrg01.hints --model 3 --sessions sea-dragon -o examples/sea-dragon/seadrg01.trace.json
```

runs it on the game stub ROM (`test/game-rom.ts`) and writes the trace; the file is committed. Sea Dragon's
sessions are in `test/sessions/sea-dragon.ts`: `novice`, `expert` and `two-players`, each from the title
(`BY: Wayne`), ENTER, the number of players and each player's skill, then a repeating pattern of key chords
held 0.2 s each until `Game Over Player 1` (`Player 2`) and on until the title returns: 84,124,477,
57,536,697 and 131,821,072 T-states on the game stub ROM (two players: player 1 at Novice, player 2 at
Expert). `recordSession(rom, session)` plays one and
returns it as the referee's steps (each key pressed and released at the start of one of the port's blocks,
so the referee applies it at the same instruction; a `row` check at the title, each prompt and GAME OVER; a
last `run` to the session's end). Sea Dragon's trace: nine rewritten cells at eight sites (`$49C1`, `$4F41`,
`$509B`–`$509C`, `$5174`, `$525E`, `$5AD0`, `$5ADD`, `$5AEA`), nothing entered (`$50C1`–`$50E9`, which only the
rewritten `JP` at `$509A` reaches, ran in every game and was `entered` until the hint file's `entry` at
`$50C1` decoded it), one drop (`$4BAC POP AF`) and two ROM reads (`$0000`, `$0003`, which the port carries as `ROM`). What the census does not
see (a return address removed other than by `POP`, an address `POP`ped and pushed back, an interrupt's push)
is listed in the format's "What the census does not detect".

The census and the sessions both read the hint file: `entered` is what ran and is not code in the hinted IR,
and every key a session presses (and every row it checks) waits for the start of one of the IR's blocks. So a
change to `seadrg01.hints` that changes its code (as hinting `$50C1`–`$50E9` as code did: it emptied
`entered`, and its new block starts could have moved a key press and so a session's length, though here none
did) makes `census.test.ts`'s `entered` and staleness checks fail on purpose: update the `entered` assertion
and run `pnpm census` again to rewrite the trace.

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

`fugloy port <program.cmd> --model 1|3 [--hints <file>] [--trace <file>] [-o <dir>]` (`packages/cli`) writes
a port and its report from the command line.

## How it is checked

`test/referee.test.ts` runs the referee over the programs below on both models, and plants what it must
catch: an `add8` whose H is wrong (stopped in F at the block after the first ADD), a block's tick one T-state
or one R increment short (stopped in `cycles` or `r` at the next block), a byte written differently, a
store, a block move and a push into the program's code and a write into code that never runs again (each
refused as self-modifying), a program that reads its own code into a register and one into memory, a key
pressed by a step (the wait loop ends at the same T-state on both), the check steps (a `pcIn` on a label that
shares its address with another included), the refusals, and the steps it refuses to judge by (none with a
`run`, a malformed step, a `pcIn` label not given). M2 adds the sound, on both models: two writes to port
`$FF` pass; an OUT whose write is stamped one T-state late, another byte written, and a write too many are
each stopped in `sound` at the next frame, naming the write; and the ROM space (Ruling 13): a trace that says
`$0003` read `$55` (the stub holds `$00`) passes where the program only reads it and writes it back (`SET
0,(IX+3)`, Sea Dragon's `$5168`) and stops in A where it loads it; a program that loads `$0000`, which no trace
names, stops in A (port `$00`, emu `$F3`); a write to ROM is not compared; and a ROM read past the ROM refuses
the port. The `ok` result counts the writes to port `$FF` compared (`sounds`), 0 for Task 3's programs.

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

`test/relocate.test.ts` (M2) ports relocated programs: a body that runs at `$6000`, loaded at `$7000` behind
a mover, with a hint file of disasm's own skeleton plus its `relocate` and `entry` lines, ports from `$6000`
with its table in `DATA` at its run address and nothing in the file range, and passes the referee; the hint
file with no entry in the range, or two, is refused with a sentence. Sea Dragon with `seadrg01.hints` and the
Model III's stand-ins ports from `$497F` with 27 routines, none labelled, nothing refused, and its six
`CALL 0060H` (`$4EAC`, `$4EBC`, `$4EC6`, `$5512`, `$5F71`, `$6022`) on the runtime's `$DELAY`; without the
stand-ins those six are refused; with no hint file its 15 data regions are all `unknown`.

`test/standin.test.ts` (M2) holds the stand-in for `$DELAY` to the routine: a program calling `$0060` with BC
= 1, 2, 3, 256, 8192 and 0 (65,536 counts), writing to video RAM between the calls, and one with a CALL cc to
it taken and not taken, pass the referee on the game stub ROM and, locally when `fugloy.mcp.json` names a
Model III ROM, on that ROM (skipped otherwise); the stand-in run one count short is stopped in `cycles`; the
game stub is the plain stub but for the stand-in's ten bytes; `IN A,(00H)` reads as on emu; and a CALL to a
ROM address with no stand-in (`$0050`, or `$0060` on the Model I) is still refused and throws when it runs.

`test/census.test.ts` (M2) plays Sea Dragon's three sessions on the game stub ROM: each shows the title and
reaches its GAME OVER, `recordSession` gives the same steps twice, and the census, which plays the same
games to the same lengths, finds the eight rewritten sites with their writers (the opcode cells with their
two values each), nothing `entered`, the drop at `$4BAC` alone and the ROM reads of `$0000` (`$F3`) and
`$0003`; the committed `seadrg01.trace.json` must equal what the census writes now; `parseTrace` refuses a
trace of another program, another version, or lists out of order. It needs no ROM of the user's.

`test/patch.test.ts` (M2) ports programs that rewrite their own operands, each with a trace its census took
on the game stub ROM: a table summed through `LD A,(IX+d)` with d rewritten (-4 to -1) each time round, a `JP`
whose target is rewritten byte by byte between two blocks (one reached only through it, hinted as an
`entry`), an `ADD A,n` with its immediate rewritten beside a `LD HL,nn` with its low byte alone, a `LD HL,nn`
with its high byte alone, and a `JP` with its target's high byte alone. Each reads its cell (`z.mem[0x…]`)
where the operand was, carries the cells in `CELLS` and no other code byte, and passes the referee. The `JP`s'
cells given a third value throw naming the cell rewritten, the value and both targets; without the `entry`
hint the port is refused, naming the target. A cell two decoded instructions cover is refused, naming both. A
program that rewrites a byte only while ENTER is held, which its census never pressed, is refused by the
referee with M1's sentence and, run alone, throws the guard's sentence at the write. Sea Dragon with its hint
file and its trace's operand cells alone ports, 27 routines none labelled, its `JP` at `$509A` going to
`$509D` or `$50C1`.

`test/variant.test.ts` (M2) ports programs that swap an opcode, each taking the opcodes it writes from a data
table, with a trace its census took on the game stub ROM: `JP NZ` / `JP Z` (each taken and not taken), `LD
(HL),A` / `NOP`, and `CALL nn` / `RET` (the two bytes after the `RET` never run). Each is one `switch` on the
cell with a case per value and no `switch (b)`, carries the cell alone in `CELLS`, and passes the referee over
a session that runs both variants; a third value in the cell throws `o.variant`'s sentence. Sea Dragon with
its hint file and trace ports: nine cells at eight sites, a `switch` at each of `$5174`, `$525E` and `$5AEA`,
no routine labelled, nothing refused.

`test/unwind.test.ts` (M2) ports a title loop shaped like Sea Dragon's (a loop calls a routine that jumps into
another routine, whose `POP AF` drops the return address, carries on, and returns to the loop's caller),
with a trace its census took: its report lists the drop and the continuation, it passes the referee ten
thousand times round, and run alone the JavaScript stack is as deep at the continuation every time, as deep as
the routine whose caller it returns to; without the trace its `RET` throws `o.ret`'s sentence. Two `POP`s in
a row unwind two trampolines and continue after the second; a drop with no routine left throws as the port
runs, and three `POP`s that unwind past the top name the second, which took the entry's return address; a
drop where there is no `POP` refuses the port. A program that jumps back to an entry that reloads SP from
three calls deep, ten thousand times, passes the referee and runs the entry at the same depth each time; an
entry that touches the stack first gets no reset, nor one whose `LD SP,nn` operand the program rewrites with
the SP it saved (which then returns through the frame it saved, passing the referee). Sea Dragon's port lists its drop (`$4BAC`, continuing in
`SUB_4BAD`) and its three resets, with no routine labelled.

`test/sea-dragon.test.ts` (M2) is the milestone's proof: Sea Dragon (`seadrg01.cmd`, the Model III) with
its hint file and committed trace ports the same module twice (430,623 bytes, 28 routines, none labelled,
846 blocks over them, 110 of the 736 translated in more than one routine), with eight rewritten sites (nine
cells), one drop, the `$DELAY` stand-in at six sites, the two ROM bytes and nothing refused, and no byte of
the IR's code in `DATA`. Each of the three recorded games then passes the referee on the game stub ROM from
the title to GAME OVER and back to the title, every block start, frame and the end compared, the title,
prompt and GAME OVER rows checked on both machines:

| Session | T-states | Block starts | Frames | Refereed (s) |
|---|---:|---:|---:|---:|
| `novice` | 84,124,477 | 2,412,594 | 2,146 | 3.8 |
| `expert` | 57,536,697 | 1,278,453 | 1,358 | 2.4 |
| `two-players` | 131,821,072 | 2,268,787 | 2,212 | 5.3 |

about 22 to 25 million T-states a second (11 to 12 times the Model III's 2.03 MHz), on an Apple-silicon Mac,
the file alone; recording each session on emu first takes 0.8 to 3.9 s. An OUT stamped one T-state late is
stopped in `sound` at the first frame after the game's first write. Locally, when `fugloy.mcp.json` names a
Model III ROM, the same three games, recorded on that ROM booted to READY, pass on it too (94,494,841,
60,696,396 and 124,397,798 T-states there), with the module's `$0003` (`$00`) where the ROM holds `$15`: no
register depends on it. Each session compares its sound (`sounds` above 0). A module whose `$0000` is wrong
(`$00` for `$F3`) stops the Novice game at the first block where it shows (`cycles`, at `$5163`). The three
games are the paths the recorded sessions take, not every path through the game: a path they never take may
rewrite a byte or drop a return address the trace does not name, and the port then stops with a sentence, or
read a ROM byte the trace does not name, which a standalone port reads as `$00` without stopping (see *What it
does not model*).

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
