---
title: Reaching an edge, it inches down
idea: one routine, three moves: the same ADD HL,DE steps right, left, or down
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Now the row comes for the base. When it reaches an edge it still turns round, but that step takes it down a row instead of sideways, and then it marches back across the screen one row lower. Each crossing brings the invaders nearer. For now they stop coming down at row 13, two rows above the base; they go on marching there.

## What changed

Chapter 7's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 8.
- **~** `MARCH`'s comment: line 121 is changed and line 122 is new; they say that the step at an edge goes down a row.
- **+** Six lines in `MARCH`, lines 137 to 142, after `EX DE,HL`: unless the invaders are on row 13, the step at an edge goes down a row.
- **~** `MOVEROW`'s comment, lines 164 and 165: it now says that 64 moves the row down.
- **+** `INVROW`, after `TICK`, line 214: the screen row the invaders are on.

Nothing is taken out.

## Down is 64

Chapter 7's `MOVEROW` adds DE to every invader's address. It does not care what DE is: 1 moves the row a column right, -1 a column left, and 64 a row down, because a row is 64 cells and the cell below an address is 64 after it, as the cell above was 64 before it in chapter 4. So going down needs no new routine, only a different DE.

At an edge, `MARCH` turns round as before, putting the new step in DE, and then, unless the row is as low as it goes, puts 64 in DE instead:

```z80
        EX      DE,HL           ; and the new step into DE
        LD      A,(INVROW)      ; the row the invaders are on
        CP      13              ; row 13, the lowest they go for now?
        JR      Z,SIDE          ; then they only turn, and step sideways
        INC     A               ; one row lower
        LD      (INVROW),A
        LD      DE,64           ; a row is 64 cells: this step goes down
SIDE:   CALL    MOVEROW         ; every invader moves by DE
```

`STEP` has already changed sign, so the step after the one down goes back the other way. The row is erased before it moves and drawn after, as in chapter 7, so it leaves nothing behind on the row above.

## Which row

The addresses in `INVS` say where every invader is, but not, without some arithmetic, which row that is. `INVROW` keeps it in a byte, starting at 2:

```z80
INVROW: DB      2               ; the row the invaders are on, 2 to 13
```

`CP 13` compares A with 13 and sets only the flags, so A still holds the row for `INC A`. At row 13 the jump to `SIDE` skips the move down, and DE still holds the new step: the row turns and marches back on the same row, as it did in chapter 7. Row 14 is where a shot starts and row 15 is the base, so the invaders never draw over either.

## How long it takes

The row steps about every 266 ms, as in chapter 7. It reaches the right edge after 20 steps and comes down on the 21st, about five and a half seconds in; then each crossing is 34 steps sideways and one down, about nine seconds. Ten more crossings bring it to row 13, about 100 seconds after Run ▶.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz, and the Model III at 2.03 MHz, so the row steps about every 305 ms there instead of 266.

## Try it

Press Run ▶ and wait about five seconds: the row reaches the right edge, comes down to row 3, and marches back to the left.

Then change `CP 13` to `CP 4`. After two edges, down to row 4, the invaders go no lower, and turn on row 4 at each edge after. Or put `CP 13` back and change `INVROW`'s `DB 2` to `DB 12`: the invaders come down once, to row 3, and no further. `INVROW` is only what the program has been told about the row, and nothing checks it against the table.
