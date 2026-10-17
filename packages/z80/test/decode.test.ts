import { describe, expect, it } from 'vitest';
import { decodeAt, formatInstruction } from '../src/index.js';

const d = (bytes: number[], addr = 0) => decodeAt(bytes, 0, addr);
const t = (bytes: number[], addr = 0) => formatInstruction(d(bytes, addr));

describe('decode', () => {
  it('decodes LD HL,nn little-endian', () => {
    const i = d([0x21, 0x00, 0x3c]);
    expect(i.length).toBe(3);
    expect(i.bytes).toEqual([0x21, 0x00, 0x3c]);
    expect(i.operands[1]).toEqual({ kind: 'imm16', value: 0x3c00 });
    expect(t([0x21, 0x00, 0x3c])).toBe('LD HL,3C00H');
  });

  it('computes JR and DJNZ targets from the instruction address', () => {
    expect(t([0x18, 0xfe], 0x4000)).toBe('JR 4000H');
    expect(t([0x20, 0x05], 0x4000)).toBe('JR NZ,4007H');
    expect(t([0x10, 0x80], 0x4000)).toBe('DJNZ 3F82H');
    expect(d([0x18, 0x7f], 0xffff).operands[0]).toEqual({ kind: 'rel', disp: 127, target: 0x0080 });
  });

  it('decodes (IX+d) with a signed displacement and LD (IX+d),n byte order', () => {
    expect(t([0xdd, 0x36, 0xff, 0x12])).toBe('LD (IX-01H),12H');
    expect(d([0xdd, 0x36, 0xff, 0x12]).length).toBe(4);
    expect(t([0xfd, 0x7e, 0x7f])).toBe('LD A,(IY+7FH)');
    expect(t([0xdd, 0x34, 0x00])).toBe('INC (IX+00H)');
  });

  it('keeps H and L when the other operand is (IX+d), and uses IXH/IXL otherwise', () => {
    expect(t([0xdd, 0x66, 0x02])).toBe('LD H,(IX+02H)');
    expect(t([0xdd, 0x74, 0x02])).toBe('LD (IX+02H),H');
    expect(t([0xdd, 0x65])).toBe('LD IXH,IXL');
    expect(t([0xfd, 0x26, 0x44])).toBe('LD IYH,44H');
    expect(t([0xdd, 0x84])).toBe('ADD A,IXH');
    expect(t([0xdd, 0x2d])).toBe('DEC IXL');
  });

  it('substitutes IX into HL-only forms without a displacement', () => {
    expect(t([0xdd, 0xe9])).toBe('JP (IX)');
    expect(t([0xdd, 0xe3])).toBe('EX (SP),IX');
    expect(t([0xdd, 0xf9])).toBe('LD SP,IX');
    expect(t([0xdd, 0x29])).toBe('ADD IX,IX');
    expect(t([0xfd, 0x22, 0x00, 0x40])).toBe('LD (4000H),IY');
  });

  it('treats a DD or FD prefix on an unaffected opcode as a one-byte DB', () => {
    for (const op of [0x00, 0xeb, 0x76, 0xdd, 0xed, 0xfd, 0x40, 0xc3]) {
      const i = d([0xdd, op, 0x00, 0x00]);
      expect(i.length, `DD ${op.toString(16)}`).toBe(1);
      expect(i.documented).toBe(false);
      expect(formatInstruction(i)).toBe('DB 0DDH');
    }
    expect(t([0xfd, 0xeb])).toBe('DB 0FDH');
  });

  it('includes SLL and renders undocumented ED and DDCB forms as DB', () => {
    expect(t([0xcb, 0x30])).toBe('SLL B');
    expect(t([0xdd, 0xcb, 0x05, 0x36])).toBe('SLL (IX+05H)');
    expect(t([0xed, 0x70])).toBe('DB 0EDH,70H');
    expect(d([0xed, 0x70]).length).toBe(2);
    expect(t([0xed, 0x4c])).toBe('DB 0EDH,4CH');
    expect(t([0xed, 0x00])).toBe('DB 0EDH,00H');
    expect(t([0xdd, 0xcb, 0x05, 0x00])).toBe('DB 0DDH,0CBH,05H,00H');
    expect(d([0xdd, 0xcb, 0x05, 0x00]).length).toBe(4);
    expect(t([0xfd, 0xcb, 0xfe, 0x46])).toBe('BIT 0,(IY-02H)');
  });

  it('reports control flow and cycle counts', () => {
    expect(d([0xc3, 0, 0]).flow).toEqual({ kind: 'jump', conditional: false, indirect: false });
    expect(d([0xe9]).flow).toEqual({ kind: 'jump', conditional: false, indirect: true });
    expect(d([0xc8]).flow).toEqual({ kind: 'return', conditional: true, indirect: false });
    expect(d([0xcf]).flow).toEqual({ kind: 'call', conditional: false, indirect: false });
    expect(d([0xcf]).operands[0]).toEqual({ kind: 'rst', addr: 0x08 });
    expect(d([0x76]).flow.kind).toBe('halt');
    expect(d([0xed, 0x4d]).flow.kind).toBe('return');
    expect(d([0x10, 0]).flow).toEqual({ kind: 'jump', conditional: true, indirect: false });
    expect(d([0xc4, 0, 0]).cycles).toBe(17);
    expect(d([0xc4, 0, 0]).cyclesNotTaken).toBe(10);
    expect(d([0xed, 0xb0]).cyclesNotTaken).toBe(16);
    expect(d([0x00]).cyclesNotTaken).toBeUndefined();
    expect(d([0xc2, 0, 0]).cyclesNotTaken).toBeUndefined(); // JP cc,nn is 10 either way
    expect(d([0xc2, 0, 0]).cycles).toBe(10);
    expect(d([0xdd, 0x7e, 0]).cycles).toBe(19);
    expect(d([0xdd, 0x36, 0, 0]).cycles).toBe(19);
    expect(d([0xdd, 0x34, 0]).cycles).toBe(23);
    expect(d([0xdd, 0xcb, 0, 0x46]).cycles).toBe(20);
  });

  it('returns a one-byte DB flagged truncated when bytes run out', () => {
    const i = decodeAt([0xcd, 0x00], 0, 0x5000, 2);
    expect(i.length).toBe(1);
    expect(i.truncated).toBe(true);
    expect(formatInstruction(i)).toBe('DB 0CDH');
    expect(decodeAt([0xdd], 0).truncated).toBe(true);
    expect(decodeAt([0xdd, 0xcb, 0x01], 0).truncated).toBe(true);
    expect(decodeAt([0x00], 0).truncated).toBeUndefined();
  });

  it('decodes from an offset inside a larger buffer', () => {
    const i = decodeAt([0xff, 0xff, 0x3e, 0x42, 0xff], 2, 0x7000);
    expect(formatInstruction(i)).toBe('LD A,42H');
    expect(i.bytes).toEqual([0x3e, 0x42]);
  });
});

