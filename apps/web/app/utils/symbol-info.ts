/** Table entries and sources, found by id, and how a source and an address read. */
import { SYMBOL_SOURCES, SYMBOL_TABLES } from '@fugloy/disasm';
import type { Source, TableEntry, TableId } from '@fugloy/disasm';

/** The entry a followed table span stands for, from the table and key its link carries. */
export function entryOf(table: string | undefined, key: number | undefined): TableEntry | undefined {
  if (table === undefined || key === undefined) return undefined;
  return (SYMBOL_TABLES as Readonly<Record<string, readonly TableEntry[] | undefined>>)[table as TableId]?.find((e) => e.key === key);
}

export function sourceOf(id: string): Source | undefined {
  return SYMBOL_SOURCES.find((s) => s.id === id);
}

/** `Radio Shack catalog no. 26-2103`, for a catalog number as sources.json prints it. */
export function catalogLabel(catalog: string): string {
  return `Radio Shack catalog no. ${catalog}`;
}

/** `Jack Decker, The Alternate Source, 1983`, with the edition and an approximate year marked. */
export function sourceLine(s: Source): string {
  const year = s.circa === true ? `c. ${s.year}` : s.year;
  return [s.author, s.publisher, s.edition === undefined ? undefined : `${s.edition} edition`, year].filter((x) => x !== undefined).join(', ');
}

/** The key as the entry's kind spells it: `$4B9E`, or `port $EC`, or `service call 12`. */
export function keyLabel(e: TableEntry): string {
  const hex = e.key.toString(16).toUpperCase().padStart(e.kind === 'port' ? 2 : 4, '0');
  if (e.kind === 'port') return `port $${hex}`;
  if (e.kind === 'svc') return `service call ${e.key}`;
  return `$${hex}${e.length > 1 ? `, ${e.length} bytes` : ''}`;
}
