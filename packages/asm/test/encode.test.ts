import { describe, expect, it } from 'vitest';
import { decodeAt, TABLES } from '@fugloy/z80';
import type { Template, TemplateOperand } from '@fugloy/z80';
import { buildIndex } from '../src/encode.js';
import { encode, forms, lengthOf } from '../src/index.js';
import type { Operand, Shape } from '../src/index.js';

type TableName = keyof typeof TABLES;

interface Slot {
  table: TableName;
  opcode: number;
  tpl: Template;
}

/** Every real encoding in the seven tables: no prefix slots, no DB fallbacks. */
const SLOTS: Slot[] = (Object.keys(TABLES) as TableName[]).flatMap((table) =>
  TABLES[table].flatMap((tpl, opcode) => (tpl.prefix === undefined && tpl.mnemonic !== 'DB' ? [{ table, opcode, tpl }] : [])),
);

const PC = 0x6000;

/** The ED duplicates of LD (nn),HL and LD HL,(nn), which zmac assembles as base 22 and 2A. */
const ZMAC_BASE: ReadonlySet<string> = new Set(['ed:63', 'ed:6b']);

/** The shape the parser would give a template operand, with a representative value. */
function operandFor(o: TemplateOperand, tpl: Template, variant: number): Operand {
  switch (o.t) {
    case 'fixed': {
      const op = o.op;
      switch (op.kind) {
        case 'reg':
        case 'reg16':
          return { shape: op.reg };
        case 'cc':
          return { shape: op.cond };
        case 'ind':
          return { shape: `(${op.reg})` as Shape };
        case 'bit':
          return { shape: 'num', value: op.bit };
        case 'rst':
          return { shape: 'num', value: op.addr };
        case 'im':
          return { shape: 'num', value: op.mode };
        default:
          throw new Error(`unexpected fixed operand ${op.kind}`);
      }
    }
    case 'n':
      return { shape: 'n', value: variant === 0 ? 0x5a : -1 };
    case 'nn':
      return { shape: 'nn', value: variant === 0 ? 0x1234 : 0xfedc };
    case '(nn)':
      return { shape: '(nn)', value: variant === 0 ? 0x3c00 : 0xffff };
    case '(n)':
      return { shape: '(n)', value: variant === 0 ? 0xfe : 0x00 };
    case 'e':
      return { shape: 'e', value: variant === 0 ? PC + tpl.length + 127 : PC + tpl.length - 128 };
    case '(ix+d)':
      return { shape: o.reg === 'IX' ? '(IX+d)' : '(IY+d)', value: variant === 0 ? -3 : 0x7f };
    case 'd':
      return { shape: 'n', value: 0 };
  }
}

