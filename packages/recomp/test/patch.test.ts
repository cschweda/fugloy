/**
 * @fugloy/recomp, M2 Task 4: rewritten operands. A program that rewrites an operand of one of its own
 * instructions (an index displacement, an immediate, a word) is ported with a trace the census took of
 * it (tools/census.ts): port() matches each of the trace's cells to the instruction byte it is, and the
 * instruction's statement reads the cell from memory when it runs, so the port carries the cell's
 * initial value (`CELLS`) and none of the code. A rewritten JP nn goes to each target the trace saw it
 * hold, and throws a sentence for any other. Any write into code the trace does not name is refused: by
 * the referee as M1 refused it, and in a standalone port by `load`'s write guard, at the write.
 *
 * Each synthetic program is assembled with @fugloy/asm, its census taken on the game stub ROM by a
 * session that runs it to its RET, and its port run beside emu by the referee.
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
import type { RefereeResult, Step } from './referee.js';
import type { Session } from './sessions/sea-dragon.js';

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
const $4 = (n: number): string => `$${hex(n, 4)}`;

/** The census's session for a synthetic program: run it from its entry until it returns to the stub's RETURNED (a HALT). */
const TO_RET: Session = {
  name: 'to-ret',
  play(m): void {
    if (m.run({ until: 'halt', cycles: 1_000_000 }).reason !== 'halt') throw new Error('the program did not return');
  },
};

/** A synthetic program: assembled, its .CMD, its hint file (a skeleton, plus an entry at each label in `entries`), and its census. */
function synthetic(source: string, entries: readonly string[] = []): { r: AsmResult; cmd: Uint8Array; hints: string; trace: PortTrace; at: (label: string) => number } {
  const r = assembled(source, 3);
  const cmd = toCmd(r);
  const at = (label: string): number => r.symbol(label)!.value;
  const hints = `${writeHints(skeletonHints(loadCmd(cmd), cmd))}${entries.map((e) => `block 0:$${hex(at(e) - 0x7000, 4)} entry\n`).join('')}`;
  const trace = census({ cmd, name: 'synthetic.cmd', hints, model: 3, rom: 'game', sessions: [TO_RET] });
  return { r, cmd, hints, trace, at };
}

const options = (s: { r: AsmResult; hints: string; trace: PortTrace }): PortOptions => ({ model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, runtimeImport: RUNTIME });

const judge = (s: { r: AsmResult; cmd: Uint8Array; hints: string; trace: PortTrace }, steps: Step[] = [{ run: 1_000_000 }]): Promise<RefereeResult> =>
  referee({ cmd: s.cmd, model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, rom: 'game', steps });

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

/** Each instruction byte of an assembled program, from its listing (every line but its DB lines). */
function codeBytes(r: AsmResult): Set<number> {
  const code = new Set<number>();
  for (const l of r.listing) {
    if (l.address === null || /^\s*(\w+:?)?\s+D[BW]\b/i.test(l.text)) continue;
    l.bytes.forEach((_, k) => code.add(l.address! + k));
  }
  return code;
}

/**
 * The module carries none of the program's code: DATA holds no code byte, CELLS holds exactly the trace's
 * cells, each with its byte as the program loads it, and CODE covers every instruction byte.
 */
async function expectNoCodeButCells(s: { r: AsmResult; trace: PortTrace }, js: string): Promise<void> {
  const mod = (await importPort(js)) as PortModule & { CODE: [number, number][]; CELLS: [number, number][] };
  const code = codeBytes(s.r);
  const inData = mod.DATA.flatMap(([a, bytes]) => [...bytes].map((_, k) => a + k));
  expect(inData.filter((a) => code.has(a)), 'code addresses in DATA').toEqual([]);
  expect(mod.CELLS).toEqual(s.trace.patches.map((p) => [p.addr, s.r.image!.bytes[p.addr]]));
  const covered = new Set(mod.CODE.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, k) => from + k)));
  expect([...code].filter((a) => !covered.has(a)), 'code bytes CODE leaves out').toEqual([]);
}

