---
title: Three rows, and a score
idea: three rows in one table, EQU, and a score kept in BCD with DAA
models: 3, 1
game: sea-dragon 618C ADD_SCORE
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Now there are three rows of eight, on rows 2, 4 and 6, and every invader shot down is worth 10 points. The score is printed in decimal at the top left, `SCORE 0000`. The rows cost almost nothing new: they are 16 more places in the table, and every loop over the table counts 24 instead of 8. The score is new: a number kept as decimal digits, so that printing it is easy.

## What changed

Chapter 9's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 10.
- **+** In `HIT`, line 91: `CALL ADDSCORE`, after `CALL KILL`.
- **~** `LD B,8` becomes `LD B,NINV` in all four loops over the table: line 119 in `DRAWROW`, 171 in `EDGE`, 192 in `MOVEROW` and 211 in `KILL`.
- **~** `MARCH`'s comment, line 142, and two lines in `MARCH`, 157 and 158: the invaders come down until the top row is on row 9, so the lowest is on row 13.
- **+** `ADDSCORE`, `SHOWSCORE` and `TWODIG`, new routines with their comments, after `KILL`, lines 228 to 271: they add 10 to the score and print it.
- **+** In the game loop, line 292: `CALL SHOWSCORE`, after the rows are drawn.
- **~** The comment above `INVS`: line 300 is changed and line 301 is new; they say which rows the places are on, and what `NINV` is.
- **+** `NINV`, line 302, and four lines of `INVS`, 305 to 308: the places of rows 4 and 6.
- **~** `INVROW`'s comment, line 313: it is now the top row's row, 2 to 9.
- **+** `SCORETXT` and `SCORE`, after `INVROW`, lines 314 to 316: the score's word, and the score.

Nothing is taken out.

## Three rows are a longer table

`INVS` held row 2's eight places; now four more lines hold row 4's, which starts at `3D00H`, and row 6's, at `3D80H`. A row is 64 cells, `40H`, so two rows down is `80H` more. `DRAWROW`, `EDGE`, `MOVEROW` and `KILL` never cared which row a place was on: they walk the table and do the same thing to every place. So they need only count to the table's new length, and the count gets a name:

```z80
NINV:   EQU     24
```

`EQU` names a number for the assembler, like `const NINV = 24` in JavaScript. It puts nothing in memory: `LD B,NINV` assembles to the same two bytes as `LD B,24`. Change the table's length and `NINV` with it, and the four loops follow.

The three rows march as one, since `MOVEROW` moves every place by the same step, and the row turns when any invader, in any row, reaches an edge. `DRAWROW`, `MARCH` and `MOVEROW` keep their names and comments from when there was one row; *the row* in them now means all three. `INVROW` is now the top row's row, and the invaders stop coming down when it reaches row 9, which puts the lowest row on row 13 as before. That is so even when the lowest row has all been shot down: the two rows left stop on rows 9 and 11.

A shot rising at a column meets the lowest invader there first, so the invaders on row 6 protect the ones above them. As in chapter 9, a shot that has risen into a gap can still have an invader step or come down onto it, and go behind; with three rows, it has three rows of gaps to rise through.

## A score in decimal

The score has to be printed as decimal digits, and the Z80 has no instruction that divides by 10, so turning a binary number into digits is a loop of subtractions, as lesson 4's remainder by 3 was. The other way is to keep the score in decimal from the start. That is BCD, binary-coded decimal: four bits a digit, so a byte holds two digits, and the byte `47H` means forty-seven. `SCORE` is two bytes, four digits, the last two in the first byte:

```z80
SCORE:  DB      0,0             ; in BCD: the last two digits, then the first two
```

Adding in BCD needs one more instruction. `ADD A,10H` adds 1 to the tens digit, and from `40H` that gives `50H`, right; but from `90H` it gives `0A0H`, and A is no digit. `DAA`, decimal adjust A, puts it right. It looks at A and at two flags the `ADD` left: H, the half carry, set when the add carried out of the low four bits, and C, the carry. If the low four bits are over 9, or H is set, it adds 6; if A is over `99H`, or C is set, it adds `60H` and sets C. So `0A0H` becomes `00H` with C set: 90 and 10 are 100, which is 00 and a carry into the next two digits.

