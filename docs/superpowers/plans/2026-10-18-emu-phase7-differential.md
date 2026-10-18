# Emu Phase 7 (Differential Harness against trsjs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a program in `@fugloy/emu` and in an external reference emulator in lockstep, compare CPU state after every instruction, and report the first divergence that is not a documented, explained difference — with zero unexplained divergence on the Model III fixtures (emu spec §11 phase 7, §10 "Differential").

**Architecture:** The reference is trsjs (`trsemu-1.6.js`, https://trsjs.48k.ca/, Peter Phillips; converted from trs80gp's C), which the user named on 2026-10-18. A feasibility spike (2026-10-18) showed it loads in `node:vm` with small DOM stubs, exposes its Z80 through one line injected into the script text in memory (`stepz80`, `z.reg`, `z.mem`, `z.cycles`, `mode_1_IRQ`, the beam IRQ flags, `cycles_per_frame`), carries a ROM byte-identical to our `model3-rev-c-2ef8`, and agrees with us on every instruction's T-states, PC and general registers once its 30 Hz interrupt is aligned (`frame_cnt = 1`). The remaining differences fall into five classes (Task 2 found three more; Ruling 2 has the table as built), each a known trsjs inaccuracy (our core passes ZEXALL): flag bits 3/5; BIT's S, P/V, X/Y; R not incremented on an interrupt; R counted three times on DDCB/FDCB; a request raised while interrupts are disabled dropped instead of held. trsjs has no license, so it is fetched on demand into a gitignored folder, pinned by SHA-256, used only locally, never committed — exactly like the ZEX exercisers.

**Tech Stack:** plain JavaScript ESM, Node ≥ 22 (`node:vm`), Vitest.

**Spec:** `docs/fugloy-emu-spec.md` §10 (Differential row), §11 row 7, §12 (the open question "which external emulator is the differential reference" — answered: trsjs, a trs80gp derivative), §13 story 5.

## Global Constraints

- trsjs is never committed, bundled, or redistributed; `pnpm trsjs:install` downloads it into `tools/trsjs/` (gitignored) and refuses a file whose SHA-256 differs from the pinned `d6e5b270ba23d429c8fe548573b680a1c8b2b1a8e11d65886c4fb9778ac052fc`. Tests that need it are opt-in behind `FUGLOY_TRSJS=1` and skip without it; CI is unaffected (a CI job may be added later only if the user agrees to fetch it there).
- The harness is test and tooling code: it lives under `packages/emu/test/diff/` and `packages/emu/scripts/`; `src/` gains nothing that depends on trsjs.
- Determinism: a harness run is repeatable byte for byte.
- No copyrighted material committed (programs come from `examples/` or `fixtures/real/`; the ROM from the user's config).
- Commit messages: imperative, one line, prefix `e7:`. No `Co-Authored-By` or any AI trailer.
- Keep `docs/fugloy-emu-spec.md` (§10, §11, §12), `CLAUDE.md`, `CHANGELOG.md` (detailed), and the emu README current.

## Rulings made while planning

1. **Model III only.** trsjs emulates the Model III; Model I differential testing waits for a Model I reference (MAME or xtrs, which needs the user's agreement to install). Record it in §11.
2. **Known differences are explicit** (`test/diff/known.js`, as built in Task 2; each class carries its evidence — ZEXALL, Young's "The Undocumented Z80 Documented" 0.91, Zilog UM0080 — and a count in the report). Three kinds:
   - *Step classes*, each a predicate naming the exact fields it explains (single flag bits, R, the writes): flag bits 3/5 (X/Y); BIT's S and P/V (only when our F obeys Young §4.1); R not counted on an interrupt response (exactly 1); R counted three times on DDCB/FDCB (exactly 1); HALT: trsjs pushes the HALT's own address (we push HALT+1, Young §5.4); CPI/CPD/CPIR/CPDR: trsjs sets C on a mismatch (added in Task 3, found on Asylum; Zilog UM0080: C not affected; explained only when our C is unchanged and theirs is the opposite of its Z). A step is known only when the classes together explain every differing field; the reference is then resynced from our state (registers, cycle count, 30 Hz phase, the bytes written).
   - *Interrupt classes* — a request trsjs drops while DI, takes right after EI, or takes after a lone DD/FD — are kept as a held request with its reason; when our CPU takes it, the reference is made to take it at the same boundary and the step is compared in full, nothing excused.
   - *Reference fixes*: a DD/FD the next instruction ignores, which trsjs skips with both bytes in 0 T-states; the reference is made to run it as the Z80 does (the prefix as one M1, then the instruction unprefixed) and the step is compared in full.
   - *Adapter corrections* (Task 3), made in the reference's script text, each with a test: a CPU write below $3C00 is dropped (Model III ROM and keyboard; trsjs stored from $3000 up, found on Eliminator d/f/g/h); a stored value is masked to 8 bits (trsjs's RLD/RRD stored 12, found on Asylum 1g); PC and the (IX+d) address wrap at 16 bits (trsjs ran PC to $10000, found on Planetfall); a repeating CPDR takes 21 T-states (trsjs counted none, found on Asylum 1g).

   `--strict` stops on any known class except X/Y (which differs within a few instructions in most programs); `--strict-all` stops on that one too.
3. **Keyboard input** goes to both machines through the matrix at the same T-states (`set_key_bit` on trsjs; our matrix directly) — never our ROM keyboard hook, which replaces instructions trsjs would execute.
4. **Start state.** Both start from our machine's state at the comparison's first instruction: RAM, video RAM, registers, IFF, IM, port latches the reference models, and the RTC phase (spike: trsjs fills RAM with $76 and video with $00, and resets SP to $0000; sync them).
5. **What is compared** after every instruction: PC, all registers (F and F' bit by bit, bits 3/5 included: they are counted as the X/Y class rather than masked, so a run shows how often they differ; R as 7 bits), IFF1/2, IM, the instruction's T-states, and every memory write (address and value) logged on both sides; video RAM compared at the end and on every divergence. Mapped, not counted: our IFF reads as set during EI's delay, and our halted PC (HALT+1) is compared less one.

## Review Focus

1. A run whose programs differ only by a known class must report zero unexplained divergences and the class counts (Task 2 test on a synthetic program exercising each class).
2. A planted bug in our core (a test-only monkeypatch flipping one flag in one opcode) must be caught at the right instruction with context (Task 2 test) — proving the harness can fail.
3. A missing or tampered `tools/trsjs/trsemu-1.6.js` must refuse with a sentence naming `pnpm trsjs:install` and the hash (Task 1 test).
4. Keys typed in a scripted session must reach both machines at the same T-state and leave both in the same state (Task 3 test on Rear Guard's "1 or 2 Players?").
5. Long runs must stay fast enough to be useful (≥ 1M instructions per few seconds on this machine; report the number).

---

### Task 1: Install script and the trsjs adapter

**Files:** Create `scripts/install-trsjs.sh` (root, beside `install-zex.sh`; add `trsjs:install` to package.json), `packages/emu/test/diff/trsjs-adapter.js`, `packages/emu/test/diff/trsjs-adapter.test.js`; update `.gitignore` (tools/ is already ignored — confirm `tools/trsjs/` is).

**Interfaces:** `loadTrsjs({ path }) → Reference` with `reset()`, `step() → { cycles }`, `regs() → our m.cpu.regs shape (R 7-bit)`, `peek(addr, len)`, `poke(addr, bytes)`, `setKeyBit(row, bit, down)`, `alignRtc(phaseTStates)`, `syncFrom(machine)`, `writes()` (the last step's memory writes). Build it from the spike's `scratchpad/trsjs/trsjs-adapter.mjs` (read it), keeping the SHA-256 check before loading.

- [ ] Steps: failing tests (refuses a missing/tampered file; boots the ROM 100,000 instructions and matches our T-states/PC per instruction with the known classes masked; syncFrom then step matches our step), run, implement, run, commit `e7: fetch trsjs on demand and drive its Z80 from Node`.

### Task 2: The lockstep comparator and the divergence report

**Files:** Create `packages/emu/test/diff/compare.js`, `packages/emu/test/diff/known.js` (the classes, Ruling 2), `packages/emu/scripts/diff.mjs` (CLI: `pnpm diff <program> [--keys <script>] [--instructions N] [--from-cycle C] [--strict | --strict-all]`), tests `packages/emu/test/diff/compare.test.js`.

**Interfaces:** `compareRun({ machine, reference, instructions, keys, strict }) → { instructions, divergence: null | { index, pc, ours, theirs, context: [{pc, text, ours, theirs}], writes }, known: { class: count } }`; the CLI prints a report with ±10 instructions disassembled (via `@fugloy/z80`).

- [ ] Steps: failing tests (each known class counted, not failed; `--strict` stops on one; a planted flag bug caught at the exact instruction with context; memory-write mismatch caught; determinism of a report), run, implement, run, commit `e7: compare the two machines instruction by instruction and report the first divergence`.

### Task 3: The fixtures, long runs, and docs

**Files:** `packages/emu/test/diff/fixtures.test.js` (opt-in, ROM- and trsjs-gated); docs.

- [ ] Steps: run each Model III fixture that runs without a disk — Sea Dragon, Eliminator, Rear Guard, Armored Patrol from `examples/`, plus the Model III `.CMD` samples in `fixtures/real/` — from load through a scripted session (the emu phase 2 title-screen scripts, with keys, Ruling 3) for at least 10 million instructions each; zero unexplained divergences, with the per-class counts recorded; investigate and fix (in our core, with a test) any real divergence where our emulator is wrong — or add a class with evidence where trsjs is; measure speed; docs (spec §10 Differential row, §11 row 7 Met for the Model III with the counts, §12 question answered, CLAUDE.md, CHANGELOG, emu README "Differential testing" section); commit `e7: run the Model III fixtures against trsjs with no unexplained divergence` and `e7: document emu phase 7`.
