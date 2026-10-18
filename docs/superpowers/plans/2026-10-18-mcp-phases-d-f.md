# MCP Phases D–F Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish `@fugloy/mcp` v0.1 as the MCP spec defines it: snapshots, diff, search, callees (D); resources, prompts, and ROM symbols (E); guardrail hardening, golden transcripts for the stories, and a publishable package with story 7 run unaided on three games (F).

**Architecture:** New tool modules in `packages/mcp/src/tools/` following `server.js`'s pattern (real zod schemas, plain-sentence errors through the `validateToolInput` override, `offset` paging from the cache, strict arguments). Resources and prompts register through the SDK's `McpServer` resource and prompt APIs in `src/resources.js` and `src/prompts.js`. `publish.sh` gains an `mcp` set (and `emu` is released first, since `@fugloy/mcp` depends on it).

**Tech Stack:** Node ≥ 22, ESM; `@modelcontextprotocol/sdk` 1.32.0 (pinned); `@fugloy/emu`, `@fugloy/disasm`, `@fugloy/z80`; Vitest.

**Spec:** `docs/fugloy-mcp-spec.md` §3 (snapshots: named, capped at 16, LRU with a notice), §5 Snapshots and `search`/`callees` rows, §6 (resources and prompts), §7 (guardrails), §10 (testing), §11 phases D–F, §12, §13 (stories 1, 2, 7); `docs/fugloy-emu-spec.md` §3/§7 (`m.debug.snapshot/restore`, `m.video.diff`).

## Global Constraints

