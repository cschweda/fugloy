---
title: Draw the base on the bottom row
idea: a routine with CALL and RET, and the base's column in a byte of memory
models: 3, 1
cite: m3-trm 14 the Model III's screen is video memory at 3C00H, 1,024 bytes
cite: m1-trh 12 the Model I's screen is video memory at 3C00H, 16 lines of 64 characters
---
The player's base appears on the bottom row, three cells wide, in the middle of the screen. It does not move yet: this chapter draws it once, before the game loop starts, with a routine that the next chapters will call every time the base moves.

## What changed

Chapter 1's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 2.
- **+** `DRAWBASE`, a new routine with its comment, below `WAIT`: it copies three bytes to the base's place on row 15.
- **+** Two lines at the end of the clear, before `LOOP`: `LD HL,BASE` and `CALL DRAWBASE`, which draw the base once.
- **+** The game's data, below the loop: `BASE`, the base's three cells, and `BASEX`, its column, with a comment.

Nothing is taken out, and `WAIT`, the clear and the loop are as they were.

## The base

The screen is memory, 16 rows of 64 cells from `3C00H`, one byte a cell, so the bottom row, row 15, starts 15 times 64 cells in, at `3FC0H`. The base is three cells there, `0BCH`, `0BFH`, `0BCH`:

```z80
BASE:   DB      0BCH,0BFH,0BCH  ; the base: a wing, a block, a wing
```

Bytes `80H` to `0BFH` are graphics: each cell is two blocks across and three down, and the low six bits light them, bit 0 top left, 1 top right, 2 and 3 the middle, 4 and 5 the bottom (as Fugløy's screen draws them, from the TRS-80's character generator). `0BFH` lights all six; `0BCH`, bits 2 to 5, lights the lower two thirds, a wing. If you did lesson 5, this is its ship.

## Its place in memory

The game has to know where the base is, so that later chapters can move it, fire from it and see what hits it. That is one byte of memory, given a name and a first value by `DB`:

```z80
BASEX:  DB      30              ; the base's column, 0 to 61
```

Column 30 of 64 puts the base in the middle. It can go no further right than 61, since it is three cells wide and the row ends at column 63. `LD A,(BASEX)` reads the byte into A; of the 8-bit registers, only A can be loaded from a named address like that.

`BASE` and `BASEX` sit below the game loop. The processor runs a program's bytes in order, so data must be where it never arrives: the loop's `JR LOOP` jumps back every time, and nothing after it is ever run as code.

## DRAWBASE, a routine

`DRAWBASE` works out the base's left cell from `BASEX`, and copies the three bytes HL points at there:

```z80
DRAWBASE:
        PUSH    BC              ; save BC, which LDIR counts down
        LD      A,(BASEX)       ; the base's column ...
        ADD     A,0C0H          ; ... plus 3FC0H, row 15: the base's left cell
        LD      E,A
        LD      D,3FH
        LD      BC,3            ; three bytes
        LDIR                    ; from (HL) to (DE), one byte at a time
        POP     BC              ; BC as the caller left it
        RET
```

The address is `3FC0H` plus the column. The column is at most 61, and `0C0H` plus 61 is `0FDH`, still one byte, so the high byte is always `3FH` and only the low byte needs the sum. `LDIR` copies the byte at HL to the address in DE, adds 1 to HL and to DE, takes 1 from BC, and repeats until BC is 0: three bytes here.

The program draws the base once, after the clear:

```z80
        LD      HL,BASE         ; draw the base where BASEX says
        CALL    DRAWBASE
```

`CALL DRAWBASE` pushes the address of the next instruction onto the stack, taking SP down by 2, and jumps to `DRAWBASE`; its `RET` pops that address back, SP up by 2, and the program goes on from there, into the loop. HL says what to draw, so the same routine can draw anything three cells wide where the base is: in the next chapter it also draws three spaces, to erase it. As `WAIT` does, `DRAWBASE` keeps BC on the stack with `PUSH` and `POP`, since `LDIR` counts it down to 0.

## On the Model I

The Model I's screen is the same memory at `3C00H`, so the program runs on it unchanged.

## Try it

Change `BASEX`'s `DB 30` to `DB 0` and press Run ▶: the base sits at the left edge. Try `DB 61` for the right edge. With `DB 62` only two cells show: the base's left cell is `3FFEH`, so its right wing goes to `4000H`, one past the screen's last byte, `3FFFH`, into ordinary memory, where nothing draws it.

Then change the `0BFH` in the middle of `BASE` to `0B3H` and run it again. `0B3H` lights bits 0, 1, 4 and 5: the top and bottom blocks of the middle cell, with a gap between them.
