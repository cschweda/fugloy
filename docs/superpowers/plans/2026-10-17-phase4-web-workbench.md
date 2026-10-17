# Phase 4: Web Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static Nuxt site at `app.fugloy.dev` where you drop a TRS-80 program, or click one of four public-domain games, and read, annotate, save, and export it. The layout is two facing pages, dark first, with a spec sheet for the program, bring-your-own manuals opened at the cited page, and runnable `.CMD`/`.CAS` exports.

**Architecture:** Everything that is not presentation goes into `@fugloy/disasm`, which the CLI and the site share:
- a `Session` that opens a program and re-analyzes it under a hint file;
- structured listing rows, which the text listing becomes a formatter over;
- program facts for the spec sheet;
- an address-keyed hint directive;
- `.CMD` and `.CAS` writers.

`apps/web` (Nuxt 4 + Nuxt UI, static generation) holds one observable session state. It turns every edit into a hint-file change, re-analyzes, and renders a virtualized listing. User data lives only in IndexedDB.

**Tech Stack:** TypeScript strict ESM, Vitest, Nuxt 4.6, Nuxt UI 4.12, `pdfjs-dist` 6.4 (web only, lazy), `@tanstack/vue-virtual` 3.13 if the prototype picks it, Playwright 1.64, Netlify.

**Spec:** `docs/superpowers/specs/2026-10-17-phase4-web-workbench-design.md`. Read it in full before any task. Layout, keys, the spec sheet, manuals, storage, and exports are decided there and not repeated here.

## Global Constraints

- `packages/z80` and `packages/disasm`: no DOM, no Node APIs, no runtime dependencies. Only tests and `scripts/` touch `fs`.
- `apps/web`: static generation, no server routes, no server storage, no accounts, no network calls carrying user files. The only third-party requests are Google Fonts (if used) and archive.org cover images on the Manuals page and citations.
- Nothing copyrighted is committed or bundled: no ROMs, no manual text or page images, no `sample/` programs. Bundled programs are the four games in `examples/` only.
- Formats are detected from content, never extension (drop zone included).
- Addresses: `$3C00` in prose and UI chrome, `3C00H` in emitted assembly. The listing text is exactly what the CLI prints.
- The text listing, zmac output, and IR of every existing test input stay byte-identical across the library refactors (Tasks 1 and 3), except where a task names the change.
- Hint-file changes are made in the plan's "Hint file" section before the code (Task 2).
- Dark theme is the default and must be excellent. Desktop first. Narrow screens show one page at a time and a "best on desktop" notice, and never scroll horizontally.
- The full suite passes in a clean worktree with no `fixtures/real` and no `sample/` (`git worktree add`, run there).
- Commit messages: one line, imperative, prefixed `p4:`, no AI co-author or session trailers.
- Ask the user before the first Netlify deploy and before any DNS change.

## Review Focus

