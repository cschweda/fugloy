/**
 * m.fdc and m.load.dsk (spec §3, §6; the phase 5 plan's Ruling 2) on synthetic JV1, JV3, and DMK
 * images: mounting each container and reading the drives, refusals, unmounting, a machine with no
 * disk booting as before, the dsk manifest and its reset into the disk's boot sector (through a
 * tiny ROM that boots the way the Model III ROM does, and through the real ROM when one is
 * configured), and snapshots that carry the disk bytes.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CPU_CLOCK_HZ, DiskImage, Machine } from '../../src/index.js';
import { configPath, configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { bootSector, withBoot, writeDmk, writeJv1, writeJv3 } from './disk-writers.js';

const MARKER = 'FUGLOY DISK BOOT';

/**
 * A 14K ROM that boots from disk the way the Model III ROM does (ROM $3492-$3516): with the
 * controller absent (status $FF) it halts, as the real ROM goes to cassette BASIC; otherwise it
 * selects drive 0, enables the INTRQ NMI, reads track 0 sector 1 to $4300 with INI as DRQ
 * rises, and the NMI that ends the read jumps to $4300 when the status shows no error.
 */
function diskBootRom() {
  const rom = new Uint8Array(0x3800);
  rom.set([
    0xf3, // 0000 DI
    0x31, 0x00, 0x50, // 0001 LD SP,5000H
    0xdb, 0xf0, // 0004 IN A,(F0H)
    0x3c, // 0006 INC A
    0x28, 0x20, // 0007 JR Z,0029H: no controller
    0x3e, 0x81, 0xd3, 0xf4, // 0009 LD A,81H / OUT (F4H),A: drive 0, MFM
    0x3e, 0x80, 0xd3, 0xe4, // 000D LD A,80H / OUT (E4H),A: INTRQ raises NMI
    0x01, 0xf3, 0x00, // 0011 LD BC,00F3H
    0x21, 0x00, 0x43, // 0014 LD HL,4300H
    0x3e, 0x01, 0xd3, 0xf2, // 0017 sector 1
    0x3e, 0x80, 0xd3, 0xf0, // 001B READ SECTOR
    0xdb, 0xf0, // 001F IN A,(F0H)
    0xe6, 0x02, // 0021 AND 02H: DRQ
    0x28, 0xfa, // 0023 JR Z,001FH
    0xed, 0xa2, // 0025 INI
    0x18, 0xf6, // 0027 JR 001FH
    0x76, // 0029 HALT
  ]);
  rom.set([
    0xaf, 0xd3, 0xe4, // 0066 XOR A / OUT (E4H),A
    0xe1, // POP HL
    0xdb, 0xf0, 0xe6, 0x1c, // IN A,(F0H) / AND 1CH
    0xca, 0x00, 0x43, // JP Z,4300H
    0x76, // HALT
  ], 0x66);
  return rom;
}

const machine = (level2 = diskBootRom()) => new Machine({ roms: { level2 } });
const screen = (m) => m.video.text().join('\n');

const CONTAINERS = {
  jv1: (fill) => writeJv1({ tracks: 40, spt: 18, fill }),
  jv3: (fill) => writeJv3({ tracks: 40, spt: 18, sides: 2, fill }),
  dmk: (fill) => writeDmk({ tracks: 40, spt: 18, sides: 2, fill }),
};
const GEOMETRY = {
  jv1: { tracks: 40, sides: 1, sectorsPerTrack: 18 },
  jv3: { tracks: 40, sides: 2, sectorsPerTrack: 18 },
  dmk: { tracks: 40, sides: 2, sectorsPerTrack: 18 },
};

