# MCP Server Spec — `@fugloy/mcp`

*Draft v0.1 · 2026-10-14 · Christopher Schweda*

Companion to `fugloy-emu-spec.md`. That document defines the emulator core; this one defines the server that puts it in front of an AI agent.

## 1. Purpose

`@fugloy/mcp` is a stdio MCP server that exposes a running TRS-80 (via `@fugloy/emu`) to Claude Code or any MCP client. It lets an agent load a program, run it, inspect memory and registers, inject input, read the screen, and record what it learns as labels and coverage that the Fugløy disassembler consumes.

Primary user: Chris, driving Claude Code on a `.CMD` he wants to recompile. Secondary: anyone reverse-engineering, developing, or preserving TRS-80 software.

What it is not: a GUI, a game player for humans, or a general Z80 assembler/IDE. It has no UI; the workbench does.

## 2. Architecture

```
Claude Code ──stdio/JSON-RPC──▶ @fugloy/mcp ──in-process──▶ @fugloy/emu
                                     │
                                     ├── session state (one Machine, snapshots, labels)
                                     ├── formatters (hex dumps, screens, traces → text)
                                     ├── guardrails (output caps, run-time caps)
                                     └── label/coverage file I/O (§8 of emu spec)
```

- **Transport:** stdio only in v0.1. Streamable HTTP later if the workbench wants to share a session.
- **Runtime:** Node ≥ 22, ESM, official `@modelcontextprotocol/sdk`. No native deps.
- **One machine per process.** A server instance owns exactly one `Machine`. Multiple machines means multiple server entries in the client config. This keeps every tool call unambiguous and the state model trivial.
- **Synchronous execution.** `run` blocks until its cap or a stop condition. The emulator runs 20× real time, so a 10-second emulated cap returns in under a second. A wall-clock cap (default 5 s) backs this up in case tracing or a pathological hook makes emulation slow; hitting it returns `reason: "wallclock"` rather than hanging the client.
- **No background execution.** Nothing runs between tool calls. The agent always knows the machine is paused.
- **stdout is the protocol.** All logging goes to stderr. A single stray `console.log` in the emulator corrupts the JSON-RPC stream; the server installs a guard that redirects `console.log` to stderr at startup.

## 3. Session model

| State | Lifetime | Notes |
|---|---|---|
| `Machine` | Process | Created on first `load` or `reset`, with model from config or the `load` call |
| Breakpoints, watches | Process | Survive `reset` unless `clear: true` |
| Snapshots | Process | Named; capped at 16; LRU eviction with a notice |
| Labels | Process + disk | Loaded from `<program>.fugloy.json` beside the program if present; `label` writes back on every change; `coverage export` writes the full §8 file |
| Trace ring | Process | Cleared on `reset` |
| Hit log | Process | Cleared on `reset` or `hits clear` |

Config file `fugloy.mcp.json` in cwd or `~/.config/fugloy/`:

```json
{
  "roms": { "model1": "./roms/level2.rom", "model3": "./roms/model3.rom", "model4": "./roms/model4.rom" },
  "defaultModel": 3,
  "fixtures": "./fixtures/real",
  "limits": { "runSecondsEmulated": 10, "outputBytes": 4096, "traceDepth": 2000 }
}
```

## 4. Conventions

**Addresses.** Accept `"5200"`, `"0x5200"`, `"$5200"`, `20992`, or a known label name. Always echo back as `5200h`. Ranges as `"5200-52FF"` or `{ addr, len }`.

**Lengths and counts are decimal.** `len`, `n`, `cycles`, `seconds` are plain integers, never hex. A bare string `"400"` as an address means `0400h`; as a length it is refused with a message saying so. This is the single most likely agent mistake, so the error text is explicit.

**Bytes out.** Hex dump, 16 per line, with ASCII gutter, labels interleaved on their own line when a labeled address falls in range:

```
5200  21 00 3C 11 01 3C 01 FF  03 36 20 ED B0 C9 00 00  !.<..<...6 .....
      ; CLS
5210  3E 0D CD 33 00 C9 ...
```

**Bytes in.** Hex string `"21003C"` or array `[0x21, 0x00, 0x3C]`.

