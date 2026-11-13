/**
 * @fugloy/runtime, M2 Task 4: `load`'s write guard. A port carries none of its program's code bytes, so a
 * program that writes into its code would run on with stale code; `load` refuses that instead. It puts
 * each rewritten operand's initial value (`CELLS`) in memory and marks the module's code (`CODE`), and a
 * write to a code byte that is not one of the cells throws a sentence naming the address. A cell, data,
 * and a machine with no port loaded take every write.
 */
import { describe, expect, it } from 'vitest';
import { createZ, load } from '../src/index.js';
import { push } from '../src/ops.js';

const sentence = (addr) =>
  `self-modifying code: $${addr.toString(16).toUpperCase().padStart(4, '0')} written (the trace does not name it; run the census over a session that reaches this)`;

/** A module as port() writes one: code at $7000-$700F and $7020-$7021, a cell at $7005, data at $7010. */
const mod = {
  MODEL: 3,
  DATA: [[0x7010, Uint8Array.of(0x11, 0x22)]],
  CODE: [
    [0x7000, 0x700f],
    [0x7020, 0x7021],
  ],
  CELLS: [[0x7005, 0x42]],
  ENTRY: () => undefined,
};

/** The message `fn` throws, or null when it does not throw. */
function thrown(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e.message;
  }
}

describe("load's write guard", () => {
  it('puts each cell\'s initial value in memory, beside the data', () => {
    const z = createZ({ model: 3 });
    load(z, mod);
    expect(z.mem[0x7005]).toBe(0x42);
    expect([z.mem[0x7010], z.mem[0x7011]]).toEqual([0x11, 0x22]);
    // The code bytes are not there: none are carried
    expect(z.mem[0x7000]).toBe(0);
  });

  it('lets a write to a cell through', () => {
    const z = createZ({ model: 3 });
    load(z, mod);
    z.write(0x7005, 0x99);
    expect(z.mem[0x7005]).toBe(0x99);
  });

  it('throws at a write to any other code byte, naming it, and leaves the byte alone', () => {
    const z = createZ({ model: 3 });
    load(z, mod);
    for (const a of [0x7000, 0x7004, 0x7006, 0x700f, 0x7020, 0x7021]) {
      expect(thrown(() => z.write(a, 0xc9)), `$${a.toString(16)}`).toBe(sentence(a));
      expect(z.mem[a]).toBe(0);
    }
    // A word write and a push meet the guard at the byte they write first
    expect(thrown(() => z.write16(0x701f, 0x1234))).toBe(sentence(0x7020));
    expect(z.mem[0x701f]).toBe(0x34);
    z.sp = 0x7022;
    expect(thrown(() => push(z, 0xabcd))).toBe(sentence(0x7021));
  });

  it('lets writes to data and to the rest of memory through', () => {
    const z = createZ({ model: 3 });
    load(z, mod);
    z.write(0x7010, 0x55);
    z.write(0x7011, 0x66);
    z.write(0x6fff, 1);
    z.write(0x7022, 2);
    z.write(0x3c00, 0x41);
    expect([z.mem[0x7010], z.mem[0x7011], z.mem[0x6fff], z.mem[0x7022], z.mem[0x3c00]]).toEqual([0x55, 0x66, 1, 2, 0x41]);
  });

  it('is not there on a machine with no port loaded, nor after a module with no code', () => {
    const z = createZ({ model: 3 });
    z.write(0x7000, 0xc9);
    expect(z.mem[0x7000]).toBe(0xc9);
    load(z, { MODEL: 3, DATA: [], CODE: [], CELLS: [], ENTRY: () => undefined });
    z.write(0x7001, 0xc9);
    expect(z.mem[0x7001]).toBe(0xc9);
  });
});

describe("load's ROM bytes (M2 Task 7)", () => {
  // A module whose program reads three ROM bytes as data, as Sea Dragon reads $0000 and $0003
  const reads = { MODEL: 3, DATA: [], CODE: [], CELLS: [], ROM: [[0x0000, 0xf3], [0x0003, 0x15], [0x37ff, 0xa5]], ENTRY: () => undefined };

  it('stores each byte straight into memory, where a write through the map would be lost, and the program reads it', () => {
    const z = createZ({ model: 3 });
    // The map loses a write to ROM: z.write could not have put them there
    z.write(0x0003, 0x15);
    expect(z.read(0x0003)).toBe(0);
    load(z, reads);
    expect([z.read(0x0000), z.read(0x0003), z.read(0x37ff)]).toEqual([0xf3, 0x15, 0xa5]);
    // The rest of the ROM space stays as a new machine has it, and a write there is still lost
    expect([z.read(0x0001), z.read(0x0002)]).toEqual([0, 0]);
    z.write(0x0003, 0x16);
    expect(z.read(0x0003)).toBe(0x15);
  });

  it('on the Model I too, and a module with no ROM changes no ROM byte', () => {
    const z = createZ({ model: 1 });
    load(z, { ...reads, MODEL: 1, ROM: [[0x0003, 0x15]] });
    expect(z.read(0x0003)).toBe(0x15);
    const plain = createZ({ model: 3 });
    load(plain, mod);
    expect(plain.mem.subarray(0, 0x3800).every((v) => v === 0)).toBe(true);
  });
});
