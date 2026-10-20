---
title: One invader
idea: a second thing drawn by a routine like the first, and redrawn every turn
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
The first invader arrives: two cells on row 2, near the top, straight above where the base starts. It does not move, and a shot passes behind it; it is here to be drawn, the way everything else in the game is drawn, by a routine, from a few bytes, at a place kept in memory. The next chapters give it company, then make the company march.

## What changed

Chapter 4's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 5.
- **+** `DRAWINV`, a new routine with its comment, below `FIRE`: it copies two bytes to the invader's place on row 2.
- **~** The game loop's comment: its last line now ends *the base, the shot, the invader*.
- **+** Two lines in the loop, after `CALL FIRE`: `LD HL,INVADER` and `CALL DRAWINV`, which draw the invader every turn.
- **+** `INVADER`, after `BLANK`: the invader's two cells, on two lines, the label on the first.
- **+** `INVX`, after `SHOT`: the invader's column.

Nothing is taken out.

## The invader

The invader is two graphics cells, `9EH` and `0ADH`:

```z80
INVADER:
        DB      9EH,0ADH        ; an invader: two cells, a head, arms and legs
```

As with the base, the low six bits of a graphics byte light the cell's blocks, two across and three down: bit 0 top left, 1 top right, 2 and 3 the middle, 4 and 5 the bottom (as Fugløy's screen draws them, from the TRS-80's character generator). `9EH` lights bits 1 to 4, and `0ADH` bits 0, 2, 3 and 5. Side by side, the top row lights the two middle blocks, a head; the middle row all four, arms; and the bottom row the two outer ones, legs. The label `INVADER:` is too long for the space before `DB`, so it stands on a line of its own, as `DRAWBASE:` does above its code: either way a label names the address of the next byte the program assembles.

## Its place, and DRAWINV

The invader's column is a byte, as the base's is:

```z80
INVX:   DB      30              ; the invader's column, 0 to 62
```

`DRAWINV` is `DRAWBASE` for a thing two cells wide on row 2. Row 2 starts at `3C80H`, two rows of 64 in, so the invader's left cell is `3C80H` plus `INVX`; the column is at most 62, and `80H` plus 62 is `0BEH`, one byte, so the high byte is always `3CH`:

```z80
DRAWINV:
        PUSH    BC              ; save BC, which LDIR counts down
        LD      A,(INVX)        ; the invader's column ...
        ADD     A,80H           ; ... plus 3C80H, row 2: the invader's left cell
        LD      E,A
        LD      D,3CH
        LD      BC,2            ; two bytes
        LDIR                    ; from (HL) to (DE), one byte at a time
        POP     BC              ; BC as the caller left it
        RET
```

As with `DRAWBASE`, HL says what to draw, so a later chapter can erase the invader with two of `BLANK`'s spaces before moving it.

## Drawn every turn

The base is drawn when it moves, and the shot when it moves. The invader does not move, yet the loop draws it every turn:

```z80
        LD      HL,INVADER      ; the invader, drawn every turn: a shot passing
        CALL    DRAWINV         ; through it erases a cell, and this mends it
```

That is for the shot. With the base where it starts, a shot rises in column 31, the invader's right cell. On the turn it reaches row 2, `MOVESHOT` draws the shot over the invader, and then `DRAWINV` draws the invader over the shot; on the next turn `MOVESHOT` erases the shot where it was, a space in the invader's right cell, and draws it on row 1, and `DRAWINV` mends the invader again. Between the two, a few hundred T-states, too short to see. So the shot seems to pass behind the invader. Making it hit is chapter 9's work.

Drawing it every turn costs 136 T-states a turn: `LD HL,INVADER` 10, `CALL` 17, and `DRAWINV` 109, of which the `LDIR` takes 37, 21 for the first byte, which it repeats after, and 16 for the last. A turn with no key down is now 133,470 T-states, still about 66 ms at the Model III's 2.03 MHz.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged, a little slower at the Model I's 1.77 MHz.

## Try it

Draw the invader once instead of every turn: move the two lines `LD HL,INVADER` and `CALL DRAWINV` from the loop to just above `LOOP:`, after `CALL DRAWBASE`, and press Run ▶. The invader is there as before. Click the screen and fire without moving the base: the shot passes the invader's right cell, and takes it away, a space where its right half was.

Then put the lines back in the loop, and change `INVX`'s `DB 30` to `DB 10`. The invader stands over column 10; move the base under it with the left arrow and fire.
