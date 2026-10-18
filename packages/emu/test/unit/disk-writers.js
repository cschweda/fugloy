/**
 * Synthetic disk images for the phase 5 tests, in each container `DiskImage` reads: JV1 (a
 * headerless dump), JV3 (the 2,901-entry header table), and DMK (raw FM and MFM tracks behind
 * IDAM pointers). Every writer takes `fill(track, side, sector)`, which returns the sector's bytes
 * (shorter arrays are zero-padded); without one each sector is stamped [track, side, sector].
 * `bootSector` builds a track 0 sector 1 the Model III ROM loads and runs.
 */

/** @typedef {(track: number, side: number, sector: number) => ArrayLike<number> | null | undefined} Fill */

const SECTOR = 256;

/** @param {Fill | undefined} fill */
function sectorBytes(fill, track, side, sector) {
  const out = new Uint8Array(SECTOR);
  const given = fill?.(track, side, sector);
  if (given) out.set(Array.from(given).slice(0, SECTOR));
  else out.set([track, side, sector]);
  return out;
}

/**
 * A JV1: `tracks` × `spt` 256-byte sectors, single-sided, in track order. `DiskImage` infers the
 * geometry from the size (18 sectors numbered from 1, or 10 numbered from 0), so `fill` sees those
 * sector numbers.
 * @param {{ tracks?: number, spt?: 10 | 18, fill?: Fill }} [opts]
 */
export function writeJv1({ tracks = 40, spt = 18, fill } = {}) {
  const base = spt === 18 ? 1 : 0;
  const bytes = new Uint8Array(tracks * spt * SECTOR);
  for (let t = 0; t < tracks; t++) {
    for (let s = 0; s < spt; s++) bytes.set(sectorBytes(fill, t, 0, base + s), (t * spt + s) * SECTOR);
  }
  return bytes;
}

const JV3_ENTRIES = 2901;
const JV3_HEADER = JV3_ENTRIES * 3 + 1;

/** @typedef {(track: number, side: number, sector: number) => boolean} SectorTest */
/** @typedef {(track: number, side: number, sector: number) => number} DamOf */

/** The JV3 flags bits for a data address mark: SD 00 FB, 20 FA, 40 F9, 60 F8; DD 00 FB, 20 F8. */
const jv3Dam = (dam, dd) => (dam === 0xfb ? 0 : dd ? 0x20 : { 0xfa: 0x20, 0xf9: 0x40, 0xf8: 0x60 }[dam]);

/**
 * A JV3: one header entry (track, sector, flags) per sector, 256-byte sectors, flags 0x80 for
 * double density, 0x10 for side 1, the data mark in bits 5-6 (`dam`, default FB), and 0x08 for a
 * CRC error (`crcError`); `dd` may be a function of (track, side) for mixed densities. `free`
 * lists header positions that hold a free entry (FF FF FC|size code 1: a free 1,024-byte data
 * area, which the file keeps, filled with E5) before the sector that would have been there. Free
 * entries after the last sector are FF FF FF, and the last header byte is FF for a writable disk.
 * More than 2,901 entries go on in a second header block after the first block's data.
 * @param {{ tracks?: number, spt?: number, sides?: 1 | 2, base?: number, dd?: boolean | ((track: number, side: number) => boolean), writeProtected?: boolean, fill?: Fill, dam?: DamOf, crcError?: SectorTest, free?: number[] }} [opts]
 */