describe('m.fdc', () => {
  for (const [container, write] of Object.entries(CONTAINERS)) {
    it(`mounts a ${container} image and reports it in drives`, () => {
      const m = machine();
      const info = m.fdc.mount(1, write());
      expect(info).toEqual({ drive: 1, container, ...GEOMETRY[container], writeProtected: false });
      expect(m.fdc.drives).toEqual([null, info, null, null]);
      // The bytes went in through DiskImage: sector data reads back as the writer stamped it.
      const disk = m.system.io.fdc.drives[1];
      expect(Array.from(disk.readSector(3, 0, 5).subarray(0, 3))).toEqual([3, 0, 5]);
    });
  }

  it('mounts in every drive, and a second mount replaces the first', () => {
    const m = machine();
    for (const d of [0, 1, 2, 3]) m.fdc.mount(d, writeJv1());
    expect(m.fdc.drives.map((d) => d?.drive)).toEqual([0, 1, 2, 3]);
    expect(m.fdc.mount(2, writeDmk({ tracks: 35, spt: 10 })).container).toBe('dmk');
    expect(m.fdc.drives[2]).toEqual({ drive: 2, container: 'dmk', tracks: 35, sides: 1, sectorsPerTrack: 10, writeProtected: false });
  });

  it('mounts a DiskImage as it is, so the machine’s writes show in it', () => {
    const m = machine();
    const image = new DiskImage(writeJv3(), 'mine');
    m.fdc.mount(0, image);
    expect(m.system.io.fdc.drives[0]).toBe(image);
  });

  it('takes write protection from the image, and writeProtect overrides it', () => {
    const m = machine();
    expect(m.fdc.mount(0, writeDmk({ writeProtected: true })).writeProtected).toBe(true);
    expect(m.fdc.mount(1, writeJv3({ writeProtected: true })).writeProtected).toBe(true);
    expect(m.fdc.mount(2, writeDmk({ writeProtected: true }), { writeProtect: false }).writeProtected).toBe(false);
    expect(m.fdc.mount(3, writeJv1(), { writeProtect: true }).writeProtected).toBe(true);
    expect(m.system.io.fdc.drives[3].writeSector(0, 0, 1, new Uint8Array(256))).toBe(false);
  });

  it('omits sectorsPerTrack when tracks differ', () => {
    const m = machine();
    const bytes = writeJv3({ tracks: 2, spt: 18 });
    // Free the last header entry: track 1 now holds 17 sectors.
    bytes.fill(0xff, 35 * 3, 36 * 3);
    const info = m.fdc.mount(0, bytes);
    expect(info).toEqual({ drive: 0, container: 'jv3', tracks: 2, sides: 1, writeProtected: false });
  });

  it('refuses a non-image', () => {
    const m = machine();
    expect(() => m.fdc.mount(0, new Uint8Array(1000))).toThrow(/fdc\.mount: Unrecognized disk image \(1000 bytes\)/);
    expect(() => m.fdc.mount(0, /** @type {any} */ ('disk.dmk'))).toThrow(/fdc\.mount: the image must be a Uint8Array/);
    expect(() => m.fdc.mount(0, /** @type {any} */ ([0, 1, 2]))).toThrow(/fdc\.mount: the image must be a Uint8Array/);
    expect(m.fdc.drives).toEqual([null, null, null, null]);
  });

  // JV1 has no header: a file whose length is a whole number of 10- or 18-sector tracks used to
  // mount as a short JV1 whose first sector the ROM would boot.
  const REAR_GUARD_CMD = fileURLToPath(new URL('../../../../examples/rear-guard/reargrd4.cmd', import.meta.url));
  const notImages = {
    'reargrd4.cmd (13,824 bytes, 54 sectors)': () => new Uint8Array(readFileSync(REAR_GUARD_CMD)),
    'a 4,608-byte text buffer (one 18-sector track)': () => new TextEncoder().encode('10 PRINT "HELLO"\n'.repeat(512).slice(0, 4608)),
    'a 2,560-byte buffer (one 10-sector track)': () => new Uint8Array(2560).fill(0x41),
    'a 1,792-byte buffer (7 sectors)': () => new Uint8Array(1792),
    '39 tracks of 18 sectors': () => new Uint8Array(39 * 18 * 256),
    '36 tracks of 10 sectors': () => new Uint8Array(36 * 10 * 256),
  };
  for (const [name, bytes] of Object.entries(notImages)) {
    it(`refuses ${name} instead of mounting it as a JV1`, () => {
      const m = machine();
      const b = bytes();
      const sentence = `Unrecognized disk image (${b.length} bytes): no DMK header, no JV3 sector table, and not a JV1 size (35, 40, 77, 80 tracks of 18 or 10 256-byte sectors)`;
      expect(() => m.fdc.mount(0, b)).toThrow(`fdc.mount: ${sentence}`);
      expect(() => m.load.dsk(b)).toThrow(`load.dsk: ${sentence}`);
      expect(m.fdc.drives).toEqual([null, null, null, null]);
      expect(m.io.in(0xf0)).toBe(0xff);
    });
  }

  it('mounts JV1 at every real geometry: 35, 40, 77, and 80 tracks of 10 or 18 sectors', () => {
    const m = machine();
    for (const spt of /** @type {const} */ ([10, 18])) {
      for (const tracks of [35, 40, 77, 80]) {
        expect(m.fdc.mount(0, writeJv1({ tracks, spt }))).toEqual({ drive: 0, container: 'jv1', tracks, sides: 1, sectorsPerTrack: spt, writeProtected: false });
      }
    }
  });

  it('refuses a drive outside 0-3 and a writeProtect that is not a boolean', () => {
    const m = machine();
    for (const d of [-1, 4, 1.5, '0', undefined]) {
      expect(() => m.fdc.mount(/** @type {any} */ (d), writeJv1())).toThrow(/fdc\.mount: drive must be 0, 1, 2, or 3/);
      expect(() => m.fdc.unmount(/** @type {any} */ (d))).toThrow(/fdc\.unmount: drive must be 0, 1, 2, or 3/);
    }
    expect(() => m.fdc.mount(0, writeJv1(), { writeProtect: /** @type {any} */ (1) })).toThrow(/writeProtect must be true or false/);
  });

  it('unmounts: the drive empties, and the controller floats again once every drive is empty', () => {
    const m = machine();
    expect(m.io.in(0xf0)).toBe(0xff);
    m.fdc.mount(0, writeJv1());
    m.fdc.mount(1, writeJv1());
    expect(m.io.in(0xf0)).not.toBe(0xff);
    expect(m.fdc.unmount(0)).toBe(true);
    expect(m.fdc.drives).toEqual([null, expect.objectContaining({ drive: 1 }), null, null]);
    expect(m.io.in(0xf0)).not.toBe(0xff);
    expect(m.fdc.unmount(1)).toBe(true);
    expect(m.fdc.unmount(1)).toBe(false);
    expect(m.fdc.drives).toEqual([null, null, null, null]);
    expect(m.io.in(0xf0)).toBe(0xff);
    expect(m.io.in(0xe4)).toBe(0xff);
  });

  it('drives returns copies', () => {
    const m = machine();
    m.fdc.mount(0, writeJv1());
    const drives = m.fdc.drives;
    /** @type {any} */ (drives[0]).tracks = 99;
    drives[1] = /** @type {any} */ ({});
    expect(m.fdc.drives[0]?.tracks).toBe(40);
    expect(m.fdc.drives[1]).toBe(null);
  });

  it('no disk, same boot: a disk mounted and unmounted leaves the boot as it was', () => {
    const fresh = machine();
    const after = machine();
    after.fdc.mount(0, CONTAINERS.dmk(withBoot(bootSector(MARKER))));
    after.fdc.unmount(0);
    after.reset();
    for (const m of [fresh, after]) m.run({ cycles: 100_000 });
    expect(after.debug.snapshot()).toEqual(fresh.debug.snapshot());
    // The boot ROM found no controller and halted where the real ROM would go to cassette BASIC.
    expect(fresh.system.cpu.halted).toBe(true);
    expect(fresh.cpu.regs.pc).toBe(0x002a);
  });
});

