# @fugloy/emu

Headless, deterministic TRS-80 Model I/III/4 emulator core in plain
JavaScript, for Node and the browser alike. Emu phase 0 brought in the core of
[cschweda/trs80-emulator](https://github.com/cschweda/trs80-emulator) (v1.6.0):
the Z80 CPU (`src/cpu/`), the Model III memory map, I/O ports, and system
(`src/machine/`), the keyboard matrix, cassette, WD1793 disk controller, disk
images, and printer (`src/devices/`), the `.CAS` and `.CMD` formats
(`src/loaders/`), and save states (`src/debug/`). Model III only for now.

The renderer, the WebAudio driver, the turbo throttle, the web UI, and every
ROM, disk, and program file stayed upstream: rendering and sound belong to the
workbench, and the caller supplies ROM bytes. Provenance and license:
[`NOTICE.md`](NOTICE.md).

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
The debugger (breakpoints, trace, coverage, snapshots) is phase 3.

- Spec: [`docs/fugloy-emu-spec.md`](../../docs/fugloy-emu-spec.md) (phases 0–7 in §11)
- Label and coverage file shared with `mcp` and `disasm`: [`docs/label-format.md`](../../docs/label-format.md)
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