// ---- the programs

/** Sums a four-byte table back to front through LD A,(IX+d), its displacement rewritten each time round (-4 to -1). */
const DISP = program(`
START:  LD      IX,TABLE+4
        LD      B,4
        LD      C,0
LOOP:   LD      A,B
        NEG
        LD      (READ+2),A      ; the displacement of the LD below
READ:   LD      A,(IX+0)
        ADD     A,C
        LD      C,A
        DJNZ    LOOP
        LD      (5000H),A
        RET
TABLE:  DB      1,2,3,40H`);

/** Rewrites a JP's target, byte by byte, from a table: EVEN and ODD in turn, six times round. */
const JUMP = program(`
START:  LD      B,6
        LD      C,0
LOOP:   LD      A,B
        AND     1
        ADD     A,A
        LD      E,A
        LD      D,0
        LD      HL,TARGETS
        ADD     HL,DE
        LD      A,(HL)
        LD      (JUMP+1),A
        INC     HL
        LD      A,(HL)
        LD      (JUMP+2),A
JUMP:   JP      EVEN
EVEN:   INC     C
        JR      NEXT
ODD:    INC     C               ; only the rewritten JP reaches it
        INC     C
NEXT:   DJNZ    LOOP
        LD      A,C
        LD      (5000H),A
        RET
TARGETS: DW     EVEN,ODD`);

/** Rewrites an ADD A,n's immediate (B, 5 down to 1), and the low byte alone of a LD HL,nn's word (2B), and stores the sum so far at $5000 + 2B. */
const IMM = program(`
START:  LD      B,5
        LD      C,0
LOOP:   LD      A,B
        LD      (ADDI+1),A      ; the immediate of the ADD below
        LD      A,C
ADDI:   ADD     A,0
        LD      C,A
        LD      A,B
        ADD     A,A
        LD      (PTR+1),A       ; the low byte of the LD's word
PTR:    LD      HL,5000H
        LD      (HL),C
        DJNZ    LOOP
        RET`);

/** Writes a RET over its own NOP at DONE, but only while ENTER is held: the census's session holds no key. */
const UNSEEN = program(`
START:  LD      A,(3840H)       ; ENTER is bit 0
        AND     1
        JR      Z,DONE
        LD      A,0C9H
POKE:   LD      (DONE),A
DONE:   NOP
        RET`);

