// The Run tab's DOM-free runtime on the stub ROM (Ruling 5), so it runs in CI with no ROM: the
// stub boot, the static ROM check, the HALT trap, the frame budget on a fake clock, and the
// runner's controls.
import { describe, expect, it } from 'vitest';
import { assemble } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { Machine } from '@fugloy/emu';
import starter from '@fugloy/asm-examples/clear-screen.z?raw';
import { stubRom, STUB_ROM_SOURCE } from '../app/utils/emulator/stub-rom';
import { bootedSnapshot, prepareMachine } from '../app/utils/emulator/boot';
import { createRunner } from '../app/utils/emulator/runner';
import type { Runner } from '../app/utils/emulator/runner';
import { romUse } from '../app/utils/emulator/rom-use';

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

  it('a computed JP (HL) into the ROM stops at the trap with the caller line', () => {
    const { clock, runner } = runStub(program('START:  LD      HL,0033H', '        CALL    GO', 'WAIT:   JR      WAIT', 'GO:     JP      (HL)'));
    runner.start();
    frames(clock, 2);
    expect(runner.state).toBe('stopped');
    expect(runner.stopLine).toBe(3);
    expect(runner.stopReason).toMatch(/\$0033/);
    expect(runner.stopReason).toMatch(/line 3/);
    expect(runner.stopReason).toMatch(/ROM/);
    expect(clock.pending()).toBe(0);
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
