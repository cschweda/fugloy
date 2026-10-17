/**
 * Checks the symbol tables and normalizes them into TableEntry lists (design
 * spec §4.7). Every error names the file, the entry's index and name, and the
 * rule it breaks, so a data-entry mistake points at the line to fix. Pure: the
 * generator reads the files and hands their parsed JSON in.
 */
import { hex4 } from '@fugloy/z80';
import { RESERVED, SYNTH_NAME } from '../hints/format.js';
import { ENTRY_KINDS, SELECTIONS, TABLE_IDS } from './types.js';
import type { Cite, EntryKind, Source, TableEntry, TableId } from './types.js';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Text with something in it. */
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
/** A value as an error message shows it: strings quoted. */
const show = (v: unknown): string => (typeof v === 'string' ? `"${v}"` : v === undefined ? 'nothing' : JSON.stringify(v));

const MEMORY_KINDS: readonly EntryKind[] = ['routine', 'vector', 'variable', 'region'];
const isMemory = (kind: EntryKind): boolean => MEMORY_KINDS.includes(kind);

/** What each table may hold: ports belong to hardware, service calls to svc-lsdos6, and DOS tables take no regions. */
const ALLOWED_KINDS: Readonly<Record<TableId, readonly EntryKind[]>> = {
  'rom-model1': MEMORY_KINDS,
  'rom-model3': MEMORY_KINDS,
  'hardware-model1': [...MEMORY_KINDS, 'port'],
  'hardware-model3': [...MEMORY_KINDS, 'port'],
  'dos-trsdos13': ['routine', 'vector', 'variable'],
  'dos-ldos51-model1': ['routine', 'vector', 'variable'],
  'dos-ldos51-model3': ['routine', 'vector', 'variable'],
  'svc-lsdos6': ['svc'],
};

const ENTRY_FIELDS = new Set(['addr', 'port', 'svc', 'name', 'kind', 'purpose', 'cite', 'length', 'coined', 'note']);
const KEY_FIELDS = ['addr', 'port', 'svc'] as const;
const SOURCE_FIELDS = new Set(['id', 'author', 'title', 'publisher', 'year', 'circa', 'edition', 'catalog', 'url', 'textUrl', 'redistributable']);

/** A name a source prints may start with `$` or `@` and end in one `$` (LS-DOS and LDOS print `@FLAGS$`, `@HIGH$`, `TIME$`); a name we coin may do neither. */
const SOURCE_NAME = /^[$@]?[A-Z][A-Z0-9_]*\$?$/;
const COINED_NAME = /^[A-Z][A-Z0-9_]*$/;
const COINED_MAX = 12;
/** A purpose, note, or page is printed into a zmac `EQU` line and a listing comment, where a line break would end the line early. */
const LINE_BREAK = /[\r\n]/;

/** Why a name breaks the naming rule (spec §4.3), or null when it keeps it. */
function nameProblem(name: string, coined: boolean): string | null {
  if (coined) {
    if (/^[$@]/.test(name)) return `coined name "${name}" may not start with $ or @ (those mark names a source prints)`;
    if (name.endsWith('$')) return `coined name "${name}" may not end in $ (a trailing $ marks names a source prints)`;
    if (name.length > COINED_MAX) return `coined name "${name}" is longer than ${COINED_MAX} characters`;
    if (!COINED_NAME.test(name)) return `coined name "${name}" must be capitals, digits, and _, starting with a letter`;
  } else if (!SOURCE_NAME.test(name)) {
    return `name "${name}" must be capitals, digits, and _, starting with a letter, after an optional $ or @, and ending in at most one $`;
  }
  if (RESERVED.has(name.toUpperCase())) return `name "${name}" is reserved (a mnemonic, register, condition, or zmac word)`;
  if (SYNTH_NAME.test(name)) return `name "${name}" has the shape of a generated label`;
  return null;
}