describe('flag effects', () => {
  const f = (bytes: number[]) => d(bytes).flags;
  it('lists the affected flags in SZHPNC order', () => {
    expect(f([0x80])).toBe('SZHPNC'); // ADD A,B
    expect(f([0x03])).toBe(''); // INC BC
    expect(f([0x19])).toBe('HNC'); // ADD HL,DE
    expect(f([0xcb, 0x47])).toBe('SZHPN'); // BIT 0,A
    expect(f([0xfe, 0x01])).toBe('SZHPNC'); // CP n
    expect(f([0xed, 0x57])).toBe('SZHPN'); // LD A,I
    expect(f([0x37])).toBe('HNC'); // SCF
    expect(f([0x27])).toBe('SZHPC'); // DAA
    expect(f([0x78])).toBe(''); // LD A,B
    expect(f([0x10, 0x00])).toBe(''); // DJNZ
    expect(f([0x07])).toBe('HNC'); // RLCA
    expect(f([0xcb, 0x00])).toBe('SZHPNC'); // RLC B
    expect(f([0xed, 0xb0])).toBe('HPN'); // LDIR
    expect(f([0xed, 0xb1])).toBe('SZHPN'); // CPIR
    expect(f([0xdd, 0x34, 0x01])).toBe('SZHPN'); // INC (IX+d)
    expect(f([0xed, 0x44])).toBe('SZHPNC'); // NEG
  });
  it('covers the other groups', () => {
    expect(f([0x04])).toBe('SZHPN'); // INC B
    expect(f([0x0b])).toBe(''); // DEC BC
    expect(f([0xdd, 0x09])).toBe('HNC'); // ADD IX,BC
    expect(f([0xed, 0x42])).toBe('SZHPNC'); // SBC HL,BC
    expect(f([0xa0])).toBe('SZHPNC'); // AND B
    expect(f([0x2f])).toBe('HN'); // CPL
    expect(f([0xcb, 0x80])).toBe(''); // RES 0,B
    expect(f([0xdd, 0xcb, 0x01, 0x46])).toBe('SZHPN'); // BIT 0,(IX+d)
    expect(f([0xf1])).toBe('SZHPNC'); // POP AF
    expect(f([0xc1])).toBe(''); // POP BC
    expect(f([0xed, 0x78])).toBe('SZHPN'); // IN A,(C)
    expect(f([0xdb, 0x00])).toBe(''); // IN A,(n)
    expect(f([0xed, 0x67])).toBe('SZHPN'); // RRD
    expect(f([0xed, 0xa2])).toBe('ZN'); // INI
    expect(f([0xed, 0x4f])).toBe(''); // LD R,A
    expect(f([0xdd, 0xdd])).toBe(''); // DB fallback
  });
});
