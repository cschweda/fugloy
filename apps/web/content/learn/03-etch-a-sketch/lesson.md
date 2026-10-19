---
title: Etch-a-sketch
idea: Reading the keyboard as memory, AND and BIT, and moving a pointer with bounds
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
---
The keyboard is memory too. The TRS-80 reads its keys as a grid of switches mapped into memory from `3800H`, one address for each row of keys and one bit for each key in the row: read the address and a bit is 1 while its key is down. There is no event and no key code, only a byte you look at whenever you like.

The rows are read at `3801H` to `3840H`, one address a row, and the row read at `3840H` holds ENTER, CLEAR, BREAK, the four arrows and the space bar. The arrows are bit 3 (up), 4 (down), 5 (left) and 6 (right): that order within the row is the one Fugløy's emulator uses, from the ROM's own keyboard routine, not a page of the manuals. This program reads that byte over and over and moves a pen:

```z80
READ:   LD      A,(3840H)       ; the arrows' row: bit 3 up, 4 down, 5 left, 6 right
        AND     78H             ; keep those four bits (0111 1000) and clear the rest
        JR      Z,READ          ; no arrow is down: read again
        LD      C,A             ; keep the keys in C, so A is free
```

Carried over: HL as a pointer into the screen, the white block `0BFH`, and the counted `BC` loop, which here becomes a delay (lesson 1); DE as a second pair, and an 8-bit register (C) holding a value while A does other work (lesson 2). New: reading the keyboard with `LD A,(3840H)`, `AND` as a mask, `BIT` to test one bit, `JR Z`, 16-bit adds with `ADD HL,DE` (and `LD DE,-64` to go back), `DEC HL`, and keeping a pointer on the screen.

In JavaScript, with memory as an array, the read is:

```js
const keys = mem[0x3840] & 0x78;   // 0 when no arrow is down
if (keys & 0x08) up();             // BIT 3,C
if (keys & 0x40) right();          // BIT 6,C
```

## AND and BIT

`AND 78H` is `a &= 0x78`: it keeps the arrow bits, clears the rest, and sets the zero flag when nothing is left, so `JR Z,READ` waits until an arrow is down. `AND` works only on A, which is why the keys move to C straight away.

`BIT 3,C` tests one bit of any register and changes nothing but the flags: Z is set when the bit is 0. `JR Z,NOTUP` skips the move when up is not pressed. Each arrow is tested in turn, so holding two at once moves the pen diagonally.

## Keeping the pen on the screen

Up and down are 64 cells, a row, so the program adds `-64` or `64` to HL with `ADD HL,DE`. To stay on the screen HL must stay in `3C00H`–`3FFFH`, and every address there has H between `3CH` and `3FH`. One row off either end gives `3BH` or `40H`, and those are the only neighbours with bit 2 of H clear:

```z80
        LD      DE,-64          ; up is one row back: 64 cells
        ADD     HL,DE
        BIT     2,H             ; on screen, H is 3CH-3FH, all with bit 2 set
        JR      NZ,NOTUP        ; still on screen
        LD      DE,64           ; off the top: step back down
        ADD     HL,DE
```

Left and right move HL by one, but must not wrap to the next row. The column is L's low six bits, `L & 0x3F`, because a row is 64 cells and starts at a multiple of 64:

```z80
        LD      A,L
        AND     3FH             ; the column is L's low six bits
        JR      Z,NOTLT         ; column 0, the left edge: stay
        DEC     HL
```

After the moves the program plots the pen and waits. The wait is lesson 1's loop with nothing in it: `BC` counts down from `1000H`, 4,096 times round, about a twentieth of a second on the Model III, so a held key moves the pen about 20 cells a second. Without it the pen would cross the screen faster than you could let go of the key.

## Keys go to the screen, not the editor

Click the TRS-80's screen before you press the arrows, so that it has the keyboard. While the editor has the focus, the arrows move its cursor, and the TRS-80 sees nothing.

## On the Model I

The Model I's keyboard is memory from `3800H` too, with the same rows, so the program runs unchanged. Fugløy runs the Model I's Z80 at 1.77 MHz and the Model III's at 2.03 MHz, so the same delay loop lasts a little longer there and the pen moves a little more slowly.

## Try it

Change `LD (HL),0BFH` under `NOTRT:` to `LD (HL),2AH` and press Run, then click the screen and hold an arrow. The trail is drawn in asterisks now, but the white block from `START` is still there where the pen began.

Then make the pen faster: change `LD BC,1000H` to `LD BC,400H`. A quarter of the delay is a quarter of the wait, and the pen crosses the screen in under a second.
