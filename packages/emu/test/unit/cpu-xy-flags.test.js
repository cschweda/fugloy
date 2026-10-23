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
 *   - SCF/CCF: from A, or-ed with F's own when the instruction before
 *     left the flags alone (Patrik Rak's Q; below)
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

  it("CPL copies the complemented A's bits 3/5", () => {
    const c = cpuWithMemory([0x2f, 0x2f]);
    c.registers.A = 0x00; // -> 0xFF
    c.registers.F = 0x00;
    c.executeInstruction();
    expect(xy(c)).toBe(0x28);
    c.executeInstruction(); // -> 0x00
    expect(xy(c)).toBe(0x00);
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

/*
 * A repeating LDIR/LDDR/CPIR/CPDR (BC != 0 after the iteration, and for CPxR no match) leaves
 * F bits 3 and 5 from the high byte of PC, the address of its ED (Y = PC bit 13, X = PC bit 11),
 * not from n as Young §4.2 has it "at every iteration": David Banks's Z80Decoder research
 * ("LDxR / CPxR interrupted", github.com/hoglet67/Z80Decoder/wiki/Undocumented-Flags), checked on
 * real Z80s by Peter Helcmanovsky's Z80 Block Flags Test (github.com/redcode/Z80/wiki/Z80-Block-
 * Flags-Test), and MAME 0.289's z80.lst (`macro ldir` etc.: `m_f.yx_val = PC >> 8` after
 * `PC -= 2`). The iteration that ends the instruction keeps Young's rule.
 */
describe("X/Y after a repeating block iteration come from PC's high byte", () => {
  /** The instruction at `pc` with HL 4000H holding `byte`, DE 5000H, BC `bc`, A `a`. */
  function block(op, pc, { bc = 3, a = 0, byte = 0 } = {}) {
    const c = cpuWithMemory();
    c.mem.set([0xed, op], pc);
    c.mem[0x4000] = byte;
    c.registers.PC = pc;
    c.HL = 0x4000;
    c.DE = 0x5000;
    c.BC = bc;
    c.registers.A = a;
    c.registers.F = 0;
    c.executeInstruction();
    return c;
  }

  it("LDIR and LDDR that repeat: Y = PC bit 13, X = PC bit 11", () => {
    for (const op of [0xb0, 0xb8]) {
      // n = 0 + 0 would give X/Y 0; PC 2800H gives Y (bit 13) and X (bit 11).
      const c = block(op, 0x2800);
      expect(c.registers.PC, op.toString(16)).toBe(0x2800);
      expect(xy(c), op.toString(16)).toBe(0x28);
      // n = 0x0a (bits 1 and 3) would give X/Y 28H; PC 4000H gives 0.
      expect(xy(block(op, 0x4000, { a: 0x0a })), op.toString(16)).toBe(0x00);
      expect(xy(block(op, 0x0800)), op.toString(16)).toBe(0x08);
      expect(xy(block(op, 0x2000)), op.toString(16)).toBe(0x20);
    }
  });

  it("LDIR's last iteration keeps n's rule", () => {
    const c = block(0xb0, 0x2800, { bc: 1, a: 0x0a });
    expect(c.registers.PC).toBe(0x2802);
    expect(xy(c)).toBe(0x28);
    expect(xy(block(0xb0, 0x2800, { bc: 1 }))).toBe(0x00);
  });

  it("CPIR and CPDR that repeat (no match, BC != 0): from PC; on a match, from n", () => {
    for (const op of [0xb1, 0xb9]) {
      // A 10H - 0BH = 05H with H set: n = 04H, which would give X/Y 0.
      const c = block(op, 0x2800, { a: 0x10, byte: 0x0b });
      expect(c.registers.PC, op.toString(16)).toBe(0x2800);
      expect(xy(c), op.toString(16)).toBe(0x28);
      const hit = block(op, 0x2800, { a: 0x05, byte: 0x05 });
      expect(hit.registers.PC, op.toString(16)).toBe(0x2802);
      expect(xy(hit), op.toString(16)).toBe(0x00);
    }
  });
});

/**
 * SCF and CCF (Patrik Rak, 2012; David Banks, Z80Decoder wiki, "Undocumented Flags", "SCF/CCF",
 * checked on the Zilog NMOS Z80 and its second sources): when the instruction before modified the
 * flags, X and Y are A's bits 3 and 5; when it left them alone, F's own bits 3 and 5 or-ed with
 * A's. POP AF and EX AF,AF' do not count as modifying them, a DD or FD before SCF or CCF counts as
 * an instruction that left them alone, and an interrupt response is none at all. MAME 0.289's
 * z80.lst keeps the same rule in Q (`Q = QT; QT = YXF` at each opcode fetch, `QT = 0` in each
 * instruction that sets flags, `scf`: `(m_f.yx_val & Q) | A`). ZEXALL cannot see it: its
 * <daa,cpl,scf,ccf> group never sets F's bits 3 and 5 before the instruction (base F 04H, varied
 * under the mask D7H), so F | A is A there.
 */
describe("SCF and CCF: X/Y also from F when the instruction before left the flags alone", () => {
  /** Run the program's instructions one by one, F set to `f` first. */
  function run(bytes, { a = 0x00, f = 0x00, steps = bytes.length } = {}) {
    const c = cpuWithMemory(bytes);
    c.registers.SP = 0x8000;
    c.registers.A = a;
    c.registers.F = f;
    for (let k = 0; k < steps; k++) c.executeInstruction();
    return c;
  }

  it("after LD B,C (no flags written): F's bits 3/5 stay, or-ed with A's", () => {
    // LD B,C / SCF with F 28H and A 00H: F's bits survive.
    expect(xy(run([0x41, 0x37], { f: 0x28 }))).toBe(0x28);
    // and A's are added: F 08H, A 20H.
    expect(xy(run([0x41, 0x37], { f: 0x08, a: 0x20 }))).toBe(0x28);
    // CCF the same.
    expect(xy(run([0x41, 0x3f], { f: 0x28 }))).toBe(0x28);
  });

  it("after CP 28H (flags written, X/Y from the operand): A's bits alone", () => {
    const c = run([0xfe, 0x28, 0x37], { steps: 2 });
    expect(xy(c)).toBe(0x00);
    expect(c.flagC).toBe(1);
    expect(xy(run([0xfe, 0x28, 0x3f], { steps: 2 }))).toBe(0x00);
    // CP 28H then SCF with A 08H: A's bit 3 only.
    expect(xy(run([0xfe, 0x28, 0x37], { a: 0x08, steps: 2 }))).toBe(0x08);
  });

  it("POP AF and EX AF,AF' do not count as writing the flags", () => {
    // POP AF loading F 28H, A 00H (the stack holds F then A), then SCF.
    const pop = cpuWithMemory([0xf1, 0x37]);
    pop.registers.SP = 0x8000;
    pop.mem.set([0x28, 0x00], 0x8000);
    pop.executeInstruction();
    pop.executeInstruction();
    expect(xy(pop)).toBe(0x28);
    // EX AF,AF' bringing in F' 28H after a CP that wrote the flags.
    const ex = cpuWithMemory([0xfe, 0x00, 0x08, 0x37]);
    ex.registers.F_ = 0x28;
    for (let k = 0; k < 3; k++) ex.executeInstruction();
    expect(xy(ex)).toBe(0x28);
  });

  it("a DD or FD before SCF is an instruction that left the flags alone (Banks, 2026)", () => {
    // CP 28H writes X/Y 28H, then DD 37: the DD, not the CP, is the instruction before.
    expect(xy(run([0xfe, 0x28, 0xdd, 0x37], { steps: 2 }))).toBe(0x28);
    expect(xy(run([0xfe, 0x28, 0xfd, 0x3f], { steps: 2 }))).toBe(0x28);
  });

  it("an interrupt response is no instruction: the handler's SCF sees the one interrupted", () => {
    // CP 28H, then an IM 1 interrupt; SCF at 0038H follows CP's flags: A's bits alone.
    const c = cpuWithMemory([0xfe, 0x28]);
    c.mem[0x38] = 0x37;
    c.registers.SP = 0x8000;
    c.interruptMode = 1;
    c.IFF1 = c.IFF2 = true;
    c.executeInstruction();
    expect(c.interrupt()).toBe(true);
    c.executeInstruction();
    expect(c.registers.PC).toBe(0x39);
    expect(xy(c)).toBe(0x00);
    // NOP, then the interrupt: F's bits stay.
    const n = cpuWithMemory([0x00]);
    n.mem[0x38] = 0x37;
    n.registers.SP = 0x8000;
    n.registers.F = 0x28;
    n.interruptMode = 1;
    n.IFF1 = n.IFF2 = true;
    n.executeInstruction();
    n.interrupt();
    n.executeInstruction();
    expect(xy(n)).toBe(0x28);
  });

  it("a halted CPU's NOPs leave the flags alone", () => {
    // CP 28H / HALT, two halted steps, an interrupt, SCF at 0038H: F's bits stay.
    const c = cpuWithMemory([0xfe, 0x28, 0x76]);
    c.mem[0x38] = 0x37;
    c.registers.SP = 0x8000;
    c.interruptMode = 1;
    c.IFF1 = c.IFF2 = true;
    for (let k = 0; k < 4; k++) c.executeInstruction();
    expect(c.halted).toBe(true);
    c.interrupt();
    c.executeInstruction();
    expect(xy(c)).toBe(0x28);
  });

  it("a reset starts as if the flags were just written (A's bits alone)", () => {
    const c = cpuWithMemory([0x37]);
    c.registers.F = 0x28;
    c.reset();
    c.registers.F = 0x28;
    c.executeInstruction();
    expect(xy(c)).toBe(0x00);
  });
});
