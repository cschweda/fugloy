# @fugloy/emu

Headless, deterministic TRS-80 Model I/III/4 emulator core in plain
JavaScript, for Node and the browser alike. **Stub:** `src/index.js` is empty
until phase 0 of the build plan (import `cschweda/trs80-emulator`, strip DOM
dependencies, boot to `READY` in Node).

- Spec: [`docs/fugloy-emu-spec.md`](../../docs/fugloy-emu-spec.md) (phases 0–7 in §11)
- Label and coverage file shared with `mcp` and `disasm`: [`docs/label-format.md`](../../docs/label-format.md)
- ROM images are never bundled or committed; `roms/` here is gitignored and
  paths are supplied by the caller.
