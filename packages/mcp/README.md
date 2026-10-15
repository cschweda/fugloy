# @fugloy/mcp

A stdio MCP server that puts a running TRS-80 (`@fugloy/emu`) in front of
Claude Code or any MCP client: load a program, run it, inspect memory and
registers, inject input, read the screen, and record labels and coverage the
Fugløy disassembler consumes. **Stub:** `src/index.js` is empty; phase A
starts once `@fugloy/emu` boots to `READY` in Node.

- Spec: [`docs/fugloy-mcp-spec.md`](../../docs/fugloy-mcp-spec.md) (phases A–F in §11)
- Companion core spec: [`docs/fugloy-emu-spec.md`](../../docs/fugloy-emu-spec.md)
- Label and coverage file it reads and writes: [`docs/label-format.md`](../../docs/label-format.md)
- Depends on `@fugloy/emu` by semver range (`^0.1.0`); inside the monorepo the
  range resolves to the local package.
