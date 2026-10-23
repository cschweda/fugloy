// 5C Task 1, Rulings 8 and 9: breakpoints, Step, Step Over, Run to Here, and Continue over emu's
// breakpoints, on the stub ROM through runOnce (as a Run does), or on a patched stub for RST 08H.
import { describe, expect, it, vi } from 'vitest';
import * as kit from '../app/utils/emulator/kit';
import { breakAddress, createStepper, HALTED_INTERRUPTS_OFF, inactiveReason, stepOverTargets } from '../app/utils/emulator/stepping';
import type { Runner } from '../app/utils/emulator/runner';
import { asm, fakeClock, frames, lineWith, program, runPatched } from './emulator-support';

/** One Run of `src` on the stub ROM with `breakpoints` (source lines), not started. */
function run(src: string, breakpoints: number[] = []) {
  const clock = fakeClock();
  const onPause = vi.fn<(r: Runner) => void>();
  const out = kit.runOnce(kit, { text: src, model: 3, rom: null, breakpoints, runner: { schedule: clock.schedule, cancel: clock.cancel, now: clock.now, onPause } });
  expect(out.problem).toBe(false);
  const runner = out.runner!;
  const stepper = out.stepper!;
  const m = runner.machine;
  const at = (label: string): number => out.result.symbol(label)!.value;
  /** The breakpoints left in emu that are not the user's. */
  const temps = (): number => m.debug.breaks.filter((b) => b.once).length;
  return { clock, out, runner, stepper, m, at, onPause, temps };
}

const SUB = program(
  'START:  LD      A,0',
  '        CALL    SUB',
  'NEXT:   LD      (3C00H),A',
  'WAIT:   JR      WAIT',
  'SUB:    LD      A,41H',
  'INSUB:  INC     A',
  '        RET',
);

describe('breakAddress and stepOverTargets', () => {
  it("a line's breakpoint is its first address; a line with no code has none", () => {
    const r = asm(SUB);
    expect(breakAddress(r, lineWith(SUB, 'CALL'))).toBe(r.symbol('START')!.value + 2);
    expect(breakAddress(r, 1)).toBeNull(); // ORG
    expect(breakAddress(r, 999)).toBeNull();
  });

  it('decodes CALL, CALL cc, RST, and the block repeats; anything else is a plain step', () => {
    // RST 08H needs the ROM, so this is not a stub Run.
    const p = runPatched(program('START:  CALL    NZ,S', '        RST     08H', '        LDIR', '        NOP', 'S:      RET'), {});
    const m = p.machine;
    const at = (label: string): number => p.result.symbol(label)!.value;
    expect(stepOverTargets(m)).toEqual([at('START') + 3]);
    // Move PC by hand through the other lines.
    const set = (pc: number) => {
      (m.system.cpu as unknown as { registers: { PC: number } }).registers.PC = pc;
    };
    set(at('START') + 3);
    expect(stepOverTargets(m)).toEqual([at('START') + 4, at('START') + 5]); // RST 08H and its inline byte
    set(at('START') + 4);
    expect(stepOverTargets(m)).toEqual([at('START') + 6]); // LDIR
    set(at('START') + 6);
    expect(stepOverTargets(m)).toBeNull(); // NOP
  });
});

