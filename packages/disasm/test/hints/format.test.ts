import { describe, expect, it } from 'vitest';
import { isValidName, parseHints, RESERVED, writeHints } from '../../src/hints/format.js';
import type { HintFile } from '../../src/hints/format.js';

const ok = (text: string): HintFile => {
  const r = parseHints(text);
  expect(r.errors).toEqual([]);
  return r.file;
};
const HEAD = 'fugloy-hints 1\nblock 0 length $10 hash 0123456789abcdef\n';

describe('parseHints', () => {
  it('parses the header, identities, and every directive', () => {
    const f = ok(
      `# comment\nfugloy-hints 1\nprogram sha256 ${'a'.repeat(64)}\nblock 0 length $4F49 hash 7f83b1657ff1fc53 # start $6300\nblock 1 length 2 hash 2c26b46b68ffc68f\n` +
        'block 0:$0000 entry\nblock 0:$0D12 table 16 2\nblock 0:$0D12 name DISPATCH\nblock 0:$1A00 bytes $40\nblock 0:$1A40 words 16\nblock 0:$1A60 string\nblock 0:$1A70 string 0xC\nblock 0:2000H code\nblock 0:$2000 code $10\nblock 0:$2000 comment main loop, entered from the table # not a comment\nblock 0:$3F00 nocode\n',
    );
    expect(f.version).toBe(1);
    expect(f.program).toBe('a'.repeat(64));
    expect(f.blocks).toEqual([{ index: 0, length: 0x4f49, hash: '7f83b1657ff1fc53', start: 0x6300 }, { index: 1, length: 2, hash: '2c26b46b68ffc68f' }]);
    expect(f.hints.map(({ line: _line, ...h }) => h)).toEqual([
      { block: 0, offset: 0, directive: 'entry' },
      { block: 0, offset: 0xd12, directive: 'table', count: 16, width: 2 },
      { block: 0, offset: 0xd12, directive: 'name', name: 'DISPATCH' },
      { block: 0, offset: 0x1a00, directive: 'bytes', length: 0x40 },
      { block: 0, offset: 0x1a40, directive: 'words', length: 16 },
      { block: 0, offset: 0x1a60, directive: 'string' },
      { block: 0, offset: 0x1a70, directive: 'string', length: 12 },
      { block: 0, offset: 0x2000, directive: 'code' },
      { block: 0, offset: 0x2000, directive: 'code', length: 16 },
      { block: 0, offset: 0x2000, directive: 'comment', text: 'main loop, entered from the table # not a comment' },
      { block: 0, offset: 0x3f00, directive: 'nocode' },
    ]);
    expect(f.hints[1]!.line).toBe(7);
  });

  it.each([
    ['fugloy-hints 2\n', 1, 'unsupported hint file version'],
    ['block 0 length 1 hash 00\n', 1, 'expected "fugloy-hints 1" first'],
    ['fugloy-hints 1\nblock 0:$0 entry\n', 2, 'block 0 is not declared'],
    [`${HEAD}block 0:$10 entry\n`, 3, 'offset $0010 is past the end of block 0 (length $0010)'],
    [`${HEAD}block 0:$1 frob\n`, 3, 'unknown directive "frob"'],
    [`${HEAD}block 0:1A entry\n`, 3, 'bad number "1A"'],
    [`${HEAD}block 0:$1 name org\n`, 3, 'name "org" is reserved'],
    [`${HEAD}block 0:$1 name Call\n`, 3, 'name "Call" is reserved'],
    [`${HEAD}block 0:$1 name L6000\n`, 3, 'name "L6000" has the shape of a generated label'],
    [`${HEAD}block 0:$1 name 9lives\n`, 3, 'name "9lives" is not an identifier'],
    [`${HEAD}block 0:$1 name A_OK\nblock 0:$1 name B_OK\n`, 4, 'address 0:$0001 already has a name'],
    [`${HEAD}block 0:$1 bytes\n`, 3, 'bytes needs a length'],
    [`${HEAD}block 0:$1 table 4 1\n`, 3, 'table width 1 is not supported'],
    [`${HEAD}block 0:$1 table 4\n`, 3, 'table needs a count and a width'],
    [`${HEAD}block 0 length $10 hash 0123456789abcdef\n`, 3, 'block 0 is already declared'],
    [`${HEAD}bogus line\n`, 3, 'unexpected line'],
    [`${HEAD}block 0:$1 name\n`, 3, 'name needs an identifier'],
    [`${HEAD}block 0:$1 name FOO\nblock 0:$2 name FOO\n`, 4, 'name "FOO" is already used at 0:$0001'],
    [`${HEAD}block 0:$1 name Main\nblock 0:$2 name MAIN\n`, 4, 'name "MAIN" is already used at 0:$0001'],
    [`${HEAD}block 0:$1 name T\n`, 3, 'name "T" is reserved'],
    [`${HEAD}block 0:$1 entry now\n`, 3, 'unexpected argument "now"'],
    [`${HEAD}block 0:$1 table 0 2\n`, 3, 'table needs a count of at least 1'],
    ['fugloy-hints 1\nprogram sha256 nothex\n', 2, 'bad program hash'],
  ])('reports %j at line %i: %s', (text, line, message) => {
    const r = parseHints(text);
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([[line, message]]);
  });

  it('allows a trailing # comment on any directive line', () => {
    const f = ok(`${HEAD}block 0:$2 code # forced\nblock 0:$3 bytes 2 # two\nblock 0:$4 comment keep # this\n`);
    expect(f.hints.map(({ line: _line, ...h }) => h)).toEqual([
      { block: 0, offset: 2, directive: 'code' },
      { block: 0, offset: 3, directive: 'bytes', length: 2 },
      { block: 0, offset: 4, directive: 'comment', text: 'keep # this' },
    ]);
  });

  it('collects every error in a file rather than stopping at the first', () => {
    const r = parseHints(`${HEAD}block 0:$1 frob\nblock 0:$2 bytes\n`);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
  });
});

