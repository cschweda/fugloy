# @fugloy/cli

`fugloy`, the command-line disassembler of [Fugløy](https://github.com/cschweda/fugloy), for
TRS-80 Model I/III programs: `.CMD` load modules, tokenized Level II BASIC, and raw binaries
(`--base <hex>`), with the format detected from content. Node 22 or later.

```sh
npm i -g @fugloy/cli                      # installs the fugloy command; or run it with npx:
npx @fugloy/cli GAME.CMD                  # annotated listing
npx @fugloy/cli GAME.CMD --format zmac    # source that zmac reassembles byte for byte
npx @fugloy/cli GAME.CMD --hints game.hints --labels game.labels.json
npx @fugloy/cli --help
```

It follows the code from the entry point by recursive descent, names ROM, hardware, and DOS
addresses from cited symbol tables, and takes a hint file of your decisions and, from the
emulator, a label-and-coverage file
([format](https://github.com/cschweda/fugloy/blob/main/docs/label-format.md)).

`fugloy asm game.z` assembles Z80 source into `game.cmd` (see `fugloy asm --help`).

`fugloy port game.cmd --model 3` ports a `.CMD` program to JavaScript (Part 2 of Fugløy, milestone
M1, in the repository only): it writes `game.port.js`, one function per routine and one statement
per instruction, which imports `@fugloy/runtime/ops` and runs on `@fugloy/runtime`, and
`game.port.txt`, its report (the entry, each routine and its blocks, the data regions, the ROM
routines `@fugloy/runtime` stands in for and where they are called (on the Model III, `$DELAY` at
`$0060`; a CALL to it runs the runtime's own code, M2), and the places that refuse if they run, with a line saying the port was not compared with the emulator, so
self-modifying code is not detected). `--model 1` ports for the Model I; `--hints <file>` applies a hint
file, whose names name the routines and whose notes become their comments; `-o <dir>` writes the two
files there. A program it cannot follow (a `JP (HL)`, bytes that are no instruction) is refused,
with a sentence naming the address, exit code 1, and nothing written.

MIT licensed; the full documentation is in the
[repository README](https://github.com/cschweda/fugloy/blob/main/README.md).
