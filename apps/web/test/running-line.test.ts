// 5C Task 1, Ruling 2: the running PC and its trail mapped to source lines, from emu's trace.
import { describe, expect, it } from 'vitest';
import type { Machine } from '@fugloy/emu';
import { lineAt, lineMarks, marksKey, trailOf } from '../app/utils/emulator/running';
import type { TrailState } from '../app/utils/emulator/running';
import { frames, lineWith, program, runPatched, runStub } from './emulator-support';

const memOf = (m: Machine) => (a: number, n: number) => m.mem.read(a, n);

/** Records every trace.last(n) the machine is asked for. */
function spyTrace(m: Machine): number[] {
  const asked: number[] = [];
  const last = m.debug.trace.last.bind(m.debug.trace);
  m.debug.trace.last = (n: number) => {
    asked.push(n);
    return last(n);
  };
  return asked;
}

describe('the trail', () => {
  it('in a 3-line loop, now and the trail are exactly those lines, each once', () => {
    // The plan's L: INC A / DEC B / JR L, with the label LP (L is a register name).
    const src = program('START:  LD      A,0', 'LP:     INC     A', '        DEC     B', '        JR      LP');
    const { clock, machine, result, runner } = runStub(src);
    runner.start();
    frames(clock, 2);
    const t = trailOf(machine, result);
    expect(t.now).toBe(lineAt(result, machine.cpu.regs.pc, memOf(machine)));
    expect(t.now).not.toBeNull();
    const all = [t.now!, ...t.trail];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort((a, b) => a - b)).toEqual([lineWith(src, 'INC'), lineWith(src, 'DEC'), lineWith(src, 'JR ')]);
    expect(t.out).toBeNull();
  });

  it('looks each address up once per Run (linesOf is cached)', () => {
    const src = program('START:  LD      A,0', 'LP:     INC     A', '        DEC     B', '        JR      LP');
    const { clock, machine, result, runner } = runStub(src);
    let calls = 0;
    const linesOf = result.sourceMap.linesOf.bind(result.sourceMap);
    result.sourceMap.linesOf = (a: number) => {
      calls++;
      return linesOf(a);
    };
    runner.start();
    frames(clock, 1);
    const t = trailOf(machine, result);
    expect(calls).toBeLessThanOrEqual(4); // three loop lines and, at most, LD A,0
    frames(clock, 1);
    calls = 0;
    expect(trailOf(machine, result, t).trail).toHaveLength(2);
    expect(calls).toBe(0);
  });

  it('keeps at most 5 trail lines, newest first', () => {
    const body = ['A', 'B', 'C', 'D', 'E', 'H', 'L'].map((r) => `        INC     ${r}`);
    const src = program('START:  NOP', 'LP:     NOP', ...body, '        JR      LP');
    const { clock, machine, result, runner } = runStub(src);
    runner.start();
    frames(clock, 2);
    runner.pause();
    // Step to the line after INC A, so the newest trail entry is INC A's line.
    while (machine.cpu.regs.pc !== result.symbol('LP')!.value + 2) runner.step();
    const t = trailOf(machine, result);
    expect(t.now).toBe(lineWith(src, 'INC     B'));
    expect(t.trail).toHaveLength(5);
    expect(t.trail[0]).toBe(lineWith(src, 'INC     A'));
    expect(t.trail[1]).toBe(lineWith(src, 'LP:     NOP'));
    expect(t.trail[2]).toBe(lineWith(src, 'JR      LP'));
  });

  it('where a block is copied over its own code, the line whose bytes match is the one running', () => {
    const src = program(
      'START:  JP      MOVE', // 7000: C3 lo hi, overwritten by NEW's bytes
      'MOVE:   LD      HL,BLK',
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
    );
    const { clock, machine, result, runner } = runStub(src);
    expect(result.sourceMap.linesOf(0x7000).map((c) => c.line)).toEqual([lineWith(src, 'START'), lineWith(src, 'NEW:')]);
    // Before the copy, $7000 holds START's JP.
    expect(lineAt(result, 0x7000, memOf(machine))).toBe(lineWith(src, 'START'));
    runner.start();
    frames(clock, 2);
    expect(lineAt(result, 0x7000, memOf(machine))).toBe(lineWith(src, 'NEW:'));
    expect(lineAt(result, 0x7001, memOf(machine))).toBe(lineWith(src, 'JR      NEW'));
    const t = trailOf(machine, result);
    expect([t.now!, ...t.trail].sort((a, b) => a - b)).toEqual([lineWith(src, 'NEW:'), lineWith(src, 'JR      NEW')]);
    // A trace entry is matched by its own bytes, whatever memory holds now.
    expect(lineAt(result, 0x7000, () => [0xc3, 0x03, 0x70])).toBe(lineWith(src, 'START'));
    expect(lineAt(result, 0x7000, () => [0x00])).toBeNull();
  });

  it('with PC in a ROM loop, out is the calling line, found once and kept without searching again', () => {
    // A loop at $0100 in the patched stub ROM: LOOP: JR LOOP.
    const src = program('START:  LD      A,1', '        CALL    0100H', 'WAIT:   JR      WAIT');
    const { clock, machine, result, runner } = runPatched(src, { 0x0100: [0x18, 0xfe] });
    runner.start();
    frames(clock, 1);
    expect(machine.cpu.regs.pc).toBe(0x0100);
    const asked = spyTrace(machine);
    const t1 = trailOf(machine, result);
    expect(t1).toEqual({ now: null, trail: [], out: lineWith(src, 'CALL') });
    expect(asked[0]).toBe(256);
    expect(asked.length).toBeGreaterThan(1); // the deep search
    frames(clock, 1);
    asked.length = 0;
    const t2 = trailOf(machine, result, t1);
    expect(t2.out).toBe(lineWith(src, 'CALL'));
    expect(asked).toEqual([256]);
  });

  it('a failed deep search is not repeated on the next frame', () => {
    const src = program('START:  LD      A,1', '        CALL    0100H', 'WAIT:   JR      WAIT');
    const { clock, machine, result, runner } = runPatched(src, { 0x0100: [0x18, 0xfe] });
    runner.start();
    frames(clock, 40); // far more than the trace's 65,536 instructions in the ROM loop
    const asked = spyTrace(machine);
    const t1 = trailOf(machine, result);
    expect(t1).toEqual({ now: null, trail: [], out: null });
    frames(clock, 1);
    asked.length = 0;
    trailOf(machine, result, t1);
    expect(asked).toEqual([256]);
  });

  it('on a halted CPU, now is the HALT line, not the line after it', () => {
    const src = program('START:  DI', '        HALT', 'NEXT:   NOP');
    const { machine, result, runner } = runStub(src);
    runner.step();
    runner.step();
    expect(trailOf(machine, result).now).toBe(lineWith(src, 'HALT'));
  });
});

