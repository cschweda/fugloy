/**
 * @fugloy/recomp, M1 Task 4: the referee runs a program on @fugloy/emu (Fugløy's stub ROM) and its port
 * on @fugloy/runtime side by side, block by block, and stops at the first difference with a sentence
 * naming where it is. These tests show it passes Task 3's programs on both models and catches what
 * it is there to catch: a helper that gets a flag wrong, a block that miscounts its T-states, a
 * program that writes into its own code, one that reads its own code as data, a key that must reach
 * both machines at once, the check steps, and what the port refuses as it runs.
 */
import { Machine } from '@fugloy/emu';
import { toCmd } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { createZ, load } from '@fugloy/runtime';
import { describe, expect, it } from 'vitest';
import { port } from '../src/index.js';
import { PROGRAMS, RUNTIME, assembled, cpuOf, emuState, hex, importPort, memOf, namesOf, program, setZ, stub } from './helpers.js';
import type { Model } from './helpers.js';
import { referee } from './referee.js';
import type { RefereeResult, Step } from './referee.js';

const MODELS: readonly Model[] = [3, 1];
const modelName = (model: Model): string => `the Model ${model === 3 ? 'III' : 'I'}`;

const judge = (r: AsmResult, model: Model, steps: Step[], transform?: (js: string) => string): Promise<RefereeResult> =>
  referee({ cmd: toCmd(r), model, names: namesOf(r), steps, ...(transform === undefined ? {} : { transform }) });

const failed = (res: RefereeResult): Extract<RefereeResult, { ok: false }> => {
  if (res.ok) throw new Error('the referee passed a run it should have stopped');
  return res;
};

const passed = (res: RefereeResult): Extract<RefereeResult, { ok: true }> => {
  if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
  return res;
};

/**
 * Counted without the referee: the T-states emu takes from the program's entry until it returns to
 * the stub's RETURNED, and the blocks its port starts on the way (the port run alone, from emu's state
 * at the entry, its z.at counting).
 */
async function counted(r: AsmResult, model: Model): Promise<{ cycles: number; blocks: number }> {
  const cmd = toCmd(r);
  const { rom, returned } = stub(model);
  const m = new Machine({ model, roms: { level2: rom } });
  m.run({ until: 'halt', cycles: m.clockHz });
  m.load.cmd(cmd);
  const start = emuState(m);
  const mem = memOf(m);
  while (cpuOf(m).registers.PC !== returned) m.step();
  const cycles = cpuOf(m).cycles - start.cycles;

  const p = port(cmd, { model, names: namesOf(r), runtimeImport: RUNTIME });
  if (!p.ok) throw new Error(p.errors.join(' '));
  const mod = await importPort(p.js);
  const z = createZ({ model });
  setZ(z, start, mem);
  load(z, mod);
  let blocks = 0;
  z.at = (): void => {
    blocks++;
  };
  const { runPort } = await import('@fugloy/runtime');
  runPort(z, mod);
  return { cycles, blocks };
}

describe("Task 3's programs", () => {
  for (const [what, source] of Object.entries(PROGRAMS)) {
    for (const model of MODELS) {
      it(`${what}: passes on ${modelName(model)}, compared at every block it starts`, async () => {
        const r = assembled(source, model);
        const res = passed(await judge(r, model, [{ run: 1_000_000 }]));
        expect(res).toEqual({ ok: true, ...(await counted(r, model)), frames: expect.any(Number) });
        expect(res.blocks).toBeGreaterThan(0);
      });
    }
  }
});

