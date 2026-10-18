/**
 * The synthetic disk images committed under fixtures/synthetic/disk/, one per container shape
 * `DiskImage` reads, built by the writers in disk-writers.js. `scripts/write-disk-fixtures.mjs`
 * (run by `pnpm fixtures`) writes them; test/unit/disk-image.test.js reads every sector of each
 * and fails when a committed file differs from what its writer produces.
 */
import { writeDmk, writeJv1, writeJv3 } from './disk-writers.js';

/** Every sector's bytes: [track, side, sector], then a pattern of all three. */
export const pattern = (/** @type {number} */ t, /** @type {number} */ side, /** @type {number} */ s) =>
  Array.from({ length: 256 }, (_, k) => (k < 3 ? [t, side, s][k] : (k * 7 + t * 31 + side * 17 + s * 3) & 0xff));

/**
 * @typedef {{ build: () => Uint8Array, about: string }} DiskSample
 * @type {Record<string, DiskSample>}
 */
export const DISK_SAMPLES = {
  'jv1-sd-35x10.dsk': {
    about: 'JV1 as Vavasour defined it: 35 tracks of 10 single-density sectors numbered 0-9',
    build: () => writeJv1({ tracks: 35, spt: 10, fill: pattern }),
  },
  'jv3-mixed.dsk': {
    about:
      'JV3, two sides, sectors 0-9: tracks 0-1 single density with FA, F9, and F8 data marks on track 1, tracks 2-3 double density with an F8 and a CRC error, and two free entries holding data areas between sectors',
    build: () =>
      writeJv3({
        tracks: 4,
        spt: 10,
        sides: 2,
        base: 0,
        dd: (t) => t >= 2,
        fill: pattern,
        dam: (t, side, s) => (t === 1 && side === 0 ? ({ 3: 0xfa, 4: 0xf9, 5: 0xf8 })[s] : t === 3 && side === 1 && s === 2 ? 0xf8 : undefined) ?? 0xfb,
        crcError: (t, side, s) => t === 2 && side === 0 && s === 7,
        free: [5, 47],
      }),
  },
  'dmk-dd-ds.dmk': {
    about: 'DMK, double density, two sides, 3 tracks of 18 sectors numbered 1-18, an F8 on track 1 side 1 sector 4',
    build: () => writeDmk({ tracks: 3, spt: 18, sides: 2, fill: pattern, dam: (t, side, s) => (t === 1 && side === 1 && s === 4 ? 0xf8 : 0xfb) }),
  },
  'dmk-sd.dmk': {
    about: 'DMK, single density stored as doubled bytes, 3 tracks of 10 sectors numbered 0-9, an FA on track 2 sector 9',
    build: () => writeDmk({ tracks: 3, spt: 10, base: 0, fill: pattern, fm: () => true, dam: (t, side, s) => (t === 2 && s === 9 ? 0xfa : 0xfb) }),
  },
  'dmk-sd-single.dmk': {
    about: 'DMK, single density stored once (header flag 40), 2 tracks of 10 sectors numbered 0-9',
    build: () => writeDmk({ tracks: 2, spt: 10, base: 0, fill: pattern, fm: () => true, singleByte: true }),
  },
  'dmk-mixed.dmk': {
    about: 'DMK whose track 0 mixes densities as the dual-boot disks do: sector 0 in FM, sectors 1-3 in MFM; track 1 all MFM',
    build: () => writeDmk({ tracks: 2, spt: 4, base: 0, fill: pattern, fm: (t, side, s) => t === 0 && s === 0 }),
  },
};
