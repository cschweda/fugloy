/**
 * @fugloy/runtime, M1 Task 1: the machine state a generated port runs on. Its memory map, ports and
 * R counter mirror @fugloy/emu's (src/z.js cites the emu lines), so these tests build emu's machine
 * beside it, ROM-free as packages/emu/test/unit does (a ROM of the model's size that is blank, or
 * seeded noise), and compare the two byte by byte. The keyboard's names are keys.test.js's.
 */
import { Machine, Z80CPU } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { createZ } from '../src/index.js';

/** The ROM size each model takes (emu's models.js). */
const ROM_BYTES = { 1: 0x3000, 3: 0x3800 };
const emu = (model, rom = new Uint8Array(ROM_BYTES[model])) => new Machine({ model, roms: { level2: rom } });

/** `n` bytes of seeded noise (mulberry32), so a failure repeats. */
function noise(seed, n) {
  let s = seed >>> 0;
  return Uint8Array.from({ length: n }, () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) & 0xff;
  });
}

const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');
/** True for the Model I's Expansion Interface addresses, which the runtime does not model. */
const expansion = (model, addr) => model === 1 && addr >= 0x37e0 && addr < 0x37f0;
/** The message `fn` throws, or null when it does not throw. */
function thrown(fn) {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return null;
}

describe('createZ', () => {
  it('names the model and its clock', () => {
    expect(createZ({ model: 1 })).toMatchObject({ model: 1, clockHz: 1774080 });
    expect(createZ({ model: 3 })).toMatchObject({ model: 3, clockHz: 2027520 });
    expect(createZ({ model: 'flat' }).model).toBe('flat');
  });

  it("takes each model's clock from emu", () => {
    for (const model of [1, 3]) expect(createZ({ model }).clockHz, `model ${model}`).toBe(emu(model).clockHz);
  });

  it('refuses any other model with a sentence naming it', () => {
    expect(() => createZ({ model: 4 })).toThrow(/^model must be 1 \(the Model I\), 3 \(the Model III\), or 'flat' \(64K of plain RAM\), not 4\.$/);
    expect(() => createZ({ model: '3' })).toThrow(/not "3"\.$/);
    expect(() => createZ({})).toThrow(/not undefined\.$/);
    expect(() => createZ()).toThrow(/not undefined\.$/);
  });

  it("starts as emu's CPU does at reset: registers clear, SP at $FFFF, interrupts off, the flags just written", () => {
    const cpu = new Z80CPU();
    cpu.reset();
    const z = createZ({ model: 'flat' });
    const eight = { a: 'A', f: 'F', b: 'B', c: 'C', d: 'D', e: 'E', h: 'H', l: 'L', i: 'I', r: 'R', ixh: 'IXH', ixl: 'IXL', iyh: 'IYH', iyl: 'IYL' };
    for (const [name, emuName] of Object.entries(eight)) expect(z[name], name).toBe(cpu.registers[emuName]);
    const r = cpu.registers;
    expect([z.sp, z.wz]).toEqual([r.SP, cpu.wz]);
    expect([z.af_, z.bc_, z.de_, z.hl_]).toEqual([(r.A_ << 8) | r.F_, (r.B_ << 8) | r.C_, (r.D_ << 8) | r.E_, (r.H_ << 8) | r.L_]);
    expect([z.iff1, z.iff2, z.im]).toEqual([cpu.IFF1, cpu.IFF2, cpu.interruptMode]);
    expect(z.q).toBe(cpu.flagsWritten ? 1 : 0);
    expect(z.cycles).toBe(cpu.cycles);
    expect(z.sound).toEqual([]);
    expect(z.mem).toBeInstanceOf(Uint8Array);
    expect(z.mem.length).toBe(0x10000);
    expect(z.keys).toBeInstanceOf(Uint8Array);
    expect(z.keys.length).toBe(8);
  });
});

