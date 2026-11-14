/**
 * The referee (M1 Task 4): runs a program on @fugloy/emu and its port on @fugloy/runtime side by side,
 * block by block, and stops at the first difference with a sentence naming where it is. It is test
 * code (emu is a devDependency of recomp, never a dependency), shared by referee.test.ts and the Learn
 * checks (learn.test.ts).
 *
 * How it runs (the plan's Task 4; the design's "The referee for the port"):
 *   - emu boots Fugløy's stub ROM (apps/web/app/utils/emulator/stub-rom.z, as lessons.test.ts builds it),
 *     which clears the screen, pushes its RETURNED and halts; the .CMD is loaded, and emu runs until its
 *     PC first equals the port's entry (`report.entryAddr`): at once, unless a hint file relocates the
 *     program, when the file's loader runs first and moves it to where it runs. For a game (`rom:
 *     'game'`, M2) the stub is the game stub ROM (game-rom.ts: the stub and Fugløy's Z80 stand-ins at the
 *     ROM's addresses), booted the same way, and port() is given the runtime's stand-ins, so a CALL to
 *     one runs the stand-in on the port and Fugløy's Z80 for it on emu. In CI, never the user's ROM;
 *     locally a test may pass the user's ROM bytes (`rom: <bytes>`), which emu boots to BASIC's READY
 *     before the load (helpers.ts, `bootToReady`), as a user loads a program and as Sea Dragon's sessions
 *     start on the user's ROM (controller Ruling 5), and port() is given the stand-ins.
 *   - The port's `Z` takes emu's registers, its mode register and its 64K at that moment, so the stub's
 *     bytes, the screen, RETURNED on the stack and whatever the loader left in the registers are the same
 *     on both. Then
 *     every address the .CMD loads, and every address of the program's code and DATA (its run
 *     addresses, from the IR), is put back to what a new `Z` holds and the runtime's `load` writes the
 *     port's DATA: the port runs on the memory a standalone port would have, with none of the program's
 *     code bytes (they read as `load` leaves them, 0 in RAM). A program that reads its own code as data
 *     therefore reads something else on the port, and the first register or byte that read changes
 *     stops the run, with the code byte named. The port's ROM space (below the model's ROM top, $3800 on
 *     the Model III, $3000 on the Model I) is not emu's either (controller Ruling 13): it holds what
 *     `load` leaves in a standalone port, the module's `ROM` (M2: the ROM bytes the trace saw the program
 *     read as data, taken on the game stub ROM) and $00 everywhere else. A ROM byte the program reads that
 *     the trace does not carry (or carries with another value than emu's ROM holds) therefore reaches a
 *     register as something else on the port, and the first register or byte it changes stops the run.
 *   - The port runs with `z.at` replaced. At each block start emu is stepped, an instruction at a time,
 *     until its T-states reach the port's; then emu's T-states must equal the port's, emu's PC the
 *     block's address, and every register, F, R, MEMPTR, the interrupt state, Q and the mode register
 *     (port $EC's latch on the Model III, port $FF's D0-D3 on the Model I: the 32-column bit and the
 *     alternate character set, which the browser player draws the screen from) must be equal, and every
 *     byte either machine wrote since the last block start. At the first block start at or after each
 *     frame (1/60 s of the model's clock, emu's `clockHz`), all of video RAM and the sound: every write to
 *     port $FF since the frame before (emu's `m.sound`, the runtime's `z.sound`), the same T-state and
 *     byte, write for write. At the end, the sound and every byte above the ROM space, less the
 *     exceptions below.
 *   - A `check.json` step applies at the first block start at or after its T-state (the T-states of the
 *     `run` steps before it, counted from the program's entry), on both machines: a key to both
 *     keyboards; `row` and `cell` checked on both, `pcIn` on emu's PC. The run ends at the first block
 *     start at or after the end of the last `run` (z.at throws a marker the referee catches), or when
 *     the program returns to RETURNED, whichever is first; steps not yet due when it returns apply to
 *     both machines as they stopped.
 *   - A write by emu into a byte of the program's code (every byte the .CMD loads but the port's DATA)
 *     stops the run, whichever instruction makes it (a store, a block move, a push, an interrupt's
 *     push) and whether or not that byte runs again: M1 translates no self-modifying code. From M2 a
 *     trace (`trace`, given to port() too) names the code bytes the program rewrites (its cells): a
 *     write to one is allowed, and the byte is compared with the port's like any byte written (the port
 *     holds each cell's initial value from `load` and reads it when its instruction runs). The port's
 *     own write guard (`load`'s) refuses a write into any other code byte as the port runs; emu is then
 *     stepped through the block to its write, and the run stops with the same sentence as above.
 *   - What the port refuses as it runs (a device the runtime does not model, a transfer to no block, a
 *     HALT, a RET elsewhere) stops the run with the port's sentence; for a device, emu is stepped
 *     through the block to the same access, which names the instruction.
 *
 * The memory compared is everything above the ROM space, the keyboard ($3800-$3BFF) as each machine reads
 * it from the keys held (at a byte of the program's code that is not a cell, the port must hold what
 * `load` left there), but for the Model I's Expansion Interface, $37E0-$37EF, whose 40 Hz interrupt latch
 * emu sets as time passes: the runtime does not model the Expansion Interface and throws a sentence at any
 * read or write there, so no port can differ there silently. The ROM space is never compared: a write
 * there is lost on both machines, and the port's ROM is the module's by definition (see above). A
 * relocated program's end-of-run compare also leaves out the bytes its loader left behind (see
 * `leftBehind` below), and nothing else.
 */