/** One entry of a table file, or undefined when it cannot be normalized; every problem goes to `errors`. */
function readEntry(table: TableId, file: string, index: number, raw: unknown, known: ReadonlySet<string> | undefined, errors: string[]): TableEntry | undefined {
  if (!isObject(raw)) {
    errors.push(`${file} entry ${index}: not an object`);
    return undefined;
  }
  const label = isText(raw.name) ? `${file} entry ${index} "${raw.name}"` : `${file} entry ${index}`;
  let usable = true;
  /** A problem with a value the entry can still carry. */
  const flag = (rule: string): void => {
    errors.push(`${label}: ${rule}`);
  };
  /** A problem that leaves the entry unusable. */
  const reject = (rule: string): void => {
    flag(rule);
    usable = false;
  };

  for (const field of Object.keys(raw)) if (!ENTRY_FIELDS.has(field)) flag(`unknown field "${field}"`);

  let coined = false;
  if (raw.coined !== undefined) {
    if (typeof raw.coined === 'boolean') coined = raw.coined;
    else reject('coined must be true or false');
  }

  let name: string | undefined;
  if (isText(raw.name)) {
    name = raw.name;
    const problem = nameProblem(name, coined);
    if (problem !== null) flag(problem);
  } else {
    reject('name is missing or empty');
  }

  const kind = ENTRY_KINDS.find((k) => k === raw.kind);
  if (kind === undefined) reject(`kind ${show(raw.kind)} is not one of ${ENTRY_KINDS.join(', ')}`);
  else if (!ALLOWED_KINDS[table].includes(kind)) flag(`kind "${kind}" is not allowed in ${table} (allowed: ${ALLOWED_KINDS[table].join(', ')})`);
  const memory = kind !== undefined && isMemory(kind);

  // The key field is the one the kind takes: addr for memory, port for a port, svc for a service call.
  let key: number | undefined;
  if (kind !== undefined) {
    const field = kind === 'port' ? 'port' : kind === 'svc' ? 'svc' : 'addr';
    const present = KEY_FIELDS.filter((f) => raw[f] !== undefined);
    const value = raw[field];
    if (present.length !== 1 || present[0] !== field) {
      reject(`kind "${kind}" is keyed by ${field} alone; the entry has ${present.length === 0 ? 'no key' : present.join(' and ')}`);
    } else if (field === 'svc') {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127) key = value;
      else reject(`svc ${show(value)} is not an integer from 0 to 127`);
    } else if (field === 'port') {
      if (typeof value === 'string' && /^[0-9A-F]{2}$/.test(value)) key = parseInt(value, 16);
      else reject(`port ${show(value)} is not two uppercase hex digits`);
    } else if (typeof value === 'string' && /^[0-9A-F]{4}$/.test(value)) {
      key = parseInt(value, 16);
    } else {
      reject(`addr ${show(value)} is not four uppercase hex digits`);
    }
  }
  if (key !== undefined && memory && table.startsWith('dos-') && key < 0x4000) flag(`addr ${hex4(key)} is below $4000 (DOS tables hold RAM-resident addresses only)`);

  let length = 1;
  if (raw.length !== undefined) {
    if (kind === 'port' || kind === 'svc') reject(`a ${kind} entry takes no length`);
    else if (typeof raw.length === 'number' && Number.isInteger(raw.length) && raw.length >= 1) length = raw.length;
    else reject(`length ${show(raw.length)} is not an integer of at least 1`);
  }
  if (key !== undefined && memory && key + length > 0x10000) reject(`addr ${hex4(key)} with length ${length} runs past $FFFF`);

  const purpose = isText(raw.purpose) ? raw.purpose : undefined;
  if (purpose === undefined) reject('purpose is missing or empty');
  else if (LINE_BREAK.test(purpose)) flag('purpose may not contain a line break');

  const cite: Cite[] = [];
  if (!Array.isArray(raw.cite) || raw.cite.length === 0) {
    reject('cite is missing or empty (every entry cites a source and page)');
  } else {
    raw.cite.forEach((item: unknown, i) => {
      if (!isObject(item)) {
        reject(`cite ${i} is not { "source", "page" }`);
        return;
      }
      for (const field of Object.keys(item)) if (field !== 'source' && field !== 'page') flag(`cite ${i} has unknown field "${field}"`);
      if (!isText(item.source)) reject(`cite ${i} has no source`);
      else if (known !== undefined && !known.has(item.source)) reject(`cite ${i} names unknown source "${item.source}"`);
      if (!isText(item.page)) {
        reject(`cite ${i} has no page`);
      } else {
        if (LINE_BREAK.test(item.page)) flag(`cite ${i} page may not contain a line break`);
        if (isText(item.source)) cite.push({ source: item.source, page: item.page });
      }
    });
  }

  let note: string | undefined;
  if (raw.note !== undefined) {
    if (!isText(raw.note)) {
      reject('note must be non-empty text');
    } else {
      note = raw.note;
      if (LINE_BREAK.test(note)) flag('note may not contain a line break');
    }
  }

  if (!usable || name === undefined || kind === undefined || key === undefined || purpose === undefined) return undefined;
  return { table, kind, key, name, length, purpose, cite, coined, ...(note === undefined ? {} : { note }) };
}

