# Fugløy

A Z80 disassembler for the TRS-80 Model I and Model III that reads `.CMD` load
modules and tokenized `.BAS` programs directly, rebuilds the memory image the
way the machine would, and prints a listing. The full design, phases, and the
measured facts about the sample programs are in
[docs/Fugloy-Project-Plan.md](docs/Fugloy-Project-Plan.md); working
conventions are in [CLAUDE.md](CLAUDE.md).

Named after the island in *Voyage of the Valkyrie*; spelled `fugloy` in code.

## Status

**Phase 1: core decoder and loaders.** Deliverable: a CLI that prints a
linear-sweep listing of any `.CMD` or raw binary and a detokenized listing of
any `.BAS`.

| Package | What it holds |
| --- | --- |
| `packages/z80` | Z80 opcode tables generated from the x/y/z/p/q decomposition (unprefixed, `CB`, `ED`, `DD`/`FD`, `DDCB`/`FDCB`) with length, operands, cycle counts, and control-flow effect; a decoder; an exhaustion test against an independently typed reference. No I/O. |
| `packages/disasm` | 64K memory image with a load bitmap and block log, `.CMD` and `.BAS` loaders, content-based format detection, raw loader, linear sweep, plain-text listings. No Node or DOM APIs, so it runs in a browser. |
| `packages/cli` | `fugloy <file> [--base <hex>]`, the only package that touches the file system. |
| `fixtures/synthetic` | Generated fixtures, one per loader rule, written by the test suite's own `.CMD` writer and BASIC tokenizer. |

Later phases add recursive descent and code/data heuristics, labels and
per-machine symbol tables, hint files, and a static web workbench
(`apps/web`, Nuxt 4, deployed to Netlify).

## Requirements

Node 22 (`.nvmrc`) and pnpm 10.

## Use

```sh
pnpm install
pnpm test          # vitest, all packages
pnpm typecheck     # tsc project references plus the test sources
pnpm build         # emits packages/*/dist
pnpm fixtures      # regenerates fixtures/synthetic from the writers

pnpm fugloy path/to/program.cmd          # load module: header, ORG per run, listing
pnpm fugloy path/to/program.bas          # tokenized BASIC: detokenized listing
pnpm fugloy path/to/code.bin --base 5200 # raw binary at a base address (hex)
```

The format is detected from content, never from the extension; `.III`,
`.bad`, and `.CMD` are all load modules. Raw binaries need `--base`.

## Sample programs

The copyrighted programs used as fixtures (Asylum, Volcano Hunter, Voyage of
the Valkyrie, Armored Patrol) are never committed. Tests that need them look
in `sample/` or `fixtures/real/`, both gitignored, and skip when the files are
absent.

## Conventions

Addresses are `$3C00` in prose and comments and `3C00H` in emitted assembly.
Opcode tables are generated, never hand-edited. The image is a flat
`Uint8Array(65536)` with a parallel bitmap. See `CLAUDE.md` for the rest.

## License

MIT, © 2026 Christopher Schweda. See [LICENSE](LICENSE).
