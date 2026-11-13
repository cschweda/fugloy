/**
 * The helpers a port's generated statements call (`z.a = o.add8(z, z.a, z.b);`): the Z80's flag and
 * arithmetic routines, which a port imports as `@fugloy/runtime/ops`, and at the end the control a
 * port's routines share (CALL's trampoline, RET's check, a CALL to a ROM routine the runtime stands in
 * for, the sentences for what a port cannot follow).
 * @fugloy/recomp's `translate` writes the calls; its test runs every instruction both ways, here and on
 * @fugloy/emu's core, and requires the two equal.
 *
 * Each helper does what emu's core does (packages/emu/src/cpu/z80cpu.js, cited by line), and where emu
 * differs from a textbook Z80, emu wins: the port must match the machine it is refereed against. A
 * helper that changes the flags sets every bit of F emu's version sets, bits 3 and 5 included, and
 * leaves the rest of F alone. Values in are 8- or 16-bit as the registers hold them; values out are
 * masked to their width.
 */

import { standins } from './rom.js';

// F's bits (z80cpu.js:17-22; bits 5 and 3 are the undocumented Y and X, `_xy`, :171-174)
const S = 0x80;
const Z = 0x40;
const H = 0x10;
const P = 0x04;
const N = 0x02;
const C = 0x01;
const XY = 0x28;

/** S, Z and bits 5 and 3 of an 8-bit result, the way most instructions set them. */
const SZXY = Uint8Array.from({ length: 256 }, (_, v) => (v & (S | XY)) | (v === 0 ? Z : 0));
/** P/V as parity: set when the byte has an even number of ones (emu's parity, :2234-2240). */
const PARITY = Uint8Array.from({ length: 256 }, (_, v) => {
  let ones = 0;
  for (let b = v; b !== 0; b >>= 1) ones += b & 1;
  return ones & 1 ? 0 : P;
});

/** @typedef {import('./z.js').Z} Machine */

// ---- 8-bit arithmetic and logic (addA :2074, subA :2099, sbcA :2167, andA :2189, orA :2204, xorA :2219)

/**
 * ADD: `a + v`, and the flags.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function add8(z, a, v) {
  const sum = a + v;
  const r = sum & 0xff;
  z.f = SZXY[r] | ((a & 0xf) + (v & 0xf) > 0xf ? H : 0) | (~(a ^ v) & (a ^ r) & 0x80 ? P : 0) | (sum > 0xff ? C : 0);
  return r;
}

/**
 * ADC: `a + v + carry`, and the flags (addA with its carry, :2074-2094).
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function adc8(z, a, v) {
  const c = z.f & C;
  const sum = a + v + c;
  const r = sum & 0xff;
  z.f = SZXY[r] | ((a & 0xf) + (v & 0xf) + c > 0xf ? H : 0) | (~(a ^ v) & (a ^ r) & 0x80 ? P : 0) | (sum > 0xff ? C : 0);
  return r;
}

/**
 * SUB: `a - v`, and the flags.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function sub8(z, a, v) {
  const diff = a - v;
  const r = diff & 0xff;
  z.f = SZXY[r] | ((a & 0xf) < (v & 0xf) ? H : 0) | ((a ^ v) & (a ^ r) & 0x80 ? P : 0) | N | (diff < 0 ? C : 0);
  return r;
}

/**
 * SBC: `a - v - carry`, and the flags.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function sbc8(z, a, v) {
  const c = z.f & C;
  const diff = a - v - c;
  const r = diff & 0xff;
  z.f = SZXY[r] | ((a & 0xf) - (v & 0xf) - c < 0 ? H : 0) | ((a ^ v) & (a ^ r) & 0x80 ? P : 0) | N | (diff < 0 ? C : 0);
  return r;
}

/**
 * CP: the flags of `a - v`, whose bits 5 and 3 come from the operand `v`, not the result (:2115-2116).
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 */
export function cp8(z, a, v) {
  const diff = a - v;
  const r = diff & 0xff;
  z.f = (r & S) | (r === 0 ? Z : 0) | (v & XY) | ((a & 0xf) < (v & 0xf) ? H : 0) | ((a ^ v) & (a ^ r) & 0x80 ? P : 0) | N | (diff < 0 ? C : 0);
}

