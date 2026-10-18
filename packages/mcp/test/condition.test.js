/** Break conditions (Ruling 2): `<reg> <op> <value>` joined by `&&`, and nothing else. */
import { describe, expect, it } from 'vitest';
import { compileCondition } from '../src/condition.js';

/** A stand-in machine: just the registers and flags a condition reads. */
function machine(regs = {}, flags = {}) {
  const r = { a: 0, f: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0, ix: 0, iy: 0, sp: 0, pc: 0, i: 0, r: 0, ...regs };
  return { cpu: { regs: r, flags: { s: 0, z: 0, h: 0, pv: 0, n: 0, c: 0, ...flags } } };
}

describe('compileCondition', () => {
  it('compares an 8-bit register with a value in the address syntax (bare digits are hex)', () => {
    const test = compileCondition('A == 0D');
    expect(test.text).toBe('A == 0Dh');
    expect(test(machine({ a: 0x0d }))).toBe(true);
    expect(test(machine({ a: 13 + 1 }))).toBe(false);
    expect(compileCondition('a==0x0d').text).toBe('A == 0Dh');
    expect(compileCondition('A != $20').text).toBe('A != 20h');
  });

  it('compares pairs, index registers, SP, and PC', () => {
    const test = compileCondition('HL >= 3C00 && HL <= 3FFF');
    expect(test.text).toBe('HL >= 3C00h && HL <= 3FFFh');
    expect(test(machine({ h: 0x3c, l: 0x40 }))).toBe(true);
    expect(test(machine({ h: 0x40, l: 0x00 }))).toBe(false);
    expect(compileCondition('DE == 7050')(machine({ d: 0x70, e: 0x50 }))).toBe(true);
    expect(compileCondition('BC < 10')(machine({ b: 0, c: 0x0f }))).toBe(true);
    expect(compileCondition('AF > 0')(machine({ a: 0, f: 1 }))).toBe(true);
    expect(compileCondition('IX == 4000 && IY == 5000 && SP == 7F00 && PC == 7030')(machine({ ix: 0x4000, iy: 0x5000, sp: 0x7f00, pc: 0x7030 }))).toBe(true);
  });

  it('reads flags as 0 or 1; C and H are the registers, CF and HF the flags', () => {
    expect(compileCondition('Z == 1')(machine({}, { z: 1 }))).toBe(true);
    expect(compileCondition('Z == 1')(machine({}, { z: 0 }))).toBe(false);
    expect(compileCondition('ZF == 1 && PV == 0 && S == 0 && N == 0')(machine({}, { z: true }))).toBe(true);
    expect(compileCondition('CF == 1')(machine({ c: 0 }, { c: 1 }))).toBe(true);
    expect(compileCondition('C == 1')(machine({ c: 0 }, { c: 1 }))).toBe(false);
    expect(compileCondition('C == 1')(machine({ c: 1 }, { c: 0 }))).toBe(true);
    expect(compileCondition('HF == 1')(machine({ h: 0 }, { h: 1 }))).toBe(true);
    expect(compileCondition('H == 3C')(machine({ h: 0x3c }))).toBe(true);
    expect(compileCondition('cf==1').text).toBe('CF == 1');
  });

  it('takes a label as a value', () => {
    const labels = new Map([[0x7030, { name: 'PRINT' }]]);
    const test = compileCondition('PC == print', labels);
    expect(test.text).toBe('PC == 7030h');
    expect(test(machine({ pc: 0x7030 }))).toBe(true);
  });

  it('refuses anything else, showing the accepted form', () => {
    const form =
      'Write <reg> <op> <value>, joined by && (such as "A == 0D && HL >= 3C00"): reg is A F B C D E H L I R, AF BC DE HL IX IY SP PC, or a flag ZF CF SF PVF HF NF (Z S PV N also work; C and H are the registers); op is == != < <= > >=; value is a number written like an address (bare digits are hex: 0D, 0x0D, $0D, 0Dh) or a label, never another register.';
    const refused = (text) => {
      try {
        compileCondition(text);
      } catch (err) {
        return err.message;
      }
      throw new Error(`accepted ${text}`);
    };
    expect(refused('A = 0D')).toBe(`The condition "A = 0D" is not understood: "A = 0D" is not <reg> <op> <value>. ${form}`);
    expect(refused('A == 0D || B == 1')).toBe(`The condition "A == 0D || B == 1" is not understood: "A == 0D || B == 1" is not <reg> <op> <value> (only && joins clauses; there is no ||, !, or parentheses). ${form}`);
    expect(refused('Q == 1')).toBe(`The condition "Q == 1" is not understood: Q is not a register or a flag. ${form}`);
    expect(refused('A == 100')).toBe(`The condition "A == 100" is not understood: A is 8 bits, so 100h (256) can never match; the most is FFh. ${form}`);
    expect(refused('Z == 2')).toBe(`The condition "Z == 2" is not understood: the flag Z is 0 or 1, not 2h. ${form}`);
    expect(refused('A == (HL)')).toMatch(/^The condition "A == \(HL\)" is not understood: "\(HL\)" is not a value: .* \(only && joins clauses; there is no \|\|, !, or parentheses\)\. Write /);
    // A register or flag name as the value is refused, never read as hex (DE is not 00DEh).
    expect(refused('HL == DE')).toBe(`The condition "HL == DE" is not understood: "DE" is a register name, not a value: values are numbers, and comparing one register or flag with another is not supported; write 0xDE for the hex constant. ${form}`);
    expect(refused('A == b')).toBe(`The condition "A == b" is not understood: "b" is a register name, not a value: values are numbers, and comparing one register or flag with another is not supported; write 0xb for the hex constant. ${form}`);
    expect(refused('A == CF')).toMatch(/: "CF" is a flag name, not a value: .*; write 0xCF for the hex constant\. /);
    expect(refused('PC == SP')).toBe(`The condition "PC == SP" is not understood: "SP" is a register name, not a value: values are numbers, and comparing one register or flag with another is not supported. ${form}`);
    expect(compileCondition('HL == 0xDE').text).toBe('HL == 00DEh');
    expect(compileCondition('A == 0B').text).toBe('A == 0Bh');
    expect(refused('  ')).toBe(`The condition is empty. ${form}`);
    expect(refused('A == 0D &&')).toBe(`The condition "A == 0D &&" is not understood: a clause is empty around &&. ${form}`);
  });
});
