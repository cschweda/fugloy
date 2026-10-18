/**
 * The Machine's .CMD and .CAS loaders and its cassette deck controls. Each loader returns a
 * manifest: where the bytes land and why (spec §6).
 *
 * A .CAS goes in one of two ways. Via 'rom' (the default) the tape is put in the cassette deck as
 * pulses at the chosen baud, and the ROM's own loader reads it when the caller types CLOAD or
 * SYSTEM; nothing is written until then, so every manifest block carries `predicted: true`. Via
 * 'fast' the blocks are written at once (fastLoadBasic, fastLoadSystem).
 */
import { parseCmd, fastLoadCmd } from './cmd-format.js';
import { parseCas, fastLoadBasic, fastLoadSystem } from './cas-format.js';
import { casToPulses } from '../devices/cassette-tape.js';
import { DiskImage } from '../devices/disk-image.js';

/**
 * @typedef {{ addr: number, len: number, why: string, predicted?: true }} ManifestBlock
 *   `predicted` marks a block that has not landed yet (via 'rom', before the ROM reads the tape)
 * @typedef {{ format: 'cmd', name: string, entry: number, blocks: ManifestBlock[] }} CmdManifest
 * @typedef {{ format: 'cas', kind: 'basic' | 'system', name: string, entry?: number, blocks: ManifestBlock[],
 *   baud: 500 | 1500 | null, via: 'rom' | 'fast' }} CasManifest
 * @typedef {{ drive: number, container: 'jv1' | 'jv3' | 'dmk', tracks: number, sides: number,
 *   sectorsPerTrack?: number, writeProtected: boolean }} DriveInfo
 *   `sectorsPerTrack` is present only when every track side holds the same number of sectors
 * @typedef {{ format: 'dsk', container: 'jv1' | 'jv3' | 'dmk', drive: number, boot: boolean, blocks: ManifestBlock[] }} DskManifest
 *   `blocks` is empty: mounting writes nothing to memory (what the ROM or a DOS reads lands later)
 */

const TXTTAB_PTR = 0x40a4;

function checkBaud(baud) {
  if (baud !== 500 && baud !== 1500) throw new Error(`cassette baud must be 500 or 1500 (the Model III's L and H rates), not ${String(baud)}`);
}

/**
 * The tape as the deck plays it at `baud`: the file's own leader and sync (00s or 55s, then A5
 * or 7F, any of which may be missing) replaced by 255 leader bytes and the sync byte of that
 * rate, 00s and A5 at 500 baud, 55s and 7F at 1500, which is what the ROM hunts for.
 * @param {Uint8Array} bytes
 * @param {500 | 1500} baud
 */
export function tapeForBaud(bytes, baud) {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x00 || bytes[i] === 0x55)) i++;
  // Leader bytes not followed by a sync are content (a bare SYSTEM tape starts with its 55).
  const body = bytes[i] === 0xa5 || bytes[i] === 0x7f ? i + 1 : 0;
  const out = new Uint8Array(256 + bytes.length - body);
  out.fill(baud === 500 ? 0x00 : 0x55, 0, 255);
  out[255] = baud === 500 ? 0xa5 : 0x7f;
  out.set(bytes.subarray(body), 256);
  return out;
}

/**
 * The cassette deck: insert a .CAS as a pulse tape at a baud, rewind it, read the motor relay.
 * @param {import('../machine/machine.js').Machine} machine
 */
export function cassetteDeck(machine) {
  const deck = machine.system.io.cassette;
  return {
    /**
     * @param {Uint8Array} bytes a .CAS image
     * @param {{ baud?: 500 | 1500 }} [opts]
     */
    insert(bytes, { baud = 500 } = {}) {
      checkBaud(baud);
      deck.insertPulseTape(casToPulses(tapeForBaud(bytes, baud), baud));
    },
    /** Back to the start of the tape. */
    rewind() {
      deck.rewindPulseTape();
    },
    /** True while the ROM holds the motor relay on. */
    get motor() {
      return deck.motorOn;
    },
  };
}

/**
 * Load a .CMD: write its 01 blocks and leave the machine ready to run at the transfer address.
 * Text fed or typed for the previous program is dropped (the keyboard queue is cleared, queued
 * keys released), so the new program's first keyboard read does not get stale input.
 * @param {import('../machine/machine.js').Machine} machine
 * @param {Uint8Array} bytes
 * @returns {CmdManifest}
 */
