/**
 * How the listing looks: one theme class per span kind (the colours live in
 * main.css), the fixed row height the virtualized list is built on, and the
 * address and byte columns as the CLI prints them.
 */
import type { Row, Span, SpanKind } from '@fugloy/disasm';

/** Every listing row is this tall, in CSS pixels; `.fg-row` in main.css says the same. */
export const ROW_HEIGHT = 20;

const SPAN_CLASS: Record<SpanKind, string> = {
  mnemonic: 'fg-tok-mnemonic',
  register: 'fg-tok-register',
  condition: 'fg-tok-condition',
  number: 'fg-tok-number',
  label: 'fg-tok-label',
  table: 'fg-tok-table',
  string: 'fg-tok-string',
  punct: 'fg-tok-punct',
  directive: 'fg-tok-directive',
};

/** The theme class of a span kind; each of the nine kinds has its own. */
export function spanClass(kind: SpanKind): string {
  return SPAN_CLASS[kind];
}

/** A `label` or `table` span that names an address, port, or service call is a link the reader can follow. */
export function isFollowable(span: Span): span is Span & { target: number } {
  return (span.kind === 'label' || span.kind === 'table') && span.target !== undefined;
}

/** `499F`, as the listing's address column prints it. */
export function hexAddr(addr: number): string {
  return addr.toString(16).toUpperCase().padStart(4, '0');
}

/** `CD 9E 4B`, as the listing's bytes column prints it. */
export function hexBytes(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

/** The address a row stands at, if it has one: the one a click on it selects. */
export function rowAddr(row: Row): number | undefined {
  return 'addr' in row ? row.addr : undefined;
}
