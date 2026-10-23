// The Run tab's DOM-free runtime on the stub ROM (Ruling 5), so it runs in CI with no ROM: the
// stub boot, the static ROM check, the HALT trap, the frame budget on a fake clock, and the
// runner's controls.
import { describe, expect, it } from 'vitest';
import { assemble } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { Machine } from '@fugloy/emu';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import { romEnd, stubRom, STUB_ROM_SOURCE } from '../app/utils/emulator/stub-rom';
import { bootedSnapshot, prepareMachine } from '../app/utils/emulator/boot';
import { createRunner, MODEL1_HALT } from '../app/utils/emulator/runner';
import type { Runner } from '../app/utils/emulator/runner';
import { romNotes, romSpaceCode, romUse } from '../app/utils/emulator/rom-use';
import { runPatched, runStub as runWith } from './emulator-support';

const FRAME = 1000 / 60;
const asm = (text: string, model: 1 | 3 | 4 = 3): AsmResult => {
  const r = assemble(text, { model });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r;
};
const program = (...lines: string[]): string => ['        ORG     7000H', ...lines, '        END     START', ''].join('\n');

/** A fake animation-frame clock: `frame(ms)` advances time and runs the queued callback. */
function fakeClock() {
  let t = 0;
  let next = 1;
  const queue = new Map<number, () => void>();
  return {
    schedule: (cb: () => void): number => {
      queue.set(next, cb);
      return next++;
    },
    cancel: (id: number): void => void queue.delete(id),
    now: (): number => t,
    pending: (): number => queue.size,
    frame(ms = FRAME): void {
      t += ms;
      const [id, cb] = [...queue][0] ?? [];
      if (id === undefined) return;
      queue.delete(id);
      cb!();
    },
  };
}

function runStub(source: string, opts: { before?: (m: Machine) => void; model?: 1 | 3 | 4 } = {}) {
  const model = opts.model ?? 3;
  const result = asm(source, model);
  const clock = fakeClock();
  const machine = prepareMachine({ model, rom: stubRom(model), result, before: opts.before });
  const runner = createRunner({ machine, result, stub: true, schedule: clock.schedule, cancel: clock.cancel, now: clock.now });
  return { result, clock, machine, runner };
}

const frames = (clock: ReturnType<typeof fakeClock>, n: number): void => {
  for (let k = 0; k < n; k++) clock.frame();
};