export function writeJv3({ tracks = 40, spt = 18, sides = 1, base = 1, dd = true, writeProtected = false, fill, dam, crcError, free = [] } = {}) {
  /** @type {{ header: number[], data: Uint8Array }[]} */
  const entries = [];
  for (let t = 0; t < tracks; t++) {
    for (let side = 0; side < sides; side++) {
      for (let s = 0; s < spt; s++) {
        while (free.includes(entries.length)) entries.push({ header: [0xff, 0xff, 0xfc | 0x01], data: new Uint8Array(1024).fill(0xe5) });
        const double = typeof dd === 'function' ? dd(t, side) : dd;
        const mark = dam?.(t, side, base + s) ?? 0xfb;
        const flags = (double ? 0x80 : 0x00) | jv3Dam(mark, double) | (side ? 0x10 : 0x00) | (crcError?.(t, side, base + s) ? 0x08 : 0x00); // size code 0: 256 bytes
        entries.push({ header: [t, base + s, flags], data: sectorBytes(fill, t, side, base + s) });
      }
    }
  }
  if (entries.length > 2 * JV3_ENTRIES) throw new Error(`writeJv3: ${entries.length} entries do not fit two ${JV3_ENTRIES}-entry header blocks`);
  const blocks = [entries.slice(0, JV3_ENTRIES), entries.slice(JV3_ENTRIES)].filter((b) => b.length);
  const size = blocks.reduce((n, b) => n + JV3_HEADER + b.reduce((m, e) => m + e.data.length, 0), 0);
  const bytes = new Uint8Array(size);
  let at = 0;
  blocks.forEach((block, k) => {
    bytes.fill(0xff, at, at + JV3_HEADER);
    if (k === 0 && writeProtected) bytes[JV3_HEADER - 1] = 0x00;
    let data = at + JV3_HEADER;
    block.forEach((e, i) => {
      bytes.set(e.header, at + i * 3);
      bytes.set(e.data, data);
      data += e.data.length;
    });
    at = data;
  });
  return bytes;
}

