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
| Snapshots | Process | Named; capped at 16 (`limits.snapshots`); LRU eviction with a notice (taking, restoring, or diffing a snapshot counts as a use); each records the program it belongs to and outlives a `load`, but `restore` refuses a snapshot of another program |
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

**Lengths and counts are decimal.** `len`, `n`, `cycles`, `seconds` are plain integers, never hex. A bare string `"400"` as an address means `0400h`; as a length it is refused with a message saying so, which echoes what was probably meant (`write 400, not "400"`; `write 1024, not "0x400"`). This is the single most likely agent mistake, so the error text is explicit.

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

**Arguments are strict.** Each schema is listed with `additionalProperties: false`, and an argument a tool does not declare is refused, never dropped: `run { untill: "screen" }` answers `The argument "untill" is not one run takes; it takes cycles, seconds, until, trace.` instead of running 5,000 cycles without it. Every tool also takes `offset` (§7, paging), which the list leaves out. A misspelled name is reported before a required argument it leaves missing. When the server is built with the SDK's `maxToolInputElements`, that ceiling is kept and refused in a sentence too.

### Lifecycle

| Tool | Input | Output |
|---|---|---|
| `load` | `path*`, `model?` (only 3 until emu phase 6), `reset?` (default true: a fresh machine boots its ROM to READY first) | Manifest: format (from the content, never the extension: `.CMD`, `.BAS` tokenized or ASCII, `.CAS` by its leader and sync), blocks loaded (`addr–end (len)`), entry point, which ROM was recognized, whether a sidecar label file was found, the resolved path |
| `reset` | `keepRam?` (default true; false zeroes `4000h–FFFFh`), `clear?` (also drop breaks/watches) | Register block after reset. Before any `load` it powers on a machine with no program |
| `status` | — | Model, program name, cycles, PC, counts of breaks/watches/snapshots/labels, how many traced instructions are kept |

### Execution

| Tool | Input | Output |
|---|---|---|
| `run` | `cycles?`, `seconds?` (emulated, ≤ limit), `until?` = `"break" \| "halt" \| "screen" \| "settled" \| "pc:<addr>"`, `trace?` (bool) | `stopped: <reason>` (`break`, `watch`, `halt`, `screen`, `settled`, `pc`, `cycles`, `wallclock`), cycles consumed, register block, and if `until` is `"screen"` or `"settled"` the screen diff. `screen` stops at the first check (every 2,000 T-states) where video RAM differs from the call's start; `settled` waits for that first change, then stops when video RAM returns to a state already seen since it (an animation or blink cycle has closed; full 1K states, kept by hash and compared exactly) or has stayed the same for 0.5 s emulated (1,013,760 T-states), whichever comes first, checked every 2,000 T-states; it reaches a title screen drawn in pieces, even one that animates |
| `step` | `n?` (1–100) | Trace of the executed instructions plus final register block |
| `key` | `text?`, `keys?` (array of named keys: `ENTER`, `BREAK`, `CLEAR`, `UP`, `DOWN`, `LEFT`, `RIGHT`, `SHIFT`, `SPACE`), `cps?` (default 20), `mode?` (`"matrix"`, the default, or `"hook"`: the ROM keyboard routine, which takes only characters, `ENTER`, and `SPACE`), `run?` (default true: run until the keyboard queue drains, then 0.2 s) | Cycles consumed; screen diff |

### Inspection

