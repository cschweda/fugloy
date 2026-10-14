# Phase 1 kickoff prompt

Paste this as the first message to Claude Code in the `fugloy` folder after
`CLAUDE.md`, `docs/Fugloy-Project-Plan.md`, and `sample/` are in place.

---

Read `CLAUDE.md` and `docs/Fugloy-Project-Plan.md`. We are starting phase 1.

Set up the monorepo described under Stack: pnpm workspaces, Node 22, TypeScript
strict, ESM only, Vitest, with `packages/z80`, `packages/disasm`, `packages/cli`,
and `fixtures/synthetic`. Leave `apps/web` for phase 4. Add a `.gitignore` that
excludes `sample/` and any `*.rom` file.

Then build, in this order, with tests before each step is called done:

1. **`packages/z80`:** generate the full Z80 opcode table from the x/y/z/p/q
   decomposition (unprefixed, CB, ED, DD/FD, DDCB/FDCB), with length, mnemonic,
   operand kinds, cycle counts, and control-flow effect per instruction. Write
   the exhaustion test that decodes every encoding and compares against a
   reference table committed under `packages/z80/test/reference/`. Include
   SLL and the IX/IY half registers; leave other undocumented opcodes
   unimplemented but decodable as `DB` bytes.
2. **`packages/disasm` memory image:** `Uint8Array(65536)` plus bitmap, with
   `load(addr, bytes)` that records block extents and overlaps.
3. **.CMD loader:** implement every rule in the plan's ".CMD load modules"
   section. Write the synthetic .CMD *writer* first, then one fixture and one
   test per rule (length wrap at 254/255/256, overlap, out-of-order,
   non-contiguous, missing `02`, trailing bytes, `05` and `1F` records, every
   PDS/ISAM record type).
4. **.BAS loader and detokenizer:** implement the format in the plan's ".BAS
   tokenized BASIC" section with the token table from the appendix. Write the
   synthetic BASIC *tokenizer* first, then fixtures saved from two different
   base addresses. Hidden-code detection is phase 2; for now, lines that fail
   to parse are reported as "unparsed" with their address and length.
5. **`packages/cli`:** `fugloy <file>` detects the format from content and
   prints a linear-sweep listing (address, bytes, mnemonic) for .CMD and raw
   files, and a detokenized listing for .BAS. Add `--base <hex>` for raw files.
6. **Real-program snapshot tests** under `packages/disasm/test/real/` that run
   against `sample/` when present and skip when absent. Use the
   appendix table in the plan as the expected block ranges and entry points;
   assert those exactly for every file listed there.

Stop after step 6 and report: what passes, what was ambiguous in the plan, and
anything in the plan you think is wrong. Do not begin phase 2.