/**
 * AND: `a & v`; H set, C clear.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function and8(z, a, v) {
  const r = a & v;
  z.f = SZXY[r] | H | PARITY[r];
  return r;
}

/**
 * XOR: `a ^ v`; H and C clear.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function xor8(z, a, v) {
  const r = (a ^ v) & 0xff;
  z.f = SZXY[r] | PARITY[r];
  return r;
}

/**
 * OR: `a | v`; H and C clear.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function or8(z, a, v) {
  const r = (a | v) & 0xff;
  z.f = SZXY[r] | PARITY[r];
  return r;
}

/**
 * INC of a byte; C is kept (incReg :2124-2137, INC (HL) :982-993).
 * @param {Machine} z
 * @param {number} v
 * @returns {number}
 */
export function inc8(z, v) {
  const r = (v + 1) & 0xff;
  z.f = (z.f & C) | SZXY[r] | ((v & 0xf) === 0xf ? H : 0) | (v === 0x7f ? P : 0);
  return r;
}

/**
 * DEC of a byte; C is kept (decReg :2142-2155, DEC (HL) :996-1007).
 * @param {Machine} z
 * @param {number} v
 * @returns {number}
 */
export function dec8(z, v) {
  const r = (v - 1) & 0xff;
  z.f = (z.f & C) | SZXY[r] | ((v & 0xf) === 0 ? H : 0) | (v === 0x80 ? P : 0) | N;
  return r;
}

/**
 * NEG: `0 - a` (neg :3145-3159).
 * @param {Machine} z
 * @param {number} a
 * @returns {number}
 */
export function neg(z, a) {
  const r = (0 - a) & 0xff;
  z.f = SZXY[r] | (a & 0xf ? H : 0) | (a === 0x80 ? P : 0) | N | (a !== 0 ? C : 0);
  return r;
}

// ---- the accumulator's own instructions (DAA :1466, CPL :1457, SCF :1438, CCF :1447, rotates :1498-1541)

/**
 * DAA, emu's canonical correction: H after a subtraction only when the low nibble borrows (:1466-1495).
 * @param {Machine} z
 */
export function daa(z) {
  const a = z.a;
  const f = z.f;
  let correction = 0;
  let carry = f & C;
  if (f & H || (a & 0x0f) > 9) correction = 0x06;
  if (carry || a > 0x99) {
    correction |= 0x60;
    carry = C;
  }
  const r = (f & N ? a - correction : a + correction) & 0xff;
  const h = f & N ? f & H && (a & 0x0f) < 0x06 : (a & 0x0f) + (correction & 0x0f) > 0x0f;
  z.a = r;
  z.f = SZXY[r] | (h ? H : 0) | PARITY[r] | (f & N) | carry;
}

/**
 * CPL: A = NOT A; H and N set, bits 5 and 3 from the result.
 * @param {Machine} z
 */
export function cpl(z) {
  z.a = ~z.a & 0xff;
  z.f = (z.f & (S | Z | P | C)) | H | N | (z.a & XY);
}

/**
 * SCF. Bits 5 and 3 are A's, or-ed with F's own that `keep` lets through: emu's Q (:1438-1444, with
 * executeInstruction :277). `keep` is 0x28 when the instruction before left the flags alone and 0 when
 * it wrote them; the translator decides which, or reads it from `z.q` at a block's start.
 * @param {Machine} z
 * @param {number} keep
 */
export function scf(z, keep) {
  z.f = (z.f & (S | Z | P)) | C | (((z.f & keep) | z.a) & XY);
}

/**
 * CCF: C complemented, H the old C; bits 5 and 3 as SCF's (:1447-1454).
 * @param {Machine} z
 * @param {number} keep
 */
