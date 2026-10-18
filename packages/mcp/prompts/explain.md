# The `explain` prompt: what does this code do?

MCP spec §6. The server offers this text as its `explain` prompt, with
`{addr}` filled in (as `6140h`, whatever spelling was given); to paste it
into Claude Code instead, with the `trs80` server connected (see
`packages/mcp/README.md`), replace it yourself. It needs a program loaded
and running; it does not load one.

## Prompt

> Explain what the code at {addr} does in the program that is loaded. Read
> labels and disasm from {addr} first. Set a breakpoint at {addr} with once
> true and run until it stops (use key to give the program the input it is
> waiting for if it does not get there on its own); if it never stops there,
> say so, and say what callers shows about how it is reached. When it stops,
> show regs, then step through it until it returns, watching memory it
> writes with watch and hits if it writes any. Answer in prose: what the
> routine does, what it takes in its registers and what it gives back, what
> memory it reads and writes, and who calls it, quoting the trace lines and
> register values that show each point. Label it only if I ask.

## Example

With a game loaded and `addr` `6140`, the answer says the routine copies B
characters from HL to the screen at DE, and quotes the steps that show it.
