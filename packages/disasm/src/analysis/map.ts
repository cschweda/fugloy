/**
 * Pass 1's primary result: what each byte of the 64K image is, parallel to
 * the memory image, plus which bytes begin an instruction. Regions, basic
 * blocks, the IR, the emitter, and the listing are views over this map, and
 * hint-file overrides (sub-project B) are writes into it.
 */
export const Kind = { Unknown: 0, Code: 1, Tail: 2, Byte: 3, Word: 4, String: 5 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];
// Word and String are reserved for later sub-projects; Pass 1 uses Unknown, Code, Tail, Byte.

const SIZE = 0x10000;

export class ByteMap {
  /** One Kind per address. */
  readonly kinds = new Uint8Array(SIZE);
  /** 1 at the first byte of every decoded instruction. */
  readonly starts = new Uint8Array(SIZE);

  kind(addr: number): Kind {
    return this.kinds[addr & 0xffff] as Kind;
  }

  isStart(addr: number): boolean {
    return this.starts[addr & 0xffff] === 1;
  }

  /** Code or Tail: a byte that belongs to a decoded instruction. */
  isCode(addr: number): boolean {
    const k = this.kinds[addr & 0xffff];
    return k === Kind.Code || k === Kind.Tail;
  }

  /** Types `length` bytes from `addr` as one instruction: Code, then Tail. Wraps at $FFFF. */
  markCode(addr: number, length: number): void {
    for (let i = 0; i < length; i++) {
      const a = (addr + i) & 0xffff;
      this.kinds[a] = i === 0 ? Kind.Code : Kind.Tail;
      this.starts[a] = i === 0 ? 1 : 0;
    }
  }

  /** Types `length` bytes from `addr` as data of the given kind, clearing any instruction start. */
  mark(addr: number, length: number, kind: Kind): void {
    for (let i = 0; i < length; i++) {
      const a = (addr + i) & 0xffff;
      this.kinds[a] = kind;
      this.starts[a] = 0;
    }
  }

  /** Types `length` bytes from `addr` as plain data bytes. */
  markByte(addr: number, length: number): void {
    this.mark(addr, length, Kind.Byte);
  }

  /** True when any byte in [addr, addr + length) already belongs to an instruction. */
  overlapsCode(addr: number, length: number): boolean {
    for (let i = 0; i < length; i++) if (this.isCode(addr + i)) return true;
    return false;
  }

  /** First address in [addr, addr + length) that is already typed (code or data), or null. */
  firstTyped(addr: number, length: number): number | null {
    for (let i = 0; i < length; i++) {
      const a = (addr + i) & 0xffff;
      if (this.kinds[a] !== Kind.Unknown) return a;
    }
    return null;
  }
}
