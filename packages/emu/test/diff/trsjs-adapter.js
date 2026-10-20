/**
 * The reference machine for emu phase 7's differential harness: trsjs (`trsemu-1.6.js`, Peter
 * Phillips's in-browser TRS-80 Model III emulator, https://trsjs.48k.ca/, converted from trs80gp's
 * C), driven one instruction at a time from Node.
 *
 * trsjs carries no license, so it is never committed: `pnpm trsjs:install` fetches it into the
 * gitignored `tools/trsjs/`, and this loader refuses any file whose SHA-256 is not the pinned one
 * before running a line of it. The script runs in a `node:vm` context with a few DOM stubs. Its
 * text is changed in memory only (the file on disk is never touched): one line before the IIFE's
 * final `return api;` exposes the internal functions the harness needs; three lines at the top of
 * `putbyte` (trsjs's only CPU write path) mask the value to a byte, log each write the CPU makes,
 * and drop one below $3C00 (ROM and keyboard), as the Model III does; the fetches through PC, and
 * the (IX+d) address, wrap at 16 bits, as the Z80's do; and a repeating CPDR takes its 21 T-states.
 *
 * The driver reproduces trsjs's own frame loop (`TRS80Field`) one instruction at a time: after
 * an instruction drives the per-frame down-counter `z.cycles` below 0, a frame (33,792 T-states)
 * has passed; on odd frames, with the beam interrupt enabled in port $E0's latch, trsjs raises it
 * and takes it in IM 1 when IFF1 is set (and drops it otherwise). That frame-end check runs at the
 * start of the next `step`, so an interrupt response counts with the instruction after it, as
 * `Machine.step` counts it. The comparator (compare.js) can hold that response back (`irq: 'hold'`)
 * or make the reference take a request it dropped earlier (`irq: 'force'`); known.js says when.
 *
 * Not modelled here: trsjs's NMI path (`x_stepz80`, `fdc_update`) is not run, so the reference never
 * takes an NMI; the harness compares programs that run without a disk.
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
/** trsjs's fetch through PC (fetch_opcode, fetch_n, fetch_nn, branch, ixy), which never wraps PC. */
const PC_FETCH = 'z.mem[z.reg.PC++]';
/** The repeat of trsjs's CPDR (oped_b9), which counts no T-states; CPIR's (oped_b1) has cy(z, 21) there. */
const CPDR_REPEAT = '		if ( z.reg.BC == 0 || z.reg.fZ ) { cy(z,  16 ) \n return \n } \n		z.reg.PC = z.reg.PC - 2 \n		 \n}\nfunction oped_ba(z)';
/** ixy's (IX+d)/(IY+d) address, which never wraps either. */
const IXY_ADDR = 'return signed_char(z.mem[z.reg.PC++ & 0xffff]) + z.reg.IQ';

