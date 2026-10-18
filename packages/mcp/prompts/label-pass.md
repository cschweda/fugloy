# Story 7: label a whole program (the `label-pass` prompt)

MCP spec §13, story 7 (`docs/fugloy-mcp-spec.md`): the autonomous one, and
the release check for `@fugloy/mcp` (§10, agent acceptance on three games).
The server offers this text as its `label-pass` prompt (§6), with `{path}`
and `{minCalls}` (default 5) filled in; to paste it into Claude Code instead,
with the `trs80` server connected (see `packages/mcp/README.md`), replace
them yourself. Copy the program to a folder of your own first if you do not
want its `<program>.fugloy.json` sidecar written beside it.

## Prompt

> Load {path} (a TRS-80 Model III program). Run until the title screen
> settles, start a game (one player, if it asks), and play for about a
> minute with the keys the game asks for (for Sea Dragon, the arrow keys and
> SPACE to fire). Then call suggest with minCalls {minCalls} and label every
> subroutine it lists that you can justify a name for, investigating each
> with disasm, callers, watch and hits, or break and step. Give each label a
> note saying what it does and how you know. Stop when you can't justify a
> name. Finish with coverage mode "export", then tell me what you labelled
> and what you left alone.

## Example

With `path` `examples/sea-dragon/seadrg01.cmd` (copied first) and the
default `minCalls`, the session plays Sea Dragon and labels routines such as
`6140h`, which prints text.

## Then

Review `seadrg01.fugloy.json`: rename, delete, or keep each label (they are
`source: "user"`). Fugløy's disassembler reads it with
`fugloy seadrg01.cmd --labels seadrg01.fugloy.json` (for Sea Dragon, add
`--hints examples/sea-dragon/seadrg01.hints`, or at least its relocate line,
so the game is listed at `$497F`, where it runs).

`packages/mcp/test/story-7-rom.test.js` runs this story in scripted form:
the minute of play, `suggest`, a watch that confirms which routine writes
text, `label`, `coverage export`, and the disassembler reading the file.
