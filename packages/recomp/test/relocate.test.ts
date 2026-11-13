/**
 * @fugloy/recomp, M2 Task 1: a program its hint file relocates. The file loads the program at one
 * address and a small mover (the loader) copies it to where it runs; with a hint file's `relocate` and
 * `entry` lines the disassembler analyses it at its run addresses. port() starts the port at the hinted
 * entry inside the relocated range, carries the non-code bytes at their run addresses, and does not
 * translate the loader; the referee starts comparing the first time emu reaches that entry.
 */
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { toCmd } from '@fugloy/asm';
import { loadCmd, skeletonHints, writeHints } from '@fugloy/disasm';
import { describe, expect, it } from 'vitest';
import { port } from '../src/index.js';
import type { PortResult } from '../src/index.js';
import { RUNTIME, assembled, hex, importPort } from './helpers.js';
import { referee } from './referee.js';

const ok = (p: PortResult): Extract<PortResult, { ok: true }> => {
  if (!p.ok) throw new Error(`the port was refused: ${p.errors.join(' ')}`);
  return p;
};

// ---- a synthetic program: a body that runs at $6000, loaded at $7000 behind a mover

const RUN = 0x6000;
const FILE = 0x7000;

/** Fills the top row of the screen from a 64-byte table and returns (to the stub's RETURNED). */
const body = assembled(`\tORG\t${hex(RUN, 4)}H
START:  LD      HL,TABLE
        LD      DE,3C00H
        LD      B,64
FILL:   LD      A,(HL)
        LD      (DE),A
        INC     HL
        INC     DE
        DJNZ    FILL
        RET
TABLE:  DB      'FUGLOY RELOCATED: A BODY THAT RUNS AT 6000H, LOADED AT 7000H. OK'
\tEND\tSTART
`, 3);
const bodyBytes = body.image!.bytes.slice(RUN, RUN + body.image!.runs()[0]!.length);
const TABLE = body.symbol('TABLE')!.value;
const LEN = bodyBytes.length;

/** The body's bytes at $7000, then the mover, which the file's transfer address names. */
const file = assembled(`\tORG\t${hex(FILE, 4)}H
        DB      ${[...bodyBytes].map((b) => `0${hex(b, 2)}H`).join(',')}
MOVER:  LD      HL,${hex(FILE, 4)}H
        LD      DE,${hex(RUN, 4)}H
        LD      BC,${hex(LEN, 4)}H
        LDIR
        JP      ${hex(RUN, 4)}H
\tEND\tMOVER
`, 3);
const cmd = toCmd(file);
const MOVER = file.symbol('MOVER')!.value;
const hints = `${writeHints(skeletonHints(loadCmd(cmd), cmd))}block 0:$0000 relocate $${hex(RUN, 4)} $${hex(LEN, 4)}\nblock 0:$0000 entry\n`;

describe('a program its hint file relocates', () => {
  it('ports from the hinted entry, its data at its run addresses, the loader not translated, and passes the referee', async () => {
    const p = ok(port(cmd, { model: 3, hints, runtimeImport: RUNTIME }));
    expect(p.report.entryAddr).toBe(RUN);
    expect(p.report.loader?.addr).toBe(MOVER);
    expect(p.report.loader?.length).toBe(file.image!.runs()[0]!.start + file.image!.runs()[0]!.length - MOVER);
    expect(p.report.routines.map((r) => r.addr)).toEqual([RUN]);

    // DATA: the table, at its run address, with its bytes; nothing in the file range
    const mod = await importPort(p.js);
    for (const [at, bytes] of mod.DATA) {
      expect(at + bytes.length <= FILE || at >= FILE + LEN, `DATA at $${hex(at, 4)} lies in the file range`).toBe(true);
    }
    expect(p.report.data.map((d) => d.addr)).toEqual([TABLE]);
    expect(Buffer.from(mod.DATA[0]![1]).equals(Buffer.from(bodyBytes.slice(TABLE - RUN)))).toBe(true);

    // None of the body's code bytes, nor the mover's, anywhere in DATA
    const code = Buffer.from(bodyBytes.slice(0, TABLE - RUN));
    for (const [, bytes] of mod.DATA) expect(Buffer.from(bytes).includes(code)).toBe(false);
    expect(mod.DATA.some(([at]) => at === MOVER)).toBe(false);

    const res = await referee({ cmd, model: 3, hints, steps: [{ run: 100_000 }] });
    if (!res.ok) throw new Error(`the referee stopped: ${res.report}`);
    expect(res.blocks).toBeGreaterThan(64);
  });

  it('is refused, with a sentence, when the hint file names no entry in the relocated range, or two', () => {
    const relocateOnly = hints.replace('block 0:$0000 entry\n', '');
    const none = port(cmd, { model: 3, hints: relocateOnly, runtimeImport: RUNTIME });
    expect(none).toEqual({ ok: false, errors: [expect.stringMatching(/^the hint file relocates part of the program to \$6000-\$[0-9A-F]{4} but names no entry there/)] });
    const two = port(cmd, { model: 3, hints: `${hints}block 0:$0003 entry\n`, runtimeImport: RUNTIME });
    expect(two).toEqual({ ok: false, errors: [expect.stringMatching(/^the hint file names 2 entries inside the relocated range \(\$6000, \$6003\)/)] });
  });
});

// ---- Sea Dragon

const seaDragon = readFileSync(new URL('../../../examples/sea-dragon/seadrg01.cmd', import.meta.url));
const seaDragonHints = readFileSync(new URL('../../../examples/sea-dragon/seadrg01.hints', import.meta.url), 'utf8');

describe('Sea Dragon (seadrg01.cmd)', () => {
  it('ports with its hint file from $497F: 27 routines, none labelled, refusing the six CALL 0060H', () => {
    const p = ok(port(seaDragon, { model: 3, hints: seaDragonHints, runtimeImport: RUNTIME, source: 'seadrg01.cmd' }));
    expect(p.report.entryAddr).toBe(0x497f);
    expect(p.report.loader).toEqual({ addr: 0x8881, length: 15, note: expect.any(String) });
    expect(p.report.routines).toHaveLength(27);
    expect(p.report.routines.filter((r) => r.labelled)).toEqual([]);
    expect(p.report.refused).toHaveLength(6);
    expect(ok(port(seaDragon, { model: 3, hints: seaDragonHints, runtimeImport: RUNTIME, source: 'seadrg01.cmd' })).js, 'the same module twice').toBe(p.js);
    const sites = [0x4eac, 0x4ebc, 0x4ec6, 0x5512, 0x5f71, 0x6022].map((a) => `$${hex(a, 4)}: CALL 0060H`);
    // In the order the routines are written, not by address
    expect(p.report.refused.filter((s) => s.includes('0060')).map((s) => s.slice(0, sites[0]!.length)).sort()).toEqual(sites);
    // No DATA entry in what the loader leaves behind ($8000-$8880), nor at the loader
    for (const d of p.report.data) expect(d.addr + d.length <= 0x8000, `DATA at $${hex(d.addr, 4)}`).toBe(true);
  });

  it('with no hint file, reports its 15 data regions all as unknown (the analysis reaches only the loader)', () => {
    const p = ok(port(seaDragon, { model: 3, runtimeImport: RUNTIME }));
    expect(p.report.data).toHaveLength(15);
    expect(p.report.data.every((d) => d.kind === 'unknown')).toBe(true);
  });
});
