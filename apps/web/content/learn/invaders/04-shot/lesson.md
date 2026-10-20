---
title: Fire one shot that rises and disappears
idea: a 16-bit variable with DW, 0 for none, and two things moving in one loop
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
Press the space bar and the base fires: a shot leaves from just above its middle, climbs a row each turn, and is gone past the top of the screen. There is one shot at a time; while it is in the air the space bar does nothing, and the base goes on moving under it.

## What changed

Chapter 3's program, with these changes:

- **~** The comment at the top, lines 1 to 5, now describes chapter 4.
- **+** `MOVESHOT`, a new routine with its comment, below `MOVEBASE`: the shot rises a row, or is gone.
- **+** `FIRE`, a new routine with its comment, below `MOVESHOT`: the space bar starts a shot.
- **~** The game loop's comment: its last line now ends *the base, then the shot*.
- **+** `CALL MOVESHOT` and `CALL FIRE` in the loop, after `CALL MOVEBASE`.
- **+** `SHOT`, after `BASEX`: the shot's screen address, a word.

Nothing is taken out.

## Two things in one loop

The base and the shot move at once, but there are no threads and no timers: each turn the loop gives each its go, one after the other.

```z80
LOOP:   CALL    WAIT            ; the turn's pause, so the game runs at a steady speed
        CALL    MOVEBASE        ; the base moves if an arrow is down
        CALL    MOVESHOT        ; the shot, if there is one, rises a row
        CALL    FIRE            ; the space bar starts a shot, if there is none
        JR      LOOP            ; and round again, for ever
```

In JavaScript it is the loop every browser game has:

```js
let baseX = 30, shot = 0;      // BASEX: DB 30, SHOT: DW 0
function turn() {
  moveBase(); moveShot(); fire();
  setTimeout(turn, 66);        // CALL WAIT
}
```

## Where the shot is: a word

The shot's place is a screen address, `3C00H` to `3FFFH`, too big for a byte, so it is a word, two bytes, made by `DW`. 0 is not on the screen, so 0 means *no shot*:

```z80
SHOT:   DW      0               ; the shot's screen address, or 0 for none
```

A word is stored low byte first. `LD HL,(SHOT)` loads both bytes at once, the one at `SHOT` into L and the one at `SHOT+1` into H, and `LD (SHOT),HL` stores them back the same way. To test HL for 0, `LD A,H` and `OR L` make the zero flag, as the clear does with B and C.

## FIRE

```z80
FIRE:   LD      A,(3840H)       ; the space bar is bit 7 of the arrows' row
        BIT     7,A
        RET     Z               ; not down: nothing to do
        LD      HL,(SHOT)
        LD      A,H
        OR      L
        RET     NZ              ; a shot is in the air already: one at a time
```

The space bar is bit 7 of the row at `3840H`, beside the arrows: as for the arrows, that order within the row is the one Fugløy's emulator uses, from the ROM's own keyboard routine. `FIRE` has two early returns. `RET Z` returns when the space bar is up. `RET NZ` returns when the zero flag is clear, here when HL is not 0: a shot is already in the air. That second one is the whole of *one shot at a time*.

Otherwise the shot starts on row 14, just above the base's middle cell. Row 14 starts at `3F80H`, and the middle cell is the base's column plus one, so the address is `3F81H` plus `BASEX`. `BASEX` is at most 61, so `81H` plus it is at most `0BEH`, one byte, and H is always `3FH`:

```z80
        LD      A,(BASEX)       ; row 14 starts at 3F80H; the base's middle
        ADD     A,81H           ; is its column plus one: 3F81H plus BASEX
        LD      L,A
        LD      H,3FH
        LD      (HL),21H        ; draw the shot
        LD      (SHOT),HL       ; and remember where it is
```

The shot is `21H`, the exclamation mark.

## MOVESHOT

Each turn `MOVESHOT` erases the shot, moves it up a row, and draws it again, as `MOVEBASE` does for the base:

```z80
        LD      (HL),20H        ; erase the shot where it is
        LD      DE,-64          ; up a row
        ADD     HL,DE
        BIT     2,H             ; still on the screen? 3C00H-3FFFH all have bit 2 of H set
        JR      NZ,SHOTUP
        LD      HL,0            ; off the top: no shot
```

A row is 64 cells, so the cell above is 64 bytes back. The assembler writes -64 as the word `0FFC0H`, and adding it to HL wraps past `0FFFFH` to the same result as taking 64 away. `ADD HL,DE` sets no zero flag, so the program tests where HL is with `BIT 2,H`: the screen's high bytes, `3CH` to `3FH`, all have bit 2 set, and above row 0 the address is `3BxxH`, whose bit 2 is clear. Then the shot is not drawn, and `SHOT` goes back to 0, so the space bar works again.

The shot moves once a turn, about every 66 ms, so it climbs the 15 rows above the base in about a second.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows or the space bar, so that it has the keyboard.

## On the Model I

The Model I has the same keyboard row and the same screen, so the program runs unchanged, a little slower at the Model I's 1.77 MHz.

## Try it

Make the shot twice as fast: in `MOVESHOT`, change `LD DE,-64` to `LD DE,-128`, and press Run ▶. The shot now skips a row each turn, rows 14, 12, 10 and on to 0, and from there `3B80H` and up is off the screen.

Then put it back, set a breakpoint on the `SHOTUP:` line (click its left edge), press Run ▶, click the screen and press the space bar. `FIRE` puts the shot at `3F9FH`, row 14 above the base's middle, and on the next turn the program stops at `SHOTUP` with HL at `3F5FH`, a row up. Each Continue is one more turn, and HL goes down by `40H`, 64, each time.
