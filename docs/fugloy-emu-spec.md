# TRS-80 Emulator Core Spec — `@fugloy/emu`

*Draft v0.1 · 2026-10-14 · Christopher Schweda*

## 1. Purpose and scope

`@fugloy/emu` is a headless, deterministic TRS-80 Model I/III/4 emulator core in plain JavaScript. It runs identically in Node and the browser and exposes everything a debugger needs. It serves three consumers:

| Consumer | What it needs from the core |
|---|---|
| `@fugloy/mcp` | Run and inspect real binaries from Claude Code |
| Fugløy disassembler | Runtime code/data coverage and discovered labels for the second pass |
| app.fugloy.dev workbench | Visible emulation for humans (rendering lives in the workbench) |

**In scope**

- Z80 CPU with cycle counts; documented instructions plus the commonly used undocumented ones
- Model I, III, 4 memory maps, ROMs, I/O ports
- Text video RAM, keyboard matrix, cassette, floppy (JV1/JV3/DMK read, DMK write)
- Loaders for `.CMD`, `.BAS`, `.CAS`, disk images
- Debugger API: breakpoints, watchpoints, trace, coverage, snapshots

**Out of scope**

- Rendering, audio output, DOM access (workbench)
- Model 4P, II/12/16, Model 100 (separate cores later, if ever)
- The MCP protocol layer (`@fugloy/mcp` wraps this)
- Recompilation to JS (Fugløy's job; the core supplies ground truth)

The existing `cschweda/trs80-emulator`, the author's own MIT code, became `packages/emu` in phase 0, from commit `11612849` (v1.6.0). It is not derived from trsjs.48k.ca: Peter Phillips's site supplied some of its sample games, not code. Successor, not rewrite.

## 2. Design principles

1. **Zero DOM.** No `window`, `document`, `requestAnimationFrame`, `AudioContext`. The core imports nothing from the platform. Verified by a CI step that loads the package inside `node:vm` with an empty context object; any reference to a browser global throws.
2. **Deterministic.** Same inputs, same state, every time. All timing is cycle-based, never wall-clock. Keyboard and cassette input are queued with cycle timestamps. No `Math.random()` unless seeded.
3. **Inspectable.** Every register, every byte, every I/O port, every pending interrupt is readable at any instruction boundary. State is a plain object you can serialize.
4. **Observable.** Memory and port access emit hooks the debugger subscribes to. Hooks are cheap when nobody is listening (null check, not an event emitter).
   Sound is a special case: Model I/III games make noise by toggling cassette port `FF` bits 0–1. The core produces no audio, but it records every port `FF` write with its cycle timestamp in a ring buffer so the workbench can synthesize sound later and the debugger can see it. Without this, half the arcade ports look silent and some timing loops look pointless.
5. **One build, two hosts.** ESM only. Typed arrays for memory. No Node-specific APIs in the core; file I/O happens in the caller.
6. **Correct before fast.** Pass ZEXALL first. Optimize only with a benchmark in hand.

## 3. Package layout and public API

```
fugloy/
  packages/
    emu/
      src/
        cpu/        z80.js, decode.js, tables.js, flags.js
        machine/    model1.js, model3.js, model4.js, bus.js
        devices/    video.js, keyboard.js, cassette.js, fdc.js, rtc.js
        loaders/    cmd.js, bas.js, cas.js, dsk.js
        debug/      breakpoints.js, trace.js, coverage.js, snapshot.js
        index.js
      test/
      roms/         (gitignored; paths supplied by caller)
    mcp/            stdio server, depends on emu
    disasm/         reads labels + coverage
  apps/
    workbench/      app.fugloy.dev, depends on emu + disasm
```

Phase 0 kept upstream's file names inside these folders (`cpu/z80cpu.js`, `machine/{memory,io,trs80-system}.js`, `devices/…`, `loaders/{cas-format,cmd-format}.js`, `debug/state.js`); phase 1 may split the CPU into the files named above.

### Public API (sketch)

```js
import { Machine } from '@fugloy/emu'

const m = new Machine({ model: 3, ram: 48, roms: { level2: romBytes } })

// execution
m.reset()
m.step(n = 1)            // n instructions → { cycles, stopped? }
m.run({ cycles, until })  // until = 'break' | 'halt' | predicate(m)
                          // → { reason: 'cycles'|'break'|'halt'|'watch'|'predicate', cycles, id? }
m.cycles                  // total cycles since reset
m.sound.events(sinceCycle) // [{ cycle, value }] port FF writes, see §2.4

// state
m.cpu.regs                // { a, f, b, c, d, e, h, l, a2, f2, ..., ix, iy, sp, pc, i, r, iff1, iff2, im }
m.cpu.flags               // { s, z, h, pv, n, c } decoded
m.mem.read(addr, len)     // Uint8Array copy
m.mem.write(addr, bytes)
m.mem.ram                 // live Uint8Array (for fast paths)
m.io.in(port) / m.io.out(port, val)

// devices
m.video.text()            // 16 lines of 64 chars, string[]
m.video.raw               // Uint8Array view of 0x3C00..0x3FFF
m.keyboard.type(str, { cps })
m.keyboard.press(key) / release(key)
m.cassette.load(bytes) / m.cassette.motor
m.fdc.mount(drive, image) / unmount(drive)

// loaders
m.load.cmd(bytes)         // → { entry, blocks: [{ addr, len }] }
m.load.bas(bytes)         // tokenized or ASCII; → { start, end }
m.load.cas(bytes)
m.load.dsk(bytes)         // → mounted image handle

// debug
m.debug.break(addr, { once })
m.debug.watch(addr, len, { read, write })
m.debug.trace.enable({ depth })
m.debug.trace.last(n)     // [{ pc, op, text, regs? }]
m.debug.coverage          // see §8
m.debug.snapshot() / restore(snap)
m.debug.callers(addr)
m.debug.hooks.onMemRead = (addr, val) => {}
m.debug.hooks.onMemWrite = (addr, val, prev) => {}
m.debug.hooks.onPort = (port, val, dir) => {}
```

Everything on `m.debug` is optional and costs nothing when unused.

## 4. CPU

| Requirement | Detail |
|---|---|
| Instruction set | All documented Z80 ops; undocumented `SLL`, `IX/IY` half-register ops, `OUT (C),0`, duplicate `ED` NOPs |
| Flags | Full S Z H P/V N C including the undocumented bits 3 and 5 (ZEXALL checks them) |
| Timing | Per-instruction T-states from the Zaks/Young tables; conditional branch taken/not-taken counted correctly |
| Interrupts | IM 0/1/2, NMI, `EI` one-instruction delay, `HALT` wakes on interrupt |
| R register | Increments per M1 cycle (some copy protection reads it) |
| Memory refresh | Not modeled |
| Decode | Unprefixed opcodes from a 256-entry array of handlers; `CB`, `ED`, `DD`/`FD`, and `DDCB`/`FDCB` through switch statements. Sub-tables wait for a benchmark that needs them (§2.6): phase 1 measured about 114 MHz effective in Node, nearly 3× the target below |

Target speed: ≥ 20× real time (≈ 40 MHz effective) in Node on a laptop. That makes a 2-minute game session a 6-second trace run.

Phase 1 also models:

- **MEMPTR,** the hidden address latch that `BIT n,(HL)` shows in flags 3 and 5, by boo_boo and Vladimir Kladov's rules ("MEMPTR, esoteric register of the ZiLOG Z80 CPU"). Save states keep it.
- **Lone prefixes.** A `DD` or `FD` before another prefix or `ED` runs as a 4-T-state step, with no maskable interrupt taken after it.
- **The block I/O flags** of Young's §4.3.

Not modeled, and invisible to ZEXALL:

- `SCF` and `CCF` taking flags 3 and 5 from the previous instruction's flags (Patrik Rak's z80test);
- the flags of a repeating block instruction interrupted mid-run;
- IM 0 with a bus byte other than `FFH` (the Model III's bus reads `FFH`);
- an NMI held off after a lone prefix, as a maskable interrupt is (Young §3.6). The Model III's NMI is the disk controller's, so this waits for phase 5, which must also keep the NMI edge pending in `TRS80System` until the core accepts it.

## 5. Machine models

| | Model I | Model III | Model 4 |
|---|---|---|---|
| Clock | 1.774 MHz | 2.027 MHz | 4.055 MHz (2.027 in III mode) |
| ROM | 12 KB Level II at `0000–2FFF` | 14 KB at `0000–37FF` | 14 KB, bankable out |
| Keyboard | `3800–3BFF` matrix | `3800–3BFF` | `3800–3BFF` in memory maps 0–1; absent from maps 2–3 |
| Video | `3C00–3FFF`, 64×16, lowercase mod optional | `3C00–3FFF`, lowercase | `3C00–3FFF` (maps 0–1) or `F800–FFFF` (maps 2–3); 64×16 or 80×24 via port `EC` bit 2 and port `84` bit 2 |
| RAM | 4/16/32/48 KB from `4000` | 16/32/48 KB | 64/128 KB; memory map select port `84` bits 0–1; 128 KB page select bits 4–5 |
| Cassette / sound | Port `FF` bits 0–1 out, bit 7 in; 500 baud | Port `FF`; 500/1500 baud | Port `FF` (Model III mode only) |
| FDC | WD1771: command/status `37EC`, track `37ED`, sector `37EE`, data `37EF`; drive select `37E1`; interrupt latch `37E0` (expansion interface) | WD1793 at ports `F0–F3`; drive select/density port `F4`; NMI status `E4` | Same as Model III |
| Timer | 40 Hz via expansion interface, status at `37E0` | 30 Hz; interrupt latch port `E0`, mask `E0` | 30 Hz or 60 Hz (port `EC` bit 6) |
| Printer | `37E8` | Port `F8` | Port `F8` |

Values above are from memory and should be checked against the Model I/III/4 technical reference manuals before implementation; the memory-map and port numbers are the kind of detail that is easy to get one bit wrong. Treat this table as a checklist of what to verify, not as the reference.

Phase 1 targets Model III. Model I follows (mostly address-mapped I/O instead of ports). Model 4 last (four memory maps, 80-column mode, Model III compatibility mode).

ROMs are not bundled. The caller supplies bytes; the core validates by length and a known-hash table and reports which ROM it recognizes.

## 6. Loaders

| Format | Notes |
|---|---|
| `.CMD` | TRSDOS load module: records `01` (data: len, addr, bytes), `02` (transfer address), `05` (name), `07` (patch), `10/1F` (comments/ignored). Returns entry point and block list; blocks become coverage seeds. |
| `.BAS` | Detect tokenized (first byte `FF`) vs ASCII. Tokenized: copy to the BASIC program area and fix the start/end pointers (`40A4`/`40F9`). ASCII: do **not** type it through the keyboard — a 10 KB listing at a ROM-safe rate takes minutes of emulated time and the ROM's line editor may mangle it. Instead, hook the ROM's keyboard-scan entry (`002B`/`0049`) and feed characters directly from a buffer, bypassing the matrix. Same mechanism serves the MCP `key` tool. |
| `.CAS` | Raw cassette image: `A5` sync, SYSTEM header (`55` + name) or BASIC header (`D3 D3 D3`). Deliver via the cassette device so the ROM loader runs for real. |
| `.DSK` / JV1 / JV3 / DMK | Mount into FDC. JV1 = raw 10-sector tracks; JV3 = sector header table; DMK = raw track with IDAM pointers. Read all three; write DMK only. |

Each loader returns a manifest the debugger records: where bytes landed and why. That manifest is the first entry in the coverage file.

## 7. Debugger interface

- **Breakpoints:** by PC; optional `once`; optional condition `(m) => bool`. Hit returns control from `run()` with reason `'break'` and the breakpoint id.
- **Watchpoints:** address range, read and/or write; hit log records `{ cycle, pc, addr, value, prev }`. Watches do not stop execution unless `stop: true`.
- **Trace:** ring buffer of the last N executed instructions `{ pc, opcode bytes, mnemonic, cycles }`; optional register snapshot per entry. Loop collapsing: consecutive identical PC sequences are reported once with a repeat count. A `run()` with trace on and no depth limit is refused.
- **Coverage:** per-byte bitfield across 64 KB (and per bank on Model 4): `EXEC` (fetched as opcode), `OPERAND` (fetched as instruction operand), `READ`, `WRITE`, `JUMP_TARGET`, `CALL_TARGET`. This is the single most valuable output for Fugløy — it separates code from data by observation.
- **Callers:** map of target → set of `{ fromPc, kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to' }` built from the trace hook.
- **Snapshots:** full machine state (CPU, RAM, device state, cycle count) as a serializable object; restore is exact. Used for differential testing (§10) and for "try this input, rewind." A snapshot does **not** include the trace ring, hit log, or coverage; those are debugger state, not machine state, and survive a restore. Document this; it will surprise someone.
- **Screen diff:** `m.video.diff(sinceSnapshot)` returns changed cells; cheap way to detect "something printed."

## 8. Label and coverage file format

Shared contract between `emu`, `mcp`, and `disasm`. JSON, one file per program, versioned.

```json
{
  "fugloy": 1,
  "program": { "name": "DEFENDER/CMD", "sha256": "…", "model": 3 },
  "load": [ { "addr": 20480, "len": 8192, "source": "cmd-block-0" } ],
  "entry": 20480,
  "labels": [
    { "addr": 20480, "name": "ENTRY", "kind": "code", "source": "loader" },
    { "addr": 20584, "name": "PRINT_STR", "kind": "code", "source": "observed", "evidence": "writes 3C00-3FFF, called 212×" },
    { "addr": 28000, "name": "SCORE", "kind": "data", "size": 2, "source": "user" }
  ],
  "coverage": {
    "encoding": "rle-hex",
    "exec": "…", "operand": "…", "read": "…", "write": "…"
  },
  "callers": { "20584": [ { "from": 20500, "kind": "call" } ] },
  "sessions": [ { "started": "2026-10-14T14:02:00Z", "cycles": 48201339, "input": "keyboard: 'RUN\\r', 'A' …" } ]
}
```

Rules: `source` is always one of `loader | observed | user | disasm`; the disassembler never overwrites a `user` label; `observed` labels carry `evidence` so a human can judge them.

Coverage bitfields are over the 64 KB address space. On Model 4 with 128 KB, the file carries one coverage object per `(map, page)` combination seen, keyed `"coverage": { "0:0": {…}, "2:1": {…} }`; Model I/III use the single key `"0:0"`. Addresses in `labels`, `load` and `callers` are likewise `{ addr, map?, page? }` with map/page omitted when zero. Decide this now or every consumer grows a special case later.

Merging rule for `coverage export`: union of bitfields per key; `labels` merged by address with `user` winning over `observed` winning over `disasm` winning over `loader`; `sessions` appended, never rewritten.

## 9. MCP server tool list

`@fugloy/mcp` exposes these over stdio. Addresses accept hex (`"5200"`, `"0x5200"`) or decimal. Byte output is hex dump text, not JSON arrays.

| Tool | Purpose |
|---|---|
| `load` | Load a `.CMD`/`.BAS`/`.CAS`/disk image; returns manifest and entry |
| `reset` | Cold reset, optionally keeping RAM |
| `run` | Run for N cycles or until break/halt/screen-change |
| `step` | Execute N instructions; returns trace of those N |
| `regs` | All registers, flags decoded |
| `peek` / `poke` | Memory read/write |
| `disasm` | Disassemble N instructions at addr (uses `disasm` package, applies known labels) |
| `break` / `unbreak` | Manage breakpoints |
| `watch` / `unwatch` | Manage watchpoints; `hits` returns the log |
| `trace` | Last N executed instructions, loops collapsed |
| `screen` | 64×16 text; optional `diff` since last call |
| `key` | Inject a string or key events |
| `callers` | Who jumps/calls to this address |
| `coverage` | Summary (code vs data ranges) or export the §8 file |
| `label` | Add/rename a label with `source: "user"` |
| `snapshot` / `restore` | Named save states |

Guardrails: `trace` and `peek` cap at 4 KB of output per call; `run` caps at 10 s of emulated time per call; the server refuses to run with tracing on and no depth limit.

## 10. Testing strategy

| Layer | Test | Pass criterion |
|---|---|---|
| CPU | ZEXALL and ZEXDOC via a CP/M BDOS shim | All 67 test groups OK, including undocumented flags |
| CPU | Per-instruction timing table vs. a known-good reference | Zero deviations |
| Machine | Boot Level II ROM to `READY` prompt | Screen matches golden text within N cycles |
| Machine | Boot TRSDOS 1.3 from a DMK image | `TRSDOS Ready` on screen |
| Loaders | Fixture `.CMD`/`.BAS`/`.CAS` files (gitignored `fixtures/real/`) | Manifest matches recorded expectation |
| Debugger | Scripted session: load, break, watch, type, check screen | Deterministic hit log, byte-identical across runs |
| Differential | Run a program in `emu` and the same program in trs80gp or sdltrs via its own trace; compare PC+regs per instruction | Zero divergence over the session (this test is also the Fugløy verification harness, pointed at the recompiled JS instead) |
| Determinism | Run the same scripted session twice; compare final snapshots | Byte-identical |

The exercisers are GPL-2.0 and never committed. `pnpm zex:install` fetches them, pinned and hash-checked, into `tools/zex/`. `FUGLOY_ZEX=1` runs them as one Vitest test per group, and `.github/workflows/exerciser.yml` runs them in CI when `packages/emu` changes, and weekly. The timing check is `packages/emu/test/unit/cpu-timing.test.js`, against `@fugloy/z80`'s table.

## 11. Phased build plan

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Extract `cschweda/trs80-emulator` into `packages/emu`; strip DOM; ESM; test runner | Boots to `READY` in Node with no DOM stubs |
| 1 | Z80 core hardened | ZEXALL passes |
| 2 | Model III devices + `.CMD`/`.BAS`/`.CAS` loaders | Three real programs run to a recognizable screen |
| 3 | Debugger API + coverage + §8 file format | A scripted session produces a label file Fugløy's disassembler consumes |
| 4 | `@fugloy/mcp` v0.1 | Claude Code can load a game, find its print routine, and label it unaided |
| 5 | FDC + disk images | TRSDOS boots; a disk-based game runs |
| 6 | Model I, then Model 4 | Each model's ROM boots and its fixture programs run |
| 7 | Differential harness against an external emulator | Zero divergence on all fixtures |

Phases 0–4 are the minimum for the MCP server to be useful. Phase 7 is what makes Fugløy's "runs identically" claim defensible.

## 12. Open questions

- [ ] Which external emulator is the differential reference — trs80gp (closed, very accurate, has a trace mode) or sdltrs (open, patchable)?
- [ ] Video RAM access timing: the Model I shows "snow" on CPU access during display and the Model III/4 insert wait states. Model neither in v1 (timing error only matters for cycle-exact demos), but record the decision so the differential harness can exclude it.
- [ ] Does the §8 `(map, page)` keying hold up once Model 4 is real, or should coverage be over physical RAM addresses with a map table?
- [ ] Is the keyboard-hook injection (§6) safe for programs that replace the ROM keyboard routine with their own matrix scan? Likely needs a fallback to real matrix injection with a `mode` switch.
- [x] License for `packages/emu`: the code is the author's own MIT (upstream `LICENSE`); trsjs.48k.ca supplied only sample games, which stayed upstream. `packages/emu/NOTICE.md` carries the upstream notice.
- [ ] Is WebAssembly worth it for the CPU core once correct, or is JIT'd JS fast enough for 20× real time?
- [ ] Several cores in one process run about 4× slower each (measured in phase 1: ZEXALL's `bit n` group takes 8 s on a process's first `Z80CPU` and 33 s on its fourth). `makeRegisterFile` gives every instance its own accessor closures, so every register file gets its own hidden class and the hot paths go megamorphic: 114 MHz becomes about 28 MHz, under the target in §4. The MCP server's sessions and snapshots and the differential harness will run several cores per process. Fix with a benchmark in hand (§2.6): accessors shared on a prototype, or a `Uint8Array` register file. The exerciser harness reuses one core in the meantime.

## 13. User stories for `@fugloy/mcp`

Grouped by who is driving. Each story names the tools it exercises; a story that can't be told with the §9 tool list means the list is missing something.

### Reverse engineer (Chris, with Claude Code)

1. **Find the print routine.** As a reverse engineer, I load a `.CMD`, run to the title screen, set a write-watch on `3C00–3FFF`, and ask who wrote there, so I can label the game's output routine without reading 8 KB of hex. *(load, run, screen, watch, callers, label)*
2. **Locate game variables.** I take a snapshot, play one move via `key`, diff the snapshot, and get the short list of RAM bytes that changed, so I can name the score, lives and position variables. *(snapshot, key, run, peek, label)*
3. **Separate code from data.** After a ten-minute scripted play session, I export coverage and see which bytes were ever executed versus only read, so Fugløy's disassembler stops decoding sprite tables as instructions. *(run, key, coverage)*
4. **Resolve a computed jump.** I break at a `JP (HL)` and log HL across many hits, so I recover the jump table's targets by observation rather than guesswork. *(break, run, regs, trace)*
5. **Trace a crash.** A recompiled game diverges from the original at some point; I run both with instruction traces and find the first instruction where registers differ. *(step, regs, snapshot — plus the Fugløy harness)*
6. **Understand self-modifying code.** I set a write-watch on a code range and see which instruction patches it and with what, so the recompiler can special-case that block. *(watch, trace, disasm)*

### Claude Code acting autonomously

7. **Label a whole program unaided.** Given only a `.CMD` and a goal ("label every subroutine called more than 5 times"), the agent loads, plays by sending plausible keys, reads `callers`, and writes labels with evidence strings, so the human reviews a draft instead of starting from zero. *(all of §9)*
8. **Explain what a routine does.** Asked "what does `5A3C` do?", the agent breaks there, steps 200 instructions, watches memory and the screen, and answers in prose with the trace as evidence. *(break, step, screen, peek, disasm)*
9. **Reproduce a bug report.** Given "the game hangs after level 3", the agent plays to level 3 via scripted keys, detects a tight loop in `trace`, and reports the loop's address and the condition it's spinning on. *(key, run, trace, regs)*

### Z80 developer writing new code

10. **Test a routine in isolation.** I poke a hand-assembled routine into RAM, set registers, step through it, and check results, so I have a REPL-style scratchpad without building a full program. *(poke, regs, step, peek)*
11. **Check cycle counts.** I run a routine between two breakpoints and read the cycle delta, so I can tune a timing loop for the cassette or the 60 Hz interrupt. *(break, run, regs)*

### Preservation and documentation

12. **Capture a walkthrough.** I script a full play session and save `screen` output at each prompt, so I have a text transcript of a game for a wiki or an accessible version. *(key, run, screen)*
13. **Verify an archive file.** I load each `.CAS` in a collection and confirm the ROM loader reaches a `READY` or `SYSTEM` prompt, so I can flag corrupt dumps in bulk. *(load, run, screen)*

### Accessibility bridge (future, feeds project #1)

14. **Read the screen aloud.** As a blind user of a text game, I want each `screen` diff turned into an announcement rather than a canvas repaint, so I can play on real emulated hardware. The MCP server isn't the product here, but `screen.diff` is the primitive it proves out. *(screen diff)*

Stories 1, 3, 4 and 7 define the Phase 4 acceptance test. If the agent can do story 7 on three fixture games with no human help, the server ships.