describe('the register pairs', () => {
  it.each([
    ['af', 'a', 'f'],
    ['bc', 'b', 'c'],
    ['de', 'd', 'e'],
    ['hl', 'h', 'l'],
    ['ix', 'ixh', 'ixl'],
    ['iy', 'iyh', 'iyl'],
  ])('%s is %s over %s: it reads and writes 16 bits, taking a wider value\'s low 16', (pair, hi, lo) => {
    const z = createZ({ model: 'flat' });
    z[hi] = 0x12;
    z[lo] = 0x34;
    expect(z[pair]).toBe(0x1234);
    z[pair] = 0xabcd;
    expect([z[hi], z[lo]]).toEqual([0xab, 0xcd]);
    z[pair] = 0x12345;
    expect([z[hi], z[lo], z[pair]]).toEqual([0x23, 0x45, 0x2345]);
    z[pair] = 0;
    expect([z[hi], z[lo]]).toEqual([0, 0]);
  });

  it('keeps each pair apart from the others, and from the alternate set', () => {
    const z = createZ({ model: 'flat' });
    z.hl = 0x1111;
    z.de = 0x2222;
    z.bc = 0x3333;
    z.af = 0x4444;
    z.ix = 0x5555;
    z.iy = 0x6666;
    expect([z.hl, z.de, z.bc, z.af, z.ix, z.iy]).toEqual([0x1111, 0x2222, 0x3333, 0x4444, 0x5555, 0x6666]);
    expect([z.af_, z.bc_, z.de_, z.hl_]).toEqual([0, 0, 0, 0]);
  });
});

