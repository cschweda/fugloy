# The `find-writer` prompt: who writes this memory?

MCP spec §6. The server offers this text as its `find-writer` prompt, with
`{path}` and `{range}` filled in, and `{addr}` and `{len}` worked out from
`{range}` for `watch`; to paste it into Claude Code instead, with the
`trs80` server connected (see `packages/mcp/README.md`), replace them
yourself. Story 1 (`story-01.md`) is this prompt with video RAM for the
range.

## Prompt

> Load {path} (a TRS-80 Model III program) and find the routine that writes
> {range}. Set a write watch on it with watch addr {addr} len {len}, then run
> until the screen settles (call run with until "settled" again if the first
> stop is an animation still drawing). If hits shows no writes yet, give the
> program one input it asks for on its screen (ENTER, if it asks for
> nothing) with key, run for a second, and look again. From hits (its "By
> pc:" line names the routine each writing instruction is in), pick the
> writing instruction, then use callers and disasm on the routine that holds
> it to say what it writes, where its arguments come from, and who calls it.
> Label the routine with a note saying what it does and how you know, and
> report the routine, the instruction that writes, and its callers.

## Example

With `path` `examples/sea-dragon/seadrg01.cmd` and `range` `3C00-3FFF`
(video RAM), the writer of the title text is the routine at `6140h`.
