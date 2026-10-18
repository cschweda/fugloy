# Story 1: find the print routine

MCP spec §13, story 1 (`docs/fugloy-mcp-spec.md`). Paste the prompt into
Claude Code with the `trs80` server connected (see `packages/mcp/README.md`),
replacing the path with your program's. Copy the program to a folder of your
own first if you do not want its `<program>.fugloy.json` sidecar written
beside it.

## Prompt

> Load examples/sea-dragon/seadrg01.cmd (a TRS-80 Model III game) and find the
> routine that writes text to the screen. Label it.

## What a good session does

`load`; `watch` video RAM (`3C00`, `len` 1024); `run until: "settled"`, once
or twice, until text is on the `screen`; `hits` (its `By pc:` line names the
routine each writing instruction is in); `suggest`, `callers`, and `disasm`
on that routine; `label` with a `note` saying how it is known. On Sea Dragon
the answer is the routine at `6140h`: it copies B characters from HL to the
screen at DE, reading each back and clearing bit 5 when the machine has no
lowercase. A headless Claude Code run found it unaided on 2026-10-18.
