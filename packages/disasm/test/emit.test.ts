import { describe, expect, it } from 'vitest';
import { decodeAt } from '@fugloy/z80';
import { recursiveDescent } from '../src/analysis/descent.js';
import { loadBas } from '../src/bas.js';
import { emitZmac, instructionLine } from '../src/emit/zmac.js';
import { analyze } from '../src/pipeline.js';
import { loadRaw } from '../src/raw.js';
import { BAS_FIXTURES } from './fixtures.js';
import { image } from './images.js';

describe('emitZmac', () => {
  it('writes one ORG per run, instructions, DB rows, and END with the entry', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9], 0x7000: [0, 1, 2, 3, 4, 5, 6, 7, 8] });
    const text = emitZmac(img, recursiveDescent(img, [0x6000]), 0x6000, { source: 'x.cmd' });
    expect(text).toBe([
      '; x.cmd: Fugløy pass 1, 2 runs, 15 bytes, entry 6000H',
      '\tORG\t6000H',
      '\tLD\tHL,3C00H',
      '\tLD\t(HL),41H',
      '\tRET',
      '\tORG\t7000H',
      '\tDB\t00H,01H,02H,03H,04H,05H,06H,07H',
      '\tDB\t08H',
      '\tEND\t6000H',
      '',
    ].join('\n'));
  });

  it('ends a DB row before an instruction start even mid-row, and emits a bare END without an entry', () => {
    const img = image({ 0x7000: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0xc9] });
    const text = emitZmac(img, recursiveDescent(img, [0x7009]), null);
    expect(text).toContain('\tDB\t01H,02H,03H,04H,05H,06H,07H,08H\n\tDB\t09H\n\tRET\n');
    expect(text.trimEnd().endsWith('\tEND')).toBe(true);
    expect(text.split('\n')[0]).toBe('; Fugløy pass 1, 1 run, 10 bytes, no entry');
  });

  it('emits data bytes typed by RST 08H as DB on their own row', () => {
    const img = image({ 0x6000: [0xcf, 0x2c, 0xc9] });
    expect(emitZmac(img, recursiveDescent(img, [0x6000]), 0x6000)).toContain('\tRST\t08H\n\tDB\t2CH\n\tRET\n');
  });

  it('renders byte-exact exceptions and undocumented DB forms as DB, instructions in zmac spelling', () => {
    expect(instructionLine(decodeAt([0xed, 0x63, 0x00, 0x40], 0))).toBe('\tDB\t0EDH,63H,00H,40H');
    expect(instructionLine(decodeAt([0xed, 0x6b, 0x00, 0x40], 0))).toBe('\tDB\t0EDH,6BH,00H,40H');
    expect(instructionLine(decodeAt([0xdd, 0x00], 0))).toBe('\tDB\t0DDH');
    expect(instructionLine(decodeAt([0xed, 0x70], 0))).toBe('\tDB\t0EDH,70H');
    expect(instructionLine(decodeAt([0xdd, 0xcb, 0x05, 0x00], 0))).toBe('\tDB\t0DDH,0CBH,05H,00H');
    expect(instructionLine(decodeAt([0x22, 0x00, 0x40], 0))).toBe('\tLD\t(4000H),HL');
    expect(instructionLine(decodeAt([0xcb, 0x30], 0))).toBe('\tSLL\tB');
    expect(instructionLine(decodeAt([0xdd, 0x7c], 0))).toBe('\tLD\tA,IXH');
    expect(instructionLine(decodeAt([0x00], 0))).toBe('\tNOP');
    expect(instructionLine(decodeAt([0x18, 0x10], 0, 0x6000))).toBe('\tJR\t6012H');
  });

  it('covers every loaded byte exactly once when two roots overlap', () => {
    const img = image({ 0x6000: [0x00, 0x00, 0x06, 0xc9, 0xc9] });
    const text = emitZmac(img, recursiveDescent(img, [0x6003, 0x6002]), 0x6003);
    // 6003 RET is reached; 6002 is diagnosed as an overlap; 6004 is never reached, so it stays data.
    expect(text).toContain('\tDB\t00H,00H,06H\n\tRET\n\tDB\t0C9H\n');
  });

  it('can annotate each instruction with its address', () => {
    const img = image({ 0x6000: [0xc9] });
    expect(emitZmac(img, recursiveDescent(img, [0x6000]), 0x6000, { addresses: true })).toContain('\tRET\t; 6000H\n');
  });

  it('is deterministic', () => {
    const img = image({ 0x6000: [0x21, 0x00, 0x3c, 0xc9] });
    const p = recursiveDescent(img, [0x6000]);
    expect(emitZmac(img, p, 0x6000)).toBe(emitZmac(img, p, 0x6000));
  });
});

describe('emitZmac on a .BAS program', () => {
  const emit = (name: string) => {
    const prog = loadBas(BAS_FIXTURES[name]!());
    const a = analyze(prog);
    return emitZmac(prog.image, a.pass1, a.transfer, { source: name, symbols: a.symbols, annotations: a.annotations });
  };

  it('emits each line as its DW header, its body, and its 00, with BASIC text and code lines named in comments', () => {
    expect(emit('hidden-code')).toBe([
      '; hidden-code: Fugløy pass 1, 1 run, 28 bytes, no entry',
      '\tORG\t7000H',
      '\tDW\t7009H,000AH',
      '\tDB\t8DH,20H,33H,30H\t; 10 GOTO 30',
      '\tDB\t00H',
      '\tDW\t7014H,0014H\t; line 20: machine code, 6 bytes at $700D',
      '\tJP\t0000H',
      '\tDB\t0C9H,00H,3EH',
      '\tDB\t00H',
      '\tDW\t701AH,001EH',
      '\tDB\t80H\t; 30 END',
      '\tDB\t00H',
      '\tDW\t0000H',
      '\tEND',
      '',
    ].join('\n'));
  });

  it('puts a long BASIC line\'s text on the first DB row of its body', () => {
    expect(emit('prog-62c8')).toContain('\tORG\t62C8H\n\tDW\t62E8H,000AH\n\tDB\t84H,3AH,0B2H,22H,56H,4FH,59H,41H\t; 10 CLS:PRINT"VOYAGE OF THE VALKYRIE"\n');
  });
});

describe('emitZmac with strings', () => {
  it('emits a typed string as a quoted DB row under its label', () => {
    const text = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
    const mod = loadRaw(Uint8Array.from([0x21, 0x04, 0x70, 0xc9, ...text("IT'S HI"), 0x0d]), 0x7000);
    const a = analyze(mod);
    expect(emitZmac(mod.image, a.pass1, a.transfer, { symbols: a.symbols, annotations: a.annotations })).toContain("\tRET\nDATA_7004:\n\tDB\t'IT''S HI',0DH\n");
  });
});
