# @fugloy/mcp

A stdio MCP server that puts a running TRS-80 (`@fugloy/emu`) in front of
Claude Code or any MCP client: load a program, run it, inspect memory and
registers, type on its keyboard, read the screen, set breakpoints and
watches, and record labels and coverage in the file the Fugløy disassembler
reads. Version 0.1.0, MCP phases A–F (spec §11): the tools of phases A–C
(built as the emulator's phase 4), with which an assistant can load a game,
find its print routine, and label it on its own; snapshots, `diff`, `search`,
and `callees` (D); resources and prompts (E); and the guardrail tests, golden
transcripts, and npm package (F). Before release it labelled three
public-domain games on its own (story 7, below).

- Spec: [`docs/fugloy-mcp-spec.md`](https://github.com/cschweda/fugloy/blob/main/docs/fugloy-mcp-spec.md) (the tools in §5, phases A–F in §11, the stories in §13)
- Companion core spec: [`docs/fugloy-emu-spec.md`](https://github.com/cschweda/fugloy/blob/main/docs/fugloy-emu-spec.md)
- Label and coverage file it reads and writes: [`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md)
- Prompts, shipped in the package: [`prompts/`](https://github.com/cschweda/fugloy/tree/main/packages/mcp/prompts) (story 1 in `story-01.md`; story 7 is `label-pass.md`)

## Set up

`@fugloy/mcp` is on npm (0.1.0, 2026-10-18): run it from npm with Node 22 or later
(`npx -y @fugloy/mcp`; for development, use the clone setup below,
`node packages/mcp/bin/fugloy-mcp.js`). Write a `fugloy.mcp.json` that names
your Model III ROM (paths in it are relative to the file):

```json
{ "roms": { "model3": "./roms/model3.rom" } }
```

and give Claude Code the server, in `.mcp.json` in the folder you start it
in, or with `claude mcp add`:

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

```sh
claude mcp add trs80 -e FUGLOY_CONFIG="$PWD/fugloy.mcp.json" -- npx -y @fugloy/mcp
```

`npx @fugloy/mcp` (or `npm i -g @fugloy/mcp`, then `fugloy-mcp`) starts the
server on stdio; it installs `@fugloy/emu`, `@fugloy/disasm`, and
`@fugloy/z80` with it, and the MCP SDK and zod at exact versions.

From a clone of the monorepo, with Node 22 and pnpm 10, run the working tree
instead:

```sh
pnpm install
pnpm build                                  # the bin imports @fugloy/disasm and @fugloy/z80 from dist/
cp fugloy.mcp.example.json fugloy.mcp.json  # then point roms.model3 at your Model III ROM
cp .mcp.json.example .mcp.json              # Claude Code starts the server for this folder
```

`.mcp.json.example` runs the working tree:

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

It is committed as an example, not as `.mcp.json`, so the server starts only
for those who copy it (`.mcp.json` is gitignored). Start Claude Code at the
repository root: the paths in it (`packages/mcp/bin/fugloy-mcp.js`,
`./fugloy.mcp.json`) are relative to the server's working directory, which is
the folder Claude Code was started in. Because it sets `FUGLOY_CONFIG`, the
server exits at startup, with one line on stderr naming the path, when
`fugloy.mcp.json` is missing; Claude Code then shows the `trs80` server as
failed. Copy the example config first. The server reads
`fugloy.mcp.json` from `$FUGLOY_CONFIG`, else the working directory, else
`~/.config/fugloy/` (spec §3); paths in it are relative to the file, and its
`limits` override the guardrails of spec §7. You bring the ROM: see "Getting
ROMs and programs" in the [main README](https://github.com/cschweda/fugloy/blob/main/README.md). stdout carries
JSON-RPC only; console output and the emulator's log go to stderr.

Any other MCP client works the same way: run `node packages/mcp/bin/fugloy-mcp.js`
over stdio with `FUGLOY_CONFIG` set. The MCP Inspector
(`npx @modelcontextprotocol/inspector node packages/mcp/bin/fugloy-mcp.js`)
lists the tools and calls them by hand.

## The tools

One machine per server process, a Model III; nothing runs between calls.
Every result is text, and every error is a sentence the agent can act on.
Addresses are hex (`5200`, `0x5200`, `$5200`, `5200h`), a JSON number
(decimal), or a label name; lengths and counts are decimal. Arguments are
strict: a name a tool does not take (`untill`) is refused with the names it
does take, never ignored.

| Group | Tools |
| --- | --- |
| Lifecycle | `load` (`.CMD`, `.BAS`, `.CAS`, or a JV1, JV3, or DMK disk image, detected by content; boots the ROM to `READY` first, or boots the disk from drive 0), `reset`, `status` |
| Execution | `run` (`cycles`, `seconds`, or `until`: `break`, `halt`, `screen`, `settled`, `pc:<addr>`; `trace`), `step`, `key` (text and named keys, through the keyboard matrix or the ROM's keyboard routine) |
| Inspection | `regs`, `peek`, `poke`, `disasm` (with coverage marks and names), `screen` (or its diff since the last call or a snapshot), `search` (bytes or text, `fold` for either case and the screen's `00h`–`1Fh` forms; at most 256 addresses) |
| Debugging | `break` (with `<reg> <op> <value>` conditions), `unbreak`, `watch`, `unwatch`, `hits` (with the routine each writing PC is in), `trace`, `callers`, `callees` (the routines a routine called, as a tree up to 4 levels deep) |
| Knowledge | `label`, `unlabel`, `labels`, `coverage` (summary, ranges, export), `suggest` (the call targets worth naming next, with what they were seen doing) |
| Snapshots | `snapshot`, `restore` (`clearDebug` also clears coverage, callers, and the hit log; a snapshot of another program is refused), `snapshots`, `diff` (two snapshots, or one and `now`: changed bytes in runs) |

The full table, with every argument and output, is spec §5. Coverage and
callers are recorded from the load, so `suggest` and `coverage` need no
setup. `run until: "settled"` stops once the screen has changed and then
either closes an animation or blink cycle or stays still for 0.5 s; a title
screen that animates takes one call per phase (Sea Dragon's intro, then its
title).

A disk image (unreleased, emu phase 5) goes into drive 0 of a fresh Model III,
and `load` runs until the ROM has read the boot sector and jumped to it at
`4300h`. The disk's own loader then reads the rest as the drive turns, which
takes seconds of emulated time, so follow it with `run until: "settled"`,
again until the program's screen is up:

```
load     SCARFMAN.DSK                → disk image (DMK, 40 tracks, 1 side, …), in drive 0;
                                       the ROM jumped to 4300h after 0.434 s
run      until=settled               → (repeat; the title is up about 8 s after the reset)
```

A dual-boot disk (Eliminator, Rear Guard) shows its loader's menu first; hold
ENTER half a second (`key keys=["ENTER"] cps=1`) and run on to the title.

Labels live in `<program>.fugloy.json` beside the program (`SEADRG01.CMD` →
`SEADRG01.fugloy.json`), in the format of
[`docs/label-format.md`](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md). `load` reads it,
`label` and `unlabel` rewrite it at once, and `coverage mode: "export"`
merges this session's coverage and callers into it. Those are the only files
the server writes; it refuses to overwrite a sidecar that is broken, was
written for another program, is a link, or was edited by hand since it last
read it, and an export `path` that holds anything but a label file unless
`overwrite: true`. Sidecars beside the committed examples are gitignored
(`examples/**/*.fugloy.json`), so running the story prompts leaves the tree
clean. The disassembler reads the same file (a label's `note` is shown as
its comment from core 1.2.0, the next core release; `@fugloy/disasm` 1.1.0 on
npm reads the file but ignores `note`):

```sh
pnpm fugloy SEADRG01.CMD --labels SEADRG01.fugloy.json
```

## Resources and prompts

Resources give a client context without a tool call. Each is plain text,
reading one changes nothing (reading `fugloy://screen` does not move the
baseline `screen diff: true` compares with), and one that needs a program
reads as the tool's sentence (`No program loaded; call load first.`) until
there is one.

| URI | Content |
| --- | --- |
| `fugloy://status` | What `status` shows |
| `fugloy://screen` | The screen, as `screen` shows it |
| `fugloy://labels` | The label table, as `labels` shows it |
| `fugloy://program/manifest` | The manifest `load` returned |
| `fugloy://rom/{model}/symbols` | The Model III ROM's entry points and variables, its memory-mapped regions, and its ports, one line each (`0033h  routine  $VDCHAR  display the character in A at the cursor`), from `@fugloy/disasm`'s cited symbol tables (167 entries); only `fugloy://rom/3/symbols` exists until emu phase 6 |

Prompts are where the method lives; the tools stay plain. Each prompt's
text is a Markdown file in [`prompts/`](https://github.com/cschweda/fugloy/tree/main/packages/mcp/prompts), shipped in the package
and read when the server starts; the server sends its `## Prompt` section
with the arguments filled in. The same file is what you paste into Claude
Code by hand, so the two never drift apart.

| Prompt | Arguments | What it asks for |
| --- | --- | --- |
| `orient` | `path` | Load, run to the first screen, list the ROM routines it called (`callers` on the common ones, names from the symbols resource), `suggest` and `coverage`; a short report, no labels |
| `find-writer` | `path`, `range` (`"3C00-3FFF"`) | A write watch on the range (the `watch` arguments worked out), one input if needed, then `hits`, `callers`, and `disasm` on the writing routine, labelled with evidence |
| `label-pass` | `path`, `minCalls` (default 5) | Story 7: play a minute, then go down `suggest`'s list and label what can be justified, with notes; export the file |
| `explain` | `addr` (any address spelling or a label) | Break there, step through, watch what it writes, and answer in prose with the trace as evidence |

Prompt arguments are strings, as the protocol has them, and are checked like
tool arguments: a missing or unknown one, a range or address the tools would
not take, or a `minCalls` that is not a decimal count is refused with a
sentence. `path` is passed on as given; `load` resolves it. A prompt file
that is missing does not stop the server: the prompt is still listed, and
asking for it says which file is missing.

## Story 1: find the print routine

The prompt ([`prompts/story-01.md`](https://github.com/cschweda/fugloy/blob/main/packages/mcp/prompts/story-01.md)):

> Load examples/sea-dragon/seadrg01.cmd (a TRS-80 Model III game) and find the
> routine that writes text to the screen. Label it.

On 2026-10-18 a headless Claude Code session (`claude -p` with this server
from the working tree, the MCP tools as its only tools, run on a copy of
`seadrg01.cmd`) did it unaided, in 15 turns and 47 seconds:

```
load     seadrg01.cmd                → .CMD, 56 blocks (5200h–888Fh), boots to READY
watch    addr=0x3C00 len=1024        → watch #1 on 3C00h–3FFFh (write)
run      until=settled               → stopped: settled after 1.619 s (the intro animation)
screen, hits n=5                     → graphics only so far
run      seconds=5; screen           → the credits are on screen
hits     n=5                         → By pc: 4B69h ×64,701 (in the routine called at 4B5Eh),
                                       6141h ×835 (in the routine called at 6140h);
                                       the newest rows write "Begin" at 3F24h
suggest                              → 514Eh, 4A0Ah, 4AA5h, 4B1Fh, 4B5Eh, 6212h, …
disasm   addr=0x6130 n=20            → 6140 LD A,(HL) / LD (DE),A / LD A,(DE) / CP (HL) / … / DJNZ 6140H / RET
callers  addr=0x6140                 → 4A96h call 1, 4AA1h call 1, 4B8Bh call 39
disasm   addr=0x4A8C n=8             → LD HL,6651H / LD DE,3E8DH ; VIDEO+28Dh / LD B,25H / CALL 6140H
label    addr=0x6140 name=PRINT_TEXT size=15
         note="Copy B chars from (HL) to video RAM at DE; if readback differs
               (no lowercase mod) store with bit 5 cleared (uppercase)"
         → Labelled 6140h PRINT_TEXT (code, 15 bytes). Wrote …/seadrg01.fugloy.json.
```

Its answer named the routine at `6140h`, explained its arguments (HL the
string, DE the screen address, B the length) and its read-back for machines
without lowercase, and said how it knew: the credits were written by the
instruction at `6141h`. That is the routine the hand-annotated
[`seadrg01.hints`](https://github.com/cschweda/fugloy/blob/main/examples/sea-dragon/seadrg01.hints) calls
`PRINT_TEXT`. (One aside in its answer was wrong: it said `4B5Eh` fills the
screen with blanks; `4B5Eh` copies the title's off-screen buffer to the
screen, and `4B9Eh` is the one that clears it.)

The suite tells the same story twice: `test/story-1.test.js` replays it on a
synthetic program and byte-compares `test/golden/story-01.txt`, and
`test/story-7-rom.test.js` (below) does it on Sea Dragon.

## Story 7: label a whole program

The prompt, which the server also offers as its `label-pass` prompt
([`prompts/label-pass.md`](https://github.com/cschweda/fugloy/blob/main/packages/mcp/prompts/label-pass.md)), asks the
agent to play for a minute, take `suggest`'s list, investigate each routine,
label what it can justify with notes, and export the file. The scripted form
is `test/story-7-rom.test.js`, run where a ROM is configured:

```
load      seadrg01.cmd (a copy, so the sidecar lands beside the copy)
run       until=settled, twice      → the title
key       ENTER, then 1, then 0     → one player, Novice; SHIPS 4 on the status line
key/run   ×12                       → a minute of arrow keys and SPACE
suggest   minCalls=5                → 514Eh 2,063 calls (writes video RAM), …,
                                      4B5Eh 907 (writes video RAM, reads the keyboard),
                                      6140h 700 from 6 sites (writes video RAM), …
watch     the screen line holding "Hit <ENTER> to Begin"; run 1 s
hits      n=20                      → By pc: 6141h ×N (in the routine called at 6140h); every value printable
callers, disasm 6140
label     6140 PRINT, with a note   → the sidecar is written
coverage  mode=export               → the sidecar gains this session's coverage and callers
```

Then `@fugloy/disasm` reads the exported file and its listing of
`seadrg01.cmd` (relocated to `$497F`, where the game runs) shows `PRINT:`,
the note, and `CALL PRINT`.

Unaided, it is the release check (spec §10). On 2026-10-18, before 0.1.0, a
headless Claude Code session (`claude -p`, this server from the working
tree, the MCP tools its only tools) got the prompt with `minCalls` 5 for each
of the three public-domain games in `examples/` that run under the emulator,
each on a scratch copy:

| Game | Turns, time | Labelled | Checked |
| --- | --- | --- | --- |
| Sea Dragon (`seadrg01.cmd`) | 90, 5 min | 18 of 22 listed; left 4 whose object tables stayed empty, so their code never ran | 18 checked, all agree; 0 unchecked. Twelve are routines the hand-made [`seadrg01.hints`](https://github.com/cschweda/fugloy/blob/main/examples/sea-dragon/seadrg01.hints) names, with the same meaning (`PrintText` for `PRINT_TEXT`, `BlitSprite` for `DRAW_SHAPE`, `SurfaceAndAir` for `AIR_SUPPLY`, `UnpackLevelObjects` for `SETUP_OBJECTS`, …); three are title routines the hints describe in notes; three were read in the disassembly |
| Eliminator (`elimin8c.cmd`) | 119, 4 min | All 17 listed (`RenderFrame`, confirmed by a trace; `DrawObject`, 12,234 calls; `HitTestPlayerShip`; `SpawnWave`; …) | 4 checked against the disassembly, all agree; 13 unchecked. The agent marked three as weaker readings (`InitHumanoids`, `ShotMoveUp`, `ShotMoveDown`) |
| Rear Guard (`reargrd5.cmd`) | 93, 5 min | All 24 listed (`PlayTone`, `SoundUpdate`, `PrintToScreen`, `UpdateEnemies`, `SpawnEnemyBombs`, …), mostly from reading the code, as it said | 4 checked against the disassembly, all agree; 20 unchecked. The agent said it guessed which terrain layer scrolls faster |

Each session played, went down `suggest`'s list with `disasm` and `callers`
(and watches, breakpoints, or a trace where reading was not enough), wrote
a note with the evidence for every label, exported the file, and said which
names were guesses. Every label carries the agent's evidence note. What was checked: all 18 of Sea Dragon's (12 against the hint file's names, 3 against its notes, 3 in the disassembly), 4 of Eliminator's 17, and 4 of Rear Guard's 24 (in the disassembly); every one checked agreed, and the rest are unchecked. Rear Guard's
build writes the Model I's keyboard driver address (`03E3h`) into the
keyboard vector at `4016h`, so the Model III ROM's key wait hung at
"1 or 2 Players?"; the agent worked that out and poked `4016h` to the Model
III's driver (`3024h`) in the running machine. Two of the answers noted that
`coverage` counts only the loaded blocks: these games copy themselves
elsewhere before running, so the export reports a small share executed
(0.1% for Eliminator and Rear Guard) though the labels sit where the code
ran.

## Tests

`pnpm test` runs them with the rest of the monorepo. CI uses a synthetic
14K ROM and synthetic programs; `test/phase-a-rom.test.js` and
`test/story-7-rom.test.js` need the Model III ROM named in `fugloy.mcp.json`
and skip without it. Golden transcripts are committed only for sessions on
the synthetic ROM, since a real ROM's screen text would be in them: stories
1, 2, and 3 (`test/golden/story-0N.txt`, scripts in `test/stories.js`;
story 3 is coverage telling code, data, and never-seen bytes apart), each
also replayed twice by `test/golden.test.js` to show the output is the same
byte for byte. `test/guardrails.test.js` trips every limit of spec §7 and
checks the text, checks that a session calling every tool writes only the
sidecar and an explicit export path, and does the label round trip across
two real child processes of the bin. To rewrite the transcripts after a
deliberate change to a tool's output:
`FUGLOY_UPDATE_GOLDEN=1 pnpm vitest run packages/mcp/test/golden.test.js`,
then review the diff.

## Releasing

`./publish.sh check mcp` on `main` packs the package (pnpm turns the
`workspace:^` dependencies into `^` ranges: `@fugloy/emu` `^0.2.0`,
`@fugloy/disasm` and `@fugloy/z80` `^1.2.0`), checks the tarball, installs it
in a scratch project, and checks that `npx fugloy-mcp` answers `initialize`
and `tools/list` over a pipe. It needs those `@fugloy` versions on npm, so
`@fugloy/emu` is published first; with emu only staged, the check is a
rehearsal that stages nothing.

## Not yet

Only the Model III (the Model I and 4 wait for emu phase 6), disk images in
drive 0 only (unreleased, emu phase 5), and stdio only (Streamable HTTP is an open question, spec §12).
