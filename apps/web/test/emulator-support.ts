// Shared by the 5C runtime tests: assembling a program, a fake animation-frame clock, and a
// machine on the stub ROM (or on the stub patched with test code, for a handler or a ROM loop).
import { expect } from 'vitest';
import { assemble, toCmd } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { Machine } from '@fugloy/emu';
import { prepareMachine } from '../app/utils/emulator/boot';
import { createRunner } from '../app/utils/emulator/runner';
import type { Runner, RunnerOptions } from '../app/utils/emulator/runner';
import { stubRom } from '../app/utils/emulator/stub-rom';

export const FRAME = 1000 / 60;

export const asm = (text: string, model: 1 | 3 | 4 = 3): AsmResult => {
  const r = assemble(text, { model });
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return r;
};

/** A program at 7000H that starts at START. */
export const program = (...lines: string[]): string => ['        ORG     7000H', ...lines, '        END     START', ''].join('\n');

/** The source line (1-based) whose text contains `needle`. */
export const lineWith = (text: string, needle: string): number => {
  const k = text.split('\n').findIndex((l) => l.includes(needle));
  expect(k).toBeGreaterThanOrEqual(0);
  return k + 1;
};

/** A fake animation-frame clock: `frame(ms)` advances time and runs the queued callback. */
export function fakeClock() {
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
export type FakeClock = ReturnType<typeof fakeClock>;

export const frames = (clock: FakeClock, n: number): void => {
  for (let k = 0; k < n; k++) clock.frame();
};

type Extra = Partial<Pick<RunnerOptions, 'onPause' | 'onStop' | 'onFrame'>>;

/** A program on the stub ROM, in a runner on a fake clock (not started). */
export function runStub(source: string, extra: Extra = {}) {
  const result = asm(source);
  const clock = fakeClock();
  const machine = prepareMachine({ model: 3, rom: stubRom(3), result });
  const runner: Runner = createRunner({ machine, result, stub: true, schedule: clock.schedule, cancel: clock.cancel, now: clock.now, ...extra });
  return { result, clock, machine, runner };
}

/**
 * A program on the stub ROM (the Model III's, or `model`'s) with `patches` written into the ROM
 * (address → bytes), booted to the stub's HALT and loaded by hand. The runner is not the stub's (no
 * ROM trap): the ROM stands in for the user's, so the program may call the patched code.
 */
export function runPatched(source: string, patches: Record<number, number[]>, { model = 3, ...extra }: Extra & { model?: 1 | 3 | 4 } = {}) {
  const result = asm(source, model);
  const rom = stubRom(model).slice();
  for (const [at, bytes] of Object.entries(patches)) rom.set(bytes, Number(at));
  const machine = new Machine({ model, roms: { level2: rom } });
  expect(machine.run({ until: 'halt', cycles: machine.clockHz }).reason).toBe('halt');
  machine.load.cmd(toCmd(result));
  const clock = fakeClock();
  const runner: Runner = createRunner({ machine, result, stub: false, schedule: clock.schedule, cancel: clock.cancel, now: clock.now, ...extra });
  return { result, clock, machine, runner };
}
