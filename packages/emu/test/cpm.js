/**
 * A CP/M stand-in for running .COM programs, the Z80 exercisers among them, on the core: flat
 * 64K RAM with the program at 0100H; BDOS at 0005H, with functions 2 (print E) and 9 (print the
 * $-terminated string at DE) trapped; a jump to 0000H ends the run. (0006H) holds FE00H, the top
 * of memory, where the BDOS jump lands on a RET.
 */
import { Z80CPU } from '../src/index.js';

// One core serves every run. Each Z80CPU's register file has its own hidden class in V8, so a
// process that runs several cores runs every one of them about 4x slower: ZEXALL's group 10
// takes 8 s on the first core and 33 s on the fourth.
const mem = new Uint8Array(0x10000);
const cpu = new Z80CPU();
cpu.strictMode = true;
cpu.readMemory = (a) => mem[a];
cpu.writeMemory = (a, v) => {
  mem[a] = v;
};
cpu.readPort = () => 0xff;
cpu.writePort = () => {};

export function runCpm(program, { maxTStates = 2e11 } = {}) {
  mem.fill(0);
  mem.set(program, 0x100);
  mem.set([0xc3, 0x00, 0x00], 0x0000);
  mem.set([0xc3, 0x00, 0xfe], 0x0005);
  mem[0xfe00] = 0xc9;
  for (const name of Object.keys(cpu.registers)) cpu.registers[name] = 0;
  cpu.reset();
  cpu.registers.SP = 0xfe00;
  cpu.registers.PC = 0x0100;
  let output = '';
  while (cpu.cycles < maxTStates) {
    const pc = cpu.registers.PC;
    if (pc === 0x0000) return { output, tstates: cpu.cycles, exited: true };
    if (pc === 0x0005) {
      if (cpu.registers.C === 2) output += String.fromCharCode(cpu.registers.E);
      else if (cpu.registers.C === 9) {
        for (let a = cpu.DE; mem[a] !== 0x24; a = (a + 1) & 0xffff) output += String.fromCharCode(mem[a]);
      }
    }
    cpu.executeInstruction();
  }
  return { output, tstates: cpu.cycles, exited: false };
}