| Tool | Input | Output |
|---|---|---|
| `regs` | `format?` | Register block |
| `peek` | `addr*`, `len?` (default 64, max 1024) | Hex dump with labels; 1024 bytes is 64 lines, inside the output cap |
| `poke` | `addr*`, `bytes*`, `force?` (needed for ROM, `0000h–37FFh`) | Bytes written and previous values, `old → new` |
| `disasm` | `addr*`, `n?` (instructions, default 32, at most 512), `labels?` (default true) | Linear listing (`@fugloy/z80`) with coverage marks (`*` executed, as an instruction or as another instruction's operand, `d` read or written as data, `?` never seen; when a line starts on a byte executed only as an operand, a closing note names the first such address, since the listing is out of step with the code there) and, after `;`, the names an instruction's targets and operands refer to: session labels first, then the Model III ROM and hardware tables of `@fugloy/disasm` (`VIDEO`, `KEYBOARD+40h`); a labelled address gets a `NAME:` line |
| `screen` | `diff?` (`true`: since the last `screen` call, or since `load` or `restore`; a snapshot name: since that snapshot) | Full screen or changed cells as `(row,col) old→new`; every call, and `load` and `restore`, makes the screen it leaves the baseline for the next `diff: true` |
| `search` | `bytes*` (hex string or array) or `text*` (printable ASCII), `range?`, `fold?` (text only) | Addresses of every match, eight a line, under a count: the 64K address space as the CPU sees it, ROM and the keyboard included, unless `range` narrows it (a match lies wholly inside the range). `text` matches bytes exactly; `fold: true` also takes the other case of a letter and, for `@`, `A`–`Z`, and `[` to `_` (and the lower-case letters), the `00h`–`1Fh` byte the Model III's character generator shows as that character, so text written to video RAM in either form is found. At most 256 addresses, then `… and N more matches past the first 256; narrow range to see them.` An empty pattern, both patterns, or neither is refused |

### Debugging

| Tool | Input | Output |
|---|---|---|
| `break` | `addr*`, `once?`, `condition?` (`<reg> <op> <value>` clauses joined by `&&`, nothing else: `reg` is `A F B C D E H L I R`, `AF BC DE HL IX IY SP PC`, or a flag `ZF CF SF PVF HF NF`, with `Z S PV N` also accepted bare; `C` and `H` are the registers, as in Z80 assembly; `op` is `== != < <= > >=`; `value` is a number written like an address, so bare digits are hex, or is a label; a value spelled like a register or flag, as in `HL == DE` or `A == B`, is refused rather than read as hex (`DE` would be `00DEh`): comparing one register with another is not supported, and the refusal says to write `0xDE` for the hex constant) | `breakpoint #N at 5200h`, plus `(once)` and `when A == 0Dh`: the condition as it was read, values in hex |
| `unbreak` | `id?` or `addr?` (every breakpoint there) or `all?` | What was removed |
| `watch` | `addr*`, `len?` (default 1), `on?` = `"read" \| "write" \| "both"` (default `"write"`), `stop?` | `watch #N on 3C00h–3FFFh (write)` |
| `unwatch` | `id?` / `all?` | What was removed; its hits stay in the log |
| `hits` | `id?`, `n?` (default 50), `clear?`, `format?` | Hit log, newest last: `cycle pc addr value prev` and the watch; first a `By pc:` line counting every hit by the PC that made it, each with the routine it is in (the nearest call target at or below it, within 256 bytes, since load: a heuristic) |
| `trace` | `n?` (default 100, ≤ depth limit), `regs?` | Trace lines, oldest first, loops collapsed (uncollapsed with `regs`, which adds the registers before each instruction). The rule: `run` with `trace: true` and every `step` record, and nothing else does, since tracing slows emulation about fourfold. Each enables a fresh emulator ring for its own length; the server keeps the newest `limits.traceDepth` instructions across all of them, so a `step` never erases a traced run, and only `load` and `reset` empty it. `… (N cycles ran untraced)` marks execution that was not recorded between two stretches. (`since?` is deferred.) |
| `callers` | `addr*`, `format?` | `from kind count` rows (`call`, `jp`, `jr`, `rst`, `ret-to`), recorded with coverage from the load; for an address nothing reached, the nearest call target at or below it |
| `callees` | `addr*`, `depth?` (1–4, default 2) | The routines this routine called since load, as an indented tree: each callee with its call count, call sites, `(RST)` for an RST, and its name (a label, else the Model III ROM table's). Built from the callers map: the `call` and `rst` edges whose instruction lies in the routine's extent, from its address to its first executed RET as `suggest` defines it (a heuristic for a routine that jumps elsewhere). A routine already expanded is marked `(callees listed above)`, a call back into the path `(recursive; see above)`. An address that never ran as an instruction says so and names the nearest call target below it |

### Knowledge

| Tool | Input | Output |
|---|---|---|
| `label` | `addr*`, `name*` (an identifier the disassembler accepts: `nameProblem` of `@fugloy/disasm`, so no mnemonic, register, or generated `SUB_hhhh` shape, and not a name another address has), `kind?` = `"code" \| "data"`, `size?`, `note?` (a remark for a human: §8's `note`) | `Labelled 7030h PRINT (code).` and the sidecar path written; a second label at one address replaces the first and says so. A name of hex digits only (`CAFE`) is accepted with a `Note:` line, since address arguments refuse it as ambiguous and the label must be referred to by its decimal address |
| `unlabel` | `addr*` or `name*` | `Removed PRINT at 7030h.` and the sidecar path; removes a label of any source |
| `labels` | `range?`, `source?` | Table of labels by address: kind, size, source, name, and after `;` the note and evidence |
| `coverage` | `mode?` = `"summary" \| "ranges" \| "export"`, `path?` (export only), `overwrite?` (export only), `format?` (summary and ranges) | Summary: % of loaded bytes executed (an instruction or its operand), counts of code ranges and data ranges (read or written, never executed), bytes never seen, and what ran outside the loaded blocks; ranges: the loaded blocks as a table of code, data, and never-seen ranges; export: the §8 file merged with the sidecar's earlier coverage, this session appended, written to `path` or the sidecar. An existing file at `path` that is not a §8 label file (not JSON, or not the format: a `.hints` file, notes, anything else) is refused unless `overwrite: true`; a label file there is replaced, and the result says it replaced a file. A case variant of the sidecar's path on a case-insensitive volume is the sidecar, even before it exists |
| `suggest` | `minCalls?` (default 5) | Call targets with no name yet (no label, or only a generated `SUB_hhhh`) outside the ROM, reached by `CALL` or `RST` at least `minCalls` times, most calls first: calls, callers (distinct sites), and notes by address, heuristic (Ruling 4 of the emu phase 4 plan): `writes video RAM`, `reads the keyboard`, `writes port FFh (sound)`, `loops ≥ 1000× a call`. The routine runs from the target to its first executed unconditional `RET`, `RETN`, or `RETI`, ending early before a byte never executed or at another call target, within 256 bytes. The agent's starting list for story 7 |

### Snapshots

| Tool | Input | Output |
|---|---|---|
| `snapshot` | `name*` (up to 64 characters; `now` is reserved) | `snapshot "before" at cycle 10,137,610 (67 KB)`; a second snapshot of one name replaces the first and says so; past the cap, a line naming the snapshot evicted. The machine state of the emu spec §7 (not coverage, callers, the hit log, the trace, breakpoints, watches, or labels) |
| `restore` | `name*`, `clearDebug?` (default false) | `Restored "before" (cycle N, PROGRAM).`, what was kept or cleared, and the register block. Coverage, callers, the hit log, and the trace are kept, as in the emu spec §7; `clearDebug: true` clears coverage, callers, and the hit log (not the trace), so a branch explored and abandoned does not count as covered. A snapshot taken with another program loaded (or with none) is refused with a sentence naming the program to load first, since its memory would sit under this program's labels and sidecar |
| `snapshots` | — | `name cycle program`, least recently used first (the first is evicted next), with the count and cap |
| `diff` | `a*`, `b*` (snapshot names or `"now"`, the running machine), `range?` (inside `3C00-FFFF`, the default: video RAM and RAM) | A count line (`2 runs, 3 bytes changed`), then each run of adjacent changed bytes as `7E10h–7E11h (2 bytes)  64 00 → C8 00`, eight bytes a line under a header for longer runs, with any label inside a run after `;` |

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

As built (MCP phase E, 2026-10-18; `packages/mcp/src/resources.js`, `prompts.js`):

- Resources are plain text (`text/plain`). Reading one changes nothing: `fugloy://screen` does not move the baseline `screen diff: true` compares with. One that needs a program reads as the tool's sentence until one is loaded. `fugloy://program/manifest` is the text `load` returned. `fugloy://rom/{model}/symbols` is generated from `@fugloy/disasm`'s cited symbol tables, the Model III ROM and hardware ones (the machine 3, no-DOS selection the `disasm` tool names from), one line per entry: address, range, or port; kind; name; purpose (167 entries). Only model 3 exists; `fugloy://rom/1/symbols` reads as a sentence naming emu phase 6. `resources/list` lists `fugloy://rom/3/symbols`; the template is in `resources/templates/list`.
- Prompt texts live in `packages/mcp/prompts/<name>.md`, shipped in the npm package (`files`), and are read once when the server starts; the server sends each file's `## Prompt` section (a blockquote, its lines joined) with `{placeholders}` filled in, as one user message. The same files are what a person pastes into Claude Code, so story 7's prompt and `label-pass` are one text (`label-pass.md`); story 1 is `story-01.md`, which `find-writer` generalizes. The repository's root `prompts/` holds only a README pointing there.
- Arguments (strings, as the protocol has them): `orient {path}`; `find-writer {path, range}` (a range as the tools read it, `"3C00-3FFF"`; the prompt gets it as `3C00h–3FFFh` and the `watch addr`/`len` to set); `label-pass {path, minCalls?}` (a decimal count, default 5); `explain {addr}` (any address spelling or a label; sent as `6140h`). `path` is passed on as given, so a path outside the repository works as it does for `load`. Arguments are checked like a tool's: a missing or unknown one, a bad range or address, or a non-decimal `minCalls` is refused with a sentence (the server answers `prompts/get` itself rather than with the SDK's argument text). A missing prompt file does not stop the server; the prompt is listed, and `prompts/get` answers with a sentence naming the file.

## 7. Guardrails

| Limit | Default | Why |
|---|---|---|
| Output per call | 8 KB | Context budget; agent can page. Every tool that can exceed it truncates with a trailing line `… (N more; use offset=…)` and accepts `offset` |
| `run` emulated time | 10 s | A busy-wait would otherwise spin forever |
| `run` wall-clock | 5 s | Backstop if emulation is slow |
| `trace` depth | 2000 entries | Ring buffer memory; a `trace` call returns at most 100 trace lines per page (the first page also has its heading line), the rest with `offset` |
| `step` | 100 | Beyond that, use `run` with a break |
| Snapshots | 16 (`limits.snapshots`) | Each is ~64–128 KB (about 67 KB of state plus the 49 KB `diff` reads) |
| `poke` into ROM | Refused unless `force: true` | Catches agent mistakes |
| `load` outside `fixtures` dir | Allowed, but the path is echoed back | Transparency about what ran |
| Filesystem writes | Only the sidecar label file and explicit `coverage export` paths; an existing file at such a path that is not a label file only with `overwrite: true` | The server never writes elsewhere |

No tool is destructive beyond the emulated machine's RAM and the label sidecar. There is no `delete` of program files.

## 8. Label file round-trip

On `load`, the server looks for `<program>.fugloy.json` beside the program (the program's file name without its extension: `SEADRG01.CMD` → `SEADRG01.fugloy.json`), or in `fixtures` when there is none beside it; writes always go beside the program, and `load` says so when the file it read was in `fixtures`. If found, its labels (every source) become the session's, and the `disasm` tool and every address argument use them immediately; its coverage is kept as the base `coverage export` merges into (the live coverage marks still count from this load). Every `label`/`unlabel` rewrites the file at once: the file as it stands (or a skeleton naming the program and its blocks) with the session's labels in place of its own, its coverage, callers, and sessions untouched. `coverage export` merges the current session's coverage with the prior coverage read at load (union of bitfields, callers counts summed) and appends a session record; exporting again in one session replaces that record and its counts rather than adding them twice, and an export to the sidecar makes its labels (the newly observed `SUB_hhhh` call targets) the session's. A sidecar that is not JSON, breaks a rule of §8, was written for another program (its `sha256` differs), or is a symbolic link is reported by `load` and ignored, and neither `label` nor `coverage export` overwrites it (an export to another `path` still works). Before every write the server checks that the sidecar on disk is still what it last read or wrote there (absent, if neither), and refuses with a sentence when it was edited, removed, or created by hand since; it never writes through a symbolic link. `coverage export` compares files by identity (device and inode), not by spelling, so a case variant or a path through a linked folder can never name the program, the ROM, or an ignored sidecar. After `load` with `reset: false` of a different program, the machine's coverage covers both programs: `coverage export` refuses, and `coverage` and `suggest` say so. Fugløy's disassembler reads the same file; `user` labels are never overwritten by either side.

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

Until phase F publishes the package, and inside the monorepo during development, run the working tree instead. The repository commits that config as `.mcp.json.example` rather than `.mcp.json`, because a committed `.mcp.json` would start the server in every contributor's Claude Code session; copy it to `.mcp.json` (gitignored) to use it:

```json
{
  "mcpServers": {
    "trs80": {
      "command": "node",
      "args": ["packages/mcp/bin/fugloy-mcp.js"],
      "env": { "FUGLOY_CONFIG": "./fugloy.mcp.json" }
    }
  }
}
```

The bin imports `@fugloy/disasm` and `@fugloy/z80` from their `dist/` folders, so run `pnpm build` (or `pnpm typecheck`, which builds them) once after cloning. `fugloy.mcp.json` names your ROM (copy `fugloy.mcp.example.json`). For a headless check, `claude -p "<prompt>" --mcp-config <file> --allowedTools "mcp__trs80__*"` runs one session non-interactively.

Dependency declaration in `packages/mcp/package.json` uses pnpm's `workspace:*` for `@fugloy/emu`, `@fugloy/disasm`, and `@fugloy/z80`, since the monorepo is a pnpm workspace; `pnpm pack` and `pnpm publish` rewrite each to the exact version of the local package, so the published package carries ordinary semver ranges. (Publish with pnpm, not npm: npm would leave `workspace:*` in place and fail to fetch it.)

First session, verbatim:

> load fixtures/real/DEFENDER.CMD, run until the screen settles, and tell me what ROM routines it called.

The prompts for stories 1 and 7 are kept in `packages/mcp/prompts/story-01.md` and `packages/mcp/prompts/label-pass.md`, the second also served as the `label-pass` prompt (§6, §13 "How to use the stories").

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
| A | `load`, `reset`, `status`, `run`, `step`, `regs`, `peek`, `poke`, `screen`, `key` | Agent can load a game and reach its title screen. **Met** (2026-10-18): `test/phase-a-rom.test.js` loads Sea Dragon from `examples/`, and two `run until: "settled"` calls (the intro animation's cycle, then the title's) leave the title and copyright on `screen`; ENTER then reaches `1 or 2 Players?`. An ASCII `.BAS` program is typed in through the ROM and runs. The phase A tools run on a synthetic ROM in CI (`test/phase-a.test.js`) |
| B | `break`, `watch`, `hits`, `trace`, `callers`, `disasm` | Story 1 (find the print routine) works. **Met** for a synthetic program (2026-10-18): `test/story-1.test.js` replays load, run until screen, a video RAM watch, ENTER, hits, callers, and disasm, which name the routine at `7030h` and its three call sites, and byte-compares the committed `test/golden/story-01.txt`; and for a real game (see C) |
| C | `label`, `labels`, `coverage`, `suggest`, sidecar file | Story 3 and 7 work; Fugløy reads the output. **Met** (2026-10-18), which is emu phase 4's done-criterion (emu spec §11). Story 7 in scripted form, `test/story-7-rom.test.js` on Sea Dragon and the Model III ROM: load, two settled runs, ENTER, one player, Novice, a scripted minute of arrow keys and SPACE; `suggest minCalls=5` lists `6140h` (700 calls from 6 sites) among the routines that write video RAM; a watch on the screen line that holds text shows every write there made at `6141h`, in the routine called at `6140h`, and every value printable; `label` names it `PRINT` with a note, `coverage export` writes the sidecar, and `@fugloy/disasm` reads that file and lists `PRINT:`, the note, and `CALL PRINT`. Story 3 on a synthetic program, `test/phase-c.test.js`: coverage separates code from data and the exported file is read by the disassembler. Unaided, a headless Claude Code session given story 1's prompt on Sea Dragon loaded it, watched video RAM, ran until settled, read `hits`, `suggest`, `callers`, and `disasm`, and labelled `6140h` `PRINT_TEXT` with a correct note, in 15 turns (2026-10-18; `packages/mcp/README.md`). Story 7 on three games unaided, §10's agent acceptance, is the release check for F |
| D | Snapshots, `diff`, `search`, `callees` | Story 2 (locate variables) works. Snapshots and `diff` are in (2026-10-18): `test/phase-d-snapshots.test.js` replays story 2 on a synthetic program (snapshot, `key` A, run, `diff` names the score byte at `7E10h` and a press counter, peek, a second press, label `SCORE`) and byte-compares the committed `test/golden/story-02.txt`. `search` and `callees` are in (2026-10-18): `test/phase-d-search.test.js` finds bytes and text (folded and not) on a synthetic program, checks the 256-address cap and the refusals, and draws a three-level callee tree with a recursive routine and an RST |
| E | Resources, prompts, ROM symbol tables | `orient` prompt gives a useful first report unaided. Resources, prompts, and the ROM symbols resource are in (2026-10-18, §6 "As built"): `test/phase-e.test.js` lists and reads each resource before and after a load, gets each prompt with its arguments filled in (and `label-pass` byte for byte the story 7 file's prompt), refuses bad arguments with sentences, starts with the prompt files missing, and finds `0033h $VDCHAR` with its purpose in `fugloy://rom/3/symbols`. The unaided `orient` run is the remaining check |
| F | Guardrail hardening, golden transcripts, npm publish | v0.1.0 on npm under `@fugloy`. Guardrails and transcripts are in (2026-10-18): `test/guardrails.test.js` trips each §7 limit and checks its text (the output cap and paging, `run`'s emulated and wall-clock caps, trace depth and its 100-line page, `step`, `peek`, the snapshot cap, `poke` into ROM, `load` outside the fixtures folder, and a session calling every tool that writes only the sidecar and an explicit export path), and does §10's round trip across two child processes of the bin; `test/golden.test.js` adds story 3 (`test/golden/story-03.txt`, coverage separating code, data, and never-seen bytes on a synthetic program) and replays every golden story twice, byte for byte |

Phase A can begin the day `@fugloy/emu` boots to `READY` in Node (emu Phase 0), using `key` to type BASIC; `load` for `.CMD` arrives with emu Phase 2. Phases B–C need emu Phase 3. Don't start A before emu Phase 0 is green — a server over a core that can't boot is two things to debug at once.

## 12. Open questions

- [x] Condition expressions on `break`: a tiny custom evaluator, or accept only `reg == value` forms? (A real expression language is a security surface, even in-process.) Settled in emu phase 4: only `<reg> <op> <value>` clauses joined by `&&` (§5 `break`).
- [x] Should `key` understand BASIC line injection (`10 PRINT "HI"`) as a special case, or is `cps` pacing enough? Settled in emu phase 4: no special case. `key` types through the matrix at `cps` (default 20) or, with `mode: "hook"`, hands characters to the ROM's keyboard routine, which takes BASIC lines at any speed; and `load` of an ASCII `.BAS` file types the program in through the hook.
- [x] Is `suggest`'s heuristic list worth hard-coding, or should it just emit raw counts and leave judgment to the agent? Settled in emu phase 4: both. Raw counts come first (calls, distinct call sites), then four notes attributed by instruction address and labelled "by address, heuristic": `writes video RAM`, `reads the keyboard`, `writes port FFh (sound)`, `loops ≥ 1000× a call` (§5 `suggest`). On Sea Dragon the notes single out the drawing, printing, and sound routines among twenty targets; the agent still decides which one prints text, with `hits`.
- [ ] Streamable HTTP for workbench sharing: in scope for 1.0 or never?
- [ ] One server per machine model, or a `model` switch at `load`? (Current spec: switch at `load`, which forces a reset.) Emu phase 4 has the `model` argument; only 3 exists, and 1 or 4 is refused naming emu phase 6.
- [x] Publish ROM symbol tables as a separate `@fugloy/rom-symbols` package so the disassembler and workbench share them? Settled in MCP phase E: no. The tables stay in `@fugloy/disasm` (cited JSON, compiled by `pnpm symbols`), which the workbench already uses and the MCP server depends on; `fugloy://rom/{model}/symbols` is generated from them (§6).
- [x] Fixture programs are copyrighted games in a gitignored folder. Golden transcripts (§10) embed their screen text and bytes. Are those transcripts committable, or do they need to live outside the public repo too? Settled in emu phase 4: a golden transcript is committed only for a session on a synthetic ROM and a synthetic program (`test/golden/story-01.txt`); a session on the real Model III ROM, even with a public-domain game, asserts properties instead, since its output would carry ROM screen text.
- [x] `restore` resets machine state but not coverage or the hit log (emu spec §7). Should the MCP layer offer `restore clearDebug: true` so an agent exploring alternatives doesn't pollute coverage with abandoned branches? Settled in MCP phase D: yes. `restore` keeps coverage, callers, the hit log, and the trace by default; `clearDebug: true` clears coverage, callers, and the hit log (and the per-address facts `suggest` reads), keeping the trace (§5 `restore`).

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
4. **As Claude Code prompts.** Keep the story prompts in `packages/mcp/prompts/` in the repo (shipped in the npm package). When you sit down to reverse-engineer a new game, you paste story 7's prompt and go make coffee. The `label-pass` MCP prompt is the same text, offered through the protocol.
5. **As a gap detector.** Any story you can't tell with the §5 tool list means a tool is missing. Story 2 is why `diff` exists; story 4 (computed jumps) is why `break` takes a condition.
6. **As GitHub issues.** One issue per story, labeled `story`, closed by the PR that makes its golden transcript pass. The issue list is then the roadmap and the changelog at once.

The stories to write next, once these work: the Fugløy differential harness (story 5) as a `verify` tool that runs the original and the recompiled JS in lockstep, and the accessibility bridge (story 14) as a `screen` subscription over Streamable HTTP.
