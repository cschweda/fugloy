/**
 * @fugloy/recomp, M2 Task 5: swapped opcodes. A program that rewrites the opcode of one of its own
 * instructions is ported with a trace the census took of it: port() decodes one instruction per value the
 * trace saw at the cell (and the value as loaded), each from the bytes as loaded with the cell's byte
 * replaced, and the port chooses between them as it runs, `switch (z.mem[cell])`, each case that
 * instruction's ordinary translation. Nothing is decoded as the port runs; a value the trace did not see
 * throws `o.variant`'s sentence. The site is a block of its own, whose successors are every variant's.
 *
 * Each synthetic program takes the opcodes it writes from a data table (so a test can put a third value
 * there), and its session runs every variant of its site, so the referee checks each one's statements,
 * T-states, R, MEMPTR and Q.
 */
import { readFileSync } from 'node:fs';
import { toCmd } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { loadCmd, programHash, skeletonHints, writeHints } from '@fugloy/disasm';
import { createZ, load, runPort, standins } from '@fugloy/runtime';
import type { PortModule, Z } from '@fugloy/runtime';
import { describe, expect, it } from 'vitest';
import { parseTrace, port } from '../src/index.js';
import type { PortOptions, PortResult, PortTrace } from '../src/index.js';
import { census } from '../tools/census.js';
import { RUNTIME, assembled, hex, importPort, namesOf, program, stub } from './helpers.js';
import { referee } from './referee.js';
import type { Session } from './sessions/sea-dragon.js';

const ok = (p: PortResult): Extract<PortResult, { ok: true }> => {
  if (!p.ok) throw new Error(`the port was refused: ${p.errors.join(' ')}`);
  return p;
};
const $2 = (n: number): string => `$${hex(n, 2)}`;
const $4 = (n: number): string => `$${hex(n, 4)}`;

/** The census's session for a synthetic program: run it from its entry until it returns to the stub's RETURNED (a HALT). */
const TO_RET: Session = {
  name: 'to-ret',
  play(m): void {
    if (m.run({ until: 'halt', cycles: 1_000_000 }).reason !== 'halt') throw new Error('the program did not return');
  },
};

interface Synthetic {
  r: AsmResult;
  cmd: Uint8Array;
  hints: string;
  trace: PortTrace;
  at: (label: string) => number;
}

/** A synthetic program: assembled, its .CMD, its skeleton hint file, and its census on the game stub ROM. */
function synthetic(source: string): Synthetic {
  const r = assembled(source, 3);
  const cmd = toCmd(r);
  const hints = writeHints(skeletonHints(loadCmd(cmd), cmd));
  const trace = census({ cmd, name: 'synthetic.cmd', hints, model: 3, rom: 'game', sessions: [TO_RET] });
  return { r, cmd, hints, trace, at: (label) => r.symbol(label)!.value };
}

const options = (s: Synthetic): PortOptions => ({ model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, runtimeImport: RUNTIME });

/** A fresh machine with the port loaded, as a host runs it alone: the stub's RETURNED the return address on the stack. */
function standalone(mod: PortModule): Z {
  const z = createZ({ model: 3 });
  const back = stub(3).returned;
  z.sp = 0xfffe;
  z.mem[0xfffe] = back & 0xff;
  z.mem[0xffff] = back >> 8;
  load(z, mod);
  return z;
}

