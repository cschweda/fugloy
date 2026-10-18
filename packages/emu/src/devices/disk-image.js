/**
 * TRS-80 disk image reader/writer (in-memory)
 *
 * Three containers:
 *
 *   JV1 — headerless linear dump: track 0 sector 0.. then track 1...,
 *         256-byte sectors. Model I images use 10 sectors/track (single
 *         density); Model III TRSDOS 1.3-style images use 18. Geometry is
 *         inferred from the file size, which must be 35, 40, 77, or 80
 *         tracks of 10 or 18 sectors; any other size is not a JV1.
 *
 *   JV3 — 2901 three-byte sector headers (track, sector, flags) + one
 *         write-protect byte, followed by sector data in header order.
 *         Free entries are 0xFF-filled.
 *
 *   DMK — 16-byte header (write-protect, track count, track length LE,
 *         flags) then raw track bytes behind a 128-byte IDAM pointer
 *         table per track (pointer = offset of the 0xFE ID byte from
 *         track start, bit 15 = MFM). Supported here: single- and
 *         double-sided, DD tracks and doubled-byte SD; freshly
 *         formatted tracks are always written as DD raw. Real-drive
 *         passthrough images (nonzero bytes 12-15) are rejected.
 *
 * Writes modify the in-memory image only (session-local); `bytes` is
 * always the exportable / serializable truth for every container.
 */

const JV3_ENTRIES = 2901;

// The JV1 geometries a real disk has: sectors per track (Model III
// double density, Model I single density) and track counts (35- and
// 40-track 5.25" drives, 77-track 8", 80-track 5.25").
const JV1_SPT = [18, 10];
const JV1_TRACKS = [35, 40, 77, 80];
const JV3_HEADER_SIZE = JV3_ENTRIES * 3 + 1;
const JV3_FREE = 0xff;

// JV3 flag bits
const F_SIDE = 0x10;
const F_DAM = 0x60; // data address mark code (0x00 = normal 0xFB)

function jv3SectorSize(flags, free) {
  // Size code meaning flips between used and free entries; used shown here
  const code = flags & 0x03;
  if (free) {
    return [512, 1024, 128, 256][code];
  }
  return [256, 128, 1024, 512][code];
}

// The WD1793 reports any non-0xFB mark as a deleted record (status bit
// 5). DOSes rely on it: directory sectors are written 0xF8 (or 0xFA on
// Model I TRSDOS) and verified on every directory read.
function jv3Deleted(flags) {
  return (flags & F_DAM) !== 0;
}

// TRSDOS-family boot sectors name the directory cylinder in byte 2.
const DEFAULT_DIR_TRACK = 17;

// ---------------------------- DMK ----------------------------------
const DMK_HEADER = 16;
const DMK_IDAM_TABLE = 128;

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
 * Build one canonical DD raw track (IDAM table + track bytes) from
 * formatted sectors. Falls back to minimal gaps when the standard IBM
 * layout wouldn't fit the image's track length.
 */