import { Machine, parseCmd } from '@fugloy/emu';
import { decodeAt, formatInstruction } from '@fugloy/z80';
import { createZ, load, runPort, standins } from '@fugloy/runtime';
import type { Z } from '@fugloy/runtime';
import { port } from '../src/index.js';
import { prepare } from '../src/port.js';
import { RUNTIME, bootToReady, cpuOf, emuState, hex, importPort, memOf, runTo, setZ, stub, zState } from './helpers.js';
import type { Model, State } from './helpers.js';
import type { PortTrace } from '../src/index.js';
import { gameStubRom } from './game-rom.js';

/** The word at `addr` on emu, low byte first, read without a device's side effect. */
const emuMemWord = (m: Machine, addr: number): number => m.system.memory.peekByte(addr) | (m.system.memory.peekByte((addr + 1) & 0xffff) << 8);

/** A step of a lesson's `check.json`, as packages/asm/test/lessons.test.ts documents them. */
export type Step =
  | { run: number }
  | { press: string }
  | { release: string }
  | { row: number; text: string }
  | { cell: string; byte: string }
  | { pcIn: string; to?: string };

export interface RefereeOptions {
  /** The program, a .CMD. */
  cmd: Uint8Array;
  model: Model;
  /**
   * Names for addresses (for a Learn program, its labels): `port()` names each address by the first (or
   * only) name given for it, and a `pcIn` step finds its label among all of them, so a label that shares
   * its address with another is found.
   */
  names?: ReadonlyMap<number, string | readonly string[]>;
  /** A hint file's text, given to `port()`; one that relocates the program makes the referee start at the port's entry. */
  hints?: string;
  steps: readonly Step[];
  /**
   * The ROM emu runs, and with it the stand-ins port() is given. 'stub' (the default): Fugløy's stub,
   * no stand-ins, as the Learn checks run. 'game': the game stub ROM (game-rom.ts), booted as the stub
   * is, and the runtime's stand-ins for the model. A ROM's bytes (the user's, locally): booted to BASIC's
   * READY (helpers.ts, `bootToReady`), the program's return address the word on the stack at its entry,
   * and the runtime's stand-ins.
   */
  rom?: 'stub' | 'game' | Uint8Array;
  /** For the referee's own tests: rewrites the port's module text before it runs, to plant a bug. */
  transform?: (js: string) => string;
  /** The program's trace (M2), given to `port()`: its cells are code bytes the program may write. */
  trace?: PortTrace;
}

