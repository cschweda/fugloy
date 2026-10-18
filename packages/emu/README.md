# @fugloy/emu

Headless, deterministic TRS-80 emulator core (Model III; Model I and 4 to come) in plain
JavaScript, for Node and the browser alike. Emu phase 0 brought in the core of
[cschweda/trs80-emulator](https://github.com/cschweda/trs80-emulator) (v1.6.0):
the Z80 CPU (`src/cpu/`), the Model III memory map, I/O ports, and system
(`src/machine/`), the keyboard matrix, cassette, WD1793 disk controller, disk
images, and printer (`src/devices/`), the `.CAS` and `.CMD` formats
(`src/loaders/`), and save states (`src/debug/`). Model III only for now.
Phases 0–4 of the spec's eight are done: the Z80 core passes ZEXDOC and
ZEXALL, the `Machine` below runs real programs, `m.debug` writes the label
and coverage file, and phase 4, the MCP server
[`@fugloy/mcp`](https://github.com/cschweda/fugloy/blob/main/packages/mcp/README.md),
drives it for an AI assistant (on the `emu-phase4` branch until it is
merged).

The renderer, the WebAudio driver, the turbo throttle, the web UI, and every
ROM, disk, and program file stayed upstream: rendering and sound belong to the
workbench, and the caller supplies ROM bytes. Provenance and license:
[`NOTICE.md`](https://github.com/cschweda/fugloy/blob/main/packages/emu/NOTICE.md).

The core never writes to the console. Pass a logger to see what it reports,
such as an unimplemented opcode or a tape load:
`new TRS80System({ romData, log: (level, text) => console[level === 'info' ? 'log' : level](text) })`.
Without one it stays silent, unlike upstream, which printed warnings;
`system.cpu.unimplementedOpcodes` still records every opcode it hit and does
not implement.

## Using the machine

```js
import { readFileSync } from 'node:fs'
import { Machine, CPU_CLOCK_HZ } from '@fugloy/emu'

const m = new Machine({ roms: { level2: readFileSync('model3.rom') } })   // Model III, 48K; you supply the ROM
const shows = (text) => (mm) => mm.video.text().join('\n').includes(text)
const second = CPU_CLOCK_HZ                                              // T-states per emulated second

m.run({ until: shows('Cass?'), cycles: 5 * second })          // boot; stops at the prompt, or after 5 s
m.keyboard.type('\n')                                          // ENTER: 1500 baud
m.run({ until: shows('Memory Size?'), cycles: 5 * second })
m.keyboard.type('\n')                                          // ENTER at Memory Size?
m.run({ until: shows('READY'), cycles: 5 * second })

m.load.cmd(readFileSync('seadrg01.cmd'))   // PC at the program's entry
m.run({ cycles: 5 * second })
console.log(m.video.text().join('\n'))     // the screen, 16 lines
```

`step`, `run`, the registers, memory, the keyboard (matrix typing and a ROM
keyboard hook), sound events, and the three loaders are described in spec §3.

## Debugging

`m.debug` stops on breakpoints and watches, logs memory hits, records which
bytes ran, were read, written, jumped to, and called, keeps a bounded trace,
takes snapshots, and writes the label and coverage file that `@fugloy/disasm`
reads (`fugloy seadrg01.cmd --labels seadrg01.labels.json`). Continuing the
example above, just after `m.load.cmd`:

```js
import { writeFileSync } from 'node:fs'

m.debug.break(0x497f, { once: true })        // Sea Dragon's stub copies the game down, then jumps here
m.run({ cycles: second })                    // → { reason: 'break', id: 1, cycles }
m.debug.coverage.enable()                    // from here on: exec, operand, read, write, jump, call
m.debug.trace.enable({ depth: 10_000 })      // the last 10,000 instructions
const top = m.debug.watch(0x3c00, 64, { write: true })    // log every write to the screen's top line
m.run({ cycles: 5 * second })
m.debug.hits(top)                            // [{ id: 2, kind: 'write', cycle, pc, addr, value, prev }, …]
m.debug.callers(0x6212)                      // [{ from: 18974, kind: 'call', count: 80 }, …]
m.debug.label(0x6212, 'TONE')                // a user label: the listing names the routine TONE
writeFileSync('seadrg01.labels.json', JSON.stringify(m.debug.labelFile({ name: 'seadrg01.cmd' }), null, 2))
```

Coverage can start at the load: the label file's `write` field marks every
byte a self-relocating program's copy writes, and every loaded byte that
differs from what the load placed, so the disassembler neither mistakes moved
code for data nor applies the moved code's coverage to the file's bytes (a
relocate hint says where it runs).
Everything on `m.debug` is described in spec §3 and §7, the file in §8 and
[`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md).
`examples/sea-dragon/seadrg01.labels.json` is the file of the scripted session
in `test/integration/sea-dragon-session.js`; `node
packages/emu/scripts/sea-dragon-labels.mjs` rewrites it (it needs the ROM).

Debugging off costs nothing measurable, and the debugger keeps the §4 target.
On Sea Dragon, 20 emulated seconds of its title screen
(`node packages/emu/scripts/benchmark.mjs off|debug`, each mode in its own
process, on the laptop that built phase 3):

| Mode | Speed |
|---|---|
| Debugging off | about 42× real time (41.5–43.3× over three runs; phase 2 measured about 43×) |
| Coverage and a 10,000-deep trace | about 30× real time (29.5–30.7×) |

`test/integration/benchmark.test.js` asserts at least 20× for both.

- Spec: [`docs/fugloy-emu-spec.md`](https://github.com/cschweda/fugloy/blob/main/docs/fugloy-emu-spec.md) (phases 0–7 in §11)
- Label and coverage file shared with `mcp` and `disasm`: [`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md)
- ROM images are never bundled or committed; `roms/` here is gitignored and
  paths are supplied by the caller.

## Testing the Z80 core

ZEXDOC and ZEXALL, Frank Cringle's Z80 instruction exercisers, are GPL-2.0, so
they are never committed. `pnpm zex:install` downloads them into the
gitignored `tools/zex/`, pinned to one commit of
[agn453/ZEXALL](https://github.com/agn453/ZEXALL) and checked by SHA-256. Then:

```sh
FUGLOY_ZEX=1 pnpm vitest run packages/emu/test/exerciser               # about 5 minutes, one test per group
FUGLOY_ZEX=1 pnpm vitest run packages/emu/test/exerciser -t "daa,cpl"  # one group
```

They run on `test/cpm.js`, a CP/M stand-in: the program at `0100H`, BDOS
functions 2 and 9 at `0005H`, and a jump to `0000H` to end.
`test/unit/cpu-timing.test.js` checks every opcode's T-states against
`@fugloy/z80`.
