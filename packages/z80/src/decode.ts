import { TABLES } from './tables.js';
import type { Flow, Instruction, Operand, Reader, Template } from './types.js';

const NEXT: Flow = { kind: 'next', conditional: false, indirect: false };
const signed = (b: number): number => (b >= 0x80 ? b - 0x100 : b);

/**
 * Decodes one instruction. `read(i)` returns the byte at offset i from the
 * instruction start, or undefined when the bytes run out; in that case the
 * result is a one-byte DB flagged `truncated`. `address` is only used to
 * resolve relative jump targets.
 */
export function decode(read: Reader, address = 0): Instruction {
  const b0 = read(0);
  if (b0 === undefined) throw new RangeError('decode: no byte at offset 0');
  const bytes: number[] = [b0];
  const next = (): number | undefined => {
    const b = read(bytes.length);
    if (b !== undefined) bytes.push(b);
    return b;
  };
  const truncated = (): Instruction => ({
    mnemonic: 'DB', operands: [{ kind: 'byte', value: b0 }], length: 1, bytes: [b0],
    cycles: 0, flow: NEXT, documented: false, flags: '', truncated: true,
  });

  let tpl: Template;
  let dByte: number | undefined;
  if (b0 === 0xcb || b0 === 0xed) {
    const op = next();
    if (op === undefined) return truncated();
    tpl = (b0 === 0xcb ? TABLES.cb : TABLES.ed)[op]!;
  } else if (b0 === 0xdd || b0 === 0xfd) {
    const op = next();
    if (op === undefined) return truncated();
    if (op === 0xcb) {
      const d = next();
      const op2 = next();
      if (d === undefined || op2 === undefined) return truncated();
      dByte = d;
      tpl = (b0 === 0xdd ? TABLES.ddcb : TABLES.fdcb)[op2]!;
    } else {
      tpl = (b0 === 0xdd ? TABLES.dd : TABLES.fd)[op]!;
      if (tpl.length === 1) bytes.pop(); // prefix on an unaffected opcode: the DD/FD byte alone is the instruction
    }
  } else {
    tpl = TABLES.base[b0]!;
  }

  const operands: Operand[] = [];
  for (const o of tpl.operands) {
    switch (o.t) {
      case 'fixed':
        operands.push(o.op);
        break;
      case 'n': {
        const v = next();
        if (v === undefined) return truncated();
        operands.push({ kind: 'imm8', value: v });
        break;
      }
      case 'nn':
      case '(nn)': {
        const lo = next();
        const hi = next();
        if (lo === undefined || hi === undefined) return truncated();
        const value = lo | (hi << 8);
        operands.push(o.t === 'nn' ? { kind: 'imm16', value } : { kind: 'mem', addr: value });
        break;
      }
      case '(n)': {
        const v = next();
        if (v === undefined) return truncated();
        operands.push({ kind: 'port', value: v });
        break;
      }
      case 'e': {
        const v = next();
        if (v === undefined) return truncated();
        const disp = signed(v);
        operands.push({ kind: 'rel', disp, target: (address + tpl.length + disp) & 0xffff });
        break;
      }
      case '(ix+d)': {
        const v = dByte ?? next();
        if (v === undefined) return truncated();
        operands.push({ kind: 'idx', reg: o.reg, disp: signed(v) });
        break;
      }
      case 'd': {
        const v = dByte ?? next();
        if (v === undefined) return truncated();
        operands.push({ kind: 'byte', value: v });
        break;
      }
    }
  }

  const ins: Instruction = {
    mnemonic: tpl.mnemonic, operands, length: tpl.length, bytes, cycles: tpl.cycles, flow: tpl.flow, documented: tpl.documented, flags: tpl.flags,
  };
  if (tpl.cyclesNotTaken !== undefined) ins.cyclesNotTaken = tpl.cyclesNotTaken;
  return ins;
}

/** Decodes the instruction at `bytes[offset]`, never reading at or past `end`. */
export function decodeAt(bytes: ArrayLike<number>, offset: number, address = offset, end = bytes.length): Instruction {
  return decode((i) => {
    const at = offset + i;
    return at >= 0 && at < end ? bytes[at] : undefined;
  }, address);
}
