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

### Public API

Emu phases 2 and 3 built the part below marked **built**; the rest (marked **phase 5 and later**) is still the sketch, and nothing in it is promised to the letter until it is built.

```js
import { Machine, ROM_HASHES } from '@fugloy/emu'                     // built

const m = new Machine({ model: 3, ram: 48, roms: { level2: romBytes }, log })   // built
```

`model` is 3 and `ram` is 48: anything else throws, naming the phase that will add it. `roms.level2` is the ROM image as a `Uint8Array`. `log` is an optional `(level, text) => void`; without it the core is silent. The caller supplies the ROM; nothing is bundled.

**Execution (built)**

```js
m.reset()                  // CPU to $0000 and cycles to 0; RAM kept; clears m.sound and m.keyboard
m.step(n = 1)              // n whole instructions → { cycles, halted }; breakpoints and watch stops are ignored
m.run({ cycles, until })   // until = 'halt' | predicate(m)
                           //   → { reason: 'cycles' | 'halt' | 'predicate', cycles } | { reason: 'break' | 'watch', id, cycles }
m.cycles                   // total T-states since reset
```

- `step` and `run` return the T-states they spent (`cycles`), not the total. An interrupt response counts with the instruction after it.
- `run` needs `cycles`, `until`, or both; with neither it throws, since it would never stop. It executes at least one instruction (`run({ cycles: 0 })` runs one), with one exception: a breakpoint at its first boundary that it did not just stop at returns `{ reason: 'break', id, cycles: 0 }` (plus the T-states of an interrupt response delivered at that boundary) without executing anything (§7).
- Both limits are checked after each instruction, so `until` is not checked before the first one. When the `until` condition (`'halt'` or the predicate) and the cycle budget are both met at the same boundary, the condition wins and `reason` is `'halt'` or `'predicate'`.
- `'break'` and `'watch'` come from the debugger (§7); `id` names the breakpoint or the watch. A breakpoint stops before its instruction; after an instruction the order is a watch stop, then `until`, then the budget.
- `step` and `run` cannot be called from inside a `when`, `until`, or hook callback: they throw.
- `m.rom` is `{ bytes, sha256, recognized }`: the image's length, its SHA-256 as hex, and the name of the known ROM it matches or `null`. `ROM_HASHES` is the table behind it, `{ sha256: name }`. It includes the FreHD-patched Model III Rev C image, labelled as patched.

**State (built)**

```js
m.cpu.regs                 // { a, f, b, c, d, e, h, l, a2, f2, b2, c2, d2, e2, h2, l2, ix, iy, sp, pc, i, r, iff1, iff2, im }
m.cpu.flags                // { s, z, h, pv, n, c } decoded from F
m.mem.read(addr, len)      // Uint8Array copy; addresses wrap at 64K
m.mem.write(addr, bytes)
m.mem.ram                  // live Uint8Array
m.io.in(port) / m.io.out(port, val)
m.system                   // the wrapped TRS80System: an escape hatch to the devices, outside the stable API
```

**Devices (built)**

```js
m.video.text()             // 16 lines, string[]: 64 columns, or 32 in 32-column mode (port $EC bit 2)
m.video.raw                // live Uint8Array view of $3C00..$3FFF
m.video.columns            // 64 | 32

m.sound.events(sinceCycle = -1)  // [{ cycle, value }] every port $FF write after that cycle, oldest first
m.sound.overflowed         // events lost to wrap-around of the 65,536-event ring since the last clear
m.sound.clear()            // also done by m.reset() and by restoring a saved state

m.keyboard.press(key) / release(key)   // hold a key now / let it go
m.keyboard.type(str, { cps = 10, mode = 'matrix' })  // cycle-timed typing through the matrix, or the §6 hook ('hook'); str is a string, or an array of keys (a character or a key name each: ['A', 'ENTER'])
m.keyboard.feed(str)       // characters for the ROM keyboard-scan hook (§6); '\n' = ENTER; all-or-nothing
m.keyboard.pending         // queued events not yet delivered
m.cassette.insert(bytes, { baud }) / rewind() / motor
```

- `video.text()` shows bytes below `$20` as `+$40` (the character generator folds them), and `$80`–`$FF` (graphics and the special set) as `.`; see footnote 1 in §5.
- `sound.events` returns a copy and allocates one object per event, up to 65,536 per call: fine for a tool call, not for a per-frame loop. The ring keeps the newest events.
- Keys are a character (`'A'`, `'1'`, `' '`) or a name: `ENTER CLEAR BREAK UP DOWN LEFT RIGHT SHIFT SPACE`. `type` given an array types each element as one key, so `type(['ENTER'])` presses ENTER while `type('ENTER')` types five letters; in hook mode every element must be a character. On the Model III an unshifted letter key types the capital, so `'A'` presses the bare A key and `'a'` presses SHIFT+A. `press` and `release` must use the same name; a mismatch leaves the key down.
- In matrix mode `type` presses each character for half of a `1/cps`-second window and releases it for the other half, starting now or when the typing already queued ends. A program that reads the keyboard slowly can miss a short tap: **Rear Guard needs ENTER held about 0.5 s** (`type('\n', { cps: 1 })`). A high `cps` shortens the hold and can drop keys, and typing at the ROM's line editor with no pause for ENTER can lose characters.
- The key queue is not machine state: `serializeState` does not carry it, and `m.debug.restore` clears it (§7).

