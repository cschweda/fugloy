/**
 * The reference machine for emu phase 7's differential harness: trsjs (`trsemu-1.6.js`, Peter
 * Phillips's in-browser TRS-80 Model III emulator, https://trsjs.48k.ca/, converted from trs80gp's
 * C), driven one instruction at a time from Node.
 *
 * trsjs carries no license, so it is never committed: `pnpm trsjs:install` fetches it into the
 * gitignored `tools/trsjs/`, and this loader refuses any file whose SHA-256 is not the pinned one
 * before running a line of it. The script runs in a `node:vm` context with a few DOM stubs. Its
 * text is changed in memory only (the file on disk is never touched), in two places: one line
 * before the IIFE's final `return api;` exposes the internal functions the harness needs, and one
 * line at the top of `putbyte` (trsjs's only CPU write path) logs each write the CPU makes.
 *
 * The driver reproduces trsjs's own frame loop (`TRS80Field`) one instruction at a time: after
 * an instruction drives the per-frame down-counter `z.cycles` below 0, a frame (33,792 T-states)
 * has passed; on odd frames, with the beam interrupt enabled in port $E0's latch, trsjs raises it
 * and takes it in IM 1 when IFF1 is set (and drops it otherwise). That frame-end check runs at the
 * start of the next `step`, so an interrupt response counts with the instruction after it, as
 * `Machine.step` counts it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/** The SHA-256 of the one trsemu-1.6.js the harness runs (scripts/install-trsjs.sh pins the same). */
export const TRSJS_SHA256 = 'd6e5b270ba23d429c8fe548573b680a1c8b2b1a8e11d65886c4fb9778ac052fc';

/** Where `pnpm trsjs:install` puts the script. */
export const TRSJS_PATH = fileURLToPath(new URL('../../../../tools/trsjs/trsemu-1.6.js', import.meta.url));

/** Our 30 Hz heartbeat period (RTC_INTERVAL_TSTATES), which is two of trsjs's frames. */
const RTC_PERIOD = 67_584;

const EXPORTS = ['stepz80', 'mode_1_IRQ', 'BEAM_IRQ_ENABLED', 'BEAM_IRQ_RAISE', 'getAF', 'setAF', 'resetz80'];
const RETURN_MARKER = "\t// Create the default emulator\n\tapi = api['mknew']();\n\n\treturn api;";
const PUTBYTE_MARKER = 'function putbyte(z,addr,val)\n{\n';

/**
 * @typedef {import('../../src/machine/machine.js').Regs} Regs
 * @typedef {import('../../src/machine/machine.js').Machine} Machine
 * @typedef {{ addr: number, value: number }} Write
 * @typedef {{
 *   reset(): void,
 *   step(): { cycles: number, irq: boolean },
 *   regs(): Regs,
 *   peek(addr: number, len: number): Uint8Array,
 *   poke(addr: number, bytes: ArrayLike<number>): void,
 *   setKeyBit(row: number, bit: number, down: boolean): void,
 *   alignRtc(phaseTStates: number): void,
 *   syncFrom(machine: Machine): void,
 *   writes(): Write[],
 *   readonly cycles: number,
 *   readonly z: any,
 * }} Reference
 */

function stubElement() {
  return {
    style: {}, value: '', width: 0, height: 0, childNodes: [], children: [],
    addEventListener() {}, removeEventListener() {}, appendChild(/** @type {any} */ c) { return c; }, removeChild() {},
    setAttribute() {}, getAttribute() { return null; }, insertBefore(/** @type {any} */ c) { return c; },
    getContext() { return null; }, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
    focus() {}, blur() {},
  };
}

/**
 * Read and check the script: a missing file or one with another hash is refused with a sentence
 * naming the fix.
 * @param {string} path
 */