export function loadCmd(machine, bytes) {
  const parsed = parseCmd(bytes);
  fastLoadCmd(machine.system, parsed);
  machine.keyboard.clear();
  return {
    format: 'cmd',
    name: parsed.name,
    entry: parsed.entry,
    blocks: parsed.blocks.map((b) => ({ addr: b.addr, len: b.data.length, why: 'record 01' })),
  };
}

/**
 * Load a .CAS, through the ROM's loader (the tape goes in the deck; the caller types CLOAD, or
 * SYSTEM and the name then `/`) or fast (written now; a SYSTEM tape also jumps to its entry).
 * `baud` applies only via 'rom'; via 'fast' it is ignored and the manifest's `baud` is null.
 * Via 'fast' the keyboard queue is cleared as `load.cmd` does; via 'rom' it is left alone, since
 * the caller types CLOAD or SYSTEM next.
 * @param {import('../machine/machine.js').Machine} machine
 * @param {Uint8Array} bytes
 * @param {{ baud?: 500 | 1500, via?: 'rom' | 'fast' }} [opts]
 * @returns {CasManifest}
 */
export function loadCas(machine, bytes, { baud = 500, via = 'rom' } = {}) {
  if (via !== 'rom' && via !== 'fast') throw new Error(`load.cas: via must be 'rom' or 'fast', not ${String(via)}`);
  if (via === 'rom') checkBaud(baud);
  const parsed = parseCas(bytes);
  const system = machine.system;

  /** @type {ManifestBlock[]} */
  let blocks;
  if (parsed.kind === 'system') {
    blocks = parsed.blocks.map((b) => ({ addr: b.addr, len: b.data.length, why: 'block 3C' }));
  } else {
    // CLOAD and the fast path both put the program at TXTTAB: per line a pointer, a line number, the body, and 00, then 00 00.
    const start = system.memory.readWord(TXTTAB_PTR);
    const len = parsed.lines.reduce((n, l) => n + 5 + l.tokens.length, 2);
    blocks = [{ addr: start, len, why: via === 'rom' ? 'BASIC program (predicted from TXTTAB; CLOAD not yet run)' : 'BASIC program' }];
  }
  // Via 'rom' nothing has landed until the ROM reads the tape: every block is where it will go.
  if (via === 'rom') blocks = blocks.map((b) => ({ ...b, predicted: /** @type {true} */ (true) }));

  if (via === 'rom') {
    system.io.cassette.insertPulseTape(casToPulses(tapeForBaud(bytes, baud), baud));
  } else if (parsed.kind === 'system') {
    fastLoadSystem(system, parsed);
  } else {
    fastLoadBasic(system, parsed);
  }
  if (via === 'fast') machine.keyboard.clear();

  const head = { format: /** @type {'cas'} */ ('cas'), kind: parsed.kind, name: parsed.name };
  const tail = { blocks, baud: via === 'rom' ? baud : null, via };
  return parsed.kind === 'system' ? { ...head, entry: parsed.entry, ...tail } : { ...head, ...tail };
}

/**
 * What a mounted disk looks like from outside: its container and geometry, as `DiskImage` parsed
 * them, and whether writes are refused.
 * @param {number} drive
 * @param {DiskImage} disk
 * @returns {DriveInfo}
 */
function driveInfo(drive, disk) {
  const container = /** @type {'jv1' | 'jv3' | 'dmk'} */ (disk.format);
  const tracks = disk.trackCount();
  let sides = 1;
  if (container === 'dmk') sides = disk.dmk.sides;
  else if (container === 'jv3' && disk.jv3Map.some((/** @type {any} */ e) => e.side === 1)) sides = 2;
  /** @type {Set<number>} */
  const counts = new Set();
  if (container === 'jv1') counts.add(disk.sectorsPerTrack);
  else {
    for (let t = 0; t < tracks; t++) for (let side = 0; side < sides; side++) counts.add(disk.sectorsOn(t, side).length);
  }
  const info = { drive, container, tracks, sides };
  const [spt] = counts;
  return counts.size === 1 && spt > 0 ? { ...info, sectorsPerTrack: spt, writeProtected: disk.writeProtected } : { ...info, writeProtected: disk.writeProtected };
}

function checkDrive(op, drive) {
  if (!Number.isInteger(drive) || drive < 0 || drive > 3) throw new Error(`${op}: drive must be 0, 1, 2, or 3, not ${String(drive)}`);
}

