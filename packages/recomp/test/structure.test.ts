/**
 * @fugloy/recomp, M1 Task 6: structured control flow. A routine whose blocks form a straight run, if/else
 * diamonds and single-entry loops is written with `if`, `while (true)` and `break`/`continue`; any other
 * routine stays the labelled cases of `for (;;) switch (b)`, and the report says which. Behaviour is the
 * referee's to judge: each program here runs beside emu, compared at every block start, on both models.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { toCmd } from '@fugloy/asm';
import type { AsmResult } from '@fugloy/asm';
import { describe, expect, it } from 'vitest';
import { port, structure } from '../src/index.js';
import type { PortResult } from '../src/index.js';
import { PROGRAMS, RUNTIME, assembled, namesOf } from './helpers.js';
import type { Model } from './helpers.js';
import { referee } from './referee.js';

const MODELS: readonly Model[] = [3, 1];

function portOk(r: AsmResult, model: Model): Extract<PortResult, { ok: true }> {
  const p = port(toCmd(r), { model, names: namesOf(r), runtimeImport: RUNTIME });
  if (!p.ok) throw new Error(`the port was refused: ${p.errors.join(' ')}`);
  return p;
}

/** Each routine's function in the module text, by its name. */
function functionsOf(js: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = js.split(/^(?=export function )/m).slice(1);
  for (const part of parts) out.set(/^export function ([A-Za-z0-9_$]+)\(/.exec(part)![1]!, part.slice(0, part.search(/^}$/m) + 1));
  return out;
}

async function refereed(r: AsmResult, model: Model): Promise<void> {
  const res = await referee({ cmd: toCmd(r), model, names: namesOf(r), steps: [{ run: 1_000_000 }] });
  if (!res.ok) expect.fail(res.report);
  expect(res.blocks).toBeGreaterThan(0);
}

const STRUCTURED = [
  'a straight line of loads and arithmetic',
  'a DJNZ count',
  'an if/else diamond, both arms taken in turn',
  'a loop inside a loop, left from the inner one',
];

describe('a routine the control flow allows is written as loops and conditionals', () => {
  for (const what of STRUCTURED) {
    for (const model of MODELS) {
      it(`${what}: no switch, every routine structured, and it runs as emu runs it on the Model ${model === 3 ? 'III' : 'I'}`, async () => {
        const r = assembled(PROGRAMS[what]!, model);
        const p = portOk(r, model);
        expect(p.js).not.toContain('switch');
        expect(p.report.routines.map((x) => [x.name, x.labelled])).toEqual(p.report.routines.map((x) => [x.name, false]));
        await refereed(r, model);
      });
    }
  }

  it('every other program of Task 3 is structured too', () => {
    for (const [what, source] of Object.entries(PROGRAMS)) {
      if (what.includes('irreducible')) continue;
      const p = portOk(assembled(source, 3), 3);
      expect(p.js, what).not.toContain('switch');
      expect(p.report.routines.filter((x) => x.labelled), what).toEqual([]);
    }
  });

  it('a DJNZ loop reads as a loop: while (true), the block at its head, continue when DJNZ goes round, break when it does not', () => {
    const r = assembled(PROGRAMS['a DJNZ count']!, 3);
    const loop = r.symbol('LOOP')!.value.toString(16).toUpperCase();
    const js = portOk(r, 3).js;
    expect(js).toMatch(new RegExp(`\\n  while \\(true\\) \\{\\n    z\\.at\\(0x${loop}\\); // LOOP\\n`));
    expect(js).toMatch(/\n {4}z\.b = \(z\.b - 1\) & 0xff; +\/\/ \$[0-9A-F]{4} {2}DJNZ LOOP\n {4}if \(z\.b !== 0\) \{\n {6}z\.wz = 0x[0-9A-F]{4};\n {6}z\.tick\(\d+, 3\); z\.q = 0;\n {6}continue;\n {4}\}\n {4}z\.tick\(\d+, 3\); z\.q = 0;\n {4}break;\n {2}\}\n/);
  });

  it('an if/else diamond reads as if and else, with no label', () => {
    const js = portOk(assembled(PROGRAMS['an if/else diamond, both arms taken in turn']!, 3), 3).js;
    expect(js).toMatch(/\n {4}if \(.+\) \{ +\/\/ \$[0-9A-F]{4} {2}JR C,SMALL\n[^]*\n {4}\} else \{\n/);
    expect(js).not.toMatch(/^\s*[A-Za-z_$][\w$]*: /m);
  });

  it('a loop inside a loop is left from the inner one by a labelled break of the outer', () => {
    const r = assembled(PROGRAMS['a loop inside a loop, left from the inner one']!, 3);
    const js = portOk(r, 3).js;
    const outer = r.symbol('OUTER')!.value.toString(16).toUpperCase();
    expect(js).toContain(`loop_${outer}: while (true) {`);
    expect(js).toContain(`break loop_${outer};`);
    // DONE comes after both loops, at the routine's own level
    expect(js).toMatch(new RegExp(`\\n  \\}\\n  z\\.at\\(0x${r.symbol('DONE')!.value.toString(16).toUpperCase()}\\); // DONE\\n`));
  });
});