export function ccf(z, keep) {
  const c = z.f & C;
  z.f = (z.f & (S | Z | P)) | (c ? H : C) | (((z.f & keep) | z.a) & XY);
}

/** @param {Machine} z */
export function rlca(z) {
  const a = z.a;
  z.a = ((a << 1) | (a >> 7)) & 0xff;
  z.f = (z.f & (S | Z | P)) | (a >> 7) | (z.a & XY);
}

/** @param {Machine} z */
export function rrca(z) {
  const a = z.a;
  z.a = ((a >> 1) | (a << 7)) & 0xff;
  z.f = (z.f & (S | Z | P)) | (a & C) | (z.a & XY);
}

/** @param {Machine} z */
export function rla(z) {
  const a = z.a;
  z.a = ((a << 1) | (z.f & C)) & 0xff;
  z.f = (z.f & (S | Z | P)) | (a >> 7) | (z.a & XY);
}

/** @param {Machine} z */
export function rra(z) {
  const a = z.a;
  z.a = (a >> 1) | ((z.f & C) << 7);
  z.f = (z.f & (S | Z | P)) | (a & C) | (z.a & XY);
}

// ---- 16-bit arithmetic (addHL :2245, addIndexReg :2760, adcHL :3103, sbcHL :3124)

/**
 * ADD HL/IX/IY,rr: S, Z and P/V kept; bits 5 and 3 from the result's high byte; MEMPTR the first operand + 1.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function add16(z, a, v) {
  const sum = a + v;
  const r = sum & 0xffff;
  z.f = (z.f & (S | Z | P)) | ((r >> 8) & XY) | ((a & 0xfff) + (v & 0xfff) > 0xfff ? H : 0) | (sum > 0xffff ? C : 0);
  z.wz = (a + 1) & 0xffff;
  return r;
}

/**
 * ADC HL,rr: every flag from the 16-bit result; MEMPTR HL + 1.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function adc16(z, a, v) {
  const c = z.f & C;
  const sum = a + v + c;
  const r = sum & 0xffff;
  z.f = ((r >> 8) & (S | XY)) | (r === 0 ? Z : 0) | ((a & 0xfff) + (v & 0xfff) + c > 0xfff ? H : 0) |
    ((a ^ v ^ 0xffff) & (a ^ r) & 0x8000 ? P : 0) | (sum > 0xffff ? C : 0);
  z.wz = (a + 1) & 0xffff;
  return r;
}

/**
 * SBC HL,rr: every flag from the 16-bit result; MEMPTR HL + 1.
 * @param {Machine} z
 * @param {number} a
 * @param {number} v
 * @returns {number}
 */
export function sbc16(z, a, v) {
  const c = z.f & C;
  const diff = a - v - c;
  const r = diff & 0xffff;
  z.f = ((r >> 8) & (S | XY)) | (r === 0 ? Z : 0) | ((a & 0xfff) - (v & 0xfff) - c < 0 ? H : 0) |
    ((a ^ v) & (a ^ r) & 0x8000 ? P : 0) | N | (diff < 0 ? C : 0);
  z.wz = (a + 1) & 0xffff;
  return r;
}

// ---- the CB rotates and shifts (:2258-2476), BIT (:2478-2502)

/**
 * The flags of a CB rotate or shift: S, Z, 5, 3 and parity from the result, H and N clear, C `c`.
 * @param {Machine} z
 * @param {number} r the result
 * @param {number} c the carry out, 0 or 1
 * @returns {number}
 */
function rotated(z, r, c) {
  z.f = SZXY[r] | PARITY[r] | c;
  return r;
}

/** @typedef {(z: Machine, v: number) => number} Shift A CB rotate or shift of the byte `v`: the result, and F */

