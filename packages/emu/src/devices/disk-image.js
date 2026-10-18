/**
 * TRS-80 disk images in memory: read JV1, JV3, and DMK exactly, write in place, export DMK.
 *
 * The containers, as Tim Mann's format notes (the xtrs distribution's "TRS-80 Disk Formats")
 * define them:
 *
 *   JV1 — a headerless dump, single-sided, 256-byte sectors in track order. Jeff Vavasour's
 *         format is single density with 10 sectors per track numbered 0-9 (Model I); the
 *         Model III images of TRSDOS 1.3 are the same dump with 18 double-density sectors
 *         numbered 1-18. The file size is the only evidence, so only 35, 40, 77, or 80 tracks
 *         of 10 or 18 sectors count, and the geometry fixes the numbering (a Model I's drives
 *         take 10-sector JV1s of 35 to 42 tracks too: `jv1SdTracks`). JV1 records no density,
 *         data mark, or CRC: its IDs read in either density, and the directory track's marks
 *         are synthesized: FA on a 10-sector disk, the mark Model I TRSDOS writes its
 *         directory with for the WD1771, F8 on an 18-sector one.
 *
 *   JV3 — blocks of 2,901 three-byte sector headers (track, sector, flags) and a write-protect
 *         byte (FF writable, anything else protected), each block followed by the data of its
 *         sectors in header order. A free header (track and sector FF) still owns its data
 *         area, sized by the free entries' size code, so the sectors after it keep their
 *         offsets; the untouched FF FF FF entries at the end own nothing that is in the file.
 *         A second header block, when there is one, starts after the first block's whole data
 *         area. Flags: 80 double density; 60 the data address mark (single density: 00 FB,
 *         20 FA, 40 F9, 60 F8; double density: 00 FB, 20 F8); 10 side 1; 08 CRC error; 04
 *         non-IBM; 03 the size (used: 256, 128, 1024, 512; free: 512, 1024, 128, 256).
 *
 *   DMK — a 16-byte header (write protect FF or 00, track count, track length little-endian,
 *         flags: 10 single-sided, 40 single-density bytes stored once, 80 ignore density;
 *         bytes 12-15 nonzero mark a real-drive image, which is refused), then each track
 *         side: 64 IDAM pointers (the offset of the FE ID mark from the track start, bit 15
 *         set for an MFM ID, zero ending the table) and the raw track bytes. Single-density
 *         bytes are stored twice unless flag 40 or 80 says otherwise; a track may mix
 *         densities.
 *
 * Writes change the in-memory image only (the session's copy); `bytes` is always the image's
 * truth, what a snapshot saves, and `toDMK()` writes any of the three as a DMK (spec §6: read
 * all three, write DMK only).
 */

const JV3_ENTRIES = 2901;

// The JV1 geometries a real disk has: sectors per track (Model III
// double density, Model I single density) and track counts (35- and
// 40-track 5.25" drives, 77-track 8", 80-track 5.25").
const JV1_SPT = [18, 10];
const JV1_TRACKS = [35, 40, 77, 80];

/**
 * The track counts a 10-sector JV1 may have on a Model I (`jv1SdTracks`, passed by `m.fdc.mount`
 * on a Model I). Model I archives hold single-density JV1s of 35 tracks (TRSDOS 2.3's 35, Super
 * Utility Tech Manual p. 3, "TRSDOS 2.3") and of up to 40 and beyond, as drives and DOSes that
 * format 36 to 42 tracks wrote them; xtrs takes any whole number of 2,560-byte tracks. Accepted
 * here: 35 to 42, 77, and 80, single-sided. A file of another length still refuses, so a .CMD
 * does not mount as a short JV1 (phase 6 plan, Task 3 ruling; spec §5).
 */
export const JV1_MODEL1_SD_TRACKS = Object.freeze([35, 36, 37, 38, 39, 40, 41, 42, 77, 80]);