describe('m.load.dsk', () => {
  for (const [container, write] of Object.entries(CONTAINERS)) {
    it(`mounts a ${container} image in drive 0, resets, and the ROM runs its boot sector`, () => {
      const m = machine();
      m.run({ cycles: 1000 }); // halted at the no-controller HALT
      const bytes = write(withBoot(bootSector(MARKER)));
      const manifest = m.load.dsk(bytes);
      expect(manifest).toEqual({ format: 'dsk', container, drive: 0, boot: true, blocks: [] });
      expect(m.cycles).toBe(0);
      expect(m.cpu.regs.pc).toBe(0);
      expect(m.fdc.drives[0]).toEqual({ drive: 0, container, ...GEOMETRY[container], writeProtected: false });
      m.run({ until: (mm) => screen(mm).includes(MARKER), cycles: CPU_CLOCK_HZ });
      expect(screen(m).split('\n')[0]).toBe(MARKER.padEnd(64));
      expect(Array.from(m.mem.read(0x4300, 256))).toEqual(Array.from(bootSector(MARKER)));
      expect(m.debug.loaded?.manifest).toEqual(manifest);
    });
  }

  it('with boot: false only mounts: no reset, and the machine runs on', () => {
    const m = machine();
    m.run({ cycles: 1000 });
    const cycles = m.cycles;
    const manifest = m.load.dsk(writeJv1(), { drive: 2, boot: false });
    expect(manifest).toEqual({ format: 'dsk', container: 'jv1', drive: 2, boot: false, blocks: [] });
    expect(m.cycles).toBe(cycles);
    expect(m.system.cpu.halted).toBe(true);
    expect(m.fdc.drives.map((d) => d?.drive ?? null)).toEqual([null, null, 2, null]);
  });

  it('boots from drive 0 when loading into another drive, and refuses when drive 0 is empty', () => {
    const m = machine();
    expect(() => m.load.dsk(writeJv1(), { drive: 1 })).toThrow(/load\.dsk: the ROM boots from drive 0, which is empty/);
    expect(m.fdc.drives).toEqual([null, null, null, null]);
    m.load.dsk(writeJv1({ fill: withBoot(bootSector(MARKER)) }), { boot: false });
    expect(m.load.dsk(writeJv3(), { drive: 1 })).toEqual({ format: 'dsk', container: 'jv3', drive: 1, boot: true, blocks: [] });
    m.run({ until: (mm) => screen(mm).includes(MARKER), cycles: CPU_CLOCK_HZ });
    expect(screen(m)).toContain(MARKER);
  });

  it('refuses a non-image, a bad drive, and a bad boot flag, mounting nothing', () => {
    const m = machine();
    expect(() => m.load.dsk(new Uint8Array(1000))).toThrow(/^load\.dsk: Unrecognized disk image/);
    expect(() => m.load.dsk(/** @type {any} */ ('x'))).toThrow(/load\.dsk: bytes must be a Uint8Array/);
    expect(() => m.load.dsk(writeJv1(), { drive: 4 })).toThrow(/load\.dsk: drive must be 0, 1, 2, or 3/);
    expect(() => m.load.dsk(writeJv1(), { boot: /** @type {any} */ ('yes') })).toThrow(/load\.dsk: boot must be true or false/);
    expect(m.fdc.drives).toEqual([null, null, null, null]);
    expect(m.debug.loaded).toBe(null);
  });
});