function readChecked(path) {
  if (!existsSync(path)) {
    throw new Error(`no trsjs at ${path}; run \`pnpm trsjs:install\` to fetch trsemu-1.6.js (SHA-256 ${TRSJS_SHA256})`);
  }
  const buf = readFileSync(path);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== TRSJS_SHA256) {
    throw new Error(`${path} has SHA-256 ${sha}, not the pinned ${TRSJS_SHA256}; delete it and run \`pnpm trsjs:install\``);
  }
  return buf.toString('utf8');
}

/**
 * Load trsjs and wrap its Z80 as a Reference, in its power-on state with the 30 Hz interrupt on
 * our schedule (first at T-state 67,584).
 * @param {{ path?: string }} [opts]
 * @returns {Reference}
 */
export function loadTrsjs({ path = TRSJS_PATH } = {}) {
  let src = readChecked(path);
  if (!src.includes(RETURN_MARKER) || !src.includes(PUTBYTE_MARKER)) throw new Error(`${path}: an injection point is missing (the pinned file should have both)`);
  src = src.replace(RETURN_MARKER, RETURN_MARKER.replace('return api;',
    `api.__x = { ${EXPORTS.map((n) => `${n}: ${n}`).join(', ')}, cyclesPerFrame: function () { return cycles_per_frame; } };\n\treturn api;`));
  src = src.replace(PUTBYTE_MARKER, `${PUTBYTE_MARKER}   if (z.wlog) z.wlog.push(addr, val);\n`);

  const document = {
    getElementById() { return null; }, createElement() { return stubElement(); },
    addEventListener() {}, removeEventListener() {}, body: stubElement(), documentElement: stubElement(),
    activeElement: null,
  };
  /** @type {any} */
  const ctx = {
    document, navigator: { userAgent: 'node', platform: 'node' }, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, Image: function () { return stubElement(); },
    XMLHttpRequest: function () { return { open() {}, send() {}, overrideMimeType() {}, setRequestHeader() {} }; },
    location: { href: 'about:blank', search: '' }, addEventListener() {}, removeEventListener() {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'trsemu-1.6.js' });
  const api = ctx.trsEmu;
  const z = api.trs80; // z.reg, z.mem (a plain Array of 65,536), z.cycles (counts DOWN within a frame)
  const x = api.__x;
  const kbd = z.dev.kbd;
  const cpf = x.cyclesPerFrame();
  /** @type {number[]} Flat (addr, value) pairs written during the current step. */
  const wlog = [];
  z.wlog = wlog;
  let total = 0;

  /** The frame-end handling TRS80Field runs after the instruction that drove z.cycles below 0. */
  function frameEnd() {
    if (z.cycles >= 0) return { used: 0, irq: false };
    z.frame_cnt++;
    z.cycles += cpf;
    if (!x.BEAM_IRQ_ENABLED(z) || z.frame_cnt % 2 !== 1) return { used: 0, irq: false };
    x.BEAM_IRQ_RAISE(z);
    const before = z.cycles;
    const irq = !!x.mode_1_IRQ(z);
    return { used: before - z.cycles, irq };
  }

  /** @param {number} phase */
  function alignRtc(phase) {
    // An odd frame starts once `phase` more T-states have passed (z.cycles goes below 0 then).
    z.frame_cnt = 0;
    z.cycles = phase - 1;
  }

  /** @type {Reference} */
  const ref = {
    reset() {
      x.resetz80(z);
      // Our I/O reset: interrupt mask and mode register 0, no source latched (port $E0 reads
      // active low). trsjs never sets port_status[$E0] itself, so IN A,($E0) would read garbage.
      z.port_latch[0xe0] = 0;
      z.port_status[0xe0] = 0xff;
      z.port_latch[0xec] = 0;
      total = 0;
      alignRtc(RTC_PERIOD);
      wlog.length = 0;
    },

    step() {
      wlog.length = 0;
      const fe = frameEnd();
      const before = z.cycles;
      x.stepz80(z);
      const cycles = fe.used + (before - z.cycles);
      total += cycles;
      return { cycles, irq: fe.irq };
    },

    regs() {
      const r = z.reg;
      const f = x.getAF(z) & 0xff;
      return {
        a: r.A, f, b: r.BC >> 8, c: r.BC & 0xff, d: r.DE >> 8, e: r.DE & 0xff, h: r.HL >> 8, l: r.HL & 0xff,
        a2: r.AFp >> 8, f2: r.AFp & 0xff, b2: r.BCp >> 8, c2: r.BCp & 0xff, d2: r.DEp >> 8, e2: r.DEp & 0xff, h2: r.HLp >> 8, l2: r.HLp & 0xff,
        ix: r.IX, iy: r.IY, sp: r.SP, pc: r.PC, i: r.I, r: r.R & 0x7f,
        iff1: !!r.IFF1, iff2: !!r.IFF2, im: r.IM,
      };
    },

    peek(addr, len) {
      const out = new Uint8Array(len);
      for (let k = 0; k < len; k++) out[k] = z.mem[(addr + k) & 0xffff] & 0xff;
      return out;
    },

    poke(addr, bytes) {
      for (let k = 0; k < bytes.length; k++) z.mem[(addr + k) & 0xffff] = bytes[k] & 0xff;
    },

    setKeyBit(row, bit, down) {
      // trsjs numbers matrix keys row * 8 + bit; it keeps the $3800-$3BFF echo in z.mem.
      kbd.set_key_bit(z, row * 8 + bit, down ? 1 : 0);
    },

    alignRtc,

    syncFrom(machine) {
      const sys = machine.system;
      const cpu = sys.cpu;
      const o = machine.cpu.regs;
      const r = z.reg;
      x.setAF(z, (o.a << 8) | o.f);
      r.BC = (o.b << 8) | o.c; r.DE = (o.d << 8) | o.e; r.HL = (o.h << 8) | o.l;
      r.AFp = (o.a2 << 8) | o.f2; r.BCp = (o.b2 << 8) | o.c2; r.DEp = (o.d2 << 8) | o.e2; r.HLp = (o.h2 << 8) | o.l2;
      r.IX = o.ix; r.IY = o.iy; r.SP = o.sp; r.I = o.i; r.R = o.r & 0x7f; r.IM = o.im;
      // A halted CPU of ours sits at HALT+1; trsjs re-executes the HALT, so its PC stays on it.
      r.PC = cpu.halted ? (o.pc - 1) & 0xffff : o.pc;
      // Our EI takes effect after the next instruction (pendingEI); trsjs's at once.
      const ei = cpu.pendingEI > 0;
      r.IFF1 = o.iff1 || ei ? 1 : 0;
      r.IFF2 = o.iff2 || ei ? 1 : 0;
      // ROM, video RAM, and RAM; $3800-$3BFF is the keyboard, synced from the matrix below.
      ref.poke(0x0000, machine.mem.read(0x0000, 0x3800));
      ref.poke(0x3c00, machine.mem.read(0x3c00, 0x10000 - 0x3c00));
      const rows = sys.keyboard.rows;
      for (let row = 0; row < 8; row++) for (let bit = 0; bit < 8; bit++) ref.setKeyBit(row, bit, ((rows[row] >> bit) & 1) === 1);
      // The port latches trsjs models: the interrupt mask and status ($E0) and the mode register ($EC).
      z.port_latch[0xe0] = sys.io.intMask & 0xff;
      z.port_status[0xe0] = ~sys.io.intLatch & 0xff;
      z.port_latch[0xec] = sys.io.modeRegister & 0xff;
      alignRtc(sys.nextRtcAt - machine.cycles);
      total = machine.cycles;
      wlog.length = 0;
    },

    writes() {
      /** @type {Write[]} */
      const out = [];
      for (let k = 0; k < wlog.length; k += 2) out.push({ addr: wlog[k], value: wlog[k + 1] });
      return out;
    },

    get cycles() {
      return total;
    },

    z,
  };
  ref.reset();
  return ref;
}
