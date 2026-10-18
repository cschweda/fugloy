# @fugloy/mcp

A stdio MCP server that puts a running TRS-80 (`@fugloy/emu`) in front of
Claude Code or any MCP client: load a program, run it, inspect memory and
registers, inject input, read the screen, and record labels and coverage the
Fugløy disassembler consumes. **In progress (emu phase 4):** the phase A
tools are in (`load`, `reset`, `status`, `run`, `step`, `key`, `regs`, `peek`,
`poke`, `screen`), and with them an agent can load Sea Dragon and reach its
title screen; so are the phase B tools (`break`, `unbreak`, `watch`,
`unwatch`, `hits`, `trace`, `callers`, `disasm`), with which it can find a
program's print routine (spec §13, story 1; `test/golden/story-01.txt` is
that session on a synthetic program); and so are the phase C tools
(`label`, `unlabel`, `labels`, `coverage`, `suggest`), which keep labels in
the sidecar `<program>.fugloy.json` beside the program and export the label
and coverage file the disassembler reads (`fugloy <program> --labels
<file>`). The plan: `docs/superpowers/plans/2026-10-18-emu-phase4-mcp.md`.

Run it from the monorepo with `node packages/mcp/bin/fugloy-mcp.js`. It reads
`fugloy.mcp.json` from `$FUGLOY_CONFIG`, else the working directory, else
`~/.config/fugloy/` (spec §3; the repository's `fugloy.mcp.example.json`
shows the format); paths in it are relative to the file. stdout carries
JSON-RPC only: console output and the emulator's log go to stderr.

- Spec: [`docs/fugloy-mcp-spec.md`](../../docs/fugloy-mcp-spec.md) (phases A–F in §11)
- Companion core spec: [`docs/fugloy-emu-spec.md`](../../docs/fugloy-emu-spec.md)
- Label and coverage file it reads and writes: [`docs/label-format.md`](../../docs/label-format.md)
- Depends on `@fugloy/emu`, `@fugloy/disasm`, and `@fugloy/z80` as
  `workspace:*`; `pnpm pack` rewrites them to the local versions.