/**
 * `cycles` are T-states from the program's entry. `ok`: how long the run was, how many block starts were
 * compared, at how many of them video RAM and the sound were (the frames), and how many writes to port
 * $FF were compared (`sounds`). Not `ok`: `report`, a sentence naming
 * what differed or was refused, both values, the block and the instruction; `at`, the block start where
 * the referee stopped (`routine` is the port's routine running it; after the program returned, '' and
 * the stub's RETURNED); `field`, what differed: a register as the runtime names it (`a` … `hl_`, `wz`,
 * `iff1`, `q`), `mode` (the mode register), `pc`, `cycles`, `mem[$XXXX]`, `sound` (a write to port $FF), `code` (self-modifying
 * code), `refusal`, `port` (no port could be made), `entry` (emu never reached the port's entry), or a
 * step's `row N`, `cell $XXXX` or `pcIn`.
 */
export type RefereeResult =
  | { ok: true; cycles: number; blocks: number; frames: number; sounds: number }
  | { ok: false; report: string; at: { routine: string; block: number; cycles: number }; field: string };

const $2 = (n: number): string => `$${hex(n, 2)}`;
const $4 = (n: number): string => `$${hex(n, 4)}`;

/** The order registers are compared in, and how each is named in a report. */
const REGISTERS: readonly (readonly [keyof State, string, 8 | 16 | 'flag'])[] = [
  ['a', 'A', 8], ['f', 'F', 8], ['b', 'B', 8], ['c', 'C', 8], ['d', 'D', 8], ['e', 'E', 8], ['h', 'H', 8], ['l', 'L', 8],
  ['ix', 'IX', 16], ['iy', 'IY', 16], ['sp', 'SP', 16], ['i', 'I', 8], ['r', 'R', 8], ['wz', 'MEMPTR', 16],
  ['af_', "AF'", 16], ['bc_', "BC'", 16], ['de_', "DE'", 16], ['hl_', "HL'", 16],
  ['iff1', 'IFF1', 'flag'], ['iff2', 'IFF2', 'flag'], ['im', 'IM', 'flag'], ['q', 'Q', 'flag'],
  // The one device state the runtime keeps: port $EC's latch on the Model III, port $FF's D0-D3 on the
  // Model I (the 32-column bit, the alternate character set), which a player draws the screen from
  ['mode', 'mode register', 8],
];
const FLAG_BITS = ['C', 'N', 'P/V', '3', 'H', '5', 'Z', 'S'];

const VIDEO = 0x3c00;
const KEYBOARD = { start: 0x3800, end: 0x3bff };
/** The Model I's Expansion Interface (see the header): left out of every memory compare, as the ROM space is. */
const EXPANSION = { start: 0x37e0, end: 0x37ef };
/** How far emu is stepped looking for the access or instruction a refusal names. */
const SEARCH_LIMIT = 1_000_000;
/** How far emu is stepped from the load looking for the port's entry (a relocated program's loader runs first). */
const ENTRY_LIMIT = 10_000_000;

