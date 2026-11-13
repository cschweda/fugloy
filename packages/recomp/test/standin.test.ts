/**
 * @fugloy/recomp, M2 Task 2: a CALL to a ROM routine the runtime stands in for. port() is given the
 * stand-ins' names (`standins(model)` from @fugloy/runtime) and writes `o.standin(z, addr, ret)` in place
 * of the call, which no longer refuses; the report lists each stand-in and its call sites. The referee
 * runs the original on Fugløy's game stub ROM (the stub with STANDINS_Z, Fugløy's own Z80 for the same
 * routines at the ROM's addresses) and, locally when fugloy.mcp.json names a Model III ROM, on that
 * ROM, so the stand-in is held to the routine's T-states, R, flags, registers, MEMPTR, Q and stack bytes
 * at the block after each call. A ROM routine with no stand-in is still refused, and throws if it runs.
 */
import { toCmd } from '@fugloy/asm';
import { createZ, runPort, standins } from '@fugloy/runtime';
import { describe, expect, it } from 'vitest';
import { configuredRom } from '../../emu/test/rom.js';
import { port } from '../src/index.js';
import type { PortResult } from '../src/index.js';
import { gameStubRom } from './game-rom.js';
import { RUNTIME, assembled, hex, importPort, namesOf, program, stub } from './helpers.js';
import type { Model } from './helpers.js';
import { referee } from './referee.js';
import type { RefereeOptions, RefereeResult } from './referee.js';

/** The stand-ins' names for a model, as port() takes them. */
const names = (model: Model): Map<number, string> => new Map([...standins(model)].map(([at, s]) => [at, s.name]));

const ok = (p: PortResult): Extract<PortResult, { ok: true }> => {
  if (!p.ok) throw new Error(`the port was refused: ${p.errors.join(' ')}`);
  return p;
};
const passed = (res: RefereeResult): Extract<RefereeResult, { ok: true }> => {
  if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
  return res;
};
const failed = (res: RefereeResult): Extract<RefereeResult, { ok: false }> => {
  if (res.ok) throw new Error('the referee passed a run it should have stopped');
  return res;
};

/** BC = 0 counts 65,536 (about a second of the Model III's clock); BC = 1 the shortest. */
const COUNTS = [1, 2, 3, 256, 8192, 0];

/** Calls $DELAY with each count, writing a digit to the screen between the calls, and A after each. */
const delays = assembled(program(`
START:  LD      HL,3C00H
${COUNTS.map((n, k) => `        LD      BC,${n}
SITE${k}:  CALL    0060H           ; $DELAY
        LD      (HL),${0x30 + k}
        INC     HL
        LD      (HL),A          ; A after $DELAY
        INC     HL`).join('\n')}
        RET`), 3);
const delaySites = COUNTS.map((_, k) => delays.symbol(`SITE${k}`)!.value);

/** A CALL cc to $DELAY, not taken and then taken. */
const conditional = assembled(program(`
START:  LD      BC,300
        XOR     A               ; Z set
        CALL    NZ,0060H        ; not taken: MEMPTR $0060, 10 T-states
        LD      (3C00H),A
        CALL    Z,0060H         ; taken
        LD      (3C01H),A
        LD      BC,1
        OR      1               ; Z clear
        CALL    NZ,0060H        ; taken
        RET`), 3);

const judge = (r: ReturnType<typeof assembled>, model: Model, rom: NonNullable<RefereeOptions['rom']>, run = 10_000_000): Promise<RefereeResult> =>
  referee({ cmd: toCmd(r), model, names: namesOf(r), rom, steps: [{ run }] });

/** The local Model III ROM fugloy.mcp.json names, or null (no config, no entry, or no such file): the test skips. */
const userRom = ((): Uint8Array | null => {
  try {
    return configuredRom('model3');
  } catch {
    return null;
  }
})();