/** The message `fn` throws, or null when it does not throw. */
function thrown(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

const count = (text: string, part: string): number => text.split(part).length - 1;
/** `a, b and c`. */
const listed = (items: readonly string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// ---- the programs: each takes the opcode it writes from OPS by B's lowest bit, B from 6 (or 4) down to 1

/**
 * JP NZ / JP Z at SITE, chosen by B's parity; B's bit 1 sets Z. Over B = 6 … 1 each variant runs taken and
 * not taken. SITE follows an AND, so the analysis has no block starting there until port() asks for one.
 */
const JUMPS = program(`
START:  LD      B,6
        LD      C,0
LOOP:   LD      A,B
        AND     1
        LD      E,A
        LD      D,0
        LD      HL,OPS
        ADD     HL,DE
        LD      A,(HL)
        LD      (SITE),A
        LD      A,B
        AND     2
SITE:   JP      NZ,SKIP
        INC     C
SKIP:   DJNZ    LOOP
        LD      A,C
        LD      (5000H),A
        RET
OPS:    DB      0C2H,0CAH`);

/** LD (HL),A / NOP at SITE, chosen by B's parity: B = 4 … 1 stored to $5000 … $5003 when B is even. */
const STORE = program(`
START:  LD      HL,5000H
        LD      B,4
LOOP:   PUSH    HL
        LD      A,B
        AND     1
        LD      E,A
        LD      D,0
        LD      HL,OPS
        ADD     HL,DE
        LD      A,(HL)
        LD      (SITE),A
        POP     HL
        LD      A,B
SITE:   LD      (HL),A
        INC     HL
        DJNZ    LOOP
        RET
OPS:    DB      77H,00H`);

/**
 * CALL BUMP / RET at SUB, chosen by B's parity. While SUB holds RET its two bytes after it (BUMP's address)
 * are never run; C counts the calls that reached BUMP.
 */
const CALLS = program(`
START:  LD      B,4
        LD      C,0
LOOP:   LD      A,B
        AND     1
        LD      E,A
        LD      D,0
        LD      HL,OPS
        ADD     HL,DE
        LD      A,(HL)
        LD      (SUB),A
        CALL    SUB
        DJNZ    LOOP
        LD      A,C
        LD      (5000H),A
        RET
SUB:    CALL    BUMP
        INC     C
        RET
BUMP:   INC     C
        INC     C
        RET
OPS:    DB      0CDH,0C9H`);

/**
 * JP NZ,LOOP / JP LOOP at SITE, the loop's latch: B counts down from 6, and an odd B takes the plain JP. Both
 * variants go round the loop, and JP NZ not taken leaves it, from inside the switch, where a bare `break`
 * would leave the switch instead.
 */
const LATCH = program(`
START:  LD      B,6
        LD      C,0
LOOP:   INC     C
        DEC     B
        LD      A,B
        AND     1
        LD      E,A
        LD      D,0
        LD      HL,OPS
        ADD     HL,DE
        LD      A,(HL)
        LD      (SITE),A
        LD      A,B
        OR      A
SITE:   JP      NZ,LOOP
        LD      A,C
        LD      (5000H),A
        RET
OPS:    DB      0C2H,0C3H`);

const CASES = [
  { name: 'JP NZ / JP Z', source: JUMPS, site: 'SITE', values: [0xc2, 0xca], variants: ['JP NZ,SKIP', 'JP Z,SKIP'] },
  { name: 'LD (HL),A / NOP', source: STORE, site: 'SITE', values: [0x00, 0x77], variants: ['NOP', 'LD (HL),A'] },
  { name: 'CALL nn / RET', source: CALLS, site: 'SUB', values: [0xc9, 0xcd], variants: ['RET', 'CALL BUMP'] },
  { name: "JP NZ / JP at a loop's latch", source: LATCH, site: 'SITE', values: [0xc2, 0xc3], variants: ['JP NZ,LOOP', 'JP LOOP'] },
] as const;

describe('a swapped opcode, translated as a choice between the instructions the trace saw', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const s = synthetic(c.source);
      const site = s.at(c.site);
      const head = `switch (z.mem[0x${hex(site, 4)}]) {`;

      it('is one switch on the cell, a case per value, and passes the referee over a session that runs both', async () => {
        expect(s.trace.patches.map((p) => [p.addr, p.values])).toEqual([[site, c.values]]);
        const p = ok(port(s.cmd, options(s)));
        expect(p.report.cells).toEqual([{ addr: site, instruction: site, kind: 'opcode', values: c.values, variants: c.variants }]);
        expect(count(p.js, head), 'one switch on the cell').toBe(1);
        expect(p.js).not.toContain('switch (b)');
        expect(p.report.routines.filter((r) => r.labelled)).toEqual([]);
        // Inside a case every jump to a loop names it: a bare `break` there would leave the switch
        if (c.source === LATCH) {
          const inSwitch = p.js.slice(p.js.indexOf(head), p.js.indexOf('default:', p.js.indexOf(head)));
          expect(inSwitch).toMatch(/^\s+continue loop_[0-9A-F]{4};$/m);
          expect(inSwitch).toMatch(/^\s+break loop_[0-9A-F]{4};$/m);
        }
        for (const v of c.values) expect(p.js).toMatch(new RegExp(`case 0x${hex(v, 2)}:`));
        expect(p.js).toContain(`throw o.variant(z, 0x${hex(site, 4)}, [${c.values.map((v) => `0x${hex(v, 2)}`).join(', ')}]);`);
        // The cell is carried (its byte as loaded); no other code byte is
        const mod = (await importPort(p.js)) as PortModule & { CELLS: [number, number][] };
        expect(mod.CELLS).toEqual([[site, s.r.image!.bytes[site]]]);
        const res = await referee({ cmd: s.cmd, model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, rom: 'game', steps: [{ run: 1_000_000 }] });
        if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
      });

      it("throws o.variant's sentence when the cell holds a third value", async () => {
        const mod = await importPort(ok(port(s.cmd, options(s))).js);
        const z = standalone(mod);
        // OPS's first byte goes to the cell whenever B is even, which each program reaches
        z.mem[s.at('OPS')] = 0x3c; // INC A, which the trace never saw
        const known = listed(c.values.map($2));
        expect(thrown(() => runPort(z, mod))).toMatch(
          new RegExp(`^the opcode at \\${$4(site)} is \\$3C, which the trace did not see there \\(the port knows ${known.replace(/\$/g, '\\$')}\\); run the census over a session that reaches this \\(in [A-Z_]+, in the block at \\${$4(site)}\\)$`),
        );
      });
    });
  }

  it('the two bytes after a RET are not an instruction the port translates', () => {
    const s = synthetic(CALLS);
    const p = ok(port(s.cmd, options(s)));
    const sub = s.at('SUB');
    expect(p.js).not.toContain(`z.at(0x${hex(sub + 1, 4)})`);
    expect(p.js).not.toContain(`z.at(0x${hex(sub + 2, 4)})`);
    // The CALL's case returns to the address after it, which is a block; the RET's returns
    expect(p.js).toContain(`o.call(z, BUMP, 0x${hex(sub + 3, 4)});`);
    expect(p.js).toContain(`o.ret(z, ret, 0x${hex(sub, 4)}); return;`);
  });
});

