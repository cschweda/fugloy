---
title: A row of invaders
idea: a table of screen addresses, walked with IX and counted with DJNZ
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
One invader becomes eight, side by side on row 2, four cells apart. Chapter 5 kept the invader's place in a byte, `INVX`; eight invaders would need eight such bytes and eight routines to draw them. Instead their places go in a table, one entry an invader, and one routine walks down the table and draws each. That is the first chapter that takes a line out: `INVX` goes, and `DRAWINV` is reworked into `DRAWROW`.

## What changed

Chapter 5's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 6.
- **~** `DRAWINV` becomes `DRAWROW`. Its comment and its first lines, lines 97 to 106, are changed, and lines 107 to 116, the rest of its loop, are new; its last two lines, `POP BC` and `RET`, stay as they were.
- **~** The game loop's comment: its last line now ends *the base, the shot, the invaders*.
- **~** The two lines in the loop that drew the invader, lines 137 and 138, now draw the row: `LD DE,INVADER` and `CALL DRAWROW`.
- **+** `INVS`, after `INVADER`, lines 146 to 148: a comment, and the table of the invaders' places.
- **−** `INVX`, the invader's column, is taken out: the table holds the places now. Below the program, under *lines taken out*, it shows struck through.

## A table of places

Each invader's place is its screen address, a word, as the shot's is. Row 2 starts at `3C80H`, so an invader in column 14 is at `3C80H+14`, and the assembler works out the sum:

```z80
INVS:   DW      3C80H+14,3C80H+18,3C80H+22,3C80H+26
        DW      3C80H+30,3C80H+34,3C80H+38,3C80H+42
```

`DW` with several values lays them down one after another, two bytes each, low byte first: sixteen bytes, eight invaders. The fifth, `3C80H+30`, is where chapter 5's invader stood. In JavaScript the table is an array, `const invs = [0x3C8E, 0x3C92, …]`, and drawing the row is a loop over it.

## IX walks the table

`DRAWROW` points IX at the table and reads each word through it:

```z80
        LD      IX,INVS         ; IX points at the table's first word
        LD      B,8             ; eight invaders, counted down by DJNZ
DRAWONE:
        LD      L,(IX+0)        ; this invader's screen address: the low byte
        LD      H,(IX+1)        ; first, then the high, as a DW stores them
```

IX is a 16-bit register like HL, made for this. `(IX+1)` is the byte one after the one IX points at: the number after the plus is an offset, a signed byte from -128 to 127, fixed when the program is assembled. So `(IX+0)` and `(IX+1)` are the two bytes of the current entry, and after drawing it, two `INC IX` move IX to the next. IX costs time: each IX instruction carries an extra prefix byte, and `LD L,(IX+0)` takes 19 T-states where `LD L,(HL)` takes 7. Here the two loads are 38 of the 117 T-states each invader takes, in a turn of over 134,000.

HL now holds where to draw, so the shape moves to DE: the loop loads `LD DE,INVADER`, where chapter 5 loaded HL. Each invader is two bytes copied from (DE) to (HL), with `INC HL` and `INC DE` between them, and `DEC DE` after puts DE back at the shape's start for the next one. `LDIR` could copy them, but it counts in BC, and B is counting invaders.

## DJNZ counts the invaders

`DJNZ DRAWONE` is *decrement B and jump if not zero*: B goes down by 1, and the jump back is taken unless B has reached 0. It is a counted loop in one instruction, `do { … } while (--b !== 0)`, and it sets no flags. B is the only register it counts with, so `DRAWROW` saves BC with `PUSH BC` and puts it back with `POP BC`, as `DRAWBASE` does.

## The row, every turn

The loop draws the whole row every turn, as chapter 5 drew its one invader, so a shot that passes through an invader's cell is mended over at once:

```z80
        LD      DE,INVADER      ; the row, drawn every turn: a shot passing
        CALL    DRAWROW         ; through an invader erases a cell, and this mends it
```

Drawing eight invaders costs 1,010 T-states a turn: `LD DE,INVADER` 10, `CALL` 17, and 983 in `DRAWROW`, of which each invader takes 117, 5 fewer for the last, where `DJNZ` does not jump. A turn with no key down is now 134,344 T-states. Fugløy runs the Model III at 2.03 MHz, so that is still about 66 ms.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz, so a turn there takes about 76 ms.

## Try it

Fire without moving the base: the shot rises in column 31, through the fifth invader's right cell, and goes behind it, as in chapter 5.

Then change the last entry of `INVS`, `3C80H+42`, to `3C40H+42` and press Run ▶. Row 1 starts at `3C40H`, so the eighth invader now stands a row higher than the others. Nothing else changed: `DRAWROW` draws whatever places the table holds. Change `LD B,8` to `LD B,7` and the eighth is not drawn at all.
