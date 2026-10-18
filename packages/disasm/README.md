# @fugloy/disasm

The disassembler core: 64K memory image, `.CMD`/`.BAS`/raw loaders,
content-based format detection, a Level II BASIC parser and entry-point miner
(`src/basic/`), pass 1 recursive descent and pass 2 labels (`src/analysis/`),
the hint file (`src/hints/`), string and proposal heuristics, rebasing,
relocation, the cited ROM, hardware, and DOS symbol tables (JSON in
`data/symbols/`, compiled by `pnpm symbols` into `src/symbols/`), the zmac
emitter, the JSON IR, linear sweep, listing renderers, and the Explain
engine behind the workbench's Explain tab (`src/explain/`). No Node
or DOM APIs, so it runs in the CLI, the tests, and the browser. The design is
in [`docs/Fugloy-Project-Plan.md`](https://github.com/cschweda/fugloy/blob/main/docs/Fugloy-Project-Plan.md); usage
is in the [root README](https://github.com/cschweda/fugloy/blob/main/README.md).

- The label and coverage file it reads (`parseLabelFile`, `withLabelFile`;
  the CLI's `--labels`), written by `@fugloy/emu` and, from emu phase 4,
  `@fugloy/mcp`: runtime code and data coverage and observed labels:
  [`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md)