describe('a rewritten operand, read from memory when its instruction runs', () => {
  it('an index displacement: LD A,(IX+d) reads its d from the cell, sign-extended, and passes the referee', async () => {
    const s = synthetic(DISP);
    const read = s.at('READ');
    expect(s.trace.patches).toEqual([{ addr: read + 2, writers: [s.at('LOOP') + 3], values: [0xfc, 0xfd, 0xfe, 0xff] }]);
    const p = ok(port(s.cmd, options(s)));
    expect(p.report.cells).toEqual([{ addr: read + 2, instruction: read, kind: 'disp', values: [0xfc, 0xfd, 0xfe, 0xff] }]);
    // One readable line: the cell's address in the code, the original assembly in its comment
    const line = p.js.split('\n').find((l) => l.includes(`z.mem[0x${hex(read + 2, 4)}]`));
    expect(line).toMatch(new RegExp(`^\\s*z\\.wz = \\(z\\.ix \\+ \\(\\(z\\.mem\\[0x${hex(read + 2, 4)}\\] \\^ 0x80\\) - 0x80\\)\\) & 0xffff; z\\.a = z\\.read\\(z\\.wz\\);\\s+// \\$${hex(read, 4)}  LD A,\\(IX\\+00H\\)`));
    await expectNoCodeButCells(s, p.js);
    passed(await judge(s));
  });

  it('a JP whose target is rewritten goes to each target the trace saw, and passes the referee', async () => {
    const s = synthetic(JUMP, ['ODD']);
    const jump = s.at('JUMP');
    const lo = (label: string): number => s.at(label) & 0xff;
    const p = ok(port(s.cmd, options(s)));
    expect(p.report.cells).toEqual([
      { addr: jump + 1, instruction: jump, kind: 'word', values: [lo('EVEN'), lo('ODD')].sort((x, y) => x - y) },
      { addr: jump + 2, instruction: jump, kind: 'word', values: [0x70] },
    ]);
    expect(p.js).toContain(`z.wz = z.mem[0x${hex(jump + 1, 4)}] | z.mem[0x${hex(jump + 2, 4)}] << 8;`);
    expect(p.js).toContain(`if (z.wz === 0x${hex(s.at('EVEN'), 4)}) {`);
    expect(p.js).toContain(`if (z.wz === 0x${hex(s.at('ODD'), 4)}) {`);
    // The two targets are blocks of one routine, written as structured code
    expect(p.report.routines.map((r) => [r.name, r.labelled])).toEqual([['START', false]]);
    await expectNoCodeButCells(s, p.js);
    passed(await judge(s));
  });

  it('a JP target cell holding a third value throws, naming the cell, the value and the two targets it may hold', async () => {
    const s = synthetic(JUMP, ['ODD']);
    const mod = await importPort(ok(port(s.cmd, options(s))).js);
    const z = standalone(mod);
    // The first time round the program takes TARGETS' first word: make it NEXT, which the trace never saw
    const targets = s.at('TARGETS');
    z.mem[targets] = s.at('NEXT') & 0xff;
    z.mem[targets + 1] = s.at('NEXT') >> 8;
    expect(thrown(() => runPort(z, mod))).toBe(
      `the transfer at ${$4(s.at('JUMP'))} goes to ${$4(s.at('NEXT'))}: the program rewrote its target at ${$4(s.at('JUMP') + 1)} to a value the trace did not see ` +
        `(it saw ${$4(s.at('EVEN'))} and ${$4(s.at('ODD'))}); run the census over a session that reaches this (in START, in the block at ${$4(s.at('LOOP'))})`,
    );
  });

  it('a JP target the trace saw where no block starts makes port() fail, naming it', () => {
    const s = synthetic(JUMP, ['ODD']);
    const unhinted = writeHints(skeletonHints(loadCmd(s.cmd), s.cmd));
    const p = port(s.cmd, { ...options(s), hints: unhinted });
    expect(p).toEqual({ ok: false, errors: [expect.stringMatching(new RegExp(`^\\${$4(s.at('JUMP'))}: JP .*'s target is rewritten to \\${$4(s.at('ODD'))}, where no block of the disassembly starts`))] });
  });

  it('an immediate, and the low byte alone of a word: each read from its cell, and the referee passes', async () => {
    const s = synthetic(IMM);
    const addi = s.at('ADDI');
    const ptr = s.at('PTR');
    const p = ok(port(s.cmd, options(s)));
    expect(p.report.cells).toEqual([
      { addr: addi + 1, instruction: addi, kind: 'imm', values: [1, 2, 3, 4, 5] },
      { addr: ptr + 1, instruction: ptr, kind: 'word', values: [2, 4, 6, 8, 10] },
    ]);
    expect(p.js).toContain(`z.a = o.add8(z, z.a, z.mem[0x${hex(addi + 1, 4)}]);`);
    // The high byte is not rewritten: the port does not carry it, and it stays the constant it was loaded with
    expect(p.js).toContain(`z.hl = z.mem[0x${hex(ptr + 1, 4)}] | 0x5000;`);
    await expectNoCodeButCells(s, p.js);
    passed(await judge(s));
  });
});