**Registers.** One block, flags decoded:

```
PC 5214  SP FF00  AF 0D44  BC 03FF  DE 3C01  HL 3C00  IX 0000  IY 0000
AF' 0000 BC' 0000 DE' 0000 HL' 0000  I 00  R 2A  IFF1 0  IFF2 0  IM 1
Flags: S0 Z1 H0 PV1 N0 C0     Cycles: 48,201,339
```

**Screen.** 16 lines of 64 characters inside a fence, with a ruler, non-printables as `·`:

```
          111111111122222222223333333333444444444455555555556666
0123456789012345678901234567890123456789012345678901234567890123
READY
>_
```

**Trace lines.** `PC  bytes      mnemonic          ; label/comment  [cycles]`, loops collapsed as `  ×212 (5214h–521Ah)`.

**Errors.** Plain sentences, never stack traces. `"No program loaded; call load first."` The agent should be able to act on every error without reading source.

Every tool result is text (`type: "text"`) in v0.1. Structured JSON is offered as an optional `format: "json"` on `regs`, `coverage`, `callers` and `hits` for when the agent wants to compute rather than read.

## 5. Tools

Schemas are JSON Schema in the SDK; shown here abbreviated. Required fields marked `*`.

### Lifecycle

| Tool | Input | Output |
|---|---|---|
| `load` | `path*`, `model?` (1/3/4), `format?` (auto from extension), `reset?` (default true) | Manifest: format, blocks loaded (addr/len), entry point, which ROM was recognized, whether a sidecar label file was found |
| `reset` | `keepRam?`, `clear?` (also drop breaks/watches) | Register block after reset |
| `status` | — | Model, program name, cycles, PC, counts of breaks/watches/snapshots/labels, trace on/off |

### Execution

| Tool | Input | Output |
|---|---|---|
| `run` | `cycles?`, `seconds?` (emulated, ≤ limit), `until?` = `"break" \| "halt" \| "screen" \| "pc:<addr>"`, `trace?` (bool) | Stop reason, cycles consumed, register block, and if `until:"screen"` the screen diff |
| `step` | `n?` (1–100) | Trace of the executed instructions plus final register block |
| `key` | `text?`, `keys?` (array of named keys: `ENTER`, `BREAK`, `CLEAR`, `UP` …), `cps?` (default 20), `run?` (default true: run until the keyboard queue drains) | Cycles consumed; screen diff |

### Inspection

| Tool | Input | Output |
|---|---|---|
| `regs` | `format?` | Register block |
| `peek` | `addr*`, `len?` (default 64, max 1024) | Hex dump with labels; 1024 bytes is 64 lines, inside the output cap |
| `poke` | `addr*`, `bytes*` | Bytes written and previous values |
| `disasm` | `addr*`, `n?` (instructions, default 32), `labels?` (default true) | Listing with labels and coverage marks (`*` executed, `?` never seen, `d` read as data) |
| `screen` | `diff?` (since last `screen` call or a snapshot name) | Full screen or changed cells as `(row,col) old→new` |
| `search` | `bytes*` or `text*`, `range?` | Addresses of every match |

### Debugging

| Tool | Input | Output |
|---|---|---|
| `break` | `addr*`, `once?`, `condition?` (small expression over regs, e.g. `"A == 0x0D"`) | Breakpoint id |
| `unbreak` | `id?` or `addr?` or `all?` | Confirmation |
| `watch` | `addr*`, `len?`, `on?` = `"read" \| "write" \| "both"`, `stop?` | Watch id |
| `unwatch` | `id?` / `all?` | Confirmation |
| `hits` | `id?`, `n?` (default 50), `clear?` | Hit log: `cycle pc addr value prev` |
| `trace` | `n?` (default 100, ≤ depth limit), `since?` (cycle), `regs?` | Trace lines |
| `callers` | `addr*` | `from kind count` rows |
| `callees` | `addr*`, `depth?` | Addresses this routine calls, as a tree |

### Knowledge

