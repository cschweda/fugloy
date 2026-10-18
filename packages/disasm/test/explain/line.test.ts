/** The Explain tab's line sentences: Sea Dragon goldens, TRS-80 knowledge, previews, details, labels, BASIC. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { explainLine, explainRow, screenCell, sentenceText } from '../../src/explain/index.js';
import { listingRows } from '../../src/rows.js';
import type { Hint } from '../../src/hints/format.js';
import type { Explanation } from '../../src/explain/index.js';
import { openProgram, skeletonHints, withHintFile, withHintText } from '../../src/session.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const sea = withHintText(
  openProgram(new Uint8Array(readFileSync(`${root}examples/sea-dragon/seadrg01.cmd`)), { name: 'seadrg01.cmd', selection: { machine: 3, dos: 'trsdos' } }),
  readFileSync(`${root}examples/sea-dragon/seadrg01.hints`, 'utf8'),
  'seadrg01.hints',
);
const lead = (e: Explanation): string[] => e.sentences.map(sentenceText);
const BASE = 0x7000;
const raw = (bytes: number[], selection?: { machine: 1 | 3; dos: 'trsdos' | 'ldos' }) =>
  openProgram(new Uint8Array(bytes), { base: BASE, ...(selection === undefined ? {} : { selection }) });

describe('Sea Dragon goldens (Model III, TRSDOS 1.3, seadrg01.hints)', () => {
  it('$49A7 LD IX,VIDEO+0380H: a screen address as row and column', () => {
    const e = explainLine(sea, 0x49a7);
    expect(e.kind).toBe('code');
    expect(e.line).toBe('49A7  DD 21 80 3F   LD IX,VIDEO+0380H');
    expect(lead(e)).toEqual(['Put $3F80 (VIDEO+0380H, the screen, row 14, column 0) into IX (an index register).']);
    const video = e.sentences[0]!.find((p) => p.text === 'VIDEO+0380H');
    expect(video?.entry?.name).toBe('VIDEO');
  });

  it('$499F OUT (MODEPORT),A: a port write with A known and the port named', () => {
    const e = explainLine(sea, 0x499f);
    expect(lead(e)).toEqual(['Send A ($30) to port $EC (MODEPORT): clear clock interrupt (in), video, cassette motor, and I/O bus modes (out).']);
    expect(e.sentences[0]!.find((p) => p.text === 'MODEPORT')?.entry?.kind).toBe('port');
  });

  it('$4EAC CALL $DELAY: a ROM call by its purpose, with the known BC going in', () => {
    const e = explainLine(sea, 0x4eac);
    expect(lead(e)).toEqual(['Call the ROM routine $DELAY ($0060): pause for a time set by BC.', 'Going in, BC holds $2000 (8,192).']);
    expect(e.previews.map((p) => p.title)).toEqual(['$DELAY']);
    expect(e.previews[0]!.entry?.purpose).toBe('pause for a time set by BC');
  });

  it('$5FC4 LD A,(HL): a merge point states no value and says where control comes from', () => {
    const e = explainLine(sea, 0x5fc4);
    expect(lead(e)).toEqual([
      'Get the byte at the address in HL and put it in A.',
      'HL holds whatever it held when L5FC4 was reached: by falling through from $5FC3, or by the jumps at $5FD6 and $5FDE.',
    ]);
    expect(e.previews).toEqual([]);
    expect(e.label).toEqual({ name: 'L5FC4', callers: [], jumpers: [0x5fd6, 0x5fde], entry: false, pointers: [], rewritten: [] });
    const links = e.sentences[1]!.filter((p) => p.addr !== undefined).map((p) => p.addr);
    expect(links).toEqual([0x5fc4, 0x5fc3, 0x5fd6, 0x5fde]);
  });

  it('$888B LDIR: the copy with BC, HL and DE known', () => {
    const e = explainLine(sea, 0x888b);
    expect(lead(e)).toEqual(['Copy $3681 (13,953) bytes from $5200 (L5200) to $497F (L497F), one at a time, counting up: BC is the count, HL the source and DE the destination.']);
    expect(e.previews.map((p) => p.addr)).toEqual([0x5200, 0x497f]);
    expect(e.previews[1]!.title).toBe('L497F');
    expect(e.previews[1]!.lines).toHaveLength(4);
    expect(e.previews[1]!.lines[0]).toMatch(/^497F {2}/);
  });

  it('$62FA data row: kind data, with the key that makes it code and the bytes as text', () => {
    const e = explainLine(sea, 0x62fa);
    expect(e.kind).toBe('data');
    expect(e.line).toBe('62FA  65 72 20 20   DB 65H,72H,20H,20H');
    expect(lead(e)).toEqual([
      'These 4 bytes are data: the code is not known to run them. Press C to decode them as code (D turns code back into bytes).',
      'As text they read "er  ".',
    ]);
    expect(e.details).toBeUndefined();
    expect(e.region?.start).toBeLessThanOrEqual(0x62fa);
    expect(e.region?.end).toBeGreaterThanOrEqual(0x62fd);
  });

  it('an address inside a data row explains that row', () => {
    expect(explainLine(sea, 0x62fc).line).toBe('62FA  65 72 20 20   DB 65H,72H,20H,20H');
  });

  it('details: $499F is 2 bytes, 11 T-states, no flags, documented', () => {
    expect(explainLine(sea, 0x499f).details).toEqual({ bytes: 2, cycles: 11, flags: '', documented: true });
  });

  it('details of a conditional jump carry both T-state counts', () => {
    expect(explainLine(sea, 0x5fc7).details).toEqual({ bytes: 2, cycles: 12, cyclesNotTaken: 7, flags: '', documented: true });
  });

  it('a conditional jump says what it tests and where it goes', () => {
    expect(lead(explainLine(sea, 0x5fc7))).toEqual(['If the last result was not zero (Z flag clear), jump to $5FB9 (L5FB9); otherwise carry on with the next line.']);
  });

  it('a label inside an instruction is explained as a byte of that instruction', () => {
    const e = explainLine(sea, 0x49c1);
    expect(e.kind).toBe('label');
    expect(e.line).toBe('49BF  FD 7E 00      LD A,(IY+00H)');
    expect(lead(e)).toEqual(['The program refers to $49C1 (DATA_49C1) as data, but it lies inside the instruction at $49BF, so a write there would change that instruction as it runs.']);
    expect(e.label?.name).toBe('DATA_49C1');
  });

  it('a known pointer in a call names the routine and says what goes in', () => {
    expect(lead(explainLine(sea, 0x499a))).toEqual(['Call SUB_4B9E ($4B9E); when it returns, carry on with the next line.', 'Going in, A holds $01 and HL holds $4659.']);
  });

  it('$49BF LD A,(IY+00H): the displacement DATA_49C1 is rewritten at $49BC, and the line says so', () => {
    const e = explainLine(sea, 0x49bf);
    expect(lead(e)).toEqual([
      'Get the byte at IY+$00 and put it in A.',
      'The program rewrites part of this instruction as it runs (DATA_49C1, written at $49BC), so the numbers shown are only where they start.',
      'IY holds whatever it held when L49BC was reached: by falling through from $49BA, or by the jump at $49B6.',
    ]);
    expect(e.previews).toEqual([]);
  });

  it('the entry point says so', () => {
    const e = explainLine(sea, 0x8881);
    expect(e.label).toBeUndefined();
    expect(lead(e)).toEqual(['Do nothing for one step (no operation).', 'This is where the program starts (its entry point).']);
  });
});

describe('line sentences on synthetic code', () => {
  it('LD A,(nn) gets the byte at the address, named', () => {
    // 7000 LD A,(7004H); 7003 RET; 7004 DB 0
    const e = explainLine(raw([0x3a, 0x04, 0x70, 0xc9, 0x00]), BASE);
    expect(lead(e)[0]).toBe('Get the byte at $7004 (DATA_7004) and put it in A.');
    expect(e.previews).toEqual([{ addr: 0x7004, title: 'DATA_7004', lines: ['7004  00            DB 00H'] }]);
  });

  it('LD A,n puts the value in the accumulator', () => {
    expect(lead(explainLine(raw([0x3e, 0x20, 0xc9]), BASE))[0]).toBe('Put $20 into A (the accumulator).');
  });

  it('(HL) with a known HL names the address and previews it', () => {
    // 7000 LD HL,3C41H; 7003 LD (HL),A; 7004 RET
    const e = explainLine(raw([0x21, 0x41, 0x3c, 0x77, 0xc9]), 0x7003);
    expect(lead(e)).toEqual(['Store A in the byte at $3C41 (the screen, row 1, column 1; the address in HL).']);
    expect(e.previews).toEqual([{ addr: 0x3c41, title: '$3C41', lines: ['the screen, row 1, column 1'] }]);
  });

  it('(IX+d) with a known IX names the cell', () => {
    // 7000 LD IX,3C00H; 7004 LD (IX+05H),A; 7007 RET
    const e = explainLine(raw([0xdd, 0x21, 0x00, 0x3c, 0xdd, 0x77, 0x05, 0xc9]), 0x7004);
    expect(lead(e)).toEqual(['Store A in the byte at $3C05 (the screen, row 0, column 5; IX+$05).']);
  });

  it('patched: a rewritten displacement is never folded into an address', () => {
    // 7000 LD IX,3C00H; 7004 LD (IX+05H),A; 7007 LD (7006H),A; 700A RET
    const e = explainLine(raw([0xdd, 0x21, 0x00, 0x3c, 0xdd, 0x77, 0x05, 0x32, 0x06, 0x70, 0xc9]), 0x7004);
    expect(lead(e)).toEqual([
      'Store A in the byte at IX+$05.',
      'The program rewrites part of this instruction as it runs (DATA_7006, written at $7007), so the numbers shown are only where they start.',
    ]);
    expect(e.previews).toEqual([]);
    expect(lead(e).join(' ')).not.toContain('$3C05');
  });

  it('patched: a rewritten immediate keeps the listed value with the caveat', () => {
    // 7000 LD A,05H; 7002 LD (7001H),A; 7005 RET
    expect(lead(explainLine(raw([0x3e, 0x05, 0x32, 0x01, 0x70, 0xc9]), BASE)).slice(0, 2)).toEqual([
      'Put $05 into A (the accumulator).',
      'The program rewrites part of this instruction as it runs (DATA_7001, written at $7002), so the numbers shown are only where they start.',
    ]);
  });

  it('patched: a rewritten jump target is named but not previewed', () => {
    // 7000 LD HL,7009H; 7003 LD (7007H),HL; 7006 JP 7009H; 7009 RET
    const e = explainLine(raw([0x21, 0x09, 0x70, 0x22, 0x07, 0x70, 0xc3, 0x09, 0x70, 0xc9]), 0x7006);
    expect(lead(e)).toEqual([
      'Jump to $7009 (L7009).',
      'The program rewrites part of this instruction as it runs (DATA_7007 and $7008, written at $7003), so the numbers shown are only where they start.',
    ]);
    expect(e.previews).toEqual([]);
  });

  it('patched without a store: the referring instruction is named', () => {
    // 7000 LD HL,7004H; 7003 LD A,05H (7004 is its operand); 7005 RET
    const e = explainLine(raw([0x21, 0x04, 0x70, 0x3e, 0x05, 0xc9]), 0x7003);
    expect(lead(e)[1]).toBe('The program refers to a byte inside this instruction (DATA_7004, used at $7000), so it may rewrite the instruction as it runs; the numbers shown are only where they start.');
  });

  it('rewritten-opcode: a store into an instruction\'s first byte says it may be a different instruction, and nothing replays its value', () => {
    // 7000 LD A,0; 7002 LD (7007H),A; 7005 LD B,3; 7007 LD B,9 (becomes NOP, then $09 runs as ADD HL,BC); 7009 LD A,B; 700A LD (3C00H),A; 700D RET
    const s = raw([0x3e, 0x00, 0x32, 0x07, 0x70, 0x06, 0x03, 0x06, 0x09, 0x78, 0x32, 0x00, 0x3c, 0xc9]);
    const at7007 = lead(explainLine(s, 0x7007)).join(' ');
    expect(at7007).toMatch(/The program stores into the first byte of this instruction as it runs \(DATA_7007, written at \$7002\), so at run time it may be a different instruction; this line shows only what it starts as\./);
    for (const at of [0x7009, 0x700a]) expect(lead(explainLine(s, at)).join(' ')).not.toMatch(/\$09/);
    expect(lead(explainLine(s, 0x7009))[0]).toBe('Copy B into A.');
  });

  it('Sea Dragon $5174: the instruction the program swaps (written at $5C60 and five more) gets the first-byte caveat', () => {
    expect(lead(explainLine(sea, 0x5174)).join(' ')).toMatch(/stores into the first byte of this instruction as it runs \(L5174, written at \$5C60, \$5C91, \$5D5E and 3 more\)/);
    // A store into an address is not a pointer to it: no "reached through a pointer".
    expect(lead(explainLine(sea, 0x5174)).join(' ')).not.toMatch(/through a pointer/);
  });

  it('RET says where it carries on without claiming a CALL put it there', () => {
    // 7000 LD HL,7006H; 7003 PUSH HL; 7004 RET; 7005 NOP; 7006 RET
    const s = raw([0x21, 0x06, 0x70, 0xe5, 0xc9, 0x00, 0xc9]);
    expect(lead(explainLine(s, 0x7004))).toEqual(['Return: carry on at the address on top of the stack (usually the one the CALL that came here put there).']);
    // 7000 RET Z; 7001 RET
    expect(lead(explainLine(raw([0xc8, 0xc9]), 0x7000))[0]).toBe(
      'If the last result was zero (Z flag set), return: carry on at the address on top of the stack (usually the one the CALL that came here put there); otherwise carry on with the next line.',
    );
  });

  it('a merge point whose address is also used as data says it may be reached through a pointer', () => {
    // 7000 LD HL,7008H; 7003 JR Z,7008H; 7005 LD A,1; 7007 NOP; 7008 LD (HL),A; 7009 JP (HL)
    const s = raw([0x21, 0x08, 0x70, 0x28, 0x03, 0x3e, 0x01, 0x00, 0x77, 0xe9]);
    expect(lead(explainLine(s, 0x7008)).join(' ')).toMatch(/HL holds whatever it held when L7008 was reached: by falling through from \$7007, or by the jump at \$7003; its address is also used at \$7000, so it may also be reached through a pointer\./);
  });

  it('an unreferenced data label in straight code reports the fall-through', () => {
    // 7000 LD HL,7006H; 7003 LD (7010H),HL; 7006 LD A,(DE); 7007 RET
    const e = explainLine(raw([0x21, 0x06, 0x70, 0x22, 0x10, 0x70, 0x1a, 0xc9]), 0x7006);
    expect(lead(e)[1]).toBe('DE holds whatever it held when DATA_7006 was reached: by falling through from $7003, or perhaps through a pointer, since the program refers to it as data.');
  });

  it('a table name that clashes with a program name is not used, as in the listing', () => {
    // 7000 CALL 000BH; 7003 RET, with $7003 named GETPC (the Model III ROM name for $000B)
    const bytes = new Uint8Array([0xcd, 0x0b, 0x00, 0xc9]);
    const s0 = openProgram(bytes, { base: BASE, selection: { machine: 3, dos: 'trsdos' } });
    expect(lead(explainLine(s0, BASE))[0]).toBe('Call the ROM routine GETPC ($000B): return with the return address in HL, so relocatable code can find where it sits.');
    const name: Hint = { directive: 'name', name: 'GETPC', block: 0, offset: 3, line: 1 };
    const s = withHintFile(s0, { ...skeletonHints(s0.module, bytes), hints: [name] });
    expect(lead(explainLine(s, BASE))[0]).toBe('Call the routine at $000B; when it returns, carry on with the next line.');
  });

  it('a register changed on the way by an untracked load says where, without a value', () => {
    // 7000 LD HL,(7006H); 7003 LD A,(HL); 7004 RET; 7005 NOP; 7006 DW 0
    const e = explainLine(raw([0x2a, 0x06, 0x70, 0x7e, 0xc9, 0x00, 0x00, 0x00]), 0x7003);
    expect(lead(e)).toEqual(['Get the byte at the address in HL and put it in A.', 'The lines leading here do not prove what HL holds; it was last changed at $7000.']);
  });

  it('a register unknown at the entry point says so without a value', () => {
    const e = explainLine(raw([0x7e, 0xc9]), BASE);
    expect(lead(e)).toEqual([
      'Get the byte at the address in HL and put it in A.',
      'This is where the program starts (its entry point), so HL holds whatever it held when the program was started.',
    ]);
  });

  it('a register unknown after a call blames the call', () => {
    // 7000 CALL 7005; 7003 LD A,(HL); 7004 RET; 7005 RET
    const e = explainLine(raw([0xcd, 0x05, 0x70, 0x7e, 0xc9, 0xc9]), 0x7003);
    expect(lead(e)[1]).toBe('The lines leading here do not prove what HL holds; the call at $7000 just before may have changed it.');
  });

  it('RST 08H mentions its inline byte', () => {
    // 7000 RST 08H; 7001 DB 2CH; 7002 RET
    const e = explainLine(raw([0xcf, 0x2c, 0xc9], { machine: 3, dos: 'trsdos' }), BASE);
    const text = lead(e).join(' ');
    expect(text).toContain('$0008');
    expect(text).toContain('The byte after it, $2C at $7001, is a parameter the routine reads; it comes back to $7002, past that byte.');
  });

  it('a jump-table entry is not called an instruction', () => {
    // 7000 LD HL,(7006H); 7003 JP (HL); 7004 RET; 7005 NOP; 7006 DW 7008H (a declared table); 7008 LD A,(HL); 7009 RET
    const bytes = new Uint8Array([0x2a, 0x06, 0x70, 0xe9, 0xc9, 0x00, 0x08, 0x70, 0x7e, 0xc9]);
    const s0 = openProgram(bytes, { base: BASE });
    const file = { ...skeletonHints(s0.module, bytes), hints: [{ directive: 'table' as const, count: 1, width: 2, block: 0, offset: 6, line: 1 }] };
    const e = explainLine(withHintFile(s0, file), 0x7008);
    expect(lead(e)[1]).toBe('HL holds whatever it held when L7008 was reached: through the jump table entry at $7006.');
  });

  it('screenCell maps $3C00-$3FFF to 0-based rows and columns', () => {
    expect(screenCell(0x3c00)).toEqual({ row: 0, column: 0 });
    expect(screenCell(0x3fff)).toEqual({ row: 15, column: 63 });
    expect(screenCell(0x3f80)).toEqual({ row: 14, column: 0 });
    expect(screenCell(0x3bff)).toBeNull();
    expect(screenCell(0x4000)).toBeNull();
  });

  it('an undocumented DB fallback still says what its bytes are', () => {
    const e = explainLine(raw([0xed, 0x00, 0xc9]), BASE);
    expect(e.details?.documented).toBe(false);
    expect(lead(e)[0]).toMatch(/^The bytes \$ED, \$00 are not an instruction/);
  });
});

describe('explainRow', () => {
  const rows = listingRows(sea.analysis);
  it('an ORG row says where the code starts', () => {
    const org = rows.find((r) => r.kind === 'org')!;
    const e = explainRow(sea, org);
    expect(e.kind).toBe('other');
    expect(e.line).toBe('        ORG 5200H');
    expect(lead(e)).toEqual(['ORG tells the assembler that the code below starts at $5200.']);
  });

  it('header and blank rows get one line each', () => {
    expect(lead(explainRow(sea, rows.find((r) => r.kind === 'header')!))).toEqual(['A comment line Fugløy adds to the top of the listing to describe the file; the program does not contain it.']);
    expect(lead(explainRow(sea, { kind: 'blank' }))).toEqual(['A blank line that separates parts of the listing.']);
  });

  it('a user block comment is called yours; a listing note is Fugløy\'s', () => {
    const bytes = new Uint8Array([0x00, 0xc9]);
    const s0 = openProgram(bytes, { base: BASE });
    const note: Hint = { directive: 'note', text: 'Starts here', block: 0, offset: 1, line: 1 };
    const s = withHintFile(s0, { ...skeletonHints(s0.module, bytes), hints: [note] });
    const row = listingRows(s.analysis).find((r) => r.kind === 'note')!;
    expect(lead(explainRow(s, row))).toEqual(['Your block comment for $7001, kept in the hint file; the program does not contain it.']);
    expect(lead(explainRow(s, { kind: 'note', text: '; relocated: something' }))).toEqual(['A comment line Fugløy adds to the listing; the program does not contain it.']);
  });

  it('code rows delegate to explainLine', () => {
    const row = rows.find((r) => r.kind === 'code' && r.addr === 0x499f)!;
    expect(explainRow(sea, row)).toEqual(explainLine(sea, 0x499f));
  });
});

describe('BASIC sessions', () => {
  it('bas-session: a .BAS program is explained as BASIC-later', () => {
    const s = openProgram(new Uint8Array(readFileSync(`${root}fixtures/synthetic/bas/prog-7000.bas`)));
    const e = explainLine(s, s.module.image.runs()[0]!.start);
    expect(e.kind).toBe('basic');
    expect(lead(e)).toEqual(['Explain covers machine code; BASIC comes later.']);
  });
});
