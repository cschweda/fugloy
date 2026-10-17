import { describe, expect, it } from 'vitest';
import { SELECTIONS, TABLE_IDS } from '../../src/symbols/types.js';
import { validateTables } from '../../src/symbols/validate.js';

type Raw = Record<string, unknown>;
type TableFile = { file: string; json: unknown };

const source = (id: string): Raw => ({ id, author: 'A. Author', title: `The ${id} manual`, publisher: 'A Publisher', year: '1980', locator: 'https://example.org/manual' });
const sources = { sources: ['m3-basic', 'paay', 'trsdos13', 'ldos51', 'soltoff'].map(source) };

const cite = (src = 'm3-basic', page = '12/12'): Raw[] => [{ source: src, page }];
/** A valid routine entry; `over` replaces fields, and `undefined` removes one. */
const entry = (over: Raw = {}): Raw => ({ addr: '0049', name: '$KBWAIT', kind: 'routine', purpose: 'wait for a key and return it in A', cite: cite(), ...over });
const port = (over: Raw = {}): Raw => entry({ addr: undefined, port: 'EC', kind: 'port', name: 'MODEPORT', coined: true, purpose: 'cassette and display mode', ...over });
const svc = (over: Raw = {}): Raw => entry({ addr: undefined, svc: 10, kind: 'svc', name: '@DSPLY', cite: cite('soltoff', '101'), ...over });
const file = (table: string, ...entries: Raw[]): TableFile => ({ file: `${table}.json`, json: { table, entries } });
const run = (...files: TableFile[]) => validateTables(files, sources);
const errorsOf = (table: string, over: Raw = {}): string[] => run(file(table, entry(over))).errors;

/** The seed set of the plan's Task 1: name, address, source, page. */
const SEED: Record<string, [string, string, string, string][]> = {
  'rom-model3': [
    ['$KBCHAR', '002B', 'm3-basic', '12/11'], ['$VDCHAR', '0033', 'm3-basic', '12/20'], ['$KBLINE', '0040', 'm3-basic', '12/12'],
    ['$KBWAIT', '0049', 'm3-basic', '12/12'], ['$DELAY', '0060', 'm3-basic', '12/10'],
  ],
  'dos-trsdos13': [
    ['$INIT', '4420', 'trsdos13', '78'], ['$OPEN', '4424', 'trsdos13', '79'], ['$READ', '4436', 'trsdos13', '80'],
    ['$WRITE', '4439', 'trsdos13', '80'], ['$CLOSE', '4428', 'trsdos13', '85'], ['$JP2DOS', '402D', 'trsdos13', '86'],
  ],
  'dos-ldos51-model1': [
    ['@EXIT', '402D', 'ldos51', '6-29'], ['@ABORT', '4030', 'ldos51', '6-29'], ['@CMD', '4400', 'ldos51', '6-30'],
    ['@ERROR', '4409', 'ldos51', '6-30'], ['@OPEN', '4424', 'ldos51', '6-30'], ['@CLOSE', '4428', 'ldos51', '6-30'],
    ['@READ', '4436', 'ldos51', '6-30'], ['@WRITE', '4439', 'ldos51', '6-30'], ['@DSPLY', '4467', 'ldos51', '6-31'],
  ],
};
const seedFiles = (): TableFile[] =>
  TABLE_IDS.map((id) => file(id, ...(SEED[id] ?? []).map(([name, addr, src, page]) => entry({ name, addr, cite: cite(src, page), purpose: `purpose of ${name}` }))));

