import { describe, expect, it } from 'vitest';
import { isCmd, loadCmd } from '../src/cmd.js';
import { CMD_FIXTURES, PROGRAM, pattern } from './fixtures.js';
import { CmdWriter } from './writers/cmd-writer.js';

const fx = (name: string) => loadCmd(CMD_FIXTURES[name]!());

describe('.CMD loader rules', () => {
  it('reads a 01 record whose length byte counts the two address bytes', () => {
    const bytes = CMD_FIXTURES['small-block']!();
    expect(Array.from(bytes)).toEqual([0x01, 0x03, 0x00, 0x60, 0xc9, 0x02, 0x02, 0x00, 0x60]);
    const m = fx('small-block');
    expect(m.format).toBe('cmd');
    expect(m.image.runs()).toEqual([{ start: 0x6000, end: 0x6000, length: 1 }]);
    expect(m.records[0]).toEqual({ type: 1, offset: 0, lengthByte: 3, addr: 0x6000, dataLength: 1, block: 0 });
  });

  it.each([
    ['len-wrap-254', 0, 254],
    ['len-wrap-255', 1, 255],
    ['len-wrap-256', 2, 256],
  ])('wraps the 01 length byte: %s has length byte %i and %i data bytes', (name, lengthByte, dataLength) => {
    const bytes = CMD_FIXTURES[name]!();
    expect(bytes[1]).toBe(lengthByte);
    const m = fx(name);
    expect(m.image.runs()).toEqual([{ start: 0x6000, end: 0x6000 + dataLength - 1, length: dataLength }]);
    expect(Array.from(m.image.bytes.subarray(0x6000, 0x6000 + dataLength))).toEqual(pattern(dataLength));
    expect(m.entry).toBe(0x6000);
    expect(m.warnings).toEqual([]);
  });

  it('joins consecutive records into one run', () => {
    const m = fx('multi-record');
    expect(m.image.blocks.map((b) => [b.start, b.length])).toEqual([[0x6000, 256], [0x6100, 256], [0x6200, 88]]);
    expect(m.image.runs()).toEqual([{ start: 0x6000, end: 0x6257, length: 600 }]);
    expect(m.image.overlaps).toEqual([]);
  });

  it('lets a later block patch an earlier one and logs both extents', () => {
    const m = fx('overlap');
    expect(m.image.blocks.length).toBe(2);
    expect(m.image.overlaps).toEqual([{ block: 1, earlier: 0, start: 0x7004, end: 0x7006 }]);
    expect(Array.from(m.image.bytes.subarray(0x7003, 0x7008))).toEqual([0x13, 0xc3, 0x00, 0x70, 0x17]);
    expect(m.image.runs()).toEqual([{ start: 0x7000, end: 0x700f, length: 16 }]);
  });

  it('accepts blocks out of address order and reports runs in address order', () => {
    const m = fx('out-of-order');
    expect(m.image.blocks.map((b) => b.start)).toEqual([0x8000, 0x7000]);
    expect(m.image.runs().map((r) => r.start)).toEqual([0x7000, 0x8000]);
    expect(m.entry).toBe(0x7000);
  });

  it('keeps non-contiguous blocks as separate runs', () => {
    const m = fx('non-contiguous');
    expect(m.image.runs()).toEqual([
      { start: 0x6000, end: 0x6005, length: 6 },
      { start: 0x7000, end: 0x7007, length: 8 },
    ]);
  });

  it('takes the transfer address from the 02 record and stops there', () => {
    const m = fx('trailing-bytes');
    expect(m.entry).toBe(0x5200);
    expect(m.entrySource).toBe('transfer');
    expect(m.endedBy).toBe('transfer');
    expect(m.records.find((r) => r.type === 2)).toEqual({ type: 2, offset: 10, addr: 0x5200 });
  });

  it('ignores bytes after the 02 record but counts them', () => {
    const m = fx('trailing-bytes');
    expect(m.trailing).toBe(10);
    expect(m.image.runs()).toEqual([{ start: 0x5200, end: 0x5205, length: 6 }]);
    expect(m.warnings).toEqual(['10 bytes after the transfer record ignored']);
  });

  it('falls back to the lowest loaded address when the 02 record is missing, and says so', () => {
    const m = fx('missing-02');
    expect(m.entry).toBe(0x5200);
    expect(m.entrySource).toBe('lowest');
    expect(m.endedBy).toBe('eof');
    expect(m.warnings).toEqual(['no transfer address record; using lowest loaded address $5200']);
    expect(m.trailing).toBe(0);
  });

  it('treats a 03 record as end of load with no entry point', () => {
    const m = fx('end-03');
    expect(m.entry).toBeNull();
    expect(m.entrySource).toBe('none');
    expect(m.endedBy).toBe('end');
    expect(m.records.at(-1)).toEqual({ type: 3, offset: 10 });
    expect(m.warnings).toEqual(['03 record: end of load with no transfer address; not directly executable']);
  });

  it('keeps the 05 module header name for the listing', () => {
    const m = fx('header-05');
    expect(m.name).toBe('ASYLUM');
    expect(m.records[0]).toEqual({ type: 5, offset: 0, name: 'ASYLUM' });
    expect(m.entry).toBe(0x5200);
  });

  it('escapes control and high bytes in header and copyright text so they cannot forge listing lines', () => {
    const bytes = new CmdWriter()
      .header([0x41, 0x0a, 0x1b, 0x5b, 0x33, 0x31, 0x6d, 0x80, 0x20, 0x20])
      .copyright([0x0d, 0x3b, 0x20, 0x66, 0x61, 0x6b, 0x65, 0x7f])
      .load(0x5200, PROGRAM)
      .transfer(0x5200)
      .bytes();
    const m = loadCmd(bytes);
    expect(m.name).toBe('A{0A}{1B}[31m{80}');
    expect(m.copyright).toBe('{0D}; fake{7F}');
  });

  it('keeps the 1F copyright text', () => {
    const m = fx('copyright-1f');
    expect(m.copyright).toBe('(C) 1981 MED SYSTEMS');
    expect(m.records[0]).toEqual({ type: 0x1f, offset: 0, text: '(C) 1981 MED SYSTEMS' });
  });

  it('skips and logs every PDS/ISAM/patch record type, including a 256-byte payload', () => {
    const m = fx('pds-records');
    const skipped = m.records.filter((r) => 'payloadLength' in r).map((r) => [r.type, (r as { payloadLength: number }).payloadLength]);
    expect(skipped).toEqual([[6, 8], [7, 3], [8, 13], [9, 1], [10, 2], [11, 1], [12, 256], [13, 1], [14, 1], [15, 5], [16, 7], [4, 1]]);
    expect(m.name).toBe('PDSMOD');
    expect(m.image.runs()).toEqual([{ start: 0x5200, end: 0x5205, length: 6 }]);
    expect(m.entry).toBe(0x5200);
    expect(m.warnings).toEqual([]);
  });

  it('stops at a truncated record with a warning and counts the remainder as trailing', () => {
    const m = fx('truncated');
    expect(m.image.runs()).toEqual([{ start: 0x5200, end: 0x5205, length: 6 }]);
    expect(m.endedBy).toBe('error');
    expect(m.trailing).toBe(7);
    expect(m.warnings).toEqual([
      'truncated 01 record at offset 10: needs 18 bytes, 5 remain',
      'no transfer address record; using lowest loaded address $5200',
    ]);
  });

  it('stops at an unknown record type with a warning', () => {
    const m = fx('unknown-type');
    expect(m.endedBy).toBe('error');
    expect(m.trailing).toBe(8);
    expect(m.warnings[0]).toBe('unknown record type $7F at offset 10; stopping');
    expect(m.entry).toBe(0x5200);
  });

  it('wraps a block that runs past $FFFF around to $0000', () => {
    const m = fx('wraps-ffff');
    expect(m.image.blocks[0]?.wrapped).toBe(true);
    expect(m.image.runs()).toEqual([
      { start: 0x0000, end: 0x0001, length: 2 },
      { start: 0xfffe, end: 0xffff, length: 2 },
    ]);
    expect(m.warnings).toEqual(['block at $FFFE (4 bytes) wraps past $FFFF']);
  });

  it('loads the program bytes exactly', () => {
    const m = fx('non-contiguous');
    expect(Array.from(m.image.bytes.subarray(0x6000, 0x6006))).toEqual(PROGRAM);
  });
});

describe('isCmd', () => {
  it('accepts every synthetic fixture, debris and all', () => {
    for (const [name, make] of Object.entries(CMD_FIXTURES)) expect(isCmd(make()), name).toBe(true);
  });

  it('rejects empty input, text, and a file that starts with an unknown type', () => {
    expect(isCmd(new Uint8Array())).toBe(false);
    expect(isCmd(Uint8Array.from('Hello, world', (c) => c.charCodeAt(0)))).toBe(false);
    expect(isCmd(Uint8Array.from([0xff, 0x01, 0x02]))).toBe(false);
    expect(isCmd(Uint8Array.from([0x00, 0x01, 0x02]))).toBe(false);
  });

  it('rejects a file whose first load record is cut short', () => {
    expect(isCmd(Uint8Array.from([0x01, 0x05, 0x00, 0x60, 0x01]))).toBe(false);
  });
});