function buildDmkTrackRegion(cyl, side, sectors, trackLen) {
  const rawCapacity = trackLen - DMK_IDAM_TABLE;
  const perSector = (gap) => gap + 12 + 3 + 7 + 22 + 12 + 3 + 1 + 2;
  const need = (gap) =>
    48 + sectors.reduce((sum, s) => sum + perSector(gap) + (s.size ?? s.data.length), 0);
  let gap = 24;
  if (need(gap) > rawCapacity) gap = 8;
  if (need(gap) > rawCapacity) {
    throw new Error(`Formatted track needs ${need(gap)} bytes; DMK track holds ${rawCapacity}`);
  }

  const raw = [];
  const idamPtrs = [];
  const push = (...b) => raw.push(...b);
  for (let i = 0; i < 32; i++) push(0x4e);
  for (let i = 0; i < 12; i++) push(0x00);
  push(0xc2, 0xc2, 0xc2, 0xfc);
  for (const s of sectors) {
    const size = s.size ?? s.data.length;
    const sizeCode = { 128: 0, 256: 1, 512: 2, 1024: 3 }[size] ?? 1;
    for (let i = 0; i < gap; i++) push(0x4e);
    for (let i = 0; i < 12; i++) push(0x00);
    push(0xa1, 0xa1, 0xa1);
    idamPtrs.push((DMK_IDAM_TABLE + raw.length) | 0x8000);
    const id = [0xfe, s.track ?? cyl, s.side ?? side, s.sector, sizeCode];
    push(...id);
    const idCrc = crc16([0xa1, 0xa1, 0xa1, ...id]);
    push(idCrc >> 8, idCrc & 0xff);
    for (let i = 0; i < 22; i++) push(0x4e);
    for (let i = 0; i < 12; i++) push(0x00);
    push(0xa1, 0xa1, 0xa1);
    const mark = s.deleted ? 0xf8 : 0xfb;
    push(mark);
    const data = s.data.subarray ? s.data.subarray(0, size) : s.data.slice(0, size);
    for (const b of data) push(b);
    const dCrc = crc16([0xa1, 0xa1, 0xa1, mark, ...data]);
    push(dCrc >> 8, dCrc & 0xff);
  }
  while (raw.length < rawCapacity) push(0x4e);

  const region = new Uint8Array(trackLen);
  idamPtrs.forEach((p, i) => {
    region[i * 2] = p & 0xff;
    region[i * 2 + 1] = p >> 8;
  });
  region.set(raw.slice(0, rawCapacity), DMK_IDAM_TABLE);
  return region;
}

export class DiskImage {
  /**
   * @param {Uint8Array} bytes - raw .dsk contents
   * @param {string} name - display name (file name)
   */
  constructor(bytes, name = "disk") {
    this.name = name;
    this.bytes = new Uint8Array(bytes); // private working copy
    this.writeProtected = false;
    this.format = null; // "jv3" | "jv1"
    this.sectorBase = null; // JV1: 0 or 1, learned on first hit

    if (this._tryParseDMK()) {
      this.format = "dmk";
    } else if (this._tryParseJV3()) {
      this.format = "jv3";
    } else if (this._tryParseJV1()) {
      this.format = "jv1";
    } else {
      throw new Error(
        `Unrecognized disk image (${bytes.length} bytes): no DMK header, no JV3 sector table, and not a JV1 size (${JV1_TRACKS.join(", ")} tracks of ${JV1_SPT.join(" or ")} 256-byte sectors)`
      );
    }
  }

