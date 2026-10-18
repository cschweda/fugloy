# Sea Dragon

*Sea Dragon* (1982) is a submarine game for the TRS-80 Model I and Model III
by Wayne Westmoreland and Terry Gilman, sold by Adventure International. In
1995 Westmoreland released it, with the rest of the TRS-80 games he wrote with
Gilman, into the public domain: "I hereby release them into the public domain,
do with them as you please"
([trs-80.org](http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html)).

That is why it ships with this repository, beside three more games from the
same release (Rear Guard, Eliminator, and Armored Patrol, in `examples/`), so
anyone can try Fugløy on real games. For everything else, bring your own (see
"Getting ROMs and programs" in the [main README](../../README.md)). The title screen still
reads "(C) Copyright 1982", as the original did.

## The files

Ten `.CMD` builds of the game, named as they were found in the TRS-80
software archives:

| File | How it loads |
| --- | --- |
| `seadrg01.cmd` | The game at `$5200`, then a stub at `$8881` that copies it down to `$497F` and jumps there |
| `seadrg02.cmd`–`seadrg04.cmd` | The same game at `$8000`, with the stub at `$B681` |
| `seadrg06.cmd`–`seadrg11.cmd` | Builds that load the game where it runs |
| `seadrg01.hints` | The two hint lines Fugløy proposes for `seadrg01.cmd`, under the skeleton `--write-hints` writes, then names and block comments for the game's main routines and data: an annotated listing |
| `seadrg01.labels.json` | The label and coverage file `@fugloy/emu` wrote while running `seadrg01.cmd` from `$497F` through the title screen and ENTER: which bytes ran, which were only read, and which subroutines were called and how often (`packages/emu/scripts/sea-dragon-labels.mjs` rewrites it, given the Model III ROM) |

A build numbered 05 also exists. It was rebuilt with Zeta Microcomputer
Software's OFFSET utility, and its loader carries Zeta's own copyright, which
the 1995 release does not cover, so it is not included here.

## Try it

```sh
pnpm build
pnpm fugloy examples/sea-dragon/seadrg01.cmd            # pass 1 finds only the 15-byte stub, and proposes the move
pnpm fugloy examples/sea-dragon/seadrg01.cmd --hints examples/sea-dragon/seadrg01.hints
                                                         # the game at $497F, 45% of its bytes decoded as code, annotated
pnpm fugloy examples/sea-dragon/seadrg01.cmd --hints examples/sea-dragon/seadrg01.hints --labels examples/sea-dragon/seadrg01.labels.json
                                                         # the same, with what the emulator saw run as roots and comments
pnpm fugloy examples/sea-dragon/seadrg06.cmd --color    # a build that loads in place, in color on a terminal
```

The test suite runs on these files too, so its real-program tests cover a
real game on every machine and in CI.
