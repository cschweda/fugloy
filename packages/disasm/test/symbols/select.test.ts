/** Choosing the tables for a machine and DOS (design spec §4.4), and the lookups over them (§5.1). */
import { describe, expect, it } from 'vitest';
import * as disasm from '../../src/index.js';
import type { Dos, Machine, RomClass, RomComparison, Source, SymbolSelection, TableEntry, TableId } from '../../src/index.js';
import { defaultDos, describeSelection, SelectionError, selectSymbols, SymbolSet, tablesFor } from '../../src/symbols/select.js';
import { SOURCES, TABLES } from '../../src/symbols/tables.generated.js';
import { SELECTIONS, TABLE_IDS } from '../../src/symbols/types.js';
import { entry, NO_TABLES, tablesOf } from './helpers.js';
import type { Tables } from './helpers.js';

const MACHINES: readonly Machine[] = [1, 3, 4];
const DOSES: readonly Dos[] = ['trsdos', 'ldos', 'none'];
const PAIRS: SymbolSelection[] = MACHINES.flatMap((machine) => DOSES.map((dos) => ({ machine, dos })));
const MODEL_III: SymbolSelection = { machine: 3, dos: 'none' };

/** What a call throws, so a test can look at the error itself. */
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('tablesFor', () => {
  it.each([
    [{ machine: 1, dos: 'ldos' }, ['rom-model1', 'hardware-model1', 'dos-ldos51-model1']],
    [{ machine: 1, dos: 'none' }, ['rom-model1', 'hardware-model1']],
    [{ machine: 3, dos: 'trsdos' }, ['rom-model3', 'hardware-model3', 'dos-trsdos13']],
    [{ machine: 3, dos: 'ldos' }, ['rom-model3', 'hardware-model3', 'dos-ldos51-model3']],
    [{ machine: 3, dos: 'none' }, ['rom-model3', 'hardware-model3']],
    [{ machine: 4, dos: 'none' }, ['svc-lsdos6']],
  ] as [SymbolSelection, TableId[]][])('names the tables of %j: ROM, then hardware, then DOS', (sel, ids) => {
    expect(tablesFor(sel)).toEqual(ids);
  });

  it('rejects exactly the three pairs no tables are defined for', () => {
    const rejected = PAIRS.filter((pair) => thrown(() => tablesFor(pair)) instanceof SelectionError);
    expect(rejected).toEqual([
      { machine: 1, dos: 'trsdos' },
      { machine: 4, dos: 'trsdos' },
      { machine: 4, dos: 'ldos' },
    ]);
  });

  it('says what was asked for and lists every valid pair', () => {
    const error = thrown(() => tablesFor({ machine: 1, dos: 'trsdos' }));
    expect(error).toBeInstanceOf(SelectionError);
    expect(error).toBeInstanceOf(Error);
    expect((error as SelectionError).name).toBe('SelectionError');
    expect((error as SelectionError).message).toBe(
      'machine 1 with DOS trsdos has no symbol tables; the valid pairs are machine 1 with ldos or none; machine 3 with trsdos, ldos, or none; machine 4 with none',
    );
  });

  it('rejects a machine or a DOS that is no known value at all, with the same message', () => {
    const noMachine = thrown(() => tablesFor({ machine: 2 as Machine, dos: 'none' }));
    const noDos = thrown(() => tablesFor({ machine: 3, dos: 'cpm' as Dos }));
    expect(noMachine).toBeInstanceOf(SelectionError);
    expect((noMachine as SelectionError).message).toMatch(/^machine 2 with DOS none has no symbol tables; the valid pairs are machine 1 with ldos or none;/);
    expect(noDos).toBeInstanceOf(SelectionError);
    expect((noDos as SelectionError).message).toMatch(/^machine 3 with DOS cpm has no symbol tables; the valid pairs are /);
  });

  it('returns a new list each time, so a caller cannot reorder the tables a pair uses', () => {
    tablesFor(MODEL_III).reverse();
    expect(tablesFor(MODEL_III)).toEqual(['rom-model3', 'hardware-model3']);
  });
});

