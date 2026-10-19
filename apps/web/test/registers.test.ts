// 5C Task 1, Ruling 11: the registers and flags, with what changed since the last pause.
import { describe, expect, it } from 'vitest';
import { flagRows, readRegisters, registerRows } from '../app/utils/emulator/registers';
import { program, runStub } from './emulator-support';

describe('registers', () => {
  it('after LD HL,1234H only HL is marked changed (PC and R move with every instruction)', () => {
    const { machine, runner } = runStub(program('START:  LD      HL,1234H', 'WAIT:   JR      WAIT'));
    const before = readRegisters(machine);
    runner.step();
    const rows = registerRows(readRegisters(machine), before);
    expect(rows.filter((r) => r.changed).map((r) => r.name)).toEqual(['HL']);
    expect(rows.find((r) => r.name === 'HL')!.value).toBe('$1234');
    expect(rows.map((r) => r.name)).toEqual(['AF', 'BC', 'DE', 'HL', 'IX', 'IY', 'SP', 'PC', 'AF′', 'BC′', 'DE′', 'HL′', 'I', 'R', 'IM', 'IFF1', 'IFF2']);
    expect(rows.find((r) => r.name === 'IFF1')!.value).toBe('interrupts off');
    expect(rows.find((r) => r.name === 'IM')!.value).toBe(String(machine.cpu.regs.im));
  });

  it('with no earlier pause nothing is marked', () => {
    const { machine } = runStub(program('START:  NOP'));
    expect(registerRows(readRegisters(machine), null).some((r) => r.changed)).toBe(false);
  });

  it('after XOR A the flags spell out Zero = 1', () => {
    const { machine, runner } = runStub(program('START:  LD      A,5', '        ADD     A,0FFH', '        XOR     A', 'WAIT:   JR      WAIT'));
    runner.step();
    runner.step(); // ADD A,0FFH: carry set, not zero
    const prev = readRegisters(machine).af & 0xff;
    runner.step(); // XOR A
    const flags = flagRows(readRegisters(machine).af & 0xff, prev);
    expect(flags.map((f) => f.name)).toEqual(['Sign', 'Zero', 'Half-carry', 'Parity/Overflow', 'Add/Subtract', 'Carry']);
    const by = Object.fromEntries(flags.map((f) => [f.name, f]));
    expect(by.Zero).toEqual({ name: 'Zero', value: 1, changed: true });
    expect(by.Carry).toEqual({ name: 'Carry', value: 0, changed: true });
    expect(by.Sign!.value).toBe(0);
    expect(by['Parity/Overflow']!.value).toBe(1);
    expect(flagRows(0x40, null).every((f) => !f.changed)).toBe(true);
  });
});