**Loaders (built)**

```js
m.load.cmd(bytes)          // → { format: 'cmd', name, entry, blocks: [{ addr, len, why }] }; PC at the entry (§6)
m.load.bas(bytes)          // tokenized or ASCII (§6) → { format: 'bas', kind, start, end, blocks }
m.load.cas(bytes, { baud = 500, via = 'rom' })   // → { format: 'cas', kind, name, entry?, blocks, baud, via } (§6)
```

Every loader returns a manifest of where the bytes landed and why (§6), and records it with the SHA-256 of the bytes it was given in `m.debug.loaded` for the label file (§8); the last load wins. `m.load.cmd` and `m.load.cas` with `via: 'fast'` also clear the keyboard queue (the feed buffer and queued matrix keys, queued keys released), so text typed for the previous program does not reach the new one; `via: 'rom'` leaves it, since the caller types `CLOAD` or `SYSTEM` next. `baud` is ignored via `'fast'`. `m.load.bas`: for a tokenized program, `start` and `end` are the program area (`$40A4`) and its end, and `blocks` holds one `{ addr: start, len, why: 'BASIC program' }`; for ASCII, `start` is the current `$40A4` pointer, `end` is `null`, and `blocks` is empty, because the text is typed by BASIC as the machine runs. `m.load.cas` with `via: 'rom'` marks every block `predicted: true`: nothing has landed yet. `m.load.dsk` is phase 5.

**Debugger (built, phase 3)**

```js
import { COVERAGE, encodeRle, decodeRle, parseLabelFile, mergeLabelFiles } from '@fugloy/emu'

m.debug.break(addr, { once = false, when })   // → id; stop before the instruction at addr; when(m) gates each hit
m.debug.unbreak(id)                           // → false when no breakpoint has that id
m.debug.breaks                                // [{ id, addr, once, hits }], in id order
m.debug.watch(addr, len, { read = false, write = true, stop = false })   // → id; len bytes from addr, wrapping at $FFFF
m.debug.unwatch(id)                           // its hits stay in the log
m.debug.watches                               // [{ id, addr, len, read, write, stop, hits }]
m.debug.hits(id?)                             // [{ id, kind: 'read' | 'write', cycle, pc, addr, value, prev }], oldest first
m.debug.hitsOverflowed / m.debug.clearHits()  // the log keeps the newest 65,536 hits
m.debug.hooks.onMemRead = (addr, val, pc) => {}   // data reads only; a function or null
m.debug.hooks.onMemWrite = (addr, val, prev, pc) => {}
m.debug.hooks.onPort = (port, val, dir, pc) => {} // dir 'in' | 'out'; pc: the instruction making the access

m.debug.coverage.enable() / disable() / clear()   // coverage and callers, one switch; clear empties both
m.debug.coverage.enabled / bits               // bits: the live Uint8Array(65536) of COVERAGE flags
m.debug.callers(addr)                         // [{ from, kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to', count }]
m.debug.callerMap()                           // Map<target, [{ from, kind, count }]>

m.debug.trace.enable({ depth, regs = false }) // depth 1..1,000,000 is required: the trace is never unlimited
m.debug.trace.disable() / clear() / enabled
m.debug.trace.last(n)                         // [{ pc, bytes, cycles, regs? }], oldest first
m.debug.trace.collapsed(n)                    // [{ entries, repeat }]: repeated PC sequences merged

m.debug.snapshot() / m.debug.restore(snap)    // the machine state, JSON-safe; restore is exact
m.video.diff(snap)                            // [{ row, col, was, now }]: video RAM cells changed since snap

m.debug.label(addr, name, { kind = 'code', size, note })   // a user label; the same address replaces
m.debug.labels                                // [{ addr, name, kind, size?, source: 'user', note? }], by address
m.debug.loaded                                // { manifest, sha256 } of the last m.load.* call, or null
m.debug.labelFile({ name, started, input })   // the §8 object for this session
```

- Everything on `m.debug` is optional and costs nothing when unused: the Machine checks one boolean per instruction while nothing is set, and the CPU's memory and port accessors are swapped for instrumented ones only while a watch, a hook, or coverage needs them. §7 has the behaviour in detail.
- `COVERAGE` is `{ EXEC: 1, OPERAND: 2, READ: 4, WRITE: 8, JUMP_TARGET: 16, CALL_TARGET: 32 }`. Ids count up from 1 across breakpoints and watches.
- `label` takes an identifier name (a letter or `_`, then letters, digits, or `_`, up to 32 characters), `kind` `'code'` or `'data'`, an optional `size` of 1 to 65,536 bytes, and an optional `note`, a remark for a human with no control character (§8).
- `labelFile` names the program by `name`, else by the last load's manifest; with neither it throws `labelFile needs a name: nothing was loaded through m.load` (or, after a `.BAS` load, whose manifest has no name, that the manifest carries none). `started` and `input` are strings recorded in the session only when given; the core reads no clock.
- `encodeRle(bits, mask)` and `decodeRle(text)` convert one coverage field (§8); `decodeRle` returns a `Uint8Array(65536)` of 0 and 1 and throws when a run is not hex or the runs do not sum to 65,536. `parseLabelFile(value)` (the parsed object or its JSON text) → `{ file, errors }` checks every rule of §8, keeping unknown top-level keys; `file` is null when there are errors. `mergeLabelFiles(a, b)` applies the §8 merge rule and throws for two different programs or a broken file.

