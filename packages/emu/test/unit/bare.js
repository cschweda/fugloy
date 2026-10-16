/**
 * A bare Z80 core for unit tests: flat 64K RAM with `bytes` at 0100H, PC there, SP at FE00H,
 * ports reading FFH, strict mode on (an unimplemented opcode throws). `setup(cpu, mem)` runs
 * last, to set registers and memory.
 */
import { Z80CPU } from '../../src/cpu/z80cpu.js';

export function bare(bytes, setup = () => {}) {
  const cpu = new Z80CPU();
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, 0x100);
  cpu.strictMode = true;
  cpu.readMemory = (a) => mem[a & 0xffff];
  cpu.writeMemory = (a, v) => {
    mem[a & 0xffff] = v & 0xff;
  };
  cpu.readPort = () => 0xff;
  cpu.writePort = () => {};
  cpu.reset();
  cpu.registers.PC = 0x100;
  cpu.registers.SP = 0xfe00;
  setup(cpu, mem);
  return { cpu, mem };
}