/** @type {Shift} */
export const rlc = (z, v) => rotated(z, ((v << 1) | (v >> 7)) & 0xff, v >> 7);
/** @type {Shift} */
export const rrc = (z, v) => rotated(z, ((v >> 1) | (v << 7)) & 0xff, v & 1);
/** @type {Shift} */
export const rl = (z, v) => rotated(z, ((v << 1) | (z.f & C)) & 0xff, v >> 7);
/** @type {Shift} */
export const rr = (z, v) => rotated(z, (v >> 1) | ((z.f & C) << 7), v & 1);
/** @type {Shift} */
export const sla = (z, v) => rotated(z, (v << 1) & 0xff, v >> 7);
/** @type {Shift} */
export const sra = (z, v) => rotated(z, (v >> 1) | (v & 0x80), v & 1);
/** @type {Shift} SLL (undocumented): shift left, a 1 into bit 0 */
export const sll = (z, v) => rotated(z, ((v << 1) | 1) & 0xff, v >> 7);
/** @type {Shift} */
export const srl = (z, v) => rotated(z, v >> 1, v & 1);

/**
 * BIT n: Z and P/V set when the bit is clear, S only for bit 7 set, H set, C kept. Bits 5 and 3 come
 * from `xy`: the register itself for BIT n,r, MEMPTR's high byte for BIT n,(HL) and (IX+d) (:2498-2500).
 * @param {Machine} z
 * @param {number} n the bit, 0-7
 * @param {number} v the byte tested
 * @param {number} xy
 */
export function bit(z, n, v, xy) {
  const set = v & (1 << n);
  z.f = (z.f & C) | H | (set ? 0 : Z | P) | (n === 7 && set ? S : 0) | (xy & XY);
}

// ---- loads that set flags (LD A,I :1888, LD A,R :1897, IN r,(C) :3166), RLD and RRD (:3363-3399)

/**
 * The flags of LD A,I and LD A,R: S, Z, 5, 3 from the byte, P/V = IFF2, H and N clear, C kept.
 * @param {Machine} z
 * @param {number} v the byte loaded
 * @returns {number} `v`
 */
export function ldair(z, v) {
  z.f = (z.f & C) | SZXY[v] | (z.iff2 ? P : 0);
  return v;
}

/**
 * The flags of IN r,(C): S, Z, 5, 3 and parity from the byte read, H and N clear, C kept.
 * @param {Machine} z
 * @param {number} v the byte read
 * @returns {number} `v`
 */
export function inr(z, v) {
  z.f = (z.f & C) | SZXY[v] | PARITY[v];
  return v;
}

/**
 * The flags RLD and RRD leave: from A, C kept (:3391-3399).
 * @param {Machine} z
 */
function nibbleFlags(z) {
  z.f = (z.f & C) | SZXY[z.a] | PARITY[z.a];
}

/**
 * RLD: A's low nibble, (HL)'s two, rotated left; MEMPTR HL + 1.
 * @param {Machine} z
 */
export function rld(z) {
  const hl = z.hl;
  const v = z.read(hl);
  z.write(hl, ((v << 4) & 0xf0) | (z.a & 0x0f));
  z.a = (z.a & 0xf0) | (v >> 4);
  z.wz = (hl + 1) & 0xffff;
  nibbleFlags(z);
}

/**
 * RRD: the same three nibbles rotated right.
 * @param {Machine} z
 */
export function rrd(z) {
  const hl = z.hl;
  const v = z.read(hl);
  z.write(hl, ((z.a & 0x0f) << 4) | (v >> 4));
  z.a = (z.a & 0xf0) | (v & 0x0f);
  z.wz = (hl + 1) & 0xffff;
  nibbleFlags(z);
}

// ---- the block instructions, one iteration each (ldi :2835, ldd :2871, cpi :2908, cpd :2947,
// ini :3217, ind :3247, outi :3275, outd :3303); a translated LDIR is a loop of `ldi`

/**
 * The flags of LDI and LDD: H and N clear, P/V set while BC is not 0, bits 5 and 3 from bits 1 and 3
 * of the byte moved plus A (`_xyBlock`, :177-181); S, Z and C kept.
 * @param {Machine} z
 * @param {number} v the byte moved
 */
function ldFlags(z, v) {
  const n = (v + z.a) & 0xff;
  z.f = (z.f & (S | Z | C)) | (z.bc !== 0 ? P : 0) | ((n & 0x02) << 4) | (n & 0x08);
}