describe('writeHints', () => {
  const file: HintFile = {
    version: 1,
    program: 'b'.repeat(64),
    blocks: [{ index: 0, length: 0x4f49, hash: '7f83b1657ff1fc53', start: 0x6300 }, { index: 1, length: 2, hash: '2c26b46b68ffc68f' }],
    hints: [
      { block: 0, offset: 0, directive: 'entry', line: 0 },
      { block: 0, offset: 0xd12, directive: 'table', count: 16, width: 2, line: 0 },
      { block: 0, offset: 0xd12, directive: 'name', name: 'DISPATCH', line: 0 },
      { block: 0, offset: 0x1a00, directive: 'bytes', length: 0x40, line: 0 },
      { block: 0, offset: 0x1a40, directive: 'words', length: 16, line: 0 },
      { block: 0, offset: 0x1a60, directive: 'string', line: 0 },
      { block: 0, offset: 0x1a70, directive: 'string', length: 12, line: 0 },
      { block: 0, offset: 0x2000, directive: 'code', line: 0 },
      { block: 0, offset: 0x2000, directive: 'code', length: 16, line: 0 },
      { block: 0, offset: 0x2000, directive: 'comment', text: 'main loop', line: 0 },
      { block: 0, offset: 0x3f00, directive: 'nocode', line: 0 },
      { block: 1, offset: 0, directive: 'entry', line: 0 },
    ],
  };

  it('writes canonical text that parses back to the same file', () => {
    const text = writeHints(file);
    expect(text.split('\n').slice(0, 5)).toEqual([
      '# Fugløy hints. Numbers: $hex or decimal. Offsets are relative to a block.',
      'fugloy-hints 1',
      `program sha256 ${'b'.repeat(64)}`,
      'block 0 length $4F49 hash 7f83b1657ff1fc53    # start $6300',
      'block 1 length $0002 hash 2c26b46b68ffc68f',
    ]);
    expect(text).toContain('block 0:$0D12 table 16 2\nblock 0:$0D12 name DISPATCH\n');
    expect(text).toContain('block 0:$1A00 bytes $0040\n');
    expect(text).toContain('block 0:$2000 comment main loop\n');
    const back = parseHints(text);
    expect(back.errors).toEqual([]);
    const strip = (f: HintFile) => ({ ...f, hints: f.hints.map(({ line: _line, ...h }) => h) });
    expect(strip(back.file)).toEqual(strip(file));
    expect(writeHints(back.file)).toBe(text);
  });

  it('sorts hints by block and offset, keeping input order within an address', () => {
    const text = writeHints({ version: 1, blocks: file.blocks, hints: [file.hints[11]!, file.hints[2]!, file.hints[1]!] });
    const order = text.split('\n').filter((l) => l.includes(':$'));
    expect(order).toEqual(['block 0:$0D12 name DISPATCH', 'block 0:$0D12 table 16 2', 'block 1:$0000 entry']);
  });
});

describe('isValidName', () => {
  it('accepts identifiers and rejects reserved words, generated shapes, and non-identifiers', () => {
    expect(isValidName('MAIN_LOOP')).toBe(true);
    expect(isValidName('_x9')).toBe(true);
    expect(isValidName('SUB_12345')).toBe(true);
    expect(isValidName('ixh')).toBe(false);
    expect(isValidName('DEFB')).toBe(false);
    expect(isValidName('ld')).toBe(false);
    expect(isValidName('NZ')).toBe(false);
    expect(isValidName('SUB_1234')).toBe(false);
    expect(isValidName('data_ab12')).toBe(false);
    expect(isValidName('9lives')).toBe(false);
    expect(isValidName('a'.repeat(33))).toBe(false);
    expect(isValidName('')).toBe(false);
    expect(RESERVED.has('SLL')).toBe(true);
    expect(RESERVED.has('ORG')).toBe(true);
    for (const w of ['T', 'TILO', 'TIHI', 'OCF']) expect(RESERVED.has(w), w).toBe(true);
    expect(isValidName('tilo')).toBe(false);
  });
});

describe('the relocate directive', () => {
  it('parses an address and a length, and writes them back', () => {
    const f = ok(`${HEAD}block 0:$0000 relocate $5000 $000B\n`);
    expect(f.hints.map(({ line: _line, ...h }) => h)).toEqual([{ block: 0, offset: 0, directive: 'relocate', addr: 0x5000, length: 0x0b }]);
    expect(writeHints(f)).toContain('\nblock 0:$0000 relocate $5000 $000B\n');
  });

  it('reports a relocate missing a number, with a bad one, of length zero, or past $FFFF', () => {
    const messages = (line: string) => parseHints(`${HEAD}${line}\n`).errors.map((e) => e.message);
    expect(messages('block 0:$0000 relocate $5000')).toEqual(['relocate needs an address and a length']);
    expect(messages('block 0:$0000 relocate $5000 xyz')).toEqual(['bad number "xyz"']);
    expect(messages('block 0:$0000 relocate $5000 0')).toEqual(['relocate needs a length of at least 1']);
    expect(messages('block 0:$0000 relocate $FFF0 $20')).toEqual(['relocate destination $FFF0 plus 32 bytes runs past $FFFF']);
  });
});
