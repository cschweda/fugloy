/**
 * Coverage and callers (spec §7), on synthetic ROMs. EXEC marks instruction starts and OPERAND
 * their other bytes (phase 3 Ruling 1); fetches are never READ (Ruling 2); coverage and callers
 * share one switch (Ruling 6); every callers edge carries its count (Ruling 8).
 */
import { describe, expect, it } from 'vitest';
import { COVERAGE, Machine } from '../../src/index.js';

const { EXEC, OPERAND, READ, WRITE, JUMP_TARGET, CALL_TARGET } = COVERAGE;

/** A Machine over a synthetic ROM holding `code` at $0000 (an object of address → bytes places more). */
function machine(code) {
  const rom = new Uint8Array(0x3800);
  if (Array.isArray(code)) rom.set(code, 0);
  else for (const [addr, bytes] of Object.entries(code)) rom.set(bytes, Number(addr));
  return new Machine({ roms: { level2: rom } });
}

/** The addresses whose coverage has `bit` set, ascending. */
function marked(m, bit) {
  const out = [];
  const bits = m.debug.coverage.bits;
  for (let a = 0; a < 0x10000; a++) if (bits[a] & bit) out.push(a);
  return out;
}

// The main program: a data read, a store, CALL, JR, JP (HL), RST (whose handler jumps into the
// CALL's subroutine), and a JP NZ taken twice and not taken once; then a JP NZ never taken.
const PROGRAM = {
  0x0000: [
    0x31, 0x00, 0x80, //       0000  LD SP,8000H
    0x21, 0x50, 0x00, //       0003  LD HL,0050H
    0x7e, //                   0006  LD A,(HL)       reads the table at $0050
    0x32, 0x00, 0x50, //       0007  LD (5000H),A
    0xcd, 0x30, 0x00, //       000A  CALL 0030H
    0x18, 0x02, //             000D  JR 0011H
    0x76, 0x76, //             000F  (never run)
    0x21, 0x20, 0x00, //       0011  LD HL,0020H
    0xe9, //                   0014  JP (HL)
  ],
  0x0020: [
    0xff, //                   0020  RST 38H
    0x06, 0x03, //             0021  LD B,3
    0x05, //                   0023  DEC B
    0xc2, 0x23, 0x00, //       0024  JP NZ,0023H     taken twice, then not
    0xc2, 0x40, 0x00, //       0027  JP NZ,0040H     never taken
    0x76, //                   002A  HALT
  ],
  0x0030: [0xc9], //           0030  RET
  0x0038: [0xc3, 0x30, 0x00], // 0038 JP 0030H
  0x0050: [0x01, 0x02, 0x03], // 0050 the table
};

const STARTS = [0x00, 0x03, 0x06, 0x07, 0x0a, 0x0d, 0x11, 0x14, 0x20, 0x21, 0x23, 0x24, 0x27, 0x2a, 0x30, 0x38];
const OPERANDS = [0x01, 0x02, 0x04, 0x05, 0x08, 0x09, 0x0b, 0x0c, 0x0e, 0x12, 0x13, 0x22, 0x25, 0x26, 0x28, 0x29, 0x39, 0x3a];

function runProgram() {
  const m = machine(PROGRAM);
  m.debug.coverage.enable();
  expect(m.run({ until: 'halt' }).reason).toBe('halt');
  return m;
}