describe('a swapped opcode the port cannot translate', () => {
  const s = synthetic(JUMPS);
  const site = s.at('SITE');
  /** The trace with `value` added to what it saw at the site. */
  const seen = (value: number): PortTrace => ({ ...s.trace, patches: s.trace.patches.map((p) => ({ ...p, values: [...p.values, value].sort((x, y) => x - y) })) });

  it('refuses a value that makes the cell a prefix, and one @fugloy/z80 reads only as DB, each with a sentence', () => {
    // DD 19 is ADD IX,DE: the JP's low byte would become the opcode
    expect(port(s.cmd, { ...options(s), trace: seen(0xdd) })).toEqual({
      ok: false,
      errors: [`${$4(site)}: the program rewrites the opcode of JP NZ,SKIP at ${$4(site)} to $DD, a prefix: DD 19 decodes as ADD IX,DE, running on into bytes the disassembly reads as other instructions, which a port cannot follow.`],
    });
    const db = port(s.cmd, { ...options(s), trace: seen(0xed) });
    expect(db).toEqual({ ok: false, errors: [expect.stringMatching(new RegExp(`^\\${$4(site)}: the program rewrites the opcode of JP NZ,SKIP at \\${$4(site)} to \\$ED, and @fugloy/z80 reads ED 19 there only as DB`))] });
  });

  it('refuses a variant that goes where no block starts, naming it', () => {
    // A NOP the program rewrites to itself; given JR too, the JR's d is the next instruction's opcode, $01,
    // and its target the last byte of that LD BC,nn
    const mid = synthetic(program(`
START:  LD      A,(OPS)
        LD      (SITE),A
SITE:   NOP
        LD      BC,1234H
        RET
OPS:    DB      0`));
    const at = mid.at('SITE');
    const trace = { ...mid.trace, patches: mid.trace.patches.map((p) => ({ ...p, values: [0x00, 0x18] })) };
    expect(port(mid.cmd, { ...options(mid), trace })).toEqual({
      ok: false,
      errors: [`${$4(at)}: the program rewrites the opcode at ${$4(at)} to $18, making JR ${hex(at + 3, 4)}H, which goes to ${$4(at + 3)}, where no block of the disassembly starts.`],
    });
  });
});

// ---- Sea Dragon

const SEA_DRAGON = new Uint8Array(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url)));
const SEA_DRAGON_HINTS = readFileSync(new URL('../../../examples/sea-dragon/seadrg01.hints', import.meta.url), 'utf8');
const SEA_DRAGON_TRACE = parseTrace(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.trace.json', import.meta.url), 'utf8'), programHash(SEA_DRAGON));

describe('Sea Dragon (seadrg01.cmd) with its hint file and trace', () => {
  it('ports: eight sites in report.cells, the three opcode sites each a switch, no routine labelled, nothing refused', () => {
    const options: PortOptions = { model: 3, hints: SEA_DRAGON_HINTS, trace: SEA_DRAGON_TRACE, runtimeImport: RUNTIME, source: 'seadrg01.cmd', standins: new Map([...standins(3)].map(([at, x]) => [at, x.name])) };
    const p = ok(port(SEA_DRAGON, options));
    expect(ok(port(SEA_DRAGON, options)).js, 'the same module twice').toBe(p.js);
    expect(p.report.cells.map((c) => [c.addr, c.instruction, c.kind])).toEqual([
      [0x49c1, 0x49bf, 'disp'],
      [0x4f41, 0x4f3f, 'disp'],
      [0x509b, 0x509a, 'word'],
      [0x509c, 0x509a, 'word'],
      [0x5174, 0x5174, 'opcode'],
      [0x525e, 0x525e, 'opcode'],
      [0x5ad0, 0x5ace, 'disp'],
      [0x5add, 0x5adb, 'disp'],
      [0x5aea, 0x5aea, 'opcode'],
    ]);
    expect(new Set(p.report.cells.map((c) => c.instruction)).size, 'eight sites').toBe(8);
    const variants = Object.fromEntries(p.report.cells.filter((c) => c.kind === 'opcode').map((c) => [c.addr, c.variants]));
    expect(variants).toEqual({ [0x5174]: ['NOP', 'LD (HL),A'], [0x525e]: ['JP NZ,L52F8', 'JP Z,L52F8'], [0x5aea]: ['RET', 'CALL TONE'] });
    expect(p.report.routines.filter((r) => r.labelled)).toEqual([]);
    expect(p.report.refused).toEqual([]);
    expect(p.js).not.toContain('switch (b)');
    for (const site of ['5174', '525E', '5AEA']) expect(count(p.js, `switch (z.mem[0x${site}]) {`), `$${site}`).toBe(1);
  });
});
