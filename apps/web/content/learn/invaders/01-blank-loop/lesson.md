---
title: A blank screen and a game loop that does nothing yet
idea: a cleared screen and a game loop, a turn with a counted wait, round for ever
models: 3, 1
cite: m3-trm 14 the Model III's screen is video memory at 3C00H, 1,024 bytes
cite: m1-trh 12 the Model I's screen is video memory at 3C00H, 16 lines of 64 characters
---
Over these chapters you build a game in the spirit of Space Invaders, from a blank page to rows of invaders that march, descend and drop bombs on a base that moves and fires back. Each chapter's program is the last one with a few lines added or changed, and each one runs.

This first one has nothing to see. It clears the screen and starts the game loop, the frame everything else hangs on, and the loop does nothing yet but wait and go round again.

## What changed

Everything: chapter 1 starts from a blank page, so every line of its program is new, and the editor marks each one with a **+** in the margin and a green band. From chapter 2 on, the marks show only what that chapter changes: **+** for a new line, **~** for a changed one, and a line taken out is listed under the editor, struck through, with the line it stood before. Edit the program and the marks step aside, since they describe the chapter's own text; Reset to the lesson brings them back.

## A blank screen

The screen is memory: the 1,024 bytes from `3C00H` to `3FFFH` are its 16 rows of 64 cells, one byte a cell, top left first. A game owns the whole screen, so it starts by clearing it, storing a space, `20H`, in every cell:

```z80
START:  LD      HL,3C00H        ; HL points at the top-left cell
        LD      BC,400H         ; BC counts the cells: 400H is 1024
CLEAR:  LD      (HL),20H        ; a space: the cell is blank
        INC     HL              ; on to the next cell
        DEC     BC              ; one cell fewer to go
        LD      A,B             ; copy B into A
        OR      C               ; and OR in C: zero only when B and C both are
        JR      NZ,CLEAR        ; not zero yet: clear the next cell
```

If you did the lessons, this is lesson 1's fill with a space in place of the white block. `DEC BC` changes no flags, so `LD A,B` and `OR C` make the zero flag that `JR NZ` reads: zero only when both halves of BC are.

On Fugløy you will see no change when it runs, because Fugløy's stand-in ROM fills the screen with spaces before it starts a program. The game clears it anyway, so that it never depends on what was there before.

## The game loop

A game is a loop. Each turn it reads the keys, moves what moves, draws it, and waits a moment, so that the game runs at the same speed whatever the turn did; then it goes round again, until the game is over. This chapter's turn is only the wait:

```z80
LOOP:   CALL    WAIT            ; the turn's pause, so the game runs at a steady speed
        JR      LOOP            ; and round again, for ever
```

In JavaScript, a game loop is the same shape:

```js
while (true) {
  // read the keys, move things, draw them: nothing yet
  wait();
}
```

The game grows inside this loop. The next chapter draws the base on the bottom row before the loop starts; after that, each chapter gives the turn a little more to do between `LOOP` and `JR LOOP`: moving the base, firing a shot, and then the invaders.

## WAIT, a delay you can count

`WAIT` is lesson 5's delay, a counted loop with nothing in it. Each instruction takes a known number of T-states, clock cycles: `DEC BC` 6, `LD A,B` 4, `OR C` 4, and `JR NZ` 12 when it jumps, 7 when it falls through. That is 26 a pass, and BC counts 5,120 passes, `1400H`:

```z80
WAIT:   PUSH    BC              ; save BC, which the loop uses
        LD      BC,1400H        ; 1400H is 5,120 passes of 26 T-states
DELAY:  DEC     BC
        LD      A,B
        OR      C
        JR      NZ,DELAY
        POP     BC              ; BC as the caller left it
        RET
```

The passes take 133,115 T-states, 5 fewer than 5,120 times 26 because the last `JR NZ` falls through. With `CALL WAIT` (17), `PUSH BC` (11), `LD BC,1400H` (10), `POP BC` (10), `RET` (10) and `JR LOOP` (12), a whole turn is 133,185 T-states. Fugløy runs the Model III's Z80 at 2.03 MHz (2,027,520 a second), so a turn lasts about 66 ms, and the loop goes round about 15 times a second. The T-states come from Fugløy's own decoding table, `packages/z80/src/tables.ts`.

`WAIT` keeps BC with `PUSH` and `POP`, so that whatever later chapters keep in B and C survives the wait. Nothing does yet.

In the program, `WAIT` comes first, above `START`. A routine can sit anywhere the processor never falls into it from the line before: `END START` makes `START` the program's entry, the address its .CMD file tells the TRS-80 to start at, so the processor begins below `WAIT` and reaches it only by `CALL WAIT`. This program keeps its routines above `START` and the game itself below it.

## On the Model I

The Model I's screen is the same memory at `3C00H`, the same 16 rows of 64, so the program runs on it unchanged. Fugløy runs its Z80 at 1.77 MHz, so a turn lasts about 75 ms there and the loop goes round about 13 times a second.

## Try it

Change `LD (HL),20H` to `LD (HL),2EH` and press Run ▶. 2EH is the full stop, and the screen fills with them: now you can see the clear happen.

Then put it back, click the left edge of the `JR LOOP` line for a breakpoint, and press Run ▶ again. The program pauses there at the end of every turn; press Continue and it goes round once more, about 66 ms of waiting each time, and pauses again.