  _tryParseDMK() {
    const b = this.bytes;
    if (b.length < DMK_HEADER + 0x100) return false;
    const tracks = b[1];
    const trackLen = b[2] | (b[3] << 8);
    const flags = b[4];
    if (tracks < 1 || tracks > 96) return false;
    if (trackLen < 0x100 || trackLen > 0x4000) return false;
    if (b[12] | b[13] | b[14] | b[15]) return false; // real-drive marker
    const sides = flags & 0x10 ? 1 : 2;
    if (b.length !== DMK_HEADER + tracks * sides * trackLen) return false;

    this.dmk = { tracks, trackLen, sides, sdSingleByte: (flags & 0x40) !== 0 };
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
      const { trackLen, sdSingleByte } = this.dmk;
      const b = this.bytes;
      for (let i = 0; i < 64; i++) {
        const ptr = b[base + i * 2] | (b[base + i * 2 + 1] << 8);
        if (!ptr) break; // unused table entries are zero
        const mfm = (ptr & 0x8000) !== 0;
        const off = ptr & 0x3fff;
        if (off < DMK_IDAM_TABLE || off >= trackLen) continue;
        const step = mfm || sdSingleByte ? 1 : 2; // SD bytes usually doubled
        const at = (k) => b[base + off + k * step];
        if (at(0) !== 0xfe) continue;
        const sector = at(3);
        const size = 128 << (at(4) & 3);
        // The data mark follows within the WD's address-to-data window
        let dataOff = -1;
        let deleted = false;
        const limit = mfm ? 50 : 37;
        for (let k = 7; k <= limit; k++) {
          const byte = at(k);
          if (byte === 0xfb || byte === 0xf8) {
            dataOff = off + (k + 1) * step;
            deleted = byte === 0xf8;
            break;
          }
        }
        if (dataOff < 0 || dataOff + size * step > trackLen) continue;
        // The ID and data fields' CRCs as the WD1793 checks them (FD179X data sheet, "Read
        // Sector" and "Read Address"): CRC-CCITT preset FFFF over the address mark and the field,
        // and in MFM over the three A1 sync bytes before the mark too.
        const sync = mfm ? [0xa1, 0xa1, 0xa1] : [];
        const id = [0xfe, at(1), at(2), sector, at(4)];
        const idCrcOk = crc16([...sync, ...id]) === ((at(5) << 8) | at(6));
        const field = new Array(size + 3);
        // A CRC cut off by the end of the track reads as bad.
        const dataAt = (k) => (dataOff + k * step < trackLen ? b[base + dataOff + k * step] : -1);
        field[0] = deleted ? 0xf8 : 0xfb;
        for (let k = 0; k < size + 2; k++) field[k + 1] = dataAt(k);
        const dataCrc = (field[size + 1] << 8) | field[size + 2];
        const dataCrcOk = crc16([...sync, ...field.slice(0, size + 1)]) === dataCrc;
        out.push({
          sector, size, deleted, mfm, step, dataOff,
          off, idTrack: at(1), idSide: at(2), sizeCode: at(4) & 3,
          idCrcOk, dataCrcOk,
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
    this.bytes = grown;
    this.dmk.tracks = newTrackCount;
  }

  _tryParseJV3() {
    if (this.bytes.length < JV3_HEADER_SIZE) return false;

    const map = [];
    let dataOffset = JV3_HEADER_SIZE;
    let used = 0;
    for (let i = 0; i < JV3_ENTRIES; i++) {
      const track = this.bytes[i * 3];
      const sector = this.bytes[i * 3 + 1];
      const flags = this.bytes[i * 3 + 2];
      const free = track === JV3_FREE && sector === JV3_FREE;
      const size = jv3SectorSize(flags, free);
      if (!free) {
        // Sanity: plausible CHS values
        if (track > 96 || sector > 63) return false;
        map.push({
          track,
          sector,
          side: flags & F_SIDE ? 1 : 0,
          offset: dataOffset,
          size,
          deleted: jv3Deleted(flags),
          headerIndex: i, // to update the flags byte on DAM-changing writes
        });
        used++;
      }
      dataOffset += free ? 0 : size;
      if (dataOffset > this.bytes.length) return false;
    }
    // A real disk has many sectors; an exactly-header-sized all-free
    // image is a valid BLANK disk (DiskImage.blank, and its export /
    // save-state round trip) waiting for a DOS FORMAT.
    if (used < 10 && !(used === 0 && this.bytes.length === JV3_HEADER_SIZE)) {
      return false;
    }

    this.jv3Map = map;
    // Last header byte: 0xff = writable, anything else = write-protected
    this.writeProtected = this.bytes[JV3_HEADER_SIZE - 1] !== 0xff;
    return true;
  }

  /** A blank, writable, unformatted disk — FORMAT makes it real. */
  static blank(name = "blank.dsk") {
    return new DiskImage(new Uint8Array(JV3_HEADER_SIZE).fill(0xff), name);
  }

  _tryParseJV1() {
    // JV1 has no header, so its size is the only evidence: accept only
    // a geometry a real disk has, 10 sectors per track (Model I single
    // density) or 18 (Model III double density) on 35, 40, 77, or 80
    // tracks. Anything else (a .CMD, a text file) would otherwise mount
    // as a short JV1 whose garbage the ROM then boots. No two of these
    // sizes coincide, so the geometry is never ambiguous.
    const size = this.bytes.length;
    let chosen = null;
    for (const spt of JV1_SPT) {
      for (const tracks of JV1_TRACKS) {
        if (size === tracks * spt * 256) chosen = { spt, tracks };
      }
    }
    if (chosen === null) return false;

    this.sectorsPerTrack = chosen.spt;
    this.tracks = chosen.tracks;
    // Convention: Model III 18-sector disks number sectors 1-18 (TRSDOS
    // 1.3 style); Model I 10-sector disks number 0-9. Seed the base
    // accordingly; _locate still falls back to the other base on a miss.
    this.preferredBase = chosen.spt === 18 ? 1 : 0;
    // JV1 carries no DAM info, but DOSes verify the deleted mark on
    // directory reads — synthesize it for the directory track the boot
    // sector names (byte 2), as xtrs does for its fixed track 17.
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

  /**
   * The ID fields present on one track, in map order — what READ
   * ADDRESS shows a verifying FORMAT. Size codes are the IBM ones the
   * 1793 reports (0=128 ... 3=1024).
   */
  sectorsOn(track, side) {
    if (this.format === "dmk") {
      const sizeToCode = { 128: 0, 256: 1, 512: 2, 1024: 3 };
      return this._dmkSectors(track, side).map((s) => ({
        sector: s.sector,
        sizeCode: sizeToCode[s.size] ?? 1,
      }));
    }
    if (this.format === "jv1") {
      if (side !== 0 || track >= this.tracks) return [];
      const base = this.sectorBase ?? this.preferredBase;
      return Array.from({ length: this.sectorsPerTrack }, (_, i) => ({
        sector: base + i,
        sizeCode: 1,
      }));
    }
    const sizeToCode = { 128: 0, 256: 1, 512: 2, 1024: 3 };
    return this.jv3Map
      .filter((e) => e.track === track && e.side === side)
      .map((e) => ({ sector: e.sector, sizeCode: sizeToCode[e.size] ?? 1 }));
  }

  /**
   * The ID fields on one track side as the controller meets them in a revolution, for the WD1793's
   * ID search (FD179X data sheet, "Type II Commands"): each with the ID's track, side, sector, and
   * size code, its density (`mfm`: true, false, or null when the container does not record it, as
   * in JV1), where its address mark passes as a fraction of a revolution from the index pulse
   * (`pos`), how many bytes after that mark the first data byte comes (`dataGap`), whether its ID
   * and data CRCs are good, and its record type. DMK gives all of these from the raw track. JV1 and
   * JV3 hold only sectors, so their IDs carry the physical track and side, are spaced evenly round
   * the track in image order, and use the IBM gaps of the data sheet's "IBM Track Format" (an ID
   * field of 7 bytes, then Gap II, the sync zeros, the A1s in MFM, and the data mark: 45 bytes in
   * MFM, 25 in FM). JV3's flag bit 3 marks a data CRC error.
   * @returns {{track:number, side:number, sector:number, sizeCode:number, size:number,
   *   mfm:boolean|null, pos:number, dataGap:number, idCrcOk:boolean, dataCrcOk:boolean,
   *   deleted:boolean}[]}
   */
  trackIds(track, side) {
    const gap = (mfm) => (mfm === false ? 25 : 45);
    const sizeToCode = { 128: 0, 256: 1, 512: 2, 1024: 3 };
    if (this.format === "dmk") {
      const raw = this.dmk.trackLen - DMK_IDAM_TABLE;
      return this._dmkSectors(track, side).map((s) => ({
        track: s.idTrack,
        side: s.idSide,
        sector: s.sector,
        sizeCode: s.sizeCode,
        size: s.size,
        mfm: s.mfm,
        pos: (s.off - DMK_IDAM_TABLE) / raw,
        dataGap: (s.dataOff - s.off) / s.step,
        idCrcOk: s.idCrcOk,
        dataCrcOk: s.dataCrcOk,
        deleted: s.deleted,
      }));
    }
    if (this.format === "jv1") {
      if (side !== 0 || track >= this.tracks) return [];
      const n = this.sectorsPerTrack;
      const base = this.sectorBase ?? this.preferredBase;
      return Array.from({ length: n }, (_, i) => ({
        track,
        side,
        sector: base + i,
        sizeCode: 1,
        size: 256,
        mfm: null,
        pos: (i + 0.5) / n,
        dataGap: 45,
        idCrcOk: true,
        dataCrcOk: true,
        deleted: track === this.dirTrack,
      }));
    }
    const entries = this.jv3Map.filter((e) => e.track === track && e.side === side);
    return entries.map((e, i) => {
      const flags = this.bytes[e.headerIndex * 3 + 2];
      const mfm = (flags & 0x80) !== 0;
      return {
        track,
        side,
        sector: e.sector,
        sizeCode: sizeToCode[e.size] ?? 1,
        size: e.size,
        mfm,
        pos: (i + 0.5) / entries.length,
        dataGap: gap(mfm),
        idCrcOk: true,
        dataCrcOk: (flags & 0x08) === 0,
        deleted: e.deleted,
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
      doubled: !this.dmk.sdSingleByte,
    };
  }

  /**
   * Find a sector's byte range. JV1 images may number sectors from 0 or 1
   * depending on how they were produced; the first successful lookup
   * fixes the convention for the rest of the session.
   * @returns {{offset:number,size:number}|null}
   */
  _locate(track, side, sector) {
    if (this.format === "jv3") {
      const hit = this.jv3Map.find(
        (e) => e.track === track && e.sector === sector && e.side === side
      );
      return hit ? { offset: hit.offset, size: hit.size, entry: hit } : null;
    }

    if (side !== 0) return null; // JV1 is single-sided
    const bases =
      this.sectorBase !== null
        ? [this.sectorBase]
        : [this.preferredBase, 1 - this.preferredBase];
    for (const base of bases) {
      const index = sector - base;
      if (index >= 0 && index < this.sectorsPerTrack && track < this.tracks) {
        this.sectorBase = base;
        return {
          offset: (track * this.sectorsPerTrack + index) * 256,
          size: 256,
          entry: null,
        };
      }
    }
    return null;
  }

  /**
   * Read a sector with its record type, the way the FDC sees it.
   * @returns {{data: Uint8Array, deleted: boolean}|null}
   */
  readSectorEx(track, side, sector) {
    if (this.format === "dmk") {
      const hit = this._dmkSectors(track, side).find((s) => s.sector === sector);
      if (!hit) return null;
      const base = this._dmkTrackBase(track, side);
      const data = new Uint8Array(hit.size);
      for (let k = 0; k < hit.size; k++) {
        data[k] = this.bytes[base + hit.dataOff + k * hit.step];
      }
      return { data, deleted: hit.deleted };
    }
    const loc = this._locate(track, side, sector);
    if (!loc) return null;
    const deleted = loc.entry ? loc.entry.deleted : track === this.dirTrack;
    return {
      data: this.bytes.slice(loc.offset, loc.offset + loc.size),
      deleted,
    };
  }

  /** @returns {Uint8Array|null} a copy of the sector data */
  readSector(track, side, sector) {
    return this.readSectorEx(track, side, sector)?.data ?? null;
  }

  /**
   * Replace one track's contents with freshly formatted sectors (the
   * tail end of a WD1793 WRITE TRACK). JV3 images rebuild their bytes
   * wholesale — `bytes` stays the exportable/serializable truth. A JV1
   * whose geometry matches writes in place; one that doesn't (new
   * track count, sector numbering, or size) is promoted to JV3 in
   * memory, keeping every existing sector.
   *
   * @param {{sector:number, size?:number, deleted?:boolean,
   *          data:Uint8Array, mfm?:boolean}[]} sectors
   * @returns {boolean} true if the track was written
   */
  formatTrack(track, side, sectors) {
    if (this.writeProtected) return false;
    if (this.format === "dmk") {
      if (side >= this.dmk.sides) return false;
      if (track >= this.dmk.tracks) this._dmkExtend(track + 1);
      const region = buildDmkTrackRegion(track, side, sectors, this.dmk.trackLen);
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
        flags: this.bytes[e.headerIndex * 3 + 2],
        data: this.bytes.slice(e.offset, e.offset + e.size),
      }));

    const sizeToCode = { 256: 0x00, 128: 0x01, 1024: 0x02, 512: 0x03 };
    const fresh = sectors.map((s) => {
      const mfm = s.mfm !== false;
      const size = s.size ?? s.data.length;
      let flags = sizeToCode[size] ?? 0x00;
      if (side) flags |= F_SIDE;
      if (mfm) flags |= 0x80;
      if (s.deleted) flags |= mfm ? 0x20 : 0x60;
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

  /** Write into the raw track bytes in place, CRCs recomputed. */
  _dmkWriteSector(track, side, sector, data, deleted) {
    const hit = this._dmkSectors(track, side).find((s) => s.sector === sector);
    if (!hit) return false;
    const base = this._dmkTrackBase(track, side);
    const put = (rawOff, v) => {
      this.bytes[base + rawOff] = v;
      if (hit.step === 2) this.bytes[base + rawOff + 1] = v;
    };

    const mark = deleted ? 0xf8 : 0xfb;
    put(hit.dataOff - hit.step, mark);
    const payload = new Uint8Array(hit.size);
    for (let k = 0; k < hit.size; k++) {
      payload[k] = data[k] ?? 0x00;
      put(hit.dataOff + k * hit.step, payload[k]);
    }
    const crc = crc16(
      hit.mfm ? [0xa1, 0xa1, 0xa1, mark, ...payload] : [mark, ...payload]
    );
    put(hit.dataOff + hit.size * hit.step, crc >> 8);
    put(hit.dataOff + (hit.size + 1) * hit.step, crc & 0xff);
    hit.deleted = deleted;
    hit.dataCrcOk = true;
    return true;
  }

  /** True (and written) when the layout matches this JV1's geometry. */
  _jv1FormatInPlace(track, side, sectors) {
    if (side !== 0 || track >= this.tracks) return false;
    if (sectors.length !== this.sectorsPerTrack) return false;
    const base = this.sectorBase ?? this.preferredBase;
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
    const base = this.sectorBase ?? this.preferredBase;
    const dd = this.sectorsPerTrack === 18; // Model III 18-sector = DD
    const entries = [];
    for (let t = 0; t < this.tracks; t++) {
      for (let i = 0; i < this.sectorsPerTrack; i++) {
        let flags = 0x00; // size code 0 = 256 bytes
        if (dd) flags |= 0x80;
        if (t === this.dirTrack) flags |= dd ? 0x20 : 0x60; // keep the DAM synthesis
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

  /** Rebuild bytes + map from {track, sector, flags, data} entries. */
  _rebuildJV3(entries) {
    if (entries.length > JV3_ENTRIES) {
      throw new Error(`Disk needs ${entries.length} JV3 entries (max ${JV3_ENTRIES})`);
    }
    let total = 0;
    for (const e of entries) total += e.data.length;
    const bytes = new Uint8Array(JV3_HEADER_SIZE + total).fill(0xff, 0, JV3_HEADER_SIZE);
    const map = [];
    let offset = JV3_HEADER_SIZE;
    entries.forEach((e, i) => {
      bytes[i * 3] = e.track;
      bytes[i * 3 + 1] = e.sector;
      bytes[i * 3 + 2] = e.flags;
      bytes.set(e.data, offset);
      map.push({
        track: e.track,
        sector: e.sector,
        side: e.flags & F_SIDE ? 1 : 0,
        offset,
        size: e.data.length,
        deleted: jv3Deleted(e.flags),
        headerIndex: i,
      });
      offset += e.data.length;
    });
    this.bytes = bytes;
    this.jv3Map = map;
    this.format = "jv3";
  }

  /**
   * @param {{deleted?: boolean}} [opts] - record type to write (WD1793
   *   write-sector bit a0). JV3 stores it in the header flags — in the
   *   image bytes, so exports keep it; JV1 has nowhere to put one and
   *   keeps synthesizing by directory track.
   * @returns {boolean} true if written
   */
  writeSector(track, side, sector, data, { deleted = false } = {}) {
    if (this.writeProtected) return false;
    if (this.format === "dmk") {
      return this._dmkWriteSector(track, side, sector, data, deleted);
    }
    const loc = this._locate(track, side, sector);
    if (!loc) return false;
    this.bytes.set(data.subarray(0, loc.size), loc.offset);
    const entry = loc.entry;
    if (entry && entry.deleted !== deleted) {
      const flagsAt = entry.headerIndex * 3 + 2;
      const flags = this.bytes[flagsAt] & ~F_DAM;
      // Density decides the code for 0xF8: DD uses 0x20, SD uses 0x60
      const damCode = deleted ? (flags & 0x80 ? 0x20 : 0x60) : 0x00;
      this.bytes[flagsAt] = flags | damCode;
      entry.deleted = deleted;
    }
    return true;
  }
}
