/** A load block as it was written: start address, length, inclusive end. */
export interface Block {
  index: number;
  start: number;
  length: number;
  /** Inclusive last address, wrapped to 16 bits. */
  end: number;
  /** True when start + length passed $FFFF and the tail landed at $0000. */
  wrapped: boolean;
}

/** The intersection of a block with an earlier one; the later block's bytes won. */
export interface Overlap {
  block: number;
  earlier: number;
  start: number;
  end: number;
}

/** A maximal contiguous range of loaded addresses. */
export interface Run {
  start: number;
  end: number;
  length: number;
}

const SIZE = 0x10000;

/** Address ranges a block covers, as inclusive [lo, hi] pairs; two when it wraps. */
function ranges(b: Block): [number, number][] {
  if (b.length === 0) return [];
  const last = b.start + b.length - 1;
  if (last < SIZE) return [[b.start, last]];
  return [[b.start, SIZE - 1], [0, last - SIZE]];
}

/**
 * The 64K memory image every loader fills: a flat byte array plus a parallel
 * bitmap of which addresses were loaded, with a log of every block written and
 * every overlap between blocks. Everything downstream reads the image, never
 * the file.
 */
export class MemoryImage {
  readonly bytes = new Uint8Array(SIZE);
  /** 1 where a byte was loaded, else 0. One byte per address, never packed. */
  readonly loaded = new Uint8Array(SIZE);
  readonly blocks: Block[] = [];
  readonly overlaps: Overlap[] = [];

  /** Writes `data` at `addr`, wrapping past $FFFF, and records the block and any overlaps. */
  load(addr: number, data: ArrayLike<number>): Block {
    const start = addr & 0xffff;
    const length = data.length;
    const block: Block = {
      index: this.blocks.length,
      start,
      length,
      end: (start + Math.max(length, 1) - 1) & 0xffff,
      wrapped: start + length > SIZE,
    };
    for (const earlier of this.blocks) {
      for (const [lo, hi] of ranges(block)) {
        for (const [elo, ehi] of ranges(earlier)) {
          const s = Math.max(lo, elo);
          const e = Math.min(hi, ehi);
          if (s <= e) this.overlaps.push({ block: block.index, earlier: earlier.index, start: s, end: e });
        }
      }
    }
    for (let i = 0; i < length; i++) {
      const a = (start + i) & 0xffff;
      this.bytes[a] = data[i]! & 0xff;
      this.loaded[a] = 1;
    }
    this.blocks.push(block);
    return block;
  }

  isLoaded(addr: number): boolean {
    return this.loaded[addr & 0xffff] === 1;
  }

  /** The byte at `addr`, or undefined when nothing was loaded there. */
  read(addr: number): number | undefined {
    const a = addr & 0xffff;
    return this.loaded[a] === 1 ? this.bytes[a] : undefined;
  }

  /** Contiguous loaded ranges in address order; each becomes its own ORG. */
  runs(): Run[] {
    const out: Run[] = [];
    let start = -1;
    for (let a = 0; a <= SIZE; a++) {
      const on = a < SIZE && this.loaded[a] === 1;
      if (on && start < 0) start = a;
      if (!on && start >= 0) {
        out.push({ start, end: a - 1, length: a - start });
        start = -1;
      }
    }
    return out;
  }

  lowestLoaded(): number | null {
    const i = this.loaded.indexOf(1);
    return i < 0 ? null : i;
  }
}