**Phase 5 and later (the sketch)**

```js
m.fdc.mount(drive, image) / unmount(drive)    // phase 5
m.load.dsk(bytes)                              // phase 5
```

`serializeState` and `restoreState` are exported from the package too: `snapshot` and `restore` are built on them.

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
| Video | `3C00–3FFF`, 64×16, lowercase mod optional | `3C00–3FFF`, lowercase; 64×16, or 32×16 via port `EC` bit 2 (verified on the ROM). Codes `C0–FF`: unverified<sup>1</sup> | `3C00–3FFF` (maps 0–1) or `F800–FFFF` (maps 2–3); 64×16 or 80×24 via port `EC` bit 2 and port `84` bit 2 |
| RAM | 4/16/32/48 KB from `4000` | 16/32/48 KB | 64/128 KB; memory map select port `84` bits 0–1; 128 KB page select bits 4–5 |
| Cassette / sound | Port `FF` bits 0–1 out, bit 7 in; 500 baud | Port `FF`; 500/1500 baud | Port `FF` (Model III mode only) |
| FDC | WD1771: command/status `37EC`, track `37ED`, sector `37EE`, data `37EF`; drive select `37E1`; interrupt latch `37E0` (expansion interface) | WD1793 at ports `F0–F3`; drive select/density port `F4`; NMI status `E4` | Same as Model III |
| Timer | 40 Hz via expansion interface, status at `37E0` | 30 Hz; interrupt latch port `E0`, mask `E0` | 30 Hz or 60 Hz (port `EC` bit 6) |
| Printer | `37E8` | Port `F8` | Port `F8` |

Values above are from memory unless marked, and should be checked against the Model I/III/4 technical reference manuals before implementation; the memory-map and port numbers are the kind of detail that is easy to get one bit wrong. Treat this table as a checklist of what to verify, not as the reference.

Verified in emu phase 2, on the Model III (the rest of the table is not yet):

- **Video RAM `3C00–3FFF`, 64×16:** the screens of three real programs and the ROM's READY screen read back through `m.video.text()` (`test/integration/programs.test.js`).
- **32-column mode, port `EC` bit 2:** by probing the Model III ROM (kiwisincebirth Model3-RevC-2EF8): `PRINT CHR$(23)` raises bit 2 of the port `EC` mode register (`28H` to `2CH` at boot defaults) and re-lays the screen with characters at even video addresses, shown double-wide, 32 a row; `CLS` clears the bit (`test/integration/32col.test.js`).
- **Keyboard `3800–3BFF` matrix, and the ROM's scan entries `$002B` and `$0049`:** against the commented ROM disassembly and the Model III manual (§6, "Keyboard-scan hook").
- **Port `FF` as the sound port:** recorded, not verified. `m.sound` keeps every write with its T-state stamp, raw (`test/unit/sound.test.js`, on synthetic ROMs); which bits a given game toggles is the game's business, and the port's bit layout stays as listed in the table.

Unverified: **ENALTSET, port `EC` bit 3,** which selects the alternate character set, and all of the Model I and Model 4 columns.

<sup>1</sup> Model III character set: codes `C0–FF` show the special set (or Kana, via ENALTSET, port `EC` bit 3) per the Model III manuals (the Tandy Model 3/4 manual says codes 192–255 are space-compression codes or special characters, switched by `PRINT CHR$(21)`), but the glyph tables exist only as images, so the mapping could not be checked as text. `m.video.text()` therefore keeps `.` for `80–FF` and invents nothing: unverified as text.

Phase 1 targets Model III. Model I follows (mostly address-mapped I/O instead of ports). Model 4 last (four memory maps, 80-column mode, Model III compatibility mode).

ROMs are not bundled. The caller supplies bytes; the core validates by length and a known-hash table and reports which ROM it recognizes.

## 6. Loaders

