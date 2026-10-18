# Story prompts

The prompts moved into the MCP package, so that the server's MCP prompts
(`docs/fugloy-mcp-spec.md` §6) and the texts you paste into Claude Code are
one copy, shipped on npm with `@fugloy/mcp`. They are in
[`packages/mcp/prompts/`](../packages/mcp/prompts/):

- [`story-01.md`](../packages/mcp/prompts/story-01.md): story 1, find the print routine
- [`label-pass.md`](../packages/mcp/prompts/label-pass.md): story 7, label a whole program (the `label-pass` prompt)
- [`orient.md`](../packages/mcp/prompts/orient.md): the `orient` prompt, the standard opening move
- [`find-writer.md`](../packages/mcp/prompts/find-writer.md): the `find-writer` prompt, who writes a range of memory
- [`explain.md`](../packages/mcp/prompts/explain.md): the `explain` prompt, what the code at an address does

The server reads each file's `## Prompt` section at startup and fills in its
`{placeholders}` from the prompt's arguments.
