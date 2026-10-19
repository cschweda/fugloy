---
title: Rock, paper, scissors
idea: Text from a table, a random number from R, CP, and the flags behind the jumps
models: 3, 1
cite: m3-trm 14 the Model III's keyboard is memory at 3800H-3BFFH, and its screen at 3C00H
cite: m1-trh 12 the Model I's keyboard is memory from 3800H, and its screen at 3C00H
cite: decker 64 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 26 the keyboard's rows are read at 3801H to 3840H, one address a row
cite: paay 6 the ROM's own RANDOM takes its seed from the Z80's refresh register, R
cite: decker 29 the ROM's own RANDOM takes its seed from the Z80's refresh register, R
---
A whole game this time, if a small one. Press R, P or S on the TRS-80's screen; the program picks its own move, prints both, and says who won. Press again for another round.

Carried over: the keyboard read and `AND` mask, and `BIT` to tell the keys apart (lesson 3); the screen addresses, 64 cells a row (lesson 1); `ADD HL,HL` and the pairs (lesson 2). New: copying text with `LDIR`, a table of words, `LD A,R` for a random number, `CP`, and the carry flag.

## Text is bytes in a table

There is no `print`. Text on the screen is bytes in video memory, so printing is copying bytes from the program to the screen. `DB` puts bytes in the program, and a quoted string is its characters' codes:

```z80
WORDS:  DB      'ROCK    '      ; 0: each word is padded to 8 bytes,
        DB      'PAPER   '      ; 1: so word n is at WORDS + 8n
        DB      'SCISSORS'      ; 2
        DB      'A DRAW. '      ; 3
        DB      'YOU WIN!'      ; 4
        DB      'I WIN.  '      ; 5
```

`LDIR` is the copy loop as one instruction: it copies a byte from where HL points to where DE points, moves both on, counts BC down, and repeats until BC is zero. It is lesson 1's loop, built in. To print word *n*, HL is `WORDS + 8*n`, and three `ADD HL,HL` make the times eight, each one doubling HL:

```z80
        LD      L,A             ; HL = A times 8: each word is 8 bytes
        LD      H,0
        ADD     HL,HL
        ADD     HL,HL
        ADD     HL,HL
        LD      BC,WORDS        ; plus the table's address
        ADD     HL,BC
        LD      BC,8
        LDIR
```

In JavaScript the table and the copy are:

```js
const words = ['ROCK    ', 'PAPER   ', 'SCISSORS', 'A DRAW. ', 'YOU WIN!', 'I WIN.  '];
for (let i = 0; i < 8; i++) screen[de + i] = words[n].charCodeAt(i);
```

`LDIR` uses BC, DE and HL, all three pairs, so anything the program still needs has to be somewhere else while it prints. Here the program's move and the verdict go to two bytes of memory, `MINE` and `VERDICT`, with `LD (MINE),A`. Only A can be stored at an address named like that, so the move goes through A. The program prints the same way three times, which lesson 5 turns into one routine with `CALL`.

## Waiting for a key

P, R and S are in the row read at `3804H`, as bits 0, 2 and 3 on Fugløy's keyboard. The wait is lesson 3's, with a different mask:

```z80
KEY:    LD      A,(3804H)       ; the keyboard row with P (bit 0), R (bit 2) and S (bit 3)
        AND     0DH             ; keep those three bits (0000 1101)
        JR      Z,KEY           ; none is down: read again
```

After a round the program waits at `LETGO` for the key to come up again, the same loop with `JR NZ`, so one press is one round.

## A random move from R

R is the Z80's refresh register. It counts up as instructions are fetched, by itself, and its low seven bits run from 0 to 127 and round again. The Level II ROM's own `RANDOM` takes its seed from it. Nothing about it is random, but the program reads it the moment your key is seen, and while you decide, the `KEY` loop goes round tens of thousands of times a second, so the value you get depends on when, to the microsecond, you pressed.

That gives a number from 0 to 127, and a move is 0 to 2. The remainder by 3 is a loop:

```z80
MOD3:   CP      3               ; compare with 3: carry when A is less than 3
        JR      C,GOT           ; A is 0, 1 or 2: the program's move
        SUB     3               ; otherwise take 3 away and compare again
        JR      MOD3
```

## CP and the flags

`CP 3` is `SUB 3` that throws the result away: A stays as it was and only the flags change. Z is set when A was 3, and C, the carry, when the subtraction had to borrow, which means A was less than 3. So after `CP n`:

- `JR Z` jumps when A equals n, and `JR NZ` when it does not.
- `JR C` jumps when A is less than n, and `JR NC` when it is n or more.

That is the whole of `if (a < 3)` on a Z80: a compare that sets flags, then a jump that reads one. The same carry decides who won. With rock 0, paper 1 and scissors 2, each move beats the one before it, round in a circle, so your move minus the program's, wrapped into 0 to 2, is 0 for a draw, 1 when you win and 2 when it does:

```z80
        LD      A,C             ; who won: your move minus the program's
        SUB     B               ; carry when it went below zero ...
        JR      NC,KEEP
        ADD     A,3             ; ... so add 3 back: A is now 0, 1 or 2
KEEP:   ADD     A,3             ; 3 a draw, 4 you win, 5 I win: the verdict's word
```

In JavaScript that is `(you - me + 3) % 3`, and the last `ADD A,3` turns it into the verdict's place in the table.

## On the Model I

The Model I has the same keyboard rows and the same screen, and every letter here is a capital, so the program runs unchanged.

## Try it

Make the program cheat. After `GOT:    LD      B,A`, add these lines, which always play the move that beats yours:

```z80
        LD      A,C             ; your move ...
        INC     A               ; ... plus one beats it
        CP      3               ; past scissors?
        JR      C,CHEAT
        XOR     A               ; then rock
CHEAT:  LD      B,A
```

Press Run, click the screen, and play a few rounds: `I WIN.` every time. `XOR A` is the usual way to zero A, one byte shorter than `LD A,0`.
