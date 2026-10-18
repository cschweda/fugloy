# Emu Phase 4 (`@fugloy/mcp` v0.1: MCP phases A–C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stdio MCP server over `@fugloy/emu` with which Claude Code can load a game, find its print routine, and label it unaided, writing a label file Fugløy's disassembler reads (emu spec §11 phase 4; MCP spec §11 phases A, B, C).

**Architecture:** `packages/mcp` is plain JavaScript ESM like `@fugloy/emu`, no build step. One process owns one `Session` (a `Machine`, its program, labels, screen baseline, snapshots later). Each tool is a small module: it parses arguments with the shared conventions (`src/args.js`), acts on the session, and returns text from the shared formatters (`src/format/`). `src/server.js` registers the tools with the official SDK's `McpServer`; `bin/fugloy-mcp.js` connects it to stdio. Tests drive the real server through the SDK's in-memory transport and a `Client`, so every test exercises the protocol path.

**Tech Stack:** Node ≥ 22, ESM; `@modelcontextprotocol/sdk` (pin `1.32.0` exactly: the newest release at least two weeks old on 2026-10-18) and the `zod` version it requires; `@fugloy/emu`, `@fugloy/disasm`, `@fugloy/z80` as workspace dependencies; Vitest.

**Spec:** `docs/fugloy-mcp-spec.md` (§2–§5, §7, §8, §10, §11, §13 stories 1 and 7), `docs/fugloy-emu-spec.md` §3, §7, §8, §13, and `docs/label-format.md`.

## Global Constraints

- stdout is the protocol: nothing but JSON-RPC on stdout. The server redirects `console.log`/`console.info`/`console.debug` to stderr at startup; the emu `log` option goes to stderr.
- One machine per process; nothing runs between tool calls (MCP spec §2).
- Every tool result is `type: "text"`; `format: "json"` is offered on `regs`, `coverage`, `callers`, `hits` (MCP spec §4).
- Addresses accept `"5200"`, `"0x5200"`, `"$5200"`, `"5200h"`, a JSON number (decimal), or a label name; they echo as `5200h` (lowercase `h`, uppercase hex digits, four digits). Lengths and counts are decimal integers; a string where a length belongs is refused with a message that says lengths are decimal (MCP spec §4).
- Errors are plain sentences an agent can act on, returned as tool results with `isError: true`, never stack traces.
- Guardrail defaults (MCP spec §7), overridable by `limits` in the config: output 8,192 bytes per call (truncated with `… (N more; use offset=…)` and an `offset` argument), `run` 10 s emulated, `run` 5 s wall clock (`reason: "wallclock"`), trace depth 2,000, `step` ≤ 100, `peek` ≤ 1,024 bytes, `poke` into ROM (`$0000–$37FF`) refused unless `force: true`.
- Filesystem writes: only the sidecar label file and explicit `coverage export` paths.
- Only the Model III exists in emu; `model: 1` or `4` is refused naming emu phase 6.
- Determinism: the same tool sequence gives byte-identical output (the wall-clock cap is the one exception, and only when it trips).
- No copyrighted material committed. Golden transcripts are committed only for sessions on a synthetic ROM; sessions on the real Model III ROM assert properties instead (they would embed ROM screen text).
- Commit messages: imperative, one line, prefix `e4:`. No `Co-Authored-By` or any AI trailer.
- Keep `docs/fugloy-mcp-spec.md`, `docs/fugloy-emu-spec.md` §11, `docs/Fugloy-Project-Plan.md`, `CLAUDE.md`, and the READMEs current in the task that changes what they describe.

## Rulings made while planning (the spec left these open)

