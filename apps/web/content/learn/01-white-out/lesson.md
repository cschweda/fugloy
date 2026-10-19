---
title: White out the screen
idea: LD, a 16-bit pointer and counter, and a loop
models: 3, 1
cite: m3-trm 14 the Model III's screen is video memory at 3C00H, 1,024 bytes
cite: m1-trh 12 the Model I's screen is video memory at 3C00H, 16 lines of 64 characters
cite: m1-trh 33 the Model I's screen is video memory at 3C00H, 16 lines of 64 characters
---
On a TRS-80 the screen is memory. The 1,024 bytes from `3C00H` to `3FFFH` are the 16 rows of 64 cells you see, one byte a cell, top left first. Store a byte there and the video circuit draws it on the next pass. There is no driver and no call to make: drawing is writing to memory.

So whiting out the screen is a loop that stores the same byte 1,024 times:

```z80
START:  LD      HL,3C00H        ; HL is the pointer: the top-left cell
        LD      BC,400H         ; BC is the counter: 400H is 1024 cells

FILL:   LD      (HL),0BFH       ; store 0BFH where HL points
        INC     HL              ; the pointer moves on one cell
        DEC     BC              ; one cell fewer to go
        LD      A,B             ; copy B into A
        OR      C               ; and OR in C: zero only when BC is
        JR      NZ,FILL         ; not zero yet: fill the next cell
```

In JavaScript, with the screen as an array, it is the loop you would write without thinking:

```js
const screen = new Uint8Array(1024); // 3C00H-3FFFH
let hl = 0;      // the pointer
let bc = 1024;   // the counter
do {
  screen[hl] = 0xbf;
  hl++;
  bc--;
} while (bc !== 0);
```

## What the lines do

`LD` is the Z80's assignment. It reads right to left: `LD HL,3C00H` puts `3C00H` in HL, and `LD A,B` copies B into A. There is no separate move, load, or store; all three are `LD`.

HL is a pointer. The Z80's registers are 8 bits, but H and L pair up as one 16-bit register that can hold any address, and the brackets in `LD (HL),0BFH` mean *the memory HL points at*, as `screen[hl]` does. `INC HL` is `hl++`.

BC is the loop counter, another pair. `400H` is 1,024, the whole screen.

The loop is a test and a jump. There is no `while`: `JR NZ,FILL` jumps back to the label `FILL` when the last result was **not zero**, and falls through when it was. The catch is that `DEC BC` changes no flags, so the jump cannot see BC reach zero by itself. `LD A,B` and `OR C` ask the question by hand: A ends up zero only when both halves of BC are zero, and `OR` sets the zero flag the jump reads.

`0BFH` is a graphics character. The codes `80H` to `BFH` draw a block of six pixels, two across and three down, one bit for each; `0BFH` has all six lit, so every cell turns solid white. `80H` is the same block with none lit.

When the loop ends, `WAIT: JR WAIT` jumps to itself forever. A program on a bare machine has nowhere to return to, so it parks, and the screen stays white.

## On the Model I

The Model I's screen is the same memory at `3C00H`, the same 16 rows of 64, and the same block characters, so the program runs on it unchanged. Switch the model and run it again: the picture is narrower, as it was on the real machine.

## Try it

Change `LD BC,400H` to `LD BC,200H` and press Run. The loop now stops after 512 cells, so only the top eight rows go white and the bottom half stays blank.

Then try `LD (HL),2AH`: 2AH is the asterisk, and the screen fills with them.
