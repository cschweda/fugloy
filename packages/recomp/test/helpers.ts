/**
 * What recomp's tests share: Fugløy's stub ROM as packages/asm/test/lessons.test.ts builds it, the
 * programs assembled with @fugloy/asm, the CPU state read from emu and from a runtime `Z`, and a port
 * module imported from its text. port.test.ts, referee.ts and referee.test.ts use them.
 */
import { readFileSync } from 'node:fs';
import type { Machine, Z80CPU } from '@fugloy/emu';
import { assemble } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import type { PortModule, Z } from '@fugloy/runtime';

export type Model = 1 | 3;

export const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');

// ---- the stub ROM, as lessons.test.ts builds it

const HALT = 0x76;
/** Where each model's ROM space ends: the stub is padded with HALT to it, as the site pads it. */
const ROM_END: Readonly<Record<Model, number>> = { 1: 0x3000, 3: 0x3800 };
const stubSource = readFileSync(new URL('../../../apps/web/app/utils/emulator/stub-rom.z', import.meta.url), 'utf8');

/** `source` assembled for `model`, or an error naming the lines that did not assemble. */
export function assembled(source: string, model: Model): AsmResult {
  const r = assemble(source, { model });
  const errors = r.diagnostics.filter((d) => d.severity === 'error').map((d) => `line ${d.line}: ${d.message}`);
  if (!r.ok || r.image === null) throw new Error(`did not assemble: ${errors.join('; ')}`);
  return r;
}

const stubs = new Map<Model, { rom: Uint8Array; returned: number }>();
/** Fugløy's stub ROM for a model, padded with HALT, and the address of its RETURNED. */
export function stub(model: Model): { rom: Uint8Array; returned: number } {
  let s = stubs.get(model);
  if (s === undefined) {
    const r = assembled(stubSource, model);
    const rom = new Uint8Array(ROM_END[model]).fill(HALT);
    for (const run of r.image!.runs()) rom.set(r.image!.bytes.subarray(run.start, run.start + run.length), run.start);
    s = { rom, returned: r.symbol('RETURNED')!.value };
    stubs.set(model, s);
  }
  return s;
}

/** The names an assembled program defines on its own lines (not the ROM's), by address: the first at each. */
export function namesOf(r: AsmResult): Map<number, string> {
  const names = new Map<number, string>();
  for (const [address, all] of allNamesOf(r)) names.set(address, all[0]!);
  return names;
}

/**
 * Every name an assembled program defines on its own lines, by address, in the order it defines them:
 * the referee's `names`, so a `pcIn` finds a label that shares its address with another (the port is
 * named by the first, as with `namesOf`).
 */
export function allNamesOf(r: AsmResult): Map<number, string[]> {
  const names = new Map<number, string[]>();
  for (const [name, s] of r.symbols) {
    if (s.line === 0) continue;
    const at = names.get(s.value);
    if (at === undefined) names.set(s.value, [name]);
    else at.push(name);
  }
  return names;
}

// ---- the CPU state, on emu and on the runtime

/** Every register, F, R, MEMPTR, the interrupt state, Q and the T-states: what a port and emu must agree on. */
export interface State {
  a: number; f: number; b: number; c: number; d: number; e: number; h: number; l: number;
  ix: number; iy: number; sp: number; i: number; r: number; wz: number;
  af_: number; bc_: number; de_: number; hl_: number;
  iff1: boolean; iff2: boolean; im: number; q: number; cycles: number;
}

export const cpuOf = (m: Machine): Z80CPU => m.system.cpu;

export function emuState(m: Machine): State {
  const cpu = cpuOf(m);
  const g = cpu.registers;
  const pair = (hi: string, lo: string): number => (g[hi]! << 8) | g[lo]!;
  return {
    a: g.A!, f: g.F!, b: g.B!, c: g.C!, d: g.D!, e: g.E!, h: g.H!, l: g.L!,
    ix: pair('IXH', 'IXL'), iy: pair('IYH', 'IYL'), sp: g.SP!, i: g.I!, r: g.R!, wz: cpu.wz,
    af_: pair('A_', 'F_'), bc_: pair('B_', 'C_'), de_: pair('D_', 'E_'), hl_: pair('H_', 'L_'),
    iff1: cpu.IFF1, iff2: cpu.IFF2, im: cpu.interruptMode,
    // emu's Q: the instruction just run wrote the flags (z80cpu.js, executeInstruction)
    q: cpu.flagsWritten ? 1 : 0,
    cycles: cpu.cycles,
  };
}

export function zState(z: Z): State {
  return {
    a: z.a, f: z.f, b: z.b, c: z.c, d: z.d, e: z.e, h: z.h, l: z.l,
    ix: z.ix, iy: z.iy, sp: z.sp, i: z.i, r: z.r, wz: z.wz,
    af_: z.af_, bc_: z.bc_, de_: z.de_, hl_: z.hl_,
    iff1: z.iff1, iff2: z.iff2, im: z.im, q: z.q, cycles: z.cycles,
  };
}

/** Give `z` the state `s` and the 64K `mem`. */
export function setZ(z: Z, s: State, mem: Uint8Array): void {
  Object.assign(z, { a: s.a, f: s.f, b: s.b, c: s.c, d: s.d, e: s.e, h: s.h, l: s.l });
  z.ix = s.ix;
  z.iy = s.iy;
  Object.assign(z, { sp: s.sp, i: s.i, r: s.r, wz: s.wz, af_: s.af_, bc_: s.bc_, de_: s.de_, hl_: s.hl_ });
  Object.assign(z, { iff1: s.iff1, iff2: s.iff2, im: s.im, q: s.q, cycles: s.cycles });
  z.mem.set(mem);
}