describe('a routine the control flow does not allow stays labelled, and its report says so', () => {
  const what = 'a loop entered in its middle (irreducible)';
  for (const model of MODELS) {
    it(`a jump into a loop below its head: a switch over its blocks, labelled in the report, and it runs as emu runs it on the Model ${model === 3 ? 'III' : 'I'}`, async () => {
      const r = assembled(PROGRAMS[what]!, model);
      const p = portOk(r, model);
      expect(p.report.routines.map((x) => [x.name, x.labelled])).toEqual([['START', true]]);
      expect(p.js).toContain('  let b = 0x7000;\n  for (;;) switch (b) {\n    case 0x7000: // START\n');
      await refereed(r, model);
    });
  }

  it('structure() says why: the jump that enters the loop other than at its head', () => {
    // START → SECOND and FIRST; FIRST → SECOND; SECOND → FIRST and TAIL
    const s = structure({
      start: 0x7000,
      succ: new Map([
        [0x7000, [0x7008, 0x7007]],
        [0x7007, [0x7008]],
        [0x7008, [0x7007, 0x700b]],
        [0x700b, []],
      ]),
    });
    expect(s).toEqual({ ok: false, why: expect.stringMatching(/^the jump from \$700[78] to \$700[78] enters a loop other than at its head/) });
  });

  it('the block after a CALL that throws is left out (no transfer reaches it), with a comment saying so', () => {
    const r = assembled(`\tORG\t7000H\nSTART:\tLD\tA,1\n\tCALL\t0060H\n\tRET\n\tEND\tSTART\n`, 3);
    const p = portOk(r, 3);
    expect(p.report.routines).toEqual([{ name: 'START', addr: 0x7000, blocks: 2, labelled: false }]);
    expect(p.js).toContain('  throw o.unknown(z, 0x0060, 0x7002);\n  // $7005: no transfer reaches the block here, so it is not written.\n}\n');
    expect(p.js).not.toContain('z.at(0x7005)');
    expect(p.report.refused).toEqual([expect.stringContaining('$0060')]);
  });

  it("structure() leaves out a block nothing transfers to, and says it did", () => {
    const s = structure({ start: 0x7000, succ: new Map([[0x7000, []], [0x7003, []]]) });
    expect(s.ok).toBe(true);
    if (s.ok) expect(s.unreachable).toEqual([0x7003]);
  });
});

describe('the Learn ports', () => {
  const learn = new URL('../../../apps/web/content/learn/', import.meta.url);
  const lesson1 = readdirSync(learn).find((d) => d.startsWith('01-'))!;

  for (const model of MODELS) {
    it(`lesson 1's port on the Model ${model === 3 ? 'III' : 'I'} has no switch, and its loop reads as a loop`, () => {
      const r = assembled(readFileSync(new URL(`${lesson1}/program.z`, learn), 'utf8'), model);
      const p = port(toCmd(r), { model, names: namesOf(r), runtimeImport: RUNTIME });
      if (!p.ok) throw new Error(p.errors.join(' '));
      expect(p.js).not.toContain('switch');
      expect(p.report.routines.every((x) => !x.labelled)).toBe(true);
      const fill = r.symbol('FILL')!.value.toString(16).toUpperCase();
      const wait = r.symbol('WAIT')!.value.toString(16).toUpperCase();
      // FILL: a while (true) whose JR NZ goes round with continue and leaves with break, then WAIT's loop
      expect(p.js).toMatch(new RegExp(
        `\\n  while \\(true\\) \\{\\n    z\\.at\\(0x${fill}\\); // FILL\\n[^]*?` +
        `\\n    if \\(\\(z\\.f & 0x40\\) === 0\\) \\{ +// \\$[0-9A-F]{4}  JR NZ,FILL\\n[^]*?\\n      continue;\\n    \\}\\n` +
        `    z\\.tick\\(\\d+, \\d+\\); z\\.q = 0;\\n    break;\\n  \\}\\n` +
        `  while \\(true\\) \\{\\n    z\\.at\\(0x${wait}\\); // WAIT\\n`,
      ));
      // The same module, byte for byte, ported again
      expect(port(toCmd(r), { model, names: namesOf(r), runtimeImport: RUNTIME })).toEqual(p);
    });
  }

  it("say truthfully which routines are labelled: labelled exactly when the routine's text has a switch on its blocks (`switch (b)`)", () => {
    const folders = [
      ...readdirSync(learn).filter((d) => /^\d\d-/.test(d)),
      ...readdirSync(new URL('invaders/', learn)).filter((d) => /^\d\d-/.test(d)).map((d) => `invaders/${d}`),
    ];
    expect(folders).toHaveLength(19);
    for (const folder of folders) {
      const r = assembled(readFileSync(new URL(`${folder}/program.z`, learn), 'utf8'), 3);
      const p = port(toCmd(r), { model: 3, names: namesOf(r), runtimeImport: RUNTIME });
      if (!p.ok) throw new Error(`${folder}: ${p.errors.join(' ')}`);
      const fns = functionsOf(p.js);
      for (const x of p.report.routines) expect(x.labelled, `${folder} ${x.name}`).toBe(fns.get(x.name)!.includes('switch (b)'));
    }
  });
});