| Format | Notes |
|---|---|
| `.CMD` | TRSDOS load module: records `01` (data: len, addr, bytes; the length counts the address and 0, 1, 2 mean 256, 257, 258), `02` (transfer address; ends the load), `05` (name). Every other record is skipped by its length byte. Verified in emu phase 2 against the LDOS 5.1 manual (Tech Info: File Formats p. 1) and Soltoff's *Programmer's Guide to LDOS/TRSDOS Version 6* (p. A-149, figure A-1): `07` is a patch *name* header whose patch code follows as ordinary `01` blocks, so skipping it is its whole handling; `10` is a yanked (removed) patch block, ignored; `1F` is a copyright comment. `m.load.cmd(bytes)` → `{ format: 'cmd', name, entry, blocks: [{ addr, len, why: 'record 01' }] }`, with the PC at the entry; blocks become coverage seeds. A load while halted or mid-run (`fastLoadCmd`, and `fastLoadSystem` alike) leaves HALT, lets an `EI` still in flight take effect (IFF1 and IFF2 set, as one instruction later), drops a pending `DD`/`FD` prefix, and clears latched interrupt requests; otherwise IFF1/IFF2 and the mode are kept. |
| `.BAS` | Detect tokenized (first byte `FF`) vs ASCII, from content. Tokenized: per line a 2-byte next pointer, a 2-byte line number, the body, `00`; two zero bytes end the program. The pointers are rebuilt for the load address and the program is written at TXTTAB with the start/end pointers (`40A4`/`40F9`) fixed. A file without the `FF` header is not tokenized as far as the loader can tell: it holds NULs, so it is rejected with an error that says it looks like tokenized BASIC without the `$FF` header and to add a leading `$FF` byte. ASCII: do **not** type it through the keyboard matrix — a 10 KB listing at a ROM-safe rate takes minutes of emulated time and the ROM's line editor may mangle it. Instead the loader feeds the text (`\r\n` and `\r` become `\n`, with one added at the end) through `m.keyboard.feed`, which the keyboard-scan hook (below) hands to the ROM's own scan entries (`002B`/`0049`), bypassing the matrix; BASIC takes the lines as the machine runs. The same mechanism serves the MCP `key` tool. Bytes that are neither text nor `FF`-first, and a tokenized file cut short, throw. |
| `.CAS` | Raw cassette image: `A5` sync, SYSTEM header (`55` + name) or BASIC header (`D3 D3 D3`). Deliver via the cassette device so the ROM loader runs for real. `m.load.cas(bytes, { baud = 500, via = 'rom' })`: via `'rom'` puts the tape in the deck as pulses at 500 or 1500 baud (its leader and sync rewritten for that rate: `00`s and `A5`, or `55`s and `7F`) and the caller types `CLOAD`, or `SYSTEM`, the name at the `*?` prompt, then `/`; the baud must match the Cass? answer at boot (L = 500, ENTER = 1500). Via `'fast'` the blocks are written at once (`fastLoadBasic`, `fastLoadSystem`, which jumps to the entry). Either way → `{ format: 'cas', kind: 'system' \| 'basic', name, entry?, blocks, baud, via }`; `blocks` are `{ addr, len, why: 'block 3C' }` for SYSTEM and one `{ addr: TXTTAB, len, why: 'BASIC program' }` for BASIC. Via `'rom'` nothing has landed yet, so every block carries `predicted: true`, and the BASIC block's `why` is `'BASIC program (predicted from TXTTAB; CLOAD not yet run)'` (TXTTAB read at load time). `baud` is `null` via `'fast'`. `m.cassette.insert(bytes, { baud })`, `rewind()`, and `motor` drive the deck directly. |
| `.DSK` / JV1 / JV3 / DMK | Mount into FDC. JV1 = raw 10-sector tracks; JV3 = sector header table; DMK = raw track with IDAM pointers. Read all three; write DMK only. |

Each loader returns a manifest the debugger records: where bytes landed and why. That manifest is the first entry in the coverage file.

