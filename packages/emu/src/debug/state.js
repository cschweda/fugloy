/**
 * Save states: serialize a running TRS80System to a JSON-able object and
 * restore it into a system booted from the same ROM.
 *
 * The state carries everything the machine needs to resume mid-program:
 * CPU registers and interrupt state, RAM and video RAM, the I/O latches,
 * the FDC (including an in-flight command), the cassette tape, and the
 * full contents of every mounted disk (writes are in-memory, so the disk
 * bytes ARE the disk state). The ROM itself is NOT included — a state is
 * a snapshot of a machine, not a machine image.
 */

import { DiskImage } from "../devices/disk-image.js";

export const STATE_VERSION = 1;
export const STATE_MACHINE = "trs80-model3";

// Base64 without platform APIs, so the core runs anywhere (spec §2.1).
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    text += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    text += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    text += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return text;
}

export function fromBase64(text) {
  // Whitespace and the URL-safe alphabet are accepted, as the Buffer decoder upstream used them.
  const clean = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let out = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`not base64: ${JSON.stringify(ch)}`);
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (value >> bits) & 0xff;
    }
  }
  return bytes;
}

const CPU_SCALARS = [
  "IFF1",
  "IFF2",
  "interruptMode",
  "halted",
  "pendingEI",
  "wz",
  "cycles",
];
const IO_SCALARS = [
  "intLatch",
  "intMask",
  "nmiMask",
  "modeRegister",
  "cassetteOut",
];
const FDC_SCALARS = [
  "selected",
  "side",
  "trackReg",
  "sectorReg",
  "dataReg",
  "status",
  "intrq",
  "commandType",
  "bufferPos",
  "writing",
  "writeDeleted",
  "mfm",
  "indexClock",
];

export function serializeState(system) {
  const cpu = system.cpu;
  const io = system.io;
  const fdc = io.fdc;

  const registers = {};
  for (const name of Object.keys(cpu.registers)) {
    registers[name] = cpu.registers[name];
  }

  const state = {
    version: STATE_VERSION,
    machine: STATE_MACHINE,
    cpu: { registers },
    memory: {
      ram: toBase64(system.memory.ram),
      videoRam: toBase64(system.memory.videoRam),
    },
    io: {},
    fdc: {
      physicalTrack: [...fdc.physicalTrack],
      pending: fdc.pending ? { ...fdc.pending } : null,
      buffer: fdc.buffer ? toBase64(fdc.buffer) : null,
      trackWrite: fdc.trackWrite ? toBase64(new Uint8Array(fdc.trackWrite)) : null,
    },
    cassette: {
      tape: io.cassette.tapeData ? toBase64(io.cassette.tapeData) : null,
      position: io.cassette.tapePosition,
      motorOn: io.cassette.motorOn,
      // The CSAVE recording travels as its DECODED .cas bytes (small);
      // a pulse tape mid-play is deliberately not serialized — pulse
      // streams are hundreds of KB and re-inserting a tape is one
      // menu click.
      recorded: (() => {
        const rec = io.cassette.recordedCas();
        return rec.bytes.length ? toBase64(rec.bytes) : null;
      })(),
    },
    printer: { bytes: [...io.printer.bytes] },
    disks: [],
    nextRtcAt: system.nextRtcAt,
  };
  for (const key of CPU_SCALARS) state.cpu[key] = cpu[key];
  for (const key of IO_SCALARS) state.io[key] = io[key];
  for (const key of FDC_SCALARS) state.fdc[key] = fdc[key];

  fdc.drives.forEach((disk, drive) => {
    if (!disk) return;
    state.disks.push({
      drive,
      name: disk.name,
      bytes: toBase64(disk.bytes),
      sectorBase: disk.sectorBase,
      writeProtected: disk.writeProtected,
    });
  });

  return state;
}

/**
 * Restore a serialized state into a system built from the same ROM.
 * Throws on version/machine mismatch rather than resuming garbage.
 */
export function restoreState(system, state) {
  if (!state || state.machine !== STATE_MACHINE) {
    throw new Error("Not a TRS-80 Model III save state");
  }
  if (state.version !== STATE_VERSION) {
    throw new Error(`Unsupported save-state version ${state.version}`);
  }

  const cpu = system.cpu;
  const io = system.io;
  const fdc = io.fdc;

  for (const [name, value] of Object.entries(state.cpu.registers)) {
    cpu.registers[name] = value;
  }
  for (const key of CPU_SCALARS) cpu[key] = state.cpu[key];
  cpu.wz ??= 0; // absent in version-1 saves from before emu phase 1
  for (const key of IO_SCALARS) io[key] = state.io[key];

  system.memory.ram.set(fromBase64(state.memory.ram));
  system.memory.videoRam.set(fromBase64(state.memory.videoRam));
  system.memory.videoDirty = true;

  for (const key of FDC_SCALARS) fdc[key] = state.fdc[key];
  fdc.writeDeleted = !!fdc.writeDeleted; // absent in version-1 saves from before DAM support
  fdc.mfm = state.fdc.mfm ?? true; // absent before WRITE TRACK support
  fdc.physicalTrack = [...state.fdc.physicalTrack];
  fdc.pending = state.fdc.pending ? { ...state.fdc.pending } : null;
  fdc.buffer = state.fdc.buffer ? fromBase64(state.fdc.buffer) : null;
  fdc.trackWrite = state.fdc.trackWrite
    ? Array.from(fromBase64(state.fdc.trackWrite))
    : null;

  // Absent in saves from before the printer existed: clear the paper.
  io.printer.bytes = state.printer?.bytes ? [...state.printer.bytes] : [];

  io.cassette.eject();
  if (state.cassette.tape) {
    io.cassette.loadTape(fromBase64(state.cassette.tape));
    io.cassette.tapePosition = state.cassette.position;
  }
  io.cassette.motorOn = state.cassette.motorOn;
  io.cassette.recordLog = [];
  io.cassette.restoredRecording = state.cassette.recorded
    ? fromBase64(state.cassette.recorded)
    : null;
  io.cassette.lastCycle = cpu.cycles; // don't let playClock leap on resume

  fdc.drives = [null, null, null, null];
  for (const entry of state.disks) {
    const disk = new DiskImage(fromBase64(entry.bytes), entry.name);
    // Carry over learned/derived flags the constructor can't know
    disk.sectorBase = entry.sectorBase;
    disk.writeProtected = entry.writeProtected;
    fdc.drives[entry.drive & 3] = disk;
  }

  system.nextRtcAt = state.nextRtcAt;
  system._nmiWasPending = false;
  system.keyboard.reset(); // held keys don't survive a restore
  io.soundLog = [];

  return system;
}
