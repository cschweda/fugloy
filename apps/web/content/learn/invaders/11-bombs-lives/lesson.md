---
title: Invaders drop bombs, and the base has lives
idea: a second thing falling, a choice from R, and a game that can end
models: 3, 1
game: sea-dragon 5F10 LOSE_SHIP
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Now the invaders fight back. One of them, picked with the R register as lesson 4 picked a move, drops a bomb, a zigzag that falls a row every turn. A bomb that falls into the base costs a life; the lives, 3 to begin with, are at the top right, `LIVES 3`. With none left, `GAME OVER` appears in the top line and the program stops. There is one bomb at a time, as there is one shot, and the next drops as soon as the last is gone.

## What changed

Chapter 10's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 11.
- **~** `SHOWSCORE`'s comment: lines 244 and 245 are changed and line 246 is new; it now prints the lives too.
- **+** Seven lines at the start of `SHOWSCORE`, lines 248 to 254: they print `LIVES ` and the lives at the end of row 0.
- **+** `MOVEBOMB` and `DROP`, new routines with their comments, after `TWODIG`, lines 280 to 338: the bomb falls, hits the base, or a new one drops.
- **+** In the game loop, line 359: `CALL MOVEBOMB`, after the rows are drawn.
- **~** The comment on the loop's `JR LOOP`, line 361: the loop now goes round until the game is over.
- **+** `OVER` and `STOP`, with their comment, after the loop, lines 363 to 370: the end of the game.
- **+** `LIVESTXT`, `LIVES`, `BOMBCH`, `BOMB` and `OVERTXT`, after `SCORE`, lines 393 to 399: the lives' word, the lives, the bomb's character, where the bomb is, and the words `GAME OVER`.

Nothing is taken out.

## A bomb falls as the shot rises

`BOMB` holds the bomb's screen address, or 0 for none, as `SHOT` does for the shot, and `MOVEBOMB` is `MOVESHOT` turned upside down: it adds 64 instead of -64. The test for leaving the screen is the same `BIT 2,H`, because the address after the bottom row, `4000H`, has bit 2 of its high byte clear, as `3BFFH` before the top row does.

The bomb's character is `99H`, `BOMBCH`, a graphics byte lighting bits 0, 3 and 4: the top left block, the middle right and the bottom left, a zigzag (as Fugløy's screen draws them). `EQU` names it, as it named `NINV`.

The bomb has to get past things the shot never met: it starts under an invader on row 2, 4 or 6, and the rows' invaders stand in the same columns, so a bomb from row 2 falls through rows 4 and 6. So `MOVEBOMB` is careful in two ways. It erases the bomb only if the bomb is still what is in its cell, and it draws the bomb only in a blank cell:

```z80
        LD      A,(HL)          ; is the bomb still what is in its cell?
        CP      BOMBCH
        JR      NZ,FALL         ; no: something was drawn over it, leave that
        LD      (HL),20H        ; yes: erase it
...
        LD      A,(HL)          ; what is in the cell the bomb falls into?
        CP      20H             ; a blank: draw the bomb there
        JR      Z,BOMBDRAW
```

So a bomb that falls into an invader's cell is not drawn, and the next turn, finding the invader there and not the bomb, it leaves the invader alone and falls on: it passes behind. The same happens with the shot. A shot and a bomb pass through each other; here a shot cannot stop a bomb. `CALL MOVEBOMB` comes after `CALL DRAWROW` in the loop, so the invaders are on the screen when `MOVEBOMB` looks.

## A bomb in the base

If the cell the bomb falls into holds `0BCH`, a wing, or `0BFH`, the middle, the bomb has hit the base: nothing else on the screen uses those two characters, so, as in chapter 9, the screen says what was hit:

```z80
        CP      0BCH            ; the base's wing
        JR      Z,BASEHIT
        CP      0BFH            ; or its middle
        JR      Z,BASEHIT
...
BASEHIT:
        LD      HL,0            ; the bomb is gone
        LD      (BOMB),HL
        LD      HL,LIVES        ; and a life
        DEC     (HL)
        RET     NZ              ; lives left: play on
        JP      OVER            ; none: the game is over
```