describe('the stub ROM', () => {
  it('is Fugløy source, padded with HALT to the model ROM size', () => {
    expect(STUB_ROM_SOURCE).toMatch(/DI/);
    expect(STUB_ROM_SOURCE).toMatch(/HALT/);
    for (const [model, size] of [
      [1, 0x3000],
      [3, 0x3800],
      [4, 0x3800],
    ] as const) {
      const rom = stubRom(model);
      expect(rom.length).toBe(size);
      expect(rom[0]).toBe(0xf3); // DI
      expect(rom[0x38]).toBe(0x76);
      expect(rom[size - 1]).toBe(0x76);
      expect(stubRom(model)).toBe(rom); // assembled once
    }
  });

  it('emu leaves PC just past a HALT, so the trap reads the HALT at PC-1', () => {
    const m = new Machine({ roms: { level2: stubRom(3) } });
    const r = m.run({ until: 'halt', cycles: 2_000_000 });
    expect(r.reason).toBe('halt');
    const halt = m.cpu.regs.pc - 1;
    expect(m.mem.read(halt, 1)[0]).toBe(0x76);
    m.step(5); // a halted CPU idles in place
    expect(m.cpu.regs.pc - 1).toBe(halt);
  });

  it('a fresh stub boot shows spaces, not @', () => {
    for (const model of [1, 3, 4] as const) {
      // Zeroed video RAM would show @ (00H folds to 40H); the stub itself writes the spaces.
      const m = new Machine({ model, roms: { level2: stubRom(model) } });
      m.mem.write(0x3c00, new Uint8Array(1024));
      expect(m.video.text()[0]).toBe('@'.repeat(64));
      expect(m.run({ until: 'halt', cycles: 2_000_000 }).reason).toBe('halt');
      expect(m.video.text().every((row) => row === ' '.repeat(64))).toBe(true);
      const fresh = new Machine({ model, roms: { level2: stubRom(model) } });
      fresh.mem.write(0x3c00, new Uint8Array(1024));
      fresh.debug.restore(bootedSnapshot(model, stubRom(model)));
      expect(fresh.video.text().every((row) => row === ' '.repeat(64))).toBe(true);
    }
  });

  it('caches the boot snapshot by model and ROM hash', () => {
    expect(bootedSnapshot(3, stubRom(3))).toBe(bootedSnapshot(3, stubRom(3).slice()));
    expect(bootedSnapshot(1, stubRom(1))).not.toBe(bootedSnapshot(3, stubRom(3)));
  });

  for (const model of [3, 1] as const) {
    it(`runs the starter on the Model ${model === 3 ? 'III' : 'I'}: video RAM all spaces and PC at WAIT`, () => {
      const { result, clock, machine, runner } = runStub(starter, { model });
      expect(romUse(result, model)).toBeNull();
      runner.start();
      frames(clock, 4);
      expect(runner.state).toBe('running');
      expect(runner.stopReason).toBeNull();
      expect(runner.pc).toBe(result.symbol('WAIT')!.value);
      expect([...machine.video.raw.subarray(0, 1024)].every((b) => b === 0x20)).toBe(true);
    });
  }

  it('blanks a screen pre-filled with X', () => {
    const { clock, machine, runner } = runStub(starter, { before: (m) => m.mem.write(0x3c00, new Uint8Array(1024).fill(0x58)) });
    expect(machine.video.text()[0]).toBe('X'.repeat(64));
    runner.start();
    frames(clock, 4);
    expect(machine.video.text().every((row) => row === ' '.repeat(64))).toBe(true);
  });
});