/**
 * LDI: (DE) = (HL); HL and DE up, BC down.
 * @param {Machine} z
 */
export function ldi(z) {
  const v = z.read(z.hl);
  z.write(z.de, v);
  z.hl = (z.hl + 1) & 0xffff;
  z.de = (z.de + 1) & 0xffff;
  z.bc = (z.bc - 1) & 0xffff;
  ldFlags(z, v);
}

/**
 * LDD: (DE) = (HL); HL, DE and BC down.
 * @param {Machine} z
 */
export function ldd(z) {
  const v = z.read(z.hl);
  z.write(z.de, v);
  z.hl = (z.hl - 1) & 0xffff;
  z.de = (z.de - 1) & 0xffff;
  z.bc = (z.bc - 1) & 0xffff;
  ldFlags(z, v);
}

/**
 * The flags of CPI and CPD: S, Z and H from A - (HL), N set, P/V set while BC is not 0, bits 5 and 3
 * from bits 1 and 3 of the result less H; C kept.
 * @param {Machine} z
 * @param {number} v the byte compared
 */
function cpFlags(z, v) {
  const a = z.a;
  const r = (a - v) & 0xff;
  const h = (a & 0xf) < (v & 0xf);
  const n = (r - (h ? 1 : 0)) & 0xff;
  z.f = (z.f & C) | (r & S) | (r === 0 ? Z : 0) | (h ? H : 0) | (z.bc !== 0 ? P : 0) | N | ((n & 0x02) << 4) | (n & 0x08);
}

/**
 * CPI: compare A with (HL); HL and MEMPTR up, BC down.
 * @param {Machine} z
 */
export function cpi(z) {
  const v = z.read(z.hl);
  z.hl = (z.hl + 1) & 0xffff;
  z.bc = (z.bc - 1) & 0xffff;
  z.wz = (z.wz + 1) & 0xffff;
  cpFlags(z, v);
}

/**
 * CPD: compare A with (HL); HL, MEMPTR and BC down.
 * @param {Machine} z
 */
export function cpd(z) {
  const v = z.read(z.hl);
  z.hl = (z.hl - 1) & 0xffff;
  z.bc = (z.bc - 1) & 0xffff;
  z.wz = (z.wz - 1) & 0xffff;
  cpFlags(z, v);
}

/**
 * The flags of the block I/O instructions (`_blockIOFlags`, :3198-3211, after Young §4.3): S, Z, 5 and
 * 3 from B after it counts down, N bit 7 of the byte moved, H and C the carry out of `k`, P/V the
 * parity of (k AND 7) XOR B.
 * @param {Machine} z
 * @param {number} v the byte moved
 * @param {number} k
 */
function ioFlags(z, v, k) {
  const b = z.b;
  z.f = SZXY[b] | (v & 0x80 ? N : 0) | (k > 0xff ? H | C : 0) | PARITY[(k & 7) ^ b];
}

/**
 * INI: (HL) = IN (C); HL up, B down; MEMPTR BC + 1 before B counts.
 * @param {Machine} z
 */
export function ini(z) {
  z.wz = (z.bc + 1) & 0xffff;
  const port = z.c;
  const v = z.in(port);
  z.write(z.hl, v);
  z.hl = (z.hl + 1) & 0xffff;
  z.b = (z.b - 1) & 0xff;
  ioFlags(z, v, v + ((port + 1) & 0xff));
}

/**
 * IND: (HL) = IN (C); HL and B down; MEMPTR BC - 1 before B counts.
 * @param {Machine} z
 */
export function ind(z) {
  z.wz = (z.bc - 1) & 0xffff;
  const port = z.c;
  const v = z.in(port);
  z.write(z.hl, v);
  z.hl = (z.hl - 1) & 0xffff;
  z.b = (z.b - 1) & 0xff;
  ioFlags(z, v, v + ((port - 1) & 0xff));
}