describe('a planted bug is caught where it shows', () => {
  const r = assembled(PROGRAMS['nested CALL and RET three deep']!, 3);
  const at = (n: string): number => r.symbol(n)!.value;

  it("a helper whose add8 gets H wrong: at the block after the first ADD, in F, with both values", async () => {
    // A runtime whose add8 is the real one with H flipped, put in place of the module's import
    const wrong = `import * as real from '${RUNTIME}'; export * from '${RUNTIME}'; ` +
      'export function add8(z, a, v) { const n = real.add8(z, a, v); z.f ^= 0x10; return n; }';
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(wrong).replace(/'/g, '%27')}`;
    const res = failed(await judge(r, 3, [{ run: 100_000 }], (js) => js.replace(`from '${RUNTIME}'`, `from '${url}'`)));
    // START's LD A,1 and CALL ONE; ONE's ADD A,A (1 + 1: F $00) and CALL TWO; TWO's block is where F shows it
    expect(res.field).toBe('f');
    expect(res.at.block).toBe(at('TWO'));
    expect(res.at.routine).toBe('TWO');
    expect(res.report).toContain('F: port $10, emu $00');
    expect(res.report).toContain(`$${hex(at('ONE'), 4)}`);
  });

  it("a block whose tick is one T-state short: at the next block, in the T-states", async () => {
    // The module's first tick is START's first block, which ends with CALL ONE
    const short = (js: string): string => js.replace(/z\.tick\((\d+), (\d+)\)/, (_, t: string, n: string) => `z.tick(${Number(t) - 1}, ${n})`);
    const res = failed(await judge(r, 3, [{ run: 100_000 }], short));
    expect(res.field).toBe('cycles');
    expect(res.at.block).toBe(at('ONE'));
    expect(res.at.routine).toBe('ONE');
    expect(res.at.cycles).toBe(7 + 17 - 1);
    expect(res.report).toMatch(/T-states: port \d+, emu \d+/);
    const [, portT, emuT] = /T-states: port (\d+), emu (\d+)/.exec(res.report)!;
    expect(Number(emuT) - Number(portT)).toBe(1);
  });

  it("a block whose tick counts one R increment short: at the next block, in R", async () => {
    const short = (js: string): string => js.replace(/z\.tick\((\d+), (\d+)\)/, (_, t: string, n: string) => `z.tick(${t}, ${Number(n) - 1})`);
    const res = failed(await judge(r, 3, [{ run: 100_000 }], short));
    expect(res.field).toBe('r');
    expect(res.at.block).toBe(at('ONE'));
  });

  it('a byte the port writes differently: at the next block, naming the address', async () => {
    const show = assembled(program(`
START:  LD      HL,3C00H
        LD      (HL),'A'
PARK:   JR      PARK`), 3);
    const res = failed(await judge(show, 3, [{ run: 1000 }], (js) => js.replace('0x41', '0x42')));
    expect(res.field).toBe('mem[$3C00]');
    expect(res.at.block).toBe(show.symbol('PARK')!.value);
    expect(res.report).toContain('$3C00: port $42, emu $41');
  });
});

describe('self-modifying code', () => {
  const sentence = (written: number, by: number): string =>
    `self-modifying code: $${hex(written, 4)} written by the instruction at $${hex(by, 4)} (M1 does not translate it)`;

  for (const model of MODELS) {
    it(`a store into its own next instruction is refused, naming both addresses, on ${modelName(model)}`, async () => {
      const r = assembled(program(`
START:  LD      A,0C9H          ; RET
STORE:  LD      (NEXT),A
NEXT:   NOP
        RET`), model);
      const res = failed(await judge(r, model, [{ run: 100_000 }]));
      expect(res.field).toBe('code');
      expect(res.report).toContain(sentence(r.symbol('NEXT')!.value, r.symbol('STORE')!.value));
    });
  }

  it('a block move into the code is refused at its first byte', async () => {
    const r = assembled(program(`
START:  LD      HL,5000H
        LD      DE,TAIL
MOVE:   LD      BC,2
        LDIR
TAIL:   NOP
        NOP
        RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('code');
    expect(res.report).toContain(sentence(r.symbol('TAIL')!.value, r.symbol('MOVE')!.value + 3));
  });

  it('a stack push into the code is refused at the byte it writes first', async () => {
    const r = assembled(program(`
START:  LD      HL,0
        ADD     HL,SP
        LD      SP,TAIL
SAVE:   PUSH    BC              ; writes TAIL-1, the LD SP,HL, then TAIL-2
        LD      SP,HL
TAIL:   RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('code');
    expect(res.report).toContain(sentence(r.symbol('TAIL')!.value - 1, r.symbol('SAVE')!.value));
  });

  it('a write into code that has already run, and never runs again, is refused all the same', async () => {
    const r = assembled(program(`
START:  XOR     A
STORE:  LD      (START),A
PARK:   JR      PARK`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('code');
    expect(res.report).toContain(sentence(0x7000, r.symbol('STORE')!.value));
  });
});

describe('a program that reads its own code bytes as data', () => {
  it("is stopped at the register the read leaves different, naming the code byte read: the port has none", async () => {
    const r = assembled(program(`
START:  LD      A,(TAIL)        ; C9H on the original; the port carries no code bytes
TAIL:   RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('a');
    expect(res.report).toContain('A: port $00, emu $C9');
    expect(res.report).toContain('instruction at $7000 read $7003, a byte of the program\'s code, as data');
  });

  it('is stopped at the memory the read leaves different when the registers agree again', async () => {
    const r = assembled(program(`
START:  LD      A,(NEXT)        ; 21H on the original
NEXT:   LD      HL,5000H
        LD      (HL),A          ; MEMPTR untouched, so it agrees
        XOR     A               ; A and F the same on both again
        RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('mem[$5000]');
    expect(res.report).toContain('$5000: port $00, emu $21');
    expect(res.report).toContain(`read $${hex(r.symbol('NEXT')!.value, 4)}, a byte of the program's code, as data`);
  });
});

describe('the check steps', () => {
  const waiter = (model: Model): AsmResult =>
    assembled(program(`
START:  LD      HL,0
WAIT:   INC     HL
        LD      A,(3840H)       ; the row with SPACE, bit 7
        AND     80H
        JR      Z,WAIT
        LD      (5000H),HL
        RET`), model);

  for (const model of MODELS) {
    it(`a key a step presses reaches both machines at the same block on ${modelName(model)}: the wait ends at the same T-state`, async () => {
      const r = waiter(model);
      const early = passed(await judge(r, model, [{ run: 3000 }, { press: 'SPACE' }, { run: 1000 }, { release: 'SPACE' }]));
      const late = passed(await judge(r, model, [{ run: 9000 }, { press: 'SPACE' }, { run: 1000 }, { release: 'SPACE' }]));
      // One pass of the loop is 6 + 13 + 7 + 12 = 38 T-states: the program returns soon after the press
      expect(early.cycles).toBeGreaterThanOrEqual(3000);
      expect(early.cycles).toBeLessThan(3000 + 100);
      expect(late.cycles - early.cycles).toBeGreaterThan(5900);
      expect(late.cycles - early.cycles).toBeLessThan(6100);
    });
  }

  it('checks row, cell and pcIn on both, at the first block at or after their T-state, and video RAM every frame', async () => {
    const r = assembled(program(`
START:  LD      HL,3C00H
        LD      (HL),'A'
PARK:   JR      PARK`), 3);
    const res = passed(await judge(r, 3, [{ run: 100_000 }, { row: 0, text: 'A' }, { row: 1, text: '' }, { cell: '3C00', byte: '41' }, { pcIn: 'PARK' }]));
    // 100,000 T-states at 33,792 a frame (1/60 s of 2,027,520 Hz)
    expect(res.frames).toBeGreaterThanOrEqual(2);
    expect(res.cycles).toBeGreaterThanOrEqual(100_000);
    expect(res.cycles).toBeLessThan(100_000 + 12);

    const row = failed(await judge(r, 3, [{ run: 1000 }, { row: 0, text: 'B' }]));
    expect(row.field).toBe('row 0');
    expect(row.report).toContain('"A"');
    const cell = failed(await judge(r, 3, [{ run: 1000 }, { cell: '3C00', byte: '42' }]));
    expect(cell.field).toBe('cell $3C00');
    const pc = failed(await judge(r, 3, [{ run: 1000 }, { pcIn: 'START', to: 'PARK' }]));
    expect(pc.field).toBe('pcIn');
    expect(pc.report).toContain(`$${hex(r.symbol('PARK')!.value, 4)}`);
  });

  it('ends a run whose steps are spent, though the program never returns', async () => {
    const r = assembled(program(`
START:  LD      HL,3C00H
PARK:   JR      PARK`), 1);
    const res = passed(await judge(r, 1, [{ run: 50_000 }]));
    expect(res.cycles).toBeGreaterThanOrEqual(50_000);
    // 1/60 s of the Model I's 1,774,080 Hz is 29,568 T-states
    expect(res.frames).toBeGreaterThanOrEqual(1);
  });
});

describe('what the port refuses as it runs', () => {
  it("names the routine, the block, and the instruction emu made the same access with", async () => {
    const r = assembled(program(`
START:  LD      A,1
        CALL    READ
        RET
READ:   LD      B,A
        INC     B
        IN      A,(0FEH)
        RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    const read = r.symbol('READ')!.value;
    expect(res.field).toBe('refusal');
    expect(res.at).toEqual({ routine: 'READ', block: read, cycles: expect.any(Number) });
    expect(res.report).toMatch(/^the port does not model \$FE \(an I\/O port/);
    expect(res.report).toContain(`emu's instruction at $${hex(read + 2, 4)}, IN A,(0FEH)`);
  });

  it("names the instruction for a Model I Expansion Interface access", async () => {
    const r = assembled(program(`
START:  LD      HL,1
        LD      A,(37E0H)
        RET`), 1);
    const res = failed(await judge(r, 1, [{ run: 100_000 }]));
    expect(res.field).toBe('refusal');
    expect(res.report).toContain('the port does not model $37E0');
    expect(res.report).toContain("emu's instruction at $7003, LD A,(37E0H)");
  });

  it('reports a transfer to an address no block starts, as the port names it', async () => {
    const r = assembled(program(`
START:  LD      A,1
        CALL    0060H
        RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('refusal');
    expect(res.report).toMatch(/^the transfer at \$7002 goes to \$0060/);
    expect(res.at).toEqual({ routine: 'START', block: 0x7000, cycles: expect.any(Number) });
  });

  it("reports a port that cannot be made, with port()'s sentences", async () => {
    const r = assembled(program(`
START:  LD      HL,THERE
        JP      (HL)
THERE:  RET`), 3);
    const res = failed(await judge(r, 3, [{ run: 100_000 }]));
    expect(res.field).toBe('port');
    expect(res.report).toMatch(/^\$7003: JP \(HL\) jumps to an address computed as it runs/);
  });
});
