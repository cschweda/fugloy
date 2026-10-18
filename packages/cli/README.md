# @fugloy/cli

`fugloy`, the command-line disassembler of [Fugløy](https://github.com/cschweda/fugloy), for
TRS-80 Model I/III programs: `.CMD` load modules, tokenized and ASCII Level II BASIC, and raw
binaries, with the format detected from content.

```sh
npx @fugloy/cli GAME.CMD                  # annotated listing
npx @fugloy/cli GAME.CMD --format zmac    # source that zmac reassembles byte for byte
npx @fugloy/cli GAME.CMD --hints game.hints --labels game.labels.json
npx @fugloy/cli --help
```

It follows the code from the entry point by recursive descent, names ROM, hardware, and DOS
addresses from cited symbol tables, and takes a hint file of your decisions and, from the
emulator, a label-and-coverage file. MIT licensed; the full documentation is in the repository.