| Tool | Input | Output |
|---|---|---|
| `label` | `addr*`, `name*`, `kind?` = `"code" \| "data"`, `size?`, `note?` | Confirmation; writes sidecar file |
| `unlabel` | `addr*` or `name*` | Confirmation |
| `labels` | `range?`, `source?` | Table of labels |
| `coverage` | `mode?` = `"summary" \| "ranges" \| "export"`, `path?` | Summary: % of loaded bytes executed, number of code/data ranges; ranges as a table; export writes the §8 file |
| `suggest` | `minCalls?` (default 5) | Unlabeled addresses that are call targets, with caller count and a one-line heuristic (`writes video RAM`, `reads keyboard`, `loops ≥ 1000×`) — the agent's starting list for story 7 |

### Snapshots

| Tool | Input | Output |
|---|---|---|
| `snapshot` | `name*` | Confirmation, size |
| `restore` | `name*` | Register block |
| `snapshots` | — | List with cycle counts |
| `diff` | `a*`, `b*` (snapshot names or `"now"`), `range?` | Changed bytes as `addr old→new`, grouped into runs |

## 6. Resources and prompts

**Resources** (read-only, for context without a tool call):

| URI | Content |
|---|---|
| `fugloy://status` | Same as the `status` tool |
| `fugloy://screen` | Current screen text |
| `fugloy://labels` | Label table |
| `fugloy://program/manifest` | Load manifest |
| `fugloy://rom/{model}/symbols` | Known ROM entry points (`0033h PUT CHAR`, `0049h KEY WAIT`, `01C9h CLS` …) so the agent recognizes ROM calls without being told |

**Prompts** (MCP prompt templates the client can offer):

| Name | Fills in |
|---|---|
| `orient` | Load, run to first screen, report ROM calls seen and a `suggest` list — the standard opening move |
| `find-writer` | Given an address range, set a write-watch, prompt for one input, report the writing routine |
| `label-pass` | Story 7: iterate `suggest`, investigate each, write labels with evidence, stop when none exceed `minCalls` |
| `explain` | Given an address, break, step, watch, and answer in prose with the trace as evidence |

Prompts are where the reverse-engineering method lives. The tools are deliberately dumb.

## 7. Guardrails

| Limit | Default | Why |
|---|---|---|
| Output per call | 8 KB | Context budget; agent can page. Every tool that can exceed it truncates with a trailing line `… (N more; use offset=…)` and accepts `offset` |
| `run` emulated time | 10 s | A busy-wait would otherwise spin forever |
| `run` wall-clock | 5 s | Backstop if emulation is slow |
| `trace` depth | 2000 entries | Ring buffer memory; a `trace` call returns at most 100 lines per page |
| `step` | 100 | Beyond that, use `run` with a break |
| Snapshots | 16 | Each is ~64–128 KB |
| `poke` into ROM | Refused unless `force: true` | Catches agent mistakes |
| `load` outside `fixtures` dir | Allowed, but the path is echoed back | Transparency about what ran |
| Filesystem writes | Only the sidecar label file and explicit `coverage export` paths | The server never writes elsewhere |

No tool is destructive beyond the emulated machine's RAM and the label sidecar. There is no `delete` of program files.

## 8. Label file round-trip

On `load`, the server looks for `<program>.fugloy.json` beside the program (or in `fixtures`). If found, labels and prior coverage are merged in; the `disasm` tool shows them immediately. Every `label`/`unlabel` rewrites the file. `coverage export` merges the current session's coverage with any prior coverage (union of bitfields) and appends a session record. Fugløy's disassembler reads the same file; `user` labels are never overwritten by either side.

## 9. Install and use

```
npm i -g @fugloy/mcp            # or npx @fugloy/mcp
```