**Keyboard-scan hook** (verified in emu phase 2 against the Model III ROM: the commented disassembly `MDL3LEV2.Z80` in kiwisincebirth/TRS-80-ROMS, and the entries `$KBCHAR` and `$KBWAIT` in `packages/disasm/data/symbols/rom-model3.json`, cited to the Model III manual, pp. 12/11 and 12/12). `$002B` loads DE with `$4015` (the keyboard DCB) and goes through `$0013` and the driver dispatcher `CIO` (`$0674`), which saves and restores BC, HL, IX, and the DE it was given, to the keyboard driver (`$3024` → `$338E`). The driver returns A = the key's ASCII code, or 0 with Z set (`XOR A` at `$3083`/`$30A1`, or `RET Z` at `$3403` when the debounce re-read differs) when no new key is down. For a key its last flag-setting instruction is `CP 01H` at `$3100` (the BREAK test), so F holds that compare: N set, Z clear, H set when the code's low nibble is 0, bits 5 and 3 clear, carry clear; BREAK itself (`$01`) goes through `RST 28H` (a RET under Level II) and returns with Z set. `$0049` is `CALL 002BH / OR A / RET NZ / JR 0049H`, so it returns A = the key with F from `OR A` (S, Z, 5, 3, and parity from A; H, N, C clear). Both return DE = `$4015` and keep BC, HL, IX, IY, and the alternate set. BASIC's line editor (`$0040` → `KEYIN` at `$05D9`) waits at `$0049`, and `INKEY$` (`$0358`) calls `$002B`. The hook (`m.keyboard.feed`, or `type` with `mode: 'hook'`): at an instruction boundary with the PC at `$002B` or `$0049` and a fed character waiting, it sets A, F, and DE as above and pops the return address, standing in for one RET (10 T-states); every character is delivered once; with nothing fed the ROM runs. It does not make the routine's RAM side effects (the rollover buffer at `$4036`, the repeat counters) or spend its debounce time, and it reaches only code that calls the ROM (it intercepts `$002B` and `$0049` directly, so a keyboard driver redirected through the DCB at `$4016`, such as type-ahead or a key filter, is bypassed while characters are fed; the stand-in RET also does the CPU's end-of-instruction bookkeeping, counting a pending `EI` down and clearing a pending prefix, and does not stand in for a halted CPU): a program that scans `$3800` directly needs matrix typing (`m.keyboard.type`, the default mode), which presses and releases keys at T-state times computed from `cps` at the CPU clock. Tests: `packages/emu/test/unit/key-queue.test.js` checks the contract register by register; `test/integration/keyboard.test.js` checks that, on the real ROM, the hook leaves the same registers at `$05E3` and `$004C` as the ROM does for a held key.

## 7. Debugger interface

Built in emu phase 3 (the API is listed in §3). The rulings below, numbered as in the phase 3 plan, settle what the first draft of this section left open.

- **Breakpoints:** by PC; optional `once` (removed after its first hit); optional condition `when(m) => bool`, checked at each hit. A hit stops `run()` before the instruction executes, with reason `'break'` and the breakpoint id; when several at one PC hit, each counts the hit and the lowest id is reported.
  - `step` ignores breakpoints and watch stops; only `run` stops on them (Ruling 3). `step(n)` is an explicit instruction count.
  - A run resumes past the breakpoint it stopped at (Ruling 4, as built): `run()`'s first boundary skips the check only when its PC is where the previous run stopped with `'break'`. That memory clears after the boundary, on `reset`, and on `restore`. A run whose first boundary holds a breakpoint it did not just stop at returns `{ reason: 'break', id, cycles: 0 }` (plus any interrupt response delivered at that boundary), so `run()` can return without executing an instruction. Hit counts therefore do not depend on how a session is split into runs.
  - No breakpoint is checked while the CPU is halted: it is not about to run the instruction at PC. A breakpoint at HALT+1 fires once an interrupt has returned there and the CPU runs it.
  - A breakpoint stop does not tick the FDC. `step` and `run` called from inside a `when` or `until` callback throw.
- **Watchpoints:** an address range (`len` bytes from `addr`, wrapping at `$FFFF`), read and/or write. Each matching access appends a frozen hit `{ id, kind, cycle, pc, addr, value, prev }` to a log that keeps the newest 65,536 (`hitsOverflowed` says when older ones were dropped). `cycle` is `m.cycles` at the access; `prev` is the byte a write replaced, and equals `value` for a read. Watches do not stop execution unless `stop: true`, and then `run` returns `{ reason: 'watch', id }` right after the instruction that made the access; `step` logs the hit but never stops.
  - Fetches are not reads (Ruling 2): instruction fetches never count as `READ` coverage, read watches, or `onMemRead`. A read is a fetch when it is among the instruction's first `len` reads and its address is `pc + k` for the k-th read; lengths come from the instruction's bytes (`instructionInfo`, tested for every opcode against `@fugloy/z80`).
  - `pc` is the start of the instruction making the access. A halted CPU opens no instruction, and an access outside one (an interrupt response's push, the IM 2 vector read, the keyboard hook's stand-in RET) carries the CPU's PC at that moment.
  - When several stop watches hit in one instruction, the lowest id is reported. A stop watch hit by an interrupt response at a boundary a breakpoint then holds stays pending: the next run executes the held instruction and returns `'watch'` right after it. A `step` in between, or a `restore`, drops it, and `unwatch` drops that watch's own pending stop (another watch's stays).
  - Order of stops: a breakpoint (before the instruction); after the instruction, a watch stop, then `until`, then the cycle budget.
- **Hooks:** `onMemRead(addr, value, pc)` on every data read (never a fetch), `onMemWrite(addr, value, prev, pc)` on every memory write, `onPort(port, value, dir, pc)` on every port access. Each is a function or `null`. `pc` is a hit's `pc`: the start of the instruction making the access, or the CPU's PC outside one; for a port access while no memory access is instrumented (no coverage, memory watch, or memory hook), it is the CPU's PC, which by then has moved past the instruction. The MCP server's `suggest` attributes accesses to routines by it (MCP Ruling 4).
- **Trace:** a preallocated ring of the last `depth` executed instructions, each `{ pc, bytes, cycles, regs? }` (`regs` when enabled with `regs: true`); `last` and `collapsed` return fresh copies. Entries carry no mnemonic (Ruling 5): formatting is the caller's, and the MCP server formats with `@fugloy/disasm`. `cycles` excludes an interrupt response; only executed instructions leave entries. `enable` needs a `depth` of 1 to 1,000,000, so a trace is never unlimited, and allocates a fresh, empty ring; `disable` keeps what was recorded. Loop collapsing (`collapsed(n)`): consecutive repetitions of one PC sequence (period 1 to 64, at least two repeats) are reported once with a repeat count.
- **Coverage:** a per-byte bitfield across 64 KB (and per bank on Model 4, phase 6): `EXEC`, `OPERAND`, `READ`, `WRITE`, `JUMP_TARGET`, `CALL_TARGET`. This is the single most valuable output for Fugløy — it separates code from data by observation.
  - `EXEC` marks the first byte of every executed instruction, prefix included, and `OPERAND` its other bytes (Ruling 1), in `step` and `run` alike. A lone prefix the CPU runs as its own step (§4) is a one-byte instruction.
  - `READ` and `WRITE` are data accesses, never fetches. `JUMP_TARGET` is where a taken `JP`, `JR`, `DJNZ`, or `JP (HL)` landed, and `CALL_TARGET` where a taken `CALL` or `RST` landed. Where a `RET` lands is not marked (the callers map records it as `ret-to`).
  - Taken is decided by the landing PC: a conditional transfer to its own fall-through address counts as taken, and a `RET` that pops `pc + len` counts as not taken.
  - Interrupt responses record no edge, and the keyboard hook's stand-in RET marks nothing.
  - Coverage and callers share one switch, `m.debug.coverage.enable()` (Ruling 6); `clear()` empties both.