```z80
        ADD     A,10H           ; plus 10: a 1 in the tens digit
        DAA                     ; back to two decimal digits, carry past 99
        LD      (HL),A
        INC     HL              ; the first two digits (LD and INC HL keep C)
        LD      A,(HL)
        ADC     A,0             ; plus the carry from the last two
        DAA
```

`LD` sets no flags, and nor does `INC HL`, since 16-bit `INC` never does, so C is still the carry from the last two digits when `ADC A,0` adds it to the first two. The second `DAA` puts those right too. After `DAA` the carry out of the high byte is dropped, so the score goes from 9990 back to 0000. `DAA` works after `ADD` and `ADC`; after `SUB` and `SBC` it subtracts its 6 and `60H` instead, which it knows from the flag N that those set.

## Printing the digits

In BCD, a digit's character is the digit plus `'0'`, `30H`, since the digit characters `0` to `9` are `30H` to `39H`. `TWODIG` prints a byte's two digits:

```z80
TWODIG: LD      A,(HL)          ; the byte: two digits
        RRCA                    ; four rotates bring its high digit down
        RRCA                    ; to the low four bits
        RRCA
        RRCA
        AND     0FH             ; just that digit, 0 to 9
        ADD     A,'0'           ; its character: '0' is 30H, '9' is 39H
        LD      (DE),A
```

`RRCA` rotates A one bit right, the low bit going round to the top, so four of them swap A's two halves: `47H` becomes `74H`, and `AND 0FH` keeps the 4. In JavaScript the two digits are `(byte >> 4) + 48` and `(byte & 15) + 48`. `SHOWSCORE` copies `SCORE ` to row 0 with `LDIR`, which leaves DE on column 6, then has `TWODIG` print the high byte, the first two digits, and the low byte after it. For the low byte it does not `CALL TWODIG`: it steps HL back and runs on into `TWODIG`, whose `RET` then returns from `SHOWSCORE`, as `HITRT` runs on into `HIT`.

`SHOWSCORE` runs every turn, in the loop after the rows are drawn. Only a hit changes the score, but a shot that rises through row 0 erases a cell as it goes, as it erased invaders' cells before chapter 9, and printing the score every turn mends it at once, as `DRAWROW` mends the invaders.

## The cost

Drawing 16 more invaders every turn costs 132 T-states each in `DRAWROW`, 2,112 in all, and `SHOWSCORE` with its `CALL` costs 389, so a turn with no key down is now 137,014 T-states. The rows step every fourth turn, about every 275 ms.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, and the score is all capitals and digits, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz and the Model III at 2.03 MHz, so the game runs a little more slowly there.

## Try it

Press Run ▶, click the screen, and shoot an invader: the score goes from `SCORE 0000` to `SCORE 0010`, and 10 more with each one after.

Then make each invader worth 50: change `ADD A,10H` to `ADD A,50H`. The first hit shows `0050`, and the second `0100`: `DAA` carried into the first two digits. Then take out the `DAA` under it: the first hit still shows `0050`, but the second shows `00:0`, because A is `0A0H`, its high digit is 10, and `'0'` plus 10 is the character after `9`, a colon.

## In a real game

Sea Dragon's `ADD_SCORE` adds points kept in BCD to `SCORE`, six digits in three bytes, as `ADDSCORE` adds 10: `ADD A,L` and `DAA` for the last two digits, then `ADC A,H` and `DAA` for the next two, and when that carries, `INC A` and `DAA` for the first two. An Expert gets the points twice, by a `DJNZ` loop round the adds. Then it prints the score on the bottom row a digit at a time, `ADD A,30H` as `TWODIG` adds `'0'`, but leaving out the zeros in front, which `TWODIG` prints.
