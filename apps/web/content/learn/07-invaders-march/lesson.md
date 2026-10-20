---
title: Invaders march
idea: A table of data, IX with an offset, and DJNZ
models: 3, 1
game: sea-dragon 50EA DRAW_OBJECT
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Lesson 6's ship is still on the bottom row, moving with the arrows and firing with the space bar. Above it, a row of six invaders steps right a cell at a time, and at the screen's edge turns and steps back. Everything the program knows about the row is three bytes in a table, and IX points at it:

```z80
ROW:    DB      8               ; IX+0: the row's left column
        DB      1               ; IX+1: its step, 1 right or -1 (0FFH) left
        DB      6               ; IX+2: how many invaders
```

Carried over: the ship and the shot, unchanged: `MOVESHIP`, `MOVESHOT`, `FIRE`, `SHOW`, `WAIT`, `SHIP`, `BLANK`, `SHIPX` and `SHOT`, line for line, and the game loop's turn, `CALL WAIT`, `CALL MOVESHIP`, `CALL MOVESHOT` and `CALL FIRE` (lesson 6); state kept in memory, and a column turned into an address with `ADD A` and a fixed high byte, `ADD A,0C0H` and `3FH` there, `ADD A,80H` and `3CH` here (lesson 6); a routine that keeps registers with `PUSH` and `POP`, and erasing and redrawing from `DB` tables, `SHAPE` drawn as `SHIP` was and erased with `BLANK` (lesson 5); `CP` with `JR Z` and `JR NZ`, and `SUB` (lesson 4); a negative number, -1 as the byte `0FFH` as -64 was a word in `LD DE,-64`, and `DEC HL` (lesson 3); `LD (DE),A`, `INC HL`, `INC DE` and `ADD A` (lesson 2). New: the `ROW` table read through IX with `(IX+n)`, `DJNZ`, `NEG`, and `MARCH` and `DRAWROW`, which use them.

## IX, a pointer with an offset

IX is a 16-bit register like HL, made for this: `(IX+2)` is the byte two after the one IX points at. `LD IX,ROW` once at the start, and the row's fields are `(IX+0)`, `(IX+1)` and `(IX+2)` everywhere after, read and written like registers:

```z80
        LD      A,(IX+0)        ; the row's left column
        ADD     A,(IX+1)        ; plus its step: 1, or 0FFH, which is -1
        LD      (IX+0),A        ; is its new column
```

In JavaScript, IX is the object and the offsets are its fields:

```js
const row = { x: 8, step: 1, count: 6 };   // ROW: DB 8, 1, 6
row.x += row.step;                         // ADD A,(IX+1)
```

The offset is a signed byte, -128 to 127, fixed when the program is assembled. IY is a second register just like IX. Both cost time: an IX instruction carries an extra prefix byte, and `LD A,(IX+0)` takes 19 T-states where `LD A,(HL)` takes 7. That matters in a tight loop and not at all in a step about four times a second.

## A negative step

The step is 1 going right and `0FFH` going left. Adding `0FFH` to a byte is subtracting 1, because the sum wraps past 255: `9 + 0FFH` is `108H`, and A keeps `08H`. That is two's complement, as `LD DE,-64` was in lesson 3, one byte wide. `NEG` turns 1 into `0FFH` and back, A = 0 − A, so the turn at either edge is the same three lines:

```z80
TURN:   LD      A,(IX+1)        ; turn round: the step changes sign,
        NEG                     ; 1 to -1 or -1 to 1
        LD      (IX+1),A
```

The left edge is column 0. The right edge depends on how many invaders there are: each takes four cells, two for the invader and two of gap, but the last one's gap can go off the edge, so a row of *n* is 4*n* − 2 cells wide and its last left column is 66 − 4*n*. `MARCH` works that out from `(IX+2)` each step, `ADD A,A` twice for the times four.

## DJNZ

`DJNZ NEXT` is *decrement B and jump if not zero*: B goes down by 1, and the jump is taken unless B reached 0. It sets no flags, and it is a counted loop in one instruction, `do { ... } while (--b !== 0)`, the test at the bottom. B is the only register it counts. `DRAWROW` loads the count from the table and draws one invader a pass:

```z80
        LD      B,(IX+2)        ; B counts the invaders for DJNZ
NEXT:   LD      A,(HL)          ; the shape's left cell
        LD      (DE),A
        ...
        DJNZ    NEXT            ; the next invader, until B is 0
```

The game loop uses it too: lesson 6's turn runs four times, then the invaders step once.

```z80
LOOP:   LD      B,4             ; four turns to each march step
PLAY:   CALL    WAIT            ; lesson 6's turn: no routine in it changes B
        CALL    MOVESHIP        ; the ship moves if an arrow is down
        CALL    MOVESHOT        ; the shot, if there is one, rises a row
        CALL    FIRE            ; the space bar starts a shot, if there is none
        DJNZ    PLAY            ; B minus 1, and another turn until it is 0
        CALL    MARCH           ; then the invaders step
        JR      LOOP
```

That works only because nothing in the turn changes B. `WAIT` and `SHOW` push and pop BC (lesson 5 said nothing called `WAIT` with anything in B yet, and now something does), `MOVESHIP` changes only C, and `MOVESHOT` and `FIRE` never touch BC. `DRAWROW` does use B, but `MARCH` runs after the `DJNZ`, and `LOOP` loads B again.

## Two cells of invader

`SHAPE` is `9EH` and `0ADH`. With lesson 5's bits, `9EH` lights the top right, the middle two and the bottom left of its cell, and `0ADH` the top left, the middle two and the bottom right: side by side, a head, arms, and two legs apart. Erasing is the same routine with HL at `BLANK`, lesson 5's three spaces, of which `DRAWROW` copies two.

The shot does not hit anything yet: it passes through the row, leaving a gap in an invader it crossed until the row's next step redraws it. Hitting invaders comes in the next part.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row, and its screen is the same memory with the same graphics, so the program runs unchanged; at 1.77 MHz a march step takes about 300 ms instead of about 265 ms.

## Try it

Change the third byte of `ROW` from `6` to `8` and press Run. Eight invaders march now, and they turn at column 34 instead of 42 without any other change, because `MARCH` reads the count from `(IX+2)` each time.

Then make them hurry: change `LD B,4` to `LD B,1`, one `WAIT` a step. The invaders march at the ship's speed from lesson 5. The next part, [Build Space Invaders](/learn/invaders/), builds a whole game, piece by piece: the shot hitting invaders, the row inching down, and a score.

## In a real game

Each object in Sea Dragon's cavern is a small record, and `DRAW_OBJECT` reads it as `MARCH` reads `ROW`: IX points at the record, with the object's kind at `(IX+00H)`, its frame at `(IX+01H)`, its row at `(IX+02H)` and its flags at `(IX+03H)`. The kind and the frame together pick the shape to draw from a table of pointers. `UPDATE_OBJECTS` loads IX with each object's record in turn and calls it.
