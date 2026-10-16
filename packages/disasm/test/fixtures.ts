/**
 * Every synthetic fixture, by name. `pnpm fixtures` writes them under
 * fixtures/synthetic/; fixtures.test.ts checks the committed files still match.
 */
import { writeBasic } from './writers/basic-tokenizer.js';
import type { BasicLineSpec } from './writers/basic-tokenizer.js';
import { CmdWriter } from './writers/cmd-writer.js';
import { loadCmd } from '../src/cmd.js';
import type { HintFile } from '../src/hints/format.js';
import { blockIdentities, programHash } from '../src/hints/identity.js';

/** `n` bytes of a recognisable pattern: the low byte of the index plus `seed`. */
export const pattern = (n: number, seed = 0): number[] => Array.from({ length: n }, (_, i) => (i + seed) & 0xff);

/** A tiny program that is valid Z80: LD HL,3C00H / LD (HL),41H / RET. */
export const PROGRAM = [0x21, 0x00, 0x3c, 0x36, 0x41, 0xc9];

export const CMD_FIXTURES: Record<string, () => Uint8Array> = {
  'small-block': () => new CmdWriter().loadRecord(0x6000, [0xc9]).transfer(0x6000).bytes(),
  'len-wrap-254': () => new CmdWriter().loadRecord(0x6000, pattern(254)).transfer(0x6000).bytes(),
  'len-wrap-255': () => new CmdWriter().loadRecord(0x6000, pattern(255)).transfer(0x6000).bytes(),
  'len-wrap-256': () => new CmdWriter().loadRecord(0x6000, pattern(256)).transfer(0x6000).bytes(),
  'multi-record': () => new CmdWriter().load(0x6000, pattern(600)).transfer(0x6000).bytes(),
  'overlap': () => new CmdWriter().load(0x7000, pattern(16, 0x10)).loadRecord(0x7004, [0xc3, 0x00, 0x70]).transfer(0x7000).bytes(),
  'out-of-order': () => new CmdWriter().load(0x8000, pattern(4, 0x80)).load(0x7000, pattern(4, 0x70)).transfer(0x7000).bytes(),
  'non-contiguous': () => new CmdWriter().load(0x6000, PROGRAM).load(0x7000, pattern(8)).transfer(0x6000).bytes(),
  'missing-02': () => new CmdWriter().load(0x7000, pattern(8)).load(0x5200, PROGRAM).bytes(),
  'end-03': () => new CmdWriter().load(0x5200, PROGRAM).endNoTransfer().bytes(),
  'trailing-bytes': () => new CmdWriter().load(0x5200, PROGRAM).transfer(0x5200).raw([0x00, 0x01, 0x02, 0xff, 0x55, 0xaa, 0x00, 0x00, 0x03, 0x1f]).bytes(),
  'header-05': () => new CmdWriter().header('ASYLUM').load(0x5200, PROGRAM).transfer(0x5200).bytes(),
  'copyright-1f': () => new CmdWriter().copyright('(C) 1981 MED SYSTEMS').load(0x5200, PROGRAM).transfer(0x5200).bytes(),
  'pds-records': () =>
    new CmdWriter()
      .header('PDSMOD')
      .record(0x06, pattern(8))
      .record(0x07, pattern(3))
      .record(0x08, pattern(13))
      .record(0x09, [0])
      .record(0x0a, pattern(2))
      .record(0x0b, [0])
      .record(0x0c, pattern(256))
      .record(0x0d, [1])
      .record(0x0e, [0])
      .record(0x0f, pattern(5))
      .record(0x10, pattern(7))
      .load(0x5200, PROGRAM)
      .record(0x04, [0])
      .transfer(0x5200)
      .bytes(),
  'truncated': () => new CmdWriter().load(0x5200, PROGRAM).load(0x5300, pattern(8)).raw([0x01, 0x12, 0x00, 0x60, 0x11, 0x22, 0x33]).bytes(),
  'unknown-type': () => new CmdWriter().load(0x5200, PROGRAM).load(0x5300, pattern(8)).raw([0x7f, 0x02, 0x00, 0x00, 0x02, 0x02, 0x00, 0x52]).bytes(),
  'transfer-len-00': () => new CmdWriter().load(0x5200, PROGRAM).raw([0x02, 0x00, 0x03, 0x52]).bytes(),
  'wraps-ffff': () => new CmdWriter().loadRecord(0xfffe, [1, 2, 3, 4]).transfer(0xfffe).bytes(),
  'hint-paths': () => new CmdWriter().load(0x6000, HINT_PATHS_PROGRAM).transfer(0x6000).bytes(),
};

/**
 * A program that exercises every emitter path once hints are applied: a call
 * (user-named), data references into words and bytes areas, a dispatch table
 * with two code targets, a string, an external call, a name inside an
 * instruction, a comment, and a nocode byte.
 */
