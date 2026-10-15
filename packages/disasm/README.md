# @fugloy/disasm

The disassembler core: 64K memory image, `.CMD`/`.BAS`/raw loaders,
content-based format detection, linear sweep, and listing renderers. No Node
or DOM APIs, so it runs in the CLI, the tests, and the browser. The design is
in [`docs/Fugloy-Project-Plan.md`](../../docs/Fugloy-Project-Plan.md); usage
is in the [root README](../../README.md).

- Label and coverage file it will read from `@fugloy/emu` and `@fugloy/mcp`
  (runtime code/data coverage and observed labels for the second pass):
  [`docs/label-format.md`](../../docs/label-format.md)
