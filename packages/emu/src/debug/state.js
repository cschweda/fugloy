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
import { MODELS } from "../machine/models.js";

/** Model names by save-state machine id ("trs80-model1": "Model I"). */
const MODELS_BY_STATE = Object.fromEntries(Object.values(MODELS).map((d) => [d.stateMachine, d.name]));

export const STATE_VERSION = 1;
/** The Model III's machine id; a state carries its system's model's (`model.stateMachine`, models.js). */
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
  "afterPrefix",
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
  "command",
  "stepDir",
  "headLoaded",
  "idlePulses",
  "intrqCond",
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
    machine: system.model?.stateMachine ?? STATE_MACHINE,
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
    // The NMI edge latch: true while the INTRQ NMI already fired and its line is still up, so a
    // restore neither fires it again nor loses one still pending.
    nmiWasPending: system._nmiWasPending,
  };
  // The Model I's Expansion Interface latch at $37E0 (absent from Model III states, which stay as
  // they were, and from a Model I's without the interface) and its lowercase modification
  if (io.latch) state.latch = io.latch.bits;
  if (system.model?.id === 1) state.lowercase = !!system.lowercase;
  for (const key of CPU_SCALARS) state.cpu[key] = cpu[key];
  for (const key of IO_SCALARS) state.io[key] = io[key];
  for (const key of FDC_SCALARS) state.fdc[key] = fdc[key];

  fdc.drives.forEach((disk, drive) => {
    if (!disk) return;
    state.disks.push({
      drive,
      name: disk.name,
      bytes: toBase64(disk.bytes),
      // The container and a JV1's directory track, so a restore parses the bytes as what they
      // are rather than detecting again (a JV3 the session formatted may hold too few sectors for
      // detection, and a JV1's track 0 may have been rewritten since the mount read its byte 2).
      format: disk.format,
      dirTrack: disk.format === "jv1" ? disk.dirTrack : undefined,
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
  const machine = system.model?.stateMachine ?? STATE_MACHINE;
  if (!state || state.machine !== machine) {
    const name = system.model?.name ?? "Model III";
    const from = typeof state?.machine === "string" && Object.hasOwn(MODELS_BY_STATE, state.machine) ? MODELS_BY_STATE[state.machine] : undefined;
    // A state of a model the emulator builds says which; anything else keeps the old sentence.
    if (from !== undefined && name !== "Model III") {
      throw new Error(`This is a ${from} save state; the machine is a ${name}, and a state restores only into the model that saved it.`);
    }
    throw new Error(`Not a TRS-80 ${name} save state`);
  }
  if (state.version !== STATE_VERSION) {
    throw new Error(`Unsupported save-state version ${state.version}`);
  }
  const ram = fromBase64(state.memory.ram);
  if (ram.length !== system.memory.ram.length) {
    throw new Error(`This ${system.model?.name ?? "Model III"} save state has ${ram.length / 1024}K of RAM; the machine has ${system.memory.ram.length / 1024}K, and a state restores only into a machine with the same RAM`);
  }

  // A Model I state restores only into a Model I fitted the same way: the Expansion Interface
  // (its latch, its disk controller) and the lowercase modification (what video RAM holds).
  if (system.model?.id === 1) {
    const saved = Object.hasOwn(state, "latch");
    const fitted = system.io.latch !== null;
    if (saved !== fitted) {
      throw new Error(`This Model I save state was saved ${saved ? "with" : "without"} the Expansion Interface; the machine has ${fitted ? "one" : "none"}, and a state restores only into a machine fitted the same way (expansion: ${saved}).`);
    }
    const lowercase = state.lowercase ?? false;
    if (lowercase !== !!system.lowercase) {
      throw new Error(`This Model I save state was saved ${lowercase ? "with" : "without"} the lowercase modification; the machine has ${system.lowercase ? "it" : "none"}, and a state restores only into a machine fitted the same way (lowercase: ${lowercase}).`);
    }
  }

  const cpu = system.cpu;
  const io = system.io;
  const fdc = io.fdc;

  for (const [name, value] of Object.entries(state.cpu.registers)) {
    cpu.registers[name] = value;
  }
  for (const key of CPU_SCALARS) cpu[key] = state.cpu[key];
  cpu.wz ??= 0; // absent in version-1 saves from before emu phase 1
  cpu.afterPrefix ??= false; // likewise
  for (const key of IO_SCALARS) io[key] = state.io[key];

  system.memory.ram.set(ram);
  system.memory.videoRam.set(fromBase64(state.memory.videoRam));
  system.memory.videoDirty = true;

  for (const key of FDC_SCALARS) fdc[key] = state.fdc[key];
  fdc.writeDeleted = !!fdc.writeDeleted; // absent in version-1 saves from before DAM support
  fdc.mfm = state.fdc.mfm ?? true; // absent before WRITE TRACK support
  // Absent before the emu phase 5 datasheet model: the defaults a reset leaves.
  fdc.command ??= 0;
  fdc.stepDir ??= 1;
  fdc.headLoaded ??= false;
  fdc.idlePulses ??= 0;
  fdc.intrqCond ??= 0;
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
    // Saves from before emu phase 5's final fixes carry no format: detected, as they were made.
    const disk = new DiskImage(fromBase64(entry.bytes), entry.name, {
      format: entry.format ?? undefined,
      dirTrack: entry.dirTrack ?? undefined,
    });
    // Carry over flags the constructor can't know: write protection set at mount, and a JV1's
    // sector base (fixed by its geometry since emu phase 5; older saves may hold null, meaning the
    // geometry's, or a base learned by the fallback the reader then had).
    if (entry.sectorBase != null) disk.sectorBase = entry.sectorBase;
    disk.writeProtected = entry.writeProtected;
    fdc.drives[entry.drive & 3] = disk;
  }

  if (io.latch) io.latch.bits = state.latch ?? 0;
  system.nextRtcAt = state.nextRtcAt;
  system._nmiWasPending = state.nmiWasPending ?? false; // absent before emu phase 5
  system._fdcAhead = 0;
  system.keyboard.reset(); // held keys don't survive a restore
  io.soundLog = [];
  io.onSoundReset?.(); // the Machine's raw sound ring belongs to the old timeline

  return system;
}