- Everything in `docs/superpowers/plans/2026-10-18-emu-phase4-mcp.md`'s Global Constraints still binds (stdout is the protocol; text results; address and decimal-count conventions; plain-sentence errors; guardrail defaults; writes only to the sidecar and explicit export paths; Model III only; determinism; no copyrighted material committed; golden transcripts only on a synthetic ROM).
- Commit messages: imperative, one line, prefix `m4:` (MCP phases D–F, inside emu phase 4's line). No `Co-Authored-By` or any AI trailer.
- No npm publish in this plan without the user's two-factor code; the plan ends with the packages staged by `./publish.sh check`.
- After any npm publish, wait 10 minutes before checking availability.
- Keep `docs/fugloy-mcp-spec.md`, `docs/fugloy-emu-spec.md` §11, `CLAUDE.md`, `CHANGELOG.md` (detailed), `packages/mcp/README.md`, and the root README current.

## Rulings made while planning

1. **`restore`** keeps coverage, callers, the hit log, and the trace (emu spec §7) unless `clearDebug: true`, which clears coverage, callers, and hits so an agent exploring alternatives does not pollute coverage with abandoned branches (MCP spec §12, last question).
2. **`diff`** compares RAM `$4000–$FFFF` and video RAM by default (`range` narrows it); `"now"` is the live machine; output groups changed bytes into runs `addr old→new` with a run count, paged by the cache.
3. **`search`** scans the 64K address space as the CPU sees it (ROM included unless `range` excludes it); `text` matches ASCII bytes exactly and, with `fold: true`, the Model III's case-folded forms; results capped at 256 addresses with a "more" line.
4. **`callees`** is built from the callers map (edges `call` and `rst` from inside a routine's extent, as `suggest` defines it in `attribution.js`), depth ≤ 4, shown as an indented tree with call counts.
5. **ROM symbols resource** (`fugloy://rom/{model}/symbols`) is generated from `@fugloy/disasm`'s cited symbol tables (Model III ROM and hardware), one line per entry with its address, name, and purpose; no separate `@fugloy/rom-symbols` package (MCP spec §12).
6. **Prompts** are text templates (MCP spec §6) whose wording lives in `prompts/` as Markdown and is read at startup, so the repository's `prompts/story-0*.md` and the protocol's prompts are one text. Arguments: `orient {path}`, `find-writer {path, range}`, `label-pass {path, minCalls?}`, `explain {addr}`.
7. **Story 7 acceptance** runs headless (`claude -p` with the working-tree server) on the three public-domain games in `examples/` that run under `Machine` (Sea Dragon, Eliminator, Rear Guard), each on a scratch copy; the outcome per game is recorded in the CHANGELOG and the MCP README, as MCP spec §10 asks. A game where the agent cannot justify any label is recorded as such, not hidden.
8. **Versions.** `@fugloy/emu` goes to `0.2.0` (phases 2–4 changed its API) and `@fugloy/mcp` is `0.1.0`; both get `## [emu 0.2.0]` / `## [mcp 0.1.0]` CHANGELOG headings and `emu-v`/`mcp-v` tags through `publish.sh`.

## Review Focus

1. Restoring a snapshot taken before a `load` of another program must refuse or say what it does to the sidecar and labels, never silently mix programs (Task 1 test `restore across programs`).
2. The snapshot cap must evict the least recently used with a notice, never the one just restored (Task 1 test `LRU evicts the oldest untouched`).
3. A prompt asked for with a path outside the repository must work the same as `load` (path echoed), and a missing `prompts/` file must not stop the server from starting (Task 3 test `missing prompt text is a sentence`).
4. `search` for an empty byte string or text must refuse, not return every address (Task 2 test).
5. The packed `@fugloy/mcp` tarball must start with `npx` from an empty folder and answer `tools/list` (Task 5 smoke test in `publish.sh`).

---

### Task 1: Snapshots and diff (phase D part 1)

**Files:** Create `packages/mcp/src/tools/{snapshot,restore,snapshots,diff}.js`; modify `session.js` (named snapshots map with LRU order and the program each belongs to), `server.js`, `status.js` (snapshot count). Test `packages/mcp/test/phase-d-snapshots.test.js`.

**Interfaces:** `snapshot {name*}` → `snapshot "name" at cycle N (K KB)`; `restore {name*, clearDebug?}` → register block (Ruling 1); `snapshots {}` → table name, cycle, program; `diff {a*, b*, range?}` (Ruling 2). Cap 16 with LRU eviction and a notice line.

- [ ] **Step 1: Write the failing tests:** each tool; `restore across programs`; `LRU evicts the oldest untouched`; `story 2 on a synthetic program` (snapshot, key, run, diff finds the score bytes; store as `test/golden/story-02.txt`).
- [ ] **Step 2: Run** `pnpm vitest run packages/mcp/test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `m4: add snapshots, restore, and diff`.

### Task 2: search and callees (phase D part 2)

**Files:** Create `packages/mcp/src/tools/{search,callees}.js`. Test `packages/mcp/test/phase-d-search.test.js`.

**Interfaces:** `search {bytes? | text?, range?, fold?}` (Ruling 3); `callees {addr*, depth? = 2}` (Ruling 4).

- [ ] **Step 1: Write the failing tests:** bytes and text matches; folding; empty pattern refused; the 256 cap; a two-level callee tree on a synthetic program; depth bounds.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS) and `pnpm test`.
- [ ] **Step 5: Commit** `m4: add search and callees`.

### Task 3: Resources, prompts, ROM symbols (phase E)

**Files:** Create `packages/mcp/src/resources.js`, `packages/mcp/src/prompts.js`, `prompts/orient.md`, `prompts/find-writer.md`, `prompts/label-pass.md`, `prompts/explain.md` (alongside the existing `prompts/story-0*.md`; make `label-pass` the same text as story 7's prompt); modify `server.js`, `package.json` `files` (ship `prompts/` inside the package: copy or move them under `packages/mcp/prompts/` and point the root `prompts/` README at them — decide and record). Test `packages/mcp/test/phase-e.test.js`.

**Interfaces:** Resources `fugloy://status`, `fugloy://screen`, `fugloy://labels`, `fugloy://program/manifest`, `fugloy://rom/{model}/symbols` (Ruling 5); prompts `orient`, `find-writer`, `label-pass`, `explain` (Ruling 6) with their arguments.

- [ ] **Step 1: Write the failing tests:** `resources/list` and each `resources/read`; `prompts/list` and each `prompts/get` with arguments substituted; `missing prompt text is a sentence`; the ROM symbols resource includes `0033h` with its purpose.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS) and `pnpm test`.
- [ ] **Step 5: Commit** `m4: add resources, prompts, and the ROM symbols resource`.

### Task 4: Guardrail hardening and golden transcripts (phase F part 1)

**Files:** Modify tools where a §7 limit lacks a test; create `packages/mcp/test/guardrails.test.js`, `packages/mcp/test/golden/story-03.txt` (coverage separating code from data on a synthetic program) and a determinism test that replays every golden twice; a test that starts a real child process twice for the label round trip (MCP spec §10 "Round-trip").

- [ ] **Step 1: Write the failing tests:** one per §7 limit that trips it and checks the refusal text (output cap, run emulated and wall caps, trace depth and page size, step, snapshots, poke into ROM, writes outside the sidecar/export); the child-process round trip; golden story 3; determinism of all goldens.
- [ ] **Step 2–4:** run (FAIL where a limit was untested or wrong), fix, run (PASS) and `pnpm test`.
- [ ] **Step 5: Commit** `m4: harden the guardrails and add the story transcripts`.

### Task 5: Release readiness and story 7 on three games (phase F part 2)

**Files:** Modify `publish.sh` (an `mcp` set: `@fugloy/mcp` alone; its smoke test installs the tarball with the published `@fugloy/emu` of the same release — so `emu` publishes first — and checks `npx fugloy-mcp` answers `initialize` and `tools/list` over a pipe), `packages/emu/package.json` and `packages/mcp/package.json` (versions per Ruling 8; `files`, `bin`, `publishConfig`, `LICENSE`, README links absolute as the core packages have), `CHANGELOG.md` (`## [emu 0.2.0]`, `## [mcp 0.1.0]` sections, detailed), `packages/mcp/README.md` (install with `npx @fugloy/mcp`, Claude Code config with `npx`), `docs/fugloy-mcp-spec.md` §11 (phases D–F met), `docs/fugloy-emu-spec.md` §11, `CLAUDE.md`, root `README.md`.

- [ ] **Step 1:** Run story 7 unaided on Sea Dragon, Eliminator, and Rear Guard (Ruling 7), each with `claude -p --mcp-config <scratch config> --allowedTools "mcp__trs80__*"` and the `label-pass` prompt text, on scratch copies; record each game's tool-call summary, labels written, and whether a human would keep them, in the report.
- [ ] **Step 2:** Packaging changes and the `publish.sh` `mcp` set; dry-run the pack-and-install path locally the way `publish.sh check` does (it cannot fully pass until merged to `main` and CI is green).
- [ ] **Step 3:** Docs as listed, with the three acceptance results.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test && pnpm test:web` and the ROM-free check in a clean worktree. Expected: PASS.
- [ ] **Step 5: Commit** `m4: prepare emu 0.2.0 and mcp 0.1.0 and record story 7 on three games`.

After merge, the controller runs `./publish.sh check emu`, asks the user for a code, publishes, waits 10 minutes, then the same for `mcp`.
