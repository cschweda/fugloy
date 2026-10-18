# @fugloy/z80

The Z80 opcode table behind [Fugløy](https://github.com/cschweda/fugloy), a TRS-80 Model I/III
disassembler. The table is generated from the x/y/z/p/q decomposition of the opcode byte and
gives every instruction, documented and undocumented, its length, operands, T-states (taken and
not taken), and control-flow effect. No I/O and no dependencies.

```js
import { decode, formatInstruction } from '@fugloy/z80';

const bytes = [0xcd, 0x33, 0x00]; // CALL 0033H
const ins = decode((k) => bytes[k]);
console.log(ins.length, ins.cycles, formatInstruction(ins)); // 3 17 CALL 0033H
```

MIT licensed. Source, design, and the other packages: https://github.com/cschweda/fugloy
