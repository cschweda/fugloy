/**
 * Synthetic disk images for the phase 5 tests, in each container `DiskImage` reads: JV1 (a
 * headerless dump), JV3 (the 2,901-entry header table), and DMK (raw double-density tracks behind
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

/**
 * A JV3: one header entry (track, sector, flags) per sector, 256-byte sectors, flags 0x80 for
 * double density and 0x10 for side 1; free entries are FF FF FF, and the last header byte is FF
 * for a writable disk.
 * @param {{ tracks?: number, spt?: number, sides?: 1 | 2, base?: number, dd?: boolean, writeProtected?: boolean, fill?: Fill }} [opts]
 */
export function writeJv3({ tracks = 40, spt = 18, sides = 1, base = 1, dd = true, writeProtected = false, fill } = {}) {
  const count = tracks * sides * spt;
  if (count > JV3_ENTRIES) throw new Error(`writeJv3: ${count} sectors do not fit the ${JV3_ENTRIES}-entry header`);
  const bytes = new Uint8Array(JV3_HEADER + count * SECTOR);
  bytes.fill(0xff, 0, JV3_HEADER);
  if (writeProtected) bytes[JV3_HEADER - 1] = 0x00;
  let i = 0;
  for (let t = 0; t < tracks; t++) {
    for (let side = 0; side < sides; side++) {
      for (let s = 0; s < spt; s++, i++) {
        bytes[i * 3] = t;
        bytes[i * 3 + 1] = base + s;
        bytes[i * 3 + 2] = (dd ? 0x80 : 0x00) | (side ? 0x10 : 0x00); // size code 0: 256 bytes
        bytes.set(sectorBytes(fill, t, side, base + s), JV3_HEADER + i * SECTOR);
      }
    }
  }
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
 * A DMK of double-density (MFM) tracks in the IBM System 34 layout: index gap and mark, then per
 * sector a sync run, A1 A1 A1 FE, the ID (track, side, sector, size code 1), its CRC, a gap, a sync
 * run, A1 A1 A1 FB, 256 data bytes, and their CRC. Each track's IDAM table holds the offset of each
 * FE from the track start, with bit 15 set for MFM. The header: write protect (FF or 00), track
 * count, track length (little-endian), flags (bit 4: single-sided), and zeros.
 * @param {{ tracks?: number, spt?: number, sides?: 1 | 2, base?: number, writeProtected?: boolean, fill?: Fill }} [opts]
 */
export function writeDmk({ tracks = 40, spt = 18, sides = 1, base = 1, writeProtected = false, fill } = {}) {
  /** @type {{ raw: number[], ptrs: number[] }[]} */
  const regions = [];
  for (let t = 0; t < tracks; t++) {
    for (let side = 0; side < sides; side++) {
      const raw = [];
      const ptrs = [];
      const run = (n, v) => {
        for (let k = 0; k < n; k++) raw.push(v);
      };
      run(32, 0x4e);
      run(12, 0x00);
      raw.push(0xc2, 0xc2, 0xc2, 0xfc);
      run(32, 0x4e);
      for (let s = 0; s < spt; s++) {
        run(12, 0x00);
        raw.push(0xa1, 0xa1, 0xa1);
        ptrs.push((DMK_IDAM_TABLE + raw.length) | 0x8000);
        const id = [0xfe, t, side, base + s, 0x01];
        const idCrc = crc16([0xa1, 0xa1, 0xa1, ...id]);
        raw.push(...id, idCrc >> 8, idCrc & 0xff);
        run(22, 0x4e);
        run(12, 0x00);
        raw.push(0xa1, 0xa1, 0xa1);
        const data = sectorBytes(fill, t, side, base + s);
        const dCrc = crc16([0xa1, 0xa1, 0xa1, 0xfb, ...data]);
        raw.push(0xfb, ...data, dCrc >> 8, dCrc & 0xff);
        run(24, 0x4e);
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
  bytes[4] = sides === 1 ? 0x10 : 0x00;
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

/**
 * A boot sector (track 0, sector 1) that copies `message` to the top line of video RAM ($3C00)
 * and spins. The Model III ROM reads that sector to $4300 and jumps there (ROM $34DD-$34FF loads
 * HL with $4300 and reads sector 1 with INI; the NMI that ends the read lands at $3502, which
 * jumps to $4300 when the status has no CRC, not-found, or lost-data bit, `AND 1CH`).
 * @param {string} message
 */
export function bootSector(message) {
  const at = 0x20;
  const code = [
    0x21, (BOOT_ORG + at) & 0xff, (BOOT_ORG + at) >> 8, // LD HL,message
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
