/**
 * The known differences between @fugloy/emu and its references (emu phase 7: trsjs for the Model
 * III; xtrs and MAME for the Model I, Ruling 6): each one a place where the reference is the
 * inaccurate side, with the evidence for that. Classes name the behaviour, not the reference, so
 * any reference may need one (EX (SP),rr's write order is xtrs's and trsjs's). compare.js counts a
 * difference one of these explains (and resyncs the reference from our state) instead of
 * reporting it; `--strict` stops on it.
 *
 * Each reference declares the classes it needs (`Reference.classes`: their ids, in
 * trsjs-adapter.js, xtrs-adapter.js and mame-trace.js), each found against that reference with its
 * evidence, and compare.js applies only those (Ruling 3: passed in, never branched on the
 * reference's name; declaredClasses below). So one reference's evidence never excuses another's
 * difference: the general flag 3 and 5 class, whose evidence (ZEXALL) is about trsjs's rules, is
 * trsjs's alone, and against MAME, which declares no step class, any flag 3 or 5 difference is a
 * divergence.
 *
 * Three kinds:
 *
 * - **Step classes** explain differences in one compared step. Each has a predicate over the step
 *   (the instruction our CPU executed, both machines' registers, T-states, and memory writes, and
 *   our memory) and names the exact fields it explains: single flag bits, one register, the
 *   writes. A step is known only when the classes that apply explain every field that differs;
 *   anything left over is a divergence.
 * - **Interrupt classes** are timing: trsjs drops a 30 Hz request it cannot take at once, where
 *   the Z80 keeps the line asserted (the Model III's request is a level, latched in port $E0 until
 *   read) and takes it at the first boundary it may. compare.js keeps such a request as *held*,
 *   with the reason the reference did not take it, and when our CPU takes it, makes the reference
 *   take it at the same boundary (`irq: 'force'`). Nothing is excused on that step: registers,
 *   T-states, and writes must then agree (up to the step classes), so the class can never hide
 *   another difference. It is counted on the step the request is taken. A reference that declares
 *   none (xtrs, which keeps its request in its latch as ours does; a MAME trace) is never held back
 *   or forced: it takes the request by its own rule, and taking it elsewhere is a divergence.
 * - **Reference fixes** make the reference run what the Z80 runs where trsjs skips it (a DD/FD
 *   the next instruction ignores), or, following a trace that cannot be rerun, make our read take
 *   the byte the trace's CPU read (MAME's video bit 6), then compare the step normally. Also
 *   counted, never excusing.
 *
 * Evidence:
 * - [ZEXALL] Frank Cringle's ZEXALL, which checks flag bits 3 and 5 for every instruction group;
 *   our core passes all 67 groups (`pnpm zex:install`, FUGLOY_ZEX=1; docs/fugloy-emu-spec.md §10).
 * - [Young] Sean Young, "The Undocumented Z80 Documented", version 0.91 (2005).
 * - [Zilog] Zilog, "Z80 CPU User Manual", UM008011-0816.
 * - [Handbook] Radio Shack, "TRS-80 Micro Computer Technical Reference Handbook", 2nd ed. (1982),
 *   the Model I's hardware (docs/reference/).
 * - [Banks] David Banks, Z80Decoder wiki, "Undocumented Flags" (github.com/hoglet67/Z80Decoder),
 *   with Peter Helcmanovsky's Z80 Block Flags Test run on real Z80s
 *   (github.com/redcode/Z80/wiki/Z80-Block-Flags-Test).
 * - The references' own source: xtrs at its pinned commit (tools/xtrs/src), MAME 0.289
 *   (github.com/mamedev/mame, tag mame0289: src/devices/cpu/z80/z80.lst, src/mame/trs/), trsjs
 *   1.6 (tools/trsjs/trsemu-1.6.js).
 *
 * Reference limitations that need no class (nothing in a run so far meets them; each would show
 * as an unexplained divergence, never be excused):
 * - xtrs's Model I resets on HALT (z80.c, `case 0x76`: "Z80 HALT output is tied to reset button
 *   circuit", trs_reset(0)); MAME's trs80l2 turns HALT into an NMI (trs80.cpp, `halt_cb()` to the
 *   "nmigate" input merger, "TODO: also causes SYSRES"); ours halts until an interrupt, as the
 *   Z80 does (Zilog UM0080, HALT). The Handbook (p. 15) has HALT* "should never be low" in normal
 *   running, so a program that halts is compared on our CPU's rule, and xtrs refuses to sync there.
 * - xtrs takes no interrupt in IM 0 or IM 2 (z80.c do_int: `error("interrupt in im0 not
 *   supported")`); MAME's recorder refuses one (mame-trace.js).
 * - xtrs takes a pending interrupt after a lone DD or FD (one before DD, FD or ED), which the Z80
 *   does not (Young §3.7, §5.5; our CPU holds it, as held-prefix below says): xtrs-fugloy.patch's
 *   z80_fugloy_interrupt passes over only EI. xtrs declares no interrupt class, so the comparator
 *   does not hold it back there.
 * - MAME's CPU clock is 10.6445 MHz / 6 = 1,774,083 Hz (trs80.cpp, the Handbook p. 14: "a little
 *   over 1.774 MHz"), ours and xtrs's 1,774,080 (`CLOCK_MHZ_1` 1.77408); MAME times its 40 Hz
 *   interrupt in emulated seconds (`set_periodic_int(..., attotime::from_hz(40))`), 44,352.08 of
 *   its T-states to our 44,352, and raises it with HOLD_LINE (trs80_m.cpp rtc_interrupt), which
 *   its acknowledge drops, where the Expansion Interface's line stays low until $37E0 is read
 *   (Kitsz p. 137; ours and xtrs); its read of $37E0 also clears the disk bit (irq_status_r:
 *   `m_irq = 0`). Following MAME, the drift is the divergence `irqTime` (Ruling 4), never excused;
 *   with interrupts on it shows within about fifteen ticks (model1-devices.test.js).
 */

