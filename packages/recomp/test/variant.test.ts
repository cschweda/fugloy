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

/** Each instruction byte of an assembled program, from its listing (every line but its DB and DS lines). */
function codeBytes(r: AsmResult): Set<number> {
  const code = new Set<number>();
  for (const l of r.listing) {
    if (l.address === null || /^\s*(\w+:?)?\s+D[BWS]\b/i.test(l.text)) continue;
    l.bytes.forEach((_, k) => code.add(l.address! + k));
  }
  return code;
}

/**
 * The module carries none of the program's code: DATA holds no code byte, CELLS holds exactly the trace's
 * cells, each with its byte as the program loads it, and CODE covers every instruction byte.
 */
async function expectNoCodeButCells(s: Synthetic, js: string): Promise<void> {
  const mod = (await importPort(js)) as PortModule & { CODE: [number, number][]; CELLS: [number, number][] };
  const code = codeBytes(s.r);
  const inData = mod.DATA.flatMap(([a, bytes]) => [...bytes].map((_, k) => a + k));
  expect(inData.filter((a) => code.has(a)), 'code addresses in DATA').toEqual([]);
  expect(mod.CELLS).toEqual(s.trace.patches.map((p) => [p.addr, s.r.image!.bytes[p.addr]]));
  const covered = new Set(mod.CODE.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, k) => from + k)));
  expect([...code].filter((a) => !covered.has(a)), 'code bytes CODE leaves out').toEqual([]);
}
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
  { name: 'JP NZ / JP Z', source: JUMPS, site: 'SITE', values: [0xc2, 0xca], variants: ['JP NZ,SKIP', 'JP Z,SKIP'], loaded: 'JP NZ,SKIP' },
  { name: 'LD (HL),A / NOP', source: STORE, site: 'SITE', values: [0x00, 0x77], variants: ['NOP', 'LD (HL),A'], loaded: 'LD (HL),A' },
  { name: 'CALL nn / RET', source: CALLS, site: 'SUB', values: [0xc9, 0xcd], variants: ['RET', 'CALL BUMP'], loaded: 'CALL BUMP' },
  { name: "JP NZ / JP at a loop's latch", source: LATCH, site: 'SITE', values: [0xc2, 0xc3], variants: ['JP NZ,LOOP', 'JP LOOP'], loaded: 'JP NZ,LOOP' },
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
        expect(p.js).toContain(`throw o.variant(z, 0x${hex(site, 4)}, [${c.values.map((v) => `0x${hex(v, 2)}`).join(', ')}], '${c.loaded}');`);
        // The cell is carried (its byte as loaded); no other code byte is, in DATA or anywhere
        await expectNoCodeButCells(s, p.js);
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
          new RegExp(`^the opcode at \\${$4(site)} \\(of ${c.loaded.replace(/[()]/g, '\\$&')} as loaded\\) is \\$3C, which the trace did not see there \\(the port knows ${known.replace(/\$/g, '\\$')}\\); run the census over a session that reaches this \\(in [A-Z_]+, in the block at \\${$4(site)}\\)$`),
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

  it("refuses a variant whose successor, decoded first, would push out an instruction the program's own code runs", () => {
    // The JR's d is LD B's opcode, $06: SITE + 2 + 6 is the last byte of SUB's LD BC,nn. Given as a root, the
    // analysis decodes it before START's path reaches SUB, and LD BC,1234H would be lost (its bytes put in DATA)
    const s2 = synthetic(program(`
START:  LD      A,(OPS)
        LD      (SITE),A
        CALL    SUB
SITE:   NOP
        LD      B,1
        RET
SUB:    NOP
        NOP
        LD      BC,1234H
        RET
OPS:    DB      0`));
    const at = s2.at('SITE');
    const ld = s2.at('SUB') + 2;
    expect(at + 2 + 6).toBe(ld + 2);
    const trace = { ...s2.trace, patches: s2.trace.patches.map((p) => ({ ...p, values: [0x00, 0x18] })) };
    expect(port(s2.cmd, { ...options(s2), trace })).toEqual({
      ok: false,
      errors: [
        `${$4(at)}: the program rewrites the opcode at ${$4(at)} to $18, making JR ${hex(ld + 2, 4)}H, which goes to ${$4(ld + 2)}, where no block of the disassembly starts; ` +
          `decoding code there would displace LD BC,1234H at ${$4(ld)}, which the program's own code reaches.`,
      ],
    });
  });

  it('refuses a variant that takes in another rewritten byte, whether its own operand or a byte of the next instruction', () => {
    // JUMPS with the JP's low byte rewritten as well: each variant takes it in
    const lo = { addr: site + 1, writers: [s.at('LOOP')], values: [s.at('SKIP') & 0xff] };
    const both = { ...s.trace, patches: [...s.trace.patches, lo] };
    expect(port(s.cmd, { ...options(s), trace: both })).toEqual({
      ok: false,
      errors: [0xc2, 0xca].map(
        (v) => `${$4(site)}: the program rewrites the opcode of JP NZ,SKIP at ${$4(site)} to ${$2(v)}, making JP ${v === 0xc2 ? 'NZ' : 'Z'},SKIP, which takes in the byte at ${$4(site + 1)}; ` +
          'the program rewrites that byte too, and a port does not translate a variant that takes in a rewritten byte other than its opcode.',
      ),
    });
    // A NOP made LD A,n would take in the next instruction's opcode, itself a cell (a NOP rewritten to itself)
    const next = synthetic(program(`
START:  LD      A,(OPS)
        LD      (SITE),A
        LD      (SITE+1),A
SITE:   NOP
        NOP
        RET
OPS:    DB      0`));
    const at = next.at('SITE');
    const trace = { ...next.trace, patches: next.trace.patches.map((p) => (p.addr === at ? { ...p, values: [0x00, 0x3e] } : p)) };
    const p = port(next.cmd, { ...options(next), trace });
    expect(p).toEqual({
      ok: false,
      errors: [`${$4(at)}: the program rewrites the opcode of NOP at ${$4(at)} to $3E, making LD A,00H, which takes in the byte at ${$4(at + 1)}; the program rewrites that byte too, and a port does not translate a variant that takes in a rewritten byte other than its opcode.`],
    });
  });

  it('refuses a variant that takes in a byte that is not code the disassembly decoded', () => {
    // A RET made CALL nn would take in the two bytes of TABLE, data no instruction covers
    const data = synthetic(program(`
START:  LD      A,(OPS)
        LD      (SITE),A
        CALL    SITE
        RET
SITE:   RET
TABLE:  DB      12H,34H
OPS:    DB      0C9H`));
    const at = data.at('SITE');
    const trace = { ...data.trace, patches: data.trace.patches.map((p) => ({ ...p, values: [0xc9, 0xcd] })) };
    expect(port(data.cmd, { ...options(data), trace })).toEqual({
      ok: false,
      errors: [`${$4(at)}: the program rewrites the opcode of RET at ${$4(at)} to $CD, making CALL 3412H, whose byte at ${$4(at + 1)} is not code the disassembly decoded, so the port could not keep it from being written.`],
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

  it("carries no code byte: DATA and CODE are the port's without the opcode cells, and DATA holds no byte CODE covers", async () => {
    const opts: PortOptions = { model: 3, hints: SEA_DRAGON_HINTS, runtimeImport: RUNTIME, source: 'seadrg01.cmd', standins: new Map([...standins(3)].map(([at, x]) => [at, x.name])) };
    type Mod = PortModule & { CODE: [number, number][]; CELLS: [number, number][] };
    const full = (await importPort(ok(port(SEA_DRAGON, { ...opts, trace: SEA_DRAGON_TRACE })).js)) as Mod;
    // The variants' roots decode nothing new: without the opcode cells there are none, and the code is the same
    const operands = { ...SEA_DRAGON_TRACE, patches: SEA_DRAGON_TRACE.patches.filter((x) => ![0x5174, 0x525e, 0x5aea].includes(x.addr)) };
    const without = (await importPort(ok(port(SEA_DRAGON, { ...opts, trace: operands })).js)) as Mod;
    expect(full.CODE).toEqual(without.CODE);
    expect(full.DATA.map(([a, b]) => [a, [...b]])).toEqual(without.DATA.map(([a, b]) => [a, [...b]]));
    const code = new Uint8Array(0x10000);
    for (const [from, to] of full.CODE) code.fill(1, from, to + 1);
    const inData = full.DATA.flatMap(([a, bytes]) => [...bytes].map((_, k) => a + k));
    expect(inData.filter((a) => code[a] === 1), 'code addresses in DATA').toEqual([]);
    expect(full.CELLS.map(([a]) => a)).toEqual([0x49c1, 0x4f41, 0x509b, 0x509c, 0x5174, 0x525e, 0x5ad0, 0x5add, 0x5aea]);
    expect(full.CELLS.every(([a]) => code[a] === 1), 'every cell is in CODE').toBe(true);
  });
});
