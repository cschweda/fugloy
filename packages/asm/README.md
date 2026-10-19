# @fugloy/asm

A Z80 assembler for the TRS-80, meant to be EDTASM made easy. It turns source
into a memory image, an entry point, a symbol table, a source map, and a
`.CMD` program. Errors sit on the line that caused them, as sentences that
say what to change. ROM routines can be called by name without defining
them. On every source the Fugløy disassembler produces, it builds the same
bytes as [zmac](http://48k.ca/zmac.html), byte for byte.

It is TypeScript compiled to plain ESM, with no DOM, no Node APIs, and no
runtime dependencies beyond `@fugloy/z80` and `@fugloy/disasm`, so it runs in
a browser as well as in Node. It is part of the Fugløy core (`@fugloy/z80`,
`@fugloy/disasm`, `@fugloy/asm`, `@fugloy/cli`), which is released at one
version.

- [Quick start](#quick-start)
- [The starter program](#the-starter-program)
- [Syntax](#syntax)
- [ROM, hardware, and DOS names](#rom-hardware-and-dos-names)
- [Messages](#messages)
- [Stricter than zmac](#stricter-than-zmac)
- [API](#api)
- [How it is built and checked](#how-it-is-built-and-checked)

## Quick start

From the command line (`@fugloy/cli`):

```sh
fugloy asm game.z                      # writes game.cmd beside it
fugloy asm game.z -o out/game.cmd      # or where -o says
fugloy asm game.z --model 1            # Model I ROM names (the default is the Model III)
fugloy asm game.z --dos trsdos         # TRSDOS 1.3 names as well
fugloy asm game.z --listing            # print the listing too
```

`fugloy asm` takes the place of disassembling a file named `asm`; to
disassemble one, write `fugloy ./asm`. Naming `--model` also tells the
assembler which machine the program is for, which quiets the Model I/III
warning to a note (see [ROM names](#rom-hardware-and-dos-names)).

Every diagnostic goes to stderr as `file:line:col: severity: message`, the
form editors and terminals link to:

```text
bad.z:2:2: error: Unknown instruction LDA. Did you mean LD A,…?
bad.z:3:7: error: CLSS is not defined. Did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)?
bad.z:4:5: error: JR reaches 128 bytes either way; FAR is 200 bytes ahead. Use JP.
fugloy asm: 3 errors; no .CMD written
```

The exit code is 0 when the program assembled (warnings and notes allowed),
1 when the source has an error or a file cannot be read or written, and 2
for a usage error. With no error it prints a summary such as
`clear-screen.cmd: 1 block, 16 bytes, $7000-$700F, entry $7000`. With
`--listing`, the listing goes to stdout and the summary to stderr. The
listing shows the line number, the address (`run@load` under `.PHASE`, `=`
and the value on an EQU line), up to sixteen bytes, and the source line.

From code:

```ts
import { assemble, toCmd } from '@fugloy/asm';

const result = assemble(source, { model: 3 });
for (const d of result.diagnostics) console.log(`${d.line}:${d.column}: ${d.severity}: ${d.message}`);
if (result.ok) {
  const cmd = toCmd(result); // a Uint8Array, ready to save or to load on @fugloy/emu
}
```

## The starter program

[`examples/clear-screen.z`](examples/clear-screen.z) is the program a new
source starts from. It fills video memory, `$3C00` to `$3FFF`, with spaces,
then jumps to itself forever, so the screen stays blank. Every line has a
plain comment:

```asm
        ORG     7000H           ; put the program at address 7000H, in free memory

START:  LD      HL,3C00H        ; HL points at the first character of the screen (top left)
        LD      BC,400H         ; BC counts the characters left: 400H is 1024, 16 rows of 64

FILL:   LD      (HL),20H        ; put a space (character code 20H) where HL points
        INC     HL              ; move HL along to the next character
        DEC     BC              ; one character fewer to do
        LD      A,B             ; is BC zero yet? copy B into A ...
        OR      C               ; ... and combine it with C: A is zero only if B and C both are
        JR      NZ,FILL         ; not zero: go back to FILL and blank the next character

WAIT:   JR      WAIT            ; all done: jump to this same line forever

        END     START           ; the program starts running at START
```

Its test assembles it, checks the bytes against zmac's, and runs it on
`@fugloy/emu`: on a synthetic ROM in CI, and on the real Model III and Model I
ROMs when `fugloy.mcp.json` names them. Each run must leave the screen blank.

## Syntax

The syntax is zmac's, for everything below. Where zmac's rule was unclear, a
probe against the pinned zmac decided it, and each probe is a test
(`test/zmac-probes.test.ts`).

**Lines.** A line is an optional label, an operation, operands separated by
commas, and an optional comment from `;` to the end of the line. Mnemonics,
registers, directives, and names are case-insensitive: `Loop`, `loop`, and
`LOOP` are one label. Lines end in LF or CRLF.

**Labels.** A label ends with a colon anywhere on the line, or it starts in
column 1 without one. A word in column 1 is a label, except an instruction
alone (`ret` in column 1 is RET). An instruction with operands in column 1
is an error, since zmac would read it as a label. `EQU`, `DEFL`, and `=` take
a name with or without a colon. Register and condition names (`A`, `HL`,
`NZ`, ...) and the operator words (`HIGH`, `LOW`, `MOD`, `SHL`, `SHR`) cannot
be labels. `$` may appear in names: `$KBWAIT`, `KB$`, `A$B`.

**Numbers.** Decimal `255`; hex `0FFH`, `$FF`, or `0xFF` (a hex number with
an H must start with a digit); binary `1010B`; octal `17O` or `17Q`;
characters `'A'`, with `''` for a quote inside (`'it''s'`). `$` alone is the
address of the line. `$` followed by hex digits only is a number; `$`
followed by other name characters is a name. Numbers are 32-bit, as in zmac:
`0FFFFFFFFH` is -1, and a number past 32 bits is an error.

**Expressions.** `+ - * / MOD % & | ^ ~ << >> SHL SHR`, unary `+ - ~ HIGH
LOW`, and parentheses. The precedence is zmac's, which is C's: from loosest,
`|`, `^`, `&`, shifts, `+ -`, then `* / % MOD`, then the unary operators.
Division truncates toward zero, and MOD takes the sign of the dividend.
Shifts work on 32 bits, and `>>` and `SHR` are logical, as in zmac:
`-1>>31` is 1. A shift count runs from 0 to 31. `%1010` is MOD, not binary.

**Parentheses.** An operand that is entirely in parentheses is a memory
operand where the instruction has a memory form there: `LD A,(3C00H)` reads
memory. Inside a larger expression, parentheses only group: `LD A,(5)+1` is
`LD A,6`. Where the instruction has no memory form (`SUB (5)`, `CALL (5)`),
zmac reads the parenthesised number as the number itself. asm gives the
same bytes and warns that the parentheses only group. `JP (1234H)` is an
error, since it does not read memory there. `LD` never falls back to the
number.

**Optional A.** `SUB A,n`, `AND A,n`, `OR A,n`, `XOR A,n`, and `CP A,n` may
name A; `ADD n`, `ADC n`, and `SBC n` may leave it out. zmac accepts both
spellings.

**Directives.**

| Directive | What it does |
| --- | --- |
| `ORG addr` | Places what follows at `addr`. ORGs may go down as well as up, and leave gaps. |
| `name EQU value` | Defines a constant. It may be repeated with the same value, never with another. |
| `name DEFL value`, `name = value` | Defines a name that may be redefined; each use takes the definition above it, and a use above every definition takes the last one, as zmac does. |
| `DB`, `DEFB`, `DEFM` | Bytes and strings, mixed: `DB 'HELLO',0DH,0`. In DB and DW, `$` is the address of each value. |
| `DW`, `DEFW` | Words, low byte first. |
| `DS count[,fill]`, `DEFS` | Reserves bytes. With no fill it leaves a gap (nothing is loaded there); the fill is 0 to 127, as zmac requires. |
| `.PHASE addr` / `.DEPHASE` | Assembles code to run at `addr` while its bytes load where the program is: labels, `$`, and relative jumps use the run address. Under `.PHASE`, a DS with no fill writes zeros, as zmac does. |
| `END [entry]` | Ends the source; the lines after it are listed but never read. The entry is where the program starts. |

zmac's other rules that asm follows: a label on an ORG line takes the
address before the ORG (asm warns and says how to name the new address); a
label on `.PHASE` takes the load address and one on `.DEPHASE` the run
address; a `.PHASE` left open at the end is accepted.

**Defaults.** With no ORG at all, the program starts at `$5200` and an info
note says so. With an ORG later in the source, code before it is an error
(zmac would put it at `$0000`, in the ROM). With no END entry, `entry` is
null, as zmac gives it; the workbench runs such a program from its first
assembled byte, and `toCmd` writes that address as the transfer address so
the file runs (see [API](#api)).

Not in this version: macros, `INCLUDE`, and conditional assembly.

## ROM, hardware, and DOS names

The model's ROM and hardware names, from the disassembler's cited symbol
tables, are predefined. With the `dos` option, that DOS's names are too.

| Option | Names |
| --- | --- |
| `model: 3` (the default) | Model III ROM and hardware |
| `model: 1` | Model I ROM and hardware |
| `model: 4` | the LS-DOS 6 service calls (`@KEY` is 1, for `LD A,@KEY` then `RST 28H`), and the Model III ROM and hardware, since the Model 4 runs Model III programs in Model III mode |
| `dos: 'trsdos'` | TRSDOS 1.3 (Model III only) |
| `dos: 'ldos'` | LDOS 5.1 for the chosen model |
| `dos: 'none'` (the default) | no DOS names |

A port's name is its number (`OUT (CASSETTE),A`), a service call's name is
its number, and every other name is its address. Those are the values the
disassembler's EQUs give them.

The names have the lowest priority (Ruling 5 of the plan). A definition in
the source (a label, an EQU, a DEFL) of the same name wins, with no message,
whatever its value. So a disassembly's own `$VDCLS EQU 01C9H` is not an
error, and neither is a game that calls its own routine `$KBWAIT`. A name
the source never defines that a table has resolves to the table's value. The
symbol table lists the table names a source used, with kind `rom` and line 0.

```asm
        ORG     7000H
        CALL    $VDCLS          ; the ROM's clear-screen routine, $01C9 on both machines
        CALL    KBDRIVER        ; $3024 on the Model III, $03E3 with model: 1
```

**The Model I/III note.** Four addresses have different code in the two
ROMs, as the tables' comparison classes them (`$0050`, `$01D9`, `$0212`,
`$03C2`; see `packages/disasm/data/symbols/COMPARISON.md`). An instruction
that uses one as a number draws a note naming both meanings, with the chosen
model's first. That covers a CALL or JP target and a memory address in
parentheses. An IN or OUT port is not an address, and is never noted. A
predefined ROM name is never noted either: `CALL $RSRCV` took its meaning
from the chosen model's table, and on the Model I `$RSRCV` is not defined
at all.

The note's severity depends on whether a model was named:

- With no `model` (and no `--model` on the command line), it is a
  **warning**, since the address may have been copied from the other
  machine's listing:

  ```text
  warning: $0050 means different things in the two ROMs: on the Model III it is $RSRCV (receive a character from the RS-232-C port; zero means none arrived), on the Model I CTRLCHARTAB (table of the control codes for ENTER, CLEAR, BREAK, the arrow keys, and space: eight two-byte entries). No model was chosen, so the program is assembled for the Model III, and this line is right for it only; choose the model the program is for.
  ```

- With a model named, it is an **info** note with the same meanings, ending
  `This line is right for the Model III only.`, so the program assembles
  with no warning, and the fact is still there, on hover in an editor for
  example.

Either way it has `code: 'rom-difference'`, so a caller can tell it apart.
The disassembler's round-trip harness names the model, so it sees only the
info note, and it still refuses every warning.

## Messages

Every diagnostic has `line` (1-based), `column`, `endColumn` (just past the
last character it is about), `severity` (`error`, `warning`, or `info`), and
`message`, a sentence naming the problem and, where it can, the fix.
Assembly carries on past an error, so every error in the program shows at
once. Only a result with no error has an image.

When the message gives an exact rewrite, the diagnostic also carries it as
`fix: { line, column, endColumn, replacement }`: replace columns `column` up
to (not including) `endColumn` of `line` with `replacement`, and the line
says what the message asked for. An editor can offer it as a one-click fix.
Every rewrite in the table below has one, and so do `JP (1234H)`, the
parentheses-only-group warning, `FFH`, `$FFH`, `%1010`, `0b101`, `MOV`, and
an instruction in column 1. A message whose rewrite leaves a part for the
writer to choose (`write JP M,label`) has none.

**An instruction with no operands** says what it needs, with a form to copy:

- `DJNZ needs a target: write DJNZ label.`
- `LD needs operands: write LD A,number, for example.`
- `RST needs a restart address, one of 0, 8, 10H, 18H, 20H, 28H, 30H, and 38H: write RST 28H, for example.`

**Unknown instructions** get the nearest mnemonics by edit distance, and a
register glued to a mnemonic is split off:

- `Unknown instruction JMP. Did you mean JP?`
- `Unknown instruction LDA. Did you mean LD A,…?`
- `Unknown instruction INCA. Did you mean INC A?`
- `Unknown instruction FOO. If FOO is a label, start it in column 1 or end it with a colon.`
- `MOV is the 8080's name for what the Z80 calls LD: write LD A,(HL).` (for `MOV A,M`; `MVI` too)
- `Fugløy does not support conditional assembly (IF) yet; keep the lines you want and delete the rest.` (and the like for `MACRO`, `REPT`, and `INCLUDE`)
- `NOP is an instruction, not a value; put one instruction per line.` (for `NOP NOP`)

**Operand forms the instruction does not have** list the forms it does have,
in words (`label`, `number`, `(address)`, `(port)`, `(IX+offset)`) rather
than the Zilog manual's `nn`, `n`, `d`, and `p`:

- `PUSH has no form (5). Its forms are AF, BC, DE, HL, IX, and IY.`
- `LD has no form HL,(BC). The forms that start with HL are HL,(address) and HL,number.`
- `Only A can be loaded from an address; use LD A,(3C00H) then LD B,A.`
- `JP (1234H) jumps to 1234H; it does not read an address from memory there. Write JP 1234H.`

Spellings that zmac reads but the Z80 tables do not give get the exact
rewrite, which assembles to the bytes zmac gives the original:

| Written | Message |
| --- | --- |
| `IN 38H` | `IN needs A and the port in parentheses: write IN A,(38H).` |
| `OUT (12H)` | `OUT needs the port in parentheses and then A: write OUT (12H),A.` |
| `JP HL` | `JP HL jumps to the address in HL, which Z80 assembly writes in parentheses: write JP (HL).` |
| `PUSH A` | `PUSH works on register pairs, and A is the 8080's short name for AF: write PUSH AF.` |
| `PUSH AF'` | `PUSH works on AF, not the shadow AF': write PUSH AF.` |
| `ADD M` | `M is the 8080's name for the byte HL points at: write ADD A,(HL).` |
| `RL (IX+5),B` | `RL (IX+5),B is undocumented: it works on the byte at IX+5 and also copies the result into B. Fugløy writes it as data, so write DB 0DDH,0CBH,05H,10H.` |
| `IN (C)` | `IN (C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.` |
| `OUT 0FFH,A` | `OUT needs the port in parentheses: write OUT (0FFH),A.` (zmac refuses it too) |

**Values out of range** name the value and the limit, and never truncate:

- `JR reaches 128 bytes either way; LOOP is 303 bytes back. Use JP.` (DJNZ says `Use DEC B and JP NZ.`)
- `LD A,n takes a byte, -128 to 255; 300 ($012C) is out of range.`
- `The displacement in (IX+d) runs from -128 to 127; 200 ($C8) is out of range.`
- `IM takes 0, 1, or 2; 3 is not one of them.`
- `BIT takes a bit number from 0 to 7; 8 is out of range.`
- `RST takes 0, 8, 10H, 18H, 20H, 28H, 30H, or 38H; 1 is not one of them. zmac reads RST 1 as RST 8; write RST 8 if that is what you mean.`
- `DS fills with a byte from 0 to 127, as zmac requires; 200 ($C8) is out of range. Write the bytes with DB instead.`

**Names:**

- `CLSS is not defined. Did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)?` (the source's own names are suggested first, then the predefined ones)
- `$RSINIT is not defined. $RSINIT is a Model III ROM name, and this program is assembled for the Model I.`
- `$JP2DOS is not defined. $JP2DOS is a TRSDOS 1.3 name; choose TRSDOS 1.3 as the DOS to use it.`
- `FFH is not defined. A hex number must start with a digit: write 0FFH.`
- `$FFH is not defined. A hex number takes $ or H, not both: write $FF or 0FFH.`
- `X is defined twice, on lines 2 and 3. Rename one of them.`
- `K is defined twice with different values, 5 on line 2 and 6 on line 3. Rename one of them.`
- `X is defined in terms of itself: X → Y → X.`
- `HL is a register name, so it cannot be a label.`

**A service call or port used as a place.** A service call or port name is
a number. As a CALL, JP, JR, or DJNZ target, or as a memory address in
parentheses, it is an error, though it would assemble:

- `@CLS is an LS-DOS 6 service call number (105), not an address: to make the call, write LD A,@CLS then RST 28H.` (`CALL @CLS` on the Model 4)
- `CASSETTE is a port number (255 ($FF)), not an address: read it with IN A,(CASSETTE) or write it with OUT (CASSETTE),A.`
- `CLS is not defined. @CLS is an LS-DOS 6 service call, which only the Model 4 has. On the Model III, did you mean $VDCLS, the Model III ROM routine at $01C9 (clear the screen)?` (`CALL CLS` on the Model III; on the Model 4 the routine comes first, then how a service call is made)

**Forward references that would move addresses.** DS, ORG, and `.PHASE`
take only names defined above them, since the addresses after the line
depend on the value:

- `DS cannot use N before N is defined, because the addresses after this line depend on it. Define N above the DS.`

**Reading the line:**

- `A comma is missing between A and B.`
- `LD starts in column 1, where a word is a label. Put a space or tab before it.`
- `This string has no closing '.`
- `This string holds é, which is not plain ASCII; write its code as a number instead.`
- `0FFFFFFFFFH is too large: numbers have 32 bits, at most 0FFFFFFFFH (4294967295).`
- `This expression divides by zero.`
- `This line comes before the first ORG, so zmac would put it at $0000. Put the ORG first.`

**Warnings** (the program still assembles, to zmac's bytes):

- `ADD A,(5) reads as ADD A,5: ADD has no form that reads memory there, so the parentheses only group. Write ADD A,5 to say so. To use the byte at address 5, point HL at it: LD HL,5 then ADD A,(HL).`
- `Line 4 writes over $6000, which line 2 already filled; the later bytes win, as in zmac.`
- `LA is $6000, the address before this ORG, as in zmac. To name $7000, put LA on the line after the ORG.`
- the Model I/III note above, when no model is named.

**Info:**

- `There is no ORG, so the program starts at $5200.`
- `There is no END entry, so a .CMD of this program starts at its first byte, $6000, where this line loads; but it is assembled to run at $4000. Name the start with END, as in END START.` (the first assembled line is under `.PHASE`; see `toCmd`)
- the Model I/III note, when a model is named.

## Stricter than zmac

asm refuses some sources that zmac accepts. In each case zmac's reading is
a likely slip, or a spelling outside the Z80 tables. asm never gives
different bytes from zmac: it gives the same image, or an error. The
disassembler never writes any of these, so the round trip is unaffected.
Each is pinned in `test/zmac-probes.test.ts` against the pinned zmac, with
zmac's own bytes wherever zmac assembles the source.

| zmac accepts | zmac does | asm, and why |
| --- | --- | --- |
| `RST 1` to `RST 7` | assembles RST 8 to 38H | error naming what zmac would do: a number that is not a restart address is almost always a slip |
| `JP 65536` | wraps to `JP 0` silently (though `LD HL,65536` is an error) | error: every word is range-checked alike |
| `HL`, `NZ`, `IX`, `AF`, `I` as labels | takes them as labels | error: no operand can then be ambiguous |
| `DB 'AB'+1` | stores 42H 42H | error: a string of more than one character in an expression is refused, not guessed at |
| a decimal number from 2^32 up to some bound | wraps it silently | error, as for hex, octal, and binary past 32 bits, which zmac also refuses |
| `LAB: DB LAB`, `DB 2*$` | stores the low byte with no range check | error: every DB value is range-checked; write `LOW LAB` |
| code before the first ORG, with an ORG later | places it at `$0000`, in the ROM | error asking for the ORG first |
| a forward EQU, or a DEFL defined lower down, in DS, ORG, or `.PHASE` | sizes it from its extra passes | error: the addresses after the line depend on the value, so it must be defined above |
| `X EQU Y` / `Y EQU X` | resolves it without a message | error naming the loop |
| characters outside ASCII in a string | stores the file's UTF-8 bytes | error asking for the code as a number |
| `IN (C)`, `IN F,(C)`, `OUT (C),0` | ED 70H, ED 71H | error giving the DB: the Z80 tables keep these undocumented forms as DB |
| `IN 38H`, `OUT (12H)` | `IN A,(38H)`, `OUT (12H),A` | error with the rewrite: the tables give only the forms with A |
| `JP HL`, `JP IX`, `JP IY` | `JP (HL)` and so on | error with the rewrite |
| `PUSH A`, `POP B`, `PUSH H`, `PUSH AF'` | the pair (`AF`, `BC`, `HL`, `AF`) | error with the rewrite: 8080 names, and AF' is not a form |
| `ADD M`, `ADC M`, `SUB M`, `SBC M`, `CP M` | the 8080's M for `(HL)` | error with the rewrite |
| `RL (IX+5),B` and the other DD CB / FD CB copies to a register | the undocumented copy | error giving the DB: the tables keep them as DB |
| `$?`, `$A?`, `1?H` | reads `?` as the hex digit F | error: `?` is not a hex digit |
| `MOV A,B`, `MOV M,A`, `MVI A,5` | the 8080's names for LD | error with the rewrite: `LD A,B`, `LD (HL),A`, `LD A,5` |
| a shift count outside 0 to 31 (`1<<32`, `-1>>32`, `7>>-1`) | wraps or saturates, as its C compiler happens to (`1<<32` is 1, `-1>>32` is 0) | error: a shift count runs from 0 to 31 |
| `-80000000H/-1` or `-80000000H MOD -1` | undefined in its C `int`: traps on x86, wraps on ARM | error: the division overflows 32 bits |

asm also warns in two places where zmac is silent: an ORG over bytes
already placed, and a label on an ORG line. The bytes and the label's value
are zmac's.

## API

### `assemble(source, options?)`

```ts
function assemble(source: string, options?: AsmOptions): AsmResult;

interface AsmOptions {
  model?: 1 | 3 | 4;              // default 3
  dos?: 'trsdos' | 'ldos' | 'none'; // default 'none'
}
```

A model and DOS with no tables (`model: 1` with `trsdos`, `model: 4` with
any DOS, an unknown model) throws a `RangeError` with a sentence. The source
itself never throws: its problems are diagnostics.

```ts
interface AsmResult {
  ok: boolean;                    // no error diagnostics
  image: MemoryImage | null;      // @fugloy/disasm's 64K image with its load bitmap; null unless ok
  entry: number | null;           // END's entry; null without one, or unless ok
  symbols: Map<string, SymbolInfo>; // by name as first written: { value, line, kind: 'label' | 'equ' | 'defl' | 'rom' }
  symbol(name: string): SymbolInfo | undefined; // the same, looked up in any case
  sourceMap: SourceMap;
  listing: ListingLine[];         // every source line: { line, address, load, bytes, text, value? }
  diagnostics: Diagnostic[];      // sorted by line: { line, column, endColumn, severity, message, code?, fix? }
}
```

Names are case-insensitive, as in zmac: `Loop`, `loop`, and `LOOP` are one
name. `symbols` keeps each name as first written, so `symbols.get('loop')`
misses a label written `Loop`; `symbol('loop')` finds it, as the assembler
would, and is what an editor's hover or go-to-definition should use.

`ListingLine.address` is where the line runs (the `.PHASE` address under
`.PHASE`), `load` is where its bytes load, and both are null for a line that
takes no space. `value` is set on EQU, DEFL, and `=` lines. A DEFL name's
symbol reports its last value, as zmac's symbol table does.

### The source map

Keyed by run address, so the line the PC is on can be found under `.PHASE`
too:

- `lineOf(address)`: the line that emitted code at `address`, or null. Where
  several did, this is the first in source order.
- `linesOf(address)`: every line that emitted code at `address`, in source
  order, each with the bytes it emitted from there on (`{ line, bytes }`).
  Several lines share a run address when a relocating loader moves a block
  over its own code, or an ORG goes back over earlier bytes. To know which
  line is running, pick the candidate whose bytes match current memory.
- `addressesOf(line)`: every run address the line emitted code at.

### `toCmd(result, options?)`

```ts
function toCmd(result: AsmResult, options?: { name?: string; entry?: 'run' | 'source' }): Uint8Array;
```

The program as a `.CMD`, through `@fugloy/disasm`'s `writeCmd`: an optional
`05` name record (at most 8 printable ASCII characters), the loaded runs as
`01` records (phased code where it loads), and a `02` transfer record. The
transfer address is END's entry or, with no entry, the address of the first
byte the source assembles (in source order, not the lowest address). DOS and
the emulator refuse a `.CMD` with no `02` record, so every file this writes
runs. If that first byte is under `.PHASE`, the file starts where the code
loads, though the code is assembled to run elsewhere; `assemble` gives an
info note on that line, and `END <label>` fixes it. `entry: 'source'` writes
`03 00` instead when there is no END entry,
the shape zmac's own output reads as; the round-trip harness uses it. A
result with errors, or with no bytes, throws a sentence.

### Also exported

`encode`, `lengthOf`, `forms`, and `mnemonics` (the table-driven encoder);
`romNames(model, dos)`, `romDifference(address)`, and `differentAddresses()`
(the predefined names and the Model I/III comparison); `selectionProblem(model,
dos)` (the sentence for a model and DOS with no tables, or undefined); `DEFAULT_ORIGIN`
(`$5200`) and `DEFAULT_MODEL` (3); and the types.

## Speed

Measured on the built `dist` with Node 22 on the development Mac (an Apple
silicon laptop), median of 20 runs, on a generated source of labels, EQUs,
DEFL, IX operands, ROM names, DB strings, DW of `$`, and comments:

| Case | Median |
| --- | --- |
| Module load (the encoder's index built from the tables) | 28 ms, once |
| First `assemble` of 3,000 lines (cold JIT) | 28 ms |
| 3,000 lines, clean | 11 ms |
| 3,000 lines with 62 undefined-name errors (7 names) | 11 ms (was 198 ms) |
| 3,000 lines with 375 undefined-name errors | 13 ms (was 1,149 ms) |
| 300 lines, clean | 0.9 ms |

An undefined name's suggestion is searched for once per name and context,
and the edit distance skips names too far off in length and reuses its
rows, so a deleted label used 60 times costs one search, not 60.
`test/speed.test.ts` checks the 62-error case: the best of ten runs must stay under 60 ms, a wide margin over the 11 ms here for a busy test machine, and far below the old 198 ms.

## How it is built and checked

- **The encoder** inverts `@fugloy/z80`'s generated opcode tables at load
  time, so an instruction's bytes and length come from the same entries the
  disassembler decodes with. Nothing in asm names an opcode. Pass 1 sizes
  every line from its template alone, so no value can change a length.
- **zmac is the referee.** The disassembler's round-trip harness runs asm as
  well as the pinned zmac on every source it assembles. That covers the
  1,786-encoding table, the fixtures, the hint and symbol round trips, the
  real programs, and the ROMs. asm must give zmac's 64K image, runs, and
  entry, with no warning, when it is given the machine and DOS the source
  was named for (the Model III unless the test says otherwise; naming it
  makes the Model I/III note info). Without zmac, asm alone is checked against the program that
  went in.
- **`pnpm asm:corpus`** runs every real program on the machine (in
  `examples/`, `fixtures/real/`, and `sample/`) through the disassembler and
  both assemblers. It runs each one twice: named with the Model III and
  TRSDOS tables, then with the Model I and LDOS tables. It prints a table and
  exits 1 on any mismatch. Locally: 85 programs and 3 hinted runs, 88 rows,
  all the same as zmac under both, with 1,146 EQUs redefining a table name.
- **The negative grid** (`test/negative.test.ts`, zmac-gated) runs every
  mnemonic with no, one, and two operands drawn from 38 kinds, about 100,000
  lines. Every line zmac flags is an asm error on that line. The lines only
  asm refuses fall in the stricter classes above. Whole programs zmac
  rejects are rejected too, with the error on the line zmac flags.