describe('defaultDos', () => {
  it('is TRSDOS on a Model III, LDOS on a Model I, and none on a Model 4', () => {
    expect(defaultDos(3)).toBe('trsdos');
    expect(defaultDos(1)).toBe('ldos');
    expect(defaultDos(4)).toBe('none');
  });

  it('always makes a valid selection', () => {
    for (const machine of MACHINES) expect(() => tablesFor({ machine, dos: defaultDos(machine) }), `machine ${machine}`).not.toThrow();
  });
});

describe('describeSelection', () => {
  it.each([
    [{ machine: 3, dos: 'trsdos' }, 'Model III ROM, hardware, TRSDOS 1.3'],
    [{ machine: 1, dos: 'ldos' }, 'Model I ROM, hardware, LDOS 5.1'],
    [{ machine: 3, dos: 'ldos' }, 'Model III ROM, hardware, LDOS 5.1'],
    [{ machine: 1, dos: 'none' }, 'Model I ROM, hardware, no DOS'],
    [{ machine: 3, dos: 'none' }, 'Model III ROM, hardware, no DOS'],
    [{ machine: 4, dos: 'none' }, 'Model 4 service calls (LS-DOS 6)'],
  ] as [SymbolSelection, string][])('describes %j', (sel, text) => {
    expect(describeSelection(sel)).toBe(text);
  });

  it('will not describe a pair no tables are defined for', () => {
    expect(thrown(() => describeSelection({ machine: 1, dos: 'trsdos' }))).toBeInstanceOf(SelectionError);
    expect(thrown(() => describeSelection({ machine: 4, dos: 'ldos' }))).toBeInstanceOf(SelectionError);
  });
});

describe('selectSymbols', () => {
  /** One entry in every table. */
  const sample = (id: TableId): TableEntry => entry(id, id === 'svc-lsdos6' ? 'svc' : 'routine', TABLE_IDS.indexOf(id), id);
  const oneEach = tablesOf(Object.fromEntries(TABLE_IDS.map((id) => [id, [sample(id)]])));

  it('draws on exactly the tables its pair names, in table order', () => {
    for (const row of SELECTIONS) {
      const drawnOn = selectSymbols(row, oneEach, {}).entries().map((e) => e.table);
      expect(drawnOn, `machine ${row.machine}, ${row.dos}`).toEqual(row.tables);
    }
  });

  it('names the same address differently under another machine, and takes the chosen DOS rather than merging them', () => {
    const tables = tablesOf({
      'rom-model1': [entry('rom-model1', 'routine', 0x0049, '$KEY')],
      'rom-model3': [entry('rom-model3', 'routine', 0x0049, '$KBWAIT')],
      'dos-trsdos13': [entry('dos-trsdos13', 'routine', 0x402d, '$JP2DOS')],
      'dos-ldos51-model3': [entry('dos-ldos51-model3', 'routine', 0x402d, '@EXIT')],
    });
    const name = (sel: SymbolSelection, addr: number): string | undefined => selectSymbols(sel, tables, {}).code(addr)?.name;
    expect(name({ machine: 1, dos: 'none' }, 0x0049)).toBe('$KEY');
    expect(name({ machine: 3, dos: 'none' }, 0x0049)).toBe('$KBWAIT');
    expect(name({ machine: 3, dos: 'trsdos' }, 0x402d)).toBe('$JP2DOS');
    expect(name({ machine: 3, dos: 'ldos' }, 0x402d)).toBe('@EXIT');
    expect(name({ machine: 3, dos: 'none' }, 0x402d)).toBeUndefined();
    expect(name({ machine: 4, dos: 'none' }, 0x0049)).toBeUndefined();
  });

  it('refuses a pair no tables are defined for', () => {
    expect(thrown(() => selectSymbols({ machine: 1, dos: 'trsdos' }, NO_TABLES, {}))).toBeInstanceOf(SelectionError);
    expect(thrown(() => selectSymbols({ machine: 4, dos: 'ldos' }))).toBeInstanceOf(SelectionError);
  });

  it('keeps the selection it was built for, whatever the caller does to its object afterwards', () => {
    const sel: SymbolSelection = { machine: 3, dos: 'ldos' };
    const set = selectSymbols(sel, NO_TABLES, {});
    sel.dos = 'none';
    expect(set.selection).toEqual({ machine: 3, dos: 'ldos' });
  });

  it('uses the generated tables unless given others', () => {
    const three = selectSymbols({ machine: 3, dos: 'trsdos' });
    expect(three.code(0x0049)).toMatchObject({ table: 'rom-model3', name: '$KBWAIT', kind: 'routine' });
    expect(three.code(0x402d)).toMatchObject({ table: 'dos-trsdos13', name: '$JP2DOS' });
    expect(selectSymbols({ machine: 1, dos: 'ldos' }).code(0x402d)).toMatchObject({ table: 'dos-ldos51-model1', name: '@EXIT' });
  });
});