1. **Scope.** Emu phase 4 is MCP phases A, B, and C. `snapshot`/`restore`/`diff`/`search`/`callees` (D), resources and prompts (E), golden-transcript hardening and npm publish (F) come later.
2. **`break` conditions** accept only `<reg> <op> <value>` joined by `&&`: `reg` one of the 8-bit registers, the 16-bit pairs, `IX IY SP PC`, or a flag `Z C S PV H N`; `op` one of `== != < <= > >=`; `value` a number in the address syntax. Anything else is refused. No expression language (MCP spec §12, first question).
3. **Coverage is always on** once a program is loaded (and callers with it), so `suggest` and `coverage` have data without a setup step. Trace is on only during a `run` or `step` that asks for it, plus `step` always records its own instructions.
4. **`suggest` heuristics** are attributed by address: the server watches all memory and port traffic while coverage is on (through `m.debug.hooks`) and records, per executing instruction address, whether it wrote video RAM (`$3C00–$3FFF`), read the keyboard (`$3800–$3BFF`), or wrote port `$FF` (sound). A call target is credited with those facts for instruction addresses from the target up to its first executed `RET`-family instruction, within 256 bytes. The text says "(by address, heuristic)". Raw counts always come first (MCP spec §12, third question).
5. **`run until: "screen"`** stops at the first instruction boundary where video RAM differs from its contents when the call began, checked every 2,000 T-states (cycle-based, so deterministic).
6. **The sidecar** is `<program>.fugloy.json` beside the program file, in the §8 format; `label`/`unlabel` rewrite it at once; `coverage export` writes the full file (merging prior coverage, appending a session record) to `path` or the sidecar. Labels from the sidecar are loaded and shown by `disasm` immediately.
7. **`disasm`** decodes linearly with `@fugloy/z80` from the given address, names targets with session labels first and the Model III ROM symbol table from `@fugloy/disasm` second, and marks each line `*` executed, `d` read as data, `?` never seen (from coverage).
8. **`key`** types through the matrix by default (cps 20, MCP spec §5) and runs until the queue drains plus 0.2 s emulated; `mode: "hook"` feeds the ROM hook instead.

## Review Focus

