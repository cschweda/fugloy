/**
 * Synthetic JV1 and JV3 disk images for the disk tests (upstream kept these in its
 * disk-image tests and imported them from there).
 */

export function buildJV1({ tracks = 40, spt = 18, stamp = true } = {}) {
  const bytes = new Uint8Array(tracks * spt * 256);
  if (stamp) {
    // Stamp every sector with [track, sectorIndex] for identification
    for (let t = 0; t < tracks; t++) {
      for (let s = 0; s < spt; s++) {
        const off = (t * spt + s) * 256;
        bytes[off] = t;
        bytes[off + 1] = s;
      }
    }
  }
  return bytes;
}

export function buildJV3({ tracks = 3, spt = 10, flagFor = null } = {}) {
  const headerSize = 2901 * 3 + 1;
  const sectors = [];
  for (let t = 0; t < tracks; t++) {
    for (let s = 0; s < spt; s++) {
      sectors.push({ track: t, sector: s });
    }
  }
  const bytes = new Uint8Array(headerSize + sectors.length * 256);
  bytes.fill(0xff, 0, headerSize); // free entries; write-prot byte 0xff = writable
  sectors.forEach((sec, i) => {
    bytes[i * 3] = sec.track;
    bytes[i * 3 + 1] = sec.sector;
    // Default 0x00 = 256-byte, side 0, normal DAM; flagFor overrides
    bytes[i * 3 + 2] = flagFor ? flagFor(sec.track, sec.sector) : 0x00;
    const off = headerSize + i * 256;
    bytes[off] = sec.track;
    bytes[off + 1] = sec.sector;
  });
  return bytes;
}
