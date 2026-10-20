---
title: Waves, each faster than the last
idea: a table copied afresh, a count of what is left, and the finished game
models: 3, 1
game: sea-dragon 600B GAME_OVER
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
The last chapter. Shoot down all 24 invaders and a new wave appears at the top, where the first began, and it marches faster: the first wave steps every 4 turns, the second every 3, the third every 2, and every wave after that on every turn. The score and the lives carry on from wave to wave, and the game goes on until a bomb takes the last life. That is the whole game.

## What changed

Chapter 11's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 12.
- **+** Three lines in `HIT`, lines 92 to 94, after `CALL ADDSCORE`: one invader fewer in the wave, and with none left, `CALL Z,NEWWAVE`.
- **~** `MARCH`'s comment, line 143: the row steps every `SPEED` turns.
- **~** In `MARCH`, `LD (HL),4` becomes two lines: line 149 is changed and line 150 is new; `TICK` starts again from `SPEED`, not from 4.
- **+** `NEWWAVE` and `PLACE`, new routines with their comments, after `DROP`, lines 342 to 364: the next wave is faster, and starts where the first did.
- **+** At the end of `START`, line 376: `CALL PLACE`, for the first wave.
- **~** The comment on the loop's `CALL MARCH`, line 384: every `SPEED` turns.
- **~** The comment above the table, lines 404 and 405, and its label, line 407: the starting places are now `HOME`.
- **+** `INVS`, after `HOME`, lines 413 to 415: a comment, and room for the wave's places.
- **+** `SPEED` and `LEFT`, after `TICK`, lines 420 and 421: the turns between steps, and the invaders left in the wave.

Nothing is taken out.

## The table, set up again

Until now `INVS` was both where the invaders started and where they were: the `DW` lines filled it when the program loaded, and play changed it, moving places and making them 0. A new wave needs the starting places again, so they get a table of their own, `HOME`, that nothing changes, and `INVS` becomes room for the wave in play:

```z80
INVS:   DS      2*NINV
```

`DS`, define space, sets aside a number of bytes, here 48, two a place, and puts nothing in them: the program file does not carry them, and they hold whatever was in memory. The assembler works out `2*NINV`, as it worked out `3C80H+14`. `PLACE` fills them, with the `LDIR` lesson 4 used to print, before anything reads them:

```z80
PLACE:  LD      HL,HOME         ; copy the starting places ...
        LD      DE,INVS         ; ... into the table
        LD      BC,2*NINV       ; two bytes a place
        LDIR
```

In JavaScript that is `invs = home.slice()`, a fresh copy to play with. `PLACE` then puts back everything else a wave starts with: the top row on row 2, `STEP` marching right, `TICK` at `SPEED` turns to the first step, and `LEFT` at 24. `START` calls it once, for the first wave, so `TICK`, `STEP` and `INVROW` keep their `DB` and `DW` values only as what the program file holds; `PLACE` sets each before the loop reads it.

## Counting what is left

`HIT` counts the wave down. `LEFT` is how many invaders are still standing, and `DEC (HL)` sets Z when it reaches 0, so the last invader shot down brings the next wave:

```z80
        LD      HL,LEFT         ; one invader fewer in the wave
        DEC     (HL)
        CALL    Z,NEWWAVE       ; none left: the next wave
```

`CALL Z` calls only when Z is set, and otherwise goes on to the next line, as `RET Z` returns only then. Walking the table to see whether every place is 0 would give the same answer, but a byte counted down costs 3 instructions at a hit instead of a loop of 24 on every turn.

## Faster each wave

The invaders step when `TICK` counts down to 0, and `MARCH` now starts it again from `SPEED` instead of from 4:

```z80
        LD      A,(SPEED)       ; 0: a step now, and the next in SPEED turns
        LD      (HL),A
```

`LD (HL),4` stores a number straight into memory, but there is no `LD (HL),(SPEED)`: a byte from one address reaches another through a register, so it goes through A. `NEWWAVE` makes `SPEED` one smaller each wave, unless it is 1 already, then runs on into `PLACE`:

```z80
        CP      1               ; every turn already: as fast as they go
        JR      Z,PLACE
        DEC     (HL)            ; one turn fewer
```

With a turn of about 137,400 T-states, and about 146,900 when the invaders step, the waves step about every 275, 208, 140 and 72 ms. `PLACE` sets `TICK` in the turn that cleared the wave, and `MARCH` counts that turn too, so the new wave's first step comes `SPEED` turns after the last hit, counting its own.

## What you built

A game of 434 lines, comments and all, built in twelve chapters from a blank screen and a loop that did nothing. The screen is memory, so drawing is storing a byte (chapter 2). The keyboard is memory too, read a row at a time and tested a bit at a time (chapter 3). A shot is a screen address that moves 64 back each turn (chapter 4). The invaders are a table of addresses, walked with IX and counted with `DJNZ` (chapter 6), moved together by adding one step to each (chapters 7 and 8), and shot down by reading the screen and writing a 0 (chapter 9). The score is BCD, put right by `DAA` (chapter 10). The bombs come from R, and the game ends at a loop that jumps to itself (chapter 11). And every turn is one pass of `LOOP`, timed by a counted delay, with no interrupts at all.

It is a small game, and it leaves things out: there is no sound; there is one shot and one bomb at a time, and they cannot hit each other; a hit on the base costs a life and leaves the base where it is; there are no shields, no saucer, and invaders that reach row 13 march along it instead of ending the game; the score goes back to 0000 after 9990; and to play again, press Run ▶. Each of those is a chapter you could write.

Then look at a real one. [Sea Dragon in the workbench](/?example=sea-dragon&at=497F) opens Wayne Westmoreland and Terry Gilman's game, from 1982, at its first instruction, with its annotated listing. Its `MAIN_LOOP` is your `LOOP` at full size; its objects are records read through IX, as `INVS` is read; its score is BCD with `DAA`; and its ships are a count with a game over at 0. You know every one of those now.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged. Fugløy runs the Model I at 1.77 MHz and the Model III at 2.03 MHz, so the game runs a little more slowly there.

## Try it

Press Run ▶, click the screen, and play, moving at once: the first two bombs fall straight at the base, and standing still costs two lives in the first second and a half. Shoot down the whole wave, dodging the bombs: when the last invader goes, all 24 appear again where the first wave started, on rows 2, 4 and 6, and they step every 3 turns instead of 4. Keep going, and lose your lives, until the top line says `GAME OVER`.

Then change `SPEED`'s `DB 4` to `DB 1`: the first wave steps every turn, as fast as the invaders go, and the waves after it are no faster.

## In a real game

Sea Dragon's `GAME_OVER` does what `OVER` does, and then what this game leaves to Run ▶. It prints *Game Over Player* on row 4 with `PRINT_TEXT`, and the player's number after it, then waits through three long delays, a `DJNZ` round a `CALL` of the ROM's delay. Then, with one player, it jumps back to the title, the game's first instruction, where the game begins again; with two, play passes to the other player if they have ships left.