/**
 * OUTI: OUT (C) = (HL); HL up, B down; MEMPTR BC + 1 after B counts.
 * @param {Machine} z
 */
export function outi(z) {
  const port = z.c;
  const v = z.read(z.hl);
  z.out(port, v);
  z.hl = (z.hl + 1) & 0xffff;
  z.b = (z.b - 1) & 0xff;
  z.wz = (z.bc + 1) & 0xffff;
  ioFlags(z, v, v + z.l);
}

/**
 * OUTD: OUT (C) = (HL); HL and B down; MEMPTR BC - 1 after B counts.
 * @param {Machine} z
 */
export function outd(z) {
  const port = z.c;
  const v = z.read(z.hl);
  z.out(port, v);
  z.hl = (z.hl - 1) & 0xffff;
  z.b = (z.b - 1) & 0xff;
  z.wz = (z.bc - 1) & 0xffff;
  ioFlags(z, v, v + z.l);
}

// ---- the stack and the exchanges (PUSH :550-556, POP :559-565, EX (SP),HL :1562-1574, EXX :1577)

/**
 * PUSH: the high byte to SP - 1 first, then the low byte to SP - 2.
 * @param {Machine} z
 * @param {number} v
 */
export function push(z, v) {
  z.sp = (z.sp - 1) & 0xffff;
  z.write(z.sp, (v >> 8) & 0xff);
  z.sp = (z.sp - 1) & 0xffff;
  z.write(z.sp, v & 0xff);
}

/**
 * POP: the word at SP, low byte first; SP up by 2.
 * @param {Machine} z
 * @returns {number}
 */
export function pop(z) {
  const lo = z.read(z.sp);
  const hi = z.read((z.sp + 1) & 0xffff);
  z.sp = (z.sp + 2) & 0xffff;
  return (hi << 8) | lo;
}

/**
 * EX (SP),rr: reads (SP) and (SP+1), then writes (SP+1) with the high byte BEFORE (SP) with the low
 * (MAME's z80.lst `ex_sp`); MEMPTR the word read.
 * @param {Machine} z
 * @param {number} v the register pair's value
 * @returns {number} the word that was on the stack
 */
export function exsp(z, v) {
  const sp = z.sp;
  const lo = z.read(sp);
  const hi = z.read((sp + 1) & 0xffff);
  z.write((sp + 1) & 0xffff, (v >> 8) & 0xff);
  z.write(sp, v & 0xff);
  z.wz = (hi << 8) | lo;
  return z.wz;
}

/**
 * EXX: BC, DE and HL with BC', DE' and HL'.
 * @param {Machine} z
 */
export function exx(z) {
  const { bc, de, hl } = z;
  z.bc = z.bc_;
  z.de = z.de_;
  z.hl = z.hl_;
  z.bc_ = bc;
  z.de_ = de;
  z.hl_ = hl;
}

// ---- control: the routines of a port, how one calls another, and what a port cannot follow

/**
 * A routine of a port: one function per routine of the original program. It runs until the
 * original's RET, and returns nothing, or until it jumps into another routine's start, and returns
 * that routine, which `call` then runs in its place with the same return address.
 * @typedef {(z: Machine, ret: number) => (Routine | undefined)} Routine
 */

/**
 * Marks an error `call` has already said where it happened, so an outer `call` adds nothing more. A
 * registered symbol, so two copies of this module (a port that imports the helpers by another path
 * than its host's) still agree.
 */
const PLACED = Symbol.for('@fugloy/runtime: placed');

/** @param {number} n */
const hex4 = (n) => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * CALL: run `routine`, whose RET must return to `ret` (the CALL has already pushed it), and every
 * routine it jumps into, one after another, until one returns: a trampoline, so routines that jump
 * into each other (a game loop) never grow the JavaScript stack. An error thrown inside gets, once,
 * the routine it was running and the block it was in (the address `z.at` was last given) added to
 * its sentence.
 * @param {Machine} z
 * @param {Routine} routine
 * @param {number} ret the address after the CALL
 */