describe('validateTables', () => {
  it('accepts the seed set with no errors', () => {
    const r = validateTables(seedFiles(), sources);
    expect(r.errors).toEqual([]);
    expect(Object.values(r.tables).flat()).toHaveLength(20);
    expect(r.tables['svc-lsdos6']).toEqual([]);
    expect(r.sources.map((s) => s.id)).toEqual(['m3-basic', 'paay', 'trsdos13', 'ldos51', 'soltoff']);
  });

  it('normalizes addr, port, and svc into key, and defaults length to 1 and coined to false', () => {
    const r = run(
      file('rom-model3', entry({ name: '$KBCHAR', addr: '002B', cite: cite('m3-basic', '12/11') })),
      file('hardware-model3', port()),
      file('svc-lsdos6', svc()),
    );
    expect(r.errors).toEqual([]);
    expect(r.tables['rom-model3']).toEqual([
      { table: 'rom-model3', kind: 'routine', key: 0x2b, name: '$KBCHAR', length: 1, purpose: 'wait for a key and return it in A', cite: [{ source: 'm3-basic', page: '12/11' }], coined: false },
    ]);
    expect(r.tables['hardware-model3'][0]).toMatchObject({ kind: 'port', key: 0xec, length: 1, coined: true });
    expect(r.tables['svc-lsdos6'][0]).toMatchObject({ kind: 'svc', key: 10, length: 1, coined: false });
  });

  it('keeps length, coined, and note when given, and no note otherwise', () => {
    const r = run(file('hardware-model3', entry({ name: 'VIDEO', coined: true, kind: 'region', addr: '3C00', length: 1024, note: 'shown as 64 by 16' }), entry({ name: 'KEYBOARD', coined: true, kind: 'region', addr: '3800', length: 256 })));
    expect(r.errors).toEqual([]);
    const [video, keyboard] = r.tables['hardware-model3'];
    expect(video).toMatchObject({ key: 0x3c00, length: 1024, coined: true, note: 'shown as 64 by 16' });
    expect(keyboard).toMatchObject({ key: 0x3800, length: 256 });
    expect(keyboard).not.toHaveProperty('note');
  });

  describe('table and key fields', () => {
    it('rejects a table id that is not one of the eight', () => {
      expect(run({ file: 'rom-model9.json', json: { table: 'rom-model9', entries: [] } }).errors).toEqual([
        `rom-model9.json: unknown table "rom-model9" (expected one of ${TABLE_IDS.join(', ')})`,
      ]);
    });

    it('rejects an addr that is not four uppercase hex digits: 4O2D, with a letter O', () => {
      const bad = { addr: '4O2D', name: 'X', kind: 'routine', purpose: 'p', cite: [{ source: 'm3-basic', page: '1' }] };
      expect(validateTables([{ file: 'rom-model3.json', json: { table: 'rom-model3', entries: [bad] } }], sources).errors).toEqual([
        'rom-model3.json entry 0 "X": addr "4O2D" is not four uppercase hex digits',
      ]);
      for (const addr of ['49', '00049', '004a', '0x49', 73]) {
        expect(errorsOf('rom-model3', { addr })).toEqual([`rom-model3.json entry 0 "$KBWAIT": addr ${typeof addr === 'string' ? `"${addr}"` : addr} is not four uppercase hex digits`]);
      }
    });

    it('rejects a port that is not two uppercase hex digits', () => {
      for (const p of ['E', 'EC0', 'ec', 'G1']) {
        expect(run(file('hardware-model3', port({ port: p }))).errors).toEqual([`hardware-model3.json entry 0 "MODEPORT": port "${p}" is not two uppercase hex digits`]);
      }
    });

    it('rejects an svc that is not an integer from 0 to 127', () => {
      for (const [n, shown] of [[128, '128'], [-1, '-1'], [1.5, '1.5'], ['10', '"10"']] as const) {
        expect(run(file('svc-lsdos6', svc({ svc: n }))).errors).toEqual([`svc-lsdos6.json entry 0 "@DSPLY": svc ${shown} is not an integer from 0 to 127`]);
      }
      expect(run(file('svc-lsdos6', svc({ svc: 0 }), svc({ name: '@KEY', svc: 127 }))).errors).toEqual([]);
    });

    it('requires exactly the key field the kind takes: addr for memory, port for ports, svc for service calls', () => {
      expect(errorsOf('rom-model3', { addr: undefined, port: 'EC' })).toEqual(['rom-model3.json entry 0 "$KBWAIT": kind "routine" is keyed by addr alone; the entry has port']);
      expect(errorsOf('rom-model3', { svc: 10 })).toEqual(['rom-model3.json entry 0 "$KBWAIT": kind "routine" is keyed by addr alone; the entry has addr and svc']);
      expect(errorsOf('rom-model3', { addr: undefined })).toEqual(['rom-model3.json entry 0 "$KBWAIT": kind "routine" is keyed by addr alone; the entry has no key']);
      expect(run(file('hardware-model3', port({ addr: '00EC' }))).errors).toEqual(['hardware-model3.json entry 0 "MODEPORT": kind "port" is keyed by port alone; the entry has addr and port']);
    });

    it('rejects a DOS-table address below $4000, and accepts $4000', () => {
      for (const table of ['dos-trsdos13', 'dos-ldos51-model1', 'dos-ldos51-model3']) {
        expect(errorsOf(table, { addr: '3C00' })).toEqual([`${table}.json entry 0 "$KBWAIT": addr 3C00 is below $4000 (DOS tables hold RAM-resident addresses only)`]);
        expect(errorsOf(table, { addr: '3FFF' })).toHaveLength(1);
        expect(errorsOf(table, { addr: '4000' })).toEqual([]);
      }
      expect(errorsOf('rom-model3', { addr: '0000' })).toEqual([]);
    });

    it('rejects a length that is not a positive integer or runs past $FFFF, and a length on a port or service call', () => {
      for (const [length, shown] of [[0, '0'], [1.5, '1.5'], [-4, '-4'], ['4', '"4"']] as const) {
        expect(errorsOf('rom-model3', { length })).toEqual([`rom-model3.json entry 0 "$KBWAIT": length ${shown} is not an integer of at least 1`]);
      }
      expect(errorsOf('rom-model3', { addr: 'FFFF', length: 2 })).toEqual(['rom-model3.json entry 0 "$KBWAIT": addr FFFF with length 2 runs past $FFFF']);
      expect(errorsOf('rom-model3', { addr: 'FFFF', length: 1 })).toEqual([]);
      expect(errorsOf('rom-model3', { addr: 'FF00', length: 256 })).toEqual([]);
      expect(run(file('hardware-model3', port({ length: 2 }))).errors).toEqual(['hardware-model3.json entry 0 "MODEPORT": a port entry takes no length']);
      expect(run(file('svc-lsdos6', svc({ length: 1 }))).errors).toEqual(['svc-lsdos6.json entry 0 "@DSPLY": a svc entry takes no length']);
    });
  });

  describe('kind', () => {
    it('rejects a kind that is not one of the six', () => {
      expect(errorsOf('rom-model3', { kind: 'frob' })).toEqual(['rom-model3.json entry 0 "$KBWAIT": kind "frob" is not one of routine, vector, variable, region, port, svc']);
    });

    it('allows port only in hardware tables, svc only in svc-lsdos6, and never region in DOS tables', () => {
      expect(run(file('rom-model3', port())).errors).toEqual(['rom-model3.json entry 0 "MODEPORT": kind "port" is not allowed in rom-model3 (allowed: routine, vector, variable, region)']);
      expect(run(file('hardware-model3', svc())).errors).toEqual(['hardware-model3.json entry 0 "@DSPLY": kind "svc" is not allowed in hardware-model3 (allowed: routine, vector, variable, region, port)']);
      expect(run(file('dos-trsdos13', entry({ kind: 'region', addr: '4400', name: '$BUF', length: 256 }))).errors).toEqual([
        'dos-trsdos13.json entry 0 "$BUF": kind "region" is not allowed in dos-trsdos13 (allowed: routine, vector, variable)',
      ]);
      expect(run(file('svc-lsdos6', entry())).errors).toEqual(['svc-lsdos6.json entry 0 "$KBWAIT": kind "routine" is not allowed in svc-lsdos6 (allowed: svc)']);
      expect(run(file('hardware-model1', port()), file('hardware-model3', port()), file('svc-lsdos6', svc())).errors).toEqual([]);
      expect(run(file('dos-ldos51-model3', entry({ addr: '4400' }), entry({ kind: 'variable', addr: '4410', name: '$CURSOR' }), entry({ kind: 'vector', addr: '4420', name: '$HOOK', length: 3 }))).errors).toEqual([]);
    });
  });

  describe('cite', () => {
    it('requires a non-empty cite', () => {
      const rule = 'cite is missing or empty (every entry cites a source and page)';
      expect(errorsOf('rom-model3', { cite: [] })).toEqual([`rom-model3.json entry 0 "$KBWAIT": ${rule}`]);
      expect(errorsOf('rom-model3', { cite: undefined })).toEqual([`rom-model3.json entry 0 "$KBWAIT": ${rule}`]);
    });

    it('requires every cite to name a known source and a non-empty page', () => {
      expect(errorsOf('rom-model3', { cite: cite('nope', '1') })).toEqual(['rom-model3.json entry 0 "$KBWAIT": cite 0 names unknown source "nope"']);
      expect(errorsOf('rom-model3', { cite: cite('m3-basic', '') })).toEqual(['rom-model3.json entry 0 "$KBWAIT": cite 0 has no page']);
      expect(errorsOf('rom-model3', { cite: [{ source: 'm3-basic', page: '1' }, { source: 'paay' }] })).toEqual(['rom-model3.json entry 0 "$KBWAIT": cite 1 has no page']);
      expect(errorsOf('rom-model3', { cite: [{ page: '1' }] })).toEqual(['rom-model3.json entry 0 "$KBWAIT": cite 0 has no source']);
      expect(errorsOf('rom-model3', { cite: ['m3-basic 12/12'] })).toEqual(['rom-model3.json entry 0 "$KBWAIT": cite 0 is not { "source", "page" }']);
      expect(errorsOf('rom-model3', { cite: [{ source: 'm3-basic', page: '1', pge: '2' }] })).toEqual(['rom-model3.json entry 0 "$KBWAIT": cite 0 has unknown field "pge"']);
      expect(errorsOf('rom-model3', { cite: [{ source: 'm3-basic', page: '12/12' }, { source: 'paay', page: '2' }] })).toEqual([]);
    });
  });

  describe('name', () => {
    it.each([
      ['a coined name starting with $', { name: '$FOO', coined: true }, 'coined name "$FOO" may not start with $ or @ (those mark names a source prints)'],
      ['a coined name starting with @', { name: '@FOO', coined: true }, 'coined name "@FOO" may not start with $ or @ (those mark names a source prints)'],
      ['a coined name of 13 characters', { name: 'ABCDEFGHIJKLM', coined: true }, 'coined name "ABCDEFGHIJKLM" is longer than 12 characters'],
      ['a coined name in lower case', { name: 'foo', coined: true }, 'coined name "foo" must be capitals, digits, and _, starting with a letter'],
      ['an uncoined name in lower case', { name: 'kbwait' }, 'name "kbwait" must be capitals, digits, and _, starting with a letter, after an optional $ or @'],
      ['a name starting with a digit', { name: '1ABC' }, 'name "1ABC" must be capitals, digits, and _, starting with a letter, after an optional $ or @'],
      ['a name starting with an underscore', { name: '_ABC' }, 'name "_ABC" must be capitals, digits, and _, starting with a letter, after an optional $ or @'],
      ['a prefix followed by a digit', { name: '$1ABC' }, 'name "$1ABC" must be capitals, digits, and _, starting with a letter, after an optional $ or @'],
      ['a prefix alone', { name: '@' }, 'name "@" must be capitals, digits, and _, starting with a letter, after an optional $ or @'],
      ['two prefixes', { name: '$@ABC' }, 'name "$@ABC" must be capitals, digits, and _, starting with a letter, after an optional $ or @'],
      ['a mnemonic', { name: 'LD', coined: true }, 'name "LD" is reserved (a mnemonic, register, condition, or zmac word)'],
      ['a register', { name: 'HL' }, 'name "HL" is reserved (a mnemonic, register, condition, or zmac word)'],
      ['a condition', { name: 'NZ' }, 'name "NZ" is reserved (a mnemonic, register, condition, or zmac word)'],
      ['a zmac directive', { name: 'ORG' }, 'name "ORG" is reserved (a mnemonic, register, condition, or zmac word)'],
      ['a synthesized label shape L', { name: 'L5210', coined: true }, 'name "L5210" has the shape of a generated label'],
      ['a synthesized label shape SUB_', { name: 'SUB_5340' }, 'name "SUB_5340" has the shape of a generated label'],
      ['a synthesized label shape DATA_', { name: 'DATA_6020' }, 'name "DATA_6020" has the shape of a generated label'],
      ['a synthesized label shape TBL_', { name: 'TBL_6010' }, 'name "TBL_6010" has the shape of a generated label'],
    ])('rejects %s', (_what, over, rule) => {
      expect(errorsOf('rom-model3', over)).toEqual([`rom-model3.json entry 0 "${over.name}": ${rule}`]);
    });

    it('accepts a source spelling with $ or @, a plain name, and a coined name of up to 12 characters', () => {
      for (const over of [{ name: '$KBWAIT' }, { name: '@EXIT' }, { name: 'KBWAIT' }, { name: '$A' }, { name: '@HIGH_2' }, { name: '$L5210' }, { name: 'ABCDEFGHIJKL', coined: true }, { name: 'VIDEO', coined: true }]) {
        expect(errorsOf('rom-model3', over)).toEqual([]);
      }
    });

    it('rejects a missing name', () => {
      expect(errorsOf('rom-model3', { name: undefined })).toEqual(['rom-model3.json entry 0: name is missing or empty']);
      expect(errorsOf('rom-model3', { name: '' })).toEqual(['rom-model3.json entry 0: name is missing or empty']);
    });
  });

  describe('uniqueness within a machine and DOS selection', () => {
    const dup = (here: string, there: string): string => `${here}: name is already used by ${there} (names are unique ignoring case within one machine and DOS selection)`;

    it('rejects kbwait beside KBWAIT in tables of one selection, ignoring case', () => {
      const r = run(file('rom-model3', entry({ name: 'KBWAIT' })), file('hardware-model3', entry({ name: 'kbwait', addr: '3800' })));
      expect(r.errors).toContain(dup('hardware-model3.json entry 0 "kbwait"', 'rom-model3.json entry 0 "KBWAIT"'));
    });

    it('rejects the same name twice, in one table or across the tables of a selection', () => {
      expect(run(file('rom-model3', entry({ name: 'KBWAIT' }), entry({ name: 'KBWAIT', addr: '004A' }))).errors).toEqual([dup('rom-model3.json entry 1 "KBWAIT"', 'rom-model3.json entry 0 "KBWAIT"')]);
      expect(run(file('rom-model3', entry({ name: 'ERRMSG' })), file('dos-ldos51-model3', entry({ name: 'ERRMSG', addr: '4409' }))).errors).toEqual([
        dup('dos-ldos51-model3.json entry 0 "ERRMSG"', 'rom-model3.json entry 0 "ERRMSG"'),
      ]);
    });

    it('checks a port name against memory names, since both become EQUs', () => {
      expect(run(file('rom-model3', entry({ name: 'MODEPORT' })), file('hardware-model3', port())).errors).toEqual([dup('hardware-model3.json entry 0 "MODEPORT"', 'rom-model3.json entry 0 "MODEPORT"')]);
    });

    it('lets tables that are never in one selection share names and addresses', () => {
      expect(run(
        file('rom-model1', entry()),
        file('rom-model3', entry()),
        file('dos-trsdos13', entry({ name: '$JP2DOS', addr: '402D', cite: cite('trsdos13', '86') })),
        file('dos-ldos51-model1', entry({ name: '@EXIT', addr: '402D', cite: cite('ldos51', '6-29') })),
        file('dos-ldos51-model3', entry({ name: '$JP2DOS', addr: '402D', cite: cite('ldos51', '6-33') })),
      ).errors).toEqual([]);
    });
  });

  describe('overlap within a machine and DOS selection', () => {
    const covered = (here: string, addr: string, there: string): string => `${here}: address $${addr} is already covered by ${there} (memory entries in one selection may not overlap)`;

    it('rejects two memory entries at one address', () => {
      expect(run(file('rom-model3', entry({ name: 'ONE' }), entry({ name: 'TWO' }))).errors).toEqual([covered('rom-model3.json entry 1 "TWO"', '0049', 'rom-model3.json entry 0 "ONE"')]);
    });

    it('rejects a region that covers another table\'s entry in the same selection, at the first shared address', () => {
      const video = entry({ name: 'VIDEO', coined: true, kind: 'region', addr: '3C00', length: 1024 });
      expect(run(file('rom-model3', entry({ name: 'DRAW', addr: '3D40' })), file('hardware-model3', video)).errors).toEqual([
        covered('hardware-model3.json entry 0 "VIDEO"', '3D40', 'rom-model3.json entry 0 "DRAW"'),
      ]);
      expect(run(file('hardware-model3', entry({ name: 'WORDS', coined: true, kind: 'variable', addr: '3BFF', length: 2 }), video)).errors).toEqual([
        covered('hardware-model3.json entry 1 "VIDEO"', '3C00', 'hardware-model3.json entry 0 "WORDS"'),
      ]);
    });

    it('treats entries that touch as separate: $4000 is not inside a 1024-byte region at $3C00', () => {
      const video = entry({ name: 'VIDEO', coined: true, kind: 'region', addr: '3C00', length: 1024 });
      expect(run(file('hardware-model3', video), file('rom-model3', entry({ name: 'BELOW', addr: '3BFF' }), entry({ name: 'ABOVE', addr: '4000' }))).errors).toEqual([]);
    });

    it('keeps ports and service calls out of the memory check', () => {
      expect(run(file('rom-model3', entry({ name: 'ATEC', addr: '00EC' })), file('hardware-model3', port())).errors).toEqual([]);
    });

    it('reports one error per pair, even when a table is in several selections', () => {
      expect(run(file('rom-model3', entry({ name: 'ONE' }), entry({ name: 'TWO' }))).errors).toHaveLength(1);
    });
  });

  describe('shape', () => {
    it('rejects an unknown field in an entry', () => {
      expect(errorsOf('rom-model3', { lenght: 1024 })).toEqual(['rom-model3.json entry 0 "$KBWAIT": unknown field "lenght"']);
    });

    it('rejects a purpose, coined, or note of the wrong shape, and an entry that is not an object', () => {
      expect(errorsOf('rom-model3', { purpose: '' })).toEqual(['rom-model3.json entry 0 "$KBWAIT": purpose is missing or empty']);
      expect(errorsOf('rom-model3', { coined: 'yes' })).toEqual(['rom-model3.json entry 0 "$KBWAIT": coined must be true or false']);
      expect(errorsOf('rom-model3', { note: '' })).toEqual(['rom-model3.json entry 0 "$KBWAIT": note must be non-empty text']);
      expect(run({ file: 'rom-model3.json', json: { table: 'rom-model3', entries: [5] } }).errors).toEqual(['rom-model3.json entry 0: not an object']);
    });

    // A purpose, note, or page is printed into a zmac EQU line and a listing comment; a line break would end that line early and break the round trip.
    it.each([
      ['a line feed', '\n'],
      ['a carriage return', '\r'],
      ['a carriage return and line feed', '\r\n'],
    ])('rejects %s in a purpose, a note, or a cite page', (_what, lineBreak) => {
      const name = '"$KBWAIT"';
      expect(errorsOf('rom-model3', { purpose: `wait for a key${lineBreak}and return it in A` })).toEqual([`rom-model3.json entry 0 ${name}: purpose may not contain a line break`]);
      expect(errorsOf('rom-model3', { purpose: `wait for a key${lineBreak}` })).toEqual([`rom-model3.json entry 0 ${name}: purpose may not contain a line break`]);
      expect(errorsOf('rom-model3', { note: `Model III renamed it${lineBreak}in 1980` })).toEqual([`rom-model3.json entry 0 ${name}: note may not contain a line break`]);
      expect(errorsOf('rom-model3', { cite: cite('m3-basic', `12/${lineBreak}12`) })).toEqual([`rom-model3.json entry 0 ${name}: cite 0 page may not contain a line break`]);
      expect(errorsOf('rom-model3', { cite: [{ source: 'm3-basic', page: '12/12' }, { source: 'paay', page: `5${lineBreak}` }] })).toEqual([`rom-model3.json entry 0 ${name}: cite 1 page may not contain a line break`]);
    });

    it('accepts a purpose, note, and cite page on one line, with other punctuation and spaces', () => {
      expect(errorsOf('rom-model3', { purpose: 'wait for a key (A = key); tab or space', note: 'Model III: "renamed", it\'s 1980', cite: cite('m3-basic', '12/12 and 12/13') })).toEqual([]);
    });

    it('rejects a file that is not { table, entries }', () => {
      expect(run({ file: 'rom-model3.json', json: [] }).errors).toEqual(['rom-model3.json: expected an object with "table" and "entries"']);
      expect(run({ file: 'rom-model3.json', json: { table: 'rom-model3', entries: {} } }).errors).toEqual(['rom-model3.json: entries is not an array']);
      expect(run({ file: 'rom-model3.json', json: { table: 'rom-model3', entries: [], extra: 1 } }).errors).toEqual(['rom-model3.json: unknown field "extra"']);
    });

    it('names the file and entry index of a later bad entry', () => {
      expect(run(file('rom-model3', entry(), entry({ name: '$KBCHAR', addr: '002B' }), entry({ name: '$VDCHAR', addr: '3O33' }))).errors).toEqual([
        'rom-model3.json entry 2 "$VDCHAR": addr "3O33" is not four uppercase hex digits',
      ]);
    });
  });

  describe('sources', () => {
    const check = (json: unknown) => validateTables([], json);

    it('returns the registry, keeping edition only when given', () => {
      const r = check({ sources: [{ ...source('paay'), edition: '2nd' }, source('decker')] });
      expect(r.errors).toEqual([]);
      expect(r.sources).toEqual([{ ...source('paay'), edition: '2nd' }, source('decker')]);
      expect(r.sources[1]).not.toHaveProperty('edition');
    });

    it('rejects a registry that is not { sources: [...] }', () => {
      expect(check(5).errors).toEqual(['sources.json: expected an object with a "sources" array']);
      expect(check({ sources: {} }).errors).toEqual(['sources.json: expected an object with a "sources" array']);
      expect(check({ sources: [], extra: 1 }).errors).toEqual(['sources.json: unknown field "extra"']);
    });

    it('rejects a source with a missing field, an unknown field, a repeated id, or no object', () => {
      expect(check({ sources: [{ ...source('paay'), title: '' }] }).errors).toEqual(['sources.json entry 0 "paay": title is missing or empty']);
      expect(check({ sources: [{ ...source('paay'), edition: '' }] }).errors).toEqual(['sources.json entry 0 "paay": edition must be non-empty text']);
      expect(check({ sources: [{ ...source('paay'), isbn: '1' }] }).errors).toEqual(['sources.json entry 0 "paay": unknown field "isbn"']);
      expect(check({ sources: [source('paay'), source('paay')] }).errors).toEqual(['sources.json entry 1 "paay": id is already used by entry 0']);
      expect(check({ sources: [{ ...source('x'), id: undefined }] }).errors).toEqual(['sources.json entry 0: id is missing or empty']);
      expect(check({ sources: ['paay'] }).errors).toEqual(['sources.json entry 0: not an object']);
    });
  });
});

describe('SELECTIONS', () => {
  it('lists the six valid machine and DOS pairs with their tables', () => {
    expect(SELECTIONS.map((s) => [s.machine, s.dos, [...s.tables]])).toEqual([
      [1, 'ldos', ['rom-model1', 'hardware-model1', 'dos-ldos51-model1']],
      [1, 'none', ['rom-model1', 'hardware-model1']],
      [3, 'trsdos', ['rom-model3', 'hardware-model3', 'dos-trsdos13']],
      [3, 'ldos', ['rom-model3', 'hardware-model3', 'dos-ldos51-model3']],
      [3, 'none', ['rom-model3', 'hardware-model3']],
      [4, 'none', ['svc-lsdos6']],
    ]);
  });

  it('covers every table, so every table is checked against its neighbours', () => {
    expect([...new Set(SELECTIONS.flatMap((s) => s.tables))].sort()).toEqual([...TABLE_IDS].sort());
  });
});
