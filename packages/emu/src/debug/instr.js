/**
 * Instruction length and control flow, read from the bytes at an address (spec §4, §6). The
 * debugger uses it to tell an instruction fetch from a data read, to mark coverage, and to record
 * the targets of jumps and calls. It follows the x/y/z/p/q decomposition of the opcode, with no
 * tables built at run time, and it allocates one small object per call.
 */

const WRAP = 0xffff;

/** Unprefixed opcode `op` at `at`: length, kind, and target. `CB`, `ED`, `DD`, `FD` are not handled here. */
function plain(read, at, op) {
  const x = op >> 6;
  const y = (op >> 3) & 7;
  const z = op & 7;
  if (x === 0) {
    if (z === 0 && y >= 2) {
      const d = read((at + 1) & WRAP);
      const target = (at + 2 + (d < 0x80 ? d : d - 0x100)) & WRAP;
      return { len: 2, kind: y === 2 ? "djnz" : "jr", target };
    }
    if (z === 1 && !(y & 1)) return { len: 3, kind: null, target: null };
    if (z === 2 && y >= 4) return { len: 3, kind: null, target: null };
    if (z === 6) return { len: 2, kind: null, target: null };
    return { len: 1, kind: null, target: null };
  }
  if (x !== 3) return { len: 1, kind: null, target: null };
  switch (z) {
    case 0:
      return { len: 1, kind: "ret", target: null };
    case 1:
      if (y === 1) return { len: 1, kind: "ret", target: null };
      if (y === 5) return { len: 1, kind: "jp-ind", target: null };
      return { len: 1, kind: null, target: null };
    case 2:
      return { len: 3, kind: "jp", target: word(read, at) };
    case 3:
      if (y === 0) return { len: 3, kind: "jp", target: word(read, at) };
      if (y === 2 || y === 3) return { len: 2, kind: null, target: null };
      return { len: 1, kind: null, target: null };
    case 4:
      return { len: 3, kind: "call", target: word(read, at) };
    case 5:
      if (y === 1) return { len: 3, kind: "call", target: word(read, at) };
      return { len: 1, kind: null, target: null };
    case 6:
      return { len: 2, kind: null, target: null };
    default:
      return { len: 1, kind: "rst", target: y * 8 };
  }
}

/** The 16-bit operand after the opcode at `at`. */
function word(read, at) {
  return read((at + 1) & WRAP) | (read((at + 2) & WRAP) << 8);
}

/** Does the unprefixed opcode name (HL), so that under DD or FD it takes a displacement byte? */
function usesHlMemory(op) {
  if (op === 0x34 || op === 0x35 || op === 0x36) return true;
  const x = op >> 6;
  if (x === 1) return op !== 0x76 && ((op & 7) === 6 || ((op >> 3) & 7) === 6);
  return x === 2 && (op & 7) === 6;
}

/**
 * What the instruction at `pc` is. `read(addr)` returns the byte at `addr` (addresses wrap at
 * $FFFF). `kind` is "call", "jp", "jr", "djnz", "rst", "ret" (RETI and RETN too), "jp-ind"
 * (JP (HL), (IX), (IY)), or null; conditional forms have the same kind as the plain ones.
 * `target` is the static destination of call, jp, jr, djnz, and rst, else null. A DD or FD
 * followed by DD, FD, or ED is one byte with kind null: the CPU runs it as a step of its own.
 */
export function instructionInfo(read, pc) {
  const op = read(pc & WRAP);
  if (op === 0xcb) return { len: 2, kind: null, target: null };
  if (op === 0xed) {
    const next = read((pc + 1) & WRAP);
    if ((next & 0xc7) === 0x43) return { len: 4, kind: null, target: null };
    if ((next & 0xc7) === 0x45) return { len: 2, kind: "ret", target: null };
    return { len: 2, kind: null, target: null };
  }
  if (op === 0xdd || op === 0xfd) {
    const next = read((pc + 1) & WRAP);
    if (next === 0xdd || next === 0xfd || next === 0xed) return { len: 1, kind: null, target: null };
    if (next === 0xcb) return { len: 4, kind: null, target: null };
    const info = plain(read, (pc + 1) & WRAP, next);
    info.len += 1 + (usesHlMemory(next) ? 1 : 0);
    return info;
  }
  return plain(read, pc & WRAP, op);
}