describe('coverage', () => {
  it('marks instruction starts EXEC and their other bytes OPERAND', () => {
    const m = runProgram();
    expect(marked(m, EXEC)).toEqual(STARTS);
    expect(marked(m, OPERAND)).toEqual(OPERANDS);

    // LD IX,5000H / LD A,(IX+5) / HALT: the indexed load is one EXEC byte and two OPERAND bytes.
    const ix = machine([0xdd, 0x21, 0x00, 0x50, 0xdd, 0x7e, 0x05, 0x76]);
    ix.debug.coverage.enable();
    ix.run({ until: 'halt' });
    expect(marked(ix, EXEC)).toEqual([0x00, 0x04, 0x07]);
    expect(marked(ix, OPERAND)).toEqual([0x01, 0x02, 0x03, 0x05, 0x06]);
    expect(marked(ix, READ)).toEqual([0x5005]);
  });

  it('marks data reads and writes, never fetches', () => {
    const m = runProgram();
    // The table read, and the stack: two RETs pop $7FFE/$7FFF; the CALL and the RST push there.
    expect(marked(m, READ)).toEqual([0x0050, 0x7ffe, 0x7fff]);
    expect(marked(m, WRITE)).toEqual([0x5000, 0x7ffe, 0x7fff]);
  });

  it('marks jump and call targets only when taken', () => {
    const m = runProgram();
    // JR, JP (HL), JP NZ taken, and the two RETs' return addresses; never $0040 (JP NZ not
    // taken) nor $0027 (where the first JP NZ fell through).
    expect(marked(m, JUMP_TARGET)).toEqual([0x000d, 0x0011, 0x0020, 0x0021, 0x0023, 0x0030]);
    expect(marked(m, CALL_TARGET)).toEqual([0x0030, 0x0038]);
  });

  it('records callers with counts, ret-to included', () => {
    const m = runProgram();
    const c = (addr) => m.debug.callers(addr);
    expect(c(0x0030)).toEqual([
      { from: 0x000a, kind: 'call', count: 1 },
      { from: 0x0038, kind: 'jp', count: 1 },
    ]);
    expect(c(0x000d)).toEqual([{ from: 0x0030, kind: 'ret-to', count: 1 }]);
    expect(c(0x0011)).toEqual([{ from: 0x000d, kind: 'jr', count: 1 }]);
    expect(c(0x0020)).toEqual([{ from: 0x0014, kind: 'jp', count: 1 }]);
    expect(c(0x0038)).toEqual([{ from: 0x0020, kind: 'rst', count: 1 }]);
    expect(c(0x0021)).toEqual([{ from: 0x0030, kind: 'ret-to', count: 1 }]);
    expect(c(0x0023)).toEqual([{ from: 0x0024, kind: 'jp', count: 2 }]);
    expect(c(0x0027)).toEqual([]);
    expect(c(0x0040)).toEqual([]);

    const map = m.debug.callerMap();
    expect([...map.keys()].sort((a, b) => a - b)).toEqual([0x000d, 0x0011, 0x0020, 0x0021, 0x0023, 0x0030, 0x0038]);
    expect(map.get(0x0030)).toEqual(c(0x0030));
    // The lists are copies: changing one changes nothing inside the debugger.
    c(0x0023)[0].count = 99;
    expect(c(0x0023)[0].count).toBe(2);

    // DJNZ records as 'jr'. LD B,2 / DJNZ $ / HALT: taken once.
    const dj = machine([0x06, 0x02, 0x10, 0xfe, 0x76]);
    dj.debug.coverage.enable();
    dj.run({ until: 'halt' });
    expect(dj.debug.callers(0x0002)).toEqual([{ from: 0x0002, kind: 'jr', count: 1 }]);
  });

  it('a lone prefix is its own one-byte instruction', () => {
    // DD / DD 21 34 12 (LD IX,1234H) / HALT
    const m = machine([0xdd, 0xdd, 0x21, 0x34, 0x12, 0x76]);
    m.debug.coverage.enable();
    m.run({ until: 'halt' });
    expect(marked(m, EXEC)).toEqual([0x00, 0x01, 0x05]);
    expect(marked(m, OPERAND)).toEqual([0x02, 0x03, 0x04]);
  });

  it("the keyboard hook's stand-in RET marks nothing", () => {
    // LD SP,8000H / CALL 002BH / HALT: the hook returns from $002B with the fed key.
    const m = machine([0x31, 0x00, 0x80, 0xcd, 0x2b, 0x00, 0x76]);
    m.keyboard.type('A', { mode: 'hook' });
    m.debug.coverage.enable();
    m.run({ until: 'halt' });
    expect(m.cpu.regs.a).toBe(0x41);
    expect(marked(m, EXEC)).toEqual([0x00, 0x03, 0x06]); // not $002B
    expect(marked(m, READ)).toEqual([]); // the stand-in's stack reads are not marked
    expect(marked(m, WRITE)).toEqual([0x7ffe, 0x7fff]); // the CALL's push
    expect(marked(m, CALL_TARGET)).toEqual([0x002b]);
    expect(marked(m, JUMP_TARGET)).toEqual([]); // no ret-to
    expect([...m.debug.callerMap().keys()]).toEqual([0x002b]);
  });

  it('an interrupt response records no edge, but its push is a write', () => {
    // LD A,4 / OUT (E0H),A (RTC interrupt on) / IM 1 / LD SP,8000H / EI / JR $ (at $000A): the
    // RTC interrupt pushes $000A and lands at $0038, which halts.
    const m = machine({ 0x0000: [0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0x31, 0x00, 0x80, 0xfb, 0x18, 0xfe], 0x0038: [0x76] });
    m.debug.coverage.enable();
    expect(m.run({ until: 'halt', cycles: 1e6 }).reason).toBe('halt');
    expect(m.cpu.regs.pc).toBe(0x0039);
    expect(marked(m, WRITE)).toEqual([0x7ffe, 0x7fff]);
    expect(marked(m, CALL_TARGET)).toEqual([]);
    expect([...m.debug.callerMap().keys()]).toEqual([0x000a]); // only the JR $ loop
    expect(marked(m, EXEC)).toEqual([0x00, 0x02, 0x04, 0x06, 0x09, 0x0a, 0x38]);
  });

  it('a halted CPU marks nothing while it idles', () => {
    const m = runProgram();
    const before = m.debug.coverage.bits.slice();
    m.run({ cycles: 10000 });
    expect(m.debug.coverage.bits).toEqual(before);
  });

  it('costs nothing while disabled', () => {
    const m = machine(PROGRAM);
    const cpu = m.system.cpu;
    const plain = [cpu.readMemory, cpu.writeMemory, cpu.readPort, cpu.writePort];
    m.run({ until: 'halt' });
    expect([cpu.readMemory, cpu.writeMemory, cpu.readPort, cpu.writePort]).toEqual(plain);
    expect(m.debug.active).toBe(false);
    expect(m.debug.coverage.enabled).toBe(false);
    expect(m.debug.coverage.bits.every((b) => b === 0)).toBe(true);
    expect(m.debug.callerMap().size).toBe(0);

    // Enabling swaps the accessors in; disabling with nothing else listening puts them back.
    m.debug.coverage.enable();
    expect(m.debug.coverage.enabled).toBe(true);
    expect(m.debug.active).toBe(true);
    expect(cpu.readMemory).not.toBe(plain[0]);
    m.debug.coverage.disable();
    expect([cpu.readMemory, cpu.writeMemory, cpu.readPort, cpu.writePort]).toEqual(plain);
    expect(m.debug.active).toBe(false);
  });

  it('disable keeps what was recorded and clear empties bits and callers', () => {
    const m = runProgram();
    const bits = m.debug.coverage.bits;
    m.debug.coverage.disable();
    expect(marked(m, EXEC)).toEqual(STARTS);
    expect(m.debug.callers(0x0030)).toHaveLength(2);
    m.debug.coverage.clear();
    expect(m.debug.coverage.bits).toBe(bits); // the same live array
    expect(bits.every((b) => b === 0)).toBe(true);
    expect(m.debug.callerMap().size).toBe(0);
  });

  it('coverage does not depend on how a session is split into steps and runs', () => {
    const whole = runProgram();
    const split = machine(PROGRAM);
    split.debug.coverage.enable();
    split.step(5);
    split.run({ cycles: 40 });
    split.run({ until: 'halt' });
    expect(split.debug.coverage.bits).toEqual(whole.debug.coverage.bits);
    const sorted = (m) => [...m.debug.callerMap()].sort(([a], [b]) => a - b);
    expect(sorted(split)).toEqual(sorted(whole));
  });
});
