/**
 * The disk NMI (phase 5 plan, Ruling 3): the edge latch that makes one INTRQ assertion one NMI is
 * part of a save state, and an NMI arriving right after a lone DD or FD prefix waits one
 * instruction, as a maskable interrupt does (Young §3.6, spec §4). And the disk controller's clock
 * keeps step with the CPU's across interrupt and NMI responses.
 */
import { describe, expect, it } from 'vitest';
import { TRS80System } from '../../src/machine/trs80-system.js';
import { DiskImage } from '../../src/devices/disk-image.js';
import { restoreState, serializeState } from '../../src/debug/state.js';
import { INDEX_PERIOD } from '../../src/devices/fdc-wd1793.js';
import { writeJv1 } from './disk-writers.js';

/** A 14K ROM with `code` at 0000 and `handler` at the NMI vector 0066. */
function rom(code, handler) {
  const bytes = new Uint8Array(0x3800);
  bytes.set(code, 0);
  bytes.set(handler, 0x66);
  return bytes;
}

const pc = (sys) => sys.cpu.registers.PC;
const stackTop = (sys) => {
  const sp = sys.cpu.registers.SP;
  return sys.memory.readByte(sp) | (sys.memory.readByte((sp + 1) & 0xffff) << 8);
};

describe('NMI after a lone prefix', () => {
  // 0000 DD (lone: DD follows) / 0001 DD 00 (DD NOP) / 0003 NOP; NMI handler: HALT
  const code = [0x31, 0x00, 0x50, 0xdd, 0xdd, 0x00, 0x00, 0x00];
  const raise = (sys) => {
    sys.io.nmiMask = 0x80;
    sys.io.fdc.intrq = true;
  };

  it('is held off for one instruction and then taken: the edge stays pending', () => {
    const sys = new TRS80System({ romData: rom(code, [0x76]) });
    sys.stepInstruction(); // LD SP,5000H
    sys.stepInstruction(); // the lone DD
    expect(pc(sys)).toBe(0x0004);
    expect(sys.cpu.afterPrefix).toBe(true);
    raise(sys);
    sys.stepInstruction(); // held: DD 00 runs
    expect(pc(sys)).toBe(0x0006);
    expect(sys._nmiWasPending).toBe(false);
    sys.stepInstruction(); // taken, then the handler's HALT
    expect(stackTop(sys)).toBe(0x0006);
    expect(sys.cpu.halted).toBe(true);
    expect(sys._nmiWasPending).toBe(true);
  });

  it('is taken at once after an ordinary instruction', () => {
    const sys = new TRS80System({ romData: rom(code, [0x76]) });
    sys.stepInstruction();
    raise(sys);
    sys.stepInstruction();
    expect(stackTop(sys)).toBe(0x0003);
    expect(sys.cpu.halted).toBe(true);
  });

  it('the CPU reports a held-off NMI', () => {
    const sys = new TRS80System({ romData: rom(code, [0x76]) });
    sys.stepInstruction();
    sys.stepInstruction();
    expect(sys.cpu.nmi()).toBe(false);
    expect(pc(sys)).toBe(0x0004);
  });
});

describe('the NMI edge latch in a save state', () => {
  // Enable the INTRQ NMI, force an immediate interrupt (D8: INTRQ stays up), and spin. The NMI
  // handler counts at 5000H and returns without reading the status, so INTRQ stays asserted.
  const code = [
    0xf3, 0x31, 0x00, 0x50, // DI / LD SP,5000H
    0x3e, 0x80, 0xd3, 0xe4, // NMI mask: INTRQ
    0x3e, 0xd8, 0xd3, 0xf0, // FORCE INTERRUPT, immediate
    0x18, 0xfe, // JR $
  ];
  const handler = [0x21, 0x00, 0x50, 0x34, 0xed, 0x45]; // LD HL,5000H / INC (HL) / RETN
  const boot = () => {
    const sys = new TRS80System({ romData: rom(code, handler) });
    sys.mountDisk(0, new DiskImage(writeJv1()));
    sys.memory.writeByte(0x5000, 0);
    return sys;
  };

  it('one INTRQ assertion is one NMI, across a snapshot and restore', () => {
    const sys = boot();
    sys.runTStates(20_000);
    expect(sys.memory.readByte(0x5000)).toBe(1);
    const state = JSON.parse(JSON.stringify(serializeState(sys)));
    expect(state.nmiWasPending).toBe(true);

    const other = boot();
    restoreState(other, state);
    other.runTStates(20_000);
    expect(other.memory.readByte(0x5000)).toBe(1);
    sys.runTStates(20_000);
    expect(serializeState(other)).toEqual(serializeState(sys));
  });

  it('a state from before the latch was saved restores it as clear, as it used to', () => {
    const sys = boot();
    sys.runTStates(20_000);
    const state = JSON.parse(JSON.stringify(serializeState(sys)));
    delete state.nmiWasPending;
    const other = boot();
    restoreState(other, state);
    other.runTStates(20_000);
    expect(other.memory.readByte(0x5000)).toBe(2); // the NMI fires again: why the latch is saved
  });
});

describe("the controller's clock", () => {
  it('keeps step with the CPU’s across interrupt and NMI responses', () => {
    const code = [
      0xf3, 0x31, 0x00, 0x50, 0xed, 0x56, // DI / LD SP,5000H / IM 1
      0x3e, 0x04, 0xd3, 0xe0, // interrupt mask: the RTC
      0x3e, 0x80, 0xd3, 0xe4, // NMI mask: INTRQ
      0xfb, // EI
      0x3e, 0xd8, 0xd3, 0xf0, // 000F: FORCE INTERRUPT, immediate: INTRQ, one NMI per assertion
      0x3e, 0xd0, 0xd3, 0xf0, 0xdb, 0xf0, // FORCE INTERRUPT, none, and a status read: INTRQ clears
      0x06, 0x00, 0x10, 0xfe, // LD B,0 / DJNZ $
      0x18, 0xf0, // JR 000FH
    ];
    const bytes = rom(code, [0x21, 0x01, 0x50, 0x34, 0xed, 0x45]); // NMI: INC (5001H) / RETN
    bytes.set([0xf5, 0xdb, 0xec, 0x21, 0x00, 0x50, 0x34, 0xf1, 0xfb, 0xc9], 0x38); // RTC: ack, INC (5000H), EI, RET
    const sys = new TRS80System({ romData: bytes });
    sys.mountDisk(0, new DiskImage(writeJv1()));
    const skew = () => (((sys.cpu.cycles - sys.io.fdc.indexClock) % INDEX_PERIOD) + INDEX_PERIOD) % INDEX_PERIOD;
    const start = skew();
    sys.runTStates(500_000); // a quarter of a second: 7 RTC interrupts and over a hundred NMIs (byte counters)
    expect(sys.memory.readByte(0x5000)).toBe(7);
    expect(sys.memory.readByte(0x5001)).toBeGreaterThan(100);
    expect(skew()).toBe(start);
  });
});
