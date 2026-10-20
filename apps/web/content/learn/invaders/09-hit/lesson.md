---
title: The shot hits an invader
idea: a collision read off the screen, and a hole in the table that loops skip
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Now the shot hits. A shot that moves into an invader's cell shoots it down: the invader vanishes, and so does the shot, and the space bar can fire again. The invader stays gone, a gap in the marching row. The test for a hit reads the screen, and the invader's place in the table becomes 0, which every loop over the table now steps over.

## What changed

Chapter 8's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 9.
- **~** `MOVESHOT`'s comment: line 61 is changed and line 62 is new; it now says that a shot moving into an invader shoots it down.
- **+** Five lines in `MOVESHOT`, lines 78 to 82, before it draws the shot: they look at the cell the shot moves into.
- **+** `HITRT` and `HIT`, after `MOVESHOT`'s last `RET`, lines 85 to 93: they erase the invader, call `KILL`, and end the shot.
- **+** In `DRAWROW`, three lines, 122 to 124, and the label `DRAWNEXT` on line 132: a place that is 0 is not drawn.
- **+** In `EDGE`, three lines, 172 to 174, and the label `EDGENEXT` on line 180: a place that is 0 is never at an edge.
- **+** In `MOVEROW`, three lines, 195 to 197, and the label `MOVENEXT` on line 201: a place that is 0 does not move.
- **+** `KILL`, a new routine with its comment, after `MOVEROW`, lines 207 to 226: it finds the invader's place in the table and makes it 0.
- **~** The comment above `INVS`, line 254: a place can now be 0, an invader shot down.

Nothing is taken out.

## A hit, read off the screen

Before `MOVESHOT` draws the shot in its new cell, it looks at what is there:

```z80
        LD      A,(HL)          ; what is in the cell the shot moves into?
        CP      9EH             ; an invader's left cell: HL is its address
        JR      Z,HIT
        CP      0ADH            ; its right cell: its address is one before
        JR      Z,HITRT
        LD      (HL),21H        ; the shot is an exclamation mark
```

The screen is memory, so the cell holds whatever was last put there, and nothing but an invader puts `9EH` or `0ADH` on the screen. The loop drew the row at the end of the turn before, so the screen is up to date. `CP` compares A with a byte and sets only the flags; A is unchanged, so the second `CP` tests the same character. In JavaScript the test is `if (screen[hl] === 0x9E || screen[hl] === 0xAD)`, but with the two answers kept apart, because they say different things about where the invader starts: at HL for its left cell, at HL minus 1 for its right.

```z80
HITRT:  DEC     HL              ; back to the invader's left cell
HIT:    LD      (HL),20H        ; erase the invader's two cells
        INC     HL
        LD      (HL),20H
        DEC     HL              ; HL is the invader's address again
        CALL    KILL            ; its place in the table becomes 0
        LD      HL,0            ; and the shot is gone too
        LD      (SHOT),HL
```

A hit on the right cell steps HL back one and falls through into `HIT`, so both cases end with HL at the invader's address, which is what the table holds. The shot was erased from its old cell at the start of `MOVESHOT` and is never drawn in the new one; `SHOT` becomes 0, as when a shot leaves the top of the screen.

## KILL makes a hole in the table

`KILL` walks `INVS` with IX and `DJNZ`, as `DRAWROW` does, comparing each place with HL a byte at a time, since `CP` compares only A with a byte:

```z80
        LD      A,(IX+0)        ; this place's low byte: HL's?
        CP      L
        JR      NZ,KILLNEXT
        LD      A,(IX+1)        ; and its high byte: HL's too?
        CP      H
        JR      NZ,KILLNEXT
        LD      (IX+0),0        ; this is the invader: its place becomes 0
        LD      (IX+1),0
```

`LD (IX+0),0` stores a number straight into memory through IX, 19 T-states. 0 is never on the screen, so it means *no invader here*, as 0 in `SHOT` means no shot.

## Every loop skips the hole

A place of 0 must not be drawn, must not count for an edge, and must not move: `MOVEROW` would add the step to 0, making 1, `0FFFFH` or `0040H`, none of them on the screen, and the next `DRAWROW` would write an invader there. So each of the three loops tests the place first and jumps to the next one if it is 0:

```z80
        LD      A,H             ; 0 is an invader shot down: nothing to draw
        OR      L
        JR      Z,DRAWNEXT
```

`DRAWROW` and `MOVEROW` have the place in HL already and test it as `MOVESHOT` tests the shot; `EDGE` reads it with `LD A,(IX+1)` and `OR (IX+0)`. The labels `DRAWNEXT`, `EDGENEXT` and `MOVENEXT` mark each loop's `INC IX`, where the next place starts.

Because `EDGE` skips the holes, the row turns when a *living* invader reaches an edge. Shoot down the invaders at the end of the row and the rest march farther before they turn, as in the arcade game.

## When an invader still covers the shot

`MOVESHOT` looks at the cell the shot moves into before the invaders move: in the loop, `CALL MOVESHOT` comes before `CALL MARCH`. So on a turn when the row steps, a shot that has just risen into a gap on the invaders' row can have the neighbour beside it step onto it, and a row coming down can land on a shot just below it. Then `DRAWROW` draws the invader over the `!`; on the next turn `MOVESHOT` erases the shot's cell, now part of the invader, and the shot flies on, and `DRAWROW` mends the invader. That shot goes behind, as every shot did before this chapter. Sideways, it happens to about one shot in eight of those that rise through a gap: the row steps on one turn in four, and only one of the gap's two cells is stepped onto. Looking at the shot's own cell, too, before it moves would catch it; this chapter keeps to the one test.

## The cost

Looking at a place costs 15 T-states in `DRAWROW` (`LD A,H` 4, `OR L` 4, and `JR Z` 7 when it does not jump), so drawing the row every turn costs 120 more, and a turn with no key down is now 134,513 T-states.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz and the Model III at 2.03 MHz, so the game runs a little more slowly there.

## Try it

Press Run ▶, click the screen, and fire without moving: the shot rises in column 31. If an invader is over that column when the shot reaches row 2, it is shot down, and a gap marches in the row where it was; if the shot arrives between two invaders, it goes on up past them, and you can fire again. Then shoot down the invader at the row's left end: once it is gone, the row marches four columns farther left before it turns.

Then take out the line `JR Z,HITRT`. Now only an invader's left cell stops the shot: a shot moving into a right cell is drawn over by the invader in the same turn, so the shot seems to pass behind it, and the invader is not shot down.