export const HINT_PATHS_PROGRAM: number[] = [
  /* 6000 */ 0xcd, 0x20, 0x60,       // CALL 6020      (PRINT; name at 6001 is inside this instruction)
  /* 6003 */ 0x21, 0x40, 0x60,       // LD HL,6040     (words area)
  /* 6006 */ 0x3a, 0x50, 0x60,       // LD A,(6050)    (bytes area)
  /* 6009 */ 0x32, 0x50, 0x60,       // LD (6050),A
  /* 600C */ 0x21, 0x30, 0x60,       // LD HL,6030     (table)
  /* 600F */ 0x5f,                   // LD E,A
  /* 6010 */ 0x16, 0x00,             // LD D,0
  /* 6012 */ 0x19,                   // ADD HL,DE
  /* 6013 */ 0x19,                   // ADD HL,DE
  /* 6014 */ 0x7e,                   // LD A,(HL)
  /* 6015 */ 0x23,                   // INC HL
  /* 6016 */ 0x66,                   // LD H,(HL)
  /* 6017 */ 0x6f,                   // LD L,A
  /* 6018 */ 0xe9,                   // JP (HL)
  /* 6019 */ 0x18, 0xfe,             // JR 6019        (table target)
  /* 601B */ 0xc9,                   // RET            (table target)
  /* 601C */ 0x00, 0x00, 0x00, 0x00, // padding        (nocode at 601C)
  /* 6020 */ 0x3e, 0x41,             // LD A,41H       (PRINT)
  /* 6022 */ 0xcd, 0x33, 0x00,       // CALL 0033      (external)
  /* 6025 */ 0xc9,                   // RET
  /* 6026 */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // padding to 6030
  /* 6030 */ 0x19, 0x60, 0x1b, 0x60, // table: 6019, 601B
  /* 6034 */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // padding to 6040
  /* 6040 */ 0x34, 0x12, 0x78, 0x56, 0xbb, 0xaa,   // words: 1234H 5678H 0AABBH
  /* 6046 */ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,   // padding to 6050
  /* 6050 */ 0x01, 0x02, 0x03, 0x04, // bytes
  /* 6054 */ 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x0d,   // string "HELLO" 0DH
  /* 605A */ 0xff,                   // odd trailing byte of a words override (605A, length 1)
];

/** Hint files for the synthetic programs, with identities computed from the program bytes. */
export const HINT_FIXTURES: Record<string, () => HintFile> = {
  'hint-paths': () => {
    const bytes = CMD_FIXTURES['hint-paths']!();
    const mod = loadCmd(bytes);
    const blocks = blockIdentities(mod.image).map((b) => ({ index: b.index, length: b.length, hash: b.hash, start: b.start }));
    const h = (offset: number, directive: HintFile['hints'][number]['directive'], extra: object = {}) =>
      ({ block: 0, offset, directive, line: 0, ...extra }) as HintFile['hints'][number];
    return {
      version: 1,
      program: programHash(bytes),
      blocks,
      hints: [
        h(0x0000, 'comment', { text: 'call PRINT, then dispatch through the table' }),
        h(0x0001, 'name', { name: 'MIDCALL' }),
        h(0x001c, 'nocode'),
        h(0x0020, 'name', { name: 'PRINT' }),
        h(0x0030, 'table', { count: 2, width: 2 }),
        h(0x0030, 'name', { name: 'DISPATCH' }),
        h(0x0040, 'words', { length: 6 }),
        h(0x0050, 'bytes', { length: 4 }),
        h(0x0050, 'name', { name: 'FLAGS' }),
        h(0x0054, 'string'),
        h(0x005a, 'words', { length: 1 }),
      ],
    };
  },
};

/** Six ordinary lines exercising keywords, strings, DATA, ELSE, and a remark. */
export const SIX_LINES: BasicLineSpec[] = [
  { number: 10, text: 'CLS:PRINT"VOYAGE OF THE VALKYRIE"' },
  { number: 20, text: 'FOR I=1 TO 10:PRINT I;:NEXT' },
  { number: 30, text: 'X=PEEK(16548)+256*PEEK(16549)' },
  { number: 40, text: 'IF X>0 THEN GOSUB 100 ELSE END' },
  { number: 100, text: 'DATA 1,2,"A:B":RETURN' },
  { number: 250, text: "' END OF PROGRAM" },
];

export const BAS_FIXTURES: Record<string, () => Uint8Array> = {
  'prog-62c8': () => writeBasic(SIX_LINES, 0x62c8),
  'prog-7000': () => writeBasic(SIX_LINES, 0x7000),
  'no-header': () => writeBasic(SIX_LINES.slice(0, 2), 0x6500, { header: false }),
  'hidden-code': () =>
    writeBasic([{ number: 10, text: 'GOTO 30' }, { number: 20, raw: [0xc3, 0x00, 0x00, 0xc9, 0x00, 0x3e] }, { number: 30, text: 'END' }], 0x7000),
  'bad-token': () => writeBasic([{ number: 10, text: 'CLS' }, { number: 20, raw: [0xb2, 0xfc, 0x41] }, { number: 30, text: 'END' }], 0x7000),
  'control-byte': () => writeBasic([{ number: 10, text: 'CLS' }, { number: 20, raw: [0x01, 0x41] }, { number: 30, text: 'END' }], 0x7000),
  'trailing-bytes': () => writeBasic([{ number: 10, text: 'CLS' }, { number: 20, text: 'END' }], 0x7000, { trailing: [0xaa, 0x55, 0x00] }),
};