describe('a write into code the trace does not name', () => {
  const s = synthetic(UNSEEN);

  it('is not in the trace: the census held no key', () => {
    expect(s.trace.patches).toEqual([]);
  });

  it("is refused by the referee with M1's sentence, naming both addresses", async () => {
    const res = failed(await judge(s, [{ press: 'ENTER' }, { run: 100_000 }]));
    expect(res.field).toBe('code');
    expect(res.report).toContain(`self-modifying code: ${$4(s.at('DONE'))} written by the instruction at ${$4(s.at('POKE'))} (M1 does not translate it)`);
  });

  it("throws the guard's sentence at the write, in a standalone port", async () => {
    const mod = await importPort(ok(port(s.cmd, options(s))).js);
    const z = standalone(mod);
    z.press('ENTER');
    expect(thrown(() => runPort(z, mod))).toBe(
      `self-modifying code: ${$4(s.at('DONE'))} written (the trace does not name it; run the census over a session that reaches this) (in START, in the block at ${$4(s.at('DONE') - 5)})`,
    );
    // Without ENTER the program never writes there, and returns
    const quiet = standalone(mod);
    expect(runPort(quiet, mod)).toEqual({ reason: 'returned' });
  });
});

// ---- Sea Dragon

const SEA_DRAGON = new Uint8Array(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url)));
const SEA_DRAGON_HINTS = readFileSync(new URL('../../../examples/sea-dragon/seadrg01.hints', import.meta.url), 'utf8');
const SEA_DRAGON_TRACE = parseTrace(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.trace.json', import.meta.url), 'utf8'), programHash(SEA_DRAGON));
/** The three sites that swap a whole opcode: $5174 (LD (HL),A / NOP), $525E (JP NZ / JP Z), $5AEA (CALL / RET). */
const OPCODE_CELLS = [0x5174, 0x525e, 0x5aea];

describe('Sea Dragon (seadrg01.cmd) with its hint file and trace', () => {
  const seaDragon = (trace: PortTrace): PortResult =>
    port(SEA_DRAGON, { model: 3, hints: SEA_DRAGON_HINTS, trace, runtimeImport: RUNTIME, source: 'seadrg01.cmd', standins: new Map([...standins(3)].map(([at, x]) => [at, x.name])) });

  it('fails for the three opcode cells alone, each named', () => {
    const p = seaDragon(SEA_DRAGON_TRACE);
    if (p.ok) throw new Error('Sea Dragon ported, its opcode cells and all');
    expect(p.errors).toHaveLength(3);
    p.errors.forEach((e, k) => expect(e).toMatch(new RegExp(`^\\${$4(OPCODE_CELLS[k]!)}: the program rewrites the opcode of `)));
    expect(p.errors[1]).toContain('the trace saw $C2 and $CA there');
  });

  it('ports its five operand sites, the JP at $509A to $509D and $50C1, with no routine labelled', () => {
    const operands = { ...SEA_DRAGON_TRACE, patches: SEA_DRAGON_TRACE.patches.filter((x) => !OPCODE_CELLS.includes(x.addr)) };
    const p = ok(seaDragon(operands));
    expect(p.report.cells.map((c) => [c.addr, c.instruction, c.kind])).toEqual([
      [0x49c1, 0x49bf, 'disp'],
      [0x4f41, 0x4f3f, 'disp'],
      [0x509b, 0x509a, 'word'],
      [0x509c, 0x509a, 'word'],
      [0x5ad0, 0x5ace, 'disp'],
      [0x5add, 0x5adb, 'disp'],
    ]);
    expect(p.report.routines.filter((r) => r.labelled)).toEqual([]);
    expect(p.report.refused).toEqual([]);
    expect(p.js).toContain('z.wz = z.mem[0x509B] | z.mem[0x509C] << 8;');
    expect(p.js).toContain('if (z.wz === 0x509D) {');
    expect(p.js).toContain('if (z.wz === 0x50C1) {');
    for (const cell of [0x49c1, 0x4f41, 0x5ad0, 0x5add]) expect(p.js).toContain(`z.mem[0x${hex(cell, 4)}]`);
  });
});
