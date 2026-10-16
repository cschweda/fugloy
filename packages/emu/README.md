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

- Spec: [`docs/fugloy-emu-spec.md`](../../docs/fugloy-emu-spec.md) (phases 0–7 in §11)
- Label and coverage file shared with `mcp` and `disasm`: [`docs/label-format.md`](../../docs/label-format.md)
- ROM images are never bundled or committed; `roms/` here is gitignored and
  paths are supplied by the caller.