export const memOf = (m: Machine): Uint8Array => m.mem.read(0, 0x10000);

// ---- a port module

/** The runtime's helpers by absolute URL: a data: module resolves only absolute specifiers. */
export const RUNTIME = new URL('../../runtime/src/ops.js', import.meta.url).href;

/** The module text as a module (a data: URL), as a bundle would import it. */
export const importPort = async (js: string): Promise<PortModule> =>
  (await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`)) as PortModule;

// ---- Task 3's programs, which port.test.ts and referee.test.ts both run

export const program = (body: string): string => `\tORG\t7000H\n${body}\n\tEND\tSTART\n`;

export const PROGRAMS: Record<string, string> = {
  'a straight line of loads and arithmetic': program(`
START:  LD      A,12H
        LD      B,34H
        ADD     A,B
        LD      C,A
        SUB     5
        LD      HL,1234H
        LD      DE,0FEDCH
        ADD     HL,DE
        INC     A
        DEC     B
        XOR     C
        LD      (5000H),A
        LD      A,1
        CP      28H             ; F's bits 5 and 3 from the operand, not from A
        SCF                     ; Q 1: bits 5 and 3 from A alone
        CCF
        PUSH    AF              ; F, kept in C for the end
        POP     BC
        LD      A,R             ; R as at its own start
        LD      (5001H),A
        LD      IX,4321H
        LD      (IX+2),A
        RET`),
  'a DJNZ count': program(`
START:  LD      B,10
        LD      A,0F7H
        XOR     2AH             ; ends the block with the flags written
LOOP:   SCF                     ; Q: the XOR's the first time round, the DJNZ's after
        ADC     A,B
        DJNZ    LOOP
        LD      (5000H),A
        RET`),
  'a conditional JP and JR both ways': program(`
START:  LD      A,5
        CP      5
        JP      Z,EQUAL         ; taken
        LD      A,0FFH
EQUAL:  CCF                     ; a block's first instruction, after a JP and a LD
        CP      6
        JP      Z,EQUAL         ; not taken
        JR      NC,EQUAL        ; not taken: 5 < 6 sets C
        JR      C,LESS          ; taken
        LD      A,0EEH
LESS:   LD      (5000H),A
        RET`),
  'nested CALL and RET three deep': program(`
START:  LD      A,1
        CALL    ONE
        LD      (5000H),A
        OR      A
        CALL    Z,THREE         ; not taken
        CALL    NZ,THREE        ; taken
        LD      (5001H),A
        RET
ONE:    ADD     A,A
        CALL    TWO
        INC     A
        RET
TWO:    ADD     A,A
        CALL    THREE
        INC     A
        RET
THREE:  ADD     A,3
        RET     Z               ; not taken
        PUSH    AF
        POP     BC
        RET     NZ              ; taken`),
  'a JP from one routine into another, a thousand times round': program(`
START:  LD      HL,0
        LD      DE,1000
        CALL    PING            ; a thousand rounds of PING and PONG
        LD      DE,1
        CALL    PONG            ; and one more, from PONG
        LD      (5000H),HL
        RET
PING:   LD      A,D
        OR      E
        RET     Z               ; back to whoever called the first of them
        DEC     DE
        JP      PONG            ; into another routine's start
PONG:   INC     HL
        JP      PING            ; and back into this one's`),
  'a data table read with LD A,(HL)': program(`
START:  LD      HL,TABLE
        LD      B,4
        LD      C,0
NEXT:   LD      A,(HL)
        ADD     A,C
        LD      C,A
        INC     HL
        DJNZ    NEXT
        LD      (5000H),A
        RET
TABLE:  DB      1,2,3,40H`),
  'a two-block .CMD': `\tORG\t7000H
START:  LD      HL,MSG
        CALL    SHOW
        RET
        ORG     8000H
SHOW:   LD      DE,3C00H
        LD      BC,5
        LDIR
        RET
MSG:    DB      'HELLO'
        END     START
`,
  // Task 6's: an if/else whose arms meet again, run both ways, and a loop left from inside a loop within it
  'an if/else diamond, both arms taken in turn': program(`
START:  LD      B,6
        LD      C,0
NEXT:   LD      A,B
        CP      3
        JR      C,SMALL         ; B below 3: the else arm
        INC     C               ; B 3 or more: the then arm
        JR      JOIN
SMALL:  DEC     C
JOIN:   DJNZ    NEXT            ; the arms meet here
        LD      A,C
        LD      (5000H),A
        RET`),
  'a loop inside a loop, left from the inner one': program(`
START:  LD      E,0
        LD      C,4
OUTER:  LD      B,3
INNER:  INC     E
        LD      A,E
        CP      10
        JR      Z,DONE          ; leaves both loops, the tenth time round
        DJNZ    INNER
        DEC     C
        JR      NZ,OUTER
DONE:   LD      (5000H),A
        RET`),
  'a loop entered in its middle (irreducible)': program(`
START:  LD      A,0
        LD      B,3
        OR      A
        JR      Z,SECOND        ; into the loop below its head
FIRST:  INC     A
SECOND: DEC     B
        JR      NZ,FIRST
        LD      (5000H),A
        RET`),
};