/** The trampoline's suffix on an error thrown in a routine (@fugloy/runtime's ops.js, `call`). */
const PLACED = / \(in ([A-Za-z0-9_$]+), in the block at \$([0-9A-F]{4})\)$/;
/** The runtime's sentence for a device it does not model (z.js: expansionError, portError). */
const DEVICE = /^the port does not model \$([0-9A-F]{2,4}) \((an I\/O port|the Model I's Expansion Interface)/;
/** The address a control refusal names (ops.js: unknown, halt, ret). */
const NAMED_AT = /^the (?:transfer|HALT|RET) at \$([0-9A-F]{4})\b/;
/** The runtime's write guard refusing a write into the port's code (z.js, codeWriteError). */
const GUARD = /^self-modifying code: \$[0-9A-F]{4} written \(the trace does not name it/;

/**
 * Thrown from `z.at` to stop the port where a comparison failed; an Error, so the trampoline names the
 * routine. `step` marks a check step's failure, which needs no account of the block before.
 */
class Stop extends Error {
  constructor(
    readonly field: string,
    readonly what: string,
    readonly step = false,
  ) {
    super(what);
  }
}

/** Thrown from `z.at` when the steps are spent: not an Error, so the trampoline passes it on untouched. */
const END = Object.freeze({ end: true });

/** The screen row as text, as emu's `m.video.text()` reads the Model I's and III's (devices/video.js, text). */
function screenRow(z: Z, row: number): string {
  const step = z.columns32 ? 2 : 1;
  let line = '';
  for (let col = 0; col < 64 / step; col++) {
    let byte = z.mem[VIDEO + row * 64 + col * step]!;
    if (byte < 0x20) byte += 0x40;
    line += byte >= 0x20 && byte < 0x80 ? String.fromCharCode(byte) : '.';
  }
  return line;
}

/**
 * Throws a sentence for steps the referee cannot judge by: a step that is not one of check.json's forms,
 * steps with no `run` (the run would end at the first block start, having compared that block alone),
 * and a `pcIn` label `labels` does not hold. These are input errors, found before anything runs.
 */
function checkSteps(steps: readonly Step[], labels: ReadonlyMap<string, number>): void {
  steps.forEach((s, i) => {
    const keys = Object.keys(s).sort().join(',');
    const ok = ['run', 'press', 'release', 'row,text', 'byte,cell', 'pcIn', 'pcIn,to'].includes(keys) &&
      (!('run' in s) || (Number.isInteger(s.run) && s.run > 0));
    if (!ok) throw new Error(`step ${i + 1} (${JSON.stringify(s)}) is not one of run, press, release, row and text, cell and byte, pcIn, or pcIn and to`);
  });
  if (!steps.some((s) => 'run' in s)) throw new Error('the steps have no run step, so the referee would compare the first block alone; give it a run of some T-states');
  for (const s of steps) {
    if (!('pcIn' in s)) continue;
    for (const label of s.to === undefined ? [s.pcIn] : [s.pcIn, s.to]) {
      if (!labels.has(label)) throw new Error(`pcIn names ${label}, which the names given do not hold`);
    }
  }
}

/** Run the program `cmd` on emu and its port side by side; see the header. */
export async function referee(opts: RefereeOptions): Promise<RefereeResult> {
  const { cmd, model, steps } = opts;
  /** The port's names, the first given at each address; and every name given, to its address, for pcIn. */
  const names = new Map<number, string>();
  const labels = new Map<string, number>();
  for (const [address, given] of opts.names ?? new Map<number, string>()) {
    const all = typeof given === 'string' ? [given] : given;
    if (all.length > 0) names.set(address, all[0]!);
    for (const label of all) if (!labels.has(label)) labels.set(label, address);
  }
  checkSteps(steps, labels);

  const rom = opts.rom ?? 'stub';
  const standinNames = new Map(rom === 'stub' ? [] : [...standins(model)].map(([at, s]) => [at, s.name]));
  const portOptions = {
    model, names, runtimeImport: RUNTIME, standins: standinNames,
    ...(opts.hints === undefined ? {} : { hints: opts.hints }),
    ...(opts.trace === undefined ? {} : { trace: opts.trace }),
  };
  const p = port(cmd, portOptions);
  const prepared = prepare(cmd, portOptions);
  if (!p.ok || !prepared.ok) return { ok: false, report: (p.ok ? [] : p.errors).join(' '), at: { routine: '', block: parseCmd(cmd).entry, cycles: 0 }, field: 'port' };
  const mod = await importPort(opts.transform === undefined ? p.js : opts.transform(p.js));

  // ---- emu: the stub booted (or a user's ROM booted to READY), the program loaded, and run to the port's
  // entry (through the loader, if any)
  const booted = typeof rom === 'string';
  const m = new Machine({ model, roms: { level2: rom === 'stub' ? stub(model).rom : rom === 'game' ? gameStubRom(model) : rom } });
  if (booted && m.run({ until: 'halt', cycles: m.clockHz }).reason !== 'halt') throw new Error('the stub ROM did not start and halt');
  if (!booted) bootToReady(m);
  m.load.cmd(cmd);
  const cpu = cpuOf(m);
  if (!runTo(m, p.report.entryAddr, ENTRY_LIMIT)) {
    return {
      ok: false,
      report: `emu did not reach the port's entry, ${$4(p.report.entryAddr)}, in ${ENTRY_LIMIT.toLocaleString('en-US')} instructions after the load; its PC is ${$4(cpu.registers.PC!)}`,
      at: { routine: p.report.entry, block: p.report.entryAddr, cycles: 0 },
      field: 'entry',
    };
  }
  // Where the entry returns to: the stub's RETURNED (the game stub's is the same address), or on the
  // user's ROM the word on its stack at the entry, which runPort takes as the return address.
  const returned = booted ? stub(model).returned : emuMemWord(m, cpu.registers.SP!);
  const emuMem = m.system.memory;
  const start = emuState(m);
  const startMem = memOf(m);

  // The program's code: the IR's code regions, at the addresses the program runs at, but a relocated
  // program's loader, which the port does not translate. `length` holds each code byte's instruction
  // length, so a read of an instruction's own bytes (its fetch) is told from a read of code as data.
  const loaded = new Uint8Array(0x10000);
  for (const b of parseCmd(cmd).blocks) for (let k = 0; k < b.data.length; k++) loaded[(b.addr + k) & 0xffff] = 1;
  const code = new Uint8Array(0x10000);
  for (const r of prepared.prepared.code) code.fill(1, r.start, r.end + 1);
  /** The trace's cells: code bytes the program may write, compared like any other byte written. */
  const cell = new Uint8Array(0x10000);
  for (const c of p.report.cells) cell[c.addr] = 1;
  const inData = new Uint8Array(0x10000);
  for (const d of p.report.data) for (let k = 0; k < d.length; k++) inData[(d.addr + k) & 0xffff] = 1;
  const length = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) if (code[a]) length[a] = decodeAt(startMem, a).length;
  // The bytes a relocated program's loader left behind: what the .CMD loads that is neither the program's
  // code nor its DATA at the addresses it runs at (the file's copy of the moved program outside the run
  // range, and the loader itself). They are not part of the port, which holds what a new `Z` holds there,
  // so the end-of-run compare leaves them out; nothing else does. A read of one by the program still
  // shows up at the next block start, as a register (or a byte written) that differs. For a program
  // nothing relocates, the .CMD loads exactly its code and DATA, and there are none.
  const leftBehind = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) if (loaded[a] && !code[a] && !inData[a]) leftBehind[a] = 1;

  // ---- the port: emu's registers and 64K, but the program's bytes and the ROM space as a standalone port
  // has them (Ruling 1: set straight into its memory before `load`, so the write guard `load` installs
  // never sees them; Ruling 13: the ROM space as a new Z holds it, $00, until `load` stores the module's ROM)
  const z = createZ({ model });
  const fresh = z.mem.slice();
  const romTop = z.romTop;
  setZ(z, start, startMem);
  for (let a = 0; a < 0x10000; a++) if (a < romTop || loaded[a] || code[a] || inData[a]) z.mem[a] = fresh[a]!;
  load(z, mod);

  // ---- watching both machines' writes, and emu's reads of code as data
  /** The address of the instruction emu is running (or last ran). */
  let instrPc = cpu.registers.PC!;
  let selfModifying: { addr: number; pc: number } | null = null;
  let codeRead: { addr: number; pc: number } | null = null;
  const written = new Uint8Array(0x10000);
  const dirty: number[] = [];
  const mark = (a: number): void => {
    if (written[a] === 0) {
      written[a] = 1;
      dirty.push(a);
    }
  };
  const emuWrite = cpu.writeMemory;
  const emuRead = cpu.readMemory;
  cpu.writeMemory = (addr: number, v: number): void => {
    const a = addr & 0xffff;
    if (code[a] && !cell[a] && selfModifying === null) selfModifying = { addr: a, pc: instrPc };
    mark(a);
    emuWrite(addr, v);
  };
  cpu.readMemory = (addr: number): number => {
    const a = addr & 0xffff;
    if (code[a] && codeRead === null && ((a - instrPc) & 0xffff) >= length[instrPc]!) codeRead = { addr: a, pc: instrPc };
    return emuRead(addr);
  };
  // The program's sound starts at its entry: the boot's and the loader's writes are not compared
  m.sound.clear();
  z.sound.length = 0;
  const zWrite = z.write.bind(z);
  z.write = (addr: number, v: number): void => {
    mark(addr & 0xffff);
    zWrite(addr, v);
  };

  const since = (t: number): number => t - start.cycles;
  const instructionAt = (pc: number): string => `${$4(pc)}, ${formatInstruction(decodeAt(startMem, pc))}`;
  const selfModSentence = (s: { addr: number; pc: number }): string =>
    `self-modifying code: ${$4(s.addr)} written by the instruction at ${$4(s.pc)} (the trace does not name it; run the census over a session that reaches this)`;
  const codeReadNote = (): string =>
    codeRead === null ? '' : ` Emu's instruction at ${$4(codeRead.pc)} read ${$4(codeRead.addr)}, a byte of the program's code, as data (the run's first such read); the port carries no code bytes.`;

  /** Step emu one instruction; a write into the code stops the run. */
  const stepEmu = (): void => {
    instrPc = cpu.registers.PC!;
    m.step();
    if (selfModifying !== null) throw new Stop('code', selfModSentence(selfModifying));
  };
  const catchUp = (): void => {
    while (cpu.cycles < z.cycles) stepEmu();
  };

  // ---- the comparisons, each throwing a Stop at the first difference
  let prevBlock: number | null = null;
  /** Where the instructions that led here ran: the block before, and emu's last instruction in it. */
  const context = (): string =>
    prevBlock === null ? '' : `; the block before it, at ${$4(prevBlock)}, ran on emu to its instruction at ${instructionAt(instrPc)}`;

  const compareCpu = (pc: number): void => {
    const e = emuState(m);
    if (e.cycles !== z.cycles) throw new Stop('cycles', `T-states: port ${since(z.cycles)}, emu ${since(e.cycles)}`);
    if (cpu.registers.PC !== pc) throw new Stop('pc', `PC: port ${$4(pc)}, emu ${$4(cpu.registers.PC!)}`);
    const s = zState(z);
    for (const [key, name, width] of REGISTERS) {
      const pv = s[key];
      const ev = e[key];
      if (pv === ev) continue;
      const show = (v: number | boolean): string => (width === 8 ? $2(v as number) : width === 16 ? $4(v as number) : String(v));
      let bits = '';
      if (key === 'f') {
        const x = (pv as number) ^ (ev as number);
        bits = ` (${FLAG_BITS.filter((_, k) => x & (1 << k)).reverse().join(' ')} ${x & (x - 1) ? 'differ' : 'differs'})`;
      }
      throw new Stop(key, `${name}: port ${show(pv)}, emu ${show(ev)}${bits}`);
    }
  };

  /**
   * One address, the port's against emu's: the port must hold emu's byte, but at a code byte that is not
   * one of the trace's cells what `load` left there; the keyboard as each machine reads it; the ROM space
   * and the Model I's Expansion Interface not at all.
   */
  const compareByte = (a: number): void => {
    if (a < romTop) return;
    if (model === 1 && a >= EXPANSION.start && a <= EXPANSION.end) return;
    const keyboard = a >= KEYBOARD.start && a <= KEYBOARD.end;
    const pv = keyboard ? z.read(a) : z.mem[a]!;
    const ev = emuMem.peekByte(a);
    const carried = code[a] && !cell[a];
    const want = carried ? fresh[a]! : ev;
    if (pv === want) return;
    const note = carried ? ` (a byte of the program's code, where the port holds what load left, ${$2(want)})` : '';
    throw new Stop(`mem[${$4(a)}]`, `${$4(a)}: port ${$2(pv)}, emu ${$2(ev)}${note}`);
  };
  const compareWritten = (): void => {
    for (const a of dirty) {
      written[a] = 0;
      compareByte(a);
    }
    dirty.length = 0;
  };
  const compareRange = (from: number, to: number): void => {
    for (let a = from; a < to; a++) compareByte(a);
  };
  /** The end-of-run compare: every byte `compareByte` compares (above the ROM space), but the bytes a relocated program's loader left behind (see `leftBehind`), and the sound. */
  const compareEnd = (): void => {
    for (let a = 0; a < 0x10000; a++) if (!leftBehind[a]) compareByte(a);
    compareSound();
  };

  /**
   * The writes to port $FF since the last compare, emu's (`m.sound`, its ring) against the port's
   * (`z.sound`), write for write: the same T-state and byte, and as many. Both are emptied after, so each
   * compare sees its own frame's writes only. emu's ring keeps the newest 65,536 and counts what it drops
   * (`overflowed`): between two compares the program runs a frame and one block (a block repeats nothing
   * but a block instruction, at most 256 times), a few thousand OUTs at most, so it never drops one; if it
   * ever did, the compare stops rather than miss a write.
   */
  const compareSound = (): void => {
    if (m.sound.overflowed > 0) {
      throw new Stop('sound', `sound: emu's ring of port $FF writes dropped ${m.sound.overflowed} since the last compare, so the writes cannot be compared`);
    }
    const ev = m.sound.events();
    const pv = z.sound;
    const show = (w: { t: number; v: number } | undefined): string => (w === undefined ? 'no write' : `${$2(w.v)} at T-state ${since(w.t)}`);
    for (let k = 0; k < Math.max(ev.length, pv.length); k++) {
      const e = ev[k] === undefined ? undefined : { t: ev[k]!.cycle, v: ev[k]!.value };
      const q = pv[k];
      if (e !== undefined && q !== undefined && e.t === q.t && e.v === q.v) continue;
      throw new Stop('sound', `sound: write ${k + 1} to port $FF since the last compare (of ${ev.length} on emu, ${pv.length} on the port): port ${show(q)}, emu ${show(e)}`);
    }
    sounds += ev.length;
    m.sound.clear();
    z.sound.length = 0;
  };

  // ---- the steps, at their T-states from the entry
  const due: { t: number; step: Exclude<Step, { run: number }>; index: number }[] = [];
  let endT = start.cycles;
  steps.forEach((s, index) => {
    if ('run' in s) endT += s.run;
    else due.push({ t: endT, step: s, index });
  });
  let next = 0;
  /** A pcIn label's address; checkSteps has made sure each is there. */
  const addressOf = (label: string): number => labels.get(label)!;
  const applyStep = (step: Exclude<Step, { run: number }>, index: number): void => {
    const where = `step ${index + 1} ${JSON.stringify(step)}`;
    if ('press' in step) {
      m.keyboard.press(step.press);
      z.press(step.press);
    } else if ('release' in step) {
      m.keyboard.release(step.release);
      z.release(step.release);
    } else if ('row' in step) {
      const ev = m.video.text()[step.row]!.trimEnd();
      const pv = screenRow(z, step.row).trimEnd();
      if (ev !== step.text || pv !== step.text) throw new Stop(`row ${step.row}`, `${where}: row ${step.row} is ${JSON.stringify(ev)} on emu and ${JSON.stringify(pv)} on the port; the check wants ${JSON.stringify(step.text)}`, true);
    } else if ('cell' in step) {
      const a = parseInt(step.cell, 16);
      const want = parseInt(step.byte, 16);
      const ev = m.mem.read(a, 1)[0]!;
      const pv = z.read(a);
      if (ev !== want || pv !== want) throw new Stop(`cell ${$4(a)}`, `${where}: ${$4(a)} is ${$2(ev)} on emu and ${$2(pv)} on the port; the check wants ${$2(want)}`, true);
    } else {
      const from = addressOf(step.pcIn);
      const last = step.to === undefined ? from + decodeAt(startMem, from).length - 1 : addressOf(step.to) - 1;
      const pc = cpu.registers.PC!;
      if (pc < from || pc > last) throw new Stop('pcIn', `${where}: emu's PC is ${$4(pc)}, not in ${step.pcIn}${step.to === undefined ? '' : ` up to ${step.to}`} (${$4(from)}-${$4(last)})`, true);
    }
  };
  const applyDue = (now: number): void => {
    while (next < due.length && due[next]!.t <= now) {
      applyStep(due[next]!.step, due[next]!.index);
      next++;
    }
  };

  // ---- the run
  const frameT = m.clockHz / 60;
  let nextFrame = Math.ceil(start.cycles / frameT) * frameT;
  let blocks = 0;
  let frames = 0;
  /** The writes to port $FF compared, on each machine. */
  let sounds = 0;
  z.at = (addr: number): void => {
    z.block = addr;
    catchUp();
    blocks++;
    compareCpu(addr);
    compareWritten();
    if (z.cycles >= nextFrame) {
      compareRange(VIDEO, VIDEO + 0x400);
      compareSound();
      frames++;
      nextFrame = (Math.floor(z.cycles / frameT) + 1) * frameT;
    }
    applyDue(z.cycles);
    if (next === due.length && z.cycles >= endT) {
      compareEnd();
      throw END;
    }
    prevBlock = addr;
  };

  const stopped = (field: string, report: string, routine: string, block: number): RefereeResult => ({
    ok: false,
    report,
    at: { routine, block, cycles: since(z.cycles) },
    field,
  });
  /** The report: what stopped the run, where (`where`), and for a difference, what ran before it. */
  const explain = (s: Stop, where: string): string => {
    if (s.field === 'code') return `${s.what} (found ${where})`;
    if (s.step) return `${s.what}, ${where}`;
    return `${s.what}, ${where}${context()}.${codeReadNote()}`;
  };
  const inBlock = (routine: string, block: number): string =>
    `at the start of the block at ${$4(block)} (in ${routine}), T-state ${since(z.cycles)} from the entry`;
  const placed = (e: Error): { routine: string; block: number } => {
    const where = PLACED.exec(e.message);
    return where === null ? { routine: '', block: z.block } : { routine: where[1]!, block: parseInt(where[2]!, 16) };
  };

  try {
    runPort(z, mod);
  } catch (e) {
    if (e === END) return { ok: true, cycles: since(z.cycles), blocks, frames, sounds };
    if (e instanceof Stop) {
      const { routine, block } = placed(e);
      return stopped(e.field, explain(e, inBlock(routine, block)), routine, block);
    }
    if (!(e instanceof Error)) throw e;
    // The port refused something as it ran: emu is at the start of the block it refused in.
    const { routine, block } = placed(e);
    try {
      return stopped('refusal', `${e.message}${findOnEmu(e.message)}`, routine, block);
    } catch (s) {
      if (s instanceof Stop) return stopped(s.field, explain(s, inBlock(routine, block)), routine, block);
      throw s;
    }
  }

  /**
   * Step emu through the refused block to the access or instruction the refusal names; the sentence's end.
   * For the write guard's refusal, emu's own write into the code stops the run (stepEmu's Stop) with
   * the self-modifying-code sentence, naming the instruction.
   */
  function findOnEmu(message: string): string {
    if (GUARD.test(message)) {
      for (let n = 0; n < SEARCH_LIMIT; n++) stepEmu();
      return `; emu wrote no byte of the program's code in the next ${SEARCH_LIMIT.toLocaleString('en-US')} instructions`;
    }
    const device = DEVICE.exec(message);
    const named = NAMED_AT.exec(message);
    if (device === null && named === null) return '';
    let hit: number | null = null;
    const restore = { readMemory: cpu.readMemory, writeMemory: cpu.writeMemory, readPort: cpu.readPort, writePort: cpu.writePort };
    if (device !== null) {
      const target = parseInt(device[1]!, 16);
      if (device[2] === 'an I/O port') {
        cpu.readPort = (p: number): number => {
          if ((p & 0xff) === target) hit ??= instrPc;
          return restore.readPort(p);
        };
        cpu.writePort = (p: number, v: number): void => {
          if ((p & 0xff) === target) hit ??= instrPc;
          restore.writePort(p, v);
        };
      } else {
        cpu.readMemory = (a: number): number => {
          if ((a & 0xffff) === target) hit ??= instrPc;
          return restore.readMemory(a);
        };
        cpu.writeMemory = (a: number, v: number): void => {
          if ((a & 0xffff) === target) hit ??= instrPc;
          restore.writeMemory(a, v);
        };
      }
    }
    const at = named === null ? -1 : parseInt(named[1]!, 16);
    try {
      for (let n = 0; n < SEARCH_LIMIT && hit === null; n++) {
        const pc = cpu.registers.PC!;
        stepEmu();
        if (pc === at) hit = pc;
      }
    } finally {
      Object.assign(cpu, restore);
    }
    if (hit === null) return `; emu made no such ${device === null ? 'transfer' : 'access'} in the next ${SEARCH_LIMIT.toLocaleString('en-US')} instructions`;
    return device === null ? '' : `; emu's instruction at ${instructionAt(hit)}, made the same access`;
  }

  // The program returned to the stub's RETURNED: emu to the same T-state, the steps not yet due, the end's compare.
  try {
    catchUp();
    compareCpu(returned);
    compareWritten();
    applyDue(Infinity);
    compareEnd();
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    return stopped(e.field, explain(e, `after the program returned to ${booted ? "the stub's RETURNED" : 'the address on the stack at the entry'} (${$4(returned)}), T-state ${since(z.cycles)} from the entry`), '', returned);
  }
  return { ok: true, cycles: since(z.cycles), blocks, frames, sounds };
}
