# Rear Guard

*Rear Guard* (1982) is an arcade game for the TRS-80 Model I and Model III by
Wayne Westmoreland and Terry Gilman, sold by Adventure International. In 1995
Westmoreland released it, with the rest of the TRS-80 games he wrote with
Gilman, into the public domain: "I hereby release them into the public domain,
do with them as you please"
([trs-80.org](http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html)).
Its title screen still reads "(C) Copyright 1982", as the original did.

## The files

Seven `.CMD` builds, named as they were found in the TRS-80 software archives:

| File | How it loads |
| --- | --- |
| `reargrd1.cmd`, `reargrd3.cmd`, `reargrd7.cmd` | One program, `$8000`–`$BF86`, entry `$A000`, saving high scores through TRSDOS. Builds 1 and 3 open with a cracker's tag record (`THE MARK OF "ZORRO"`) that TRSDOS 2.3 and NEWDOS/80 skip; Fugløy skips it too. |
| `reargrd2.cmd` | A second build at `$6F00`–`$B6FF`, entry `$77A5`, saving high scores through TRSDOS. |
| `reargrd4.cmd` | Build 2 without the high-score file; the closest of the seven to the original Adventure International disk. |
| `reargrd5.cmd`, `reargrd6.cmd` | Builds that copy the game into place at startup (5 down to `$4000`) and make no DOS calls. |

A note filed with these builds in the archives (Ira Goldklang's TRS-80 Revived
Site) lists builds 1 to 4 and says copies that misbehaved under TRSDOS and
NEWDOS/80 on a Model I, or NEWDOS/80 on a Model III, were dropped. Builds 2, 4,
5, and 6 also set the Model III's display mode through port `$EC` at startup.

## Try it

```sh
pnpm build
pnpm fugloy examples/rear-guard/reargrd1.cmd   # the header notes the skipped 03 record
pnpm fugloy examples/rear-guard/reargrd5.cmd   # proposes the relocate lines for its copy loop
```
