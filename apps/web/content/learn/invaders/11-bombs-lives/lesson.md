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
Now the invaders fight back. One of them, picked with the R register as lesson 4 picked a move, drops a bomb, a zigzag that falls a row every turn. A bomb that falls into the base costs a life; the lives, 3 to begin with, are at the top right, `LIVES 3`. With none left, `GAME OVER` appears in the top line and the program stops. There is one bomb at a time, as there is one shot, and the next drops as soon as the last is gone. The invaders no longer stop above the base: one that comes down to row 13 has landed, and that ends the game too, as in the arcade game. And now that the game can be lost, it waits for you: `PRESS SPACE TO START`.

## What changed

Chapter 10's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 11.
- **~** `MARCH`'s comment: line 142 is changed and line 143 is new; an invader that comes down to row 13 ends the game.
- **−** Six lines of `MARCH`, from `EX DE,HL` to `LD (INVROW),A`, are taken out: the invaders no longer stop at a floor. Below the program, under *lines taken out*, they show struck through, before line 157.
- **+** In `MARCH`, line 159: `CALL LANDED`, after `CALL MOVEROW`.
- **~** `SHOWSCORE`'s comment: lines 240 and 241 are changed and line 242 is new; it now prints the lives too.
- **+** Seven lines at the start of `SHOWSCORE`, lines 244 to 250: they print `LIVES ` and the lives at the end of row 0.
- **+** `MOVEBOMB`, `DROP` and `LANDED`, new routines with their comments, after `TWODIG`, lines 276 to 354: the bomb falls, hits the base, or a new one drops; and an invader on row 13 ends the game.
- **+** At the end of `START`, lines 365 to 380: the top line and the invaders are drawn, and the program waits for the space bar under `PRESS SPACE TO START`, then erases the words.
- **~** The game loop's comment: line 383 is changed and line 384 is new; a turn now moves the bomb and draws the top line too.
- **~** At the loop's end, lines 392 and 393 are changed and 394 to 406 are new: `CALL MOVEBOMB` comes in before `CALL SHOWSCORE`, whose comment now names the lives, `JR LOOP`'s comment says the loop goes round until the game is over, and after the loop come `OVER` and `STOP`, the end of the game.
- **−** `INVROW` is taken out, with the floor; it shows struck through before line 426.
- **+** `LIVESTXT`, `LIVES`, `BOMBCH`, `BOMB`, `OVERTXT` and `GOTXT`, after `SCORE`, lines 429 to 436: the lives' word, the lives, the bomb's character, where the bomb is, and the words `GAME OVER` and `PRESS SPACE TO START`.

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

None of this is random: R is a count. What makes it change from game to game is you. Before the game starts, `START` waits for the space bar a turn at a time, so how many turns you take to press it changes R when the first bomb drops; after that, every key you press changes how many instructions run, and so which invader R picks next. Fugløy's checks on this chapter press the space bar at the same moment every time, and see the same game every time.

## Waiting for the space bar

Before the first turn, `START` draws the top line and the invaders, prints `PRESS SPACE TO START` on row 10, and waits:

```z80
GO:     CALL    WAIT            ; a turn's pause, then look at the space bar
        LD      A,(3840H)       ; the space bar is bit 7 of the arrows' row
        BIT     7,A
        JR      Z,GO            ; not down: wait another turn
```

It is lesson 4's wait for a key, with `CALL WAIT` in it, so it looks once a turn. Then a `DJNZ` loop writes 20 spaces over the words, and the game starts. If you are still holding the space bar when the first turn comes round, `FIRE` fires a shot at once.

## Landing

Chapter 10's invaders stopped coming down when the top row reached row 9, and marched along there for ever. Now there is no floor: `MARCH` loses the six lines that kept `INVROW`, and `INVROW` goes too, so every step at an edge goes down a row. After every step, `LANDED` walks the table and looks for an invader on row 13:

```z80
        LD      A,(IX+1)        ; the high byte: 3FH is rows 12 to 15
        CP      3FH
        JR      NZ,LANDNEXT
        LD      A,(IX+0)        ; the low byte: 40H or more is row 13 or lower
        CP      40H
        JP      NC,OVER         ; landed: the game is over
```

Rows 12 to 15 are `3F00H` to `3FFFH`, and row 13 starts at `3F40H`, so an address on row 13 has the high byte `3FH` and the low byte `40H` or more. `CP 40H` sets the carry when A is less than `40H`, so `JP NC` jumps when it is not. A place that is 0 has the high byte 0 and is never on row 13, so the shot-down invaders need no test of their own. It is the lowest invader still standing that lands: shoot the bottom row away and the two above it have further to come.

## The end of the game

The game ends two ways: `BASEHIT` with no lives left, and `LANDED`. Both jump to `OVER`, which prints the top line once more, so that it shows the lives, draws the invaders, because `MARCH` erases them before it moves them and `LANDED` runs before they are drawn again, then copies `GAME OVER` into the middle of row 0, and stops:

```z80
STOP:   JR      STOP            ; the game is over: wait here for good
```

`JR STOP` jumps to itself, for ever, as lesson 1's program parked at its end. `MOVEBOMB` and `LANDED` are called, and jump to `OVER` with `JP`, not `CALL`, so return addresses are left on the stack; nothing will ever return, so they do no harm. To play again, press Run ▶: after `GAME OVER` the program stays where it stopped.

## The cost

A falling bomb adds about 200 T-states to a turn, and printing the lives 178, so a turn with no key down is about 137,400 T-states. `LANDED` runs only when the invaders step.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz and the Model III at 2.03 MHz, so the game runs a little more slowly there.

## Try it

Press Run ▶, click the screen, and press the space bar: the words go (and if you held the bar down, a shot fires), and the first bomb drops. Stand still and the bombs find the base sooner or later, three times: `LIVES 2`, `LIVES 1`, and `GAME OVER`. When that happens depends on when you pressed the space bar, so run it again and press it a little later, and the bombs fall somewhere else. Then play: dodge with the arrows.

Then take out the line `CALL MOVEBOMB` in the loop, and run it standing still: no bombs fall, and about 64 seconds after the space bar, on the Model III, the lowest row lands on row 13 and the top line says `GAME OVER`, with `LIVES 3`.

## In a real game

Sea Dragon's `LOSE_SHIP` runs when the sub is lost. It takes one from `SHIPS`, adds `30H` to make the count a digit, as `SHOWSCORE` adds `'0'` to `LIVES`, and prints it on the bottom row, column 6 for player 1 or 55 for player 2. Then `CP 30H`: if the digit is `0`, it jumps to `GAME_OVER`, which prints *Game Over Player* and the player's number.
