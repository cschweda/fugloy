/**
 * Every opcode's T-states against @fugloy/z80's table (spec §10: zero deviations), both ways for
 * each conditional and repeating instruction. A DD or FD that the next byte does not use costs 4
 * T-states before it; before DD, FD, or ED the core runs it as a step of its own.
 */
import { decode } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { bare } from './bare.js';

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const isIndexPrefix = (b) => b === 0xdd || b === 0xfd;

/** What @fugloy/z80 says `bytes` costs, each lone DD or FD costing 4 before what follows. */
function reference(bytes) {
  let at = 0;
  let before = 0;
  for (;;) {
    const ins = decode((k) => bytes[at + k]);
    if (!(ins.length === 1 && isIndexPrefix(bytes[at]))) {
      return { ins, taken: before + ins.cycles, notTaken: before + (ins.cyclesNotTaken ?? ins.cycles) };
    }
    before += ins.cycles;
    at += 1;
  }
}

const FLAG = { Z: 0x40, C: 0x01, PE: 0x04, M: 0x80 };
const CONDITION = { NZ: ['Z', false], Z: ['Z', true], NC: ['C', false], C: ['C', true], PO: ['PE', false], PE: ['PE', true], P: ['M', false], M: ['M', true] };
const COUNTS_B = new Set(['DJNZ', 'INIR', 'INDR', 'OTIR', 'OTDR']);
const COUNTS_BC = new Set(['LDIR', 'LDDR', 'CPIR', 'CPDR']);

/** Registers that make `ins` jump, call, return, or repeat (`go`), or not. */
function arrange(ins, go) {
  return (cpu) => {
    cpu.registers.A = 0x55; // differs from (HL), which is 00H, so CPIR and CPDR repeat
    const cc = ins.operands.find((o) => o.kind === 'cc');
    if (cc !== undefined) {
      const [flag, setMeansTrue] = CONDITION[cc.cond];
      cpu.registers.F = setMeansTrue === go ? FLAG[flag] : 0;
    }
    if (COUNTS_B.has(ins.mnemonic)) cpu.registers.B = go ? 2 : 1;
    if (COUNTS_BC.has(ins.mnemonic)) cpu.BC = go ? 2 : 1;
  };
}

/** The core's T-states over `bytes`: one step, plus one for each lone prefix before DD, FD, or ED. */
function measure(bytes, setup) {
  const { cpu } = bare(bytes, setup);
  let steps = 1;
  for (let k = 0; isIndexPrefix(bytes[k]) && [0xdd, 0xfd, 0xed].includes(bytes[k + 1]); k++) steps++;
  const start = cpu.cycles;
  for (let n = 0; n < steps; n++) cpu.executeInstruction();
  return cpu.cycles - start;
}

/** Every opcode: unprefixed, CB, ED, DD, FD, DDCB, FDCB, with operand bytes 05 00 00. */
function sequences() {
  const all = [];
  for (let op = 0; op < 0x100; op++) {
    if (op !== 0xcb && op !== 0xed && !isIndexPrefix(op)) all.push([op, 0x05, 0x00, 0x00]);
    all.push([0xcb, op], [0xed, op, 0x05, 0x00], [0xdd, op, 0x05, 0x00, 0x00], [0xfd, op, 0x05, 0x00, 0x00]);
    all.push([0xdd, 0xcb, 0x05, op], [0xfd, 0xcb, 0x05, op]);
  }
  return all;
}

describe('T-states', () => {
  it('match @fugloy/z80 for every opcode, both ways for each conditional and repeating one', () => {
    const deviations = [];
    for (const bytes of sequences()) {
      const { ins, taken, notTaken } = reference(bytes);
      for (const [go, want] of [[true, taken], [false, notTaken]]) {
        let got;
        try {
          got = measure(bytes, arrange(ins, go));
        } catch (e) {
          got = `threw ${e.message}`;
        }
        if (got !== want) deviations.push(`${hex(bytes)} ${ins.mnemonic}${go ? '' : ' (not taken)'}: core ${got}, z80 ${want}`);
      }
    }
    expect(deviations).toEqual([]);
  });

  it("ADC, SBC, AND, XOR, OR, and CP on (HL) take 7, not the register forms' 4", () => {
    for (const op of [0x8e, 0x9e, 0xa6, 0xae, 0xb6, 0xbe]) {
      expect(bare([op]).cpu.executeInstruction(), hex([op])).toBe(7);
    }
  });
});
