---
title: Move the base with the arrow keys
idea: reading the keyboard, RET Z, and keeping the base inside the screen
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Hold the left or right arrow and the base slides along the bottom row, a cell a turn; at the screen's edges it stops. The game loop's turn has its first piece of work: each turn it looks at the arrows, and if one is down, moves the base.

## What changed

Chapter 2's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 3.
- **+** `MOVEBASE`, a new routine with its comment, below `DRAWBASE`: it reads the arrows and moves the base.
- **~** The game loop's comment: its last line now ends *this one moves the base* in place of *this one only waits*.
- **+** `CALL MOVEBASE` in the loop, after `CALL WAIT`.
- **+** `BLANK`, three spaces, after `BASE`: what `MOVEBASE` draws to erase the base.

Nothing is taken out.

## The keyboard is memory too

The keyboard is read as memory, from `3800H`: its keys are wired in rows, and each row is read at its own address, `3801H` to `3840H`. A key that is down reads as a 1 bit in its row's byte, a key that is up as a 0. The row read at `3840H` holds ENTER, CLEAR, BREAK, the four arrows and the space bar, and the left and right arrows are its bits 5 and 6: that order within the row is the one Fugløy's emulator uses, from the ROM's own keyboard routine, not a page of the manuals.

```z80
MOVEBASE:
        LD      A,(3840H)       ; the arrows' row: bit 5 left, 6 right
        AND     60H             ; keep those two bits (0110 0000)
        RET     Z               ; neither is down: nothing to do
        LD      C,A             ; keep the keys in C, so A is free
```

`AND 60H` keeps bits 5 and 6 and clears the rest, and sets the zero flag when what is left is 0, when neither arrow is down. `RET Z` returns only when the zero flag is set; otherwise the routine runs on. So on most turns, with no key down, `MOVEBASE` is three instructions and back. If you did lesson 3, this is its read of the arrows.

## Erase, move, draw

Nothing on the screen moves by itself. To move the base, `MOVEBASE` draws three spaces where it is, changes `BASEX`, and draws the base again at the new column. Chapter 2's `DRAWBASE` does both draws: HL says what to draw, `BLANK` or `BASE`.

```z80
BLANK:  DB      '   '           ; three spaces, to erase it
```

Between the two draws the column changes by one:

```z80
        LD      A,(BASEX)       ; the base's column, from memory
        BIT     5,C             ; left?
        JR      Z,NOTLT
        CP      0               ; column 0, the left edge: stay
        JR      Z,NOTLT
        DEC     A
NOTLT:
        BIT     6,C             ; right?
        JR      Z,NOTRT
        CP      61              ; column 61, the right edge for three cells: stay
        JR      Z,NOTRT
        INC     A
NOTRT:
        LD      (BASEX),A       ; the new column, back to memory
```

`BIT 5,C` sets the zero flag when bit 5 of C is 0, so `JR Z,NOTLT` skips the move left when the left arrow is up. `CP 0` compares A with 0: it sets the flags as A minus 0 would, zero when A is 0, and leaves A as it was. At column 0 the base is at the left edge and stays; at 61 its right wing is in column 63, the last, and it stays. That is the whole of *kept inside the screen*.

## Why DRAWBASE keeps BC

`MOVEBASE` keeps the keys in C, and calls `DRAWBASE` to erase the base before it tests them. `DRAWBASE`'s `LDIR` counts BC down to 0, so without its `PUSH BC` and `POP BC`, C would be 0 when `MOVEBASE` came to `BIT 5,C`, and the base would never move. The routine leaves BC as its caller had it.

## The speed

`MOVEBASE` runs once a turn, after `WAIT`, so a held arrow moves the base one cell a turn. With no key down it adds 48 T-states to the turn, `CALL` 17, `LD A,(3840H)` 13, `AND` 7 and `RET Z` 11, for 133,233 in all; Fugløy runs the Model III at 2.03 MHz, so that is about 66 ms, and the base crosses the screen at about 15 cells a second. Moving costs a few hundred T-states more, too few to see.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs its Z80 at 1.77 MHz, so a turn lasts about 75 ms there and the base moves about 13 cells a second.

## Try it

Change `CP 61` to `CP 40` and press Run ▶: the right edge is now column 40, and the base stops there, short of the edge, though nothing on the screen marks the spot.

Then put it back, and take out the two lines that erase the base, `LD HL,BLANK` and the `CALL DRAWBASE` after it, and run it again. The base still moves, but each move leaves one wing behind, and a held arrow draws a trail of them along the row.
