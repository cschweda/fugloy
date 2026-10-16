/**
 * Undocumented X/Y flags (F bits 3 and 5)
 *
 * The Z80 copies bits 3/5 of some instruction-dependent value into F on
 * every flag-writing instruction (Sean Young, "The Undocumented Z80
 * Documented"). The rules these tests pin:
 *
 *   - 8-bit ALU ops: from the result
 *   - CP s: from the OPERAND (the famous exception)
 *   - 16-bit ADD/ADC/SBC: from the high byte of the result
 *   - BIT n,r: from the register; BIT n,(HL): from MEMPTR's high byte;
 *     BIT n,(IX+d): from the high byte of IX+d
 *   - LDI/LDD: n = transferred byte + A, Y = n bit 1, X = n bit 3
 *   - CPI/CPD: n = A - (HL) - H(after), same bit mapping
 *   - SCF/CCF: from A
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Z80CPU } from "../../src/cpu/z80cpu.js";

const XY = 0x28;
const xy = (cpu) => cpu.registers.F & XY;

function cpuWithMemory(bytes = []) {
  const cpu = new Z80CPU();
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, 0);
  cpu.readMemory = (a) => mem[a & 0xffff];
  cpu.writeMemory = (a, v) => {
    mem[a & 0xffff] = v & 0xff;
  };
  cpu.readPort = () => 0x28;
  cpu.writePort = () => {};
  cpu.mem = mem;
  return cpu;
}

describe("X/Y from 8-bit ALU results", () => {
  let cpu;
  beforeEach(() => {
    cpu = cpuWithMemory();
  });

  it("ADD copies result bits 3/5", () => {
    cpu.registers.A = 0x00;
    cpu.addA(0x28);
    expect(xy(cpu)).toBe(0x28);
    cpu.registers.A = 0x01;
    cpu.addA(0x02);
    expect(xy(cpu)).toBe(0x00);
  });

  it("SUB copies result bits 3/5", () => {
    cpu.registers.A = 0x30;
    cpu.subA(0x08);
    expect(cpu.registers.A).toBe(0x28);
    expect(xy(cpu)).toBe(0x28);
  });

  it("CP copies the OPERAND's bits 3/5, not the result's", () => {
    cpu.registers.A = 0x00;
    cpu.subA(0x28, true); // result 0xD8 (X set, Y clear) — operand wins
    expect(cpu.registers.A).toBe(0x00);
    expect(xy(cpu)).toBe(0x28);
  });

  it("SBC copies result bits 3/5", () => {
    cpu.registers.A = 0x30;
    cpu.flagC = 1;
    cpu.sbcA(0x07);
    expect(cpu.registers.A).toBe(0x28);
    expect(xy(cpu)).toBe(0x28);
  });

  it("INC and DEC copy result bits 3/5", () => {
    cpu.registers.B = 0x27;
    cpu.incReg("B");
    expect(xy(cpu)).toBe(0x28);
    cpu.registers.C = 0x29;
    cpu.decReg("C");
    expect(xy(cpu)).toBe(0x28);
  });

  it("AND/OR/XOR copy result bits 3/5", () => {
    cpu.registers.A = 0xff;
    cpu.andA(0x28);
    expect(xy(cpu)).toBe(0x28);
    cpu.registers.A = 0x20;
    cpu.orA(0x08);
    expect(xy(cpu)).toBe(0x28);
    cpu.registers.A = 0x00;
    cpu.xorA(0x28);
    expect(xy(cpu)).toBe(0x28);
  });

  it("NEG copies result bits 3/5", () => {
    const c = cpuWithMemory([0xed, 0x44]);
    c.registers.A = 0xd8; // -0xD8 = 0x28
    c.executeInstruction();
    expect(c.registers.A).toBe(0x28);
    expect(xy(c)).toBe(0x28);
  });

  it("DAA copies adjusted-A bits 3/5", () => {
    const c = cpuWithMemory([0x27]);
    c.registers.A = 0x19;
    c.addA(0x19); // 0x32 binary, BCD wants 38
    c.executeInstruction();
    expect(c.registers.A).toBe(0x38);
    expect(xy(c)).toBe(0x28);
  });
});

describe("X/Y from A on accumulator rotates and carry ops", () => {
  it("RLCA/RRA leave A's bits 3/5 in F", () => {
    const c = cpuWithMemory([0x07]); // RLCA
    c.registers.A = 0x94; // -> 0x29
    c.executeInstruction();
    expect(c.registers.A).toBe(0x29);
    expect(xy(c)).toBe(0x28);
  });

  it("SCF copies A's bits 3/5", () => {
    const c = cpuWithMemory([0x37]);
    c.registers.A = 0x28;
    c.executeInstruction();
    expect(c.flagC).toBe(1);
    expect(xy(c)).toBe(0x28);
  });

  it("CCF copies A's bits 3/5", () => {
    const c = cpuWithMemory([0x3f]);
    c.registers.A = 0x28;
    c.flagC = 0;
    c.executeInstruction();
    expect(c.flagC).toBe(1);
    expect(xy(c)).toBe(0x28);
  });
});

describe("X/Y on CB-prefixed ops", () => {
  it("SRL copies result bits 3/5", () => {
    const c = cpuWithMemory([0xcb, 0x38]); // SRL B
    c.registers.B = 0x51; // -> 0x28
    c.executeInstruction();
    expect(c.registers.B).toBe(0x28);
    expect(xy(c)).toBe(0x28);
  });

  it("BIT n,r copies the tested register's bits 3/5", () => {
    const c = cpuWithMemory([0xcb, 0x40]); // BIT 0,B
    c.registers.B = 0x28;
    c.executeInstruction();
    expect(c.flagZ).toBe(1); // bit 0 of 0x28 is clear
    expect(xy(c)).toBe(0x28);
  });

  it("BIT n,(HL) copies MEMPTR's high byte bits 3/5", () => {
    // LD A,(0x2867) sets MEMPTR to 0x2868; BIT 0,(HL) then exposes 0x28
    const c = cpuWithMemory([0x3a, 0x67, 0x28, 0xcb, 0x46]);
    c.HL = 0x0100;
    c.mem[0x0100] = 0x01;
    c.executeInstruction(); // LD A,(nn)
    c.executeInstruction(); // BIT 0,(HL)
    expect(c.flagZ).toBe(0);
    expect(xy(c)).toBe(0x28);
  });

  it("BIT n,(IX+d) copies the high byte of IX+d", () => {
    const c = cpuWithMemory([0xdd, 0xcb, 0x10, 0x46]); // BIT 0,(IX+0x10)
    c.IX = 0x2800;
    c.mem[0x2810] = 0x01;
    c.executeInstruction();
    expect(c.flagZ).toBe(0);
    expect(xy(c)).toBe(0x28);
  });
});

describe("X/Y from 16-bit arithmetic high bytes", () => {
  it("ADD HL,rr copies the result high byte's bits 3/5", () => {
    const c = cpuWithMemory([0x09]); // ADD HL,BC
    c.HL = 0x2000;
    c.BC = 0x0800;
    c.executeInstruction();
    expect(c.HL).toBe(0x2800);
    expect(xy(c)).toBe(0x28);
  });

  it("ADD IX,rr copies the result high byte's bits 3/5", () => {
    const c = cpuWithMemory([0xdd, 0x09]); // ADD IX,BC
    c.IX = 0x2000;
    c.BC = 0x0800;
    c.executeInstruction();
    expect(c.IX).toBe(0x2800);
    expect(xy(c)).toBe(0x28);
  });

  it("SBC HL,rr copies the result high byte's bits 3/5", () => {
    const c = cpuWithMemory([0xed, 0x42]); // SBC HL,BC
    c.HL = 0x2900;
    c.BC = 0x0100;
    c.flagC = 0;
    c.executeInstruction();
    expect(c.HL).toBe(0x2800);
    expect(xy(c)).toBe(0x28);
  });
});

describe("X/Y on block and register-transfer ops", () => {
  it("LDI maps (byte + A) bit 1 to Y and bit 3 to X", () => {
    const c = cpuWithMemory([0xed, 0xa0]); // LDI
    c.registers.A = 0x03;
    c.HL = 0x1000;
    c.DE = 0x2000;
    c.BC = 0x0002;
    c.mem[0x1000] = 0x07; // n = 0x0A: bit 1 set -> Y, bit 3 set -> X
    c.executeInstruction();
    expect(xy(c)).toBe(0x28);
  });

  it("CPI maps (A - value - H) bit 1 to Y and bit 3 to X", () => {
    const c = cpuWithMemory([0xed, 0xa1]); // CPI
    c.registers.A = 0x0b;
    c.HL = 0x1000;
    c.BC = 0x0002;
    c.mem[0x1000] = 0x01; // result 0x0A, no half-borrow -> n = 0x0A
    c.executeInstruction();
    expect(xy(c)).toBe(0x28);
  });

  it("IN r,(C) copies the input byte's bits 3/5", () => {
    const c = cpuWithMemory([0xed, 0x40]); // IN B,(C) — port stub reads 0x28
    c.executeInstruction();
    expect(c.registers.B).toBe(0x28);
    expect(xy(c)).toBe(0x28);
  });

  it("RLD copies final A's bits 3/5", () => {
    const c = cpuWithMemory([0xed, 0x6f]); // RLD
    c.registers.A = 0x21;
    c.HL = 0x1000;
    c.mem[0x1000] = 0x8f; // A -> 0x28, (HL) -> 0xF1
    c.executeInstruction();
    expect(c.registers.A).toBe(0x28);
    expect(c.mem[0x1000]).toBe(0xf1);
    expect(xy(c)).toBe(0x28);
  });

  it("LD A,I copies A's bits 3/5", () => {
    const c = cpuWithMemory([0xed, 0x57]); // LD A,I
    c.registers.I = 0x28;
    c.executeInstruction();
    expect(c.registers.A).toBe(0x28);
    expect(xy(c)).toBe(0x28);
  });
});
