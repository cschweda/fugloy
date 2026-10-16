# Armored Patrol

*Armored Patrol* is a tank game for the TRS-80 by Wayne Westmoreland and Terry
Gilman; its first form was called *Tank Zone*. In 1995 Westmoreland released
it, with the rest of the TRS-80 games he wrote with Gilman, into the public
domain: "I hereby release them into the public domain, do with them as you
please"
([trs-80.org](http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html)).

## The file

| File | How it loads |
| --- | --- |
| `ARMOUR.III` | The game for a Model III at `$8000`–`$B8FF`. A later patch at `$B801`–`$B80F` overwrites part of it and becomes the entry, `$B801`. It is a plain `.CMD` load module under another extension, which is why Fugløy detects formats from content, not names. |

Left out: `GO.CMD`, a 190-byte LS-DOS launcher by someone else that loads this
file on a Model 4.

## Try it

```sh
pnpm build
pnpm fugloy examples/armored-patrol/ARMOUR.III
```
