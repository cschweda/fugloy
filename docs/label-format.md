# Fugløy label and coverage file format

Extracted from §8 of [`fugloy-emu-spec.md`](fugloy-emu-spec.md) (draft v0.1, 2026-10-14), which remains the source of truth; change it there and re-extract. Shared contract between `@fugloy/emu`, `@fugloy/mcp`, and `@fugloy/disasm`.


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
- **`load`**: `{ addr, len, source }` per block that landed, `len` 1 to 65,536. The emulator writes `source` as `<format>-block-<i>`, where `i` is the block's index in the loader's manifest (`cmd-block-0`, `cas-block-2`, `bas-block-0`), and leaves out blocks that have not landed. A `.CAS` loaded `via: 'rom'` lists none: its manifest only predicts the blocks (`predicted: true`), and the file never learns when the ROM's loader has read them; load it `via: 'fast'` to have them listed. A disk loaded with `m.load.dsk` lists none either: its manifest's `blocks` is empty, since nothing has landed when the disk is mounted, and what the disk's own loader reads later is the program's doing, not a load. That manifest carries no name, so `m.debug.labelFile()` needs `name` for a disk session and throws without one.
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

**When to start coverage.** From the load is the natural default, and what the MCP server does: the program's own copy or decompression marks every byte it writes, so nothing it moved is mistaken for data, and paired with a relocate hint nothing is lost. Started later (after a loader stub has moved the game, say), `write` still marks what changed since the load, and the game's own data reads then show as read-only runs, which the disassembler applies as data. Use: `fugloy prog.cmd --hints prog.hints --labels prog.labels.json` (or `withLabelFile` in `@fugloy/disasm`).

Coverage bitfields are over the 64 KB address space. On Model 4 with 128 KB, the file carries one coverage object per `(map, page)` combination seen, keyed `"coverage": { "0:0": {…}, "2:1": {…} }`; Model I/III use the single key `"0:0"`. Addresses in `labels`, `load` and `callers` are likewise `{ addr, map?, page? }` with map/page omitted when zero. Decide this now or every consumer grows a special case later.

Merging rule for `coverage export` (`mergeLabelFiles(a, b)`): two files whose `program.sha256` are both present and differ are refused, and so are two whose `program.model` differs (a Model I file and a Model III file: their coverage of `$0000`–`$37FF` is of two different ROMs, and their hardware addresses differ), with a sentence naming the two models; the MCP server ignores a sidecar written on another model at `load`, as it does one for another program, and never merges or overwrites it. Otherwise: union of bitfields per coverage key; `labels` merged by address with `user` winning over `observed` winning over `disasm` winning over `loader`, `b` winning a tie; `load` unioned without duplicates; `entry` is `a`'s unless it is `null`; `callers` unioned, with the counts of one `(from, kind)` edge summed; `sessions` appended (`a`'s first), never rewritten; `program` is `a`'s, taking `b`'s `sha256` when `a` has none.