/** "35, 40, 77, 80" or, for a run of consecutive counts, "35-42, 77, 80". */
function trackList(list) {
  const out = [];
  for (let i = 0; i < list.length; ) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out.push(j - i >= 2 ? `${list[i]}-${list[j]}` : list.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}
const JV3_HEADER_SIZE = JV3_ENTRIES * 3 + 1;
const JV3_FREE = 0xff;

// JV3 flag bits
const F_DD = 0x80;
const F_DAM = 0x60; // data address mark code (0x00 = normal 0xFB)
const F_SIDE = 0x10;
const F_CRC_ERROR = 0x08;

/** The data size a JV3 header's size code gives: used and free entries number them differently. */
function jv3SectorSize(flags, free) {
  const code = flags & 0x03;
  return free ? [512, 1024, 128, 256][code] : [256, 128, 1024, 512][code];
}

const JV3_SIZE_CODE = { 256: 0x00, 128: 0x01, 1024: 0x02, 512: 0x03 };

/** The data address mark a JV3 flags byte records. */
function jv3Dam(flags) {
  const code = flags & F_DAM;
  if (flags & F_DD) return code === 0 ? 0xfb : 0xf8;
  return [0xfb, 0xfa, 0xf9, 0xf8][code >> 5];
}

/** The JV3 flags bits for a data address mark at a density. */
function jv3DamBits(dam, dd) {
  if (dam === 0xfb) return 0x00;
  if (dd) return 0x20; // F8; MFM has no code for FA or F9
  return { 0xfa: 0x20, 0xf9: 0x40, 0xf8: 0x60 }[dam] ?? 0x60;
}

// The WD1793 sets Record Type (status bit 5) for a deleted data mark,
// F8 ("Status Register Summary"); the sheet names only FB and F8. Of the
// FM marks the WD1771 also writes, the Model III's 1793 "recognizes 'Read
// Protected' [FA] and 'Standard Data' both as 'Standard Data'" and
// "'Deleted Data' and 'User Defined' [F8, F9] as 'Read Protected'"
// (Super Utility Tech Manual, Breeze/QSD 1982, p. 2): FA reads as normal,
// F9 as deleted (F9 unverified: spec §5). The WD1771 model reads `dam`
// itself (fdc-wd1771.js), not this.
const isDeleted = (dam) => dam === 0xf8 || dam === 0xf9;

// TRSDOS-family boot sectors name the directory cylinder in byte 2.
const DEFAULT_DIR_TRACK = 17;

// ---------------------------- DMK ----------------------------------
const DMK_HEADER = 16;
const DMK_IDAM_TABLE = 128;
const DMK_IDAMS = 64;
/** The usual 5.25" double-density DMK track length: the IDAM table and 6,272 raw bytes. */
const DMK_TRACK_LEN = 0x1900;
const DMK_SINGLE_SIDED = 0x10;
const DMK_SD_SINGLE_BYTE = 0x40;
const DMK_IGNORE_DENSITY = 0x80;

const SIZE_CODE = { 128: 0, 256: 1, 512: 2, 1024: 3 };

/** CRC-CCITT, the checksum the WD1793 writes after ID and data fields. */
function crc16(bytes, init = 0xffff) {
  let crc = init;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * @typedef {{ sector: number, data: ArrayLike<number>, track?: number, side?: number,
 *   size?: number, sizeCode?: number, mfm?: boolean | null, deleted?: boolean, dam?: number,
 *   idCrcOk?: boolean, dataCrcOk?: boolean }} TrackSector
 */

/**
 * Lay one DMK track's raw bytes from its sectors, in the FD179X data sheet's track formats ("IBM
 * System 34 Format" for MFM sectors, "IBM 3740 Format" for FM ones) with shortened gaps: an index
 * area in the first sector's density, then per sector its gap, the sync zeros (and A1s in MFM),
 * the ID field and its CRC, Gap II, the sync again, the data mark, the data, and its CRC. FM
 * bytes are stored twice when `doubled`. A sector with `idCrcOk` or `dataCrcOk` false gets that
 * CRC inverted, so a bad CRC exports as bad. `tight` uses the data sheet's "Non-IBM Formats"
 * minimum gaps. Returns the raw bytes and the IDAM pointers (offsets from the raw start).
 * @param {number} cyl
 * @param {number} side
 * @param {TrackSector[]} sectors
 * @param {boolean} doubled
 * @param {boolean} tight
 */
function layDmkTrack(cyl, side, sectors, doubled, tight) {
  /** @type {number[]} */
  const raw = [];
  /** @type {number[]} */
  const ptrs = [];
  const put = (v, mfm) => {
    raw.push(v);
    if (!mfm && doubled) raw.push(v);
  };
  const run = (n, v, mfm) => {
    for (let k = 0; k < n; k++) put(v, mfm);
  };
  const firstMfm = sectors.length === 0 || sectors[0].mfm !== false;
  if (firstMfm) {
    run(tight ? 16 : 32, 0x4e, true);
    run(12, 0x00, true);
    for (const v of [0xc2, 0xc2, 0xc2, 0xfc]) put(v, true);
  } else {
    run(tight ? 8 : 16, 0xff, false);
    run(6, 0x00, false);
    put(0xfc, false);
  }
  for (const s of sectors) {
    const mfm = s.mfm !== false;
    const gap = mfm ? 0x4e : 0xff;
    const size = s.size ?? s.data.length;
    const sync = mfm ? [0xa1, 0xa1, 0xa1] : [];
    run(mfm ? (tight ? 8 : 24) : tight ? 6 : 12, gap, mfm);
    run(mfm ? 12 : 6, 0x00, mfm);
    for (const v of sync) put(v, mfm);
    ptrs.push(raw.length | (mfm ? 0x8000 : 0));
    const id = [0xfe, s.track ?? cyl, s.side ?? side, s.sector, s.sizeCode ?? SIZE_CODE[size] ?? 1];
    let idCrc = crc16([...sync, ...id]);
    if (s.idCrcOk === false) idCrc ^= 0xffff;
    for (const v of [...id, idCrc >> 8, idCrc & 0xff]) put(v, mfm);
    run(mfm ? 22 : 11, gap, mfm);
    run(mfm ? 12 : 6, 0x00, mfm);
    for (const v of sync) put(v, mfm);
    const mark = s.dam ?? (s.deleted ? 0xf8 : 0xfb);
    const data = new Uint8Array(size);
    for (let k = 0; k < size; k++) data[k] = s.data[k] ?? 0;
    let dataCrc = crc16([...sync, mark, ...data]);
    if (s.dataCrcOk === false) dataCrc ^= 0xffff;
    put(mark, mfm);
    for (const v of data) put(v, mfm);
    put(dataCrc >> 8, mfm);
    put(dataCrc & 0xff, mfm);
  }
  if (ptrs.length > DMK_IDAMS) {
    throw new Error(`A DMK track holds at most ${DMK_IDAMS} sectors; this one has ${ptrs.length}`);
  }
  return { raw, ptrs, fill: firstMfm ? 0x4e : 0xff };
}

/** Write a laid track into a DMK track region (IDAM table + raw bytes) of `trackLen` bytes. */
function dmkRegion(laid, trackLen) {
  const region = new Uint8Array(trackLen);
  laid.ptrs.forEach((p, i) => {
    const ptr = p + DMK_IDAM_TABLE;
    region[i * 2] = ptr & 0xff;
    region[i * 2 + 1] = ptr >> 8;
  });
  region.fill(laid.fill, DMK_IDAM_TABLE);
  region.set(laid.raw, DMK_IDAM_TABLE);
  return region;
}

/**
 * One DMK track region for freshly formatted sectors, IBM-style gaps, or the minimum gaps when
 * those do not fit the image's track length.
 */
function buildDmkTrackRegion(cyl, side, sectors, trackLen, doubled) {
  const capacity = trackLen - DMK_IDAM_TABLE;
  let laid = layDmkTrack(cyl, side, sectors, doubled, false);
  if (laid.raw.length > capacity) laid = layDmkTrack(cyl, side, sectors, doubled, true);
  if (laid.raw.length > capacity) {
    throw new Error(`Formatted track needs ${laid.raw.length} bytes; DMK track holds ${capacity}`);
  }
  return dmkRegion(laid, trackLen);
}

export class DiskImage {
  /**
   * @param {Uint8Array} bytes - raw .dsk contents
   * @param {string} name - display name (file name)
   * @param {{ format?: "dmk" | "jv3" | "jv1", dirTrack?: number, jv1SdTracks?: readonly number[] }} [opts] - `jv1SdTracks`: the
   *   track counts a 10-sector JV1 may have (35, 40, 77, 80 by default; a Model I passes
   *   JV1_MODEL1_SD_TRACKS); for a save state's
   *   disk, whose container is known: `format` parses the bytes as that container only, without
   *   the detection's plausibility floor (a JV3 of fewer than ten sectors, which a format of a
   *   blank disk can leave, is a valid disk the session made); `dirTrack` restores a JV1's
   *   directory track as it was mounted (a guest rewrite of track 0, sector 0 changes byte 2, which
   *   is read only at mount).
   */
  constructor(bytes, name = "disk", { format, dirTrack, jv1SdTracks = JV1_TRACKS } = {}) {
    this.name = name;
    this.bytes = new Uint8Array(bytes); // private working copy
    this.writeProtected = false;
    this.format = null; // "dmk" | "jv3" | "jv1"
    this.sectorBase = null; // JV1: the first sector number, 0 or 1, from the geometry

    if (format !== undefined) {
      const parsed =
        format === "dmk"
          ? this._tryParseDMK()
          : format === "jv3"
            ? this._tryParseJV3(false)
            : format === "jv1"
              ? this._tryParseJV1(JV1_MODEL1_SD_TRACKS) // a mounted JV1: any geometry a mount took
              : false;
      if (!parsed) throw new Error(`Disk image (${bytes.length} bytes) does not parse as ${String(format)}`);
      this.format = format;
      if (format === "jv1" && dirTrack !== undefined) this.dirTrack = dirTrack;
    } else if (this._tryParseDMK()) {
      this.format = "dmk";
    } else if (this._tryParseJV3()) {
      this.format = "jv3";
    } else if (this._tryParseJV1(jv1SdTracks)) {
      this.format = "jv1";
    } else {
      const sizes =
        trackList(jv1SdTracks) === trackList(JV1_TRACKS)
          ? `${trackList(JV1_TRACKS)} tracks of ${JV1_SPT.join(" or ")} 256-byte sectors`
          : `${trackList(JV1_TRACKS)} tracks of 18 256-byte sectors, or ${trackList(jv1SdTracks)} tracks of 10`;
      throw new Error(
        `Unrecognized disk image (${bytes.length} bytes): no DMK header, no JV3 sector table, and not a JV1 size (${sizes})`
      );
    }
  }

  _tryParseDMK() {
    const b = this.bytes;
    if (b.length < DMK_HEADER) return false;
    const tracks = b[1];
    const trackLen = b[2] | (b[3] << 8);
    const flags = b[4];
    // The header's defined values only: write protect FF or 00, flags 10, 40, 80; a track long
    // enough for the IDAM table and short enough for its 14-bit offsets.
    if (b[0] !== 0x00 && b[0] !== 0xff) return false;
    if (flags & ~(DMK_SINGLE_SIDED | DMK_SD_SINGLE_BYTE | DMK_IGNORE_DENSITY)) return false;
    if (trackLen < 0x100 || trackLen > 0x4000) return false;
    if (b[12] | b[13] | b[14] | b[15]) return false; // real-drive marker
    if (tracks > 96) return false;
    // A DMK with no tracks is an unformatted disk (what toDMK writes for a blank one); it is
    // taken as double-sided so a format of either side fits.
    const sides = flags & DMK_SINGLE_SIDED ? 1 : 2;
    if (b.length !== DMK_HEADER + tracks * sides * trackLen) return false;
    // Every IDAM pointer before the table's end must point into its track.
    for (let i = 0; i < tracks * sides; i++) {
      const base = DMK_HEADER + i * trackLen;
      for (let k = 0; k < DMK_IDAMS; k++) {
        const ptr = b[base + k * 2] | (b[base + k * 2 + 1] << 8);
        if (!ptr) break;
        const off = ptr & 0x3fff;
        if (off < DMK_IDAM_TABLE || off >= trackLen) return false;
      }
    }

    this.dmk = {
      tracks,
      trackLen,
      sides,
      sdSingleByte: (flags & DMK_SD_SINGLE_BYTE) !== 0,
      ignoreDensity: (flags & DMK_IGNORE_DENSITY) !== 0,
    };
    this.writeProtected = b[0] === 0xff;
    this._dmkCache = new Map();
    return true;
  }

  _dmkTrackBase(track, side) {
    const { tracks, trackLen, sides } = this.dmk;
    if (track >= tracks || side >= sides) return -1;
    const index = sides === 1 ? track : track * 2 + side;
    return DMK_HEADER + index * trackLen;
  }

  /** Parse (and cache) one DMK track's sector layout from its IDAMs. */
  _dmkSectors(track, side) {
    const key = `${track}:${side}`;
    if (this._dmkCache.has(key)) return this._dmkCache.get(key);
    const out = [];
    const base = this._dmkTrackBase(track, side);
    if (base >= 0) {
      const { trackLen, sdSingleByte, ignoreDensity } = this.dmk;
      const b = this.bytes;
      for (let i = 0; i < DMK_IDAMS; i++) {
        const ptr = b[base + i * 2] | (b[base + i * 2 + 1] << 8);
        if (!ptr) break; // unused table entries are zero
        const mfm = (ptr & 0x8000) !== 0;
        const off = ptr & 0x3fff;
        // FM bytes are stored twice unless the header says single bytes (flag 40) or density
        // is ignored (flag 80, where every byte is stored once).
        const step = mfm || sdSingleByte || ignoreDensity ? 1 : 2;
        const at = (k) => (off + k * step < trackLen ? b[base + off + k * step] : -1);
        if (at(0) !== 0xfe) continue;
        const sector = at(3);
        const size = 128 << (at(4) & 3);
        // "Read Sector": the data address mark (F8-FB, "Control Bytes for Initialization") must
        // be found within 30 bytes in FM and 43 in MFM of the last ID CRC byte. In MFM a mark
        // is preceded by its A1 sync bytes.
        let dataOff = -1;
        let dam = 0xfb;
        const limit = 6 + (mfm ? 43 : 30);
        for (let k = 7; k <= limit; k++) {
          const byte = at(k);
          if (byte >= 0xf8 && byte <= 0xfb && (!mfm || at(k - 1) === 0xa1)) {
            dataOff = off + (k + 1) * step;
            dam = byte;
            break;
          }
        }
        // An ID with no data mark in the window is still an ID: Read Address and a Type I verify
        // read it, and Write Sector writes its data field after it (`_dmkWriteSector`), but "Read
        // Sector" finds no data there: "the ID field is searched for and verified again", and
        // after the search window, Record Not Found (FD179X data sheet, "Read Sector").
        const sync = mfm ? [0xa1, 0xa1, 0xa1] : [];
        const id = [0xfe, at(1), at(2), sector, at(4)];
        const idCrcOk = crc16([...sync, ...id]) === ((at(5) << 8) | at(6));
        if (dataOff < 0) {
          out.push({
            sector, size, dam: null, deleted: false, mfm: ignoreDensity ? null : mfm, recordedMfm: mfm, step, dataOff: -1,
            off, idTrack: at(1), idSide: at(2), sizeCode: at(4) & 3,
            idCrcOk, dataCrcOk: false, noData: true,
          });
          continue;
        }
        if (dataOff >= trackLen) continue;
        // The ID and data fields' CRCs as the WD1793 checks them (FD179X data sheet, "Read
        // Sector" and "Read Address"): CRC-CCITT preset FFFF over the address mark and the field,
        // and in MFM over the three A1 sync bytes before the mark too.
        // A field cut off by the end of the track reads as bad.
        const dataAt = (k) => (dataOff + k * step < trackLen ? b[base + dataOff + k * step] : -1);
        const field = [dam];
        for (let k = 0; k < size; k++) field.push(dataAt(k));
        const dataCrc = (dataAt(size) << 8) | dataAt(size + 1);
        const dataCrcOk = !field.includes(-1) && dataAt(size + 1) >= 0 && crc16([...sync, ...field]) === dataCrc;
        out.push({
          sector, size, dam, deleted: isDeleted(dam), mfm: ignoreDensity ? null : mfm, recordedMfm: mfm, step, dataOff,
          off, idTrack: at(1), idSide: at(2), sizeCode: at(4) & 3,
          idCrcOk, dataCrcOk, noData: false,
        });
      }
    }
    this._dmkCache.set(key, out);
    return out;
  }

  _dmkExtend(newTrackCount) {
    const { trackLen, sides } = this.dmk;
    const grown = new Uint8Array(DMK_HEADER + newTrackCount * sides * trackLen);
    grown.set(this.bytes, 0);
    grown[1] = newTrackCount;
    // Tracks not yet formatted: an empty IDAM table and gap bytes.
    for (let i = this.dmk.tracks * sides; i < newTrackCount * sides; i++) {
      grown.fill(0x4e, DMK_HEADER + i * trackLen + DMK_IDAM_TABLE, DMK_HEADER + (i + 1) * trackLen);
    }
    this.bytes = grown;
    this.dmk.tracks = newTrackCount;
  }

  /**
   * Read the JV3 header blocks. Each used entry gets its data's offset; free entries advance the
   * offset by their own size (see the file comment). Garbage is refused: an entry with a track
   * over 96 or a sector over 63, or data running past the end of the file, means it is no JV3.
   * `detect` adds the floor detection needs (ten sectors, or a blank disk); a known JV3 skips it.
   */
  _tryParseJV3(detect = true) {
    const b = this.bytes;
    if (b.length < JV3_HEADER_SIZE) return false;

    const map = [];
    let blockAt = 0;
    for (let block = 0; block < 2; block++) {
      if (block > 0 && b.length < blockAt + JV3_HEADER_SIZE) break;
      let dataOffset = blockAt + JV3_HEADER_SIZE;
      for (let i = 0; i < JV3_ENTRIES; i++) {
        const at = blockAt + i * 3;
        const track = b[at];
        const sector = b[at + 1];
        const flags = b[at + 2];
        const free = track === JV3_FREE && sector === JV3_FREE;
        const size = jv3SectorSize(flags, free);
        if (!free) {
          if (track > 96 || sector > 63) return false;
          if (dataOffset + size > b.length) return false;
          map.push({
            track,
            sector,
            side: flags & F_SIDE ? 1 : 0,
            offset: dataOffset,
            size,
            flagsAt: at + 2, // to update the flags byte on DAM-changing writes
          });
        }
        dataOffset += size;
      }
      blockAt = dataOffset;
    }
    // A real disk has many sectors; an exactly-header-sized all-free
    // image is a valid BLANK disk (DiskImage.blank, and its export /
    // save-state round trip) waiting for a DOS FORMAT.
    if (detect && map.length < 10 && !(map.length === 0 && b.length === JV3_HEADER_SIZE)) {
      return false;
    }

    this.jv3Map = map;
    // Last header byte: 0xff = writable, anything else = write-protected
    this.writeProtected = b[JV3_HEADER_SIZE - 1] !== 0xff;
    return true;
  }

  /** A blank, writable, unformatted disk — FORMAT makes it real. */
  static blank(name = "blank.dsk") {
    return new DiskImage(new Uint8Array(JV3_HEADER_SIZE).fill(0xff), name);
  }

  /** @param {readonly number[]} [sdTracks] the track counts a 10-sector JV1 may have */
  _tryParseJV1(sdTracks = JV1_TRACKS) {
    // JV1 has no header, so its size is the only evidence: accept only
    // a geometry a real disk has, 10 sectors per track (Model I single
    // density) or 18 (Model III double density) on 35, 40, 77, or 80
    // tracks (10-sector: `sdTracks`). Anything else (a .CMD, a text file)
    // would otherwise mount as a short JV1 whose garbage the ROM then
    // boots. No two of these sizes coincide (10-sector tracks 35-42, 77,
    // 80 and 18-sector 35, 40, 77, 80), so the geometry is never ambiguous.
    const size = this.bytes.length;
    let chosen = null;
    for (const spt of JV1_SPT) {
      for (const tracks of spt === 10 ? sdTracks : JV1_TRACKS) {
        if (size === tracks * spt * 256) chosen = { spt, tracks };
      }
    }
    if (chosen === null) return false;

    this.sectorsPerTrack = chosen.spt;
    this.tracks = chosen.tracks;
    // Model III 18-sector disks number sectors 1-18 (TRSDOS 1.3); Model I
    // 10-sector disks number 0-9 (JV1 as Vavasour defined it).
    this.sectorBase = chosen.spt === 18 ? 1 : 0;
    // JV1 carries no DAM info, but DOSes verify the deleted mark on
    // directory reads — synthesize it for the directory track the boot
    // sector names (byte 2), as xtrs does for its fixed track 17. A
    // 10-sector (single-density, Model I) disk's directory is FA: the
    // Model I DOSes write data "STANDARD" and the directory "READ
    // PROTECTED", the WD1771 write command A9H, a1 a0 = 01, FA (Super
    // Utility Tech Manual, Breeze/QSD 1982, p. 20 "@WRTYPE" and p. 61;
    // FD1771-01 data sheet, Table 4). The 1771 reports it as written
    // (record type 01); the WD1793 model reads it as normal (isDeleted,
    // above), as the Model III's 1793 does. An 18-sector
    // disk's is F8, the only MFM deleted mark (Model III TRSDOS: A1H).
    this.dirDam = chosen.spt === 10 ? 0xfa : 0xf8;
    const bootDir = this.bytes[2];
    this.dirTrack =
      bootDir >= 1 && bootDir < this.tracks ? bootDir : DEFAULT_DIR_TRACK;
    return true;
  }

  /** Highest track number present (for FDC seek bounds). */
  trackCount() {
    if (this.format === "dmk") return this.dmk.tracks;
    if (this.format === "jv1") return this.tracks;
    if (this.jv3Map.length === 0) return 0; // blank disk
    return Math.max(...this.jv3Map.map((e) => e.track)) + 1;
  }

  /** Sides the image holds: a DMK's header says; a JV3 has two when any sector is on side 1. */
  sideCount() {
    if (this.format === "dmk") return this.dmk.sides;
    if (this.format === "jv3" && this.jv3Map.some((e) => e.side === 1)) return 2;
    return 1;
  }

  /**
   * The ID fields present on one track, in map order — what READ
   * ADDRESS shows a verifying FORMAT. Size codes are the IBM ones the
   * 1793 reports (0=128 ... 3=1024).
   */
  sectorsOn(track, side) {
    return this.trackIds(track, side).map((id) => ({ sector: id.sector, sizeCode: id.sizeCode }));
  }

  /** JV3 entries on one track side, in header order (rotational order). */
  _jv3Entries(track, side) {
    return this.jv3Map.filter((e) => e.track === track && e.side === side);
  }

  /**
   * The ID fields on one track side as the controller meets them in a revolution, for the WD1793's
   * ID search (FD179X data sheet, "Type II Commands"): each with the ID's track, side, sector, and
   * size code, its density (`mfm`: true, false, or null when the container does not record it, as
   * in JV1), where its address mark passes as a fraction of a revolution from the index pulse
   * (`pos`), how many bytes after that mark the first data byte comes (`dataGap`), whether its ID
   * and data CRCs are good, its data address mark (`dam`, F8-FB) and record type, and its place in
   * this list (`index`, which `readSectorEx` and `writeSector` take to reach this very ID when two
   * share a sector number). DMK gives all of these from the raw track. JV1 and JV3 hold only
   * sectors, so their IDs carry the physical track and side, are spaced evenly round the track in
   * image order, and use the IBM gaps of the data sheet's "IBM Track Format" (an ID field of 7
   * bytes, then Gap II, the sync zeros, the A1s in MFM, and the data mark: 45 bytes in MFM, 25 in
   * FM). JV3's flag bit 3 marks a data CRC error. A DMK ID with no data mark within the data
   * sheet's window has `noData` true, `dataGap` and `dam` null, and a bad data CRC.
   * @returns {{track:number, side:number, sector:number, sizeCode:number, size:number,
   *   mfm:boolean|null, pos:number, dataGap:number|null, idCrcOk:boolean, dataCrcOk:boolean,
   *   dam:number|null, deleted:boolean, index:number, noData?:boolean}[]}
   */
  trackIds(track, side) {
    const gap = (mfm) => (mfm === false ? 25 : 45);
    if (this.format === "dmk") {
      const raw = this.dmk.trackLen - DMK_IDAM_TABLE;
      return this._dmkSectors(track, side).map((s, index) => ({
        track: s.idTrack,
        side: s.idSide,
        sector: s.sector,
        sizeCode: s.sizeCode,
        size: s.size,
        mfm: s.mfm,
        pos: (s.off - DMK_IDAM_TABLE) / raw,
        dataGap: s.noData ? null : (s.dataOff - s.off) / s.step,
        idCrcOk: s.idCrcOk,
        dataCrcOk: s.dataCrcOk,
        dam: s.dam,
        deleted: s.deleted,
        index,
        noData: s.noData,
      }));
    }
    if (this.format === "jv1") {
      if (side !== 0 || track >= this.tracks) return [];
      const n = this.sectorsPerTrack;
      const dam = track === this.dirTrack ? this.dirDam : 0xfb;
      return Array.from({ length: n }, (_, i) => ({
        track,
        side,
        sector: this.sectorBase + i,
        sizeCode: 1,
        size: 256,
        mfm: null,
        pos: (i + 0.5) / n,
        dataGap: 45,
        idCrcOk: true,
        dataCrcOk: true,
        dam,
        deleted: isDeleted(dam),
        index: i,
      }));
    }
    const entries = this._jv3Entries(track, side);
    return entries.map((e, i) => {
      const flags = this.bytes[e.flagsAt];
      const mfm = (flags & F_DD) !== 0;
      const dam = jv3Dam(flags);
      return {
        track,
        side,
        sector: e.sector,
        sizeCode: SIZE_CODE[e.size] ?? 1,
        size: e.size,
        mfm,
        pos: (i + 0.5) / entries.length,
        dataGap: gap(mfm),
        idCrcOk: true,
        dataCrcOk: (flags & F_CRC_ERROR) === 0,
        dam,
        deleted: isDeleted(dam),
        index: i,
      };
    });
  }

  /**
   * A DMK track side's raw bytes (what READ TRACK returns), or null for the sector containers,
   * which keep no raw track. `doubled` says single-density bytes are stored twice.
   * @returns {{bytes: Uint8Array, doubled: boolean}|null}
   */
  rawTrack(track, side) {
    if (this.format !== "dmk") return null;
    const base = this._dmkTrackBase(track, side);
    if (base < 0) return null;
    return {
      bytes: this.bytes.slice(base + DMK_IDAM_TABLE, base + this.dmk.trackLen),
      doubled: !this.dmk.sdSingleByte && !this.dmk.ignoreDensity,
    };
  }

  /**
   * Find a sector's byte range in a JV1 or JV3: by its place in the track's ID list when `index`
   * is given (and its sector number matches), else the first ID with that sector number.
   * @returns {{offset:number, size:number, entry:object|null}|null}
   */
  _locate(track, side, sector, index) {
    if (this.format === "jv3") {
      const entries = this._jv3Entries(track, side);
      const hit =
        index !== undefined
          ? entries[index]?.sector === sector
            ? entries[index]
            : undefined
          : entries.find((e) => e.sector === sector);
      return hit ? { offset: hit.offset, size: hit.size, entry: hit } : null;
    }

    if (side !== 0 || track >= this.tracks) return null; // JV1 is single-sided
    const i = sector - this.sectorBase;
    if (i < 0 || i >= this.sectorsPerTrack) return null;
    if (index !== undefined && index !== i) return null;
    return { offset: (track * this.sectorsPerTrack + i) * 256, size: 256, entry: null };
  }

  /**
   * A DMK track's parsed sector: by list place when `index` is given, else by sector number, an ID
   * with a data field first.
   */
  _dmkHit(track, side, sector, index) {
    const list = this._dmkSectors(track, side);
    if (index !== undefined) return list[index]?.sector === sector ? list[index] : undefined;
    return list.find((s) => s.sector === sector && !s.noData) ?? list.find((s) => s.sector === sector);
  }

  /**
   * Read a sector with its record type, the way the FDC sees it.
   * @param {number} [index] the ID's place in `trackIds(track, side)`, for a track where two IDs
   *   carry the same sector number
   * @returns {{data: Uint8Array, deleted: boolean, dam: number}|null}
   */
  readSectorEx(track, side, sector, index) {
    if (this.format === "dmk") {
      const hit = this._dmkHit(track, side, sector, index);
      if (!hit || hit.noData) return null;
      const base = this._dmkTrackBase(track, side);
      const { trackLen } = this.dmk;
      const data = new Uint8Array(hit.size);
      for (let k = 0; k < hit.size; k++) {
        const at = hit.dataOff + k * hit.step;
        data[k] = at < trackLen ? this.bytes[base + at] : 0;
      }
      return { data, deleted: hit.deleted, dam: hit.dam };
    }
    const loc = this._locate(track, side, sector, index);
    if (!loc) return null;
    const dam = loc.entry
      ? jv3Dam(this.bytes[loc.entry.flagsAt])
      : track === this.dirTrack
        ? this.dirDam
        : 0xfb;
    return {
      data: this.bytes.slice(loc.offset, loc.offset + loc.size),
      deleted: isDeleted(dam),
      dam,
    };
  }

  /** @returns {Uint8Array|null} a copy of the sector data */
  readSector(track, side, sector) {
    return this.readSectorEx(track, side, sector)?.data ?? null;
  }

  /**
   * Replace one track's contents with freshly formatted sectors (the
   * tail end of a WD1793 WRITE TRACK). A DMK track is laid out again in
   * each sector's density. JV3 images rebuild their bytes wholesale —
   * `bytes` stays the exportable/serializable truth. A JV1 whose
   * geometry matches writes in place; one that doesn't (new track
   * count, sector numbering, or size) is promoted to JV3 in memory,
   * keeping every existing sector.
   *
   * @param {{sector:number, size?:number, deleted?:boolean, dam?:number,
   *          data:Uint8Array, mfm?:boolean, track?:number, side?:number}[]} sectors
   * @returns {boolean} true if the track was written
   */
  formatTrack(track, side, sectors) {
    if (this.writeProtected) return false;
    if (this.format === "dmk") {
      if (side >= this.dmk.sides) return false;
      if (track >= this.dmk.tracks) this._dmkExtend(track + 1);
      const doubled = !this.dmk.sdSingleByte && !this.dmk.ignoreDensity;
      const region = buildDmkTrackRegion(track, side, sectors, this.dmk.trackLen, doubled);
      this.bytes.set(region, this._dmkTrackBase(track, side));
      this._dmkCache.delete(`${track}:${side}`);
      return true;
    }
    if (this.format === "jv1") {
      if (this._jv1FormatInPlace(track, side, sectors)) return true;
      this._promoteToJV3();
    }

    // Keep every other track's entries with their original flags bytes
    const kept = this.jv3Map
      .filter((e) => !(e.track === track && e.side === side))
      .map((e) => ({
        track: e.track,
        sector: e.sector,
        flags: this.bytes[e.flagsAt],
        data: this.bytes.slice(e.offset, e.offset + e.size),
      }));

    const fresh = sectors.map((s) => {
      const mfm = s.mfm !== false;
      const size = s.size ?? s.data.length;
      let flags = JV3_SIZE_CODE[size] ?? 0x00;
      if (side) flags |= F_SIDE;
      if (mfm) flags |= F_DD;
      flags |= jv3DamBits(s.dam ?? (s.deleted ? 0xf8 : 0xfb), mfm);
      return {
        track,
        sector: s.sector,
        flags,
        data: new Uint8Array(s.data.subarray(0, size)),
      };
    });

    this._rebuildJV3([...kept, ...fresh]);
    return true;
  }

  /** Write into the raw track bytes in place, CRCs recomputed; `mark` is the data mark, F8-FB. */
  _dmkWriteSector(track, side, sector, data, mark, index) {
    const hit = this._dmkHit(track, side, sector, index);
    if (!hit) return false;
    const base = this._dmkTrackBase(track, side);
    const { trackLen } = this.dmk;
    const put = (rawOff, v) => {
      if (rawOff < trackLen) this.bytes[base + rawOff] = v;
      if (hit.step === 2 && rawOff + 1 < trackLen) this.bytes[base + rawOff + 1] = v;
    };

    let dataOff = hit.dataOff;
    if (hit.noData) {
      // No data field yet: lay it where Write Sector puts it ("Write Sector"): after the ID's
      // seven bytes, 22 bytes (MFM) or 11 (FM) of Gap II, then 12 or 6 zeros, the A1s in MFM, and
      // the mark.
      const mfm = hit.recordedMfm;
      let k = 7 + (mfm ? 22 : 11);
      for (let z = 0; z < (mfm ? 12 : 6); z++) put(hit.off + k++ * hit.step, 0x00);
      if (mfm) for (let z = 0; z < 3; z++) put(hit.off + k++ * hit.step, 0xa1);
      dataOff = hit.off + (k + 1) * hit.step;
    }
    put(dataOff - hit.step, mark);
    const payload = new Uint8Array(hit.size);
    for (let k = 0; k < hit.size; k++) {
      payload[k] = data[k] ?? 0x00;
      put(dataOff + k * hit.step, payload[k]);
    }
    const crc = crc16(hit.recordedMfm ? [0xa1, 0xa1, 0xa1, mark, ...payload] : [mark, ...payload]);
    put(dataOff + hit.size * hit.step, crc >> 8);
    put(dataOff + (hit.size + 1) * hit.step, crc & 0xff);
    this._dmkCache.delete(`${track}:${side}`);
    return true;
  }

  /** True (and written) when the layout matches this JV1's geometry. */
  _jv1FormatInPlace(track, side, sectors) {
    if (side !== 0 || track >= this.tracks) return false;
    if (sectors.length !== this.sectorsPerTrack) return false;
    const base = this.sectorBase;
    const sorted = [...sectors].sort((a, b) => a.sector - b.sector);
    for (let i = 0; i < sorted.length; i++) {
      const size = sorted[i].size ?? sorted[i].data.length;
      if (sorted[i].sector !== base + i || size !== 256) return false;
    }
    for (const s of sorted) {
      const offset = (track * this.sectorsPerTrack + (s.sector - base)) * 256;
      this.bytes.set(s.data.subarray(0, 256), offset);
    }
    return true;
  }

  /** Convert this JV1 into an equivalent in-memory JV3. */
  _promoteToJV3() {
    const base = this.sectorBase;
    const dd = this.sectorsPerTrack === 18; // Model III 18-sector = DD
    const entries = [];
    for (let t = 0; t < this.tracks; t++) {
      for (let i = 0; i < this.sectorsPerTrack; i++) {
        let flags = 0x00; // size code 0 = 256 bytes
        if (dd) flags |= F_DD;
        if (t === this.dirTrack) flags |= jv3DamBits(this.dirDam, dd); // keep the DAM synthesis
        const offset = (t * this.sectorsPerTrack + i) * 256;
        entries.push({
          track: t,
          sector: base + i,
          flags,
          data: this.bytes.slice(offset, offset + 256),
        });
      }
    }
    this._rebuildJV3(entries);
  }

  /**
   * Rebuild bytes + map from {track, sector, flags, data} entries: one header block, or two when
   * there are more than 2,901 sectors.
   */
  _rebuildJV3(entries) {
    if (entries.length > 2 * JV3_ENTRIES) {
      throw new Error(`Disk needs ${entries.length} JV3 entries (max ${2 * JV3_ENTRIES})`);
    }
    const blocks = [entries.slice(0, JV3_ENTRIES)];
    if (entries.length > JV3_ENTRIES) blocks.push(entries.slice(JV3_ENTRIES));
    let total = 0;
    for (const block of blocks) {
      total += JV3_HEADER_SIZE;
      for (const e of block) total += e.data.length;
    }
    // A block that is followed by another must own the data of all its entries, so the next
    // block starts where a reader expects it: the first block is full when there are two.
    const bytes = new Uint8Array(total);
    const map = [];
    let at = 0;
    for (const block of blocks) {
      bytes.fill(0xff, at, at + JV3_HEADER_SIZE);
      let offset = at + JV3_HEADER_SIZE;
      block.forEach((e, i) => {
        bytes[at + i * 3] = e.track;
        bytes[at + i * 3 + 1] = e.sector;
        bytes[at + i * 3 + 2] = e.flags;
        bytes.set(e.data, offset);
        map.push({
          track: e.track,
          sector: e.sector,
          side: e.flags & F_SIDE ? 1 : 0,
          offset,
          size: e.data.length,
          flagsAt: at + i * 3 + 2,
        });
        offset += e.data.length;
      });
      at = offset;
    }
    this.bytes = bytes;
    this.jv3Map = map;
    this.format = "jv3";
  }

  /**
   * @param {{deleted?: boolean, dam?: number, index?: number}} [opts] - record type to
   *   write (WD1793 write-sector bit a0: F8 or FB; `dam`, when given, the
   *   mark itself, F8-FB, as the WD1771's a1 a0 choose it). JV3 stores it in the
   *   header flags — in the image bytes, so exports keep it — and clears
   *   the CRC error flag, since the write leaves a good CRC; JV1 has
   *   nowhere to put one and keeps synthesizing by directory track.
   *   `index` picks the ID by its place in `trackIds`, as `readSectorEx`.
   * @returns {boolean} true if written
   */
  writeSector(track, side, sector, data, { deleted = false, dam, index } = {}) {
    if (this.writeProtected) return false;
    const mark = dam ?? (deleted ? 0xf8 : 0xfb);
    if (this.format === "dmk") {
      return this._dmkWriteSector(track, side, sector, data, mark, index);
    }
    const loc = this._locate(track, side, sector, index);
    if (!loc) return false;
    this.bytes.set(data.subarray(0, loc.size), loc.offset);
    const entry = loc.entry;
    if (entry) {
      const flags = this.bytes[entry.flagsAt] & ~(F_DAM | F_CRC_ERROR);
      this.bytes[entry.flagsAt] = flags | jv3DamBits(mark, (flags & F_DD) !== 0);
    }
    return true;
  }

  /**
   * The image as a DMK file (spec §6: write DMK only). A DMK comes back as its own bytes, with
   * the header's write-protect byte following `writeProtected`. A JV1 or JV3 is laid out track by
   * track from `trackIds`: each ID in its order, with its track, side, sector, and size code, its
   * density, its data mark, and its CRCs (a JV3 CRC error stays an error), at the usual 5.25"
   * double-density track length (`0x1900`, longer only if a track needs it). JV1 records no
   * density, so its 10-sector tracks are written in FM and its 18-sector ones in MFM, the
   * densities those geometries are recorded in. A disk with no formatted track (a blank JV3)
   * becomes a DMK with no tracks, which a format extends.
   * @returns {Uint8Array}
   */
  toDMK() {
    if (this.format === "dmk") {
      const out = this.bytes.slice();
      out[0] = this.writeProtected ? 0xff : 0x00;
      return out;
    }
    const tracks = this.trackCount();
    const sides = tracks === 0 ? 2 : this.sideCount();
    const jv1Mfm = this.format === "jv1" ? this.sectorsPerTrack === 18 : true;
    const laid = [];
    for (let t = 0; t < tracks; t++) {
      for (let side = 0; side < sides; side++) {
        const sectors = this.trackIds(t, side).map((id) => ({
          track: id.track,
          side: id.side,
          sector: id.sector,
          size: id.size,
          sizeCode: id.sizeCode,
          mfm: id.mfm ?? jv1Mfm,
          dam: id.dam,
          idCrcOk: id.idCrcOk,
          dataCrcOk: id.dataCrcOk,
          data: this.readSectorEx(t, side, id.sector, id.index)?.data ?? new Uint8Array(id.size),
        }));
        laid.push(layDmkTrack(t, side, sectors, true, false));
      }
    }
    const trackLen = Math.max(DMK_TRACK_LEN, DMK_IDAM_TABLE + Math.max(0, ...laid.map((l) => l.raw.length)));
    const out = new Uint8Array(DMK_HEADER + laid.length * trackLen);
    out[0] = this.writeProtected ? 0xff : 0x00;
    out[1] = tracks;
    out[2] = trackLen & 0xff;
    out[3] = trackLen >> 8;
    out[4] = sides === 1 ? DMK_SINGLE_SIDED : 0x00;
    laid.forEach((l, i) => out.set(dmkRegion(l, trackLen), DMK_HEADER + i * trackLen));
    return out;
  }
}
