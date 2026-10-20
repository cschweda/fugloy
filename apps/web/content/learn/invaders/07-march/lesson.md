---
title: The row marches left and right
idea: a word that is 1 or -1, a turn counter in memory, and SBC to turn round
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
The row moves. Every fourth turn it steps a column to the right, and when its last invader reaches the right edge of the screen it turns round and marches back to the left, and at the left edge turns again. Because chapter 6 put every invader's place in a table, moving the row is one loop that adds the same step to every place.

## What changed

Chapter 6's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 7.
- **+** `MARCH`, `EDGE` and `MOVEROW`, three new routines with their comments, below `DRAWROW`, lines 120 to 172: the row's step, the test for an edge, and the move.
- **+** `CALL MARCH` in the loop, line 190, after `CALL FIRE`.
- **+** `STEP` and `TICK`, after `SHOT`, lines 205 and 206: the row's step and its turn counter.

Nothing is taken out.

## Every fourth turn

A turn is about 66 ms, and a row stepping every turn would cross the screen in about two seconds. `TICK` counts turns down from 4, and `MARCH` does its work only when the count reaches 0:

```z80
MARCH:  LD      HL,TICK         ; one turn fewer to the row's next step
        DEC     (HL)
        RET     NZ              ; not 0 yet: not this turn
        LD      (HL),4          ; 0: a step now, and the next in four turns
```

`DEC (HL)` takes 1 from the byte HL points at, in memory, and sets the zero flag when the result is 0, so `RET NZ` returns on three turns of four. On the fourth, `LD (HL),4` starts the count again. Lesson 7 counted turns in B with `DJNZ`; a byte in memory is free for the rest of the turn to use B, and a later chapter can change how fast the row marches by changing the 4.

## A step of 1 or -1

`STEP` is the row's direction, a word:

```z80
STEP:   DW      1               ; the row's step: 1 right, or -1 (0FFFFH) left
```

Moving the row adds the step to every invader's address. `MOVEROW` walks the table as `DRAWROW` does, with IX and `DJNZ`, and for each invader loads its address into HL, adds DE, and stores it back:

```z80
        LD      L,(IX+0)        ; the invader's address into HL
        LD      H,(IX+1)
        ADD     HL,DE           ; plus the step
        LD      (IX+0),L        ; and back into the table
        LD      (IX+1),H
```

Going right, DE is 1. Going left it is -1, which as a word is `0FFFFH`: adding `0FFFFH` to an address wraps past `0FFFFH` and comes out one less, as adding -64 came out a row up in chapter 4. One `ADD HL,DE` moves the invader either way.

## The edge ahead

The row must turn when an invader is at the edge it is marching to: column 62 going right, since an invader is two cells wide and column 63 is the last, or column 0 going left. `EDGE` finds the column without dividing anything. A row is 64 cells, `40H`, and every row starts at an address whose low six bits are 0, so the low six bits of an invader's address are its column. Add the step, and the column it would move to is 63 at the right edge and -1 at the left, and in six bits both are `3FH`, all ones:

```z80
        LD      A,(IX+0)        ; the low byte of the invader's address
        ADD     A,E             ; plus the step
        AND     3FH             ; its low six bits: the column it would move to
        CP      3FH             ; 63, or -1: past an edge
        RET     Z               ; this one is at the edge: return with Z
```

E is the step's low byte, 1 or `0FFH`. `CP 3FH` compares A with `3FH` and sets only the flags; A is unchanged. If no invader is at an edge the loop ends, and `OR 1` makes the zero flag clear for certain, since A is not 0 after it: `EDGE` returns Z for an edge and NZ for none.

## Turning round

At an edge, `MARCH` makes the step 0 minus the step, 1 into -1 or -1 into 1:

```z80
        LD      HL,0            ; turn round: the step becomes 0 minus the step
        OR      A               ; clear the carry flag, which SBC takes off too
        SBC     HL,DE
        LD      (STEP),HL
        EX      DE,HL           ; and the new step into DE
```

The Z80 has no 16-bit `SUB`; `SBC HL,DE` is HL minus DE minus the carry flag. `OR A` leaves A as it is and clears the carry, so the subtraction is exact. `EX DE,HL` swaps DE and HL, putting the new step in DE for `MOVEROW`, so the row steps back the other way on the same turn it turns.

Before moving, `MARCH` erases the whole row with `BLANK`'s spaces, `DRAWROW` with DE at `BLANK`. The loop's `DRAWROW` after it draws the row in its new place in the same turn.

## The cost

On three turns of four, `CALL MARCH` costs 49 T-states, and a turn with no key down is 134,393. On the fourth, the erase, the edge test and the move add 2,709 more, for a turn of 137,102 T-states. Four turns are 540,281 T-states; Fugløy runs the Model III at 2.03 MHz, so the row steps about every 266 ms, a little under four steps a second.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz, so the row steps about every 305 ms there.

## Try it

Press Run ▶ and watch: the row starts at column 14, its last invader reaches the right edge after 20 steps, about five seconds, and it marches back to the left edge, 34 steps more, and turns again.

Then make it hurry: change `LD (HL),4` to `LD (HL),1` and `TICK`'s `DB 4` to `DB 1`. The row steps every turn, as fast as the base moves. Or change `STEP`'s `DW 1` to `DW -1`, and the row starts by marching left.