/**
 * The shared interface (reference.js), re-exported for the callers that import it from here.
 * @typedef {import('./reference.js').Regs} Regs
 * @typedef {import('./reference.js').Machine} Machine
 * @typedef {import('./reference.js').Write} Write
 * @typedef {import('./reference.js').IrqMode} IrqMode
 * @typedef {import('./reference.js').RefStep} RefStep
 * @typedef {import('./reference.js').Reference} Reference
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
  if (!src.includes(RETURN_MARKER) || !src.includes(PUTBYTE_MARKER) || src.split(PC_FETCH).length !== 7) throw new Error(`${path}: an injection point is missing (the pinned file has them all)`);
  // The opcodes trsjs implements after DD or FD (its `opx` table); after any other byte its
  // `opx_default` does nothing and takes no T-states, so the prefixed instruction is dropped.
  const prefixedOps = new Set([...src.matchAll(/\bopx\[0x([0-9a-f]{2})\] = /g)].map((mm) => parseInt(mm[1], 16)));
  src = src.replace(RETURN_MARKER, RETURN_MARKER.replace('return api;',
    `api.__x = { ${EXPORTS.map((n) => `${n}: ${n}`).join(', ')}, cyclesPerFrame: function () { return cycles_per_frame; } };\n\treturn api;`));
  // A byte is 8 bits: trsjs's RLD and RRD hand putbyte a value shifted past bit 7 ((HL) << 4 |
  // A & 15, A << 4 | (HL) >> 4) and it stores all of it, so later reads of that byte return more
  // than 8 bits. The value is masked to the 8 bits the Z80 puts on the data bus (Zilog UM0080, RLD
  // and RRD: the low nibble of A and a nibble of (HL) are exchanged within the byte).
  // The log takes every write the CPU attempts; then a write below $3C00 is dropped. trsjs stores
  // from $3000 up, but on the Model III $0000-$37FF is ROM and $3800-$3BFF the keyboard, which
  // only reads (Model III Technical Reference Manual, the memory map and Address Decoding, p. 13):
  // a write there changes nothing, as in our MemorySystem.
  src = src.replace(PUTBYTE_MARKER, `${PUTBYTE_MARKER}   val &= 0xff;\n   if (z.wlog) z.wlog.push(addr, val);\n   if (addr < 0x3c00) return;\n`);
  // PC and the address it forms are 16 bits (Zilog UM0080: the program counter is a 16-bit
  // register): an instruction at $FFFF continues at $0000, and (IX+d) wraps likewise. trsjs lets PC
  // run on to $10000 (and a JR below $0000), reading undefined; each fetch through PC is masked, and
  // step() masks PC after the instruction.
  src = src.replaceAll(PC_FETCH, 'z.mem[z.reg.PC++ & 0xffff]');
  if (!src.includes(IXY_ADDR)) throw new Error(`${path}: an injection point is missing (ixy's address)`);
  // A CPDR that repeats takes 21 T-states (Zilog UM0080, CPDR), as trsjs's own CPIR does; its CPDR
  // counts none, which moves every later frame interrupt (found on Asylum 1g).
  if (src.split(CPDR_REPEAT).length !== 2) throw new Error(`${path}: an injection point is missing (CPDR's repeat)`);
  src = src.replace(CPDR_REPEAT, CPDR_REPEAT.replace('z.reg.PC = z.reg.PC - 2', 'cy(z, 21); z.reg.PC = z.reg.PC - 2'));
  src = src.replace(IXY_ADDR, `return (${IXY_ADDR.slice('return '.length)}) & 0xffff`);

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

  /**
   * The frame-end handling TRS80Field runs after the instruction that drove z.cycles below 0;
   * with `hold`, a raised request is not taken.
   * @param {boolean} hold
   */
  function frameEnd(hold) {
    if (z.cycles >= 0) return { used: 0, irq: false, raised: false };
    z.frame_cnt++;
    z.cycles += cpf;
    if (!x.BEAM_IRQ_ENABLED(z) || z.frame_cnt % 2 !== 1) return { used: 0, irq: false, raised: false };
    x.BEAM_IRQ_RAISE(z);
    if (hold) return { used: 0, irq: false, raised: true };
    const before = z.cycles;
    const irq = !!x.mode_1_IRQ(z);
    return { used: before - z.cycles, irq, raised: true };
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

    step({ irq = 'auto' } = {}) {
      wlog.length = 0;
      const fe = frameEnd(irq === 'hold');
      let used = fe.used;
      let taken = fe.irq;
      if (irq === 'force' && !taken) {
        const before = z.cycles;
        taken = !!x.mode_1_IRQ(z);
        used += before - z.cycles;
      }
      const before = z.cycles;
      x.stepz80(z);
      z.reg.PC &= 0xffff;
      const cycles = used + (before - z.cycles);
      total += cycles;
      return { cycles, irq: taken, raised: fe.raised };
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
      // trsjs is a Model III; its ports and memory map are the Model III's (emu spec §11, phase 7).
      if (machine.model !== 3) throw new Error(`trsjs is a Model III only; this machine is a Model ${machine.model}`);
      const sys = machine.system;
      const io = sys.io;
      ref.syncRegs(machine);
      // ROM, video RAM, and RAM; $3800-$3BFF is the keyboard, synced from the matrix below.
      ref.poke(0x0000, machine.mem.read(0x0000, 0x3800));
      ref.poke(0x3c00, machine.mem.read(0x3c00, 0x10000 - 0x3c00));
      const rows = sys.keyboard.rows;
      for (let row = 0; row < 8; row++) for (let bit = 0; bit < 8; bit++) ref.setKeyBit(row, bit, ((rows[row] >> bit) & 1) === 1);
      // The output latches trsjs models: the interrupt mask ($E0), the mode register ($EC), the
      // NMI mask ($E4, its top three bits, as out_fdnmi keeps them), and the cassette output ($FF).
      // syncRegs has set the inputs: port $E0's status and port $FF's input bits.
      z.port_latch[0xe0] = io.intMask & 0xff;
      z.port_latch[0xec] = io.modeRegister & 0xff;
      z.port_latch[0xe4] = io.nmiMask & 0xe0;
      z.port_latch[0xff] = io.cassetteOut & 0xff;
      wlog.length = 0;
    },

    redoDroppedPrefix(pc, r) {
      // Undo trsjs's skip of `DD/FD xx` (opx_default) and run it as the Z80 does (Young §3.2,
      // §3.7): the prefix is one M1 (4 T-states, R + 1); then, unless xx is another prefix or ED
      // (a lone prefix, which ends the instruction there), xx runs as an unprefixed instruction.
      const reg = z.reg;
      reg.PC = (pc + 1) & 0xffff;
      reg.R = (r + 1) & 0x7f;
      z.cycles -= 4;
      let cycles = 4;
      const next = z.mem[reg.PC];
      if (next !== 0xdd && next !== 0xfd && next !== 0xed) {
        const before = z.cycles;
        x.stepz80(z);
        reg.PC &= 0xffff;
        cycles += before - z.cycles;
      }
      total += cycles;
      return cycles;
    },

    syncRegs(machine) {
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
      alignRtc(sys.nextRtcAt - machine.cycles);
      total = machine.cycles;
      // The inputs the CPU reads that change without a CPU write: port $E0's interrupt status
      // (active low) and port $FF's input bits (bit 7 the pulse latch, bit 0 the tape level, read
      // without advancing our deck).
      const io = sys.io;
      z.port_status[0xe0] = ~io.intLatch & 0xff;
      z.port_status[0xff] = (io.cassette.pulseLatch ? 0x80 : 0) | (io.cassette.inputLevel ? 0x01 : 0);
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

    prefixedOps,

    z,
  };
  ref.reset();
  return ref;
}