`DEC (HL)` takes 1 from the byte in memory and sets Z when it reaches 0, as `DEC (HL)` on `TICK` does in `MARCH`. The base is not damaged; only the lives show the hit. A bomb is a hit when it falls into the base. A bomb that lands on the bottom row beside the base, and that the base then moves onto, is not: `MOVEBASE` draws the base over it, and the next turn the bomb falls off the screen. `SHOWSCORE` prints the lives as one digit, `'0'` plus `LIVES`, the way `TWODIG` prints a digit.

## Which invader: the R register

When no bomb is falling, `DROP` picks an invader. R, as in lesson 4, is the Z80's refresh register: the processor adds 1 to its low seven bits at every opcode fetch, once for most instructions and twice for those with a prefix byte, as the ones using IX have. Bit 7 is left alone, and it is 0 here, so `LD A,R` gives a number from 0 to 127. Lesson 4's remainder loop, with `NINV` for 3, makes it a place in the table, 0 to 23:

```z80
DROP:   LD      A,R             ; R counts instruction fetches: 0 to 127 here
WHICH:  CP      NINV            ; the remainder by NINV: carry when A is less
        JR      C,PICKED
        SUB     NINV            ; otherwise take NINV away and compare again
        JR      WHICH
PICKED: ADD     A,A             ; times 2: a word a place
        LD      E,A
        LD      D,0
        LD      IX,INVS
        ADD     IX,DE           ; IX points at the invader's place
```

`ADD IX,DE` adds a pair to IX as `ADD HL,DE` adds one to HL. If that place is 0, the invader is shot down and there is no bomb this turn; R will be different the next. Otherwise HL is the invader's address, and `JR FALL` jumps into `MOVEBOMB` to move it down a row and draw the bomb there, so a new bomb starts under the invader's left cell. As the invaders are shot down, more picks find a 0, and bombs come less often.

None of this is random. With no key down, the program runs the same instructions every turn, so press Run ▶ and touch nothing, and the bombs fall in the same places every time; the checks Fugløy runs on this chapter see the same game. The keys you press change how many instructions run, and so which invader R picks next.

## The end of the game

`OVER` prints the top line once more, so that it shows `LIVES 0`, then copies `GAME OVER` into the middle of row 0, and stops:

```z80
STOP:   JR      STOP            ; the game is over: wait here for good
```

`JR STOP` jumps to itself, for ever, as lesson 1's program parked at its end. `MOVEBOMB` was called from the loop and jumps to `OVER` with `JP`, not `CALL`, so its return address is left on the stack; nothing will ever return, so it does no harm. To play again, press Run ▶.

## The cost

A falling bomb adds about 200 T-states to a turn, and printing the lives 178, so a turn with no key down is about 137,400 T-states.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz and the Model III at 2.03 MHz, so the game runs a little more slowly there.

## Try it

Press Run ▶ and touch nothing. The first bomb drops from under the invader on row 2 at column 42, vanishes for a turn behind the invader below it, and lands on the bottom row, to the right of the base. About five and a half seconds in, a bomb falls into the base and the top line shows `LIVES 2`; about nine seconds in, with no lives left, it shows `GAME OVER` and the program stops. Run it again, and the same bombs fall. Then run it and play: dodge with the arrows, and the bombs fall somewhere else.

Then change `LIVES`'s `DB 3` to `DB 1`, and run it touching nothing: the first bomb in the base, about five and a half seconds in, ends the game.

## In a real game

Sea Dragon's `LOSE_SHIP` runs when the sub is lost. It takes one from `SHIPS`, adds `30H` to make the count a digit, as `SHOWSCORE` adds `'0'` to `LIVES`, and prints it on the bottom row, column 6 for player 1 or 55 for player 2. Then `CP 30H`: if the digit is `0`, it jumps to `GAME_OVER`, which prints *Game Over Player* and the player's number.