describe('line marks', () => {
  const t: TrailState = { now: 12, trail: [11, 10, 9, 8, 7], out: null };

  it('running: now, then trail 1 to 5', () => {
    expect(lineMarks(t, 'running', false)).toEqual([
      { line: 7, class: 'fg-run-trail-5' },
      { line: 8, class: 'fg-run-trail-4' },
      { line: 9, class: 'fg-run-trail-3' },
      { line: 10, class: 'fg-run-trail-2' },
      { line: 11, class: 'fg-run-trail-1' },
      { line: 12, class: 'fg-run-now' },
    ]);
  });

  it('with reduced motion there is no trail', () => {
    expect(lineMarks(t, 'running', true)).toEqual([{ line: 12, class: 'fg-run-now' }]);
    expect(lineMarks(t, 'paused', true)).toEqual([{ line: 12, class: 'fg-run-paused' }]);
  });

  it('paused keeps the faint trail; stopped marks only the line', () => {
    expect(lineMarks(t, 'paused', false)).toContainEqual({ line: 12, class: 'fg-run-paused' });
    expect(lineMarks(t, 'paused', false)).toContainEqual({ line: 11, class: 'fg-run-trail-1' });
    expect(lineMarks(t, 'stopped', false)).toEqual([{ line: 12, class: 'fg-run-stopped' }]);
  });

  it('in the ROM, the calling line is marked out', () => {
    expect(lineMarks({ now: null, trail: [], out: 4 }, 'running', false)).toEqual([{ line: 4, class: 'fg-run-out' }]);
  });

  it('the key is unchanged when the set is, and changes when it does', () => {
    const a = marksKey(lineMarks({ now: 3, trail: [2, 1], out: null }, 'running', false));
    const b = marksKey(lineMarks({ now: 3, trail: [2, 1], out: null }, 'running', false));
    expect(a).toBe(b);
    expect(a).toBe('1:fg-run-trail-2,2:fg-run-trail-1,3:fg-run-now');
    expect(marksKey(lineMarks({ now: 1, trail: [3, 2], out: null }, 'running', false))).not.toBe(a);
    expect(marksKey([])).toBe('');
  });
});