1. A tool given a hex-looking string as a length (`len: "400"`) must refuse with the decimal explanation, not read 1,024 bytes (Task 2 test `refuses a string length with the decimal hint`).
2. Anything an emulator path prints (a ROM `log`, a stray `console.log`) must never reach stdout and corrupt the stream (Task 1 test `nothing but JSON-RPC reaches stdout`, run against the real `bin` over a pipe).
3. `run` on a program in a tight loop with no stop condition must return at the 10 s emulated cap with the reason, not hang (Task 3 test `run stops at the emulated cap`), and the wall-clock cap must hold when tracing slows emulation (Task 3 test `run stops at the wall-clock cap`, with a test-only low limit).
4. Tools called before `load` must say `No program loaded; call load first.`, not throw (Task 3 test `every tool before load explains itself`).
5. A sidecar that exists but is broken (bad JSON, another program's hash) must not stop `load`: the program loads and the result says why the sidecar was ignored (Task 5 test `a broken sidecar is reported, not fatal`).

---

### Task 1: Server skeleton, config, session, `status`

**Files:**
- Create: `packages/mcp/bin/fugloy-mcp.js`, `packages/mcp/src/server.js`, `packages/mcp/src/config.js`, `packages/mcp/src/session.js`, `packages/mcp/src/tools/status.js`, `packages/mcp/test/helpers.js`
- Modify: `packages/mcp/package.json` (bin `fugloy-mcp`, dependencies, `files`), `packages/mcp/src/index.js` (exports `createServer`, `loadConfig`), `packages/mcp/test/import.test.js`
- Test: `packages/mcp/test/server.test.js`, `packages/mcp/test/config.test.js`

**Interfaces:**
- Produces:
  - `loadConfig({ cwd, env, home }) → { roms: { model3?: string }, defaultModel: 3, fixtures?: string, limits: { runSecondsEmulated, runSecondsWall, outputBytes, traceDepth, stepMax, peekMax } , source: string | null }`: `env.FUGLOY_CONFIG`, else `<cwd>/fugloy.mcp.json`, else `<home>/.config/fugloy/fugloy.mcp.json`, else defaults; paths resolved against the config file's folder; a malformed file throws a sentence naming it.
  - `class Session` (`constructor(config)`) holding `machine | null`, `program | null` (`{ path, name, bytes, manifest, sha256 }`), `labels` (Map addr → label), `screenBaseline`, and `requireMachine()` which throws `No program loaded; call load first.` (wrapped into an `isError` result by the server).
  - `createServer({ config, session? }) → McpServer` registering every tool module (`{ name, description, inputSchema, handler(session, args) → string | { text, isError } }`), applying the output cap, turning thrown errors into `isError` text.
  - `test/helpers.js`: `connect({ config }) → { client, session, call(name, args) → { text, isError } }` over the SDK's in-memory transport.
  - `status` tool: model, program name, cycles, PC, counts of breaks/watches/labels, trace on/off, config source.

- [ ] **Step 1: Write the failing tests:** `lists the status tool and answers it before any load`; `loadConfig follows FUGLOY_CONFIG, then cwd, then ~/.config`; `a malformed config is a sentence, not a stack`; `nothing but JSON-RPC reaches stdout` (spawn `bin/fugloy-mcp.js` with a config whose ROM is a synthetic 14K image written to a temp dir, send `initialize` and `tools/list` over the pipe, make the server's machine log something, parse every stdout line as JSON-RPC).
- [ ] **Step 2: Run** `pnpm vitest run packages/mcp/test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Pin `@modelcontextprotocol/sdk` at `1.32.0` (and the `zod` it peers with); `@fugloy/emu`, `@fugloy/disasm`, `@fugloy/z80` as `workspace:*` (the spec's `^0.1.0` note predates pnpm here; pnpm rewrites `workspace:*` on pack). Update the MCP spec §9 sentence about `workspace:*` accordingly.
- [ ] **Step 4: Run** the tests, then `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `e4: add the MCP server skeleton, config, session, and status`.

### Task 2: Conventions and formatters

**Files:**
- Create: `packages/mcp/src/args.js`, `packages/mcp/src/format/hex.js`, `packages/mcp/src/format/regs.js`, `packages/mcp/src/format/screen.js`, `packages/mcp/src/format/trace.js`, `packages/mcp/src/format/cap.js`
- Test: `packages/mcp/test/args.test.js`, `packages/mcp/test/format.test.js`

**Interfaces:**
- Produces:
  - `parseAddr(value, labels?) → number` (forms in Global Constraints; names looked up case-insensitively in `labels`); `parseRange(value, labels?) → { addr, len }` (`"5200-52FF"` or `{ addr, len }`); `parseCount(value, { name, min, max }) → number` (refuses strings with `"<name> is a decimal count; write 1024, not \"400\"."`-style text naming the actual value); `hex4(n) → "5200h"`.
  - `hexDump(bytes, start, labels) → string`: 16 per line, a gap after 8, ASCII gutter with `.` for non-printables, a `      ; NAME` line before any line containing a labelled address (MCP spec §4).
  - `regsBlock(regs, flags, cycles) → string` and `regsJson(...)`, the three-line block of MCP spec §4 (cycles with thousands separators).
  - `screenText(lines) → string` (fence, two-line ruler, `·` for non-printables) and `screenDiff(beforeBytes, afterBytes) → string` (`(row,col) 'a'→'b'` per changed cell, a count line first).
  - `traceLines(entries, labels) → string`: `PC  bytes  mnemonic ; label [cycles]`, collapsed loops as `  ×212 (5214h–521Ah)`; mnemonics from `@fugloy/z80` `decode` + `formatInstruction`.
  - `cap(text, { limit, offset }) → string` (cuts at a line boundary; trailing `… (N more lines; use offset=K)`).

- [ ] **Step 1: Write the failing tests** with exact expected strings for each formatter (including the MCP spec §4 examples where they apply) and: `refuses a string length with the decimal hint`; `parseAddr accepts every documented form and a label`; `cap pages by offset`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `e4: add the argument conventions and text formatters`.

### Task 3: Phase A tools

**Files:**
- Create: `packages/mcp/src/tools/{load,reset,run,step,key,regs,peek,poke,screen}.js`
- Modify: `packages/mcp/src/session.js`, `packages/mcp/src/server.js`
- Test: `packages/mcp/test/phase-a.test.js` (synthetic ROM and synthetic `.CMD`, CI), `packages/mcp/test/phase-a-rom.test.js` (Model III ROM and Sea Dragon from `examples/`, skips without `fugloy.mcp.json`)

**Interfaces:**
- Consumes: Tasks 1–2; `Machine`, `m.load.*`, `m.keyboard`, `m.video`, `m.debug` from `@fugloy/emu`; `detectFormat` from `@fugloy/disasm` (content, never extension); `.CAS` recognised by its own leader/sync bytes.
- Produces:
  - `load { path*, model?, reset? = true }` → the manifest text: format, each block `addr–end (len)`, entry, ROM recognised (name or "unrecognised"), sidecar status (Task 5 fills it in; until then "no sidecar"), and the resolved path. A `.BAS` goes through `m.load.bas`, a `.CAS` through `m.load.cas` with `via: 'fast'`; the machine boots to the ROM's READY before a `.CMD`/`.CAS` load as the emu integration tests do (`boot-helpers.js`). Coverage is enabled (Ruling 3).
  - `reset { keepRam? = true, clear? }` → register block.
  - `run { cycles?, seconds?, until?: "break" | "halt" | "screen" | "pc:<addr>", trace? }` → `stopped: <reason>`, cycles, register block, and the screen diff when `until` was `screen`. Reasons: `break` (with id), `watch` (with id), `halt`, `screen`, `pc`, `cycles` (the cap), `wallclock`.
  - `step { n? = 1 (1–100) }` → trace of the executed instructions and the register block.
  - `key { text?, keys?, cps? = 20, mode? = "matrix", run? = true }` → cycles consumed and the screen diff.
  - `regs { format? }`, `peek { addr*, len? = 64 }`, `poke { addr*, bytes*, force? }` (bytes as a hex string or array; prints old → new), `screen { diff? }` (diff since the previous `screen` call).

- [ ] **Step 1: Write the failing tests:** each tool's happy path on the synthetic program; `every tool before load explains itself`; `run stops at the emulated cap`; `run stops at the wall-clock cap` (config `limits.runSecondsWall: 0.05` with `trace: true`); `poke into ROM needs force`; `load refuses model 1 naming emu phase 6`; `the same session twice gives identical text`; ROM-gated: `Sea Dragon reaches its title screen` (load, `run until: "screen"`, then `screen` shows the title text the emu `programs.test.js` checks) — the MCP phase A done-criterion.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `e4: add the phase A tools: load, reset, run, step, key, regs, peek, poke, screen`.

### Task 4: Phase B tools

**Files:**
- Create: `packages/mcp/src/tools/{break,unbreak,watch,unwatch,hits,trace,callers,disasm}.js`, `packages/mcp/src/condition.js`
- Test: `packages/mcp/test/phase-b.test.js`, `packages/mcp/test/condition.test.js`, `packages/mcp/test/story-1.test.js`

**Interfaces:**
- Consumes: `m.debug.break/unbreak/watch/unwatch/hits/trace/callers/coverage`; Task 2 formatters; the Model III symbol table via `@fugloy/disasm`'s symbol selection.
- Produces:
  - `compileCondition(text) → (m) => boolean` per Ruling 2, refusing anything else with a sentence that shows the accepted form.
  - `break { addr*, once?, condition? }` → `breakpoint #N at 5200h`; `unbreak { id? | addr? | all? }`; `watch { addr*, len? = 1, on? = "write", stop? }` → `watch #N on 3C00h–3FFFh (write)`; `unwatch { id? | all? }`; `hits { id?, n? = 50, clear?, format? }` → `cycle pc addr value prev` rows, newest last; `trace { n? = 100, regs? }` → trace lines from the ring (trace must have been on); `callers { addr*, format? }` → `from kind count` rows; `disasm { addr*, n? = 32, labels? = true }` per Ruling 7.

- [ ] **Step 1: Write the failing tests:** each tool on the synthetic program; conditions accepted and refused; `story 1 on a synthetic print routine` — a synthetic `.CMD` whose title text is written to `$3C00` by a subroutine called from three sites: `load`, `run until: "screen"`, `watch 3C00 len=1024`, `key keys=[ENTER]`, `hits`, `callers`, `disasm`, ending with the routine's address identified in the hit log and callers output, the transcript stored as `test/golden/story-01.txt` and byte-compared (synthetic ROM, so committable).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `e4: add the phase B tools: break, watch, hits, trace, callers, disasm`.

### Task 5: Phase C tools and the sidecar

**Files:**
- Create: `packages/mcp/src/tools/{label,unlabel,labels,coverage,suggest}.js`, `packages/mcp/src/sidecar.js`, `packages/mcp/src/attribution.js`
- Modify: `packages/mcp/src/tools/load.js` (sidecar on load), `packages/mcp/src/session.js`
- Test: `packages/mcp/test/phase-c.test.js`, `packages/mcp/test/sidecar.test.js`

**Interfaces:**
- Consumes: `m.debug.label`, `labelFile`, `parseLabelFile`, `mergeLabelFiles` from `@fugloy/emu`; `m.debug.hooks`.
- Produces:
  - `readSidecar(programPath, programSha256) → { labels, file } | { ignored: reason }` and `writeSidecar(session)`; `label { addr*, name*, kind? = "code", size?, note? }` (name validated with `@fugloy/disasm`'s `nameProblem`; `note` becomes the label's evidence-style comment field defined in §8 — if §8 has no such field for `user` labels, add `note` to §8 and to both readers, or store it in `evidence` only for `observed`; decide and record it), `unlabel { addr* | name* }`, `labels { range?, source? }`.
  - `coverage { mode? = "summary" | "ranges" | "export", path?, format? }`: summary = % of loaded bytes executed, counts of code and data ranges; ranges = a table; export = the full §8 file merged with the prior sidecar coverage, a session record appended, written to `path` or the sidecar.
  - `suggest { minCalls? = 5 }` per Ruling 4: unlabelled call targets with at least `minCalls` calls, sorted by calls, each with caller count and its heuristic notes.

- [ ] **Step 1: Write the failing tests:** `label writes the sidecar at once and survives a server restart` (round trip, MCP spec §10); `a broken sidecar is reported, not fatal`; `coverage export merges prior coverage and appends a session`; `suggest finds the synthetic print routine with "writes video RAM"`; `the exported file is read by the disassembler` (`openProgram` + `withLabelFile` on the synthetic program: the user label appears in the listing).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `e4: add the phase C tools: label, labels, coverage, suggest, and the sidecar file`.

### Task 6: The phase 4 deliverable and docs

**Files:**
- Create: `packages/mcp/test/story-7-rom.test.js` (ROM-gated), `prompts/story-01.md`, `prompts/story-07.md`, `.mcp.json.example` (or a documented snippet if a committed `.mcp.json` would start a server for every contributor)
- Modify: `packages/mcp/README.md` (stories 1 and 7 as the documentation, install and config), `docs/fugloy-mcp-spec.md` (§11 phases A–C met, §12 questions this plan answered, §9 dev command), `docs/fugloy-emu-spec.md` §11 (phase 4 row), `docs/Fugloy-Project-Plan.md` if it describes the MCP server, `CHANGELOG.md` `[Unreleased]`, `CLAUDE.md` (current phase; layout entry for `packages/mcp`)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the ROM-gated test** `story 7 on Sea Dragon, scripted`: load `examples/sea-dragon/seadrg01.cmd`, play a scripted minute (arrow keys and the fire key on a fixed schedule), `suggest minCalls=5` lists at least one routine credited with "writes video RAM", label it through the `label` tool, `coverage export`, then `@fugloy/disasm` with the exported file shows the label. This is the scripted form of "load a game, find its print routine, and label it unaided".
- [ ] **Step 2: Run** it and the suite; then a manual acceptance run: start the server from the working tree with the MCP Inspector or a headless Claude Code session (`claude -p` with `--mcp-config` pointing at `node packages/mcp/bin/fugloy-mcp.js`) given story 1's prompt on Sea Dragon, and record in the report what it did and whether it named the print routine unaided. If a headless run is not possible here, say so in the report; the controller asks the user to run it.
- [ ] **Step 3: Docs** as listed.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test && pnpm test:web`, and the ROM-free check in a clean worktree. Expected: PASS.
- [ ] **Step 5: Commit** `e4: prove the MCP server can find and label a print routine` and `e4: document emu phase 4`.