/** The source registry, plus the ids a cite may name (undefined when the registry is unreadable, so cites are not blamed for it). */
function readSources(raw: unknown, errors: string[]): { sources: Source[]; known: Set<string> | undefined } {
  if (!isObject(raw) || !Array.isArray(raw.sources)) {
    errors.push('sources.json: expected an object with a "sources" array');
    return { sources: [], known: undefined };
  }
  for (const field of Object.keys(raw)) if (field !== 'sources') errors.push(`sources.json: unknown field "${field}"`);
  const sources: Source[] = [];
  const known = new Set<string>();
  const firstAt = new Map<string, number>();
  raw.sources.forEach((item: unknown, index) => {
    if (!isObject(item)) {
      errors.push(`sources.json entry ${index}: not an object`);
      return;
    }
    const id = isText(item.id) ? item.id : undefined;
    const label = id === undefined ? `sources.json entry ${index}` : `sources.json entry ${index} "${id}"`;
    let usable = true;
    const fail = (rule: string): void => {
      errors.push(`${label}: ${rule}`);
      usable = false;
    };
    if (id === undefined) {
      fail('id is missing or empty');
    } else if (firstAt.has(id)) {
      fail(`id is already used by entry ${firstAt.get(id)}`);
    } else {
      firstAt.set(id, index);
      known.add(id);
    }
    for (const field of Object.keys(item)) if (!SOURCE_FIELDS.has(field)) fail(`unknown field "${field}"`);
    const text = (field: string): string | undefined => {
      const value = item[field];
      if (isText(value)) return value;
      fail(`${field} is missing or empty`);
      return undefined;
    };
    const author = text('author');
    const title = text('title');
    const publisher = text('publisher');
    const year = text('year');
    if (year !== undefined && !/^\d{4}(–\d{2,4})?$/.test(year)) fail('year must be digits or a range of digits, like 1982 or 1983–84 (circa is its own flag)');
    const optional = (field: string): string | undefined => {
      const value = item[field];
      if (value === undefined) return undefined;
      if (isText(value)) return value;
      fail(`${field} must be non-empty text`);
      return undefined;
    };
    const link = (field: string): string | undefined => {
      const value = optional(field);
      if (value !== undefined && !/^https?:\/\/\S+$/.test(value)) fail(`${field} must start with http:// or https://`);
      return value;
    };
    const flag = (field: string): true | undefined => {
      const value = item[field];
      if (value === undefined) return undefined;
      if (value === true) return true;
      fail(`${field} must be true or false`);
      return undefined;
    };
    const edition = optional('edition');
    const catalog = optional('catalog');
    const url = link('url');
    const textUrl = link('textUrl');
    const circa = flag('circa');
    const redistributable = flag('redistributable');
    if (url === undefined && catalog === undefined && item.url === undefined) fail('needs a url or a catalog number');
    const archiveId = url === undefined ? undefined : /^https?:\/\/archive\.org\/details\/([^/?#\s]+)$/.exec(url)?.[1];
    if (!usable || id === undefined || author === undefined || title === undefined || publisher === undefined || year === undefined) return;
    sources.push({
      id, author, title, publisher, year,
      ...(circa === undefined ? {} : { circa }),
      ...(edition === undefined ? {} : { edition }),
      ...(catalog === undefined ? {} : { catalog }),
      ...(url === undefined ? {} : { url }),
      ...(textUrl === undefined ? {} : { textUrl }),
      ...(archiveId === undefined ? {} : { archiveId }),
      ...(redistributable === undefined ? {} : { redistributable }),
    });
  });
  return { sources, known };
}

/** How an error names an entry: its file, index, and name. */
const labelOf = (labels: ReadonlyMap<TableEntry, string>, e: TableEntry): string => labels.get(e) ?? e.name;

/**
 * A port number or a service call number is entered once per table. A lookup
 * answers with the first entry for a number, so a second one would never be
 * named, and an entry's purpose already covers every use of its number (IN and
 * OUT for a port). One message per repeat, against the first entry.
 */
function repeatedNumbers(tables: Readonly<Record<TableId, readonly TableEntry[]>>, labels: ReadonlyMap<TableEntry, string>): string[] {
  const found: string[] = [];
  for (const id of TABLE_IDS) {
    const first = new Map<string, TableEntry>();
    for (const e of tables[id]) {
      if (e.kind !== 'port' && e.kind !== 'svc') continue;
      const earlier = first.get(`${e.kind}:${e.key}`);
      if (earlier === undefined) {
        first.set(`${e.kind}:${e.key}`, e);
      } else if (e.kind === 'port') {
        found.push(`${labelOf(labels, e)}: port ${e.key.toString(16).toUpperCase().padStart(2, '0')} is already used by ${labelOf(labels, earlier)} (a table has one entry per port number; its purpose covers IN and OUT)`);
      } else {
        found.push(`${labelOf(labels, e)}: service call ${e.key} is already used by ${labelOf(labels, earlier)} (a table has one entry per service call number)`);
      }
    }
  }
  return found;
}

/** Names and memory must be unique within each machine-and-DOS selection; one message per offending pair. */
function crossChecks(tables: Readonly<Record<TableId, readonly TableEntry[]>>, labels: ReadonlyMap<TableEntry, string>): string[] {
  const found = new Set<string>();
  const label = (e: TableEntry): string => labelOf(labels, e);
  for (const { tables: ids } of SELECTIONS) {
    const entries = ids.flatMap((id) => tables[id]);
    const names = new Map<string, TableEntry>();
    for (const e of entries) {
      const folded = e.name.toUpperCase();
      const first = names.get(folded);
      if (first === undefined) names.set(folded, e);
      else found.add(`${label(e)}: name is already used by ${label(first)} (names are unique ignoring case within one machine and DOS selection)`);
    }
    const memory = entries.filter((e) => isMemory(e.kind));
    for (let later = 1; later < memory.length; later++) {
      const b = memory[later]!;
      for (let earlier = 0; earlier < later; earlier++) {
        const a = memory[earlier]!;
        const start = Math.max(a.key, b.key);
        if (start < Math.min(a.key + a.length, b.key + b.length)) {
          found.add(`${label(b)}: address $${hex4(start)} is already covered by ${label(a)} (memory entries in one selection may not overlap)`);
        }
      }
    }
  }
  return [...found];
}

/**
 * Validates the parsed table files and the source registry, and returns every
 * entry normalized (`addr`/`port`/`svc` into `key`, `length` 1 and `coined`
 * false by default) with the errors found. Entries that cannot be normalized
 * are left out. A table with no file is simply empty.
 */
export function validateTables(
  files: { file: string; json: unknown }[],
  sources: unknown,
): { tables: Record<TableId, TableEntry[]>; sources: Source[]; errors: string[] } {
  const errors: string[] = [];
  const registry = readSources(sources, errors);
  const tables = Object.fromEntries(TABLE_IDS.map((id) => [id, [] as TableEntry[]])) as Record<TableId, TableEntry[]>;
  const labels = new Map<TableEntry, string>();

  for (const { file, json } of files) {
    if (!isObject(json)) {
      errors.push(`${file}: expected an object with "table" and "entries"`);
      continue;
    }
    for (const field of Object.keys(json)) if (field !== 'table' && field !== 'entries') errors.push(`${file}: unknown field "${field}"`);
    const table = TABLE_IDS.find((id) => id === json.table);
    if (table === undefined) {
      errors.push(`${file}: unknown table ${show(json.table)} (expected one of ${TABLE_IDS.join(', ')})`);
      continue;
    }
    if (!Array.isArray(json.entries)) {
      errors.push(`${file}: entries is not an array`);
      continue;
    }
    json.entries.forEach((raw: unknown, index) => {
      const entry = readEntry(table, file, index, raw, registry.known, errors);
      if (entry === undefined) return;
      tables[table].push(entry);
      labels.set(entry, `${file} entry ${index} "${entry.name}"`);
    });
  }

  errors.push(...repeatedNumbers(tables, labels), ...crossChecks(tables, labels));
  return { tables, sources: registry.sources, errors };
}