describe('a program that needs the ROM', () => {
  it('CALL $VDCLS is refused before running, naming the line and the routine', () => {
    const r = asm(program('START:  LD      A,1', '        CALL    $VDCLS', 'WAIT:   JR      WAIT'));
    const use = romUse(r, 3);
    expect(use?.line).toBe(3);
    expect(use?.text).toMatch(/^Line 3 calls \$VDCLS/);
    expect(use?.text).toMatch(/clear the screen/);
    expect(use?.text).toMatch(/Model III ROM/);
    expect(use?.text).toMatch(/\.$/);
  });

  it('a CALL or JP to a ROM address, a name equated to one, and an RST are refused too', () => {
    expect(romUse(asm(program('START:  JP      01C9H')), 3)).toMatchObject({ line: 2, text: expect.stringMatching(/^Line 2 jumps to \$VDCLS/) });
    expect(romUse(asm(program('CLS     EQU     01C9H', 'START:  NOP', '        CALL    NZ,CLS')), 3)).toMatchObject({ line: 4 });
    expect(romUse(asm(program('START:  NOP', '        RST     10H')), 3)).toMatchObject({ line: 3, text: expect.stringMatching(/^Line 3 uses RST 10H/) });
    expect(romUse(asm(program('START:  CALL    0FFFH')), 1)?.text).toMatch(/Model I ROM/);
  });

  it("the ROM's RAM variables are ROM use, by name or by number, read or written", () => {
    expect(romUse(asm(program('START:  LD      HL,(CURADDR)', '        LD      (HL),41H')), 3)).toMatchObject({
      line: 2,
      text: expect.stringMatching(/^Line 2 uses the ROM variable CURADDR at \$4020 \(address of the cursor/),
    });
    expect(romUse(asm(program('START:  LD      HL,(4020H)')), 3)).toMatchObject({ line: 2, text: expect.stringMatching(/^Line 2 reads \$4020, the ROM's variable CURADDR/) });
    expect(romUse(asm(program('START:  LD      (4021H),HL')), 3)).toMatchObject({ line: 2, text: expect.stringMatching(/^Line 2 writes \$4021, the ROM's variable CURADDR/) });
    expect(romUse(asm(program('START:  LD      DE,(4020H)')), 3)?.line).toBe(2);
    expect(romUse(asm(program('START:  LD      IX,(4020H)')), 3)?.line).toBe(2);
  });

  it('a read from a fixed address inside the ROM is refused', () => {
    expect(romUse(asm(program('START:  NOP', '        LD      A,(0)')), 3)).toMatchObject({ line: 3, text: expect.stringMatching(/^Line 3 reads the ROM at \$0000 \(\$RESET\), but no ROM is loaded/) });
    expect(romUse(asm(program('START:  LD      A,(1000H)')), 3)?.text).toMatch(/^Line 2 reads the ROM at \$1000, /);
    expect(romUse(asm(program('ROMTOP  EQU     37FFH', 'START:  LD      HL,(ROMTOP)')), 3)?.line).toBe(3);
    expect(romUse(asm(program('START:  LD      BC,(2000H)')), 3)?.line).toBe(2);
    // The same address on the Model I is past its 12K ROM, in the empty space: not a ROM read.
    expect(romUse(asm(program('START:  LD      A,(3000H)'), 1), 1)).toBeNull();
  });

  it('LD HL with a ROM address feeding LDIR is a warning note, not a refusal', () => {
    const r = asm(program('START:  LD      HL,0', '        LD      DE,3C00H', '        LD      BC,64', '        LDIR', 'WAIT:   JR      WAIT'));
    expect(romUse(r, 3)).toBeNull();
    const notes = romNotes(r, 3);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ line: 2, text: expect.stringMatching(/^Line 2 points HL at \$0000, inside the ROM's space, and line 5 copies from where HL points \(LDIR\)/) });
    // LD HL,0 with no block copy after it is not noted.
    expect(romNotes(asm(program('START:  LD      HL,0', '        ADD     HL,SP', 'WAIT:   JR      WAIT')), 3)).toEqual([]);
  });

  it('code assembled inside the ROM space is refused, naming the ORG line, on any machine', () => {
    const r = asm(['        ORG     1000H', 'START:  LD      A,41H', '        LD      (3C00H),A', 'WAIT:   JR      WAIT', '        END     START', ''].join('\n'));
    const f = romSpaceCode(r, 3);
    expect(f).toMatchObject({ line: 1, text: expect.stringMatching(/^Line 1 puts the program at \$1000, inside the ROM's space \(\$0000-\$37FF\), where it cannot be loaded\./) });
    expect(romUse(r, 3)).toEqual(f);
    // A second ORG into the ROM's space names that ORG.
    const two = asm(program('START:  NOP', 'WAIT:   JR      WAIT', '        ORG     0100H', '        DB      1'));
    expect(romSpaceCode(two, 3)?.line).toBe(4);
    expect(romSpaceCode(asm(starter), 3)).toBeNull();
  });

  it('a ROM name stored as data (DW or DB) is refused', () => {
    expect(romUse(asm(program('START:  LD      HL,(TBL)', 'WAIT:   JR      WAIT', 'TBL:    DW      $VDCLS')), 3)).toMatchObject({
      line: 4,
      text: expect.stringMatching(/^Line 4 stores \$VDCLS, the ROM's routine at \$01C9 \(clear the screen\) as data/),
    });
    expect(romUse(asm(program('START:  NOP', 'WAIT:   JR      WAIT', '        DB      LOW $VDCLS')), 3)?.line).toBe(4);
  });

  it('reads the opcode from the bytes, whatever the label or spacing', () => {
    expect(romUse(asm(['        ORG     7000H', 'START:CALL $VDCLS', '        END     START', ''].join('\n')), 3)?.line).toBe(2);
    expect(romUse(asm(['        ORG     7000H', 'START   JP      01C9H', '        END     START', ''].join('\n')), 3)?.text).toMatch(/^Line 2 jumps to \$VDCLS/);
    expect(romUse(asm(['        ORG     7000H', 'START:  call    1000h', '        END     START', ''].join('\n')), 3)?.text).toMatch(/^Line 2 calls \$1000, inside the ROM/);
  });

  it('hardware names, ports, RAM addresses, and text in DB or comments are not ROM use', () => {
    const r = asm(
      program(
        'START:  LD      HL,3C00H        ; CALL $VDCLS is only a comment',
        '        LD      A,(3840H)',
        '        OUT     (0FFH),A',
        '        CALL    SUB',
        'WAIT:   JR      WAIT',
        'SUB:    RET',
        '        DB      0CDH,0C9H,01H,"CALL $VDCLS"',
      ),
    );
    expect(romUse(r, 3)).toBeNull();
  });

  it('a computed JP (HL) into the ROM stops at the trap naming the last line run', () => {
    // Through a CALL to a trampoline: the JP (HL) is the last line of the program that ran.
    const viaCall = runStub(program('START:  LD      HL,0033H', '        CALL    GO', 'WAIT:   JR      WAIT', 'GO:     JP      (HL)'));
    viaCall.runner.start();
    frames(viaCall.clock, 2);
    expect(viaCall.runner.state).toBe('stopped');
    expect(viaCall.runner.stopLine).toBe(5);
    expect(viaCall.runner.stopReason).toMatch(/^Line 5 jumps to \$VDCHAR, the ROM's routine at \$0033/);
    expect(viaCall.runner.stopReason).toMatch(/Model III ROM/);
    expect(viaCall.clock.pending()).toBe(0);
    // With no CALL behind it at all.
    const bare = runStub(program('START:  LD      HL,01C9H', '        JP      (HL)'));
    bare.runner.start();
    frames(bare.clock, 2);
    expect(bare.runner.stopLine).toBe(3);
    expect(bare.runner.stopReason).toMatch(/^Line 3 jumps to \$VDCLS/);
  });

  it('a PUSH and RET dispatch into the ROM names the RET line', () => {
    const { clock, runner } = runStub(program('START:  LD      HL,(TBL)', '        PUSH    HL', '        RET', 'TBL:    DW      01C9H'));
    runner.start();
    frames(clock, 2);
    expect(runner.stopLine).toBe(4);
    expect(runner.stopReason).toMatch(/^Line 4 returns to \$VDCLS/);
  });

  for (const model of [3, 1] as const) {
    it(`a final RET says the program returned to the ROM, on the Model ${model === 3 ? 'III' : 'I'}`, () => {
      const { clock, runner } = runStub(program('START:  LD      A,41H', '        LD      (3C00H),A', '        RET'), { model });
      runner.start();
      frames(clock, 2);
      expect(runner.state).toBe('stopped');
      expect(runner.stopLine).toBe(4);
      expect(runner.stopReason).toMatch(/^Line 4 returns \(RET\) to the ROM, but no ROM is loaded/);
      expect(runner.stopReason).toMatch(/JR WAIT|HALT/);
      expect(runner.stopReason).not.toMatch(/interrupt|EI/);
    });
  }

  it('the advice after a final RET offers HALT only where a HALT waits: the Model III and Model 4, not the Model I', () => {
    for (const model of [1, 3, 4] as const) {
      const { clock, runner } = runStub(program('START:  LD      A,41H', '        RET'), { model });
      runner.start();
      frames(clock, 2);
      expect(runner.stopLine, `Model ${model}`).toBe(3);
      expect(runner.stopReason, `Model ${model}`).toMatch(model === 1 ? /End the program with a loop that waits, such as WAIT: JR WAIT\.$/ : /End the program with a loop that waits, such as WAIT: JR WAIT, or with HALT\.$/);
    }
  });

  it('a jump into the Model I empty space says the memory is not there, not the interrupt sentence', () => {
    const { clock, runner } = runStub(program('START:  LD      HL,3400H', '        JP      (HL)'), { model: 1 });
    runner.start();
    frames(clock, 2);
    expect(runner.state).toBe('stopped');
    expect(runner.stopLine).toBe(3);
    expect(runner.stopReason).toMatch(/^Line 3 jumps to \$3400, where the Model I has no memory at all/);
    expect(runner.stopReason).not.toMatch(/EI|interrupts on/);
  });

  it('a computed jump to 0 reports $0000, not the stub address it halts at', () => {
    const { clock, runner } = runStub(program('START:  LD      HL,0', '        JP      (HL)'));
    runner.start();
    frames(clock, 2);
    expect(runner.stopLine).toBe(3);
    expect(runner.stopReason).toMatch(/^Line 3 jumps to \$RESET, the ROM's routine at \$0000/);
  });

  it('EI under the stub stops at $0038 with the interrupt sentence', () => {
    // The Model I's 40 Hz clock interrupt cannot be masked.
    const m1 = runStub(program('START:  LD      A,0', '        EI', 'WAIT:   JR      WAIT'), { model: 1 });
    m1.runner.start();
    frames(m1.clock, 6);
    expect(m1.runner.state).toBe('stopped');
    expect(m1.runner.stopLine).toBe(3);
    expect(m1.runner.stopReason).toMatch(/^Line 3 turns interrupts on/);
    expect(m1.runner.stopReason).toMatch(/\$0038/);
    expect(m1.runner.stopReason).toMatch(/Model I ROM/);
    expect(m1.runner.stopReason).toMatch(/remove the EI/i);
    // The Model III's are masked until a program (normally the ROM) unmasks one at port E0H.
    const m3 = runStub(program('START:  LD      A,4', '        OUT     (0E0H),A        ; unmask the clock', '        EI', 'WAIT:   JR      WAIT'));
    m3.runner.start();
    frames(m3.clock, 6);
    expect(m3.runner.state).toBe('stopped');
    expect(m3.runner.stopLine).toBe(4);
    expect(m3.runner.stopReason).toMatch(/^Line 4 turns interrupts on .*\$0038.*Model III ROM/);
  });

  it('EI on the Model III with every interrupt masked runs on, as the hardware does', () => {
    const { clock, runner } = runStub(program('START:  EI', 'WAIT:   JR      WAIT'));
    runner.start();
    frames(clock, 6);
    expect(runner.state).toBe('running');
  });

  it('IM 2 with its own handler, unmasked at E0H, runs with no stop and no refusal', () => {
    const src = program(
      'START:  DI', '        LD      A,70H', '        LD      I,A', '        IM      2', '        LD      A,4', '        OUT     (0E0H),A', '        EI',
      'WAIT:   LD      A,(CNT)', '        LD      (3C00H),A', '        JR      WAIT',
      'HND:    PUSH    AF', '        IN      A,(0ECH)        ; acknowledge the clock', '        LD      A,(CNT)', '        INC     A', '        LD      (CNT),A', '        POP     AF', '        EI', '        RETI',
      'CNT:    DB      0', '        ORG     70FEH', '        DW      HND', '        DW      HND',
    );
    const { clock, runner, machine, result } = runStub(src);
    expect(romUse(result, 3)).toBeNull();
    runner.start();
    frames(clock, 30);
    expect(runner.state).toBe('running');
    expect(machine.mem.read(0x3c00, 1)[0]).toBeGreaterThan(5); // the handler ran
  });

  it('an exception thrown by the emulator stops the run with a sentence', () => {
    const { clock, machine, runner } = runStub(starter);
    machine.run = () => {
      throw new Error('opcode table exploded');
    };
    runner.start();
    clock.frame();
    expect(runner.state).toBe('stopped');
    expect(runner.stopReason).toMatch(/^The emulator stopped/);
    expect(runner.stopReason).toMatch(/opcode table exploded/);
    expect(runner.stopReason).toMatch(/Run/);
    expect(clock.pending()).toBe(0);
  });
});

// The Model I's HALT line drives its reset switch's NMI (emu spec §5), so a halted CPU takes the NMI
// to $0066 at the next instruction; the Model III's waits for an interrupt.
describe("a Model I HALT, which the machine answers with the reset switch's NMI", () => {
  // Line 2 DI, 3 LD A,1, 4 HALT (at $5203).
  const HALTS = ['        ORG     5200H', 'START:  DI', '        LD      A,1', '        HALT', '        END     START', ''].join('\n');

  it('stops a stub run at the HALT with its sentence, before the NMI: PC past the HALT, SP where the program left it', () => {
    const { clock, machine, runner } = runStub(HALTS, { model: 1 });
    const sp = machine.cpu.regs.sp;
    runner.start();
    clock.frame();
    expect(runner.state).toBe('stopped');
    expect(runner.stopLine).toBe(4);
    expect(runner.stopReason).toBe(MODEL1_HALT(4));
    expect(MODEL1_HALT(4)).toBe(
      "Line 4 halts the CPU (HALT), and a Model I answers a HALT with a reset to BASIC (its HALT line drives the reset switch's NMI), which needs a ROM, and none is loaded. Add a Model I ROM in the Run tab, or end the program with a loop that waits, such as WAIT: JR WAIT.",
    );
    // Never the trap's sentence for the NMI's $0066 (NMIENTRY, or "inside the Model I ROM").
    expect(runner.stopReason).not.toMatch(/\$0066|NMIENTRY|inside the Model I ROM/);
    expect(machine.cpu.halted).toBe(true);
    expect(runner.pc).toBe(0x5204);
    expect(runner.pc).toBeGreaterThanOrEqual(romEnd(1));
    expect(machine.cpu.regs.sp).toBe(sp);
    expect(clock.pending()).toBe(0);
  });

  it('a step onto the HALT stops the stub run the same way', () => {
    const { machine, runner } = runStub(HALTS, { model: 1 });
    const sp = machine.cpu.regs.sp;
    runner.step(); // DI
    runner.step(); // LD A,1
    expect(runner.state).toBe('paused');
    runner.step(); // HALT
    expect(runner.state).toBe('stopped');
    expect(runner.stopLine).toBe(4);
    expect(runner.stopReason).toBe(MODEL1_HALT(4));
    expect(runner.pc).toBe(0x5204);
    expect(machine.cpu.regs.sp).toBe(sp);
  });

  it('on the Model III the same program waits at its HALT, as it always has: the run goes on', () => {
    const { clock, machine, runner } = runStub(HALTS);
    const sp = machine.cpu.regs.sp;
    runner.start();
    frames(clock, 3);
    expect(runner.state).toBe('running');
    expect(runner.stopReason).toBeNull();
    expect(machine.cpu.halted).toBe(true);
    expect(runner.pc).toBe(0x5204);
    expect(machine.cpu.regs.sp).toBe(sp);
  });

  it("on a ROM of the user's (here the stub with a loop at $0066), the HALT takes the NMI there and the run goes on", () => {
    const { clock, machine, runner } = runPatched(HALTS, { 0x0066: [0x18, 0xfe] }, { model: 1 });
    const sp = machine.cpu.regs.sp;
    runner.start();
    clock.frame();
    expect(runner.state).toBe('running');
    expect(runner.stopReason).toBeNull();
    expect(machine.cpu.halted).toBe(false);
    expect(runner.pc).toBe(0x0066);
    expect(machine.cpu.regs.sp).toBe((sp - 2) & 0xffff);
    expect([...machine.mem.read((sp - 2) & 0xffff, 2)]).toEqual([0x04, 0x52]); // the address after the HALT, $5204
  });
});

describe('the frame loop', () => {
  function spied() {
    const s = runStub(starter);
    const asked: number[] = [];
    const run = s.machine.run.bind(s.machine);
    s.machine.run = (opts) => {
      asked.push(opts?.cycles ?? NaN);
      return run(opts);
    };
    return { ...s, asked };
  }

  it('runs clockHz/60 T-states in a 60th of a second, and at most clockHz/30 after a 2 s gap', () => {
    const { clock, machine, runner, asked } = spied();
    const hz = machine.clockHz;
    runner.start();
    clock.frame(FRAME);
    expect(asked).toHaveLength(1);
    expect(Math.abs(asked[0]! - hz / 60)).toBeLessThanOrEqual(1);
    const before = machine.cycles;
    clock.frame(2000);
    expect(asked[1]!).toBeLessThanOrEqual(hz / 30);
    expect(machine.cycles - before).toBeLessThanOrEqual(hz / 30 + 30);
    // Overshoot is carried: over many frames the machine keeps time.
    const start = machine.cycles;
    frames(clock, 60);
    expect(Math.abs(machine.cycles - start - hz)).toBeLessThan(64);
  });

  it('follows the machine clock when it changes between frames (the Model 4 switches)', () => {
    const { clock, machine, runner, asked } = spied();
    const hz = machine.clockHz;
    runner.start();
    clock.frame(FRAME);
    Object.defineProperty(machine, 'clockHz', { get: () => hz * 2, configurable: true });
    clock.frame(FRAME);
    expect(Math.abs(asked[0]! - hz / 60)).toBeLessThanOrEqual(1);
    // The second frame pays for its own 60th at the new clock, less the first frame's overshoot.
    expect(Math.abs(asked[1]! - (2 * hz) / 60)).toBeLessThanOrEqual(30);
    expect(asked[1]!).toBeGreaterThan(hz / 60 + 1000);
  });

  it('calls onFrame after each slice', () => {
    const s = runStub(starter);
    const seen: number[] = [];
    const runner = createRunner({ machine: s.machine, result: s.result, stub: true, schedule: s.clock.schedule, cancel: s.clock.cancel, now: s.clock.now, onFrame: (r: Runner) => seen.push(r.pc) });
    runner.start();
    frames(s.clock, 3);
    expect(seen).toHaveLength(3);
  });

  it('pause, resume, and step move PC as expected', () => {
    const { result, clock, runner } = runStub(starter);
    const at = (name: string): number => result.symbol(name)!.value;
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('START'));
    runner.step();
    expect(runner.pc).toBe(at('START') + 3); // past LD HL,3C00H
    runner.step();
    expect(runner.pc).toBe(at('FILL'));
    clock.frame();
    expect(runner.pc).toBe(at('FILL')); // paused: nothing scheduled, nothing runs
    runner.resume();
    expect(runner.state).toBe('running');
    frames(clock, 4);
    expect(runner.pc).toBe(at('WAIT'));
    runner.pause();
    expect(runner.state).toBe('paused');
    expect(clock.pending()).toBe(0);
    runner.step(); // JR WAIT
    expect(runner.pc).toBe(at('WAIT'));
    runner.stop('Stopped.');
    expect(runner.state).toBe('stopped');
    expect(runner.stopReason).toBe('Stopped.');
    runner.resume();
    runner.step();
    expect(runner.state).toBe('stopped');
  });
});

describe('pausing at breakpoints (5C)', () => {
  const ONCE = program('START:  NOP', 'HERE:   INC     A', 'WAIT:   JR      WAIT');

  it('keeps the trace on for every run, off the stub too', () => {
    expect(runWith(ONCE).machine.debug.trace.enabled).toBe(true);
    expect(runPatched(ONCE, {}).machine.debug.trace.enabled).toBe(true);
  });

  it('a breakpoint stops the frame before its instruction, sets pausedBy, and calls onPause', () => {
    const src = program('START:  LD      A,41H', 'SHOW:   LD      (3C00H),A', 'WAIT:   JR      WAIT');
    const paused: Runner[] = [];
    const { clock, machine, result, runner } = runWith(src, { onPause: (r) => paused.push(r) });
    const show = result.symbol('SHOW')!.value;
    machine.debug.break(show);
    expect(runner.pausedBy).toBeNull();
    runner.start();
    clock.frame();
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(show);
    expect(runner.pausedBy).toEqual({ kind: 'break', id: machine.debug.breaks[0]!.id });
    expect(paused).toEqual([runner]);
    expect(machine.mem.read(0x3c00, 1)[0]).toBe(0x20); // the LD has not run
    expect(clock.pending()).toBe(0);
  });

  it('continue() from the breakpoint it stopped at does not stop there again', () => {
    const { clock, machine, result, runner } = runWith(ONCE);
    machine.debug.break(result.symbol('HERE')!.value);
    runner.start();
    clock.frame();
    expect(runner.pausedBy?.kind).toBe('break');
    const a = machine.cpu.regs.a;
    runner.continue();
    expect(runner.pausedBy).toBeNull();
    frames(clock, 2);
    expect(runner.state).toBe('running');
    expect(runner.pc).toBe(result.symbol('WAIT')!.value);
    expect(machine.cpu.regs.a).toBe((a + 1) & 0xff);
  });

  it('after a manual pause at a breakpoint address, continue() runs past it', () => {
    const paused: Runner[] = [];
    const { clock, machine, result, runner } = runWith(ONCE, { onPause: (r) => paused.push(r) });
    machine.debug.break(result.symbol('START')!.value);
    runner.start();
    runner.pause(); // before the first frame: PC is still at START, on the breakpoint
    expect(runner.pausedBy).toEqual({ kind: 'pause' });
    expect(paused).toHaveLength(1);
    runner.continue();
    frames(clock, 2);
    expect(runner.state).toBe('running');
    expect(runner.pc).toBe(result.symbol('WAIT')!.value);
  });

  it('continue() after a step runs the instruction at PC even when an interrupt is pending there', () => {
    // IM 2 with the clock unmasked at E0H: the handler counts nothing, it only acknowledges.
    const src = program(
      'START:  DI', '        LD      A,70H', '        LD      I,A', '        IM      2', '        LD      A,4', '        OUT     (0E0H),A', '        LD      HL,0', '        EI',
      'WAIT:   INC     HL', '        JR      WAIT',
      'HND:    PUSH    AF', '        IN      A,(0ECH)', '        POP     AF', '        EI', '        RETI',
      '        ORG     70FEH', '        DW      HND', '        DW      HND',
    );
    // Find how many steps in the first interrupt is taken: emu is deterministic, so a second run
    // stepped one fewer times sits at a boundary with that interrupt pending.
    const probe = runWith(src);
    const hnd = probe.result.symbol('HND')!.value;
    let k = 0;
    for (; k < 200_000; k++) {
      probe.machine.step();
      if (probe.machine.debug.trace.last(1)[0]!.pc === hnd) break;
    }
    expect(probe.machine.debug.trace.last(1)[0]!.pc).toBe(hnd);
    const { clock, machine, runner } = runWith(src);
    for (let s = 0; s < k; s++) runner.step();
    const pc = runner.pc;
    expect(runner.pausedBy?.kind).toBe('step');
    machine.debug.break(pc);
    runner.continue();
    clock.frame();
    // It paused at PC again, but only after the loop came round: the instruction at PC ran after the handler's RETI.
    const entries = machine.debug.trace.last(64);
    const reti = entries.findIndex((e) => e.bytes[0] === 0xed && e.bytes[1] === 0x4d);
    expect(reti).toBeGreaterThanOrEqual(0);
    expect(entries.slice(reti + 1).some((e) => e.pc === pc)).toBe(true);
    expect(runner.pc).toBe(pc);
  });

  it('start() honours a breakpoint on the entry line', () => {
    const { clock, machine, result, runner } = runWith(ONCE);
    machine.debug.break(result.symbol('START')!.value);
    runner.start();
    clock.frame();
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(result.symbol('START')!.value);
  });

  it('a step sets pausedBy to step and calls onPause', () => {
    const paused: Runner[] = [];
    const { runner } = runWith(ONCE, { onPause: (r) => paused.push(r) });
    runner.step();
    expect(runner.pausedBy).toEqual({ kind: 'step' });
    expect(paused).toHaveLength(1);
  });
});
