import { describe, expect, it } from 'vitest';
import { loadBas } from '../../src/bas.js';
import { mineEntries } from '../../src/basic/entries.js';
import { writeBasic } from '../writers/basic-tokenizer.js';
import type { BasicLineSpec } from '../writers/basic-tokenizer.js';

/** Voyage of the Valkyrie's line 250, verbatim. */
const LINE_250 = 'CLS:Q0=PEEK(16549)*256+PEEK(16548)+14:Q1=INT(Q0/256):Q0=Q0-Q1*256:POKE16422,Q0:POKE16423,Q1:POKE16421,195';
const mine = (lines: BasicLineSpec[], base = 0x7000) => mineEntries(loadBas(writeBasic(lines, base)));
const one = (text: string, base = 0x7000) => mine([{ number: 10, text }], base);

describe('mineEntries', () => {
  it('reads DEFUSR with a constant address', () => {
    expect(one('DEFUSR=24576')).toEqual([{ addr: 0x6000, evidence: 'line 10: DEFUSR0 = $6000', line: 10 }]);
    expect(one('DEFUSR3=&H7000')).toEqual([{ addr: 0x7000, evidence: 'line 10: DEFUSR3 = $7000', line: 10 }]);
  });

  it('reads the USR vector poked at 16526 and 16527', () => {
    expect(one('POKE 16526,0:POKE 16527,96')).toEqual([{ addr: 0x6000, evidence: 'line 10: POKE 16526/16527 (the USR vector) = $6000', line: 10 }]);
  });

  it('reads a JP planted by POKE a,195 with its address at a+1 and a+2, in either order', () => {
    const entry = { addr: 0x6000, evidence: 'line 10: POKE 30000,195 with address $6000', line: 10 };
    expect(one('POKE 30000,195:POKE 30001,0:POKE 30002,96')).toEqual([entry]);
    expect(one('POKE 30001,0:POKE 30002,96:POKE 30000,195')).toEqual([entry]);
  });

  it('follows Valkyrie line 250 through Q0, Q1, INT and subtraction to program start + 14 (Review Focus 2)', () => {
    const lines: BasicLineSpec[] = [{ number: 1, text: 'GOTO250' }, { number: 2, raw: [0x3e, 0x41, 0xc9] }, { number: 250, text: LINE_250 }];
    const evidence = 'line 250: POKE 16421,195 with address program start + 14';
    expect(mine(lines, 0x62c8)).toEqual([{ addr: 0x62d6, evidence, line: 250 }]);
    expect(mine(lines, 0x7000)).toEqual([{ addr: 0x700e, evidence, line: 250 }]);
  });

  it('tracks variables in file order by their two significant characters, and folds both byte idioms', () => {
    expect(mine([{ number: 10, text: 'ADDR=24576' }, { number: 20, text: 'DEFUSR=AD' }])).toEqual([{ addr: 0x6000, evidence: 'line 20: DEFUSR0 = $6000', line: 20 }]);
    expect(one('X=PEEK(16548)+256*PEEK(16549):POKE 16526,X-INT(X/256)*256:POKE 16527,INT(X/256)')).toEqual([
      { addr: 0x7000, evidence: 'line 10: POKE 16526/16527 (the USR vector) = program start', line: 10 },
    ]);
    expect(one('DEFUSR1=PEEK(16548)+256*PEEK(16549)+100')).toEqual([{ addr: 0x7064, evidence: 'line 10: DEFUSR1 = program start + 100', line: 10 }]);
  });

  it('reports an idiom it cannot resolve as a note with no address', () => {
    expect(one('POKE 16421,195')).toEqual([{ addr: null, evidence: 'line 10: POKE 16421,195 with an address the miner cannot resolve', line: 10 }]);
    expect(one('DEFUSR=RND(0)')).toEqual([{ addr: null, evidence: 'line 10: DEFUSR0 with a value the miner cannot resolve', line: 10 }]);
    expect(one('POKE 16526,A')).toEqual([{ addr: null, evidence: 'line 10: POKE 16526/16527 (the USR vector) with a value the miner cannot resolve', line: 10 }]);
  });

  it('ignores code lines and pokes that plant nothing', () => {
    expect(mine([{ number: 10, text: 'POKE 15360,65:X=PEEK(14400)' }, { number: 20, raw: [0xcd, 0x8e, 0x40] }])).toEqual([]);
  });

  it('mines the statements the loader parsed, without parsing each line again', () => {
    const prog = loadBas(writeBasic([{ number: 10, text: 'DEFUSR=24576' }], 0x6a00));
    expect(prog.lines[0]!.statements).toEqual([{ kind: 'defusr', n: 0, expr: { kind: 'num', value: 24576 } }]);
    const body = prog.lines[0]!.body;
    body.fill(0x20, 0, body.length - 1); // the bytes no longer say DEFUSR; the parsed statements still do
    expect(mineEntries(prog).map((e) => e.addr)).toEqual([24576]);
  });
});