describe('time', () => {
  it('tick adds T-states and R increments, keeping R bit 7: R $7E with bit 7 set, plus 3, is $81', () => {
    const z = createZ({ model: 'flat' });
    z.r = 0xfe;
    z.tick(10, 3);
    expect(z.r).toBe(0x81);
    expect(z.cycles).toBe(10);
    z.tick(4, 1);
    expect(z.r).toBe(0x82);
    expect(z.cycles).toBe(14);
    z.r = 0x7e;
    z.tick(0, 3);
    expect(z.r).toBe(0x01); // bit 7 was clear and stays clear
  });

  it("counts R as emu's CPU does, from every starting R and for every increment, a block's worth included", () => {
    const cpu = new Z80CPU();
    const z = createZ({ model: 'flat' });
    const bad = [];
    for (let r = 0; r < 256; r++) {
      for (const n of [0, 1, 2, 3, 6, 127, 128, 129, 300, 1000]) {
        cpu.registers.R = r;
        for (let i = 0; i < n; i++) cpu.incrementR();
        z.r = r;
        z.tick(0, n);
        if (z.r !== cpu.registers.R) bad.push(`R $${hex(r, 2)} + ${n}: ${hex(z.r, 2)}, emu ${hex(cpu.registers.R, 2)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('at records the block it was given, for a refusal to name, changes nothing else, and a referee can replace it', () => {
    const z = createZ({ model: 3 });
    // Every number and flag the machine holds but `block`: registers, time, mode register
    const state = () => JSON.stringify(Object.entries(z).filter(([k, v]) => k !== 'block' && (typeof v === 'number' || typeof v === 'boolean')));
    const before = state();
    expect(z.block).toBe(0);
    expect(z.at(0x7000)).toBeUndefined();
    expect(z.block).toBe(0x7000);
    expect(state()).toBe(before);
    const seen = [];
    z.at = (addr) => seen.push(addr);
    z.at(0x7000);
    z.at(0x7010);
    expect(seen).toEqual([0x7000, 0x7010]);
  });
});

describe.each([1, 3])('the memory map of model %i', (model) => {
  it('starts as a new emu Machine with a blank ROM reads it, address by address: the screen blank, the rest clear', () => {
    const m = emu(model);
    const z = createZ({ model });
    const want = m.mem.read(0, 0x10000);
    const bad = [];
    for (let a = 0; a < 0x10000; a++) {
      if (!expansion(model, a) && z.read(a) !== want[a]) bad.push(`$${hex(a, 4)}: ${hex(z.read(a), 2)}, emu ${hex(want[a], 2)}`);
    }
    expect(bad).toEqual([]);
    expect(z.read(0x3c00)).toBe(0x20);
  });

  it('reads and writes every address as emu does, and loses a write to ROM, the keyboard and the empty space', () => {
    const rom = noise(model, ROM_BYTES[model]);
    const m = emu(model, rom);
    const z = createZ({ model });
    z.mem.set(rom); // the ROM image, where emu keeps it
    const pattern = noise(100 + model, 0x10000);
    // The same writes to both, but for the Expansion Interface's (not modelled: its own test)
    for (let a = 0; a < 0x10000; a++) {
      if (expansion(model, a)) continue;
      m.mem.write(a, [pattern[a]]);
      z.write(a, pattern[a]);
    }
    const want = m.mem.read(0, 0x10000);
    const bad = [];
    for (let a = 0; a < 0x10000; a++) {
      if (expansion(model, a)) continue;
      const got = z.read(a);
      if (got !== want[a]) bad.push(`$${hex(a, 4)}: ${hex(got, 2)}, emu ${hex(want[a], 2)}`);
    }
    expect(bad).toEqual([]);
  });

  it('ignores a write to $2000, in the ROM, and keeps the ROM image mem holds', () => {
    const z = createZ({ model });
    z.mem[0x2000] = 0x5a;
    z.write(0x2000, 0x11);
    expect(z.read(0x2000)).toBe(0x5a);
    expect(z.mem[0x2000]).toBe(0x5a);
  });

  it('ignores a write below $3C00 everywhere: the top of the ROM space, and the keyboard', () => {
    const z = createZ({ model });
    for (const addr of [0x0000, 0x2fff, 0x3800, 0x3bff, 0x3a00]) {
      z.mem[addr] = 0x77;
      z.write(addr, 0x11);
      expect(z.mem[addr], `$${hex(addr, 4)}`).toBe(0x77);
    }
  });

  it('keeps RAM whole, the address masked to 16 bits and the byte to 8', () => {
    const z = createZ({ model });
    z.write(0x4000, 0x12);
    z.write(0xffff, 0x34);
    expect([z.read(0x4000), z.read(0xffff), z.mem[0x4000], z.mem[0xffff]]).toEqual([0x12, 0x34, 0x12, 0x34]);
    expect(z.read(0x10000 + 0x4000)).toBe(0x12);
    z.write(0x14001, 0x56);
    expect(z.mem[0x4001]).toBe(0x56);
    z.write(0x4002, 0x1ab); // the byte is masked too
    expect(z.mem[0x4002]).toBe(0xab);
  });

  it('reads the keyboard as emu does, for every select byte and every mirror of $3800', () => {
    const m = emu(model);
    const z = createZ({ model });
    const bad = [];
    // Each step keeps the keys of the ones before it down
    for (const names of [[], ['SPACE'], ['A'], ['a', 'ENTER'], ['SHIFT', '8', 'RIGHT', 'Z', '@']]) {
      for (const name of names) {
        m.keyboard.press(name);
        z.press(name);
      }
      for (const page of [0x3800, 0x3900, 0x3a00, 0x3b00]) {
        for (let select = 0; select < 256; select++) {
          const a = page + select;
          const got = z.read(a);
          const want = m.mem.read(a, 1)[0];
          if (got !== want) bad.push(`$${hex(a, 4)} with ${names.join(',') || 'nothing'}: ${hex(got, 2)}, emu ${hex(want, 2)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('shows press("SPACE") in the row $3840 selects, and $38FF ORs every row', () => {
    const z = createZ({ model });
    expect(z.read(0x3840)).toBe(0);
    z.press('SPACE'); // row 6, bit 7
    expect(z.read(0x3840)).toBe(0x80);
    expect(z.read(0x3801)).toBe(0); // row 0 does not have it
    expect(z.read(0x38ff)).toBe(0x80);
    z.press('A'); // row 0, bit 1
    expect(z.read(0x38ff)).toBe(0x82);
    expect(z.read(0x3803)).toBe(0x02); // rows 0 and 1 selected, ORed
    expect(z.read(0x3b40)).toBe(0x80); // A8 and A9 are not decoded
    z.release('SPACE');
    expect(z.read(0x3840)).toBe(0);
    expect(z.read(0x38ff)).toBe(0x02);
  });

  it('reads and writes 16 bits, low byte first, through the map, as emu does', () => {
    const rom = noise(7 + model, ROM_BYTES[model]);
    const m = emu(model, rom);
    const z = createZ({ model });
    z.mem.set(rom);
    const both = (addr, value) => {
      z.write16(addr, value);
      m.system.memory.writeWord(addr, value);
    };
    both(0x4000, 0xbeef);
    expect([z.mem[0x4000], z.mem[0x4001], z.read16(0x4000)]).toEqual([0xef, 0xbe, 0xbeef]);
    // Across the top of memory, the high byte lands at $0000, which is ROM: lost
    both(0xffff, 0x1234);
    expect([z.mem[0xffff], z.mem[0x0000]]).toEqual([0x34, rom[0]]);
    expect(z.read16(0xffff)).toBe(0x34 | (rom[0] << 8));
    // Across the edge of the video RAM and RAM
    both(0x3fff, 0xcafe);
    // The same words from both, over every region's edges: ROM, empty space, keyboard, video RAM, RAM
    for (const addr of [0x2fff, 0x3000, 0x37df, 0x37ff, 0x3800, 0x3bff, 0x3c00, 0x3fff, 0x4000, 0xffff]) {
      if (expansion(model, addr) || expansion(model, addr + 1)) continue;
      expect(z.read16(addr), `read16($${hex(addr, 4)})`).toBe(m.system.memory.readWord(addr));
    }
  });
});

describe('video RAM', () => {
  it('keeps a byte written whole on the Model III', () => {
    const z = createZ({ model: 3 });
    for (const v of [0x00, 0x20, 0x41, 0x61, 0xbf, 0xff]) {
      z.write(0x3c00, v);
      expect(z.read(0x3c00), `$${hex(v, 2)}`).toBe(v);
      expect(z.mem[0x3c00]).toBe(v);
    }
  });

  it('gives a Model I byte the bit 6 its video RAM lacks: bit 6 is NOT (bit 5 OR bit 7), applied on the write', () => {
    const z = createZ({ model: 1 });
    // A write to $3C00 stores `got`: emu's memory.js gate, (v & $BF) | (v & $A0 ? 0 : $40)
    for (const [put, got] of [
      [0x61, 0x21], // "a" reads as "!"
      [0x41, 0x41],
      [0x20, 0x20], // bit 5 set: bit 6 clear
      [0x00, 0x40],
      [0x01, 0x41], // $01 reads as "A"
      [0xc5, 0x85], // graphics lose bit 6
      [0x7a, 0x3a],
      [0xff, 0xbf],
    ]) {
      z.write(0x3c00, put);
      expect(z.read(0x3c00), `$${hex(put, 2)}`).toBe(got);
      expect(z.mem[0x3c00], `mem holds what emu's video RAM holds, for $${hex(put, 2)}`).toBe(got);
    }
  });

  it.each([1, 3])("reads back, for every byte value, what emu's model %i reads back, at the first and last cell", (model) => {
    const m = emu(model);
    const z = createZ({ model });
    const bad = [];
    for (let v = 0; v < 256; v++) {
      for (const addr of [0x3c00, 0x3fff]) {
        m.mem.write(addr, [v]);
        z.write(addr, v);
        const got = z.read(addr);
        const want = m.mem.read(addr, 1)[0];
        if (got !== want || z.mem[addr] !== want) bad.push(`$${hex(v, 2)} at $${hex(addr, 4)}: ${hex(got, 2)}, emu ${hex(want, 2)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the Model I Expansion Interface, $37E0-$37EF', () => {
  it("throws the sentence that names the address and the interface, on a read and on a write", () => {
    const z = createZ({ model: 1 });
    expect(() => z.read(0x37e0)).toThrow("the port does not model $37E0 (the Model I's Expansion Interface)");
    expect(() => z.write(0x37e1, 0)).toThrow("the port does not model $37E1 (the Model I's Expansion Interface)");
    expect(() => z.read(0x37ef)).toThrow(/\$37EF/);
    expect(() => z.write(0x37e8, 0x41)).toThrow(/\$37E8/);
    expect(() => z.read16(0x37df)).toThrow(/\$37E0/); // its high byte is the first of them
    expect(() => z.write16(0x37ef, 0)).toThrow(/\$37EF|\$37F0/);
  });

  it('leaves the rest of $3000-$37FF reading $FF and ignoring writes, as emu does', () => {
    const z = createZ({ model: 1 });
    for (const addr of [0x3000, 0x37df, 0x37f0, 0x37ff]) {
      z.mem[addr] = 0x42; // nothing there for a write or a read to reach
      z.write(addr, 0x11);
      expect(z.read(addr), `$${hex(addr, 4)}`).toBe(0xff);
      expect(z.mem[addr]).toBe(0x42);
    }
  });

  it('is ROM on the Model III, which reads and ignores writes there as anywhere in its ROM', () => {
    const z = createZ({ model: 3 });
    z.mem[0x37e0] = 0x99;
    expect(z.read(0x37e0)).toBe(0x99);
    expect(() => z.write(0x37e0, 1)).not.toThrow();
    expect(z.mem[0x37e0]).toBe(0x99);
  });
});

describe('ports', () => {
  it('records each port $FF write with its T-state: $01 at 1234 is { t: 1234, v: 1 }', () => {
    for (const model of [1, 3]) {
      const z = createZ({ model });
      z.cycles = 1234;
      z.out(0xff, 1);
      expect(z.sound, `model ${model}`).toEqual([{ t: 1234, v: 1 }]);
      z.tick(66, 1);
      z.out(0xff, 0x1ab); // the byte is masked, and the port number's high bits ignored
      z.out(0x12ff, 2);
      expect(z.sound).toEqual([{ t: 1234, v: 1 }, { t: 1300, v: 0xab }, { t: 1300, v: 2 }]);
    }
  });

  it.each([1, 3])("records what emu's model %i records in m.sound, raw, stamped at the write", (model) => {
    const m = emu(model);
    const z = createZ({ model });
    const writes = [[0, 0], [7, 1], [25, 2], [43, 0x0c], [58, 0], [60, 0xff], [1_000_000, 0x55]];
    for (const [t, v] of writes) {
      m.system.cpu.cycles = t;
      z.cycles = t;
      m.io.out(0xff, v);
      z.out(0xff, v);
    }
    expect(z.sound).toEqual(m.sound.events().map((e) => ({ t: e.cycle, v: e.value })));
    expect(z.sound.length).toBe(writes.length);
  });

  it("follows the 32-column bit on the Model I's port $FF (bit 3, MODESEL), as emu does", () => {
    const m = emu(1);
    const z = createZ({ model: 1 });
    expect(z.columns32).toBe(false);
    z.out(0xff, 0x08);
    expect(z.columns32).toBe(true);
    z.out(0xff, 0x00);
    expect(z.columns32).toBe(false);
    z.out(0xff, 0x04); // the motor bit, not the width
    expect(z.columns32).toBe(false);
    const bad = [];
    for (let v = 0; v < 256; v++) {
      m.io.out(0xff, v);
      z.out(0xff, v);
      if (z.modeRegister !== m.system.io.modeRegister) bad.push(`out $FF,$${hex(v, 2)}: mode register ${hex(z.modeRegister, 2)}, emu ${hex(m.system.io.modeRegister, 2)}`);
      if (z.columns32 !== (m.video.columns === 32)) bad.push(`out $FF,$${hex(v, 2)}: columns32 ${z.columns32}`);
      if (z.in(0xff) !== m.io.in(0xff)) bad.push(`out $FF,$${hex(v, 2)}: in $FF is ${hex(z.in(0xff), 2)}, emu ${hex(m.io.in(0xff), 2)}`);
    }
    expect(bad).toEqual([]);
  });

  it("follows the 32-column bit on the Model III's port $EC (bit 2), and not on $FF, as emu does", () => {
    const m = emu(3);
    const z = createZ({ model: 3 });
    expect(z.columns32).toBe(false);
    z.out(0xec, 0x04);
    expect(z.columns32).toBe(true);
    z.out(0xff, 0x00); // port $FF does not touch the mode register
    expect(z.columns32).toBe(true);
    z.out(0xec, 0x00);
    expect(z.columns32).toBe(false);
    z.out(0xff, 0x04);
    z.out(0xff, 0x08);
    expect(z.columns32).toBe(false);
    const bad = [];
    for (let v = 0; v < 256; v++) {
      // $EC-$EF are one mode register
      const port = 0xec + (v & 3);
      m.io.out(port, v);
      z.out(port, v);
      if (z.modeRegister !== m.system.io.modeRegister) bad.push(`out $${hex(port, 2)},$${hex(v, 2)}: mode register ${hex(z.modeRegister, 2)}, emu ${hex(m.system.io.modeRegister, 2)}`);
      if (z.columns32 !== (m.video.columns === 32)) bad.push(`out $${hex(port, 2)},$${hex(v, 2)}: columns32 ${z.columns32}`);
      if (z.in(0xff) !== m.io.in(0xff)) bad.push(`out $${hex(port, 2)},$${hex(v, 2)}: in $FF is ${hex(z.in(0xff), 2)}, emu ${hex(m.io.in(0xff), 2)}`);
      for (let p = 0xec; p <= 0xef; p++) if (z.in(p) !== m.io.in(p)) bad.push(`in $${hex(p, 2)}: ${hex(z.in(p), 2)}, emu ${hex(m.io.in(p), 2)}`);
    }
    expect(bad).toEqual([]);
  });

  it.each([1, 3])("reads port $FF at reset as emu's model %i does", (model) => {
    expect(createZ({ model }).in(0xff)).toBe(emu(model).io.in(0xff));
  });

  it.each([1, 3])("models port $FF and, on the Model III, $EC-$EF and a read of $00; any other port throws a sentence naming it (model %i)", (model) => {
    const z = createZ({ model });
    const modelled = (p, what) => p === 0xff || (model === 3 && p >= 0xec && p <= 0xef) || (model === 3 && p === 0x00 && what === 'in');
    const bad = [];
    for (let p = 0; p < 256; p++) {
      for (const [what, call] of [['in', () => z.in(p)], ['out', () => z.out(p, 0)]]) {
        const msg = thrown(call);
        const ok = modelled(p, what) ? msg === null : msg !== null && msg.startsWith(`the port does not model $${hex(p, 2)} `);
        if (!ok) bad.push(`${what} $${hex(p, 2)}: ${msg}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("reads port $00 on the Model III as emu does: no device answers it, so $FF (Sea Dragon's joystick read)", () => {
    expect(createZ({ model: 3 }).in(0x00)).toBe(emu(3).io.in(0x00));
    expect(createZ({ model: 3 }).in(0x00)).toBe(0xff);
  });

  it('names $84 on the Model III, and $EC on the Model I, in a sentence', () => {
    expect(() => createZ({ model: 3 }).in(0x84)).toThrow(/^the port does not model \$84 \(.*\)$/);
    expect(() => createZ({ model: 3 }).out(0x84, 1)).toThrow(/\$84/);
    expect(() => createZ({ model: 1 }).in(0xec)).toThrow(/^the port does not model \$EC \(.*\)$/);
    expect(() => createZ({ model: 1 }).out(0xec, 1)).toThrow(/\$EC/);
    // The port number is the low byte only, as IN and OUT put it on the bus
    expect(() => createZ({ model: 3 }).in(0x1284)).toThrow(/\$84/);
  });
});

describe("the 'flat' machine", () => {
  it('reads and writes all 64K plainly: no ROM, no keyboard, no video gate, no unmapped space', () => {
    const z = createZ({ model: 'flat' });
    const pattern = noise(5, 0x10000);
    for (let a = 0; a < 0x10000; a++) z.write(a, pattern[a]);
    const bad = [];
    for (let a = 0; a < 0x10000; a++) {
      if (z.read(a) !== pattern[a] || z.mem[a] !== pattern[a]) bad.push(`$${hex(a, 4)}`);
    }
    expect(bad).toEqual([]);
    expect(z.mem).toEqual(pattern);
    // A byte a Model I would gate, in the middle of what a TRS-80 would not let a write reach
    for (const addr of [0x0000, 0x2fff, 0x37e0, 0x3800, 0x3840, 0x3c00]) {
      z.write(addr, 0x61);
      expect(z.read(addr), `$${hex(addr, 4)}`).toBe(0x61);
    }
    z.press('SPACE');
    expect(z.read(0x3840)).toBe(z.mem[0x3840]); // not the matrix
  });

  it('has no ports to model: they float high and take no sentence', () => {
    const z = createZ({ model: 'flat' });
    for (let p = 0; p < 256; p++) expect(z.in(p)).toBe(0xff);
    expect(() => z.out(0x84, 1)).not.toThrow();
    expect(z.columns32).toBe(false);
  });
});
