/**
 * The ROM, hardware, and DOS names a program may use without defining them
 * (Ruling 5), from @fugloy/disasm's cited symbol tables, and what the two
 * ROMs mean at an address where the Model I and Model III differ.
 *
 * A name's value is what the disassembler's emitter gives it in an EQU: a
 * port its number, a service call its number, anything else its address. So
 * an emitted source that defines a table name again gives it the same value.
 */
import { ROM_COMPARISON, selectSymbols, SYMBOL_TABLES } from '@fugloy/disasm';
import { hex4 } from '@fugloy/z80';
import type { Dos, Machine, TableEntry, TableId } from '@fugloy/disasm';

export type Model = 1 | 3 | 4;

/** A predefined name: its value and the table entry it comes from. */
export interface RomName {
  name: string;
  value: number;
  entry: TableEntry;
}

/** The model a program is assembled for when none is given: the Model III, as in the disassembler. */
export const DEFAULT_MODEL: Model = 3;

const MACHINE_TEXT: Readonly<Record<Model, string>> = { 1: 'Model I', 3: 'Model III', 4: 'Model 4' };
export const machineText = (model: Model): string => MACHINE_TEXT[model];

const DOSES: readonly Dos[] = ['trsdos', 'ldos', 'none'];

/**
 * Why a model and DOS have no names, as a sentence, or undefined when they
 * have. TRSDOS 1.3 is the Model III's DOS, and the Model 4's names are its
 * LS-DOS 6 service calls (with the Model III ROM it runs in Model III mode).
 */
export function selectionProblem(model: unknown, dos: unknown): string | undefined {
  if (model !== 1 && model !== 3 && model !== 4) return `The model is 1, 3, or 4, not ${String(model)}.`;
  if (dos === undefined) return undefined;
  if (!DOSES.includes(dos as Dos)) return `The DOS is trsdos, ldos, or none, not ${String(dos)}.`;
  if (model === 4 && dos !== 'none') return 'The Model 4 has no DOS names to choose: its names are the LS-DOS 6 service calls and the Model III ROM. Leave the DOS out.';
  if (model === 1 && dos === 'trsdos') return 'TRSDOS 1.3 is the Model III DOS; for the Model I choose ldos or none.';
  return undefined;
}

const cache = new Map<string, ReadonlyMap<string, RomName>>();

/** A table name's value, as the emitter's EQU gives it. */
const valueOf = (e: TableEntry): number => e.key;

/**
 * Every name the model and DOS predefine, keyed in upper case (names match
 * case-insensitively, as labels do). The first entry wins when two tables
 * share a name. Without a DOS, only the ROM's and the hardware's names.
 */
export function romNames(model: Model, dos: Dos = 'none'): ReadonlyMap<string, RomName> {
  const key = `${model}/${dos}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  // The Model 4 runs Model III programs in Model III mode, so it has the Model III ROM's names beside its own service calls.
  const sets = model === 4 ? [selectSymbols({ machine: 4, dos: 'none' }), selectSymbols({ machine: 3, dos: 'none' })] : [selectSymbols({ machine: model as Machine, dos })];
  const out = new Map<string, RomName>();
  for (const set of sets) {
    for (const entry of set.entries()) {
      const up = entry.name.toUpperCase();
      if (!out.has(up)) out.set(up, { name: entry.name, value: valueOf(entry), entry });
    }
  }
  cache.set(key, out);
  return out;
}

/** What each table is called in a sentence. */
export const TABLE_TEXT: Readonly<Record<TableId, string>> = {
  'rom-model1': 'Model I ROM',
  'rom-model3': 'Model III ROM',
  'hardware-model1': 'Model I hardware',
  'hardware-model3': 'Model III hardware',
  'dos-trsdos13': 'TRSDOS 1.3',
  'dos-ldos51-model1': 'LDOS 5.1',
  'dos-ldos51-model3': 'LDOS 5.1',
  'svc-lsdos6': 'LS-DOS 6',
};

/** A name without the `$` or `@` its table may spell it with, in upper case. */
const bare = (name: string): string => name.toUpperCase().replace(/^[$@]/, '');

/**
 * A table entry outside the chosen model and DOS whose name is `name` (with
 * or without its leading `$` or `@`), so the message can say which machine
 * or DOS has it; undefined when no table does.
 */
export function nameElsewhere(model: Model, dos: Dos, name: string): TableEntry | undefined {
  const want = bare(name);
  // A name the selection has, spelled without its $, is a near miss for the suggestions, not another table's.
  if ([...romNames(model, dos).keys()].some((k) => bare(k) === want)) return undefined;
  for (const id of Object.keys(SYMBOL_TABLES) as TableId[]) {
    const entry = SYMBOL_TABLES[id].find((e) => bare(e.name) === want);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/** The two ROMs' entries at an address their tables class as `different`, or undefined. */
export function romDifference(address: number): { model1: TableEntry; model3: TableEntry } | undefined {
  if (ROM_COMPARISON[hex4(address & 0xffff)] !== 'different') return undefined;
  const model1 = SYMBOL_TABLES['rom-model1'].find((e) => e.key === address);
  const model3 = SYMBOL_TABLES['rom-model3'].find((e) => e.key === address);
  return model1 === undefined || model3 === undefined ? undefined : { model1, model3 };
}

/** Every address the two ROM tables class as `different`, ascending. */
export function differentAddresses(): number[] {
  return Object.entries(ROM_COMPARISON)
    .filter(([, c]) => c === 'different')
    .map(([k]) => parseInt(k, 16))
    .sort((a, b) => a - b);
}
