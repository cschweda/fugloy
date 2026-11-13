/**
 * @fugloy/recomp, M1 Task 3: port() groups a program's blocks into routines and emits it as one
 * JavaScript module, which @fugloy/runtime's run.js loads and runs. Each program here is assembled
 * with @fugloy/asm and run twice from the same state: on @fugloy/emu, Fugløy's stub ROM booted and the
 * program loaded as packages/asm/test/lessons.test.ts does, until it returns to the stub's RETURNED;
 * and as its port, on a runtime `Z` given emu's registers and 64K at the moment the stub hands over
 * to the program, until runPort says the entry returned. Every register, F, R, MEMPTR, Q, the
 * interrupt state, the T-states and the 64K must then be equal. Both models, the Model III and the
 * Model I, run every program.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { Machine } from '@fugloy/emu';
import type { Z80CPU } from '@fugloy/emu';
import { assemble, toCmd } from '@fugloy/asm';
import { loadCmd, skeletonHints, writeHints } from '@fugloy/disasm';
import type { AsmResult } from '@fugloy/asm';
import { createZ, load, runPort } from '@fugloy/runtime';
import type { PortModule, Z } from '@fugloy/runtime';
import { describe, expect, it } from 'vitest';
import { port } from '../src/index.js';
import type { PortOptions, PortResult } from '../src/index.js';

type Model = 1 | 3;
const MODELS: readonly Model[] = [3, 1];

const hex = (n: number, width: number): string => n.toString(16).toUpperCase().padStart(width, '0');

// ---- the emu side: the stub ROM, as lessons.test.ts builds it

const HALT = 0x76;
/** Where each model's ROM space ends: the stub is padded with HALT to it, as the site pads it. */
const ROM_END: Readonly<Record<Model, number>> = { 1: 0x3000, 3: 0x3800 };
const stubSource = readFileSync(new URL('../../../apps/web/app/utils/emulator/stub-rom.z', import.meta.url), 'utf8');

function assembled(source: string, model: Model): AsmResult {
  const r = assemble(source, { model });
  const errors = r.diagnostics.filter((d) => d.severity === 'error').map((d) => `line ${d.line}: ${d.message}`);
  if (!r.ok || r.image === null) throw new Error(`did not assemble: ${errors.join('; ')}`);
  return r;
}