Claude Code config (`.mcp.json` in the Fugløy repo so it's project-scoped):

```json
{
  "mcpServers": {
    "trs80": {
      "command": "npx",
      "args": ["-y", "@fugloy/mcp"],
      "env": { "FUGLOY_CONFIG": "./fugloy.mcp.json" }
    }
  }
}
```

Inside the monorepo during development, point `command` at `node packages/mcp/bin/fugloy-mcp.js` instead so you're testing the working tree, not the published package.

Dependency declaration in `packages/mcp/package.json` uses pnpm's `workspace:*` for `@fugloy/emu`, `@fugloy/disasm`, and `@fugloy/z80`, since the monorepo is a pnpm workspace; `pnpm pack` and `pnpm publish` rewrite each to the exact version of the local package, so the published package carries ordinary semver ranges. (Publish with pnpm, not npm: npm would leave `workspace:*` in place and fail to fetch it.)

First session, verbatim:

> load fixtures/real/DEFENDER.CMD, run until the screen settles, and tell me what ROM routines it called.

## 10. Testing

| Test | Method |
|---|---|
| Tool schemas | Every tool has a schema test: valid input accepted, each invalid field rejected with a readable message |
| Golden transcripts | Scripted tool sequences against fixture programs; outputs byte-compared to stored transcripts (`test/golden/*.txt`) |
| Guardrails | Each limit has a test that trips it and checks the refusal text |
| Round-trip | `label` → file → restart server → `labels` shows them |
| Agent acceptance | Story 7 via Claude Code on three fixtures, run manually before each release; results logged in `CHANGELOG` |
| Determinism | Same transcript twice → identical output, including cycle counts |

The MCP Inspector (`npx @modelcontextprotocol/inspector`) is the manual test harness.

## 11. Build phases

| Phase | Scope | Done when |
|---|---|---|
| A | `load`, `reset`, `status`, `run`, `step`, `regs`, `peek`, `poke`, `screen`, `key` | Agent can load a game and reach its title screen |
| B | `break`, `watch`, `hits`, `trace`, `callers`, `disasm` | Story 1 (find the print routine) works |
| C | `label`, `labels`, `coverage`, `suggest`, sidecar file | Story 3 and 7 work; Fugløy reads the output |
| D | Snapshots, `diff`, `search`, `callees` | Story 2 (locate variables) works |
| E | Resources, prompts, ROM symbol tables | `orient` prompt gives a useful first report unaided |
| F | Guardrail hardening, golden transcripts, npm publish | v0.1.0 on npm under `@fugloy` |

Phase A can begin the day `@fugloy/emu` boots to `READY` in Node (emu Phase 0), using `key` to type BASIC; `load` for `.CMD` arrives with emu Phase 2. Phases B–C need emu Phase 3. Don't start A before emu Phase 0 is green — a server over a core that can't boot is two things to debug at once.

## 12. Open questions

- [ ] Condition expressions on `break`: a tiny custom evaluator, or accept only `reg == value` forms? (A real expression language is a security surface, even in-process.)
- [ ] Should `key` understand BASIC line injection (`10 PRINT "HI"`) as a special case, or is `cps` pacing enough?
- [ ] Is `suggest`'s heuristic list worth hard-coding, or should it just emit raw counts and leave judgment to the agent?
- [ ] Streamable HTTP for workbench sharing: in scope for 1.0 or never?
- [ ] One server per machine model, or a `model` switch at `load`? (Current spec: switch at `load`, which forces a reset.)
- [ ] Publish ROM symbol tables as a separate `@fugloy/rom-symbols` package so the disassembler and workbench share them?
- [ ] Fixture programs are copyrighted games in a gitignored folder. Golden transcripts (§10) embed their screen text and bytes. Are those transcripts committable, or do they need to live outside the public repo too?
- [ ] `restore` resets machine state but not coverage or the hit log (emu spec §7). Should the MCP layer offer `restore clearDebug: true` so an agent exploring alternatives doesn't pollute coverage with abandoned branches?

## 13. User stories and how to use them

The stories live in `fugloy-emu-spec.md` §13 (fourteen, grouped by who is driving). This section shows three of them as real sessions, then how the stories drive the build.

### Story 1 as a session: find the print routine

You, in Claude Code, inside the Fugløy repo:

> Load fixtures/real/DEFENDER.CMD and find the routine that writes text to the screen. Label it.

What the agent does, tool by tool:

```
load    path=fixtures/real/DEFENDER.CMD
        → Model III, 3 blocks (5200-71FF), entry 5200h, no sidecar labels
run     until=screen seconds=2
        → stopped: screen changed at cycle 1,204,118 · title screen visible
watch   addr=3C00 len=1024 on=write
        → watch #1
key     keys=[ENTER]
        → 18,402 cycles · screen diff: 6 cells changed on row 15
hits    id=1 n=10
        → cycle 1,222,004  pc 5A41  addr 3FC0  value 50 prev 20
          cycle 1,222,019  pc 5A41  addr 3FC1  value 52 prev 20   (×6)
callers addr=5A3C
        → from 5310 call ×4 · from 5388 call ×2 · from 6012 call ×212
disasm  addr=5A3C n=12
        → 5A3C LD (HL),A ; 5A3D INC HL ; … 5A49 RET   (loop, writes video RAM)
label   addr=5A3C name=PUTS kind=code
        note="writes 3C00-3FFF in a loop; called 218× from 3 sites"
```

Agent's reply: "The print routine is at 5A3Ch, now labeled PUTS. It copies a string from DE to the video address in HL until a zero byte. The heaviest caller is 6012h, which is probably the main status-line updater."

Total: nine tool calls, under a minute. The same work by hand in a hex editor is an afternoon.

### Story 2 as a session: locate game variables

> Find where DEFENDER keeps the score.

```
snapshot name=before
key      text="A"          (fire, scores points)
run      seconds=1
diff     a=before b=now range=4000-7FFF
         → 3 runs changed: 7E10-7E11 (2 bytes), 7E20 (1 byte), 7F00-7F3F (64 bytes)
peek     addr=7E10 len=2
         → 7E10  64 00     d.         (0x0064 = 100)
key      text="A"
run      seconds=1
peek     addr=7E10 len=2
         → 7E10  C8 00     È.         (0x00C8 = 200)
label    addr=7E10 name=SCORE kind=data size=2 note="increments by 100 per hit; little-endian"
```

The 64-byte run at 7F00 is almost certainly the sprite buffer; the agent labels that too, or asks.

### Story 7 as a session: label a whole program unaided

This is the autonomous one, and the acceptance test for shipping.

> Use the label-pass prompt on fixtures/real/DEFENDER.CMD. Play for about two minutes using the arrow keys and A, then label every subroutine called more than five times. Stop when you can't justify a name.

The `label-pass` prompt drives this loop:

```
load → run until screen → (key arrows/A, run 1s) ×120 → coverage mode=summary
       → 71% of loaded bytes executed; 14 code ranges, 9 data ranges
suggest minCalls=5
       → 23 unlabeled call targets:
         5A3C ×218 writes video RAM
         5B10 ×212 reads 3800-3BFF (keyboard)
         6012 ×212 calls 5A3C
         5C00 ×119 loops ≥1000× (delay?)
         …
for each: disasm, callers, maybe break+step, then label with evidence
coverage mode=export path=fixtures/real/DEFENDER.fugloy.json
```

You review `DEFENDER.fugloy.json` the next morning. Twenty-three draft labels with evidence strings; you rename five, delete two, keep the rest. Then `fugloy disasm DEFENDER.CMD` produces a listing that reads like something a person annotated.

### How to use the stories

1. **As phase gates.** Each build phase in §11 names the story it unlocks. A phase isn't done because the tools exist; it's done when the story runs end to end. Put the story's exact prompt in the phase's PR description.
2. **As golden transcripts.** Record each story's tool-call sequence against a fixture program and store it under `test/golden/story-01.txt` etc. The test replays the sequence and byte-compares output. When you change a formatter, these tell you what moved.
3. **As the README.** Stories 1, 2 and 7, written as above, *are* the documentation. Someone who reads three sessions knows how to use the server better than someone who reads the tool table.
4. **As Claude Code prompts.** Keep the story prompts in `prompts/` in the repo. When you sit down to reverse-engineer a new game, you paste story 7's prompt and go make coffee. The `label-pass` MCP prompt is the same text, offered through the protocol.
5. **As a gap detector.** Any story you can't tell with the §5 tool list means a tool is missing. Story 2 is why `diff` exists; story 4 (computed jumps) is why `break` takes a condition.
6. **As GitHub issues.** One issue per story, labeled `story`, closed by the PR that makes its golden transcript pass. The issue list is then the roadmap and the changelog at once.

The stories to write next, once these work: the Fugløy differential harness (story 5) as a `verify` tool that runs the original and the recompiled JS in lockstep, and the accessibility bridge (story 14) as a `screen` subscription over Streamable HTTP.
