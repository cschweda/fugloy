# Eliminator

*Eliminator* (1981) is a *Defender*-style arcade game for the TRS-80 Model I
and Model III by Wayne Westmoreland and Terry Gilman, sold by Adventure
International. In 1995 Westmoreland released it, with the rest of the TRS-80
games he wrote with Gilman, into the public domain: "I hereby release them into
the public domain, do with them as you please"
([trs-80.org](http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html),
which lists *Eliminator* among them). Its title screen still reads
"(C) Copyright 1981 Adventure International", the publisher's notice on the
original.

## The files

Seven `.CMD` builds, named as they were found in the TRS-80 software archives:

| File | How it loads |
| --- | --- |
| `elimin8d.cmd`, `elimin8f.cmd`, `elimin8g.cmd` | One program at `$83EC`–`$B994`, entry `$8B19`, saving high scores through TRSDOS; pass 1 alone decodes 72% of it. |
| `elimin8h.cmd` | The same program with one byte changed: the ship count on its title screen reads 8, not 4. |
| `elimin8c.cmd`, `elimin8e.cmd` | The game assembled to run at `$4900`, copied there at startup and entered at `$50D4`; no DOS calls. |
| `elimin8a.cmd` | The `$4900` build again. Before copying it in, it rebuilds a cassette Level II machine's system area from tables in the Model I ROM, so it runs on a Model I only: at those addresses the Model III ROM holds different bytes. |

Left out: a build whose title screen credits other people and claims a 1983
copyright for "Bonita Systems Software", a damaged copy, two BASIC patch
programs by unknown authors, saved high-score files, and the two disk images,
whose boot loader is Adventure International's.

## Try it

```sh
pnpm build
pnpm fugloy examples/eliminator/elimin8d.cmd   # loads where it runs
pnpm fugloy examples/eliminator/elimin8c.cmd   # proposes the relocate lines for its copy loop
```
