/**
 * @fugloy/runtime, M2 Task 2: Fugløy's stand-ins for the ROM routines a game calls. A port has no ROM,
 * so a CALL to one of these runs `o.standin`, which pushes the return address as the CALL does, runs
 * the stand-in, and pops it as the routine's RET does. The stand-in for the Model III's $DELAY ($0060)
 * must leave the state the emulator leaves after running the routine: measured on emu with the user's
 * ROM, 30 T-states a count plus 15 after the CALL (BC 0 counting 65,536), 5 R increments a count plus
 * 2, A 0, F $44 and BC 0. @fugloy/recomp's standin.test.ts runs the same calls beside emu, on the stub
 * ROM with STANDINS_Z and, locally, on the user's ROM.
 */
import { describe, expect, it } from 'vitest';
import { STANDINS_Z, createZ, standins } from '../src/index.js';
import * as o from '../src/ops.js';

/** Every register, the T-states and Q: what a stand-in may change, and what it must leave. */
const state = (z) => ({
  a: z.a, f: z.f, bc: z.bc, de: z.de, hl: z.hl, ix: z.ix, iy: z.iy, sp: z.sp, i: z.i, r: z.r, wz: z.wz,
  af_: z.af_, bc_: z.bc_, de_: z.de_, hl_: z.hl_, iff1: z.iff1, iff2: z.iff2, im: z.im, q: z.q, cycles: z.cycles,
});

/** A Model III Z with every register set to something other than what $DELAY leaves, R's bit 7 included. */
function seeded(bc, r = 0xfe) {
  const z = createZ({ model: 3 });
  Object.assign(z, { a: 0x5a, f: 0xbb, d: 0x12, e: 0x34, h: 0x56, l: 0x78, i: 0x3f, r, wz: 0x9abc });
  z.bc = bc;
  z.ix = 0x1357;
  z.iy = 0x2468;
  z.sp = 0x7ff0;
  Object.assign(z, { af_: 0x1111, bc_: 0x2222, de_: 0x3333, hl_: 0x4444, iff2: true, im: 1, q: 1, cycles: 1000 });
  return z;
}

const COUNTS = [1, 2, 3, 256, 8192, 0];

describe("the Model III's stand-ins", () => {
  it('has $DELAY at $0060, and the Model I has none in M2', () => {
    expect([...standins(3).keys()]).toEqual([0x0060]);
    expect(standins(3).get(0x0060).name).toBe('DELAY');
    expect(standins(1).size).toBe(0);
  });

  it.each(COUNTS)('$DELAY with BC = %i: 30 T-states a count and 15 more, 5 R a count and 2 more, A 0, F 0x44, BC 0, the rest unchanged', (bc) => {
    for (const r0 of [0x00, 0x7f, 0x80, 0xfe]) {
      const z = seeded(bc, r0);
      const before = state(z);
      standins(3).get(0x0060).run(z);
      const n = bc || 65536;
      expect(z.cycles - before.cycles).toBe(30 * n + 15);
      expect(z.r).toBe((r0 & 0x80) | ((r0 + 5 * n + 2) & 0x7f));
      expect(state(z)).toEqual({ ...before, a: 0, f: 0x44, bc: 0, r: z.r, cycles: z.cycles });
    }
  });
});

describe('o.standin', () => {
  it.each(COUNTS)('with BC = %i pushes the return address, runs $DELAY and pops it: SP back, the two bytes written, MEMPTR the address, Q 0', (bc) => {
    const z = seeded(bc);
    const before = state(z);
    o.standin(z, 0x0060, 0x4eaf);
    const n = bc || 65536;
    // The CALL's push (high byte at SP - 1, low at SP - 2), left in memory as on emu; the RET's pop
    expect([z.mem[0x7fee], z.mem[0x7fef]]).toEqual([0xaf, 0x4e]);
    expect(state(z)).toEqual({
      ...before, a: 0, f: 0x44, bc: 0, wz: 0x4eaf, q: 0,
      r: (before.r & 0x80) | ((before.r + 5 * n + 2) & 0x7f), cycles: before.cycles + 30 * n + 15,
    });
  });

  it('throws a sentence for an address with no stand-in, and for any address on the Model I', () => {
    expect(() => o.standin(createZ({ model: 3 }), 0x0050, 0x7003)).toThrow(/^the runtime has no stand-in for the ROM routine at \$0050 on the Model III \(called to return to \$7003\)$/);
    expect(() => o.standin(createZ({ model: 1 }), 0x0060, 0x7003)).toThrow(/^the runtime has no stand-in for the ROM routine at \$0060 on the Model I /);
  });
});

describe('STANDINS_Z', () => {
  it("lays $DELAY out as the ROM does: a JP at $0060 to the loop at $01FB, and no END (it is appended to the stub ROM's source)", () => {
    const code = STANDINS_Z.split('\n').map((l) => l.replace(/;.*/, '').trim().replace(/\s+/g, ' ')).filter((l) => l !== '');
    expect(code).toEqual(['ORG 0060H', 'DELAY: JP DELAYLP', 'ORG 01FBH', 'DELAYLP: LD A,A', 'DEC BC', 'LD A,B', 'OR C', 'JR NZ,DELAYLP', 'RET']);
  });
});
