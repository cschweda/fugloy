# Fugløy port trace format

What an emulator session saw a program do that the recompiler cannot work out from its bytes: the code bytes it rewrites, the code it runs that the disassembly does not reach, the return addresses it drops, and the ROM bytes it reads as data. `@fugloy/recomp`'s census (`packages/recomp/tools/census.ts`, which needs `@fugloy/emu`) writes one; `port()` reads it (milestone M2: `docs/superpowers/plans/2026-11-13-part2-m2-sea-dragon-port.md`). `parseTrace(text, programSha256)` and the `PortTrace` type are in `packages/recomp/src/trace.ts`, and `formatTrace` writes the text below.

```json
{
  "fugloy-trace": 1,
  "program": {"name":"seadrg01.cmd","sha256":"…"},
  "model": 3,
  "rom": "stub",
  "sessions": [
    {"name":"novice","cycles":84124477}
  ],
  "patches": [
    {"addr":20635,"writers":[19712,19770],"values":[157,193]}
  ],
  "entered": [
    [20673,20713]
  ],
  "drops": [
    {"at":19372,"count":3}
  ],
  "romReads": [
    {"addr":0,"value":243}
  ]
}
```

The example elides `sha256` (`…`) and most of each list; `examples/sea-dragon/seadrg01.trace.json` is a complete file.

- **Keys.** All nine top-level keys are required. Addresses are JSON numbers (decimal), 0 to 65,535, as in the [label file](label-format.md); bytes are 0 to 255. A reader ignores keys it does not know.
- **`fugloy-trace`** is the format version, `1`. A reader refuses any other.
- **`program`**: `name`, the program's file name, a non-empty string; `sha256`, the SHA-256 of the file's bytes, 64 lowercase hex digits. The trace is keyed by address, so a reader refuses a trace whose `sha256` is not the program's it is given.
- **`model`**: `1` or `3`, the machine the sessions ran on (M2: `3`).
- **`rom`**: `"stub"`, Fugløy's game stub ROM (its stub with `@fugloy/runtime`'s stand-ins for the ROM routines it models, `packages/recomp/test/game-rom.ts`), or `"user"`, the user's ROM. A committed trace is taken on the stub, so CI can take it again and check it is not stale, and the ROM bytes it carries are Fugløy's own.
- **`sessions`**: one `{ name, cycles }` per session, in the order they ran: `cycles` is the session's length in T-states from the program's entry.
- **`patches`**: one `{ addr, writers, values }` per code byte the program wrote after its entry: `writers`, the address of each instruction that wrote it, and `values`, every value written, each list sorted and without repeats. A code byte is one in a code region of the hinted IR (at the addresses the program runs at; a relocated program's loader left out) or one that ran in a session; the ROM's space (`$0000`–`$37FF` on the Model III, `$0000`–`$2FFF` on the Model I) is never one.
- **`entered`**: `[first, last]` (inclusive) for each run of bytes that ran in a session (an instruction's opcode and its operands) and are not code in the hinted IR, the ROM's space left out.
- **`drops`**: one `{ at, count }` per `POP` (of any register pair) that took off the stack a return address a `CALL` or `RST` pushed and that nothing had returned to or written over: `at` is the `POP`'s address, `count` (1 or more) how many times it did.
- **`romReads`**: one `{ addr, value }` per address in the ROM's space that one of the program's own instructions read as data (not an instruction fetch, and not the ROM's own code running), with the byte read.

The sessions start at the program's entry (for a relocated program, the first time the PC reaches the hint file's entry, after the loader has moved it there: the loader's copy is not a write into code), so nothing before it is in the trace.

**Order.** `sessions` is in the order the sessions ran; `patches` by `addr`, `entered` by `first` (the ranges do not overlap), `drops` by `at`, `romReads` by `addr`, each strictly ascending. The census writes the keys in the order above, one list element a line, so the same sessions give the same file byte for byte.

**What a reader refuses**, each with a sentence: text that is not JSON or not an object; a `fugloy-trace` other than `1`; a `program` whose `sha256` is not the program's given; a key missing or of the wrong shape (an address or a byte out of range, an empty `writers` or `values`, a `count` below 1, a range whose `first` is past its `last`); and a list out of order, with an address twice, or ranges that overlap.

`pnpm census <program.cmd> --hints <file> --model 3 --sessions sea-dragon -o <trace.json>` takes a census on the game stub ROM and writes the file; M2 knows one set of sessions, Sea Dragon's (`packages/recomp/test/sessions/sea-dragon.ts`).
