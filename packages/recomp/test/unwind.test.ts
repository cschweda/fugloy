/**
 * @fugloy/recomp, M2 Task 6: dropped return addresses. A Z80 program may throw away the return address a
 * CALL pushed (`POP AF` at Sea Dragon's $4BAC leaves its title loop for good). The census records each
 * such `POP` in the trace's `drops`; the port follows it: the instruction after the `POP` starts a routine
 * of its own (a continuation), and the `POP`'s block ends `throw o.unwind(n, CONTINUATION, at)`, which
 * abandons the JavaScript frame whose return address the program dropped (n of them for n `POP`s in a
 * row) and goes on with the continuation in the trampoline above it. Without the trace the port's next
 * RET finds the wrong address and stops with `o.ret`'s sentence.
 *
 * Ruling 10: a transfer back to the port's entry, when the entry's first block loads SP with a constant
 * before any CALL, RET, PUSH or POP (Sea Dragon's `LD SP,4495H` at $4980, reached from GAME OVER and from
 * SHIFT+BREAK inside nested calls), discards the whole Z80 stack: the port unwinds every frame to the
 * top-level trampoline, which runs the entry (`throw o.reset(ENTRY)`).
 *
 * Each program runs its exit ten thousand times, and the tests count the JavaScript stack's frames each
 * time round: they must not grow.
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
const $4 = (n: number): string => `$${hex(n, 4)}`;
const w4 = (n: number): string => `0x${hex(n, 4)}`;
const count = (text: string, part: string): number => text.split(part).length - 1;

/** The census's session: run the program from its entry until it returns to the stub's RETURNED (a HALT). */
const TO_RET: Session = {
  name: 'to-ret',
  play(m): void {
    if (m.run({ until: 'halt', cycles: 100_000_000 }).reason !== 'halt') throw new Error('the program did not return');
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

const options = (s: Synthetic, trace: PortTrace | null = s.trace): PortOptions => ({
  model: 3, names: namesOf(s.r), hints: s.hints, runtimeImport: RUNTIME, ...(trace === null ? {} : { trace }),
});

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

/** The JavaScript stack's depth here, in frames. */
function depth(): number {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  const n = new Error().stack!.split('\n').length;
  Error.stackTraceLimit = limit;
  return n;
}

/** `z.at` watched: the stack's depth each time a block in `watch` starts, by address. */
function depthsAt(z: Z, watch: readonly number[]): Map<number, number[]> {
  const seen = new Map(watch.map((a) => [a, [] as number[]]));
  const at = z.at.bind(z);
  z.at = (addr: number): void => {
    at(addr);
    seen.get(addr)?.push(depth());
  };
  return seen;
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

const ROUNDS = 10_000;

// ---- a title loop left for good: Sea Dragon's shape

/**
 * START calls TITLE ten thousand times. TITLE's loop calls FRAME, which on its third call jumps into GAME,
 * another routine's start (the CALL NZ that never runs makes it one). GAME's POP AF drops FRAME's return
 * address, so TITLE's loop is left for good, and its RET returns to TITLE's caller.
 */
const TITLE = program(`
START:  LD      HL,${ROUNDS}
        LD      (COUNT),HL
        XOR     A
        CALL    NZ,GAME         ; never taken: GAME is a routine, as a CALL elsewhere makes it
AGAIN:  CALL    TITLE           ; back here only through GAME's RET
        LD      HL,(COUNT)
        DEC     HL
        LD      (COUNT),HL
        LD      A,H
        OR      L
        JR      NZ,AGAIN
        LD      A,(SCORE)
        LD      (5000H),A
        RET
TITLE:  LD      B,3             ; three frames of the title, then the game
LOOP:   CALL    FRAME
        JR      LOOP
FRAME:  DEC     B
        RET     NZ
        JP      GAME            ; into another routine's start
GAME:   POP     AF              ; drops FRAME's return address: TITLE's loop is left for good
GOON:   LD      A,(SCORE)
        INC     A
        LD      (SCORE),A
        RET                     ; to TITLE's caller
COUNT:  DW      0
SCORE:  DB      0`);

describe('a POP that drops a return address', () => {
  const s = synthetic(TITLE);
  const game = s.at('GAME');
  const goon = s.at('GOON');

  it('is in the trace, and the port leaves the routine whose return address it drops, listing it in its report', () => {
    expect(s.trace.drops).toEqual([{ at: game, count: ROUNDS }]);
    const p = ok(port(s.cmd, options(s)));
    // The instruction after the POP starts a routine of its own, named as the caller named it
    expect(p.report.drops).toEqual([{ at: game, continuation: 'GOON' }]);
    expect(p.report.routines.map((r) => r.name)).toContain('GOON');
    expect(p.report.routines.find((r) => r.name === 'GOON')!.addr).toBe(goon);
    expect(p.report.routines.filter((r) => r.labelled)).toEqual([]);
    // The POP's ordinary translation, the block's tick and Q, then the unwind
    expect(p.js).toMatch(new RegExp(`z\\.af = o\\.pop\\(z\\);\\s+// \\${$4(game)}  POP AF\\n\\s+z\\.tick\\(10, 1\\); z\\.q = 0;\\n\\s+throw o\\.unwind\\(1, GOON, ${w4(game)}\\);`));
    expect(count(p.js, 'throw o.unwind(')).toBe(1);
  });

  it('passes the referee, ten thousand times round', async () => {
    const res = await referee({ cmd: s.cmd, model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, rom: 'game', steps: [{ run: 100_000_000 }] });
    if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
    // The referee's end-of-run marker crosses the trampolines an unwind went through, and ends the run there
    const part = await referee({ cmd: s.cmd, model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, rom: 'game', steps: [{ run: 50_000 }] });
    if (!part.ok) throw new Error(`the referee stopped: ${part.report}`);
    expect(part.cycles).toBeGreaterThanOrEqual(50_000);
    expect(part.cycles).toBeLessThan(res.cycles);
  });

  it('runs its continuation where the routine whose caller it returns to ran, and the stack does not grow', async () => {
    const mod = await importPort(ok(port(s.cmd, options(s))).js);
    const z = standalone(mod);
    const seen = depthsAt(z, [s.at('TITLE'), goon]);
    expect(runPort(z, mod)).toEqual({ reason: 'returned' });
    expect(z.mem[0x5000]).toBe(ROUNDS & 0xff);
    const atTitle = seen.get(s.at('TITLE'))!;
    const atGoon = seen.get(goon)!;
    expect(atGoon).toHaveLength(ROUNDS);
    expect(new Set(atGoon), 'the same depth every time round').toEqual(new Set([atGoon[0]]));
    // GOON runs in the trampoline TITLE ran in (START's o.call), so as deep as TITLE
    expect(new Set(atTitle)).toEqual(new Set([atGoon[0]]));
  });

  it("stops without the trace with o.ret's sentence, which says the census may need a session that reaches the POP", async () => {
    const p = ok(port(s.cmd, options(s, null)));
    expect(p.report.drops).toEqual([]);
    const mod = await importPort(p.js);
    const ret = goon + 7;
    const message = thrown(() => runPort(standalone(mod), mod));
    expect(message).toBe(
      `the RET at ${$4(ret)} returns to ${$4(s.at('AGAIN') + 3)}, not to ${$4(s.at('LOOP') + 3)}, the address after the CALL that ran its routine (a port follows a RET only back to its CALL) (if a POP dropped a return address here, the census needs a session that reaches it) (in GAME, in the block at ${$4(game)})`,
    );
  });

  it('lets an error thrown after the unwind take the routine and block it happened in, once', async () => {
    const mod = await importPort(ok(port(s.cmd, options(s))).js);
    const z = standalone(mod);
    const at = z.at.bind(z);
    let visits = 0;
    z.at = (addr: number): void => {
      at(addr);
      if (addr === goon && ++visits === 2) throw new Error('planted');
    };
    expect(thrown(() => runPort(z, mod))).toBe(`planted (in GOON, in the block at ${$4(goon)})`);
  });
});

// ---- two in a row

/** THREE's two POPs drop its own return address (into TWO) and TWO's (into ONE); its RET returns to ONE's caller. */
const TWICE = program(`
START:  LD      B,5
        LD      C,0
AGAIN:  CALL    ONE
        DJNZ    AGAIN
        LD      A,C
        LD      (5000H),A
        RET
ONE:    CALL    TWO
        INC     C               ; never runs: THREE leaves ONE for good
        RET
TWO:    CALL    THREE
        RET                     ; never runs
THREE:  POP     HL              ; THREE's return address, into TWO
        POP     HL              ; TWO's, into ONE
        INC     C
        RET                     ; to ONE's caller`);

describe('two POPs in a row, each dropping a return address', () => {
  const s = synthetic(TWICE);
  const three = s.at('THREE');

  it('unwind two frames, and the continuation starts after the second', async () => {
    expect(s.trace.drops).toEqual([{ at: three, count: 5 }, { at: three + 1, count: 5 }]);
    const p = ok(port(s.cmd, options(s)));
    const cont = `SUB_${hex(three + 2, 4)}`;
    expect(p.report.drops).toEqual([{ at: three, continuation: cont }, { at: three + 1, continuation: cont }]);
    expect(p.report.routines.map((r) => r.addr)).not.toContain(three + 1);
    expect(p.report.routines.map((r) => r.addr)).toContain(three + 2);
    // Each POP's address, in order (Task 7, Ruling 12: the sentence for a drop past the top names one of them)
    expect(p.js).toContain(`throw o.unwind(2, ${cont}, ${w4(three)}, ${w4(three + 1)});`);
    expect(count(p.js, 'throw o.unwind(')).toBe(1);
    const res = await referee({ cmd: s.cmd, model: 3, names: namesOf(s.r), hints: s.hints, trace: s.trace, rom: 'game', steps: [{ run: 1_000_000 }] });
    if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
    const mod = await importPort(p.js);
    const z = standalone(mod);
    runPort(z, mod);
    expect(z.mem[0x5000]).toBe(5);
  });

  it('refuse, as the port runs, a drop with no routine left to leave', async () => {
    // SUB's second POP takes the stub's RETURNED, which no CALL pushed: a trace that says it is a drop
    const top = synthetic(program(`
START:  CALL    SUB
        RET
SUB:    POP     HL
        POP     DE
        PUSH    DE
        RET`));
    const sub = top.at('SUB');
    expect(top.trace.drops).toEqual([{ at: sub, count: 1 }]);
    const trace = { ...top.trace, drops: [...top.trace.drops, { at: sub + 1, count: 1 }] };
    const mod = await importPort(ok(port(top.cmd, options(top, trace))).js);
    expect(thrown(() => runPort(standalone(mod), mod))).toBe(
      `the POP at ${$4(sub + 1)} drops a return address that no CALL of the port's pushed (the one the port's entry was started with, or one below it), which a port cannot follow (in SUB, in the block at ${$4(sub)})`,
    );
  });

  it('names, for a run of POPs that unwinds past the top, the POP that took the entry\'s return address, not the run\'s last', async () => {
    // SUB's first POP takes START's CALL's return address; its second, the stub's RETURNED (the entry's);
    // its third, the word below it. A trace that says all three drop one: SUB's trampoline takes the
    // first, the top-level trampoline is left with two, and the POP that took the entry's is the second
    const past = synthetic(program(`
START:  CALL    SUB
        RET
SUB:    POP     HL
        POP     DE
        POP     BC
        PUSH    BC
        PUSH    DE
        RET`));
    const sub = past.at('SUB');
    expect(past.trace.drops).toEqual([{ at: sub, count: 1 }]);
    const trace = { ...past.trace, drops: [{ at: sub, count: 1 }, { at: sub + 1, count: 1 }, { at: sub + 2, count: 1 }] };
    const p = ok(port(past.cmd, options(past, trace)));
    expect(p.js).toContain(`throw o.unwind(3, SUB_${hex(sub + 3, 4)}, ${w4(sub)}, ${w4(sub + 1)}, ${w4(sub + 2)});`);
    const mod = await importPort(p.js);
    expect(thrown(() => runPort(standalone(mod), mod))).toBe(
      `the POP at ${$4(sub + 1)} drops a return address that no CALL of the port's pushed (the one the port's entry was started with, or one below it), which a port cannot follow (in SUB, in the block at ${$4(sub)})`,
    );
  });

  it('refuse at port time a drop the trace names where the port has no POP', () => {
    const p = port(s.cmd, { ...options(s), trace: { ...s.trace, drops: [{ at: three + 2, count: 1 }] } });
    expect(p).toEqual({
      ok: false,
      errors: [`${$4(three + 2)}: the trace says a POP here dropped a return address, but the disassembly decoded INC C here, not a POP the port translates.`],
    });
  });
});

// ---- the stack reset: a jump back to an entry that reloads SP

const RETURNED = stub(3).returned;

/**
 * START reloads SP before anything touches the stack, then calls three deep, and THREE jumps back to
 * START, ten thousand times; STACK holds the stub's RETURNED, so START's RET Z ends the program.
 */
const RESET = (head: string): string => program(`
START:  ${head}
        LD      HL,(COUNT)
        LD      A,H
        OR      L
        RET     Z               ; done: to the stub's RETURNED, which STACK holds
        DEC     HL
        LD      (COUNT),HL
        CALL    ONE
        RET
ONE:    CALL    TWO
        RET
TWO:    CALL    THREE
        RET
THREE:  LD      A,(SCORE)
        INC     A
        LD      (SCORE),A
BACK:   JP      START           ; back to the entry, three calls deep
        DS      16
STACK:  DW      ${RETURNED}
COUNT:  DW      ${ROUNDS}
SCORE:  DB      0`);
const RELOADS = RESET('LD      SP,STACK');

describe('a jump back to an entry whose first block loads SP with a constant', () => {
  const r = assembled(RELOADS, 3);
  const cmd = toCmd(r);
  const at = (label: string): number => r.symbol(label)!.value;
  const opts: PortOptions = { model: 3, names: namesOf(r), runtimeImport: RUNTIME };

  it('unwinds every frame to the top, which runs the entry, and lists it in the report', () => {
    const p = ok(port(cmd, opts));
    expect(p.js).toContain('throw o.reset(START);');
    expect(p.js).not.toContain('return START;');
    expect(p.report.resets).toEqual([
      { at: at('BACK'), note: `${$4(at('BACK'))}: JP START goes back to the entry, START, whose first block loads SP with a constant (LD SP,${hex(at('STACK'), 4)}H at ${$4(at('START'))}) before any CALL, RET, PUSH or POP: the port unwinds every routine running and runs START from the top.` },
    ]);
  });

  it('passes the referee, ten thousand times round', async () => {
    const res = await referee({ cmd, model: 3, names: namesOf(r), steps: [{ run: 1_000_000_000 }] });
    if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
  });

  it('runs the entry at the top each time, and the stack does not grow', async () => {
    const mod = await importPort(ok(port(cmd, opts)).js);
    const z = standalone(mod);
    const seen = depthsAt(z, [at('START')]);
    expect(runPort(z, mod)).toEqual({ reason: 'returned' });
    expect(z.mem[at('SCORE')]).toBe(ROUNDS & 0xff);
    const atStart = seen.get(at('START'))!;
    expect(atStart).toHaveLength(ROUNDS + 1);
    expect(new Set(atStart), 'the same depth every time round').toEqual(new Set([atStart[0]]));
  });

  it("is not made when the program rewrites the LD SP's operand: it then loads an SP the program saved, not a constant", async () => {
    // SAVE stores SP (pointing at its own return address) in START's LD SP,nn and jumps back to START, which
    // reloads it and returns through SAVE's frame: a reset would have discarded the frame the RET needs
    const saved = synthetic(program(`
START:  LD      SP,STACK        ; rewritten by SAVE
        LD      A,(ROUND)
        OR      A
        JR      NZ,AGAIN
        INC     A
        LD      (ROUND),A
        CALL    SAVE
        LD      A,42
        LD      (RESULT),A
        RET                     ; to the stub's RETURNED, which STACK holds
AGAIN:  RET                     ; to SAVE's caller, through the frame the saved SP points at
SAVE:   LD      (START+1),SP
        JP      START
        DS      16
STACK:  DW      ${RETURNED}
ROUND:  DB      0
RESULT: DB      0`));
    const start = saved.at('START');
    expect(saved.trace.patches.map((x) => x.addr)).toEqual([start + 1, start + 2]);
    const p = ok(port(saved.cmd, options(saved)));
    expect(p.report.resets).toEqual([]);
    expect(p.js).not.toContain('o.reset(');
    expect(p.js).toContain('return START;');
    const res = await referee({ cmd: saved.cmd, model: 3, names: namesOf(saved.r), hints: saved.hints, trace: saved.trace, rom: 'game', steps: [{ run: 1_000_000 }] });
    if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
    const mod = await importPort(p.js);
    const z = standalone(mod);
    expect(runPort(z, mod)).toEqual({ reason: 'returned' });
    expect(z.mem[saved.at('RESULT')]).toBe(42);
  });

  it('is not made for an entry that touches the stack first, or never loads SP', () => {
    for (const head of ['PUSH    AF\n        POP     AF\n        LD      SP,STACK', 'NOP']) {
      const other = assembled(RESET(head), 3);
      const p = ok(port(toCmd(other), { model: 3, names: namesOf(other), runtimeImport: RUNTIME }));
      expect(p.js).toContain('return START;');
      expect(p.js).not.toContain('o.reset(');
      expect(p.report.resets).toEqual([]);
    }
  });
});

// ---- Sea Dragon

const SEA_DRAGON = new Uint8Array(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url)));
const SEA_DRAGON_HINTS = readFileSync(new URL('../../../examples/sea-dragon/seadrg01.hints', import.meta.url), 'utf8');
const SEA_DRAGON_TRACE = parseTrace(readFileSync(new URL('../../../examples/sea-dragon/seadrg01.trace.json', import.meta.url), 'utf8'), programHash(SEA_DRAGON));

describe('Sea Dragon (seadrg01.cmd) with its hint file and trace', () => {
  it("leaves the title loop at $4BAC's POP AF and unwinds to the top at each jump back to $497F", () => {
    const opts: PortOptions = { model: 3, hints: SEA_DRAGON_HINTS, trace: SEA_DRAGON_TRACE, runtimeImport: RUNTIME, source: 'seadrg01.cmd', standins: new Map([...standins(3)].map(([a, x]) => [a, x.name])) };
    const p = ok(port(SEA_DRAGON, opts));
    expect(ok(port(SEA_DRAGON, opts)).js, 'the same module twice').toBe(p.js);
    expect(p.report.drops).toEqual([{ at: 0x4bac, continuation: 'SUB_4BAD' }]);
    expect(p.report.routines.find((r) => r.addr === 0x4bad)).toMatchObject({ name: 'SUB_4BAD', labelled: false });
    expect(p.report.routines.filter((r) => r.labelled)).toEqual([]);
    expect(p.report.refused).toEqual([]);
    expect(p.js).toContain('throw o.unwind(1, SUB_4BAD, 0x4BAC);');
    // GAME OVER ($6042) and SHIFT+BREAK ($4CC6), and $602D
    expect(p.report.resets.map((x) => x.at)).toEqual([0x4cc6, 0x602d, 0x6042]);
    expect(p.js).not.toContain('return L497F;');
  });
});