/** CRC-CCITT (polynomial $1021, preset $FFFF), as the WD1793 writes it after the ID and data fields. */
export function crc16(bytes, crc = 0xffff) {
  for (const b of bytes) {
    crc ^= b << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

const DMK_HEADER = 16;
const DMK_IDAM_TABLE = 128;

/**
 * A DMK in the IBM layouts: per track side an index gap and mark, then per sector a sync run (and
 * A1 A1 A1 in MFM), FE, the ID (track, side, sector, size code 1), its CRC, a gap, a sync run (and
 * the A1s), the data mark (`dam`, default FB), 256 data bytes, and their CRC. Sectors are MFM
 * unless `fm(track, side, sector)` says FM; FM bytes are stored twice, or once with `singleByte`
 * (header flag 0x40). Each track's IDAM table holds the offset of each FE from the track start,
 * with bit 15 set for MFM. The header: write protect (FF or 00), track count, track length
 * (little-endian), flags (bit 4: single-sided; bit 6: single-byte FM), and zeros.
 * @param {{ tracks?: number, spt?: number, sides?: 1 | 2, base?: number, writeProtected?: boolean, fill?: Fill, fm?: SectorTest, singleByte?: boolean, dam?: DamOf }} [opts]
 */
export function writeDmk({ tracks = 40, spt = 18, sides = 1, base = 1, writeProtected = false, fill, fm, singleByte = false, dam } = {}) {
  /** @type {{ raw: number[], ptrs: number[] }[]} */
  const regions = [];
  for (let t = 0; t < tracks; t++) {
    for (let side = 0; side < sides; side++) {
      const raw = [];
      const ptrs = [];
      const firstFm = fm?.(t, side, base) ?? false;
      const put = (v, isFm) => {
        raw.push(v);
        if (isFm && !singleByte) raw.push(v);
      };
      const run = (n, v, isFm) => {
        for (let k = 0; k < n; k++) put(v, isFm);
      };
      if (firstFm) {
        run(16, 0xff, true);
        run(6, 0x00, true);
        put(0xfc, true);
      } else {
        run(32, 0x4e, false);
        run(12, 0x00, false);
        for (const v of [0xc2, 0xc2, 0xc2, 0xfc]) put(v, false);
        run(32, 0x4e, false);
      }
      for (let s = 0; s < spt; s++) {
        const isFm = fm?.(t, side, base + s) ?? false;
        const sync = isFm ? [] : [0xa1, 0xa1, 0xa1];
        const gap = isFm ? 0xff : 0x4e;
        run(isFm ? 6 : 12, 0x00, isFm);
        for (const v of sync) put(v, isFm);
        ptrs.push((DMK_IDAM_TABLE + raw.length) | (isFm ? 0 : 0x8000));
        const id = [0xfe, t, side, base + s, 0x01];
        const idCrc = crc16([...sync, ...id]);
        for (const v of [...id, idCrc >> 8, idCrc & 0xff]) put(v, isFm);
        run(isFm ? 11 : 22, gap, isFm);
        run(isFm ? 6 : 12, 0x00, isFm);
        for (const v of sync) put(v, isFm);
        const mark = dam?.(t, side, base + s) ?? 0xfb;
        const data = sectorBytes(fill, t, side, base + s);
        const dCrc = crc16([...sync, mark, ...data]);
        for (const v of [mark, ...data, dCrc >> 8, dCrc & 0xff]) put(v, isFm);
        run(isFm ? 12 : 24, gap, isFm);
      }
      if (ptrs.length > 64) throw new Error('writeDmk: a DMK track holds at most 64 IDAM pointers');
      regions.push({ raw, ptrs });
    }
  }
  // 0x1900 (6,400 bytes) is the usual 5.25" double-density track length; longer layouts grow it.
  const trackLen = Math.max(0x1900, DMK_IDAM_TABLE + Math.max(...regions.map((r) => r.raw.length)));
  const bytes = new Uint8Array(DMK_HEADER + regions.length * trackLen);
  bytes[0] = writeProtected ? 0xff : 0x00;
  bytes[1] = tracks;
  bytes[2] = trackLen & 0xff;
  bytes[3] = trackLen >> 8;
  bytes[4] = (sides === 1 ? 0x10 : 0x00) | (singleByte ? 0x40 : 0x00);
  regions.forEach(({ raw, ptrs }, i) => {
    const at = DMK_HEADER + i * trackLen;
    ptrs.forEach((p, k) => {
      bytes[at + k * 2] = p & 0xff;
      bytes[at + k * 2 + 1] = p >> 8;
    });
    bytes.fill(0x4e, at + DMK_IDAM_TABLE, at + trackLen);
    bytes.set(raw, at + DMK_IDAM_TABLE);
  });
  return bytes;
}

/** Where the Model III ROM puts the boot sector, and where it jumps once the read ends cleanly. */
export const BOOT_ORG = 0x4300;
/** Where the Model I Level II ROM loads the boot sector (track 0, sector 0). */
export const MODEL1_BOOT_ORG = 0x4200;

/**
 * A boot sector (track 0, sector 1) that copies `message` to the top line of video RAM ($3C00)
 * and spins. The Model III ROM reads that sector to $4300 and jumps there (ROM $34DD-$34FF loads
 * HL with $4300 and reads sector 1 with INI; the NMI that ends the read lands at $3502, which
 * jumps to $4300 when the status has no CRC, not-found, or lost-data bit, `AND 1CH`). The Model I
 * Level II ROM reads track 0, sector 0 to $4200 instead (MDL1LEV2.Z80, BOOT at $069F): pass
 * `org` $4200 (MODEL1_BOOT_ORG).
 * @param {string} message
 * @param {number} [org]
 */
export function bootSector(message, org = BOOT_ORG) {
  const at = 0x20;
  const code = [
    0x21, (org + at) & 0xff, (org + at) >> 8, // LD HL,message
    0x11, 0x00, 0x3c, // LD DE,3C00H
    0x01, message.length, 0x00, // LD BC,length
    0xed, 0xb0, // LDIR
    0x18, 0xfe, // JR $
  ];
  const out = new Uint8Array(SECTOR);
  out.set(code, 0);
  out.set([...message].map((c) => c.charCodeAt(0)), at);
  return out;
}

/** A `fill` that puts `boot` at track 0, side 0, sector 1 and stamps the rest. */
export const withBoot = (/** @type {Uint8Array} */ boot) => (/** @type {number} */ t, /** @type {number} */ side, /** @type {number} */ s) =>
  t === 0 && side === 0 && s === 1 ? boot : null;