const hex = (bytes: number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');

describe('the encoder inverts the z80 tables', () => {
  it('finds 800 real encodings in the seven tables', () => {
    expect(SLOTS.length).toBe(800);
  });

  for (const variant of [0, 1]) {
    it(`round-trips every non-DB template through decodeAt (values ${variant === 0 ? 'positive' : 'at the limits'})`, () => {
      const failures: string[] = [];
      for (const { table, opcode, tpl } of SLOTS) {
        const operands = tpl.operands.map((o) => operandFor(o, tpl, variant));
        const out = encode(tpl.mnemonic, operands, PC);
        const label = `${table}:${opcode.toString(16)} ${tpl.mnemonic}`;
        if ('error' in out) {
          failures.push(`${label}: ${out.error}`);
          continue;
        }
        const ins = decodeAt(out.bytes, 0, PC);
        const decoded = decodedTemplate(out.bytes);
        const sameTemplate = decoded !== undefined && templateKey(decoded) === templateKey(tpl);
        const values = ins.operands.map(operandNumber).filter((v) => v !== undefined);
        const wanted = tpl.operands.flatMap((o, i) => (o.t === 'fixed' ? [] : [wrap(o, operands[i]!.value!)]));
        if (!sameTemplate || ins.length !== out.bytes.length || out.bytes.length !== decoded.length || JSON.stringify(values) !== JSON.stringify(wanted)) {
          failures.push(`${label}: encoded ${hex(out.bytes)}, decoded ${ins.mnemonic} ${JSON.stringify(ins.operands)}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('encodes each template to its own bytes, except the ED duplicates of LD (nn),HL and LD HL,(nn)', () => {
    const differ: string[] = [];
    for (const { table, opcode, tpl } of SLOTS) {
      const operands = tpl.operands.map((o) => operandFor(o, tpl, 0));
      const out = encode(tpl.mnemonic, operands, PC);
      if ('error' in out) throw new Error(out.error);
      const lead = out.bytes.slice(0, prefixLength(table) + 1);
      const want = expectedLead(table, opcode, out.bytes);
      if (hex(lead) !== hex(want)) differ.push(`${table}:${opcode.toString(16).padStart(2, '0')}`);
    }
    expect(differ.sort()).toEqual(['ed:63', 'ed:6b']);
  });

  it('puts the displacement before the opcode in DDCB and FDCB forms', () => {
    expect(encode('RLC', [{ shape: '(IX+d)', value: 5 }], 0)).toEqual({ bytes: [0xdd, 0xcb, 0x05, 0x06] });
    expect(encode('SET', [{ shape: 'num', value: 7 }, { shape: '(IY+d)', value: -2 }], 0)).toEqual({ bytes: [0xfd, 0xcb, 0xfe, 0xfe] });
    expect(encode('BIT', [{ shape: 'num', value: 0 }, { shape: '(IX+d)', value: 0x7f }], 0)).toEqual({ bytes: [0xdd, 0xcb, 0x7f, 0x46] });
  });

  it('puts the displacement before the immediate in LD (IX+d),n', () => {
    expect(encode('LD', [{ shape: '(IX+d)', value: 1 }, { shape: 'n', value: 0x20 }], 0)).toEqual({ bytes: [0xdd, 0x36, 0x01, 0x20] });
  });

  it('encodes LD (nn),HL as 22 and LD HL,(nn) as 2A, as zmac does', () => {
    expect(encode('LD', [{ shape: '(nn)', value: 0x4000 }, { shape: 'HL' }], 0)).toEqual({ bytes: [0x22, 0x00, 0x40] });
    expect(encode('LD', [{ shape: 'HL' }, { shape: '(nn)', value: 0x4000 }], 0)).toEqual({ bytes: [0x2a, 0x00, 0x40] });
  });

  it('spells the undocumented forms as zmac does: SLL and IXH/IXL/IYH/IYL', () => {
    expect(encode('SLL', [{ shape: 'B' }], 0)).toEqual({ bytes: [0xcb, 0x30] });
    expect(encode('LD', [{ shape: 'IXH' }, { shape: 'n', value: 1 }], 0)).toEqual({ bytes: [0xdd, 0x26, 0x01] });
    expect(encode('LD', [{ shape: 'A' }, { shape: 'IYL' }], 0)).toEqual({ bytes: [0xfd, 0x7d] });
  });

  it('takes mnemonics in any case', () => {
    expect(encode('ld', [{ shape: 'A' }, { shape: 'n', value: 1 }], 0)).toEqual({ bytes: [0x3e, 0x01] });
  });

  it('treats a register name C as the condition C where only a condition fits', () => {
    expect(encode('JP', [{ shape: 'C' }, { shape: 'nn', value: 0x1234 }], 0)).toEqual({ bytes: [0xda, 0x34, 0x12] });
    expect(encode('RET', [{ shape: 'C' }], 0)).toEqual({ bytes: [0xd8] });
  });

  it('takes any immediate shape where the template wants n, nn, or e, and either memory shape for (n) or (nn)', () => {
    expect(encode('LD', [{ shape: 'A' }, { shape: 'nn', value: 7 }], 0)).toEqual({ bytes: [0x3e, 0x07] });
    expect(encode('LD', [{ shape: 'HL' }, { shape: 'n', value: 7 }], 0)).toEqual({ bytes: [0x21, 0x07, 0x00] });
    expect(encode('JR', [{ shape: 'nn', value: 0x6010 }], 0x6000)).toEqual({ bytes: [0x18, 0x0e] });
    expect(encode('IN', [{ shape: 'A' }, { shape: '(nn)', value: 0xfe }], 0)).toEqual({ bytes: [0xdb, 0xfe] });
    expect(encode('LD', [{ shape: 'A' }, { shape: '(n)', value: 0x3c00 }], 0)).toEqual({ bytes: [0x3a, 0x00, 0x3c] });
  });

  it('reads (IX) as (IX+0) where no plain (IX) form exists, and keeps JP (IX)', () => {
    expect(encode('LD', [{ shape: 'A' }, { shape: '(IX)' }], 0)).toEqual({ bytes: [0xdd, 0x7e, 0x00] });
    expect(encode('JP', [{ shape: '(IX)' }], 0)).toEqual({ bytes: [0xdd, 0xe9] });
  });

  it('writes n as a byte and nn as a little-endian word, negatives in two\'s complement', () => {
    expect(encode('LD', [{ shape: 'A' }, { shape: 'n', value: -128 }], 0)).toEqual({ bytes: [0x3e, 0x80] });
    expect(encode('LD', [{ shape: 'BC' }, { shape: 'nn', value: -1 }], 0)).toEqual({ bytes: [0x01, 0xff, 0xff] });
  });
});

describe('range errors name the value and the limit', () => {
  const err = (out: ReturnType<typeof encode>): string => ('error' in out ? out.error : `no error: ${hex(out.bytes)}`);

  it('JR beyond -128..127', () => {
    expect(err(encode('JR', [{ shape: 'e', value: 0x6000 + 2 + 128 }], 0x6000))).toBe('JR reaches 128 bytes either way; the target $6082 is 128 bytes ahead. Use JP.');
    expect(err(encode('JR', [{ shape: 'e', value: 0x6000 + 2 - 129 }], 0x6000))).toBe('JR reaches 128 bytes either way; the target $5F81 is 129 bytes back. Use JP.');
    expect(encode('JR', [{ shape: 'e', value: 0x6000 + 2 + 127 }], 0x6000)).toEqual({ bytes: [0x18, 0x7f] });
    expect(encode('JR', [{ shape: 'e', value: 0x6000 + 2 - 128 }], 0x6000)).toEqual({ bytes: [0x18, 0x80] });
  });

  it('DJNZ beyond -128..127', () => {
    expect(err(encode('DJNZ', [{ shape: 'e', value: 0x6000 + 2 + 300 }], 0x6000))).toBe('DJNZ reaches 128 bytes either way; the target $612E is 300 bytes ahead. Use DEC B and JP NZ.');
  });

  // zmac gives a Value error for a relative jump across $FFFF (zmac probe in zmac-probes.test.ts).
  it('refuses a relative jump that wraps around the top of memory, as zmac does', () => {
    expect(err(encode('JR', [{ shape: 'e', value: 0x0001 }], 0xfffe))).toBe('JR cannot wrap around the top of memory from $FFFE to $0001. Use JP.');
    expect(err(encode('JR', [{ shape: 'e', value: 0xfff8 }], 0x0010))).toBe('JR cannot wrap around the top of memory from $0010 to $FFF8. Use JP.');
  });

  it('names the target when the caller gives its name', () => {
    expect(err(encode('JR', [{ shape: 'e', value: 0x6000 + 2 - 300 }], 0x6000, { target: 'LOOP' }))).toBe('JR reaches 128 bytes either way; LOOP is 300 bytes back. Use JP.');
    expect(err(encode('DJNZ', [{ shape: 'e', value: 0x6000 + 2 + 200 }], 0x6000, { target: 'NEXT' }))).toBe('DJNZ reaches 128 bytes either way; NEXT is 200 bytes ahead. Use DEC B and JP NZ.');
  });

  it('n beyond -128..255', () => {
    expect(err(encode('LD', [{ shape: 'A' }, { shape: 'n', value: 256 }], 0))).toBe('LD A,n takes a byte, -128 to 255; 256 ($0100) is out of range.');
    expect(err(encode('CP', [{ shape: 'n', value: -129 }], 0))).toBe('CP n takes a byte, -128 to 255; -129 is out of range.');
    expect(err(encode('LD', [{ shape: '(IX+d)', value: 0 }, { shape: 'n', value: 0x1234 }], 0))).toBe('LD (IX+d),n takes a byte, -128 to 255; 4660 ($1234) is out of range.');
  });

  // zmac gives a Value error for a negative port (zmac probe in zmac-probes.test.ts).
  it('a port beyond 0..255', () => {
    expect(err(encode('OUT', [{ shape: '(n)', value: 0x100 }, { shape: 'A' }], 0))).toBe('OUT (n),A takes a port, 0 to 255; 256 ($0100) is out of range.');
    expect(err(encode('IN', [{ shape: 'A' }, { shape: '(n)', value: -1 }], 0))).toBe('IN A,(n) takes a port, 0 to 255; -1 is out of range.');
    expect(encode('IN', [{ shape: 'A' }, { shape: '(n)', value: 255 }], 0)).toEqual({ bytes: [0xdb, 0xff] });
  });

  it('nn beyond -32768..65535', () => {
    expect(err(encode('LD', [{ shape: 'HL' }, { shape: 'nn', value: 0x10000 }], 0))).toBe('LD HL,nn takes a word, -32768 to 65535; 65536 ($10000) is out of range.');
  });

  it('(IX+d) beyond -128..127', () => {
    expect(err(encode('LD', [{ shape: 'A' }, { shape: '(IX+d)', value: 128 }], 0))).toBe('The displacement in (IX+d) runs from -128 to 127; 128 ($80) is out of range.');
    expect(err(encode('INC', [{ shape: '(IY+d)', value: -129 }], 0))).toBe('The displacement in (IY+d) runs from -128 to 127; -129 is out of range.');
    expect(err(encode('RES', [{ shape: 'num', value: 1 }, { shape: '(IX+d)', value: 200 }], 0))).toBe('The displacement in (IX+d) runs from -128 to 127; 200 ($C8) is out of range.');
  });

  it('RST not a multiple of 8', () => {
    expect(err(encode('RST', [{ shape: 'num', value: 9 }], 0))).toBe('RST takes 0, 8, 10H, 18H, 20H, 28H, 30H, or 38H; 9 is not one of them.');
    expect(err(encode('RST', [{ shape: 'num', value: 0x40 }], 0))).toBe('RST takes 0, 8, 10H, 18H, 20H, 28H, 30H, or 38H; 64 ($40) is not one of them.');
    expect(encode('RST', [{ shape: 'num', value: 0x28 }], 0)).toEqual({ bytes: [0xef] });
  });

  it('IM not 0-2', () => {
    expect(err(encode('IM', [{ shape: 'num', value: 3 }], 0))).toBe('IM takes 0, 1, or 2; 3 is not one of them.');
  });

  it('BIT, RES, and SET not 0-7', () => {
    expect(err(encode('BIT', [{ shape: 'num', value: 8 }, { shape: 'A' }], 0))).toBe('BIT takes a bit number from 0 to 7; 8 is out of range.');
    expect(err(encode('SET', [{ shape: 'num', value: -1 }, { shape: '(IX+d)', value: 0 }], 0))).toBe('SET takes a bit number from 0 to 7; -1 is out of range.');
  });

  it('a missing value is an error, not a zero', () => {
    expect(err(encode('LD', [{ shape: 'A' }, { shape: 'n' }], 0))).toBe('LD A,n needs a value for n.');
  });
});

describe('forms that do not exist', () => {
  const err = (out: ReturnType<typeof encode>): string => ('error' in out ? out.error : `no error: ${hex(out.bytes)}`);

  it('names the mnemonic and the form it lacks, with the forms that share the first operand', () => {
    expect(err(encode('LD', [{ shape: 'HL' }, { shape: '(BC)' }], 0))).toBe('LD has no form HL,(BC). The forms that start with HL are HL,(nn) and HL,nn.');
    expect(err(encode('NOP', [{ shape: 'A' }], 0))).toBe('NOP has no form A. NOP takes no operands.');
    expect(err(encode('EX', [{ shape: 'BC' }, { shape: 'DE' }], 0))).toBe("EX has no form BC,DE. Its forms are (SP),HL, (SP),IX, (SP),IY, AF,AF', and DE,HL.");
  });

  it('names operands in words, not shape names', () => {
    expect(err(encode('OUT', [{ shape: '(C)' }, { shape: 'num', value: 5 }], 0))).toBe('OUT has no form (C),n. The forms that start with (C) are (C),A, (C),B, (C),C, (C),D, (C),E, (C),H, and (C),L.');
    expect(err(encode('LD', [{ shape: 'B' }, { shape: '(n)', value: 1 }], 0))).toMatch(/^LD has no form B,\(port\)\. /);
    expect(err(encode('JP', [{ shape: 'BC' }, { shape: 'e', value: 1 }], 0))).toMatch(/^JP has no form BC,displacement\. /);
  });

  it('says how to write the undocumented IN F,(C), IN (C), and OUT (C),0, which the tables hold as DB', () => {
    expect(err(encode('IN', [{ shape: 'F' }, { shape: '(C)' }], 0))).toBe('IN F,(C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.');
    expect(err(encode('in', [{ shape: '(C)' }], 0))).toBe('IN (C) is undocumented, and Fugløy writes it as DB 0EDH,70H; use that instead.');
    expect(err(encode('OUT', [{ shape: '(C)' }, { shape: 'num', value: 0 }], 0))).toBe('OUT (C),0 is undocumented, and Fugløy writes it as DB 0EDH,71H; use that instead.');
    expect(TABLES.ed[0x70]!.mnemonic).toBe('DB');
    expect(TABLES.ed[0x71]!.mnemonic).toBe('DB');
  });

  it('names an unknown mnemonic', () => {
    expect(err(encode('LDA', [{ shape: 'n', value: 5 }], 0))).toBe('Unknown instruction LDA.');
  });
});

describe('the index refuses entries it cannot tell apart', () => {
  /** TABLES with one ED slot replaced. */
  const doctored = (opcode: number, tpl: Template): typeof TABLES => ({ ...TABLES, ed: TABLES.ed.map((t, i) => (i === opcode ? tpl : t)) });

  it('builds from the real tables, keeping 22 and 2A over ED 63 and ED 6B', () => {
    const index = buildIndex(TABLES);
    const ld = index.get('LD')!;
    expect(ld.some((e) => e.table === 'ed' && (e.opcode === 0x63 || e.opcode === 0x6b))).toBe(false);
    expect([...index.values()].reduce((n, l) => n + l.length, 0)).toBe(798);
  });

  it('throws on a second encoding of the same instruction', () => {
    expect(() => buildIndex(doctored(0x00, TABLES.base[0x3e]!))).toThrow(/LD A,n two encodings the encoder cannot tell apart: base:3e and ed:00/);
  });

  it('throws when an nn form would shadow an n form', () => {
    const ldAnn: Template = { ...TABLES.base[0x3e]!, operands: [{ t: 'fixed', op: { kind: 'reg', reg: 'A' } }, { t: 'nn' }], length: 4 };
    expect(() => buildIndex(doctored(0x00, ldAnn))).toThrow(/cannot tell apart/);
  });
});

describe('lengthOf and forms', () => {
  it('lengthOf equals the template length for every form', () => {
    const wrong: string[] = [];
    for (const { table, opcode, tpl } of SLOTS) {
      const shapes = tpl.operands.map((o) => operandFor(o, tpl, 0).shape);
      // ED 63 and ED 6B share their form with base 22 and 2A, which the assembler picks (3 bytes, not 4).
      const want = ZMAC_BASE.has(`${table}:${opcode.toString(16)}`) ? 3 : tpl.length;
      if (lengthOf(tpl.mnemonic, shapes) !== want) wrong.push(`${table}:${opcode.toString(16)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('lengthOf is null for a form that does not exist', () => {
    expect(lengthOf('LD', ['HL', '(BC)'])).toBeNull();
    expect(lengthOf('LDA', ['n'])).toBeNull();
  });

  it('lengthOf reads (IX) as (IX+0)', () => {
    expect(lengthOf('LD', ['A', '(IX)'])).toBe(3);
    expect(lengthOf('JP', ['(IX)'])).toBe(2);
  });

  it('forms lists every operand form as text', () => {
    expect(forms('EX')).toEqual(['(SP),HL', '(SP),IX', '(SP),IY', "AF,AF'", 'DE,HL']);
    expect(forms('IM')).toEqual(['0', '1', '2']);
    expect(forms('RST')).toEqual(['p']);
    expect(forms('BIT')).toContain('b,(IX+d)');
    expect(forms('JR')).toEqual(['C,e', 'NC,e', 'NZ,e', 'Z,e', 'e']);
    expect(forms('NOP')).toEqual(['']);
    expect(forms('ld')).toContain('A,(BC)');
    expect(forms('LDA')).toEqual([]);
  });

  it('lists 798 distinct forms across all mnemonics', () => {
    const mnemonics = new Set(SLOTS.map((s) => s.tpl.mnemonic));
    const total = [...mnemonics].reduce((n, m) => n + new Set(forms(m).flatMap((f) => expandForm(m, f))).size, 0);
    expect(total).toBe(798);
  });
});

const templateKey = (t: Template): string => `${t.mnemonic} ${JSON.stringify(t.operands)}`;

/** The number a decoded operand carries from the instruction bytes, if any. */
function operandNumber(op: ReturnType<typeof decodeAt>['operands'][number]): number | undefined {
  switch (op.kind) {
    case 'imm8':
    case 'byte':
    case 'imm16':
    case 'port':
      return op.value;
    case 'mem':
      return op.addr;
    case 'rel':
      return op.target;
    case 'idx':
      return op.disp;
    default:
      return undefined;
  }
}

/** The value as the decoder reports it back: bytes and words unsigned, displacements signed. */
function wrap(o: TemplateOperand, value: number): number {
  if (o.t === 'n' || o.t === '(n)' || o.t === 'd') return value & 0xff;
  if (o.t === 'nn' || o.t === '(nn)' || o.t === 'e') return value & 0xffff;
  return value;
}

/** The table entry the bytes decode through, found the same way the decoder walks prefixes. */
function decodedTemplate(bytes: number[]): Template | undefined {
  const [b0, b1, , b3] = bytes;
  if (b0 === 0xcb) return TABLES.cb[b1!];
  if (b0 === 0xed) return TABLES.ed[b1!];
  if (b0 === 0xdd || b0 === 0xfd) {
    if (b1 === 0xcb) return (b0 === 0xdd ? TABLES.ddcb : TABLES.fdcb)[b3!];
    return (b0 === 0xdd ? TABLES.dd : TABLES.fd)[b1!];
  }
  return TABLES.base[b0!];
}

function prefixLength(table: TableName): number {
  return table === 'base' ? 0 : table === 'ddcb' || table === 'fdcb' ? 3 : 1;
}

/** What the encoding of slot `opcode` in `table` must start with: its prefix bytes and opcode. */
function expectedLead(table: TableName, opcode: number, bytes: number[]): number[] {
  switch (table) {
    case 'base':
      return [opcode];
    case 'cb':
      return [0xcb, opcode];
    case 'ed':
      return [0xed, opcode];
    case 'dd':
      return [0xdd, opcode];
    case 'fd':
      return [0xfd, opcode];
    case 'ddcb':
      return [0xdd, 0xcb, bytes[2]!, opcode];
    case 'fdcb':
      return [0xfd, 0xcb, bytes[2]!, opcode];
  }
}

/** A form with its collapsed fixed numbers (`b`, `p`) expanded, so forms count like table slots. */
function expandForm(mnemonic: string, form: string): string[] {
  if (mnemonic === 'RST' && form === 'p') return [0, 8, 16, 24, 32, 40, 48, 56].map(String);
  if (form.startsWith('b,')) return [0, 1, 2, 3, 4, 5, 6, 7].map((b) => `${b}${form.slice(1)}`);
  return [form];
}