/** Flag bit names, F's bit 7 to bit 0. */
const FLAG_BITS = ['S', 'Z', '5', 'H', '3', 'PV', 'N', 'C'];

/** The field token for flag bit `name` of F (`f`) or F' (`f2`). */
export const flagToken = (reg, name) => `${reg}.${name}`;

/**
 * @typedef {import('./reference.js').Write} Write
 * @typedef {{
 *   a: number, f: number, b: number, c: number, d: number, e: number, h: number, l: number,
 *   a2: number, f2: number, b2: number, c2: number, d2: number, e2: number, h2: number, l2: number,
 *   ix: number, iy: number, sp: number, pc: number, i: number, r: number,
 *   iff1: boolean, iff2: boolean, im: number,
 * }} Regs
 * @typedef {{ regs: Regs, cycles: number, irq: boolean, writes: Write[] }} Side
 * @typedef {{
 *   bytes: Uint8Array,
 *   execPc: number,
 *   peek(addr: number): number,
 *   ours: Side & { wasHalted: boolean, fBefore: number, q: number, wz: number },
 *   theirs: Side,
 * }} StepContext
 *   bytes: four bytes of our memory at execPc as our CPU began the instruction it executed this
 *   step (after an interrupt response, the handler's first; four zeros, a NOP, for a halted step).
 *   peek: a byte of our memory after the step, read without a read's side effects (the $37E0 latch
 *   is not cleared, a trace's keyboard bytes are not used up); the byte a repeating CPIR or CPDR
 *   compared is still at (HL) before it (blockN).
 *   ours.fBefore: our F before the step; ours.q: our CPU's Q for the instruction it executed (F's
 *   bits 5 and 3 an SCF or CCF keeps: 28H when the instruction before left the flags alone, else 0);
 *   ours.wz: our MEMPTR after the step (a BIT n,(HL) shows its high byte in flags 3 and 5 and leaves
 *   it; a BIT n,(IX+d) sets it to the address first).
 * @typedef {{ id: string, name: string, evidence: string, common?: boolean, explains(ctx: StepContext, diff: Set<string>): string[] | null }} StepClass
 *   common: the reference's everyday rule for flags 3 and 5, met within a few instructions in most
 *   programs: `strict: true` passes it by, `strict: 'all'` stops on it too (compare.js).
 * @typedef {{ id: string, name: string, reason: 'DI' | 'EI' | 'prefix', evidence: string }} InterruptClass
 */

const REG_NAMES = ['a', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'ix', 'iy', 'sp', 'pc', 'i', 'r', 'iff1', 'iff2', 'im'];

/**
 * Every field that differs between the two sides of a step: register names, one token per
 * differing flag bit of F and F' (`f.S`, `f2.C`, …), `cycles`, and `writes`.
 * @param {StepContext} ctx
 * @returns {Set<string>}
 */
export function diffStep(ctx) {
  const o = ctx.ours.regs;
  const s = ctx.theirs.regs;
  const out = new Set();
  for (const k of REG_NAMES) if (o[k] !== s[k]) out.add(k);
  for (const reg of /** @type {const} */ (['f', 'f2'])) {
    const d = o[reg] ^ s[reg];
    if (d !== 0) for (let b = 0; b < 8; b++) if (d & (0x80 >> b)) out.add(flagToken(reg, FLAG_BITS[b]));
  }
  if (ctx.ours.cycles !== ctx.theirs.cycles) out.add('cycles');
  if (!sameWrites(ctx.ours.writes, ctx.theirs.writes)) out.add('writes');
  return out;
}

/** @param {Write[]} a @param {Write[]} b */
export function sameWrites(a, b) {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k].addr !== b[k].addr || a[k].value !== b[k].value) return false;
  return true;
}

/** True when `bytes` is BIT n,r / BIT n,(HL) (CB 40-7F) or BIT n,(IX+d) / (IY+d) (DD/FD CB d 40-7F); the bit number, else -1. */
function bitNumber(bytes) {
  if (bytes[0] === 0xcb && (bytes[1] & 0xc0) === 0x40) return (bytes[1] >> 3) & 7;
  if ((bytes[0] === 0xdd || bytes[0] === 0xfd) && bytes[1] === 0xcb && (bytes[3] & 0xc0) === 0x40) return (bytes[3] >> 3) & 7;
  return -1;
}

const isIndexedCb = (/** @type {Uint8Array} */ bytes) => (bytes[0] === 0xdd || bytes[0] === 0xfd) && bytes[1] === 0xcb;

/** CPI, CPD, CPIR, CPDR (ED A1, A9, B1, B9). */
const isBlockCompare = (/** @type {Uint8Array} */ bytes) => bytes[0] === 0xed && (bytes[1] & 0xe7) === 0xa1;

/** LDIR, LDDR, CPIR, CPDR (ED B0, B8, B1, B9). */
const isBlockRepeat = (/** @type {Uint8Array} */ bytes) => bytes[0] === 0xed && (bytes[1] & 0xf6) === 0xb0;