- **Callers:** a map of target → `{ from, kind: 'call' | 'jp' | 'jr' | 'rst' | 'ret-to', count }`, where `count` is how many times that edge was taken (Ruling 8), recorded with coverage.
- **Snapshots:** full machine state (CPU, RAM, device state, cycle count) as a serializable object that survives `JSON.stringify`; restore is exact. Used for differential testing (§10) and for "try this input, rewind." A snapshot does **not** include the trace ring, hit log, coverage, or callers; those are debugger state, not machine state, and survive a restore, as do breakpoints, watches, hooks, and labels. Document this; it will surprise someone. A restore starts a fresh timeline: it clears the key queue (`m.keyboard`) and the sound ring (`m.sound`), whose cycle stamps belong to the old one, the PC where the last run stopped for a breakpoint, and any pending watch stop. Known limit: the NMI edge latch is not serialized, so a restore is exact only while the FDC's INTRQ is idle (phase 5 fixes it).
- **Screen diff:** `m.video.diff(snap)` returns the video RAM cells changed since a snapshot, `{ row, col, was, now }` as raw bytes over the 64-column RAM layout (also in 32-column mode, where only even columns show); a cheap way to detect "something printed."
- **Labels and the label file:** `m.debug.label` names addresses (`source: 'user'`), and `m.debug.labelFile` writes the session as the §8 file.

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
    "0:0": {
      "encoding": "rle-hex",
      "exec": "5000,1,AFFF", "operand": "5001,2,AFFD", "read": "6D60,2,929E",
      "write": "6D60,2,929E", "jump": "5020,1,AFDF", "call": "5068,1,AF97"
    }
  },
  "callers": { "20584": [ { "from": 20500, "kind": "call", "count": 212 } ] },
  "sessions": [ { "started": "2026-10-14T14:02:00Z", "cycles": 48201339, "input": "keyboard: 'RUN\\r', 'A' …" } ]
}
```

The example elides `sha256` and `input` (`…`); a real `sha256` is 64 lowercase hex digits. `fixtures/synthetic/label-file/sample.labels.json` is a complete file written by the emulator from a synthetic session (`pnpm fixtures` writes it; a test fails when the committed copy differs).

Rules: `source` is always one of `loader | observed | user | disasm`; the disassembler never overwrites a `user` label; `observed` labels carry `evidence` so a human can judge them.

- **Keys.** All eight top-level keys are required. A reader keeps keys it does not know, and so does the merge. Addresses are JSON numbers (decimal), 0 to 65,535.
- **`fugloy`** is the format version, `1`. A reader refuses any other.
- **`program`**: `name`, a non-empty string; `sha256`, the SHA-256 of the program file as given to the loader, 64 lowercase hex digits, omitted when unknown (the emulator omits it when nothing was loaded through `m.load`); `model`, `1`, `3`, or `4`. A label file is keyed by address, so a reader applying it to a program whose hash differs from a present `sha256` refuses it (phase 3 Ruling 10).
- **`load`**: `{ addr, len, source }` per block that landed, `len` 1 to 65,536. The emulator writes `source` as `<format>-block-<i>`, where `i` is the block's index in the loader's manifest (`cmd-block-0`, `cas-block-2`, `bas-block-0`), and leaves out blocks that have not landed. A `.CAS` loaded `via: 'rom'` lists none: its manifest only predicts the blocks (`predicted: true`), and the file never learns when the ROM's loader has read them; load it `via: 'fast'` to have them listed.
- **`entry`**: the entry address, or `null` when the program has none (BASIC).
- **`labels`**: `{ addr, name, kind, size?, source, evidence?, note?, map?, page? }`, at most one per `(map, page, addr)`, `map` and `page` counting as 0 when absent (both readers key duplicates this way). `kind` is `code` or `data`; `size`, when present, is 1 to 65,536 bytes; `evidence` is required when `source` is `observed`; `note`, on a label of any source, is a remark for a human (the MCP `label` tool's `note`: what the label is, how it was worked out), and the disassembler shows it as the line's comment when the hint file gives none, ahead of any evidence (`note; observed: evidence`); `name`, `evidence`, and `note` hold no control character (U+0000 to U+001F, U+007F), which would start a new line in a listing or zmac source. The emulator writes them sorted by address: `ENTRY` (`kind: 'code'`, `source: 'loader'`) at the entry; an `observed` label named `SUB_hhhh` (four uppercase hex digits) at every `CALL` or `RST` target inside the loaded blocks, with evidence `called N× from M sites` (`N` the times taken, `M` the distinct call sites, and `1 site` in the singular) (Ruling 9); and the `user` labels from `m.debug.label`. At one address the higher source wins: `user` over `observed` over `disasm` over `loader`. A name of the generated shape (`L`, `SUB_`, `DATA_`, or `TBL_` followed by four hex digits) means "no name given": the disassembler still takes the address as code and the evidence as a comment, under its own name.
- **`coverage`**: one object per `"<map>:<page>"` key, each `{ encoding: "rle-hex", exec, operand, read, write, jump, call }`, the six fields being the `EXEC`, `OPERAND`, `READ`, `WRITE`, `JUMP_TARGET`, and `CALL_TARGET` bits of §7 (Ruling 7), with one addition: `write` marks a byte written while coverage was on, **or changed since the load**, that is, a byte inside a landed `load` block that differs, when the file is written, from what the loader placed there. So a program that moved or rewrote itself before coverage started still says so. (A byte rewritten with the value it held, while coverage was off, is not marked; nothing about it changed.) **`rle-hex`**: comma-separated run lengths in hex, alternating zero-runs and one-runs and starting with a zero-run, which may be `0`, summing to 65,536 (`10000` in hex), with no spaces. A field with no bit set is `"10000"`; one with every bit set is `"0,10000"`. Every run is one to five hex digits, never empty. The emulator writes uppercase hex and no zero-length run after the first; a reader accepts either case and zero-length runs (`0`) anywhere.
- **`callers`**: keyed by the target address as a decimal string without leading zeros; each value a list of `{ from, kind, count }`, `kind` one of `call | jp | jr | rst | ret-to` and `count` (≥ 1) how many times that edge was taken (Ruling 8). The emulator writes targets in ascending order and each list sorted by `from`, then `kind`.
- **`sessions`**: one `{ cycles, started?, input? }` per recorded session: `cycles` is `m.cycles` when the file was written, `started` a time string (ISO 8601) and `input` a description of what was typed, both supplied by the caller. The emulator never reads a clock, so a file without `started` is byte-identical across runs.

**Applying the file (the disassembler).** Every address in the file is a runtime address, so the disassembler applies it to the analysis space (the program's image with each relocate hint applied), and it states nothing about the program's bytes that the session did not see there:

- An executed instruction (an `exec` bit) and a `code` label become entry points, except where the bytes changed at runtime: an instruction any of whose bytes is marked `write`, outside the runtime region of a relocate hint, ran bytes that are not the program's, and is skipped. One summary warning counts them: `N executed or labelled addresses changed at runtime (…); their coverage is not applied to the file's bytes`. Inside a relocate hint's region they apply: the hint says the program's bytes run there. A path that starts at one of these entry points also ends before decoding a changed byte; a path from any other entry point ignores `write`.
- A run of bytes that were read and never executed, never fetched as an operand, and never written becomes data that ends a path (`nocode`). This is a heuristic, not an observation: code that never ran and that the program only read (a checksum over itself, a copy loop's source) is typed as data too. It never ends a path at an entry point from another source (the module's entry, a hint's `entry` or `code`, `--entry`, a `.BAS` program's planted entries and code lines, a hint table's targets): the run stops short of such an entry point.
- `data` labels type their bytes and name them even where they were written: data is what a program writes.
- The hint file wins for names, comments, and overlapping overrides (Ruling 11); a file for another program is refused (Ruling 10).

**When to start coverage.** From the load is the natural default, and what the MCP server will do: the program's own copy or decompression marks every byte it writes, so nothing it moved is mistaken for data, and paired with a relocate hint nothing is lost. Started later (after a loader stub has moved the game, say), `write` still marks what changed since the load, and the game's own data reads then show as read-only runs, which the disassembler applies as data. Use: `fugloy prog.cmd --hints prog.hints --labels prog.labels.json` (or `withLabelFile` in `@fugloy/disasm`).

Coverage bitfields are over the 64 KB address space. On Model 4 with 128 KB, the file carries one coverage object per `(map, page)` combination seen, keyed `"coverage": { "0:0": {…}, "2:1": {…} }`; Model I/III use the single key `"0:0"`. Addresses in `labels`, `load` and `callers` are likewise `{ addr, map?, page? }` with map/page omitted when zero. Decide this now or every consumer grows a special case later.

Merging rule for `coverage export` (`mergeLabelFiles(a, b)`): two files whose `program.sha256` are both present and differ are refused. Otherwise: union of bitfields per coverage key; `labels` merged by address with `user` winning over `observed` winning over `disasm` winning over `loader`, `b` winning a tie; `load` unioned without duplicates; `entry` is `a`'s unless it is `null`; `callers` unioned, with the counts of one `(from, kind)` edge summed; `sessions` appended (`a`'s first), never rewritten; `program` is `a`'s, taking `b`'s `sha256` when `a` has none.

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
| Debugger | Scripted session: load, break, watch, type, check screen | Deterministic hit log, byte-identical across runs (and the label file: `test/integration/label-session.test.js`) |
| Differential | Run a program in `emu` and the same program in trs80gp or sdltrs via its own trace; compare PC+regs per instruction | Zero divergence over the session (this test is also the Fugløy verification harness, pointed at the recompiled JS instead) |
| Determinism | Run the same scripted session twice; compare final snapshots | Byte-identical |