1. **A dropped file that is neither a `.CMD` nor a `.BAS`** (a `.DSK`, a PDF, a JPEG, a 0-byte file): the drop zone says what it is not and offers "load as raw binary at…", and never throws or blanks the page. A PDF dropped on the workbench suggests the Manuals page. Task 9.
2. **A rename to an invalid name**: a reserved word (`LD`), a generated-label shape (`L1234`), another label's name ignoring case, or a table name already used in the listing. It is refused inline with `isValidName`'s or the collision's reason, and the hint file is unchanged. Task 12.
3. **Hints saved for one build, opened on another build** (seadrg02 with seadrg01's hints carried over): matched blocks apply, unmatched blocks' hints are listed in the Hints tab, and nothing is silently dropped. Task 13.
4. **Exporting a program that cannot run as exported**: a `.CAS` of a program that calls the DOS, or one whose blocks load under `$4200`. The export still downloads, with a warning naming the reason. An exported `.CMD` of `ARMOUR.III` (overlapping patch) reloads to the same image and entry. Task 14.
5. **IndexedDB unavailable or full** (a private window; a 200 MB PDF over quota): the workbench still opens and edits, the status line says "not saved (storage unavailable)", and adding a manual explains why it failed. Tasks 13 and 16.

---

### Task 1: Session — one way to open and analyze a program

**Files:**
- Create: `packages/disasm/src/session.ts`
- Modify: `packages/disasm/src/index.ts`, `packages/cli/src/index.ts` (use the session; keep flag parsing and messages in the CLI)
- Test: `packages/disasm/test/session.test.ts`; existing `packages/cli/test/**` must pass unchanged

**Interfaces:**
- Produces (`src/session.ts`, exported from the package root):
  - `interface OpenOptions { name?: string; base?: number; selection?: SymbolSelection; entries?: number[]; rebasedFrom?: number }`
  - `interface Session { readonly name: string; readonly bytes: Uint8Array; readonly module: Module; readonly hash: string; readonly normalize: IdentityNormalizer | undefined; readonly selection: SymbolSelection | undefined; readonly entries: readonly number[]; readonly hintFile: HintFile; readonly hintSource: string | undefined; readonly applied: Applied; readonly analysis: Analysis; readonly plainBasic: boolean }`
  - `class OpenError extends Error { readonly kind: 'format' | 'hints'; readonly details: readonly string[] }`
  - `function openProgram(bytes: Uint8Array, opts?: OpenOptions): Session`. Throws `OpenError('format')` when there is no `base` and `detectFormat` says neither `cmd` nor `bas`.
  - `function skeletonHints(mod: Module, bytes: Uint8Array): HintFile`: version 1, `program: programHash(bytes)`, every block identity, no hints (what `--write-hints` writes today).
  - `function withHintFile(s: Session, file: HintFile, source?: string): Session`. Throws `OpenError('hints')` with `applied.errors` as `details`.
  - `function withHintText(s: Session, text: string, source?: string): Session`. Throws `OpenError('hints')` with `parseHints` errors as `details` (`line N: message`).
  - `function withSelection(s: Session, selection: SymbolSelection | undefined): Session`
  - `function addressKey(s: Session, addr: number): { block: number; offset: number } | null`: the hint key for a runtime address. A relocated address maps through `space.toFile`. Null when the address is not loaded.
  - `function renderSession(s: Session, format: 'listing' | 'zmac' | 'ir'): string`: exactly what the CLI prints for that format today.
- `plainBasic` keeps the CLI's rule, with "no `--hints`" read as "the hint file holds no hints": `.bas`, no entries, `hintFile.hints.length === 0`, no `rebasedFrom`, no mined entries, every line parsed. If an existing CLI test depended on the difference (a `--hints` file with zero hints on a plain `.BAS`), stop and report rather than change the test.

- [ ] **Step 1: Write the failing tests.** In `session.test.ts`:
  - `openProgram(seadrg01)` gives `module.format === 'cmd'`, `hintFile.hints.length === 0`, and `hash === programHash(bytes)`.
  - `renderSession(s, 'listing')` equals `run(['examples/sea-dragon/seadrg01.cmd'])` stdout.
  - `withHintText(s, <seadrg01.hints text>, 'seadrg01.hints')` then `renderSession(_, 'listing')` equals the CLI with `--hints` (the CLI's own header line included).
  - `withSelection(s, { machine: 1, dos: 'ldos' })` names as `--machine 1` does.
  - `addressKey(_, 0x497F)` under the hints is `{ block: 0, offset: 0 }` (the relocated game start maps to file `$5200`).
  - `openProgram(new Uint8Array([0xDE, 0xAD]))` throws `OpenError` with `kind === 'format'`.
  - `withHintText(s, 'nonsense')` throws `OpenError` with `kind === 'hints'`.
- [ ] **Step 2: Run** `pnpm vitest run packages/disasm/test/session.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `session.ts`** by moving the glue in `packages/cli/src/index.ts` (lines ~228–345: load, normalize, apply hints, analyze, choose renderer) into these functions. Sessions are immutable: each `with…` returns a new one.
- [ ] **Step 4: Rewrite the CLI's body over the session.** `--write-hints` uses `skeletonHints`. Error messages stay word for word.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm test`. Expected: all pass, including every CLI test untouched.
- [ ] **Step 6: Commit** `p4: open and analyze programs through a shared session`

### Task 2: Names and comments outside the program (`at` directive)

**Files:**
- Modify: `docs/Fugloy-Project-Plan.md` ("Hint file": the directive and the reworded "Identity" bullet, per the spec), `packages/disasm/src/hints/format.ts`, `src/hints/apply.ts`, `src/emit/zmac.ts`, `src/listing.ts`, `src/ir.ts`
- Test: `packages/disasm/test/hints/at.test.ts`, `packages/disasm/test/roundtrip/hints.test.ts` (one more case)

**Interfaces:**
- Syntax, one per line, outside any `block` section:
  - `at $7F00 name SCORE`
  - `at $7F00 comment text to end of line`
  - Addresses use `parseNumber`.
- `Hint` gains a variant `{ directive: 'name' | 'comment'; at: number; … }` with `block: -1, offset: -1`. Writers and parsers round-trip it. Choose the representation; `writeHints(parseHints(x).file)` must reproduce `x`'s `at` lines.
- `applyHints`: an `at` name goes into `annotations.names`, an `at` comment into `annotations.comments`, keyed by the runtime address. An `at` hint on a **loaded** runtime address is not applied, and gives a warning: `at $5200 names a loaded address; use block 0:$0000 instead`.
- zmac: a user symbol at an address the image does not load gets `NAME\tEQU\tnnnnH` (with `\t; comment` when there is an `at` comment), after the table `EQU`s and before the Tail `EQU`s.
- Listing header: one line per such symbol, `; name SCORE = $7F00` plus `: comment` when there is one, after the table-name legend.
- IR: `symbols` already lists user symbols. Add `comment?: string` to symbols that have an `at` comment.

- [ ] **Step 1: Update the plan's "Hint file" section** (directive, example, loaded-address rule; "Identity" reworded as the spec says). Commit `p4: add the address-keyed name and comment directive to the plan`.
- [ ] **Step 2: Write the failing tests.**
  - `parseHints('at $7F00 name SCORE\nat 7F01H comment lives')` gives two hints with `at` set.
  - `writeHints` round-trips them.
  - `at $7F00 name LD` is an error (`name "LD" is reserved`).
  - With a raw program at `$7000` containing `LD A,(7F00H)`, the hint `at $7F00 name SCORE` gives the listing row `LD A,(SCORE)`, the header line `; name SCORE = $7F00`, and zmac output containing `SCORE\tEQU\t7F00H` that assembles back to the identical image (roundtrip harness).
  - `at $7000 name START` gives the warning above and is not applied.
- [ ] **Step 3: Run** `pnpm vitest run packages/disasm/test/hints/at.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** in `format.ts`, `apply.ts`, `zmac.ts`, `listing.ts`, `ir.ts`.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm test` (zmac installed). Expected: PASS, every other output byte-identical.
- [ ] **Step 6: Commit** `p4: name and comment addresses outside the loaded image`

### Task 3: Structured listing rows

**Files:**
- Create: `packages/disasm/src/rows.ts`
- Modify: `src/listing.ts` (`renderPass1Listing` and `renderBasListing` become `rows.map(formatRow)`), `src/index.ts`
- Test: `packages/disasm/test/rows.test.ts`, plus golden files in `packages/disasm/test/__snapshots__/rows/` written in Step 1

**Interfaces:**
- Produces:
  - `type SpanKind = 'mnemonic' | 'register' | 'condition' | 'number' | 'label' | 'table' | 'string' | 'punct' | 'directive'`
  - `interface Span { text: string; kind: SpanKind; target?: number; entry?: TableEntry }`
    - `target` is set on `label` and `table` spans that stand for an address, port, or service call.
    - `entry` is set on `table` spans.
  - `type Row` is one of:
    - `{ kind: 'header'; text: string }`: a `; …` line before the first `ORG` or BASIC line
    - `{ kind: 'blank' }`
    - `{ kind: 'org'; addr: number }`
    - `{ kind: 'label'; addr: number; name: string; user: boolean }`
    - `{ kind: 'code' | 'data'; addr: number; bytes: number[]; spans: Span[]; comment?: string }`
    - `{ kind: 'note'; text: string; addr?: number }`: relocated-piece notes, code-line labels, in-line `; symbol` lines, BASIC note lines
    - `{ kind: 'basic'; line: number; addr: number; text: string }`
  - `function listingRows(a: Analysis, opts?: RenderOptions): Row[]`
  - `function basRows(prog: BasProgram, opts?: RenderOptions): Row[]`
  - `function formatRow(row: Row): string`: the exact text line the listing prints today.
  - `function rowIndex(rows: readonly Row[]): Map<number, number>`: address → index of its `code`/`data` row, or of its `label` row when it has one.
- Span rule: the spans of a `code`/`data` row concatenate to exactly the `text` part of the old line. Operand names carry `target`. Work out externals and comment entries once per call (this settles the phase 3 note on recomputation).

- [ ] **Step 1: Capture goldens before touching `listing.ts`.** A one-off test writes, for every synthetic fixture, every example under `examples/`, and Sea Dragon with its hints, the current `renderPass1Listing` and `renderBasListing` text to `__snapshots__/rows/<name>.txt`. Commit the goldens with the test: `p4: capture listing goldens before the row refactor`.
- [ ] **Step 2: Write the failing tests.**
  - For each golden, `listingRows(...).map(formatRow).join('\n') + '\n'` equals it.
  - In seadrg01 with hints, the row at `$499F` has spans `OUT` (mnemonic), `(MODEPORT)` split as `(`, `MODEPORT` (table, `target` 0xEC, `entry.name === 'MODEPORT'`), `)`, `,`, then `A` (register).
  - The row at `$499A` has a `label` span `SUB_4B9E` with `target` 0x4B9E.
  - `rowIndex` maps 0x49B1 to the `label` row `L49B1`.
- [ ] **Step 3: Run** `pnpm vitest run packages/disasm/test/rows.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `rows.ts`** by moving the row-building out of `renderPass1Listing` and `renderBasListing`. Then make both renderers `rows.map(formatRow)`.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm test`. Expected: PASS, goldens identical.
- [ ] **Step 6: Commit** `p4: build listings from structured rows`

### Task 4: Program facts for the spec sheet

**Files:**
- Create: `packages/disasm/src/facts.ts`
- Modify: `src/index.ts`
- Test: `packages/disasm/test/facts.test.ts`

**Interfaces:**
- Produces:
  - `type MachineFit = 'model1' | 'model3' | 'both' | 'unknown' | 'conflict'`
  - `interface MachineEvidence { machine: 1 | 3 | 'both'; key: number; kind: 'port' | 'rom' | 'memory'; name: string; text: string }`
  - `interface ProgramFacts`, with fields:
    - `format: 'cmd' | 'bas' | 'raw'`
    - `name?: string`: the `.CMD` `05` name
    - `records?: number`
    - `loads: { start: number; end: number }[]`
    - `size: number`
    - `entry: number | null`
    - `entryHow: 'transfer' | 'lowest' | 'base' | 'hint' | 'mined' | 'none'`
    - `relocations: { file: number; run: number; length: number }[]`
    - `memoryNeeded: 16 | 32 | 48`
    - `machine: { fit: MachineFit; evidence: MachineEvidence[] }`
    - `hardware: TableEntry[]`
    - `romCalls: TableEntry[]`
    - `dosCalls: TableEntry[]`
    - `code: { bytes: number; of: number; percent: number; routines: number }`
  - `function programFacts(a: Analysis): ProgramFacts`
- Machine rule. The verdict is independent of the selection: look every external reference up in both `selectSymbols({ machine: 1, dos: 'none' })` and `selectSymbols({ machine: 3, dos: 'none' })`.
  - A port in only one machine's hardware table is evidence for that machine. On both, it is `'both'` evidence.
  - A ROM code address uses `ROM_COMPARISON`: `model1-only`/`model3-only` are evidence for that machine; `shared` is `'both'`; `different` is `'both'` evidence with the text noting that the code differs.
  - A memory address in only one hardware table (the Model I `$37DE`–`$37EF` devices) is evidence for that machine.
  - Fit: evidence for both machines → `conflict`; for one → that machine; only `'both'` evidence → `both`; no external references at all → `unknown`.
  - Each `text` is a plain sentence, e.g. `Writes port $EC (MODEPORT), which only the Model III has.`
- `memoryNeeded`: highest loaded or runtime address ≤ `$7FFF` → 16, ≤ `$BFFF` → 32, else 48.
- `routines`: symbols of kind `sub`, plus roots.
- `hardware`, `romCalls`, `dosCalls`: from `a.tablesUsed` plus comment entries, split by table (`hardware-*`, `rom-*`, `dos-*`/`svc-*`), in table order.

- [ ] **Step 1: Write the failing tests.** seadrg01 with its hints:
  - `machine.fit === 'model3'`, with evidence containing `{ kind: 'port', key: 0xEC, machine: 3 }`
  - `romCalls` names `$DELAY` (`key` 0x0060); `dosCalls` is empty
  - `loads` is `[{ start: 0x5200, end: 0x888F }]`; `size === 13968`
  - `entry === 0x8881`, `entryHow === 'transfer'`
  - `relocations[0]` is `{ file: 0x5200, run: 0x497F, length: 0x3681 }`
  - `memoryNeeded === 32`; `code.percent === 45`
  - `hardware` names include `VIDEO`, `KEYBOARD`, `MODEPORT`, and `CASSETTE` (adjust to what the listing names, and say so in the commit if one is absent)

  A synthetic raw program `CALL 0033H` / `RET` at `$7000` gives `fit === 'both'`. A raw `RET` gives `unknown`. A raw program that writes port `$EC` and reads `$37E0` gives `conflict`.
- [ ] **Step 2: Run** `pnpm vitest run packages/disasm/test/facts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `facts.ts`.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: compute program facts and an evidence-based machine fit`

### Task 5: `.CMD` and `.CAS` writers

**Files:**
- Create: `packages/disasm/src/write/cmd.ts` (the `CmdWriter` class moved here, plus `writeCmd`), `packages/disasm/src/write/cas.ts`
- Modify: `packages/disasm/test/writers/cmd-writer.ts` (becomes `export { CmdWriter } from '../../src/write/cmd.js'`), `src/index.ts`
- Test: `packages/disasm/test/write/cmd.test.ts`, `packages/disasm/test/write/cas.test.ts`, `packages/disasm/test/writers/cas-reader.ts` (test-only decoder)

**Interfaces:**
- Produces:
  - `function writeCmd(image: MemoryImage, opts: { entry: number | null; name?: string }): Uint8Array`
    - `05` header when `name` is given (at most 8 bytes, ASCII).
    - One `01` record per ≤256 bytes of each run of `image.runs()`.
    - `02` transfer when `entry` is not null, else `03 00`.
  - `function writeSystemCas(image: MemoryImage, opts: { entry: number; name: string }): Uint8Array`
    - 256 × `00` leader, `A5`, `55`, name padded or cut to 6 bytes upper-case.
    - Then per ≤256 bytes: `3C`, length (`00` = 256), addr lo, addr hi, data, checksum (addr lo + addr hi + data bytes, mod 256).
    - Then `78`, entry lo, entry hi.
  - `function writeBasicCas(prog: BasProgram, name: string): Uint8Array`
    - 256 × `00`, `A5`, `D3 D3 D3`, the name's first character.
    - Then the program's lines rebased to `$42E9` (use `rebaseBas`), ending `00 00`.
  - Export name for the UI: the `.CMD` `05` name when it has no `{hh}` escape, else the file name's stem, upper-cased, letters and digits only, cut to 6 (SYSTEM) or 8 (`.CMD`).

- [ ] **Step 1: Write the failing tests.**
  - For every `.CMD` in `examples/` (including `ARMOUR.III`), `loadCmd(writeCmd(mod.image, { entry: mod.entry, name }))` has an identical `image.bytes`, identical `image.loaded`, and the same `entry`.
  - `writeCmd` of a raw program at `$7000` with `entry: 0x7000` loads back with `entrySource === 'transfer'`.
  - `cas-reader` decodes `writeSystemCas` of each example back to the same loaded bytes and entry, with every checksum right.
  - `writeBasicCas` of a synthetic fixture decodes back to the same line numbers and bodies.
  - Every existing fixture test still passes through the re-exported `CmdWriter`.
- [ ] **Step 2: Run** `pnpm vitest run packages/disasm/test/write`. Expected: FAIL.
- [ ] **Step 3: Implement both writers.** `pnpm fixtures` must leave `fixtures/synthetic` unchanged.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test && pnpm fixtures && git diff --exit-code fixtures/synthetic`. Expected: PASS, no diff.
- [ ] **Step 5: Commit** `p4: write programs as .CMD load modules and .CAS tapes`

### Task 6: Phase 3 leftovers the side panel exposes

**Files:**
- Modify: `packages/disasm/data/symbols/sources.json`, `src/symbols/types.ts` (`Source`), `src/symbols/validate.ts`, `scripts/write-symbols.ts`, generated `src/symbols/tables.generated.ts`, `src/ir.ts`, `src/symbols/` data note in `rom-model3.json` (MEMTOP purpose), `docs/fugloy-emu-spec.md:30`
- Test: `packages/disasm/test/symbols/validate.test.ts`, `packages/disasm/test/ir.test.ts`

**Interfaces:**
- `Source` becomes `{ id; author; title; publisher; year: string; circa?: boolean; edition?; catalog?: string; url?: string; textUrl?: string; archiveId?: string; redistributable?: boolean }`.
  - `locator` is removed. A catalog number goes in `catalog`. A URL goes in `url`.
  - `ldos51`'s second URL goes in `textUrl`. `soltoff`'s permission link is kept in `permissionUrl` (required whenever `redistributable: true`), and its `url` stays the text, with no `textUrl`.
  - `archiveId` is the archive.org identifier, parsed from `url` when it is `archive.org/details/<id>`.
  - `year` holds digits or a range only (`1982`, `1983–84`), with `circa: true` for `ldos51`.
- IR `tableNames` includes names used only by `.BAS` note lines.
- Fix the MEMTOP purpose (drop "or else the top of RAM" under Disk BASIC) and the emu spec's trsjs credit (Peter Phillips).

- [ ] **Step 1: Write the failing tests.**
  - The validator rejects a `year` that is not digits or a digit range, and a source with neither `url` nor `catalog`.
  - Every archive.org source has `archiveId`.
  - The IR of the `.BAS` fixture whose only named address is in a note includes that name in `tableNames`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, then `pnpm symbols`.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test && pnpm symbols && git diff --exit-code packages/disasm/src/symbols/tables.generated.ts`. Expected: PASS, generated file committed and in sync.
- [ ] **Step 5: Commit** `p4: give sources a url, catalog, and archive id, and finish phase 3's data notes`

### Task 7: `apps/web` scaffold

**Files:**
- Create: `apps/web/package.json` (`@fugloy/web`, scripts `dev`, `generate`, `test`, `prepare-examples`), `apps/web/nuxt.config.ts`, `apps/web/app/app.vue`, `apps/web/app/app.config.ts`, `apps/web/app/assets/css/main.css`, `apps/web/app/layouts/default.vue`, `apps/web/app/components/TopBar.vue`, `apps/web/app/pages/{index,about,manuals,technical-details}.vue` (stubs), `apps/web/scripts/prepare-examples.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.json`
- Modify: `pnpm-workspace.yaml` (add `apps/*`), root `package.json` (`web:dev`, `web:generate`), root `vitest.config.ts` (`include` gains `apps/web/test/**/*.test.ts`), `.gitignore` (`apps/web/.nuxt`, `apps/web/.output`, `apps/web/public/examples`), `netlify.toml` (comment only; the command already targets `@fugloy/web`), `CLAUDE.md` (drop the "settle the name" note)

**Interfaces:**
- Produces:
  - `@fugloy/disasm` and `@fugloy/z80` resolve to their `src/index.ts` through a Vite alias in `nuxt.config.ts`, as in the root `vitest.config.ts`, so the site needs no prior `pnpm build`.
  - `prepare-examples.ts` (run by `predev` and `pregenerate`) copies `examples/*/*.{cmd,hints,III}` into `apps/web/public/examples/<game>/`.
  - Theme tokens in `main.css`: background, surface, border, text, muted, accent (`#f78166`), and the syntax colors from the approved mockup (mnemonic `#ff7b72`, register `#79c0ff`, number `#a5d6ff`, label `#d2a8ff`, table name `#7ee787`, comment `#8b949e` italic). The mockup is `.superpowers/brainstorm/*/content/layout.html`, option A. Monospace font: JetBrains Mono, or the system monospace stack.
  - `TopBar.vue`: wordmark `fuglø` + accent `y`; slots for file name and pickers; Export slot; links to Technical details, Manuals, About.

- [ ] **Step 1: Scaffold Nuxt 4 + Nuxt UI** in `apps/web` (`ssr: true` with `nitro.preset: 'static'` or `nuxi generate`; color mode default `dark`). Add the stub pages and the top bar.
- [ ] **Step 2: Write the failing test** `apps/web/test/disasm-import.test.ts`: importing `openProgram` from `@fugloy/disasm` inside the web's Vitest config opens `public/examples/sea-dragon/seadrg01.cmd` (after `prepare-examples`).
- [ ] **Step 3: Run** `pnpm --filter @fugloy/web test`. Expected: FAIL, then wire the alias and the script until it passes.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web generate`. Expected: success, and `apps/web/.output/public/index.html` exists with the top bar.
- [ ] **Step 5: Run** `pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 6: Commit** `p4: scaffold the Nuxt workbench app`

### Task 8: Virtualized listing prototype (the plan's named risk)

**Files:**
- Create: `apps/web/app/components/listing/ListingView.vue`, `apps/web/app/components/listing/ListingRow.vue`, `apps/web/app/utils/row-classes.ts`
- Test: `apps/web/test/row-classes.test.ts`; a perf check in `apps/web/test/e2e/listing-perf.spec.ts` (Playwright, added to config in Task 18, runnable locally now)

**Interfaces:**
- Consumes: `Row`, `Span`, `rowIndex` (Task 3).
- Produces:
  - `ListingView` props: `{ rows: readonly Row[]; cursor: number | null; selection: { from: number; to: number } | null }`. Emits `select(addr, extend: boolean)`, `follow(target: number)`, `context(addr, x, y)`. Exposes `scrollToAddr(addr: number): void`.
  - Fixed row height, monospace grid columns: address 6ch, bytes 14ch (the text starts at column 20, as in `formatListingLine`; 13ch was an error, corrected in Task 8 review), then the text and comment.
  - `spanClass(kind: SpanKind): string` maps each kind to a theme class.

- [ ] **Step 1: Write the failing test.** `spanClass` gives a distinct class for each of the nine `SpanKind`s, and `label`/`table` spans are rendered as focusable links.
- [ ] **Step 2: Implement** the list (Nuxt UI, `@tanstack/vue-virtual`, or hand-rolled; builder's choice).
- [ ] **Step 3: Measure.** Use the largest local program available: asylum16 if `sample/` has it, else a raw 48K load of `seadrg01`'s image repeated, which gives over 8,000 rows. Check that:
  - scroll stays smooth (no long tasks over 50 ms while flinging);
  - `scrollToAddr` lands in under 100 ms;
  - after a re-render with new rows of the same program, the cursor row stays on screen.

  Record the numbers in the commit message body. **If this bar cannot be met, stop and report to the user.** It is the plan's named risk.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: render a virtualized, highlighted listing`

### Task 9: Workbench state, first screen, and opening programs

**Files:**
- Create: `apps/web/app/composables/useWorkbench.ts`, `apps/web/app/data/examples.ts`, `apps/web/app/components/FirstScreen.vue`, `apps/web/app/components/StatusLine.vue`, `apps/web/app/components/MachinePicker.vue`, `apps/web/app/components/RawBaseDialog.vue`
- Modify: `apps/web/app/pages/index.vue`
- Test: `apps/web/test/workbench.test.ts`, `apps/web/test/examples.test.ts`

**Interfaces:**
- Consumes: `openProgram`, `withHintText`, `withSelection`, `listingRows`, `basRows`, `OpenError`, `defaultDos`, `programFacts`.
- Produces `useWorkbench()`, a single shared state. Fields:
  - `session: Ref<Session | null>`
  - `rows: ComputedRef<Row[]>`: `basRows` when `plainBasic`, else `listingRows`
  - `facts: ComputedRef<ProgramFacts | null>`
  - `cursor: Ref<number | null>`
  - `selection: Ref<{ from: number; to: number } | null>`
  - `error: Ref<string | null>`

  Methods:
  - `openBytes(bytes: Uint8Array, name: string, opts?: { base?: number; hintText?: string; selection?: SymbolSelection }): void`
  - `openExample(id: ExampleId, build?: string): Promise<void>`
  - `setSelection(sel: SymbolSelection): void`
- `examples.ts`: `type ExampleId = 'sea-dragon' | 'rear-guard' | 'eliminator' | 'armored-patrol'`. Each entry has `{ id; title; authors: string; publisher?: string; year: number; machine: Machine; mainBuild: string; builds: string[]; hints?: string; rights: string; rightsQuote: string; rightsUrl: string }`, copied from each `examples/*/README.md`. Sea Dragon's main build is `seadrg01.cmd` with `seadrg01.hints`. For the others, use the build the README presents first.
- On first open, the picker is set from `facts.machine.fit` when it is `model1` or `model3`, else Model III with `defaultDos(3)`. An example uses its manifest machine.
- `OpenError('format')` shows the "not a `.CMD` or `.BAS`" message, with "Load as raw binary at…", which opens `RawBaseDialog` (hex address, validated `0`–`FFFF`). A dropped PDF also links to Manuals. A 0-byte file says it is empty.

- [ ] **Step 1: Write the failing tests.**
  - `examples.test.ts`: every manifest build and hint file exists under `examples/`, and every README's public-domain quote appears in its entry's `rightsQuote`.
  - `workbench.test.ts` (composable tested without the DOM):
    - `openExample('sea-dragon')` gives rows whose text includes `L497F:` and a selection of Model III;
    - `openBytes` of a JPEG header sets `error` to the not-a-program message;
    - `openBytes(_, 'x.bin', { base: 0x7000 })` on `[0xC9]` gives a raw session;
    - `setSelection({ machine: 1, dos: 'ldos' })` re-renders with Model I names.
- [ ] **Step 2: Run** `pnpm --filter @fugloy/web test`. Expected: FAIL.
- [ ] **Step 3: Implement** the composable, the manifest, and the first screen (drop zone plus four game buttons, each with a builds menu). Then the top bar's file name, machine and DOS pickers, and the status line (size and blocks, percent code, entry, machine/DOS, save state placeholder). Lay out the facing pages with a draggable divider, and the dimmed **Source ✎** and **Run ▶** tabs with a "coming later" tooltip.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test && pnpm --filter @fugloy/web generate`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: open dropped programs and the bundled games in the workbench`

### Task 10: Symbol and Index tabs, and navigation

**Files:**
- Create: `apps/web/app/components/side/SymbolTab.vue`, `apps/web/app/components/side/IndexTab.vue`, `apps/web/app/components/side/Citation.vue`, `apps/web/app/composables/useNavigation.ts`, `apps/web/app/utils/xrefs.ts`
- Test: `apps/web/test/xrefs.test.ts`, `apps/web/test/navigation.test.ts`

**Interfaces:**
- Produces:
  - `useNavigation()`: `{ goTo(addr: number): void; back(): void; forward(): void; canBack: Ref<boolean>; canForward: Ref<boolean> }`. Following a link pushes the current cursor.
  - `usesOf(a: Analysis, rows: readonly Row[], target: { kind: 'addr' | 'port' | 'svc'; key: number }): { addr: number; text: string }[]`, from the row spans' `target`.
  - `Citation.vue` props `{ cite: Cite }`. Shows the source title and page, and emits `open-manual(cite)` (wired in Task 16).
- Symbol tab: selected table entry (name, address or port, purpose, note, `[Model I]`/`[Model III]` tag, citations, uses) or program label (name, kind, callers/jumpers/readers from `analysis.pass1.xrefs`, user comment).
- Index tab: a filter box, then four groups: labels, routines, table names, proposals. Each row is a link.
- Keys: **G** opens a go-to box (address in any `parseNumber` form, or a label name). **Alt+←**/**Alt+→** go back and forward.

- [ ] **Step 1: Write the failing tests.**
  - `usesOf(seadrg01+hints, port 0xEC)` includes `{ addr: 0x499F }`.
  - Navigation: `goTo(0x4B9E)` then `back()` returns to the prior cursor; `canForward` becomes true.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Clicking a `label`/`table` span opens it in the Symbol tab and moves the cursor (a table span moves only the panel).
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: add the Symbol and Index tabs and listing navigation`

### Task 11: Program tab — the spec sheet

**Files:**
- Create: `apps/web/app/components/side/ProgramTab.vue`, `apps/web/app/components/side/MemoryMap.vue`
- Test: `apps/web/test/program-tab.test.ts` (Vue Test Utils via `@nuxt/test-utils`)

**Interfaces:**
- Consumes: `ProgramFacts` (Task 4), the examples manifest (Task 9), `analysis.proposals`, `pass1.diagnostics`, `hintSource`.
- Sections in order: History (examples only, or the `.CMD` name), Machine (badges plus each evidence `text`), Loading, Talks to (each entry links to the Symbol tab), Code, Analysis.
  - Analysis lists the proposals, each with an **Apply** button that adds its hint line(s) through Task 12's `applyHintLines`.
- `MemoryMap` props `{ loads; relocations }`. A 64K strip: ROM `$0000`–`$37FF`, keyboard and video `$3800`–`$3FFF`, then the program's ranges, with axis labels `$0000 $4000 $8000 $C000 $FFFF`.

- [ ] **Step 1: Write the failing test.** Mounted on seadrg01 with hints, the tab shows `Model III`, the sentence `Writes port $EC (MODEPORT), which only the Model III has.`, `$5200–$888F`, `$8881`, `32K`, and `public domain`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement**, matching the approved mockup (`content/program-tab.html`) in the dark theme.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: show a spec sheet for the open program`

### Task 12: Editing, undo, and the Hints tab

**Files:**
- Create: `apps/web/app/utils/edits.ts`, `apps/web/app/composables/useEditing.ts`, `apps/web/app/components/listing/RowMenu.vue`, `apps/web/app/components/listing/InlineEdit.vue`, `apps/web/app/components/HintsTab.vue`
- Test: `apps/web/test/edits.test.ts`

**Interfaces:**
- Consumes: `addressKey`, `withHintFile`, `isValidName`, `parseHints`, `writeHints`, `Session`.
- Produces (`edits.ts`, pure):
  - `type Edit` is one of:
    - `{ op: 'mark'; from: number; to: number; as: 'code' | 'bytes' | 'words' | 'string' }`
    - `{ op: 'table'; from: number; to: number }` (width 2, count = length / 2)
    - `{ op: 'name'; addr: number; name: string }`
    - `{ op: 'comment'; addr: number; text: string }` (empty text removes)
  - `function applyEdit(s: Session, e: Edit): { file: HintFile } | { error: string }`:
    - loaded addresses use `addressKey` and block hints;
    - unloaded addresses use `at` hints (names and comments only; marking an unloaded range is an error);
    - a later hint for the same key and directive replaces the earlier one.
  - `function applyHintLines(s: Session, lines: string[]): { file: HintFile } | { error: string }`, for proposals.
  - Name errors:
    - `isValidName` failures give its reason;
    - a name used by another symbol, ignoring case, gives `SCORE is already the name of $7F10`;
    - a table name in the current selection gives `MODEPORT is a ROM/hardware name; choose another`.
- `useEditing()`: `{ apply(e: Edit): void; undo(): void; redo(): void; canUndo; canRedo }`. The history is a stack of `HintFile`s, so undo restores the previous file exactly.
- Keys:
  - **C**/**D**/**W**/**S** mark the selection (D means `bytes`), **T** declares a table.
  - **N** renames inline; **;** edits the comment inline.
  - **⌘Z**/**Ctrl+Z** undo, **⇧⌘Z**/**Ctrl+Y** redo, **Esc** cancels.
  - Keys are ignored while an input has focus.
- Selection: click, shift-click, ↑/↓ with shift to extend.
- `RowMenu` (right-click) offers the same actions with their keys shown. The Hints tab shows `writeHints(session.hintFile)` read-only, plus matched/unmatched and warnings.

- [ ] **Step 1: Write the failing tests.** On seadrg01 with hints:
  - `name 0x4B9E INIT` gives a file whose text has `name INIT` under block 0 at offset `$4B9E-$497F`, and the session's row at `$499A` reads `CALL INIT`;
  - naming `LD` errors with `reserved`;
  - naming `MODEPORT` errors;
  - `comment 0x7F00 'top'` (unloaded) adds `at $7F00 comment top`;
  - `mark` on unloaded addresses errors;
  - undo after two edits restores the original `hintFile` text exactly.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `edits.ts`, then `useEditing`, keys, menu, inline editors, and the Hints tab. After each edit, keep the cursor on the same address (`rowIndex`).
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: edit the listing from the keyboard, with undo, through the hint file`

### Task 13: Persistence, hint-file drop, carry-over, backup

**Files:**
- Create: `apps/web/app/utils/store.ts`, `apps/web/app/composables/usePersistence.ts`, `apps/web/app/utils/backup.ts`, `apps/web/app/components/CarryOverDialog.vue`
- Test: `apps/web/test/store.test.ts` (with `fake-indexeddb` as a dev dependency), `apps/web/test/backup.test.ts`

**Interfaces:**
- Produces (`store.ts`): one IndexedDB database `fugloy`, version 1, with stores:
  - `hints`: key program SHA-256, value `{ name: string; text: string; savedAt: number }`
  - `prefs`: key SHA-256, value `{ machine: Machine; dos: Dos }`
  - `manuals`: used in Task 16
- Functions:
  - `function openStore(): Promise<Store | null>`: null when IndexedDB is unavailable.
  - `Store` methods: `getHints`, `putHints`, `allHints(): Promise<{ hash: string; name: string; text: string }[]>`, `getPrefs`, `putPrefs`, `deleteProgram`.
  - `requestPersistence(): Promise<boolean>` calls `navigator.storage.persist()` once.
- `usePersistence()`:
  - saves the hint file on every edit, debounced 500 ms;
  - restores hints and prefs when a program opens (saved hints beat an example's committed hints);
  - the status line shows `saved`, `unsaved`, `no hints yet`, or `not saved (storage unavailable)`.
- Hint-file drop: a dropped text file that `parseHints` accepts is applied to the open program through `withHintText`. If no block matched, refuse with "these hints are for another program (no block matched)". Unmatched blocks are listed in the Hints tab.
- Carry-over: when a program has no saved hints, scan `allHints()` for files whose blocks pair with this program's (`applyHints(...).matched.length > 0`), and offer the best one (most matched blocks) in `CarryOverDialog`.
- `backup.ts`:
  - `makeBackup(store): Promise<string>` gives JSON `{ fugloyBackup: 1, exportedAt, programs: [{ hash, name, hints, prefs? }] }`.
  - `restoreBackup(store, json, confirm: (name: string) => Promise<boolean>): Promise<{ added: number; replaced: number; skipped: number }>`.
  - Never includes manuals.

- [ ] **Step 1: Write the failing tests.**
  - Put/get round-trip.
  - `openStore()` returns null when `indexedDB` is undefined.
  - Carry-over: hints saved for seadrg01 are offered for seadrg02 only if blocks pair. Assert whichever the data says, from `applyHints`, and name it in the test.
  - Backup round-trip into an empty store gives identical hints. Restoring over an existing program calls `confirm` with its name.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Back up and Restore go in the top bar menu, and in the Manuals page in Task 16.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: save hints in the browser, carry them across builds, and back them up`

### Task 14: Export menu

**Files:**
- Create: `apps/web/app/components/ExportMenu.vue`, `apps/web/app/utils/exports.ts`
- Test: `apps/web/test/exports.test.ts`

**Interfaces:**
- Consumes: `renderSession`, `writeHints`, `writeCmd`, `writeSystemCas`, `writeBasicCas`, `programFacts`.
- Produces:
  - `type ExportKind = 'zmac' | 'hints' | 'ir' | 'cmd' | 'cas'`
  - `function exportKinds(s: Session): ExportKind[]`
  - `function exportFile(s: Session, kind: ExportKind): { filename: string; mime: string; bytes: Uint8Array; warnings: string[] }`
  - Filenames: `<stem>.z80`, `<stem>.hints`, `<stem>.ir.json`, `<stem>.cmd`, `<stem>.cas`.
  - `.CMD` is not offered for a `.BAS` program. `.CAS` of a `.BAS` program is a BASIC tape.
  - Warnings:
    - `dosCalls` not empty: `calls the DOS; it will not run from tape`;
    - any block below `$4200`: `loads under $4200, over memory the ROM uses while loading a tape`;
    - entry null for `.CAS`: refused with `no entry point`.
- Downloads use a Blob and an `<a download>`. Nothing is sent anywhere.

- [ ] **Step 1: Write the failing tests.**
  - `exportFile(seadrg01+hints, 'zmac').bytes` decodes to exactly `renderSession(_, 'zmac')`.
  - `'cmd'` reloads to the same image.
  - `'cas'` has no warnings.
  - A raw program whose code calls a TRSDOS SVC address gets the DOS warning.
  - A `.BAS` session has no `'cmd'` option (`exportKinds(s)` excludes it).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, with warnings shown in the menu before download.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test`. Expected: PASS.
- [ ] **Step 5: Commit** `p4: export zmac source, hints, IR, .CMD, and .CAS`

### Task 15: Manual page tables

**Files:**
- Create: `packages/disasm/data/manuals/<source-id>.json` for each source with `archiveId`, `packages/disasm/test/symbols/manuals.test.ts`
- Modify: `scripts/write-symbols.ts` (compile the page tables into `tables.generated.ts` as `MANUALS`), `src/symbols/types.ts`, `src/index.ts` (export `MANUALS`)

**Interfaces:**
- `interface ManualScan { source: string; archiveId: string; pdfSha256: string[]; pdfPages: number; pages: Record<string, number> }`. `pages` maps the printed page as cited (`'12/10'`, `'6-29'`, `'D-2'`, `'15'`) to a 1-based PDF page. `pdfSha256` lists the archive.org PDF(s) this mapping is for.
- `function manualPage(scan: ManualScan, printed: string): number | null`
- archive.org reader URL: `https://archive.org/details/<archiveId>/page/n<pdfPage - 1>/mode/1up`. The builder checks this form against one known page before relying on it, and records the check in the commit body.

- [ ] **Step 1: Write the failing test.** For every cite in every table whose source has `archiveId`, the source's scan has a `pages` entry, and the entry is within `1..pdfPages`.
- [ ] **Step 2: Run** it. Expected: FAIL (no tables yet).
- [ ] **Step 3: Build each table by hand.**
  - Source: the archive.org PDFs in the gitignored `docs/reference/`. Download any missing one there; never commit it.
  - Find each cited printed page by its printed number, and record its PDF page and the file's SHA-256 and page count.
  - About 130 distinct pages across `m3-trm`, `m3-basic`, `ldos51`, `paay`, `decker`, `l2-1979`, `trsdos13`, `soltoff`.
  - Check each by reading the page, as phase 3 did.
- [ ] **Step 4: Run** `pnpm symbols && pnpm typecheck && pnpm test`. Expected: PASS, generated module in sync.
- [ ] **Step 5: Commit** `p4: map every cited page to its page in the archive.org scan`

### Task 16: Manuals page and Manual tab

**Files:**
- Create: `apps/web/app/pages/manuals.vue` (replace stub), `apps/web/app/components/side/ManualTab.vue`, `apps/web/app/composables/useManuals.ts`, `apps/web/app/utils/pdf.ts`
- Modify: `apps/web/app/components/side/Citation.vue`, `apps/web/app/utils/store.ts` (`manuals` store: key source id, value `{ blob: Blob; sha256: string; name: string; offset?: number; addedAt: number }`)
- Test: `apps/web/test/manuals.test.ts`

**Interfaces:**
- Consumes: `SYMBOL_SOURCES`, `MANUALS`, `manualPage`, `sha256Hex`, `store`.
- Produces:
  - `useManuals()`: `{ list: ComputedRef<{ source: Source; have: boolean; scan?: ManualScan }[]>; add(file: File, sourceId?: string): Promise<{ ok: true; sourceId: string } | { ok: false; reason: string }>; remove(id: string): Promise<void>; setOffset(id: string, pdfPageOfPrinted1: number): Promise<void>; pdfPageFor(cite: Cite): Promise<number | null> }`.
  - `add` recognizes a file by `pdfSha256`. Otherwise it needs `sourceId` (the page asks which manual it is).
  - `pdfPageFor` uses the scan table when the stored file's hash is in `pdfSha256`. Otherwise it uses `printed + offset - 1` for numeric pages, else null.
  - `pdf.ts`: `loadPdf(blob): Promise<PdfDoc>`, `renderPage(doc, n, canvas, highlight?: string): Promise<void>`. `pdfjs-dist` is imported dynamically on the first call, and its worker is served from the app's assets.
- Manuals page:
  - each source in `SYMBOL_SOURCES` with title, author/publisher, year (with `c.`), edition/catalog, and "provide your own copy";
  - `url` as "find a scan";
  - the cover from `https://archive.org/services/img/<archiveId>` with a "cover image from archive.org" caption, or a title card when there is no `archiveId`;
  - when you have the manual, page 1 of your copy instead;
  - add (drop or pick), remove, and Back up / Restore (Task 13).
- Manual tab: renders the cited page, highlights the symbol's name or `$hex` address in the text layer when found, has page ← → and zoom, and back returns to the listing.
- Citation without the manual: cover thumbnail, `Open page <printed> on archive.org` (the reader URL), and `Add this manual`.

- [ ] **Step 1: Write the failing tests** (store faked, pdf.js not loaded):
  - `add` of a blob whose hash is in `m3-trm`'s `pdfSha256` returns `{ ok: true, sourceId: 'm3-trm' }`;
  - an unknown blob without `sourceId` returns `{ ok: false }` asking which manual;
  - `pdfPageFor({ source: 'm3-trm', page: '15' })` equals the table's value;
  - with an unknown PDF and offset 9, `pdfPageFor` of page `'15'` gives 23, and of `'12/10'` gives null.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Check by hand with a real PDF from `docs/reference/` that `m3-trm p.15` opens on the right page with `MODEPORT` highlighted.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web test && pnpm --filter @fugloy/web generate`. Then check that the generated home page does not load pdf.js (grep the entry chunk for `pdfjs`). Expected: PASS, not in the entry chunk.
- [ ] **Step 5: Commit** `p4: read your own manuals at the cited page`

### Task 17: Technical details, About, SEO, favicons

**Files:**
- Create: `apps/web/app/pages/technical-details.vue`, `apps/web/app/pages/about.vue` (replace stubs), `apps/web/app/composables/usePageSeo.ts`, `apps/web/public/robots.txt`, `apps/web/public/og-image.png` (copied from `docs/images/og-image.png` by `prepare-examples.ts`, renamed `prepare-assets.ts`), favicons generated from `docs/images/og-image.svg`'s ø tile into `apps/web/public/` (`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`)
- Modify: `docs/technical-details/inside-fugloy.html` (numbers and sample output as of phase 3), `docs/images/og-image.svg` and its rendered `og-image.png` (the social card's sample listing as of phase 3, with names), `README.md` where it shows pre-phase-3 output, `apps/web/nuxt.config.ts` (sitemap)
- Test: `apps/web/test/seo.test.ts` (reads `.output/public/*.html` after `generate`)

**Interfaces:**
- `usePageSeo({ title: string; description: string; path: string })` sets:
  - `<title>` (`<title> · Fugløy`, except the home page `Fugløy — TRS-80 disassembler workbench`) and the meta description;
  - canonical `https://app.fugloy.dev<path>`;
  - `og:title`, `og:description`, `og:url`, `og:type=website`, `og:image=https://app.fugloy.dev/og-image.png`, `og:image:width=1200`, `og:image:height=630`, `og:image:alt`;
  - `twitter:card=summary_large_image` with the same image and alt.
- Home page JSON-LD:
  - `@type: SoftwareApplication`, `name: Fugløy`, `applicationCategory: DeveloperApplication`;
  - `operatingSystem: Any (web browser)`, `url`;
  - `offers` price `0`, `license` MIT.
- `sitemap.xml` lists `/`, `/technical-details`, `/manuals`, `/about`. `robots.txt` allows all and names the sitemap.
- Technical details hosts the explainer fragment unchanged in structure, wrapped by the layout, with its own `<title>` moved into `usePageSeo`.
- About: what Fugløy is; files never leave your machine and nothing is hosted; storage is per browser, with Back up / Restore; credits (each source by title, zmac, the Westmoreland and Gilman 1995 release with the trs-80.org quote and link); repository link.

- [ ] **Step 1: Write the failing test.** After `generate`, each of the four pages has:
  - a unique `<title>`;
  - a description;
  - a canonical link on `https://app.fugloy.dev`;
  - `og:image` absolute, with alt;
  - `twitter:card` `summary_large_image`.

  The home page has parseable JSON-LD of type `SoftwareApplication`. `sitemap.xml` lists four URLs, and `robots.txt` names it.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement.** Refresh the explainer's numbers from the current suite count and coverage, and its sample output from current `pnpm fugloy` output.
- [ ] **Step 4: Run** `pnpm --filter @fugloy/web generate && pnpm --filter @fugloy/web test`. Expected: PASS. Run a `lightcap` audit (`run_audit`) on `pnpm --filter @fugloy/web preview` for each page. Accessibility and SEO must be 100, with no contrast failures on the dark theme.
- [ ] **Step 5: Commit** `p4: add the technical details and about pages, SEO, and favicons`

### Task 18: Browser tests, CI, done-criterion, docs

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/test/e2e/workbench.spec.ts`, `apps/web/test/e2e/asylum.spec.ts`
- Modify: `.github/workflows/ci.yml` (a `web` job: install, Playwright chromium, `pnpm --filter @fugloy/web generate`, `pnpm --filter @fugloy/web test`, `pnpm --filter @fugloy/web e2e`), `docs/Fugloy-Project-Plan.md` ("Web app", "Hint file", "Stack", as listed in the spec's last section), `CLAUDE.md` (current phase), `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:**
- `workbench.spec.ts`, against `generate` output served statically:
  1. The home page shows four game buttons.
  2. Click Sea Dragon: the listing shows `L497F:`, and the Program tab says `Model III`.
  3. Press **G**, type `4B9E`, Enter: the cursor row is `$4B9E`.
  4. Press **N**, type `INIT`, Enter: the row at `$499A` reads `CALL INIT`.
  5. On that row press **;**, type `set up the screen`, Enter.
  6. Reload: both edits are restored and the status line says `saved`.
  7. Export zmac: the download equals `pnpm fugloy examples/sea-dragon/seadrg01.cmd --hints <the downloaded .hints> --format zmac` (computed in the test through `@fugloy/cli`'s `run`).
  8. Export `.CMD`: reloading it through `loadCmd` gives seadrg01's image.
  9. Drop a JPEG: the not-a-program message appears.
  10. ⌘Z twice: both edits undone.
- `asylum.spec.ts`: skipped unless `sample/` holds asylum16.cmd (reuse `resolveSample` logic). Opens it with `fixtures/hints/asylum16.hints` under Model I, checks that named ROM calls are shown, renames one label, reloads, and sees it kept.

- [ ] **Step 1: Write both specs.** Run `pnpm --filter @fugloy/web e2e`. Expected: workbench passes, and asylum passes locally (or skips in a clean worktree).
- [ ] **Step 2: Add the CI job.** Push only after the clean-worktree check: `git worktree add ../fugloy-clean HEAD`, `pnpm install && pnpm typecheck && pnpm test && pnpm --filter @fugloy/web generate && pnpm --filter @fugloy/web e2e` there. Expected: all pass, asylum skipped.
- [ ] **Step 3: Manual checks, recorded in `CHANGELOG.md`.**
  - Load an exported Sea Dragon `.CMD` and `.CAS` in trs80gp or trsjs and confirm the game runs. Ask the user to do this if no emulator is installed here.
  - Open asylum16 under Model I and annotate and save it (the v1 done-criterion).
- [ ] **Step 4: Update** the plan's sections named in the spec, `CLAUDE.md` "Current phase", and `CHANGELOG.md`.
- [ ] **Step 5: Commit** `p4: test the workbench in a browser and record phase 4`
- [ ] **Step 6: Deploy prep.** Show the user `netlify.toml` and the Netlify site state (`mcp__claude_ai_Netlify__*` readers). **Ask before** creating or linking the site, deploying, or touching DNS for `app.fugloy.dev`.