describe('snapshots with a disk mounted', () => {
  it('keep the disk bytes, the drive, and its write protection', () => {
    const m = machine();
    const image = new DiskImage(writeDmk({ tracks: 10, spt: 18 }), 'snap');
    m.fdc.mount(1, image);
    m.fdc.mount(3, writeJv1(), { writeProtect: true });
    const written = new Uint8Array(256).fill(0x5a);
    expect(image.writeSector(4, 0, 7, written)).toBe(true);
    const snap = JSON.parse(JSON.stringify(m.debug.snapshot()));
    const before = m.fdc.drives;

    // Change everything the snapshot should put back.
    image.writeSector(4, 0, 7, new Uint8Array(256).fill(0x11));
    m.fdc.unmount(1);
    m.fdc.unmount(3);
    m.fdc.mount(0, writeJv3());

    m.debug.restore(snap);
    expect(m.fdc.drives).toEqual(before);
    expect(Array.from(m.system.io.fdc.drives[1].readSector(4, 0, 7))).toEqual(Array.from(written));

    // Into another machine too.
    const other = machine();
    other.debug.restore(snap);
    expect(other.fdc.drives).toEqual(before);
    expect(Array.from(other.system.io.fdc.drives[1].readSector(4, 0, 7))).toEqual(Array.from(written));
  });
});

/** The `fixtures` folder of fugloy.mcp.json (relative to the file), or null; disk images found under it. */
function realDiskImages() {
  const config = configPath();
  if (config === null || !existsSync(config)) return [];
  const entry = JSON.parse(readFileSync(config, 'utf8')).fixtures;
  if (typeof entry !== 'string') return [];
  const root = isAbsolute(entry) ? entry : resolve(dirname(config), entry);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(dmk|dsk|jv1|jv3)$/i.test(f))
    .map((f) => join(root, f))
    .sort();
}
const realDisks = realDiskImages();

describe.skipIf(realDisks.length === 0)('m.fdc with the local disk images', () => {
  it.each(realDisks)('mounts %s', (path) => {
    const info = machine().fdc.mount(0, new Uint8Array(readFileSync(path)));
    expect(info.drive).toBe(0);
    expect(['jv1', 'jv3', 'dmk']).toContain(info.container);
    expect(info.tracks).toBeGreaterThan(0);
  });
});

// The real Model III ROM from fugloy.mcp.json; without it these skip.
const rom = configuredRom('model3');

describe.skipIf(rom === null)('m.load.dsk with the Model III ROM', { timeout: ROM_TEST_TIMEOUT }, () => {
  for (const [container, write] of Object.entries(CONTAINERS)) {
    it(`boots the ${container} boot sector`, () => {
      const m = machine(/** @type {Uint8Array} */ (rom));
      m.load.dsk(write(withBoot(bootSector(MARKER))));
      const r = m.run({ until: (mm) => screen(mm).includes(MARKER), cycles: 2 * CPU_CLOCK_HZ });
      expect(r.reason).toBe('predicate');
      expect(screen(m).split('\n')[0]).toBe(MARKER.padEnd(64));
    });
  }

  it('no disk, same boot: a disk mounted and unmounted leaves the cassette boot as it was', () => {
    const fresh = machine(/** @type {Uint8Array} */ (rom));
    const after = machine(/** @type {Uint8Array} */ (rom));
    after.fdc.mount(0, CONTAINERS.jv1(withBoot(bootSector(MARKER))));
    after.fdc.unmount(0);
    after.reset();
    for (const m of [fresh, after]) m.run({ cycles: CPU_CLOCK_HZ });
    expect(screen(fresh)).toContain('Cass?');
    expect(after.debug.snapshot()).toEqual(fresh.debug.snapshot());
  });
});
