/**
 * TRSDOS/LDOS load-module (.CMD) loader. Walks the record stream into a
 * MemoryImage; everything downstream works from the image, never file order.
 */
import { MemoryImage } from './memory.js';

export type CmdRecord =
  | { type: 1; offset: number; lengthByte: number; addr: number; dataLength: number; block: number }
  | { type: 2; offset: number; addr: number }
  | { type: 3; offset: number }
  | { type: 5; offset: number; name: string }
  | { type: 0x1f; offset: number; text: string }
  /** PDS / ISAM / patch records (`04`, `06`–`10`): parsed for length, skipped, logged. */
  | { type: number; offset: number; payloadLength: number };

export interface CmdModule {
  format: 'cmd';
  image: MemoryImage;
  /** Transfer address, or the lowest loaded address when the file has none, or null. */
  entry: number | null;
  entrySource: 'transfer' | 'lowest' | 'none';
  /** What ended the record walk: an 02, an 03, end of file, or a bad record. */
  endedBy: 'transfer' | 'end' | 'eof' | 'error';
  name?: string;
  copyright?: string;
  records: CmdRecord[];
  /** Bytes after the record that stopped the walk (tape-conversion debris is common). */
  trailing: number;
  warnings: string[];
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
/** Record text as printable ASCII; anything else becomes `{hh}` so file content can never forge listing lines or terminal escapes. */
const text = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : `{${hex2(b)}}`)).join('').replace(/ +$/, '');

const isKnownType = (t: number): boolean => (t >= 0x01 && t <= 0x10) || t === 0x1f;

/** Data bytes in a `01` record: the length byte counts the two address bytes and wraps. */
const loadDataLength = (lengthByte: number): number => {
  const n = lengthByte - 2;
  return n <= 0 ? n + 256 : n;
};

/** Payload bytes in any other typed record: 0 means 256. */
const payloadLength = (lengthByte: number): number => (lengthByte === 0 ? 256 : lengthByte);

export function loadCmd(bytes: Uint8Array): CmdModule {
  const image = new MemoryImage();
  const records: CmdRecord[] = [];
  const warnings: string[] = [];
  const mod: CmdModule = { format: 'cmd', image, entry: null, entrySource: 'none', endedBy: 'eof', records, trailing: 0, warnings };
  const n = bytes.length;
  let pos = 0;

  const stop = (endedBy: CmdModule['endedBy'], at: number): void => {
    mod.endedBy = endedBy;
    mod.trailing = n - at;
    pos = n;
  };

  while (pos < n) {
    const offset = pos;
    const type = bytes[pos]!;
    if (!isKnownType(type)) {
      warnings.push(`unknown record type $${hex2(type)} at offset ${offset}; stopping`);
      stop('error', offset);
      break;
    }
    if (type === 0x03) {
      // End of load, no transfer address. Its length byte and payload are skipped when
      // present, but a file that simply ends here is not an error.
      records.push({ type: 3, offset });
      warnings.push('03 record: end of load with no transfer address; not directly executable');
      const after = pos + 1 < n ? Math.min(n, pos + 2 + payloadLength(bytes[pos + 1]!)) : n;
      stop('end', after);
      break;
    }
    if (pos + 1 >= n) {
      warnings.push(`truncated ${hex2(type)} record at offset ${offset}: no length byte`);
      stop('error', offset);
      break;
    }
    const lengthByte = bytes[pos + 1]!;
    const length = type === 0x01 ? loadDataLength(lengthByte) + 2 : payloadLength(lengthByte);
    if (pos + 2 + length > n) {
      warnings.push(`truncated ${hex2(type)} record at offset ${offset}: needs ${length} bytes, ${n - pos - 2} remain`);
      stop('error', offset);
      break;
    }
    const payload = bytes.subarray(pos + 2, pos + 2 + length);
    pos += 2 + length;

    switch (type) {
      case 0x01: {
        const addr = payload[0]! | (payload[1]! << 8);
        const data = payload.subarray(2);
        const block = image.load(addr, data);
        if (block.wrapped) warnings.push(`block at $${hex4(addr)} (${data.length} bytes) wraps past $FFFF`);
        records.push({ type: 1, offset, lengthByte, addr, dataLength: data.length, block: block.index });
        break;
      }
      case 0x02: {
        if (length < 2) {
          warnings.push(`transfer record at offset ${offset} has length ${length}; no address`);
          stop('error', offset);
          break;
        }
        if (length !== 2) warnings.push(`transfer record at offset ${offset} has length ${length}, expected 2`);
        const addr = payload[0]! | (payload[1]! << 8);
        records.push({ type: 2, offset, addr });
        mod.entry = addr;
        mod.entrySource = 'transfer';
        if (pos < n) warnings.push(`${n - pos} bytes after the transfer record ignored`);
        stop('transfer', pos);
        break;
      }
      case 0x05: {
        const name = text(payload);
        records.push({ type: 5, offset, name });
        mod.name = name;
        break;
      }
      case 0x1f: {
        const copyright = text(payload);
        records.push({ type: 0x1f, offset, text: copyright });
        mod.copyright = copyright;
        break;
      }
      default:
        records.push({ type, offset, payloadLength: length });
    }
  }

  if (mod.entrySource === 'none' && mod.endedBy !== 'end') {
    const lowest = image.lowestLoaded();
    if (lowest !== null) {
      mod.entry = lowest;
      mod.entrySource = 'lowest';
      warnings.push(`no transfer address record; using lowest loaded address $${hex4(lowest)}`);
    }
  }
  return mod;
}

/**
 * Content-based detection: the file starts with a well-formed known record and
 * at least one load block is read before anything goes wrong. Debris after a
 * good start is tolerated because tape-converted files carry it.
 */
export function isCmd(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || !isKnownType(bytes[0]!)) return false;
  const mod = loadCmd(bytes);
  const firstBad = mod.warnings.find((w) => w.startsWith('truncated') || w.startsWith('unknown'));
  const firstLoad = mod.records.find((r) => r.type === 1);
  if (firstLoad === undefined) return false;
  if (firstBad === undefined) return true;
  const badOffset = Number(/offset (\d+)/.exec(firstBad)?.[1]);
  return firstLoad.offset < badOffset;
}
