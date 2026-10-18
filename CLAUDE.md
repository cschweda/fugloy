# Fugløy

TRS-80 Model I/III disassembler and (later) recompiler. The full design is in
`docs/Fugloy-Project-Plan.md`; read it before any non-trivial change. This file
holds the conventions that are not in the plan and the rules for working here.

## What we are building right now

v1, phases 1–4 of the plan, shipped as 1.0.0 on 2026-10-17. The emulator's
later phases follow, in the Roadmap's order. The recompiler and
bundler stay in Part 2 until the plan's kill criteria have been reviewed. If a
task seems to need machinery from a later step, stop and say so.

Current phase: **v1 released as 1.0.0 (2026-10-17), core 1.2.0, `@fugloy/emu` 0.2.0, and `@fugloy/mcp` 0.1.0 on npm (2026-10-18); emu phases 2 and 3 merged to `main` (2026-10-18); emu phase 4 (`@fugloy/mcp` v0.1, MCP phases A–C) merged to `main` (2026-10-18); MCP phases A–F done; emu phase 5 (disk controller and images) merged (2026-10-18), unreleased; emu phase 6 done for the Model I on branch `emu-phase6`, not yet merged, with the Model 4 split off into its own plan; after the merge, emu phase 7 (the differential harness) is next.**
v1 is disassembler phases 1–4: the core decoder and loaders (v0.1.0), Pass 1
and Pass 2 (v0.2.0), the cited symbol tables (phase 3: eight JSON tables, 634
entries, in `packages/disasm/data/symbols/`, compiled by `pnpm symbols`), and
the web workbench in `apps/web` (phase 4: Nuxt 4 + Nuxt UI, static; design
`docs/superpowers/specs/2026-10-17-phase4-web-workbench-design.md`, plan
`docs/superpowers/plans/2026-10-17-phase4-web-workbench.md`), including the
**Explain** tab (design `docs/superpowers/specs/2026-10-17-explain-tab-design.md`;
engine `packages/disasm/src/explain/`, UI
`apps/web/app/components/side/ExplainTab.vue`), block comments (the hint
file's `note` directive, the `:` key), and an annotated Sea Dragon
(`examples/sea-dragon/seadrg01.hints`). The site is deployed on Netlify from `main` at
`app.fugloy.dev` (live since 2026-10-18, Let's Encrypt; DNS at DNSimple);
`fugloy.dev` and `www.fugloy.dev` 301 to it (ask the user before any DNS
change). Emu phase 1 is done: the Z80 core in `packages/emu` passes ZEXDOC and
ZEXALL, all 67 groups each (`pnpm zex:install`, then `FUGLOY_ZEX=1`), and its
T-states match `@fugloy/z80` for every opcode. Emu phase 2 is done: the
`Machine` facade (`step`, `run`, registers, memory), `m.video.text()`, the
`m.sound` ring, the cycle-timed `m.keyboard` queue with the ROM keyboard-scan
hook, and the `.CMD`, `.BAS`, and `.CAS` loaders with manifests
(`docs/fugloy-emu-spec.md` §3, §6, §11; plan
`docs/superpowers/plans/2026-10-17-emu-phase2.md`). Sea Dragon, Eliminator, and
Rear Guard reach their title screens through `Machine` (Armored Patrol was
rejected), and a scripted session repeats byte for byte. Emu phase 3 is done
(merged 2026-10-18): `m.debug` (breakpoints, watches,
hooks, coverage, callers, trace, snapshots, labels) and `m.debug.labelFile()`,
read by the disassembler and the CLI's `--labels`; a scripted session's label
file feeds the disassembler (plan
`docs/superpowers/plans/2026-10-18-emu-phase3.md`), and Sea Dragon's is
committed as `examples/sea-dragon/seadrg01.labels.json`. Emu phase 4 is done
(merged 2026-10-18): `@fugloy/mcp` v0.1 with MCP phases
A–C, 23 tools (lifecycle, execution, inspection; break, watch, hits, trace,
callers, disasm; label, labels, coverage, suggest, and the
`<program>.fugloy.json` sidecar), plan
`docs/superpowers/plans/2026-10-18-emu-phase4-mcp.md`. A headless Claude Code
session found Sea Dragon's print routine (`$6140`) and labelled it unaided;
`packages/mcp/test/story-7-rom.test.js` is the scripted form. MCP phases
D–F are done (plan
`docs/superpowers/plans/2026-10-18-mcp-phases-d-f.md`): snapshots,
`restore`, `diff`, `search`, `callees` (D); resources, the four prompts, and
the ROM symbols resource (E); guardrail tests, golden transcripts for stories
1–3, and the `publish.sh` `mcp` set (F), 29 tools in all. Story 7 ran
unaided on Sea Dragon, Eliminator, and Rear Guard (the release check, MCP
spec §10; results in the CHANGELOG and `packages/mcp/README.md`). Published
(2026-10-18): core 1.2.0 (`v1.2.0`), emu 0.2.0 (`emu-v0.2.0`), mcp 0.1.0
(`mcp-v0.1.0`). Emu phase 5 is done and merged (unreleased;
plan `docs/superpowers/plans/2026-10-18-emu-phase5.md`): `m.fdc` (mount,
unmount, drives, export as DMK) and `m.load.dsk`; the WD1793 follows the
FD179X data sheet item by item, with what is unverified listed in emu spec
§5; JV1, JV3, and DMK read exactly; MCP `load` detects a disk image by content
and boots it from drive 0. The local dual-boot DMKs (Eliminator, Rear Guard)
boot to their Duo-Loader menu and load each game to its title, and Scarfman
boots to its title (`packages/emu/test/integration/disk-boot.test.js`); no
TRSDOS 1.3 image is present, so the emu spec §10 TRSDOS row stays open.
Disk images stay in the gitignored `fixtures/real/`; synthetic ones are in
`fixtures/synthetic/disk/`. Release coupling: MCP `load` now needs emu's
`m.fdc`, `m.load.dsk`, `DiskImage`, and `CPU_CLOCK_HZ`, which emu 0.2.0 lacks,
so emu must be bumped to 0.3.0 and released before the next `@fugloy/mcp`
release. Emu phase 6 is done for the Model I on `emu-phase6`, unmerged (plan
`docs/superpowers/plans/2026-10-18-emu-phase6-model1.md`): `new Machine({
model: 1, ram, expansion, lowercase })` (models described in
`src/machine/models.js`; the Model III's save state is byte-identical to
before), the Level II ROM (1.2 and 1.3 recognised), 4–48K, the Expansion
Interface's 40 Hz latch at `$37E0`, WD1771 at `$37EC`–`$37EF`, and printer,
the bit-6 video gate and the lowercase option, port `$FF` and 500-baud
cassette, and the keyboard with the scan hook. Fourteen `.CMD` programs reach
their titles on it (`packages/emu/test/integration/model1-programs.test.js`)
and the four local disks boot (`model1-disk.test.js`); MCP `load` takes
`model: 1` on `roms.model1`, and its timing follows the machine's clock (emu
spec §5, §11; MCP spec §5). The Model 4 is split off (phase 6 plan, Ruling 1):
no Model 4 ROM or boot disk is in `fixtures/real/`, so "its ROM boots" cannot
be proven, and it becomes its own plan when one is supplied. The emu 0.3.0
release also carries the Model I, which the next mcp needs. The Sea Dragon
speed test runs only with `FUGLOY_BENCH=1` (it flaked beside the parallel
suite); `./publish.sh check` runs it alone after the suite. Next: merge
`emu-phase6`, then emu phase 7 (the differential harness).

## Stack and layout

- pnpm monorepo. Node 22 LTS. TypeScript strict, ESM only.
- `packages/z80` — opcode table generated from the x/y/z/p/q decomposition, plus
  per-instruction length, operands, cycle count, control-flow effect. No I/O.
- `packages/disasm` — loaders (.CMD, .BAS, raw), memory image, passes, symbol
  tables, IR, emitters. No DOM, no Node APIs; must run in a browser.
- `packages/cli` — Node wrapper over disasm. The only package that touches `fs`.
- `apps/web` — Nuxt 4 + Nuxt UI, static generation, no server routes (phase 4).
  The folder is `apps/web` (package `@fugloy/web`); the emu spec's
  `apps/workbench` means the same app. Its tests run with `pnpm test:web`,
  its browser tests with `pnpm --filter @fugloy/web test:e2e`.
- `packages/emu` — headless, deterministic TRS-80 emulator core (the Model III
  and, from emu phase 6, the Model I), plain JavaScript ESM, no DOM, no Node APIs. Spec: `docs/fugloy-emu-spec.md`.
  Extracted from `cschweda/trs80-emulator` in its phase 0 (`NOTICE.md`); tests
  that need a ROM read its path from the gitignored `fugloy.mcp.json`.
- `packages/mcp` — stdio MCP server over emu. Spec: `docs/fugloy-mcp-spec.md`.
  Plain JavaScript ESM, no build step; the bin is `bin/fugloy-mcp.js`, which
  imports disasm and z80 from their `dist/` (run `pnpm build` or
  `pnpm typecheck` first). Depends on emu, disasm, and z80 as `workspace:^`
  (pnpm pack rewrites them to `^0.2.0` and `^1.2.0`), and on the MCP SDK and
  zod at exact versions. Phases A–F are built: one machine per process
  (a Model III, or a Model I from `load { model: 1 }` on `roms.model1`),
  every result text, errors as sentences,
  stdout JSON-RPC only. It writes only the sidecar `<program>.fugloy.json`
  and explicit `coverage export` paths. Tests run on a synthetic ROM in CI;
  `phase-a-rom` and `story-7-rom` need the ROM in `fugloy.mcp.json`. Golden
  transcripts are committed only for synthetic sessions
  (`test/golden/story-0{1,2,3}.txt`). Story and MCP prompts live in
  `packages/mcp/prompts/` (shipped in the package; the root `prompts/` is a
  README pointing there); the dev config is `.mcp.json.example` (copy to the
  gitignored `.mcp.json`).
- `docs/label-format.md` — the label and coverage file shared by emu, mcp,
  and disasm (§8 of the emu spec).
- `fixtures/synthetic` — committed, generated by the test suite's writers.
- `examples/` — committed public-domain programs: the Westmoreland and Gilman
  games released into the public domain in 1995 (Sea Dragon, Rear Guard,
  Eliminator, Armored Patrol). The tests read them like samples, so CI runs
  real-program tests. Nothing copyrighted goes here, and no build that
  carries someone else's code or credit.
- `sample/` — gitignored. Copyrighted sample programs live here; tests
  that need them call `skipIfMissing()` and must pass when the folder is empty.
- Tests: Vitest. Every loader rule in the plan has a synthetic fixture and a
  test named after the rule.

## Roadmap

1. **disasm — phase 2 (shipped as v0.2.0).** Pass 1 and Pass 2 per the plan:
   recursive descent, zmac emitter and image round trip, labels, hint file,
   hidden-code detection, heuristics, rebasing, relocation. Sub-projects A
   (Pass 1 and the round-trip proof), B (labels and the hint file), C (hidden
   code, heuristics, rebasing, relocation).
2. **disasm — phase 3, then phase 4 (released as v1, 1.0.0, 2026-10-17)**:
   symbol tables, then the web workbench. Emu phases 2+ and the MCP server
   follow.
3. **emu — phases 0–7** (`docs/fugloy-emu-spec.md` §11). 0: import
   `cschweda/trs80-emulator`, strip DOM, boot to `READY` in Node. 1: Z80 core
   passes ZEXALL. 2: Model III devices and `.CMD`/`.BAS`/`.CAS` loaders.
   3: debugger API, coverage, the label file. 4: `@fugloy/mcp` v0.1. 5: FDC
   and disk images. 6: Model I, then Model 4. 7: differential harness. Phases 0,
   1, 2, and 3 are done and merged; phase 4, `@fugloy/mcp` v0.1, is done and
   merged; emu 0.2.0 and mcp 0.1.0 are on npm (2026-10-18); phase 5 is done
   and merged; phase 6 is done for the Model I on `emu-phase6`, unmerged. The
   Model 4 half of phase 6 is split off (2026-10-18): with no Model 4 ROM or
   boot disk in `fixtures/real/`, "its ROM boots" cannot be proven, so it
   becomes its own plan once one is supplied. Phase 7 is next.
4. **mcp — phases A–F** (`docs/fugloy-mcp-spec.md` §11). A: lifecycle,
   execution, and inspection tools. B: break, watch, trace, callers, disasm.
   C: labels, coverage, sidecar file. D: snapshots, diff, search, callees.
   E: resources, prompts, ROM symbols. F: guardrails, golden transcripts, npm
   publish. A starts after emu phase 0; B and C need emu phase 3. A, B, and
   C are done (emu phase 4, merged); D, E, and F are done and merged, and
   `@fugloy/mcp` 0.1.0 is on npm (2026-10-18).

The plan's phase 5 (assembler and IDE) is not placed in this sequence: it comes
after v1 and needs phases 3 and 4 and emu phases 2–3. Phase 6, **Learn assembly
with Fugløy** (requested 2026-10-17), follows phase 5: an introduction to
assembly language for non-programmers, not only retro fans, on the small and
straightforward Z80, with instant feedback (Explain's tutor voice on each line
written, the assembler and emulator running the code) and a tutorial that
builds a Space Invaders-style game from a blank page (a base along the bottom,
a shot going straight up, invaders marching left and right and inching down,
as Big Five's Super Nova did), opening the public-domain games side by side.
It needs phase 5 and emu phases 2–3; audience, lesson format, and how much
TRS-80 to hide are decided at design time. No estimate yet. When phase 4 builds the
site, it gets a "technical details" page carrying the interactive explainer of
how Fugløy was built (dark, infographic, many examples, written for a curious
student or retro enthusiast; requested 2026-10-16). Its source is
`docs/technical-details/inside-fugloy.html`. The site also ships full SEO
(requested 2026-10-16): a title and description on every page, canonical
URLs on `app.fugloy.dev`, Open Graph and Twitter card tags whose image is
the social card `docs/images/og-image.png` (1200×630, at an absolute URL,
with alt text), favicons from the card's ø tile, `robots.txt`,
`sitemap.xml`, and JSON-LD. The card's source is `docs/images/og-image.svg`.

## Conventions

- Addresses print as uppercase hex with a `$` prefix in prose and `H` suffix in
  emitted assembly (`$3C00` in comments and docs, `3C00H` in zmac output).
- The 64K image is a `Uint8Array(65536)` with a parallel `Uint8Array` bitmap;
  never a sparse map.
- Opcode tables are generated, never hand-edited. If a decode is wrong, fix the
  generator and the exhaustion test, not the table.
- Hint-file format is line-oriented text keyed by `block <index>:<offset>` as the
  plan specifies; do not switch to JSON without updating the plan first.
- Symbol tables are data files (`packages/disasm/data/symbols/*.json`), one per
  table, each entry with a `cite` (a `sources.json` id and a page), compiled by
  `pnpm symbols` into `src/symbols/tables.generated.ts`, which is never
  hand-edited. No symbols in code.
- Detect file format from content, never from extension.
- No external runtime dependencies in `z80` or `disasm`. Dev dependencies are
  fine.

## Working rules

- Finish the phase's deliverable before polishing. A CLI that prints a correct
  linear sweep beats a half-built recursive descent.
- When the plan and the code disagree, say which one should change rather than
  silently picking one.
- Keep `docs/Fugloy-Project-Plan.md` current: when a decision in it is
  superseded, edit the plan in the same change.
- Commit messages: imperative, one line, phase-prefixed (`p1: add .CMD loader`).

## Reference facts (from the plan's appendix)

- .CMD `01` record length byte counts the 2 address bytes and wraps: 0 → 254
  data bytes, 1 → 255, 2 → 256.
- .BAS line: 2-byte next pointer, 2-byte line number, body, `00`; two zero bytes
  end the program. Line *N*'s body is at `ptr(N-1) + 4`.
- Hidden BASIC code is detected by parse validity, not byte statistics — the
  token range `80`–`FB` overlaps common Z80 opcodes.
- Only `RST 08H` takes an inline parameter byte.
