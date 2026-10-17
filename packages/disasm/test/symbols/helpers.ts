/** In-memory symbol tables for tests, so a test names its own entries instead of depending on the generated data. */
import type { Cite, EntryKind, TableEntry, TableId } from '../../src/symbols/types.js';

export type Tables = Readonly<Record<TableId, readonly TableEntry[]>>;

export const NO_TABLES: Tables = {
  'rom-model1': [],
  'rom-model3': [],
  'hardware-model1': [],
  'hardware-model3': [],
  'dos-trsdos13': [],
  'dos-ldos51-model1': [],
  'dos-ldos51-model3': [],
  'svc-lsdos6': [],
};
/** Every table empty except the lists given. */
export const tablesOf = (lists: Partial<Tables>): Tables => ({ ...NO_TABLES, ...lists });

const CITE: Cite = { source: 'm3-basic', page: '1' };
export const entry = (table: TableId, kind: EntryKind, key: number, name: string, over: Partial<TableEntry> = {}): TableEntry => ({
  table,
  kind,
  key,
  name,
  length: 1,
  purpose: `purpose of ${name}`,
  cite: [CITE],
  coined: false,
  ...over,
});
