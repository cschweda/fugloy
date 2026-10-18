/**
 * instructionInfo against @fugloy/z80 for every opcode form (the debugger's length and flow come
 * from the bytes, not from a table). Mapping from the z80 flow taxonomy: jump + indirect is
 * "jp-ind"; other jumps are "jr" (JR), "djnz" (DJNZ), or "jp" (JP) by mnemonic; call is "rst"
 * for RST and "call" otherwise; return is "ret", RETI and RETN included; next and halt are null.
 * A lone DD or FD before DD, FD, or ED is a step of one byte and kind null; before any other
 * opcode it is part of the step, as in cpu-timing.test.js.
 */
import { decode } from '@fugloy/z80';
import { describe, expect, it } from 'vitest';
import { instructionInfo } from '../../src/debug/instr.js';

const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
const isIndexPrefix = (b) => b === 0xdd || b === 0xfd;
const PC = 0x4000;

/**
 * What @fugloy/z80 says about the step that starts at `PC` in `bytes`. A lone DD or FD (z80 length
 * 1) before an opcode it does not modify is part of the step (it adds a byte); before DD, FD, or ED
 * the core runs it as a step of its own, so that step is one byte of no flow.
 */
function reference(bytes) {
  let at = 0;
  for (;;) {
    const ins = decode((k) => bytes[at + k]);
    if (!(ins.length === 1 && isIndexPrefix(bytes[at]))) return describe_(ins, at);
    if ([0xdd, 0xfd, 0xed].includes(bytes[at + 1])) return { len: at + 1, kind: null, target: null };
    at += 1;
  }
}

function describe_(ins, at) {
  const { kind, indirect } = ins.flow;
  let mapped = null;
  if (kind === 'jump') mapped = indirect ? 'jp-ind' : { JR: 'jr', DJNZ: 'djnz' }[ins.mnemonic] ?? 'jp';
  else if (kind === 'call') mapped = ins.mnemonic === 'RST' ? 'rst' : 'call';
  else if (kind === 'return') mapped = 'ret';
  let target = null;
  if (mapped !== null && mapped !== 'ret' && mapped !== 'jp-ind') {
    const o = ins.operands.find((p) => p.kind === 'rel' || p.kind === 'imm16' || p.kind === 'rst');
    // decode has no address, so a relative target is as if the instruction were at 0.
    target = o.kind === 'rel' ? (o.target + PC + at) & 0xffff : o.kind === 'rst' ? o.addr : o.value;
  }
  return { len: at + ins.length, kind: mapped, target };
}

function place(bytes, at = PC) {
  const mem = new Map(bytes.map((b, k) => [(at + k) & 0xffff, b]));
  return (a) => mem.get(a) ?? 0;
}

function sequences() {
  const all = [];
  for (let op = 0; op < 0x100; op++) {
    if (op !== 0xcb && op !== 0xed && !isIndexPrefix(op)) all.push([op, 0x34, 0x12, 0x00]);
    all.push([0xcb, op], [0xed, op, 0x34, 0x12], [0xdd, op, 0x34, 0x12, 0x00], [0xfd, op, 0x34, 0x12, 0x00]);
    all.push([0xdd, 0xcb, 0x05, op], [0xfd, 0xcb, 0x05, op]);
  }
  // Relative jumps both ways, and a lone prefix at the end of the stream.
  all.push([0x18, 0x80], [0x18, 0x7f], [0x10, 0xfe], [0x20, 0x05], [0xdd, 0x76]);
  return all;
}

describe('instructionInfo', () => {
  it('matches @fugloy/z80 for every opcode', () => {
    const deviations = [];
    for (const bytes of sequences()) {
      const want = reference(bytes);
      // The undocumented RETN mirrors (ED 55, 5D, 65, 6D, 75, 7D) return on the hardware and in the
      // core; @fugloy/z80 decodes them as 2-byte no-ops. The debugger follows the core.
      if (bytes[0] === 0xed && (bytes[1] & 0xc7) === 0x45 && bytes[1] !== 0x45 && bytes[1] !== 0x4d) want.kind = 'ret';
      const got = instructionInfo(place(bytes), PC);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        deviations.push(`${hex(bytes)}: got ${JSON.stringify(got)}, z80 ${JSON.stringify(want)}`);
      }
    }
    expect(deviations).toEqual([]);
  });

  it('wraps at $FFFF', () => {
    // CALL $1234 starting at $FFFE reads $FFFF, $0000.
    const read = (a) => ({ 0xfffe: 0xcd, 0xffff: 0x34, 0x0000: 0x12 })[a] ?? 0;
    expect(instructionInfo(read, 0xfffe)).toEqual({ len: 3, kind: 'call', target: 0x1234 });
    // JR at $FFFE wraps its target past $FFFF.
    const jr = (a) => ({ 0xfffe: 0x18, 0xffff: 0x04 })[a] ?? 0;
    expect(instructionInfo(jr, 0xfffe)).toEqual({ len: 2, kind: 'jr', target: 0x0004 });
  });

  it('treats a DD or FD before DD, FD, or ED as a one-byte step', () => {
    for (const p of [0xdd, 0xfd]) {
      for (const n of [0xdd, 0xfd, 0xed]) {
        expect(instructionInfo(place([p, n, 0xc9]), PC)).toEqual({ len: 1, kind: null, target: null });
      }
    }
  });
});