The exercisers are GPL-2.0 and never committed. `pnpm zex:install` fetches them, pinned and hash-checked, into `tools/zex/`. `FUGLOY_ZEX=1` runs them as one Vitest test per group, and `.github/workflows/exerciser.yml` runs them in CI when `packages/emu` changes, and weekly. The timing check is `packages/emu/test/unit/cpu-timing.test.js`, against `@fugloy/z80`'s table.

## 11. Phased build plan

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Extract `cschweda/trs80-emulator` into `packages/emu`; strip DOM; ESM; test runner | Boots to `READY` in Node with no DOM stubs |
| 1 | Z80 core hardened | ZEXALL passes |
| 2 | Model III devices + `.CMD`/`.BAS`/`.CAS` loaders | Three real programs run to a recognizable screen. **Met** (2026-10-17): through `Machine`, Sea Dragon, Eliminator (`elimin8c`), and Rear Guard (`reargrd5`) load with `m.load.cmd` and reach their title screens on the Model III ROM, each differing from the READY screen in more than 256 cells and answering a key. Armored Patrol was tried and rejected (its screen differs in only 152 cells). Determinism: one scripted session run twice ends byte-identical in `serializeState`, every port `FF` event, and the cycle count: on a synthetic ROM in CI, and on Sea Dragon locally (`test/integration/determinism.test.js`). |
| 3 | Debugger API + coverage + §8 file format | A scripted session produces a label file Fugløy's disassembler consumes. **Met** (2026-10-18): `m.debug` (breakpoints, watches and the hit log, hooks, coverage and callers, the trace, snapshots, `m.video.diff`, labels) and `m.debug.labelFile`; `@fugloy/disasm` reads the file (`withLabelFile`, the CLI's `--labels`). In CI, a synthetic `.CMD` on a synthetic ROM, run with coverage, a 10,000-deep trace, and a write watch, writes a file under which the disassembler types the table the program reads as data where it would otherwise decode it as code, and names the subroutine it calls `SUB_7020` with the comment `observed: called 4× from 1 site`; two runs end with identical hit logs, traces, and files (`test/integration/label-session.test.js`). On the Model III ROM, a Sea Dragon session (coverage from `$497F`, title screen, ENTER) rewrites the committed `examples/sea-dragon/seadrg01.labels.json` byte for byte, and with the committed hints every one of its 459 executed or labelled roots starts an instruction the hints decode (none lost, no overlap, no hint name lost) and it adds the observed call counts of the 3 subroutines inside the loaded blocks; without the hints it skips the 165 addresses the copy changed, with one warning, and decodes no instruction whose bytes differ from what ran (`packages/disasm/test/sea-dragon-labels.test.ts`, no ROM needed). With the hints the program is already fully decoded, so the label file adds no instruction there: the synthetic session carries the proof that coverage changes a listing. The same session with coverage from the load keeps all 2,896 hinted instructions (`label-session.test.js`, ROM). Speed on Sea Dragon (`scripts/benchmark.mjs`, each mode in its own process): about 42× real time with debugging off, about 30× with coverage and a 10,000-deep trace; the suite asserts the §4 target, ≥ 20×, for both. |
| 4 | `@fugloy/mcp` v0.1 | Claude Code can load a game, find its print routine, and label it unaided |
| 5 | FDC + disk images | TRSDOS boots; a disk-based game runs |
| 6 | Model I, then Model 4 | Each model's ROM boots and its fixture programs run |
| 7 | Differential harness against an external emulator | Zero divergence on all fixtures |

Phases 0–4 are the minimum for the MCP server to be useful. Phase 7 is what makes Fugløy's "runs identically" claim defensible.

## 12. Open questions

- [ ] Which external emulator is the differential reference — trs80gp (closed, very accurate, has a trace mode) or sdltrs (open, patchable)?
- [ ] Video RAM access timing: the Model I shows "snow" on CPU access during display and the Model III/4 insert wait states. Model neither in v1 (timing error only matters for cycle-exact demos), but record the decision so the differential harness can exclude it.
- [ ] Does the §8 `(map, page)` keying hold up once Model 4 is real, or should coverage be over physical RAM addresses with a map table?
- [x] Is the keyboard-hook injection (§6) safe for programs that replace the ROM keyboard routine with their own matrix scan? No: such programs never call `$002B`/`$0049`. Emu phase 2 ships both: cycle-timed matrix typing (the default) and the hook (`feed`, or `type` with `mode: 'hook'`).
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