describe('$DELAY, stood in for', () => {
  it('is written as o.standin at each call, listed in the report, and refused no more', () => {
    const p = ok(port(toCmd(delays), { model: 3, names: namesOf(delays), runtimeImport: RUNTIME, standins: names(3) }));
    expect(p.report.refused).toEqual([]);
    expect(p.report.standins).toEqual([{ addr: 0x0060, name: 'DELAY', sites: delaySites }]);
    expect(delaySites).toHaveLength(COUNTS.length);
    const first = delaySites[0]!;
    expect(p.js).toMatch(new RegExp(`o\\.standin\\(z, 0x0060, 0x${hex(first + 3, 4)}\\);\\s+// \\$${hex(first, 4)}  CALL 0060H  ; \\$DELAY, the runtime's stand-in`));
    // Without the names, the calls are refused as in M1
    const plain = ok(port(toCmd(delays), { model: 3, names: namesOf(delays), runtimeImport: RUNTIME }));
    expect(plain.report.refused).toHaveLength(COUNTS.length);
    expect(plain.report.standins).toEqual([]);
  });

  it(`passes the referee on the game stub ROM for BC = ${COUNTS.join(', ')}`, async () => {
    const res = passed(await judge(delays, 3, 'game'));
    const n = COUNTS.reduce((s, c) => s + (c || 65536), 0);
    // Every count's 30 T-states are in the run: the referee compared the block after each call
    expect(res.cycles).toBeGreaterThan(30 * n);
  }, 60_000);

  it('passes the referee for a CALL cc to it, taken and not taken', async () => {
    const p = ok(port(toCmd(conditional), { model: 3, names: namesOf(conditional), runtimeImport: RUNTIME, standins: names(3) }));
    expect(p.report.standins).toEqual([{ addr: 0x0060, name: 'DELAY', sites: [0x7004, 0x700a, 0x7015] }]);
    passed(await judge(conditional, 3, 'game'));
  });

  it('stops the referee when the port runs it one count short (a planted bug)', async () => {
    const res = failed(await referee({
      cmd: toCmd(conditional), model: 3, names: namesOf(conditional), rom: 'game', steps: [{ run: 10_000_000 }],
      transform: (js) => js.replace(/o\.standin\(z, 0x0060, (0x[0-9A-F]{4})\);/g, 'z.bc = (z.bc - 1) & 0xffff; o.standin(z, 0x0060, $1);'),
    }));
    expect(res.field).toBe('cycles');
  });

  it.skipIf(userRom === null)("passes the referee on the user's Model III ROM (fugloy.mcp.json), for the same counts and the CALL cc", async () => {
    passed(await judge(delays, 3, userRom!));
    passed(await judge(conditional, 3, userRom!));
  }, 60_000);
});

describe('the game stub ROM', () => {
  it("is the plain stub, then $DELAY at the ROM's addresses: a JP at $0060 to the loop at $01FB; HALT elsewhere", () => {
    const plain = stub(3).rom;
    const game = gameStubRom(3);
    expect(game.length).toBe(0x3800);
    expect([...game.subarray(0, 0x60)]).toEqual([...plain.subarray(0, 0x60)]);
    expect([...game.subarray(0x60, 0x63)]).toEqual([0xc3, 0xfb, 0x01]);
    expect([...game.subarray(0x1fb, 0x202)]).toEqual([0x7f, 0x0b, 0x78, 0xb1, 0x20, 0xfa, 0xc9]);
    const other = [...game].filter((b, a) => b !== plain[a]);
    expect(other).toHaveLength(10);
    // The Model I has no stand-ins in M2: its game stub is the plain stub
    expect([...gameStubRom(1)]).toEqual([...stub(1).rom]);
  });
});

describe('port $00 on the Model III', () => {
  it('reads as on emu (no device answers it: $FF), through the referee', async () => {
    const r = assembled(program(`
START:  IN      A,(00H)         ; Sea Dragon's joystick read
        LD      (3C00H),A
        LD      B,A
        RET`), 3);
    passed(await judge(r, 3, 'game', 100_000));
    passed(await judge(r, 3, 'stub', 100_000));
  });
});

describe('a ROM routine with no stand-in', () => {
  it('is still refused, and throws when it runs', async () => {
    const r = assembled(program(`
START:  LD      A,1
        CALL    0050H
        RET`), 3);
    const p = ok(port(toCmd(r), { model: 3, names: namesOf(r), runtimeImport: RUNTIME, standins: names(3) }));
    expect(p.report.refused).toEqual([expect.stringMatching(/^\$7002: CALL 0050H goes to \$0050, where no block of the port starts/)]);
    expect(p.report.standins).toEqual([]);
    const res = failed(await judge(r, 3, 'game', 100_000));
    expect(res.field).toBe('refusal');
    expect(res.report).toMatch(/^the transfer at \$7002 goes to \$0050/);
  });

  it('is refused on the Model I, which has no stand-ins in M2, and throws when it runs', async () => {
    const r = assembled(program(`
START:  LD      BC,1
        CALL    0060H
        RET`), 1);
    const p = ok(port(toCmd(r), { model: 1, names: namesOf(r), runtimeImport: RUNTIME, standins: names(1) }));
    expect(p.report.refused).toEqual([expect.stringMatching(/^\$7003: CALL 0060H goes to \$0060/)]);
    expect(p.report.standins).toEqual([]);
    const z = createZ({ model: 1 });
    z.sp = 0xfffe;
    z.write16(0xfffe, 0x0016);
    const mod = await importPort(p.js);
    expect(() => runPort(z, mod)).toThrow(/^the transfer at \$7003 goes to \$0060, where no block of the port starts/);
    expect(failed(await judge(r, 1, 'game', 100_000)).field).toBe('refusal');
  });
});
