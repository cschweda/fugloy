# The `orient` prompt: the standard opening move

MCP spec §6. The server offers this text as its `orient` prompt, with
`{path}` filled in; to paste it into Claude Code instead, with the `trs80`
server connected (see `packages/mcp/README.md`), replace it yourself. It
loads a program, runs it to its first screen, and reports what the program
asked of the ROM and which of its own routines to look at first. It labels
nothing.

## Prompt

> Load {path} (a TRS-80 Model III program) and report the manifest: format,
> blocks, entry point, and any labels its sidecar file brought. Run until the
> screen settles (call run with until "settled" again if the first stop is
> an animation still drawing) and show the screen. Read the
> fugloy://rom/3/symbols resource, then call callers on the ROM entry points
> a program commonly uses (0033h display a character, 0049h wait for a key,
> 002Bh scan the keyboard, 01C9h clear the screen, 0060h delay, 0040h read a
> line) and on any other ROM address you see the program call in disasm of
> its entry point. Count only the calls made from the program's own blocks
> (the address ranges the manifest lists): callers also shows calls the ROM
> makes to itself, and those are not the program's. List each ROM routine
> the program called, with its name from the resource, how many times, and
> from which of its own addresses. Then call suggest and coverage
> mode "summary". Finish with a short report: what the program is, as far as
> the screen shows; the ROM routines it uses; the three to five routines of
> its own most worth naming first, from suggest's list, with why; and the
> next step you would take. Do not label anything yet.

## Example

With `path` `examples/sea-dragon/seadrg01.cmd`, the report shows the title
screen and points at the routine at `6140h` (it writes video RAM, called
from several sites) as one to name first.