export function call(z, routine, ret) {
  /** @type {Routine | undefined} */
  let next = routine;
  /** @type {Routine} */
  let running = routine;
  try {
    while (next !== undefined) {
      running = next;
      next = next(z, ret);
    }
  } catch (e) {
    if (e instanceof Error && !Object.hasOwn(e, PLACED)) {
      Object.defineProperty(e, PLACED, { value: true });
      e.message += ` (in ${running.name}, in the block at ${hex4(z.block)})`;
    }
    throw e;
  }
}

/**
 * RET: the instruction's statements have popped the address into MEMPTR (`z.wz`), as emu does; a port
 * follows a RET only back to the address after the CALL that ran its routine, so any other address
 * is refused with a sentence.
 * @param {Machine} z
 * @param {number} expected the address after the CALL
 * @param {number} at the RET's address
 */
export function ret(z, expected, at) {
  if (z.wz !== expected) {
    throw new Error(
      `the RET at ${hex4(at)} returns to ${hex4(z.wz)}, not to ${hex4(expected)}, the address after the CALL that ran its routine (a port follows a RET only back to its CALL)`,
    );
  }
}

/**
 * A CALL to a ROM routine the runtime stands in for (rom.js): push `returnAddr` as the CALL does (its
 * T-states are the block's), run the stand-in, which ticks the routine's T-states and R, its RET's
 * included, and pop the address as the RET does, into MEMPTR (emu's RET, z80cpu.js:521-528). The two
 * bytes the push wrote stay in memory, as on emu, and Q is 0: a RET writes no flags. The port writes
 * the call only for an address port() was given as a stand-in; on a machine that has none there, a
 * sentence.
 * @param {Machine} z
 * @param {number} addr the routine's address
 * @param {number} returnAddr the address after the CALL
 */
export function standin(z, addr, returnAddr) {
  const routine = z.model === 1 || z.model === 3 ? standins(z.model).get(addr) : undefined;
  if (routine === undefined) {
    const model = z.model === 1 ? 'the Model I' : z.model === 3 ? 'the Model III' : `the ${String(z.model)} machine`;
    throw new Error(`the runtime has no stand-in for the ROM routine at ${hex4(addr)} on ${model} (called to return to ${hex4(returnAddr)})`);
  }
  push(z, returnAddr);
  routine.run(z);
  z.wz = pop(z);
  z.q = 0;
}

/**
 * The sentence for a transfer to an address where no block of the port starts: an address the
 * disassembly did not find as code (outside the program, such as a ROM routine, or inside its data).
 * The port's statement throws it. For a JP whose target the program rewrites, `known` and `cell` are
 * given: the targets the trace saw it hold, each a block of the port, and where its target word is; the
 * sentence names the value it holds now, which is none of them.
 * @param {Machine} z
 * @param {number} target
 * @param {number} from the transfer's address
 * @param {readonly number[]} [known] the targets the trace saw a rewritten JP hold
 * @param {number} [cell] the address of that JP's target word
 * @returns {Error}
 */
export function unknown(z, target, from, known, cell) {
  if (known !== undefined && cell !== undefined) {
    const saw = known.length === 1 ? hex4(known[0]) : `${known.slice(0, -1).map(hex4).join(', ')} and ${hex4(known[known.length - 1])}`;
    return new Error(
      `the transfer at ${hex4(from)} goes to ${hex4(target)}: the program rewrote its target at ${hex4(cell)} to a value the trace did not see (it saw ${saw}); run the census over a session that reaches this`,
    );
  }
  return new Error(`the transfer at ${hex4(from)} goes to ${hex4(target)}, where no block of the port starts (the disassembly found no code there)`);
}

/**
 * The sentence for a HALT, which waits for an interrupt; a port takes none. The port's statement
 * throws it.
 * @param {Machine} z
 * @param {number} at the HALT's address
 * @returns {Error}
 */
export function halt(z, at) {
  return new Error(`the HALT at ${hex4(at)} waits for an interrupt, which a port does not take`);
}
