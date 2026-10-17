/**
 * Quoted DB rows. Printable bytes (20H–7EH) group into single-quoted runs with
 * a quote doubled inside; every other byte is a hex item. zmac assembles the
 * result byte for byte, which the harness and the round trips prove.
 */
import { hexByte } from '@fugloy/z80';

/** A row holds at most this many bytes and this many items. */
const ROW_BYTES = 16;
const ROW_ITEMS = 8;

const printable = (b: number): boolean => b >= 0x20 && b <= 0x7e;

/** The DB operand list for `bytes`: `'IT''S',0DH`. */
export function dbItems(bytes: ArrayLike<number>): string {
  return dbItemList(bytes).join(',');
}

/** The items of `dbItems`, each a quoted run (`'IT''S'`) or a hex byte (`0DH`). */
export function dbItemList(bytes: ArrayLike<number>): string[] {
  const items: string[] = [];
  let run = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]! & 0xff;
    if (printable(b)) {
      run += b === 0x27 ? "''" : String.fromCharCode(b);
      continue;
    }
    if (run !== '') items.push(`'${run}'`);
    run = '';
    items.push(hexByte(b));
  }
  if (run !== '') items.push(`'${run}'`);
  return items;
}

/** `\tDB\t` rows for `bytes`, a new row after 16 bytes or 8 items. */
export function dbString(bytes: ArrayLike<number>): string {
  const rows: number[][] = [];
  let row: number[] = [];
  let items = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]! & 0xff;
    const joins = row.length > 0 && printable(b) && printable(row[row.length - 1]!);
    if (row.length === ROW_BYTES || (!joins && items === ROW_ITEMS)) {
      rows.push(row);
      row = [];
      items = 0;
    }
    if (!(row.length > 0 && printable(b) && printable(row[row.length - 1]!))) items++;
    row.push(b);
  }
  if (row.length > 0) rows.push(row);
  return rows.map((r) => `\tDB\t${dbItems(r)}`).join('\n');
}
