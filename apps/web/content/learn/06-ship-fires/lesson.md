---
title: The ship fires
idea: A game loop, two things moving at once, and state kept in memory with DB and DW
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Lesson 5's ship, and now the space bar fires. The shot rises a row at a time and is gone past the top, while the ship goes on moving under it. There are no threads and no timers: two things move at once because one loop gives each a turn.

```z80
LOOP:   CALL    WAIT            ; the game loop: one turn each WAIT
        CALL    MOVESHIP        ; the ship moves if an arrow is down
        CALL    MOVESHOT        ; the shot, if there is one, rises a row
        CALL    FIRE            ; the space bar starts a shot, if there is none
        JR      LOOP
```

Carried over: `SHIP`, `BLANK`, `WAIT` unchanged, `SHOW` with its `PUSH BC`, and lesson 5's move, now the body of `MOVESHIP` with its `CP 61` edge (lesson 5); a byte of memory as a variable, `LD A,(MINE)` and `LD (MINE),A` (lesson 4); the space bar's row, `3840H`, `BIT` to test a key, `LD DE,-64` with `ADD HL,DE` to go up a row, and `BIT 2,H` to see the pointer leave the screen (lesson 3); testing a pair for zero by `OR`ing its halves through A, `LD A,B` and `OR C` there, `LD A,H` and `OR L` here (lesson 1). New: a game loop of `CALL`s, the conditional returns `RET Z` and `RET NZ`, a 16-bit variable made with `DW` and read and written whole with `LD HL,(SHOT)` and `LD (SHOT),HL`, 0 meaning *none*, and a column turned into an address with `ADD A`.

In JavaScript it is the loop every browser game has:

```js
let shipX = 30, shot = 0;      // SHIPX: DB 30, SHOT: DW 0
function frame() {
  moveShip(); moveShot(); fire();
  setTimeout(frame, 66);       // CALL WAIT
}
```

## State lives in memory

In lesson 5 the ship's place was DE, and it could stay there because `SHOW` saved DE around its `LDIR`. Now there are two things to keep from one turn to the next, and the routines need HL, DE and BC for their own work. So each thing's state gets a name in memory, set up by the assembler:

```z80
SHIPX:  DB      30              ; the ship's column, 0 to 61
SHOT:   DW      0               ; the shot's screen address, or 0 for none
```

`DB` is a byte and `DW` a word, two bytes, the low byte first. `LD HL,(SHOT)` loads both at once, `SHOT` into L and `SHOT+1` into H, and `LD (SHOT),HL` stores them back. A pair moves whole like that; of the 8-bit registers, only A can go to or from a named address, so the ship's column goes through A with `LD A,(SHIPX)`.

`SHOW` keeps no position now. It works the ship's left cell out from `SHIPX` each time: row 15 starts at `3FC0H` and the column is at most 61, so the address is `3FH` in D and `0C0H` plus the column in E, with no carry to worry about.

## Returning early

`RET Z` returns only if the zero flag is set, and `RET NZ` only if it is not; otherwise the routine runs on. They are the Z80's guard clauses, `if (!shot) return;`:

```z80
MOVESHOT:
        LD      HL,(SHOT)       ; where the shot is: two bytes from memory into HL
        LD      A,H             ; 0 is no shot: test HL as lesson 1 tested BC
        OR      L
        RET     Z               ; no shot: nothing to do
```

`FIRE` has two: no space bar, return; a shot already in the air, return. That second one is the whole of *one shot at a time*.

## The shot

The space bar is bit 7 of the row at `3840H`, beside the arrows: as in lesson 3, that order within the row is the one Fugløy's emulator uses, from the ROM's own keyboard routine, not a page of the manuals. `FIRE` puts the shot on row 14, just above the ship's middle cell, at `3F80H` plus the ship's column plus one.

Each turn `MOVESHOT` writes a space over the shot, takes 64 from its address, and draws it a row higher. From row 0 one row up is `3BxxH`, off the screen, and `BIT 2,H` sees it as it did in lesson 3: the shot is not drawn, and `SHOT` goes back to 0, so the space bar works again.

The ship and the shot each move once a turn, every 66 ms, so the shot climbs the screen in about a second, and the ship can move while it does.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged, a little slower at the Model I's 1.77 MHz, as in lesson 5.

## Try it

Make the shot twice as fast: in `MOVESHOT`, change `LD DE,-64` to `LD DE,-128`, and press Run. The shot now skips a row each turn, rows 14, 12, 10 and on to 0, and from there `3B80H` and up is off the screen.

Then watch the shot's address. Change it back to `-64`, set a breakpoint on the `SHOTUP:` line (click its left edge), press Run, click the screen and press the space bar. `FIRE` puts the shot at `3F9FH`, row 14 above the ship's middle, and on the next turn the program stops at `SHOTUP` with HL at `3F5FH`, a row up. Each Continue is one more turn, and HL goes down by `40H`, 64, each time.
