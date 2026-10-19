---
title: A ship along the bottom
idea: CALL and RET, the stack with PUSH and POP, a counted delay, and erasing and redrawing
models: 3, 1
game: sea-dragon 4E51 L4E51
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
A ship sits on the bottom row, and the left and right arrows move it. Nothing on a TRS-80 screen moves by itself: to move the ship, the program writes spaces where it is, then writes it again one cell over. Both are the same copy, so it is written once, as a routine, and called:

```z80
        LD      HL,BLANK        ; erase the ship: three spaces where it is
        CALL    SHOW
        ...                     ; move DE one cell left or right
        LD      HL,SHIP         ; draw the ship where it is now
        CALL    SHOW
```

Carried over: `ORG 7000H`, and lesson 1's counted `BC` loop, here the body of `WAIT` (lessons 1 and 3); DE as a pointer into the screen, and C holding the keys while A works (lessons 2 and 3); the read of `3840H` with its `AND` mask and `JR Z` wait, `BIT 5,C` and `BIT 6,C` for left and right, and the column as the low six bits, `AND 3FH` (lesson 3); `LDIR` copying bytes from a `DB` table to the screen, and `CP` with `JR Z` (lesson 4). New: `CALL` and `RET`, the stack with `PUSH` and `POP`, a delay whose length is counted in T-states, `INC DE` and `DEC DE` on lesson 3's pen moves, a graphics character other than the white block, and erasing by writing spaces.

## CALL, RET and the stack

`SHOW` is lesson 4's print, once, as a routine: it copies the three bytes HL points at to the screen at DE. Lesson 4 wrote that copy out three times; here it is called twice each move.

`CALL SHOW` does two things: it pushes the address of the instruction after the `CALL` onto the stack, and jumps to `SHOW`. `RET` pops that address back into PC, so the program carries on from the line after the `CALL`. There are no arguments and no return value: a routine and its caller agree on registers, here HL and DE in.

The stack is memory, and SP, the stack pointer, holds the address of its top. A push moves SP down by 2 and stores two bytes there; a pop reads the two bytes at SP and moves SP up by 2. So the stack grows down, and the last thing pushed is the first popped. Fugløy's stand-in ROM sets SP to 0 before the program starts and pushes one address of its own, so SP is `FFFEH` at `START`: the stack is at the top of memory, well above the program at `7000H`.

In JavaScript the stack is an array used from one end:

```js
stack.push(returnAddress); pc = SHOW;   // CALL SHOW
pc = stack.pop();                       // RET
```

## PUSH and POP keep what a routine uses

`LDIR` moves DE on and counts BC down to zero, and the caller still needs both: DE is the ship's place and C holds the keys. So `SHOW` pushes them first and pops them before it returns:

```z80
SHOW:   PUSH    BC              ; save BC: the keys are in C
        PUSH    DE              ; save DE: the ship's place
        LD      BC,3            ; three bytes
        LDIR                    ; from (HL) to (DE), as in lesson 4
        POP     DE              ; the last pushed comes off first,
        POP     BC              ; so the pops are in reverse order
        RET                     ; back to the line after the CALL
```

The pushes and pops must pair up. Inside `SHOW` the stack holds, from SP up, the saved DE, the saved BC, and the return address. A `RET` with a push still on the stack would pop the saved DE into PC and jump wherever DE pointed.

## A delay you can count

`WAIT` is lesson 1's loop with nothing in it, as a routine. Each instruction takes a known number of T-states, clock cycles: `DEC BC` 6, `LD A,B` 4, `OR C` 4, and `JR NZ` 12 when it jumps (7 when it falls through). That is 26 a pass, and `BC` counts 5,120 passes, `1400H`: 133,120 T-states. Fugløy runs the Model III's Z80 at 2.03 MHz (2,027,520 a second), so `WAIT` lasts about 66 ms and a held arrow moves the ship about 15 cells a second. The T-states come from Fugløy's own decoding table, `packages/z80/src/tables.ts`.

`WAIT` pushes and pops BC too. Nothing calls it with anything in B or C yet, but a routine that leaves the registers as it found them, apart from A and the flags, can be called from anywhere.

## The ship and its edges

The ship is three cells, `0BCH`, `0BFH`, `0BCH`. Bytes `80H` to `0BFH` are graphics: each cell is two blocks across and three down, and the low six bits light them, bit 0 top left, 1 top right, 2 and 3 the middle, 4 and 5 the bottom (as Fugløy's screen draws them, from the TRS-80's character generator). `0BFH` lights all six; `0BCH`, bits 2 to 5, lights the lower two thirds, a wing.

DE is the ship's left cell. Row 15 starts at `3FC0H`, a multiple of 64, so the column is E's low six bits, as it was L's in lesson 3. On the left the ship stops at column 0; on the right, being three cells wide, at column 61:

```z80
        LD      A,E
        AND     3FH
        CP      61              ; the ship is three cells wide, so column 61 is as far
        JR      Z,NOTRT         ; right as it goes: stay
        INC     DE
```

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs its Z80 at 1.77 MHz, so the same 133,120 T-states take 75 ms there, and the ship moves about 13 cells a second.

## Try it

Set a breakpoint on the `PUSH DE` line in `SHOW` (click its left edge) and press Run: the program stops on its way to drawing the ship. SP is `FFFAH`: the `CALL` pushed its return address at `FFFCH`, below the stand-in ROM's at `FFFEH`, and `PUSH BC` took SP down two more. Press Step and SP is `FFF8H`, the saved DE on top. Step on through `LDIR`, the two pops and the `RET`, and SP is back at `FFFEH`.

Then take the `PUSH DE` and `POP DE` out of `SHOW`, click the breakpoint away, and press Run. Each `SHOW` now leaves DE three cells past where it drew, so the erase misses the ship and the left arrow moves it right, five cells a move, leaving a copy behind at every place it was.

## In a real game

Sea Dragon waits between frames with this lesson's loop, at `L4E51`: `DEC BC`, then `LD A,B`, `OR C` and `JR NZ` round again. Its count is not written into the code but read from a variable with `LD BC,(FRAME_DELAY)`, and halved with `SRL B` and `RR C`; it is shorter for an Expert, so the game runs faster. While it counts, the loop also looks at the space bar, so each shot needs a fresh press.