/**
 * The four floppy drives of the Model III's WD1793 controller (spec §3, §6), over
 * `TRS80System.mountDisk` and `ejectDisk`. With no disk in any drive the controller's ports float
 * (read $FF), which is what sends the ROM to cassette BASIC at reset, so a machine with nothing
 * mounted boots as it did before disks existed.
 * @param {import('../machine/machine.js').Machine} machine
 */
export function diskDrives(machine) {
  const system = machine.system;
  return {
    /**
     * Put a disk in a drive, replacing what was there. Bytes are copied into a new `DiskImage`
     * (the container is detected from the content: DMK, then JV3, then JV1 by size); a
     * `DiskImage` is mounted as it is, so writes the machine makes show in it.
     * @param {number} drive 0..3
     * @param {Uint8Array | DiskImage} image
     * @param {{ writeProtect?: boolean }} [opts] `writeProtect` overrides the image's own flag (the DMK or JV3 header's); a passed `DiskImage` has its `writeProtected` set
     * @returns {DriveInfo}
     */
    mount(drive, image, { writeProtect } = {}) {
      checkDrive('fdc.mount', drive);
      if (writeProtect !== undefined && typeof writeProtect !== 'boolean') throw new Error(`fdc.mount: writeProtect must be true or false, not ${String(writeProtect)}`);
      let disk;
      if (image instanceof DiskImage) disk = image;
      else if (ArrayBuffer.isView(image) && image.BYTES_PER_ELEMENT === 1) {
        try {
          disk = new DiskImage(/** @type {Uint8Array} */ (image), `drive ${drive}`);
        } catch (e) {
          throw new Error(`fdc.mount: ${/** @type {Error} */ (e).message}`);
        }
      } else throw new Error('fdc.mount: the image must be a Uint8Array of a JV1, JV3, or DMK file, or a DiskImage');
      if (writeProtect !== undefined) disk.writeProtected = writeProtect;
      system.mountDisk(drive, disk);
      return driveInfo(drive, disk);
    },
    /**
     * Take the disk out of a drive.
     * @param {number} drive 0..3
     * @returns {boolean} true when there was a disk to take out
     */
    unmount(drive) {
      checkDrive('fdc.unmount', drive);
      const had = system.io.fdc.drives[drive] !== null;
      system.ejectDisk(drive);
      return had;
    },
    /**
     * The four drives, in order: each one's mount info, or null when empty. Read from the
     * controller each time, so it follows a snapshot restore.
     * @returns {(DriveInfo | null)[]}
     */
    get drives() {
      return system.io.fdc.drives.map((/** @type {DiskImage | null} */ d, i) => (d === null ? null : driveInfo(i, d)));
    },
  };
}

/**
 * Load a disk image: mount it, and with `boot` reset the machine so the ROM boots from drive 0
 * (it reads track 0, sector 1 to $4300 and jumps there; ROM $34D9-$3516). Nothing is in memory
 * when this returns, so the manifest's `blocks` is empty. Booting needs a disk in drive 0, this one
 * or one mounted before. A reset clears the keyboard queue; without `boot` it is left alone.
 * @param {import('../machine/machine.js').Machine} machine
 * @param {Uint8Array} bytes
 * @param {{ drive?: number, boot?: boolean }} [opts]
 * @returns {DskManifest}
 */
export function loadDsk(machine, bytes, { drive = 0, boot = true } = {}) {
  checkDrive('load.dsk', drive);
  if (typeof boot !== 'boolean') throw new Error(`load.dsk: boot must be true or false, not ${String(boot)}`);
  if (!(ArrayBuffer.isView(bytes) && bytes.BYTES_PER_ELEMENT === 1)) throw new Error('load.dsk: bytes must be a Uint8Array of a JV1, JV3, or DMK file');
  if (boot && drive !== 0 && machine.system.io.fdc.drives[0] === null) {
    throw new Error(`load.dsk: the ROM boots from drive 0, which is empty; mount a disk there first, or load into drive 0, or pass boot: false`);
  }
  let info;
  try {
    info = machine.fdc.mount(drive, bytes);
  } catch (e) {
    throw new Error(/** @type {Error} */ (e).message.replace(/^fdc\.mount/, 'load.dsk'));
  }
  if (boot) machine.reset();
  return { format: 'dsk', container: info.container, drive, boot, blocks: [] };
}