const stubs = new Map<Model, { rom: Uint8Array; returned: number }>();
/** Fugløy's stub ROM for a model, padded with HALT, and the address of its RETURNED. */
function stub(model: Model): { rom: Uint8Array; returned: number } {
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

/** Everything compared at the end but the 64K. */
interface State {
  a: number; f: number; b: number; c: number; d: number; e: number; h: number; l: number;
  ix: number; iy: number; sp: number; i: number; r: number; wz: number;
  af_: number; bc_: number; de_: number; hl_: number;
  iff1: boolean; iff2: boolean; im: number; q: number; cycles: number;
}

const cpuOf = (m: Machine): Z80CPU => m.system.cpu;

function emuState(m: Machine): State {
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

function zState(z: Z): State {
  return {
    a: z.a, f: z.f, b: z.b, c: z.c, d: z.d, e: z.e, h: z.h, l: z.l,
    ix: z.ix, iy: z.iy, sp: z.sp, i: z.i, r: z.r, wz: z.wz,
    af_: z.af_, bc_: z.bc_, de_: z.de_, hl_: z.hl_,
    iff1: z.iff1, iff2: z.iff2, im: z.im, q: z.q, cycles: z.cycles,
  };
}

function setZ(z: Z, s: State, mem: Uint8Array): void {
  Object.assign(z, { a: s.a, f: s.f, b: s.b, c: s.c, d: s.d, e: s.e, h: s.h, l: s.l });
  z.ix = s.ix;
  z.iy = s.iy;
  Object.assign(z, { sp: s.sp, i: s.i, r: s.r, wz: s.wz, af_: s.af_, bc_: s.bc_, de_: s.de_, hl_: s.hl_ });
  Object.assign(z, { iff1: s.iff1, iff2: s.iff2, im: s.im, q: s.q, cycles: s.cycles });
  z.mem.set(mem);
}

const memOf = (m: Machine): Uint8Array => m.mem.read(0, 0x10000);

/**
 * The Model I's Expansion Interface, $37E0-$37EF: its 40 Hz interrupt latch sets bits there as time
 * passes. The runtime does not model it and throws a sentence at any read or write of it, so a port
 * cannot differ there silently; the 64K are compared without it.
 */
const EXPANSION = { start: 0x37e0, end: 0x37ef };

/** The first address where two 64Ks differ, with both bytes, or null; on the Model I, outside the Expansion Interface. */
function firstDifference(model: Model, port: Uint8Array, emu: Uint8Array): string | null {
  const a = Buffer.from(port);
  const b = Buffer.from(emu);
  if (model === 1) b.copy(a, EXPANSION.start, EXPANSION.start, EXPANSION.end + 1);
  if (a.equals(b)) return null;
  const at = a.findIndex((v, k) => v !== b[k]);
  return `$${hex(at, 4)}: port $${hex(a[at]!, 2)}, emu $${hex(b[at]!, 2)}`;
}

interface EmuRun {
  /** The state and 64K at the program's entry, as the stub ROM hands over to it. */
  start: State;
  startMem: Uint8Array;
  /** The state and 64K when the program has returned to the stub's RETURNED. */
  end: State;
  endMem: Uint8Array;
  /** Every instruction's start: its T-state, and there the PC and R. */
  boundaries: Map<number, { pc: number; r: number }>;
}

/** Boot the stub, load the program, and step it until it returns to RETURNED. */
function onEmu(cmd: Uint8Array, model: Model): EmuRun {
  const { rom, returned } = stub(model);
  const m = new Machine({ model, roms: { level2: rom } });
  expect(m.run({ until: 'halt', cycles: m.clockHz }).reason, 'the stub ROM starts and halts').toBe('halt');
  m.load.cmd(cmd);
  const start = emuState(m);
  const startMem = memOf(m);
  const cpu = cpuOf(m);
  const boundaries = new Map<number, { pc: number; r: number }>();
  for (let n = 0; cpu.registers.PC !== returned; n++) {
    if (n > 1_000_000) throw new Error(`the program did not return to RETURNED ($${hex(returned, 4)}) in a million instructions`);
    boundaries.set(cpu.cycles, { pc: cpu.registers.PC!, r: cpu.registers.R! });
    m.step();
  }
  return { start, startMem, end: emuState(m), endMem: memOf(m), boundaries };
}

// ---- the port side

/** The runtime's helpers by absolute URL: a data: module resolves only absolute specifiers. */
const RUNTIME = new URL('../../runtime/src/ops.js', import.meta.url).href;

/** The names an assembled program defines on its own lines (not the ROM's), by address. */
function namesOf(r: AsmResult): Map<number, string> {
  const names = new Map<number, string>();
  for (const [name, s] of r.symbols) if (s.line !== 0 && !names.has(s.value)) names.set(s.value, name);
  return names;
}

function ported(r: AsmResult, model: Model, opts: Partial<PortOptions> = {}): PortResult {
  return port(toCmd(r), { model, names: namesOf(r), runtimeImport: RUNTIME, ...opts });
}

function portOk(r: AsmResult, model: Model, opts: Partial<PortOptions> = {}): Extract<PortResult, { ok: true }> {
  const p = ported(r, model, opts);
  if (!p.ok) throw new Error(`the port was refused: ${p.errors.join(' ')}`);
  return p;
}

/** The module text as a module (a data: URL), as a bundle would import it. */
const importPort = async (js: string): Promise<PortModule> =>
  (await import(/* @vite-ignore */ `data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`)) as PortModule;

/** A Z for `model` with emu's registers and 64K at the program's entry. */
function zAtEntry(model: Model, run: EmuRun): Z {
  const z = createZ({ model });
  setZ(z, run.start, run.startMem);
  return z;
}

/**
 * Run the program on emu and the module `js` on the port from the same state at the entry: each block
 * must start where emu starts an instruction at the same T-state with the same R, and at the end every
 * register, F, R, MEMPTR, Q, the interrupt state, the T-states and the 64K must be equal.
 */
async function expectSameAsEmu(r: AsmResult, model: Model, js: string): Promise<void> {
  const emu = onEmu(toCmd(r), model);
  const mod = await importPort(js);
  const z = zAtEntry(model, emu);
  const starts: string[] = [];
  z.at = (addr: number): void => {
    const at = emu.boundaries.get(z.cycles);
    if (at?.pc !== addr || at.r !== z.r) starts.push(`block $${hex(addr, 4)} at T-state ${z.cycles}, R $${hex(z.r, 2)}: emu ${at === undefined ? 'starts no instruction then' : `is at $${hex(at.pc, 4)}, R $${hex(at.r, 2)}`}`);
  };
  expect(runPort(z, mod)).toEqual({ reason: 'returned' });
  expect(starts.slice(0, 3)).toEqual([]);
  expect(zState(z)).toEqual(emu.end);
  expect(firstDifference(model, z.mem, emu.endMem)).toBeNull();
  expect(emu.end.cycles).toBeGreaterThan(emu.start.cycles);
}

// ---- the programs

const program = (body: string): string => `\tORG\t7000H\n${body}\n\tEND\tSTART\n`;

const PROGRAMS: Record<string, string> = {
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
};

/** The addresses of the program's DB lines, and of its instructions, from the assembler's listing. */
function kinds(r: AsmResult): { data: Set<number>; code: Set<number> } {
  const data = new Set<number>();
  const code = new Set<number>();
  for (const l of r.listing) {
    if (l.address === null) continue;
    const into = /^\s*(\w+:?)?\s+DB\b/i.test(l.text) ? data : code;
    l.bytes.forEach((_, k) => into.add(l.address! + k));
  }
  return { data, code };
}

for (const [what, source] of Object.entries(PROGRAMS)) {
  describe(what, () => {
    for (const model of MODELS) {
      const name = `the Model ${model === 3 ? 'III' : 'I'}`;
      const r = assembled(source, model);

      it(`runs to its RET on ${name} as on emu: registers, F, R, MEMPTR, Q, T-states and the 64K equal`, async () => {
        await expectSameAsEmu(r, model, portOk(r, model).js);
      });

      it(`carries none of its code bytes on ${name}: DATA is its DB bytes, and load writes them alone`, async () => {
        const { data, code } = kinds(r);
        const p = portOk(r, model);
        const mod = await importPort(p.js);
        const inData = new Set<number>();
        for (const [addr, bytes] of mod.DATA) bytes.forEach((_, k) => inData.add(addr + k));
        expect([...inData].filter((a) => code.has(a)), 'code addresses in DATA').toEqual([]);
        expect([...inData].sort((x, y) => x - y)).toEqual([...data].sort((x, y) => x - y));
        expect(p.report.data).toEqual(mod.DATA.map(([addr, bytes]) => ({ addr, length: bytes.length })));

        const emu = onEmu(toCmd(r), model);
        const z = createZ({ model });
        load(z, mod);
        for (const a of data) expect(z.mem[a], `$${hex(a, 4)}`).toBe(emu.startMem[a]);
        for (const a of code) expect(z.mem[a], `$${hex(a, 4)} is code`).toBe(0);
      });
    }
  });
}

describe('the module', () => {
  const r = assembled(PROGRAMS['nested CALL and RET three deep']!, 3);

  it('is the same, byte for byte, when ported twice, whatever order the names come in', () => {
    const first = portOk(r, 3).js;
    expect(portOk(r, 3).js).toBe(first);
    const reversed = new Map([...namesOf(r)].reverse());
    expect(portOk(r, 3, { names: reversed }).js).toBe(first);
  });

  it('exports MODEL, DATA, ENTRY and each routine by its name, the entry first in the report', async () => {
    const p = portOk(r, 3);
    const mod = await importPort(p.js);
    expect(mod.MODEL).toBe(3);
    expect(mod.ENTRY).toBe((mod as unknown as Record<string, unknown>)['START']);
    expect(p.report.entry).toBe('START');
    expect(p.report.routines.map((x) => [x.name, x.addr])).toEqual([
      ['START', 0x7000],
      ['ONE', r.symbol('ONE')!.value],
      ['TWO', r.symbol('TWO')!.value],
      ['THREE', r.symbol('THREE')!.value],
    ]);
    for (const x of p.report.routines) expect(typeof (mod as unknown as Record<string, unknown>)[x.name]).toBe('function');
    expect(p.js).toContain(`import * as o from '${RUNTIME}';`);
  });

  it('starts every block with z.at, and a routine with no name of its own takes the disassembler\'s', () => {
    const p = port(toCmd(r), { model: 3, runtimeImport: RUNTIME });
    if (!p.ok) throw new Error(p.errors.join(' '));
    // The entry is nothing's target, so the disassembler has no symbol for it either
    expect(p.report.routines.map((x) => x.name)).toEqual(['START', 'ONE', 'TWO', 'THREE'].map((n) => `SUB_${hex(r.symbol(n)!.value, 4)}`));
    expect(p.js).toMatch(/case 0x7000:.*\n\s+z\.at\(0x7000\);/);
  });

  it('turns a hint file\'s note at a routine into its JSDoc', () => {
    const cmd = toCmd(r);
    const plain = port(cmd, { model: 3, runtimeImport: RUNTIME });
    if (!plain.ok) throw new Error(plain.errors.join(' '));
    const one = r.symbol('ONE')!.value;
    const offset = `block 0:$${hex(one - 0x7000, 4)}`;
    const hints = `${writeHints(skeletonHints(loadCmd(cmd), cmd))}${offset} name DOUBLE\n${offset} note Doubles A and adds one, twice over.\n`;
    const p = port(cmd, { model: 3, runtimeImport: RUNTIME, hints });
    if (!p.ok) throw new Error(p.errors.join(' '));
    expect(p.js).toMatch(/\/\*\*[^/]*Doubles A and adds one, twice over\.[^/]*\*\/\nexport function DOUBLE\(z, ret\)/);
  });
});

describe("names, notes and comments, whatever they hold, change nothing the module does", () => {
  const nested = assembled(PROGRAMS['nested CALL and RET three deep']!, 3);
  const at = (n: string): number => nested.symbol(n)!.value;
  /** Every JavaScript line terminator but the module's own LF, and the other control characters. */
  const BREAKS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/;
  const PWN = 'throw new Error("pwn");';
  /** A line of the module that carries `PWN` outside a comment: before any `//`, and not a JSDoc line. */
  const live = (js: string): string[] => js.split('\n').filter((l) => l.includes(PWN) && !/^\s*\*/.test(l) && !l.slice(0, l.indexOf(PWN)).includes('//'));

  it('ends no comment early at U+2028, U+2029, CR or a control character in a name, a hint note or comment, or the source, nor at */', async () => {
    const cmd = toCmd(nested);
    const names = namesOf(nested);
    // A block's name (a // comment), a routine's (its identifier and JSDoc), and the operand text of the CALLs to it
    names.set(at('ONE') + 4, `AFTER\u2028${PWN}//`);
    names.set(at('TWO'), `TWO\u2029${PWN}*/ ${PWN}`);
    names.set(at('THREE'), `THREE\r${PWN}\u0007`);
    const offset = (a: number): string => `block 0:$${hex(a - 0x7000, 4)}`;
    const hints = `${writeHints(skeletonHints(loadCmd(cmd), cmd))}` +
      `${offset(at('ONE'))} note One\u2028${PWN} */ ${PWN}\n` +
      `${offset(at('ONE') + 1)} note Inside\u2029${PWN}\n` +
      `${offset(at('ONE') + 1)} comment Said\u2028${PWN}\n`;
    const p = port(cmd, { model: 3, names, hints, runtimeImport: RUNTIME, source: `x.cmd */\u2028${PWN}` });
    if (!p.ok) throw new Error(p.errors.join(' '));
    expect(p.js.match(/pwn/g)?.length ?? 0, 'every injected text is in the module, in a comment').toBeGreaterThanOrEqual(8);
    expect(p.js).not.toMatch(BREAKS);
    expect(live(p.js)).toEqual([]);
    // Each */ is written so it cannot close a JSDoc block
    for (const block of p.js.match(/\/\*\*[\s\S]*?\*\//g) ?? []) expect(block.slice(3, -2)).not.toContain('*/');
    await expectSameAsEmu(nested, 3, p.js);
  });

  it("writes the runtime's import path as a string literal that nothing ends early", async () => {
    const p = portOk(nested, 3, { runtimeImport: `${RUNTIME}?x='\u2028\\` });
    expect(p.js).not.toMatch(BREAKS);
    const imported = /^import \* as o from (.*);$/m.exec(p.js)![1]!;
    expect(JSON.parse(`"${imported.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`)).toBe(`${RUNTIME}?x='\u2028\\`);
  });

  it('never names a routine after a global or binding the module uses: a routine called Uint8Array', async () => {
    const r = assembled(program(`
START:  CALL    READ
        RET
READ:   LD      HL,TABLE
        LD      A,(HL)
        LD      (5000H),A
        RET
TABLE:  DB      7`), 3);
    for (const taken of ['Uint8Array', 'MODEL', 'DATA', 'ENTRY', 'o', 'z', 'ret', 'b']) {
      const names = namesOf(r);
      names.set(r.symbol('READ')!.value, taken);
      const p = portOk(r, 3, { names });
      expect(p.report.routines.map((x) => x.name)).toEqual(['START', `${taken}_`]);
      const mod = await importPort(p.js);
      expect(mod.DATA[0]![1]).toBeInstanceOf(Uint8Array);
      await expectSameAsEmu(r, 3, p.js);
    }
  });

  it('gives each routine its own name when names collide, even after a suffix, and SUB_XXXX for an empty one', async () => {
    const names = namesOf(nested);
    // THREE's X takes the suffix X_<THREE>, which TWO's name already is
    names.set(at('ONE'), 'X');
    names.set(at('TWO'), `X_${hex(at('THREE'), 4)}`);
    names.set(at('THREE'), 'X');
    const p = portOk(nested, 3, { names });
    const got = p.report.routines.map((x) => x.name);
    expect(new Set(got).size).toBe(4);
    expect(got).toEqual(['START', 'X', `X_${hex(at('THREE'), 4)}`, `X_${hex(at('THREE'), 4)}_2`]);
    await expectSameAsEmu(nested, 3, p.js);

    const empty = namesOf(nested);
    empty.set(at('ONE'), '');
    const q = portOk(nested, 3, { names: empty });
    expect(q.report.routines.map((x) => x.name)[1]).toBe(`SUB_${hex(at('ONE'), 4)}`);
    await expectSameAsEmu(nested, 3, q.js);
  });
});

describe('what the port cannot follow', () => {
  it('refuses a JP (HL) with a sentence naming its address', () => {
    const r = assembled(program(`
START:  LD      HL,THERE
        JP      (HL)
THERE:  RET`), 3);
    const p = ported(r, 3);
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.errors).toEqual([expect.stringMatching(/^\$7003: JP \(HL\) jumps to an address computed as it runs/)]);
  });

  it("throws o.unknown's sentence at a transfer to an address no block starts, naming it, its source, the routine and the block", async () => {
    const r = assembled(program(`
START:  LD      A,1
        CALL    0060H           ; a ROM routine: the port has no ROM
        RET`), 3);
    const p = portOk(r, 3);
    expect(p.report.refused).toEqual([expect.stringContaining('$0060')]);
    const z = createZ({ model: 3 });
    z.sp = 0xfffe;
    z.write16(0xfffe, 0x0016);
    const mod = await importPort(p.js);
    expect(() => runPort(z, mod)).toThrow(
      /^the transfer at \$7002 goes to \$0060, where no block of the port starts .*\(in START, in the block at \$7000\)$/,
    );
  });

  it('throws a sentence when a RET pops an address other than the one after its CALL', async () => {
    const r = assembled(program(`
START:  LD      HL,LATER
        PUSH    HL
        RET
LATER:  RET`), 3);
    const p = portOk(r, 3);
    const z = createZ({ model: 3 });
    z.sp = 0xfffe;
    z.write16(0xfffe, 0x0016);
    const mod = await importPort(p.js);
    expect(() => runPort(z, mod)).toThrow(/^the RET at \$7004 returns to \$7005, not to \$0016/);
  });

  it("adds the routine and the block to the runtime's refusal of a device it does not model", async () => {
    const r = assembled(program(`
START:  LD      A,1
        CALL    READ
        RET
READ:   LD      B,A
        IN      A,(0FEH)
        RET`), 3);
    const p = portOk(r, 3);
    const z = createZ({ model: 3 });
    z.sp = 0xfffe;
    z.write16(0xfffe, 0x0016);
    const read = hex(r.symbol('READ')!.value, 4);
    const mod = await importPort(p.js);
    expect(() => runPort(z, mod)).toThrow(
      new RegExp(`^the port does not model \\$FE \\(an I/O port.*\\) \\(in READ, in the block at \\$${read}\\)$`),
    );
  });

  it('grows no JavaScript stack as routines jump into each other', async () => {
    const r = assembled(PROGRAMS['a JP from one routine into another, a thousand times round']!, 3);
    const emu = onEmu(toCmd(r), 3);
    const mod = await importPort(portOk(r, 3).js);
    const z = zAtEntry(3, emu);
    const ping = r.symbol('PING')!.value;
    const depths: number[] = [];
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
    try {
      z.at = (addr: number): void => {
        if (addr === ping) depths.push((new Error().stack ?? '').split('\n').length);
      };
      runPort(z, mod);
    } finally {
      Error.stackTraceLimit = limit;
    }
    expect(depths.length, 'PING runs 1,001 times from START\'s first CALL and twice from its second').toBe(1003);
    expect(new Set(depths).size, 'the stack is as deep at the last PING as at the first').toBe(1);
  });
});