/**
 * Our side of a repeating LDIR, LDDR, CPIR or CPDR step (block-xy-n and block-xy-keep below): our
 * instruction repeated (no interrupt response in the step, and our PC back on its ED) and our F
 * bits 3 and 5 are PC's bits 13 and 11.
 * @param {StepContext} ctx
 */
const blockOurs = (ctx) => isBlockRepeat(ctx.bytes) && !ctx.ours.irq && ctx.ours.regs.pc === ctx.execPc
  && (ctx.ours.regs.f & 0x28) === ((ctx.execPc >> 8) & 0x28);

/**
 * The reference's F bits 3 and 5 by the rule for an iteration that ends (Young §4.2), from its n:
 * Y (bit 5) is n's bit 1 and X (bit 3) its bit 3, where n is A plus the byte moved for LDIR and
 * LDDR, and A less the byte compared less H for CPIR and CPDR (H the compare's borrow from bit 4),
 * as our core's _xyBlock takes them for LDI and CPI; A is the reference's own. The byte moved is
 * the reference's own too, its step's last write. The byte compared is the one at (HL) before the
 * step, read from our memory (`peek`: HL after a CPIR iteration less one, after a CPDR one plus
 * one), which the reference's equals, since the comparator keeps the two memories equal. -1, which
 * no F's bits equal, for an LDIR or LDDR step of the reference that wrote nothing.
 * @param {StepContext} ctx a repeating block step (blockOurs)
 */
function blockN(ctx) {
  const a = ctx.theirs.regs.a;
  let n;
  if ((ctx.bytes[1] & 0x01) === 0) {
    const w = ctx.theirs.writes;
    if (w.length === 0) return -1;
    n = a + w[w.length - 1].value;
  } else {
    const { h, l } = ctx.ours.regs;
    // ED B1 counts HL up, B9 down.
    const v = ctx.peek((((h << 8) | l) + ((ctx.bytes[1] & 0x08) === 0 ? -1 : 1)) & 0xffff);
    n = a - v - ((a & 0x0f) < (v & 0x0f) ? 1 : 0);
  }
  n &= 0xff;
  return ((n & 0x02) << 4) | (n & 0x08);
}

/** IN A,(n) (DB), IN r,(C) (ED 40-78, x0), INI/IND/INIR/INDR and OUTI/OUTD/OTIR/OTDR (ED A2-BB, x2/x3). */
const isTimedIo = (/** @type {Uint8Array} */ bytes) => bytes[0] === 0xdb
  || (bytes[0] === 0xed && ((bytes[1] & 0xc7) === 0x40 || (bytes[1] & 0xe6) === 0xa2));

/** SCF (37) or CCF (3F), alone or after a DD or FD. */
const isScfCcf = (/** @type {Uint8Array} */ bytes) => bytes[0] === 0x37 || bytes[0] === 0x3f
  || ((bytes[0] === 0xdd || bytes[0] === 0xfd) && (bytes[1] === 0x37 || bytes[1] === 0x3f));

/**
 * Our F bits 3 and 5 after an SCF or CCF follow Q's rule: (F before & q) | A (scf-ccf-a below).
 * @param {StepContext} ctx
 */
const scfCcfOurs = (ctx) => (ctx.ours.regs.f & 0x28) === (((ctx.ours.fBefore & ctx.ours.q) | ctx.ours.regs.a) & 0x28);

/**
 * BIT n,(HL) (CB 46-7E, low bits 6) or BIT n,(IX+d) / BIT n,(IY+d) (DD/FD CB d 46-7E): the
 * documented forms on memory, not the DD/FD CB d forms whose low bits are not 6.
 */
const isBitMem = (/** @type {Uint8Array} */ bytes) => (bytes[0] === 0xcb && (bytes[1] & 0xc7) === 0x46)
  || ((bytes[0] === 0xdd || bytes[0] === 0xfd) && bytes[1] === 0xcb && (bytes[3] & 0xc7) === 0x46);

/** EX (SP),HL (E3) or EX (SP),IX / EX (SP),IY (DD/FD E3). */
const isExSp = (/** @type {Uint8Array} */ bytes) => bytes[0] === 0xe3 || ((bytes[0] === 0xdd || bytes[0] === 0xfd) && bytes[1] === 0xe3);

