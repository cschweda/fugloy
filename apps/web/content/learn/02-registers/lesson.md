---
title: The registers, and why HL
idea: A and the flags, B to L, the pairs BC, DE and HL, SP and PC
models: 3, 1
cite: m3-trm 14 the Model III's screen is video memory at 3C00H, 1,024 bytes
cite: m1-trh 12 the Model I's screen is video memory at 3C00H, 16 lines of 64 characters
---
Lesson 1 used HL as a pointer and BC as a counter without asking why those two. This lesson writes the alphabet along row 4 and a white block under each letter, and on the way it builds an address a byte at a time, so you can see what the pairs are made of.

```z80
START:  LD      H,3DH           ; H, the High byte of the address ...
        LD      L,00H           ; ... and L, the Low byte: HL is 3D00H
        LD      D,H             ; DE is a copy of HL, made a byte at a time
        LD      E,L
        LD      A,E             ; 8-bit sums go through A
        ADD     A,40H           ; E plus 40H, one row of 64 cells ...
        LD      E,A             ; ... back into E: DE is 3D40H, row 5
```

Carried over from lesson 1: `ORG 7000H`, HL as the pointer into the screen at `3C00H`, `LD (HL),...` and `INC HL`, a loop closed by `JR NZ`, and the `WAIT` loop at the end. New: setting H and L apart, a second pointer in DE, an 8-bit counter in B, and `ADD`.

## The registers

The Z80 has seven 8-bit registers you name in code, and one you mostly don't:

- **A**, the accumulator. 8-bit arithmetic and logic (`ADD`, `SUB`, `AND`, `OR`, `CP`) take one operand from A and leave the result in A. That is why lesson 1 copied B into A before it could `OR C`.
- **F**, the flags. Each instruction that computes sets some of its bits: Z when the result was zero, C on a carry or borrow, S for the sign, and a few more. `JR NZ` and its kin read F. There is no `LD F`: the flags change as a side effect of the work.
- **B, C, D, E, H, L**, six general registers, which pair up as **BC**, **DE** and **HL** for 16-bit values.

Then the two 16-bit registers that run the program: **PC**, the program counter, the address of the next instruction, and **SP**, the stack pointer, which lesson 5 uses for `CALL` and `RET`.

In JavaScript terms a pair is two bytes of one number:

```js
const hl = (h << 8) | l;   // H is the high byte, L the low byte
const h = hl >> 8, l = hl & 0xff;
```

So `LD H,3DH` and `LD L,00H` together are `LD HL,3D00H`, one byte at a time. Nothing joins them but the instructions that treat them as a pair.

## Why BC, DE and HL, and not BE

Inside an instruction each register is a 3-bit number: B is 0, C 1, D 2, E 3, H 4, L 5, the memory at HL is 6, and A is 7. `LD r,r'` is one byte, `01` then the destination's three bits then the source's: `LD D,H` is `01 010 100`, `54H`, and `LD (HL),C` is `01 110 001`, `71H`. (That order is Fugløy's own decoding table, in `packages/z80/src/tables.ts`.)

A pair is a register and its neighbour: 0 and 1, 2 and 3, 4 and 5. The pairs are fixed by those numbers, so there is a BC and a DE, but no BE.

## H for High, L for Low

The names come from the Z80's ancestors. Intel's 8008 had A, B, C, D, E, H and L, and it reached memory only through H and L, the High and Low bytes of an address. The 8080 kept that and paired B with C and D with E for 16-bit work. The Z80 ran the 8080's programs, so it kept all of it, and added IX and IY (lesson 7), a second, shadow set of A, F, B to L, and more.

That history is still in the instruction set. HL is the pointer every register can use: `LD (HL),C` stores C, and `LD B,(HL)` loads B. Through BC and DE, only A can go:

```z80
NEXT:   LD      (HL),C          ; any register can be stored where HL points
        LD      A,0BFH          ; but only A can be stored where DE points,
        LD      (DE),A          ; so the white block goes through A
        INC     HL              ; both pointers move on one cell
        INC     DE
        INC     C               ; the next letter
        DEC     B               ; one letter fewer; DEC B sets the zero flag
        JR      NZ,NEXT         ; not zero yet: the next letter
```

One more difference from lesson 1: `DEC B`, on an 8-bit register, sets the zero flag, so `JR NZ` can test it directly. `DEC BC`, on a pair, sets no flags, which is why lesson 1 needed `LD A,B` and `OR C`.

Run it: the alphabet appears along row 4, with a white bar under it on row 5.

## Try it

Change `LD H,3DH` to `LD H,3EH` and press Run. HL now starts at `3E00H`, row 8, and since DE is built from H and L, the white bar moves down with the letters, to row 9.

Then watch the registers move. Click the left edge of the `NEXT:` line to set a breakpoint and press Run: the program stops there before the first letter. Press Step eight times, once round the loop, and watch the pairs: HL goes from `3D00` to `3D01`, L moving while H stays put; DE follows it from `3D40`; and BC goes from `1A41` to `1942`, B counting the letters down from `1A`, 26, as C moves on to the next one. Continue runs to the breakpoint again, one letter at a time; click the breakpoint away and Continue to finish.
