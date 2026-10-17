/**
 * What the cited symbol tables in data/symbols/*.json compile to (see the
 * phase 3 design spec, §4). Types and one constant; no I/O.
 */

/** The machines a listing can name symbols for. */
export type Machine = 1 | 3 | 4;
export type Dos = 'trsdos' | 'ldos' | 'none';

/** One JSON file per table, `data/symbols/<id>.json`, in the order the generated module lists them. */
export const TABLE_IDS = [
  'rom-model1',
  'rom-model3',
  'hardware-model1',
  'hardware-model3',
  'dos-trsdos13',
  'dos-ldos51-model1',
  'dos-ldos51-model3',
  'svc-lsdos6',
] as const;
export type TableId = (typeof TABLE_IDS)[number];

export const ENTRY_KINDS = ['routine', 'vector', 'variable', 'region', 'port', 'svc'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** A page of a source, as the source prints it (`12/12`, `6-29`, `86`). */
export interface Cite {
  source: string;
  page: string;
}

export interface TableEntry {
  table: TableId;
  kind: EntryKind;
  /** The address, port number, or service call number. */
  key: number;
  name: string;
  /** Bytes covered from `key`; 1 unless given. Always 1 for a port or service call. */
  length: number;
  purpose: string;
  cite: readonly Cite[];
  /** True for a name the sources do not give. */
  coined: boolean;
  note?: string;
}

/** A published work the tables cite, found by `id` in sources.json. */
export interface Source {
  id: string;
  author: string;
  title: string;
  publisher: string;
  /** Digits or a range of digits (`1982`, `1983–84`); `circa` says the year is approximate. */
  year: string;
  circa?: boolean;
  edition?: string;
  /** A catalog number as printed, `26-2103`, for a work with no copy online. */
  catalog?: string;
  /** Where to find the work: an archive.org details page, or the page of its text. */
  url?: string;
  /** A plain-text edition of the work, where one exists. */
  textUrl?: string;
  /** The archive.org identifier, parsed from `url` when it is an archive.org details page. */
  archiveId?: string;
  /** Where the holder grants permission to redistribute; required when `redistributable` is true. */
  permissionUrl?: string;
  /** True where the work's text is free to redistribute. */
  redistributable?: boolean;
}

/** How an address in either ROM table compares across the Model I and Model III ROMs. */
export type RomClass = 'shared' | 'different' | 'model1-only' | 'model3-only';
/** Keyed by the address as four uppercase hex digits. */
export type RomComparison = Readonly<Record<string, RomClass>>;

/** The valid machine and DOS pairs, and the tables each one names from. */
export const SELECTIONS: readonly { machine: Machine; dos: Dos; tables: readonly TableId[] }[] = [
  { machine: 1, dos: 'ldos', tables: ['rom-model1', 'hardware-model1', 'dos-ldos51-model1'] },
  { machine: 1, dos: 'none', tables: ['rom-model1', 'hardware-model1'] },
  { machine: 3, dos: 'trsdos', tables: ['rom-model3', 'hardware-model3', 'dos-trsdos13'] },
  { machine: 3, dos: 'ldos', tables: ['rom-model3', 'hardware-model3', 'dos-ldos51-model3'] },
  { machine: 3, dos: 'none', tables: ['rom-model3', 'hardware-model3'] },
  { machine: 4, dos: 'none', tables: ['svc-lsdos6'] },
];