/** @type {StepClass[]} */
export const STEP_CLASSES = [
  {
    id: 'block-xy-n',
    name: 'repeating LDIR/LDDR/CPIR/CPDR: the reference takes flags 3 and 5 from n, not PC',
    // An iteration that repeats leaves Y = PC bit 13 and X = PC bit 11 (PC the ED's address): David
    // Banks, Z80Decoder wiki "Undocumented Flags", "LDxR / CPxR interrupted"; Peter Helcmanovsky's
    // Z80 Block Flags Test, run on real Z80s; MAME 0.289 z80.lst `macro ldir` (`m_f.yx_val = PC >> 8`
    // after `PC -= 2`), as our core does (z80cpu.js _xyRepeat). Young §4.2 (2005) gives the finished
    // iteration's rule, from its n, "at every iteration", and xtrs keeps it: tools/xtrs/src/z80.c's
    // do_ldir runs `do_ldi();` (line 1014) and then backs PC up, do_ldi taking them from `undoc =
    // REG_A + moved;` (line 989), and do_cpir runs `do_cpi();` (line 606), whose flags take `result -
    // H` (lines 537-543); do_lddr and do_cpdr run do_ldd and do_cpd the same way (the FASTMEM
    // versions, which move a whole block in one step, are not built: scripts/install-xtrs.sh).
    // Explained only when our instruction repeated (no interrupt response in the step, our PC back on
    // the ED), our F bits 3 and 5 are PC's bits 13 and 11, and the reference's are n's (blockN), each
    // side on its own rule; it takes these bits before the general class below.
    evidence: 'Banks, Z80Decoder wiki, "LDxR / CPxR interrupted": YF = PC.13, XF = PC.11; Helcmanovsky\'s Z80 Block Flags Test on real Z80s; MAME 0.289 z80.lst `ldir`. Young §4.2 (2005) gives the iteration\'s n at every iteration, as xtrs\'s z80.c does (do_ldir runs do_ldi, do_cpir do_cpi).',
    explains(ctx, diff) {
      if (!blockOurs(ctx) || (ctx.theirs.regs.f & 0x28) !== blockN(ctx)) return null;
      const t = ['f.5', 'f.3'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'block-xy-keep',
    name: 'repeating LDIR/LDDR/CPIR/CPDR: the reference leaves flags 3 and 5 as they were',
    // Ours as the class above has it (Banks's research, Helcmanovsky's test, MAME's z80.lst).
    // trsjs's oped_b0 and oped_b8 (trsemu-1.6.js) set H, N and P/V, and its oped_b1 and oped_b9 S, Z,
    // H, N, P/V and C through cp's sub; none sets its f5 or f3. Explained only when ours is PC's (as
    // above) and the reference's F bits 3 and 5 are F's before the step (both sides start a step
    // equal: compare.js resyncs the reference after any difference), each side on its own rule; it
    // takes these bits before the general class below.
    evidence: 'Banks, Z80Decoder wiki, "LDxR / CPxR interrupted": YF = PC.13, XF = PC.11; Helcmanovsky\'s Z80 Block Flags Test on real Z80s; MAME 0.289 z80.lst `ldir`. trsjs\'s oped_b0, oped_b8, oped_b1 and oped_b9 (trsemu-1.6.js) leave them.',
    explains(ctx, diff) {
      if (!blockOurs(ctx) || (ctx.theirs.regs.f & 0x28) !== (ctx.ours.fBefore & 0x28)) return null;
      const t = ['f.5', 'f.3'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'scf-ccf-a',
    name: 'SCF/CCF: the reference takes flags 3 and 5 from A alone',
    // Patrik Rak's 2012 finding, as David Banks's Z80Decoder wiki ("Undocumented Flags",
    // "SCF/CCF") gives it, checked there on the Zilog NMOS Z80 and its second sources: after an
    // instruction that modified the flags, X and Y are A's bits 3 and 5; after one that left them
    // alone (POP AF and EX AF,AF' among those, and a DD or FD before the SCF), F's own or-ed with
    // A's. MAME 0.289 keeps it (z80.lst `scf`, `ccf`: `m_f.yx_val = (m_f.yx_val & Q) | A`), as our
    // core does (z80cpu.js, `q`); found as 44 SCF steps of Pirate's Adventure against MAME. xtrs
    // takes A's alone whatever came before (z80.c `case 0x37: /* scf */` and `case 0x3F: /* ccf */`:
    // `REG_A & (UNDOC3_MASK|UNDOC5_MASK)`), the rule Banks gives for NEC's NMOS part. The Model I's
    // parts list names only a "Z80 Microprocessor Circuit" (Z40; Technical Reference Handbook,
    // 1982), so a given machine follows its CPU's maker; ours and MAME's follow Zilog's. ZEXALL
    // cannot tell: its <daa,cpl,scf,ccf> group never sets F's bits 3 and 5 before the instruction
    // (base F 04H, varied under D7H). Explained only for SCF or CCF when our F bits 3 and 5 are
    // (F before & our q) | A and the reference's are its A's, each side on its own rule.
    evidence: 'Rak (2012) via Banks, Z80Decoder wiki, "SCF/CCF": X/Y from A after an instruction that set the flags, else F | A, on the Zilog NMOS Z80 (A alone on NEC\'s); MAME 0.289 z80.lst `scf`; xtrs z80.c takes A alone. ZEXALL never sets F\'s bits 3 and 5 before SCF.',
    explains(ctx, diff) {
      if (!isScfCcf(ctx.bytes) || !scfCcfOurs(ctx)) return null;
      if ((ctx.theirs.regs.f & 0x28) !== (ctx.theirs.regs.a & 0x28)) return null;
      const t = ['f.5', 'f.3'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'scf-ccf-keep',
    name: 'SCF/CCF: the reference leaves flags 3 and 5 as they were',
    // Ours as the class above has it (Rak's finding, Banks's Zilog rule, MAME's Q). trsjs's op_37
    // and op_3f (trsemu-1.6.js) set C, H and N and leave its f5 and f3 alone. Explained only for SCF
    // or CCF when our F bits 3 and 5 are (F before & our q) | A and the reference's are F's before
    // the step (both sides start a step equal: compare.js resyncs the reference after any
    // difference), each side on its own rule; it takes these bits before the general class below.
    evidence: 'Rak (2012) via Banks, Z80Decoder wiki, "SCF/CCF": X/Y from A after an instruction that set the flags, else F | A, on the Zilog NMOS Z80; MAME 0.289 z80.lst `scf`; trsjs\'s op_37 and op_3f (trsemu-1.6.js) leave them.',
    explains(ctx, diff) {
      if (!isScfCcf(ctx.bytes) || !scfCcfOurs(ctx)) return null;
      if ((ctx.theirs.regs.f & 0x28) !== (ctx.ours.fBefore & 0x28)) return null;
      const t = ['f.5', 'f.3'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'bit-mem-xy',
    name: 'BIT n,(HL) and BIT n,(IX+d): the reference clears flags 3 and 5',
    common: true,
    // A BIT on memory shows MEMPTR's high byte in flags 3 and 5: BIT n,(HL) the latch as the
    // instructions before left it, BIT n,(IX+d) and BIT n,(IY+d) the address, which they put there
    // (boo_boo and Vladimir Kladov, "MEMPTR, esoteric register of the ZiLOG Z80 CPU", the rules
    // emu spec §4 names; Patrik Rak's z80test, checked against a Zilog Z80, says BIT N,(HL) and BIT
    // N,(IX+d) "depend on an internal register known as MEMPTR"). MAME 0.289 does the same (z80.cpp
    // `bit_hl`: `m_f.yx_val = WZ_H`; `bit_xy`: `m_ea >> 8`), as our core does (z80cpu.js bitMem),
    // and against MAME no BIT step differs in any of the thirteen Model I sessions. xtrs clears both
    // for the memory forms: its do_test_bit as built (z80.c, the `#if 1` one) ends `(((op & 7) ==
    // 6) ? 0 : (value & (UNDOC3_MASK | UNDOC5_MASK)))`, and its comment grants that by
    // z80undoc.txt (Young's) it "gets UNDOC3 and UNDOC5 wrong". ZEXALL passes on both, so cannot
    // tell. Explained only for BIT n,(HL) or BIT n,(IX+d)/(IY+d) (CB 46-7E, DD/FD CB d 46-7E) when
    // our F bits 3 and 5 are our MEMPTR's high byte's and the reference's are both clear: not the
    // DD/FD CB d forms whose low bits are not 6, which xtrs takes from the byte tested. Met within a
    // few instructions in most programs, as trsjs's general class is (`common`).
    evidence: 'MEMPTR (boo_boo and Kladov): BIT n,(HL) shows its high byte, BIT n,(IX+d) the address\'s; Rak\'s z80test (a Zilog Z80); MAME 0.289 z80.cpp bit_hl (WZ_H) and bit_xy (m_ea >> 8). xtrs z80.c do_test_bit (the `#if 1` branch) clears them for (op & 7) == 6.',
    explains(ctx, diff) {
      if (!isBitMem(ctx.bytes)) return null;
      if ((ctx.ours.regs.f & 0x28) !== ((ctx.ours.wz >> 8) & 0x28) || (ctx.theirs.regs.f & 0x28) !== 0) return null;
      const t = ['f.5', 'f.3'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'ex-sp-order',
    name: 'EX (SP),rr: the reference writes (SP) before (SP+1)',
    // The Z80 writes (SP+1) <- H, then (SP) <- L (EX (SP),HL's (4, 3, 4, 3, 5) T-states, Zilog
    // UM0080 p. 127; MAME 0.289 z80.lst `macro ex_sp`, `@wm16_sp`; floooh/chips z80.h, cycle-stepped,
    // commit 9e88298), as our core does. xtrs writes the word low byte first (z80.c `case 0xE3: /* ex
    // (sp), hl */` and the DD/FD forms call mem_write_word, trs_memory.c: `mem_write(address++, value
    // & 0xff); mem_write(address, value >> 8);`), and so does trsjs (trsemu-1.6.js ex_memsp ->
    // store16: putbyte(mem, low) then putbyte(mem + 1, high)). Same bytes, same addresses. Explained
    // only when the step's last two writes are ours (SP+1, SP) and the reference's the same two
    // swapped, every write before them equal.
    evidence: 'The Z80 writes (SP+1) before (SP): Zilog UM0080 p. 127 (4, 3, 4, 3, 5); MAME 0.289 z80.lst ex_sp; floooh/chips z80.h. xtrs (trs_memory.c mem_write_word) and trsjs (store16) write the low byte first.',
    explains(ctx, diff) {
      if (!diff.has('writes') || !isExSp(ctx.bytes)) return null;
      const a = ctx.ours.writes;
      const b = ctx.theirs.writes;
      const n = a.length;
      if (n < 2 || b.length !== n || !sameWrites(a.slice(0, n - 2), b.slice(0, n - 2))) return null;
      const [h, l] = a.slice(n - 2);
      if (h.addr !== ((l.addr + 1) & 0xffff)) return null;
      return sameWrites([l, h], b.slice(n - 2)) ? ['writes'] : null;
    },
  },
  {
    id: 'io-cycles',
    name: 'IN and block I/O: the reference counts one T-state less',
    // Zilog UM0080: IN A,(n) 11 T-states (4, 3, 4), p. 295; IN r,(C) 12 (4, 4, 4), p. 296; INI,
    // IND, OUTI, OUTD 16 (4, 5, 3, 4), and INIR/INDR/OTIR/OTDR 21 while they repeat; our core and
    // @fugloy/z80's tables say the same. xtrs counts one less: z80.c `case 0xDB: /* in a, (port) */
    // ... T_COUNT(10);`, `case 0x78: /* in a, (c) */ ... T_COUNT(11);` (and the other IN r,(C)),
    // do_ini/do_ind/do_outi/do_outd `T_COUNT(15)`, their repeats `+ 5`. (OUT (n),A at 11 and OUT
    // (C),r at 12 it counts right.) Explained only for those instructions, with no interrupt
    // response in the step on either side, ours exactly one T-state more.
    evidence: 'Zilog UM0080: IN A,(n) 11 T-states, IN r,(C) 12, INI/IND/OUTI/OUTD 16 (21 while repeating). xtrs z80.c counts 10, 11 and 15 (T_COUNT).',
    explains(ctx, diff) {
      if (!diff.has('cycles') || !isTimedIo(ctx.bytes) || ctx.ours.irq || ctx.theirs.irq) return null;
      return ctx.ours.cycles - ctx.theirs.cycles === 1 ? ['cycles'] : null;
    },
  },
  {
    id: 'xy',
    name: 'flags 3 and 5 (X/Y)',
    common: true,
    // trsjs keeps the undocumented flag bits 3 and 5 by its own rules, across the instruction set;
    // our core passes every ZEXALL group, and ZEXALL (unlike ZEXDOC) checks those two bits for
    // every instruction group [ZEXALL]. Young §2.3 and §4 describe the rules our core follows.
    // Ruling 5 compares them bit by bit and this class counts them, so a run shows how often they
    // differ. It explains any flag 3 or 5 difference on any instruction, so only trsjs, the
    // reference its evidence is about, declares it; the Model I's references declare the exact
    // instructions they differ on (the classes above), and a repeating block instruction's and
    // SCF's and CCF's, which ZEXALL does not see, are the classes above's for trsjs too.
    evidence: 'ZEXALL checks flag bits 3 and 5 for every instruction group and our core passes all 67 groups; the rules are Young §2.3 and §4.',
    explains(ctx, diff) {
      const t = ['f.5', 'f.3', 'f2.5', 'f2.3'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'bit',
    name: 'BIT: S and P/V',
    // Young §4.1: BIT n sets S only when n = 7 and the bit is set, Z when the bit is reset, and P/V
    // as Z. trsjs sets S and P/V otherwise. Explained only when our F obeys the rule.
    evidence: 'Young §4.1: S is set only when n = 7 and the tested bit is set; P/V is set just as Z is. ZEXALL\'s "bit n,..." groups pass on our core.',
    explains(ctx, diff) {
      const n = bitNumber(ctx.bytes);
      if (n < 0) return null;
      const f = ctx.ours.regs.f;
      const z = (f & 0x40) !== 0;
      if (((f & 0x80) !== 0) !== (n === 7 && !z) || ((f & 0x04) !== 0) !== z) return null;
      const t = ['f.S', 'f.PV'].filter((k) => diff.has(k));
      return t.length > 0 ? t : null;
    },
  },
  {
    id: 'irq-r',
    name: 'interrupt response: R not counted',
    // Young §5 and §6.1: accepting an interrupt increases R by one (the acknowledge is an M1
    // cycle). trsjs's mode_1_IRQ leaves R alone. Exactly one step of R, with no DDCB/FDCB in the step.
    evidence: 'Young §5 and §6.1: accepting a maskable or non-maskable interrupt increases R by one; trsjs\'s mode_1_IRQ does not.',
    explains(ctx, diff) {
      if (!diff.has('r') || !ctx.ours.irq || !ctx.theirs.irq || isIndexedCb(ctx.bytes)) return null;
      return ((ctx.ours.regs.r - ctx.theirs.regs.r) & 0x7f) === 1 ? ['r'] : null;
    },
  },
  {
    id: 'ddcb-r',
    name: 'DDCB/FDCB: R counted three times',
    // Young §6.1: DDCBxxxx and FDCBxxxx increase R by two. trsjs fetches the last opcode byte with
    // its M1 helper, a third step. Exactly one step of R more on the reference.
    evidence: 'Young §6.1: "Instructions with an ED, CB, DD, FD prefix, increase R by two, and so do the DDCBxxxx and FDCBxxxx instructions"; trsjs counts three.',
    explains(ctx, diff) {
      if (!diff.has('r') || !isIndexedCb(ctx.bytes) || (ctx.ours.irq && ctx.theirs.irq)) return null;
      return ((ctx.theirs.regs.r - ctx.ours.regs.r) & 0x7f) === 1 ? ['r'] : null;
    },
  },
  {
    id: 'cpi-c',
    name: 'CPI/CPD/CPIR/CPDR: trsjs sets C on a mismatch',
    // Zilog UM0080 (CPI, CPIR, CPD, CPDR): C is not affected; ZEXALL's "cpd<r>" and "cpi<r>"
    // groups check it and pass on our core. trsjs's oped_a1/a9/b1/b9 save C in z.reg.tmp, but cp()
    // uses z.reg.tmp for the subtraction, so assign_c stores A - (HL): C ends set exactly when the
    // compare found no match (Z = 0). Explained only when our C is the C we had before the step and
    // the reference's C is the opposite of its Z.
    evidence: 'Zilog UM0080 (CPI, CPIR, CPD, CPDR): C is not affected; ZEXALL\'s cpd<r> and cpi<r> groups pass on our core. trsjs stores A - (HL) in C, the scratch it saved C in being reused by cp().',
    explains(ctx, diff) {
      if (!diff.has('f.C') || !isBlockCompare(ctx.bytes)) return null;
      if (((ctx.ours.regs.f ^ ctx.ours.fBefore) & 0x01) !== 0) return null;
      const f = ctx.theirs.regs.f;
      return ((f & 0x01) !== 0) === ((f & 0x40) === 0) ? ['f.C'] : null;
    },
  },
  {
    id: 'halt-push',
    name: 'HALT: trsjs pushes the HALT\'s own address',
    // Young §5.4: "The PC is increased before the interrupt routine is called", so an interrupt
    // that ends a HALT pushes HALT+1 and RETI continues after it. trsjs runs HALT as PC-- and pushes
    // the HALT's address, so its return would halt again. Zilog's "HALT Exit" (UM0080 p. 15) says
    // the CPU executes NOPs and leaves the state for the interrupt acknowledge, and is silent on the
    // address. Explained when our CPU was halted, both took the interrupt, and the pushed return
    // address is the only write that differs, by exactly one.
    evidence: 'Young §5.4: the PC is increased before the interrupt routine is called, so the return address is HALT+1; Zilog UM0080 "HALT Exit" (p. 15) does not contradict it.',
    explains(ctx, diff) {
      if (!diff.has('writes') || !ctx.ours.wasHalted || !ctx.ours.irq || !ctx.theirs.irq) return null;
      const a = ctx.ours.writes;
      const b = ctx.theirs.writes;
      if (a.length < 2 || a.length !== b.length || a[0].addr !== b[0].addr || a[1].addr !== b[1].addr) return null;
      if (!sameWrites(a.slice(2), b.slice(2))) return null;
      const ours = (a[0].value << 8) | a[1].value;
      const theirs = (b[0].value << 8) | b[1].value;
      return ours === ((theirs + 1) & 0xffff) ? ['writes'] : null;
    },
  },
];

/** @type {InterruptClass[]} */
export const INTERRUPT_CLASSES = [
  {
    id: 'held-di',
    name: 'interrupt held while DI: trsjs drops it',
    reason: 'DI',
    // Zilog UM0080 p. 7 (INT pin): INT is honoured "at the end of the current instruction if the ... IFF is
    // enabled"; the Model III's 30 Hz request is latched in port $E0 until IN from $EC clears it,
    // so the line stays low while interrupts are disabled and the CPU takes it after the next EI.
    // trsjs's mode_1_IRQ returns at once when IFF1 is 0 and never retries. Recorded only when the
    // reference raised the request at a frame end with IFF1 = 0 (it did not take it) and our latch
    // still holds the request when our CPU takes it.
    evidence: 'Zilog UM0080 p. 7 (INT pin): a request is honoured at the end of an instruction once IFF is enabled; the Model III latches the 30 Hz request in port $E0 until it is read, so it is taken after EI. trsjs drops it when IFF1 is 0.',
  },
  {
    id: 'held-ei',
    name: 'interrupt after EI waits one instruction',
    reason: 'EI',
    // Zilog UM0080 p. 19 (Interrupt Enable/Disable) and EI (p. 183): "any pending interrupt request is not accepted until
    // after the instruction following EI is executed"; Young §5.5 tests it. trsjs sets IFF1 in EI
    // and takes a frame-end request right after it. Recorded only at the boundary right after an
    // executed EI (compare.js derives it from the instruction stream, not from our CPU's state), and
    // our CPU must then take the request at the next boundary, else a divergence (field irq).
    evidence: 'Zilog UM0080 p. 19 and EI (p. 183): during EI and the following instruction maskable interrupts are disabled; Young §5.5.',
  },
  {
    id: 'held-prefix',
    name: 'interrupt after a lone DD/FD waits one instruction',
    reason: 'prefix',
    // Young §5.5 and §3.7: interrupts are accepted only between instructions, and a prefixed
    // instruction is one instruction; a DD or FD before another prefix is not one on its own, so
    // our CPU takes no interrupt after it (spec §10, "Lone prefixes"). trsjs never stops between a
    // prefix and the next byte. Recorded only at the boundary right after an executed DD or FD
    // whose next byte is DD, FD, or ED (derived from the instruction stream, not from our CPU's
    // afterPrefix), and our CPU must then take the request at the next boundary, else a divergence
    // (field irq).
    evidence: 'Young §5.5: interrupts are never accepted during an instruction, prefixed ones included; a DD/FD before another prefix sets a flag rather than being an instruction (Young §3.7).',
  },
];

/**
 * Reference fixes: a step where trsjs did not run what the Z80 runs, so compare.js makes it run
 * that and then compares the step normally. Nothing is excused; the fix is counted.
 * @type {{ id: string, name: string, evidence: string }[]}
 */
export const REFERENCE_FIXES = [
  {
    id: 'dropped-prefix',
    name: 'DD/FD the instruction ignores: trsjs drops the instruction',
    // Young §3.2 and §3.7: DD or FD only changes HL, H, L, and (HL) in the instruction after it;
    // any other instruction runs as usual, the prefix costing one M1 (4 T-states, R + 1), and a DD
    // or FD before another prefix or ED is a 4-T-state no-op itself (a lone prefix). trsjs's opx
    // table has no entry for those bytes: opx_default does nothing in no T-states, so both bytes
    // are skipped and the instruction never runs. When the reference did exactly that (PC + 2,
    // R + 2, no T-states, no writes, every other register unchanged), compare.js has it redo the
    // step as the Z80 does (Reference.redoDroppedPrefix) and compares our step against that.
    evidence: 'Young §3.2 and §3.7: a DD or FD before an instruction that does not use HL, H, L or (HL) costs one M1 and leaves the instruction to run as usual (any other byte resets the prefix); trsjs\'s opx_default skips both bytes in 0 T-states.',
  },
  {
    id: 'video-read-gate',
    name: 'video read: the reference returns bit 6 as written (no gate)',
    // The Model I without the lowercase modification has seven video RAMs; the CPU reads bit 6
    // from NOR gate Z30: "If Bit 5 (Z62, pin 12) and Bit 7 (Z63, pin 12) are low, then Bit 6 will
    // be high" (TRS-80 Micro Computer Technical Reference Handbook, 2nd ed., 1982, p. 34, "Video
    // RAMs"). Our memory and xtrs (trs_memory.c, mem_write: `if (!trs_lowercase) { if (value &
    // 0xa0) value &= 0xbf; else value |= 0x40; }`) store the byte through the gate. MAME 0.289's
    // trs80l2 maps $3C00-$3FFF as plain RAM (trs80.cpp, `map(0x3c00, 0x3fff).ram().share(...)`),
    // so its CPU reads bit 6 as written. Following a trace (it cannot be rerun), a read of video
    // RAM whose trace byte equals ours but for the gate returns the trace's byte, so both CPUs go
    // on from what the trace's read; the step is then compared as usual (nothing is excused) and
    // counted here. Any other difference in the byte is not touched.
    evidence: 'TRS-80 Technical Reference Handbook (1982) p. 34: bit 6 of a video read is NOR(bit 5, bit 7) from Z30. xtrs applies it (trs_memory.c mem_write); MAME 0.289\'s trs80l2 maps video RAM as plain RAM (trs80.cpp).',
  },
];

/**
 * True when the reference skipped `DD/FD xx` as opx_default does: `xx` (the byte after the prefix)
 * not in its opx table, and the step left PC + 2, R + 2, no T-states, no writes, and every other
 * register as it was.
 * @param {number} xx
 * @param {Regs} before the reference's registers before the step
 * @param {Regs} after its registers after it
 * @param {{ cycles: number, irq: boolean }} step
 * @param {number} writes how many writes it made
 * @param {ReadonlySet<number>} prefixedOps
 */
export function droppedPrefix(xx, before, after, step, writes, prefixedOps) {
  if (prefixedOps.has(xx) || step.irq || step.cycles !== 0 || writes !== 0) return false;
  if (after.pc !== ((before.pc + 2) & 0xffff) || after.r !== ((before.r + 2) & 0x7f)) return false;
  for (const k of /** @type {(keyof Regs)[]} */ (['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'ix', 'iy', 'sp', 'i', 'iff1', 'iff2', 'im'])) {
    if (after[k] !== before[k]) return false;
  }
  return true;
}

/** Every class's display name: step classes, interrupt classes, reference fixes. */
export const CLASS_NAMES = [...STEP_CLASSES, ...INTERRUPT_CLASSES, ...REFERENCE_FIXES].map((c) => c.name);

/** The names of the `common` step classes, which `strict: true` passes by. */
export const COMMON_CLASSES = new Set(STEP_CLASSES.filter((c) => c.common === true).map((c) => c.name));

/**
 * The known classes a reference declares (`Reference.classes`, ids from the tables above),
 * resolved for compareRun: its step classes in this file's order, the reasons it may have a
 * request held for (its interrupt classes), and its reference fixes. A reference must declare
 * (an empty set is a declaration: it needs none), and an id this file does not have is refused,
 * so a declaration that is missing or misspelt fails instead of explaining nothing or too much.
 * @param {ReadonlySet<string> | undefined} ids
 * @param {string} who the reference's name, for the sentence
 * @returns {{ step: StepClass[], holds: Set<'DI' | 'EI' | 'prefix'>, fixes: Set<string> }}
 */
export function declaredClasses(ids, who) {
  if (ids === undefined) throw new Error(`${who} declares no known classes (Reference.classes): a reference names the ones it needs (known.js), each with its evidence, or an empty set`);
  const all = [...STEP_CLASSES, ...INTERRUPT_CLASSES, ...REFERENCE_FIXES];
  for (const id of ids) if (!all.some((c) => c.id === id)) throw new Error(`${who} declares the known class ${id}, which known.js does not have`);
  return {
    step: STEP_CLASSES.filter((c) => ids.has(c.id)),
    holds: new Set(INTERRUPT_CLASSES.filter((c) => ids.has(c.id)).map((c) => c.reason)),
    fixes: new Set(REFERENCE_FIXES.filter((c) => ids.has(c.id)).map((c) => c.id)),
  };
}

/**
 * Explain a step's differences with the step classes the reference declares.
 * @param {StepContext} ctx
 * @param {Set<string>} diff from diffStep
 * @param {readonly StepClass[]} stepClasses the reference's (declaredClasses), in this file's order
 * @returns {{ classes: string[], unexplained: string[] }} the names of the classes that explained something, and the fields none did
 */
export function explainStep(ctx, diff, stepClasses) {
  const left = new Set(diff);
  /** @type {string[]} */
  const classes = [];
  for (const c of stepClasses) {
    // Each class sees what the ones before it left, so a field is counted under one class only.
    if (left.size === 0) break;
    const t = c.explains(ctx, left);
    if (t === null) continue;
    classes.push(c.name);
    for (const k of t) left.delete(k);
  }
  return { classes, unexplained: [...left] };
}

/** The interrupt class for a held request's reason. @param {'DI' | 'EI' | 'prefix'} reason */
export function interruptClass(reason) {
  const c = INTERRUPT_CLASSES.find((k) => k.reason === reason);
  if (c === undefined) throw new Error(`no interrupt class for ${reason}`);
  return c;
}