describe('SymbolSet lookups', () => {
  const kbwait = entry('rom-model3', 'routine', 0x0049, '$KBWAIT');
  const delay = entry('rom-model3', 'routine', 0x0060, '$DELAY', { length: 8 });
  const cursor = entry('rom-model3', 'variable', 0x4020, 'CURSOR', { length: 2 });
  const usrvec = entry('rom-model3', 'vector', 0x408e, 'USRVEC', { length: 2 });
  const keyboard = entry('hardware-model3', 'region', 0x3800, 'KEYBOARD', { length: 1024, coined: true });
  const video = entry('hardware-model3', 'region', 0x3c00, 'VIDEO', { length: 1024, coined: true });
  const modeport = entry('hardware-model3', 'port', 0xec, 'MODEPORT', { coined: true });
  // Listed out of address order on purpose: the lookups may not depend on it.
  const listed = tablesOf({ 'rom-model3': [kbwait, cursor, usrvec, delay], 'hardware-model3': [video, modeport, keyboard] });
  const set = selectSymbols(MODEL_III, listed, {});
  /** The name and offset `data` finds, or undefined. */
  const at = (s: SymbolSet, addr: number): [string, number] | undefined => {
    const found = s.data(addr);
    return found === undefined ? undefined : [found.entry.name, found.offset];
  };

  describe('code', () => {
    it('finds a routine at exactly its address', () => {
      expect(set.code(0x0049)).toBe(kbwait);
      expect(set.code(0x004a)).toBeUndefined();
      expect(set.code(0x0048)).toBeUndefined();
    });

    it('does not find a routine from inside its span', () => {
      expect(set.code(0x0060)).toBe(delay);
      expect(set.code(0x0061)).toBeUndefined();
    });

    it('finds a vector at its first byte only', () => {
      expect(set.code(0x408e)).toBe(usrvec);
      expect(set.code(0x408f)).toBeUndefined();
    });

    it('never offers a variable, a region, or a port', () => {
      expect(set.code(0x4020)).toBeUndefined();
      expect(set.code(0x3c00)).toBeUndefined();
      expect(set.code(0x3800)).toBeUndefined();
      expect(set.code(0x00ec)).toBeUndefined();
    });
  });

  describe('data', () => {
    it('gives the offset into a region', () => {
      expect(set.data(0x3c00 + 0x140)).toEqual({ entry: video, offset: 0x140 });
      expect(at(set, 0x3c00)).toEqual(['VIDEO', 0]);
    });

    it('ends a region at its last byte: $4000 is not VIDEO+0400H', () => {
      expect(at(set, 0x3fff)).toEqual(['VIDEO', 0x3ff]);
      expect(at(set, 0x4000)).toBeUndefined();
      expect(at(set, 0x37ff)).toBeUndefined();
    });

    it('gives the keyboard its own length: $3BFF is KEYBOARD+03FFH only if it is 1024 bytes', () => {
      expect(at(set, 0x3bff)).toEqual(['KEYBOARD', 0x3ff]);
      expect(at(set, 0x3c00)).toEqual(['VIDEO', 0]);
      const short = selectSymbols(MODEL_III, tablesOf({ 'hardware-model3': [{ ...keyboard, length: 256 }, video] }), {});
      expect(at(short, 0x38ff)).toEqual(['KEYBOARD', 0xff]);
      expect(at(short, 0x3900)).toBeUndefined();
      expect(at(short, 0x3bff)).toBeUndefined();
    });

    it('covers a variable for its length', () => {
      expect(at(set, 0x401f)).toBeUndefined();
      expect(at(set, 0x4020)).toEqual(['CURSOR', 0]);
      expect(at(set, 0x4021)).toEqual(['CURSOR', 1]);
      expect(at(set, 0x4022)).toBeUndefined();
    });

    it('covers a vector for its length, as well as finding it as code', () => {
      expect(at(set, 0x408e)).toEqual(['USRVEC', 0]);
      expect(at(set, 0x408f)).toEqual(['USRVEC', 1]);
      expect(at(set, 0x4090)).toBeUndefined();
    });

    it('never offers a routine or a port, even inside a routine span', () => {
      expect(at(set, 0x0049)).toBeUndefined();
      expect(at(set, 0x0060)).toBeUndefined();
      expect(at(set, 0x0063)).toBeUndefined();
      expect(at(set, 0x00ec)).toBeUndefined();
    });

    it('agrees with a plain scan for "key <= addr < key + length" at every address, in either table order', () => {
      const reversed = selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [delay, usrvec, cursor, kbwait], 'hardware-model3': [keyboard, modeport, video] }), {});
      const covering = (addr: number): TableEntry | undefined => [cursor, usrvec, keyboard, video].find((e) => e.key <= addr && addr < e.key + e.length);
      const wrong: string[] = [];
      for (let addr = 0; addr <= 0xffff; addr++) {
        const expected = covering(addr);
        if (set.data(addr)?.entry !== expected || reversed.data(addr)?.entry !== expected) wrong.push(`$${addr.toString(16)}: expected ${expected?.name}`);
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('port and svc', () => {
    it('finds a port by number', () => {
      expect(set.port(0xec)).toBe(modeport);
      expect(set.port(0xed)).toBeUndefined();
    });

    it('returns the first of two entries for one port, since IN and OUT can differ', () => {
      const modeIn = entry('hardware-model3', 'port', 0xec, 'MODE_IN');
      const modeOut = entry('hardware-model3', 'port', 0xec, 'MODE_OUT');
      expect(selectSymbols(MODEL_III, tablesOf({ 'hardware-model3': [modeOut, modeIn] }), {}).port(0xec)).toBe(modeOut);
      expect(selectSymbols(MODEL_III, tablesOf({ 'hardware-model3': [modeIn, modeOut] }), {}).port(0xec)).toBe(modeIn);
    });

    it('finds a service call by number, and the first of two with one number', () => {
      const dsply = entry('svc-lsdos6', 'svc', 10, '@DSPLY');
      const again = entry('svc-lsdos6', 'svc', 10, '@AGAIN');
      const calls = selectSymbols({ machine: 4, dos: 'none' }, tablesOf({ 'svc-lsdos6': [dsply, again] }), {});
      expect(calls.svc(10)).toBe(dsply);
      expect(calls.svc(11)).toBeUndefined();
    });

    it('keeps addresses, ports, and service calls apart though their numbers match', () => {
      const routine = entry('hardware-model3', 'routine', 0x10, 'ROUTINE_10');
      const variable = entry('hardware-model3', 'variable', 0x20, 'VAR_20');
      const port = entry('hardware-model3', 'port', 0x10, 'PORT_10');
      const call = entry('svc-lsdos6', 'svc', 0x10, 'CALL_10');
      const mixed = new SymbolSet(MODEL_III, [routine, variable, port, call], {});
      expect(mixed.code(0x10)).toBe(routine);
      expect(mixed.port(0x10)).toBe(port);
      expect(mixed.svc(0x10)).toBe(call);
      expect(mixed.data(0x10)).toBeUndefined();
      expect(mixed.port(0x20)).toBeUndefined();
      expect(mixed.svc(0x20)).toBeUndefined();
      expect(mixed.code(0x20)).toBeUndefined();
    });
  });

  describe('entries', () => {
    it('lists the entries of its tables in table order, then in the order each table lists them', () => {
      expect(set.entries()).toEqual([kbwait, cursor, usrvec, delay, video, modeport, keyboard]);
    });
  });
});

describe('SymbolSet.machineTag', () => {
  const rom = (table: 'rom-model1' | 'rom-model3', key: number, name: string): TableEntry => entry(table, 'routine', key, name);
  const kbwait = rom('rom-model3', 0x0049, '$KBWAIT');
  const inkey = rom('rom-model3', 0x1a19, '$INKEY');
  const delay = rom('rom-model3', 0x0060, '$DELAY');
  const model3 = (comparison: Readonly<Record<string, RomClass>>): SymbolSet => selectSymbols(MODEL_III, tablesOf({ 'rom-model3': [kbwait, inkey, delay] }), comparison);

  it('tags a Model III ROM name whose address differs on the Model I', () => {
    expect(model3({ '0049': 'different' }).machineTag(kbwait)).toBe('[Model III]');
  });

  it('leaves a name the two ROMs share untagged', () => {
    expect(model3({ '0049': 'shared' }).machineTag(kbwait)).toBeUndefined();
  });

  it('tags a name at an address only the Model III ROM table has', () => {
    expect(model3({ '1A19': 'model3-only' }).machineTag(inkey)).toBe('[Model III]');
  });

  it('reads the comparison by four uppercase hex digits, so each address finds its own class', () => {
    const set = model3({ '0049': 'shared', '1A19': 'different', '0060': 'shared' });
    expect(set.machineTag(kbwait)).toBeUndefined();
    expect(set.machineTag(inkey)).toBe('[Model III]');
    expect(set.machineTag(delay)).toBeUndefined();
  });

  it('tags a name from the Model I table [Model I], whether the address differs or only that ROM has it', () => {
    const one = rom('rom-model1', 0x0049, '$KEY');
    const only = rom('rom-model1', 0x1a19, '$INKEY');
    const shared = rom('rom-model1', 0x0060, '$DELAY');
    const set = selectSymbols({ machine: 1, dos: 'none' }, tablesOf({ 'rom-model1': [one, only, shared] }), { '0049': 'different', '1A19': 'model1-only', '0060': 'shared' });
    expect(set.machineTag(one)).toBe('[Model I]');
    expect(set.machineTag(only)).toBe('[Model I]');
    expect(set.machineTag(shared)).toBeUndefined();
  });

  it('tags a ROM name at an address the comparison does not class as shared, since it is not known to be shared', () => {
    expect(model3({}).machineTag(kbwait)).toBe('[Model III]');
  });

  it('never tags a hardware, DOS, or service-call entry, whatever the comparison says about its number', () => {
    const comparison = { '0049': 'different' } as const;
    const device = entry('hardware-model3', 'region', 0x0049, 'DEVICE');
    const dos = entry('dos-trsdos13', 'routine', 0x0049, '$DOS');
    const call = entry('svc-lsdos6', 'svc', 0x49, '@CALL');
    const three = selectSymbols({ machine: 3, dos: 'trsdos' }, tablesOf({ 'hardware-model3': [device], 'dos-trsdos13': [dos] }), comparison);
    const four = selectSymbols({ machine: 4, dos: 'none' }, tablesOf({ 'svc-lsdos6': [call] }), comparison);
    expect(three.machineTag(device)).toBeUndefined();
    expect(three.machineTag(dos)).toBeUndefined();
    expect(four.machineTag(call)).toBeUndefined();
  });
});

describe('the package exports', () => {
  it('exports the selection API, the sources registry, and the generated tables', () => {
    expect(disasm.selectSymbols).toBe(selectSymbols);
    expect(disasm.defaultDos).toBe(defaultDos);
    expect(disasm.tablesFor).toBe(tablesFor);
    expect(disasm.describeSelection).toBe(describeSelection);
    expect(disasm.SymbolSet).toBe(SymbolSet);
    expect(disasm.SelectionError).toBe(SelectionError);
    const sources: readonly Source[] = disasm.SYMBOL_SOURCES;
    const tables: Tables = disasm.SYMBOL_TABLES;
    expect(sources).toBe(SOURCES);
    expect(tables).toBe(TABLES);
  });

  it('does not export the generated tables as TABLES or SOURCES, which @fugloy/z80 already uses for its opcode tables', () => {
    expect('TABLES' in disasm).toBe(false);
    expect('SOURCES' in disasm).toBe(false);
  });

  it('exports the comparison types a caller passes to selectSymbols', () => {
    const comparison: RomComparison = { '0049': 'shared' };
    expect(disasm.selectSymbols({ machine: 3, dos: 'none' }, NO_TABLES, comparison)).toBeInstanceOf(disasm.SymbolSet);
  });
});