describe('the stepper', () => {
  it("Step Over on CALL SUB stops at the next line with SUB's effects done", () => {
    const { clock, runner, stepper, m, at, onPause, temps } = run(SUB);
    stepper.step();
    expect(runner.pc).toBe(at('START') + 2);
    expect(stepper.stepOver()).toBeNull();
    expect(runner.state).toBe('running');
    frames(clock, 2);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('NEXT'));
    expect(m.cpu.regs.a).toBe(0x42);
    expect(runner.pausedBy?.kind).toBe('break');
    expect(onPause).toHaveBeenCalled();
    expect(temps()).toBe(0);
    expect(m.debug.breaks).toEqual([]);
  });

  it('Step Over on a CALL cc that is not taken stops at the next line', () => {
    const src = program('START:  XOR     A', '        CALL    NZ,SUB', 'NEXT:   INC     A', 'WAIT:   JR      WAIT', 'SUB:    LD      A,41H', '        RET');
    const { clock, runner, stepper, m, at, temps } = run(src);
    stepper.step(); // XOR A: Z set, so CALL NZ is not taken
    stepper.stepOver();
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('NEXT'));
    expect(m.cpu.regs.a).toBe(0);
    expect(temps()).toBe(0);
  });

  it('Step Over when paused by a step with a user breakpoint on the CALL line runs SUB and stops after it', () => {
    const { clock, runner, stepper, m, at, temps } = run(SUB, [lineWith(SUB, 'CALL')]);
    stepper.step();
    expect(runner.pausedBy?.kind).toBe('step');
    expect(runner.pc).toBe(at('START') + 2);
    stepper.stepOver();
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('NEXT'));
    expect(m.cpu.regs.a).toBe(0x42);
    expect(temps()).toBe(0);
    expect(m.debug.breaks).toHaveLength(1); // the user's, still set
  });

  it('Continue after a finished Step Over does not stop again at that PC', () => {
    const src = program('START:  CALL    SUB', 'NEXT:   LD      A,1', 'WAIT:   JR      WAIT', 'SUB:    RET');
    const { clock, runner, stepper, m, at } = run(src);
    stepper.stepOver();
    frames(clock, 1);
    expect(runner.pc).toBe(at('NEXT'));
    expect(runner.pausedBy?.kind).toBe('break');
    expect(m.debug.breaks).toEqual([]); // the temp that stopped it has gone
    stepper.continue();
    frames(clock, 1);
    expect(runner.state).toBe('running');
    expect(runner.pc).toBe(at('WAIT'));
    expect(m.cpu.regs.a).toBe(1);
  });

  it('on recursion, Step Over stops only when SP is back', () => {
    const src = program(
      'START:  LD      A,0',
      '        LD      B,3',
      '        CALL    REC',
      'WAIT:   JR      WAIT',
      'REC:    DEC     B',
      'AGAIN:  CALL    NZ,REC',
      'BACK:   INC     A',
      '        RET',
    );
    const { clock, runner, stepper, m, at, temps } = run(src);
    while (runner.pc !== at('AGAIN')) stepper.step();
    const sp0 = m.cpu.regs.sp;
    stepper.stepOver();
    frames(clock, 2);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('BACK'));
    expect(m.cpu.regs.sp).toBe(sp0);
    expect(m.cpu.regs.a).toBe(2); // the two inner levels returned; this one has not
    expect(temps()).toBe(0);
  });

  it('on RST 08H with its inline byte, Step Over stops past the byte', () => {
    // A synthetic RST 08H handler at $0008 that skips the inline byte: EX (SP),HL; INC HL; EX (SP),HL; RET.
    // It overwrites part of the stub's start-up code, so the program sets its own stack.
    const src = program('START:  LD      SP,0', 'CALLER: RST     08H', '        DB      55H', 'NEXT:   LD      A,1', 'WAIT:   JR      WAIT');
    let stepper: ReturnType<typeof createStepper>;
    const p = runPatched(src, { 0x0008: [0xe3, 0x23, 0xe3, 0xc9] }, { onPause: () => stepper.clearTemps(), onStop: () => stepper.clearTemps() });
    stepper = createStepper(p.runner);
    stepper.step();
    expect(p.runner.pc).toBe(p.result.symbol('CALLER')!.value);
    stepper.stepOver();
    frames(p.clock, 2);
    expect(p.runner.state).toBe('paused');
    expect(p.runner.pc).toBe(p.result.symbol('NEXT')!.value);
    expect(p.runner.pausedBy?.kind).toBe('break');
    expect(p.machine.debug.breaks).toEqual([]); // the pc+1 breakpoint went too
  });

  it('on LDIR, Step Over stops after the whole block', () => {
    const src = program('START:  LD      HL,SRC', '        LD      DE,3C00H', '        LD      BC,5', '        LDIR', 'NEXT:   NOP', 'WAIT:   JR      WAIT', 'SRC:    DB      "HELLO"');
    const { clock, runner, stepper, m, at, temps } = run(src);
    for (let k = 0; k < 3; k++) stepper.step();
    stepper.stepOver();
    frames(clock, 1);
    expect(runner.pc).toBe(at('NEXT'));
    expect(m.cpu.regs.b * 256 + m.cpu.regs.c).toBe(0);
    expect(m.video.text()[0]!.slice(0, 5)).toBe('HELLO');
    expect(temps()).toBe(0);
  });

  describe('a breakpoint on a repeating block instruction (LDIR and its kin)', () => {
    const COPY5 = program('START:  LD      HL,SRC', '        LD      DE,3C00H', '        LD      BC,5', '        LDIR', 'NEXT:   NOP', 'WAIT:   JR      WAIT', 'SRC:    DB      "HELLO"');
    /** 16K iterations: several frames of LDIR, so a pause can land mid-block. */
    const COPY16K = program('START:  LD      HL,8000H', '        LD      DE,9000H', '        LD      BC,4000H', '        LDIR', 'NEXT:   NOP', 'WAIT:   JR      WAIT');
    const bc = (m: { cpu: { regs: { b: number; c: number } } }): number => m.cpu.regs.b * 256 + m.cpu.regs.c;

    it('with BC=5 stops once, before the block starts, and Continue finishes the block', () => {
      const { clock, runner, stepper, m, at, onPause } = run(COPY5, [lineWith(COPY5, 'LDIR')]);
      const ldir = at('NEXT') - 2;
      runner.start();
      frames(clock, 1);
      expect(runner.state).toBe('paused');
      expect(runner.pc).toBe(ldir);
      expect(runner.pausedBy?.kind).toBe('break');
      expect(bc(m)).toBe(5);
      expect(onPause).toHaveBeenCalledTimes(1);
      expect(stepper.continue()).toBeNull();
      frames(clock, 2);
      expect(runner.state).toBe('running');
      expect(onPause).toHaveBeenCalledTimes(1);
      expect(runner.pc).toBe(at('WAIT'));
      expect(bc(m)).toBe(0);
      expect(m.video.text()[0]!.slice(0, 5)).toBe('HELLO');
    });

    it('a second pass over the line stops again (once per start, not per iteration)', () => {
      const src = program('START:  LD      B,2', 'AGAIN:  PUSH    BC', '        LD      HL,SRC', '        LD      DE,3C00H', '        LD      BC,5', '        LDIR', '        POP     BC', '        DJNZ    AGAIN', 'WAIT:   JR      WAIT', 'SRC:    DB      "HELLO"');
      const { clock, runner, stepper, onPause, at } = run(src, [lineWith(src, 'LDIR')]);
      runner.start();
      frames(clock, 1);
      expect(onPause).toHaveBeenCalledTimes(1);
      stepper.continue();
      frames(clock, 1);
      expect(onPause).toHaveBeenCalledTimes(2);
      stepper.continue();
      frames(clock, 2);
      expect(onPause).toHaveBeenCalledTimes(2);
      expect(runner.pc).toBe(at('WAIT'));
    });

    it('a pause mid-block, then Continue, runs on until PC leaves it', () => {
      const { clock, runner, stepper, m, at, onPause } = run(COPY16K, [lineWith(COPY16K, 'LDIR')]);
      const ldir = at('NEXT') - 2;
      runner.start();
      frames(clock, 1);
      expect(runner.pc).toBe(ldir);
      stepper.continue();
      frames(clock, 2);
      expect(runner.state).toBe('running');
      runner.pause();
      expect(runner.pausedBy?.kind).toBe('pause');
      expect(runner.pc).toBe(ldir);
      expect(bc(m)).toBeGreaterThan(0);
      expect(bc(m)).toBeLessThan(0x4000);
      stepper.continue();
      frames(clock, 20);
      expect(runner.state).toBe('running');
      expect(runner.pc).toBe(at('WAIT'));
      expect(bc(m)).toBe(0);
      expect(onPause).toHaveBeenCalledTimes(2); // the breakpoint and the pause, nothing more
    });

    it('a step mid-block, then Continue, runs on until PC leaves it', () => {
      const { clock, runner, stepper, m, at, onPause } = run(COPY5, [lineWith(COPY5, 'LDIR')]);
      runner.start();
      frames(clock, 1);
      stepper.step();
      stepper.step();
      expect(runner.pc).toBe(at('NEXT') - 2);
      expect(bc(m)).toBe(3);
      stepper.continue();
      frames(clock, 2);
      expect(runner.state).toBe('running');
      expect(runner.pc).toBe(at('WAIT'));
      expect(onPause).toHaveBeenCalledTimes(3);
    });

    it('Step Over on it completes the whole block and stops at the next line', () => {
      const { clock, runner, stepper, m, at, temps } = run(COPY16K, [lineWith(COPY16K, 'LDIR')]);
      runner.start();
      frames(clock, 1);
      expect(runner.pc).toBe(at('NEXT') - 2);
      expect(stepper.stepOver()).toBeNull();
      frames(clock, 20);
      expect(runner.state).toBe('paused');
      expect(runner.pc).toBe(at('NEXT'));
      expect(runner.pausedBy?.kind).toBe('break');
      expect(stepper.wasTemp(runner.pausedBy!.id!)).toBe(true);
      expect(bc(m)).toBe(0);
      expect(temps()).toBe(0);
      expect(m.debug.breaks).toHaveLength(1); // the user's, still set
    });

    it('Run to Here on an LDIR line stops once, before the block starts', () => {
      const { clock, runner, stepper, m, out, onPause } = run(COPY5);
      const addr = breakAddress(out.result, lineWith(COPY5, 'LDIR'))!;
      runner.start();
      runner.pause();
      stepper.runTo([addr], lineWith(COPY5, 'LDIR'));
      frames(clock, 1);
      expect(runner.pc).toBe(addr);
      expect(bc(m)).toBe(5);
      expect(onPause).toHaveBeenCalledTimes(2);
    });
  });

  it('a user breakpoint inside SUB wins over Step Over', () => {
    const { clock, runner, stepper, m, at, temps } = run(SUB, [lineWith(SUB, 'INSUB')]);
    stepper.step();
    stepper.stepOver();
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('INSUB'));
    expect(temps()).toBe(0);
    expect(m.debug.breaks).toHaveLength(1);
    // Continue from there runs on to the end, not stopping at INSUB again.
    stepper.continue();
    frames(clock, 1);
    expect(runner.state).toBe('running');
    expect(runner.pc).toBe(at('WAIT'));
  });

  it('Run to Here stops at the line, and leaves no breakpoint behind', () => {
    const { clock, runner, stepper, out, temps } = run(SUB);
    const addr = breakAddress(out.result, lineWith(SUB, 'WAIT:'))!;
    stepper.runTo([addr]);
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(addr);
    expect(temps()).toBe(0);
  });

  it('Step and Step Over while running pause first; the next press steps', () => {
    const { clock, runner, stepper } = run(SUB);
    runner.start();
    frames(clock, 1);
    const pc = runner.pc;
    stepper.step();
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(pc);
    runner.resume();
    stepper.stepOver();
    expect(runner.state).toBe('paused');
  });

  it('a stop removes the temporary breakpoints', () => {
    const { runner, stepper, m, at } = run(SUB);
    stepper.runTo([at('WAIT')]);
    expect(m.debug.breaks).toHaveLength(1);
    runner.stop('Stopped.');
    expect(m.debug.breaks).toEqual([]);
  });

  it('setBreakpoints adds and removes emu breakpoints, and reports lines with no code', () => {
    const { stepper, m, at } = run(SUB);
    expect(stepper.setBreakpoints([lineWith(SUB, 'INSUB'), 1])).toEqual({ inactive: [1] });
    expect(m.debug.breaks.map((b) => b.addr)).toEqual([at('INSUB')]);
    stepper.setBreakpoints([lineWith(SUB, 'NEXT:'), lineWith(SUB, 'INSUB')]);
    expect(m.debug.breaks.map((b) => b.addr).sort()).toEqual([at('NEXT'), at('INSUB')].sort());
    stepper.setBreakpoints([]);
    expect(m.debug.breaks).toEqual([]);
  });

  it('data lines (DB, DW, DS) are inactive, with their own sentence', () => {
    const src = program('START:  NOP', 'WAIT:   JR      WAIT', 'TBL:    DB      1,2', '        DW      1234H', '        DS      4', 'MSG:    DEFM    "HI"');
    const { stepper, m, out } = run(src);
    const lines = ['DB', 'DW', 'DS', 'DEFM'].map((d) => lineWith(src, `${d}  `));
    expect(stepper.setBreakpoints([...lines, lineWith(src, 'START')]).inactive).toEqual(lines);
    expect(m.debug.breaks.map((b) => b.addr)).toEqual([out.result.symbol('START')!.value]);
    expect(inactiveReason(out.result, lines[0]!)).toBe(`Line ${lines[0]} holds data, not an instruction to stop at.`);
    expect(inactiveReason(out.result, 1)).toBe('Line 1 has no instruction to stop at.');
    expect(inactiveReason(out.result, lineWith(src, 'START'))).toBeNull();
  });

  it('Run to Here on a line at a shared address stops only where its bytes are', () => {
    // OLD runs at $7000 first (CALLed); then NEW is copied over it and run there.
    const src = [
      '        ORG     7000H',
      'OLD:    RET',
      'START:  CALL    OLD',
      '        LD      HL,BLK',
      '        LD      DE,7000H',
      '        LD      BC,BLKEND-BLK',
      '        LDIR',
      '        JP      7000H',
      'BLK:',
      '        .PHASE  7000H',
      'NEW:    INC     A',
      '        JR      NEW',
      '        .DEPHASE',
      'BLKEND:',
      '        END     START',
      '',
    ].join('\n');
    const { clock, runner, stepper, m, out } = run(src);
    const line = lineWith(src, 'NEW:');
    expect(breakAddress(out.result, line)).toBe(0x7000);
    stepper.runTo([0x7000], line);
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(0x7000);
    expect(m.mem.read(0x7000, 1)[0]).toBe(0x3c); // NEW's INC A, not OLD's RET
    expect(m.debug.breaks).toEqual([]);
    // Without the line, a plain Run to Here stops at OLD's RET.
    const plain = run(src);
    plain.stepper.runTo([0x7000]);
    frames(plain.clock, 1);
    expect(plain.m.mem.read(0x7000, 1)[0]).toBe(0xc9);
  });

  it('a breakpoint at a shared address stops only on the line whose bytes are there', () => {
    const src = program(
      'START:  JP      MOVE',
      'MOVE:   LD      HL,BLK',
      '        LD      DE,7000H',
      '        LD      BC,BLKEND-BLK',
      '        LDIR',
      'GO:     JP      7000H',
      'BLK:',
      '        .PHASE  7000H',
      'NEW:    INC     A',
      '        JR      NEW',
      '        .DEPHASE',
      'BLKEND:',
    );
    const { clock, runner, m } = run(src, [lineWith(src, 'NEW:')]);
    // START is at $7000 too, and runs first: the breakpoint must not stop there.
    runner.start();
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(0x7000);
    expect(m.mem.read(0x7000, 1)[0]).toBe(0x3c); // INC A, copied in
  });

  it('a HALT with interrupts off gives the sentence, and nothing moves', () => {
    const { runner, stepper, at } = run(program('START:  DI', '        HALT', 'NEXT:   NOP'));
    stepper.step();
    stepper.step();
    const pc = runner.pc;
    expect(stepper.step()).toBe(HALTED_INTERRUPTS_OFF);
    expect(stepper.stepOver()).toBe(HALTED_INTERRUPTS_OFF);
    expect(stepper.continue()).toBe(HALTED_INTERRUPTS_OFF);
    expect(HALTED_INTERRUPTS_OFF).toBe('The CPU is halted (HALT) with interrupts off, so it will not move on. Press Stop, then Run.');
    expect(runner.pc).toBe(pc);
    expect(runner.state).toBe('paused');
    expect(at('NEXT')).toBe(pc);
  });

  it("on a Model I a halted CPU is never stuck: its HALT's NMI takes the next action to $0066, and none returns a sentence", () => {
    // The Model I's HALT line drives its reset switch's NMI (emu spec §5). On the user's ROM (here the
    // stub with a loop at $0066; a stub Run stops at the HALT itself), the CPU halted with interrupts off moves on.
    const src = program('START:  DI', '        HALT', 'NEXT:   NOP');
    const halted = () => {
      let stepper!: ReturnType<typeof createStepper>;
      const p = runPatched(src, { 0x0066: [0x18, 0xfe] }, { model: 1, onPause: () => stepper.clearTemps(), onStop: () => stepper.clearTemps() });
      stepper = createStepper(p.runner);
      expect(stepper.step()).toBeNull(); // DI
      expect(stepper.step()).toBeNull(); // HALT
      expect(p.machine.cpu.halted).toBe(true);
      expect(p.machine.cpu.regs.iff1).toBe(false);
      return { ...p, stepper };
    };
    for (const action of ['step', 'stepOver', 'continue'] as const) {
      const { clock, machine, runner, stepper } = halted();
      // Null: neither HALTED_INTERRUPTS_OFF nor HALTED_WAITING (which only useDebug adds).
      expect(stepper[action](), action).toBeNull();
      frames(clock, 1);
      expect(machine.cpu.halted, action).toBe(false);
      expect(runner.pc, action).toBe(0x0066);
      expect(runner.state, action).toBe(action === 'continue' ? 'running' : 'paused');
    }
  });
});

describe('runOnce with breakpoints', () => {
  it('applies the initial breakpoints before the first frame and reports the inactive lines', () => {
    const { clock, runner, out, at, onPause } = run(SUB, [lineWith(SUB, 'NEXT:'), 1]);
    expect(out.inactive).toEqual([1]);
    runner.start();
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('NEXT'));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('a breakpoint on the entry line stops before it runs', () => {
    const { clock, runner, at } = run(SUB, [lineWith(SUB, 'START:')]);
    runner.start();
    frames(clock, 1);
    expect(runner.state).toBe('paused');
    expect(runner.pc).toBe(at('START'));
  });
});
