/**
 * Emu phase 6b, Task 3: on the Model 4, coverage is kept per (map, page) (spec §8, plan Ruling 3):
 * one bitfield for each memory map (port $84 bits 0-1) and 128K page select (bits 4-6) the
 * machine has run in, written to the label file as its own `"<map>:<page>"` key, which parses
 * back, merges, and is read by the disassembler as `"0:0"` with a warning for the others.
 * Synthetic ROMs throughout.
 */
import { describe, expect, it } from 'vitest';
import { openProgram, parseLabelFile as parseInDisasm, renderSession, withLabelFile } from '@fugloy/disasm';
import { COVERAGE, Machine, decodeRle, mergeLabelFiles, parseLabelFile } from '../../src/index.js';
import { buildCmd, sampleRom } from './label-sample.js';

const { EXEC, OPERAND, WRITE } = COVERAGE;

/**
 * A 14K ROM that switches to map 3 with page 2 (bit 5 on, bit 4 off: bank 2 in place of the
 * high 32K), runs a few instructions from RAM there, and switches back to map 0 to halt in ROM:
 *   0000  LD A,23H / OUT (84H),A        → map 3, page 2; PC 0004 is now bank 0's RAM
 *   0004  LD HL,9000H / LD (HL),A       (RAM) a write to bank 2
 *   0008  LD A,00H / OUT (84H),A        (RAM) → map 0; PC 000C is the ROM again
 *   000C  HALT                          (ROM)
 */
function switcher(ram = 128) {
  const rom = new Uint8Array(0x3800).fill(0xc9);
  rom.set([0x3e, 0x23, 0xd3, 0x84], 0x0000);
  rom[0x000c] = 0x76;
  const m = new Machine({ model: 4, ram, roms: { level2: rom } });
  // Bank 0 holds the RAM half of the program at $0004.
  m.mem.ram.set([0x21, 0x00, 0x90, 0x77, 0x3e, 0x00, 0xd3, 0x84], 0x0004);
  return m;
}

const bit = (field, a) => decodeRle(field)[a];

describe('coverage keyed by map and page (the Model 4)', () => {
  it('a bank switch moves what is recorded to the (map, page) in force', () => {
    const m = switcher();
    m.debug.coverage.enable();
    expect(m.run({ until: 'halt', cycles: 1000 }).reason).toBe('halt');
    expect(m.debug.coverage.keys).toEqual(['0:0', '3:2']);
    const low = /** @type {Uint8Array} */ (m.debug.coverage.bitsOf('0:0'));
    const paged = /** @type {Uint8Array} */ (m.debug.coverage.bitsOf('3:2'));
    // Map 0: the ROM's switch and the HALT; nothing that ran in map 3.
    expect(low[0x0000] & EXEC).toBe(EXEC);
    expect(low[0x0003] & OPERAND).toBe(OPERAND);
    expect(low[0x000c] & EXEC).toBe(EXEC);
    expect(low[0x0004]).toBe(0);
    expect(low[0x9000]).toBe(0);
    // Map 3, page 2: the RAM code and its write; nothing from the ROM.
    expect(paged[0x0004] & EXEC).toBe(EXEC);
    expect(paged[0x0007] & EXEC).toBe(EXEC);
    expect(paged[0x000a] & EXEC).toBe(EXEC); // the OUT that switches back is recorded where it ran
    expect(paged[0x9000] & WRITE).toBe(WRITE);
    expect(paged[0x0000]).toBe(0);
    expect(paged[0x000c]).toBe(0);
    // `bits` is the bitfield in force now (map 0 after the switch back).
    expect(m.debug.coverage.bits).toBe(low);
    expect(m.mem.ram[2 * 0x8000 + 0x1000]).toBe(0x23); // the write went to bank 2
  });

  it('with 64K the page bits do nothing, and so key nothing', () => {
    const m = switcher(64);
    m.debug.coverage.enable();
    m.run({ until: 'halt', cycles: 1000 });
    expect(m.debug.coverage.keys).toEqual(['0:0', '3:0']);
  });

  it('clear empties every key and forgets all but "0:0" and the one in force', () => {
    const m = switcher();
    m.debug.coverage.enable();
    m.run({ until: 'halt', cycles: 1000 });
    const low = m.debug.coverage.bitsOf('0:0');
    m.debug.coverage.clear();
    expect(m.debug.coverage.keys).toEqual(['0:0']);
    expect(m.debug.coverage.bitsOf('0:0')).toBe(low);
    expect(low.every((v) => v === 0)).toBe(true);
    expect(m.debug.coverage.bitsOf('3:2')).toBeUndefined();
    expect(m.debug.coverage.bitsOf('nonsense')).toBeUndefined();
  });

  it('the Model III keeps the single key "0:0" whatever is written to port $84', () => {
    const m = new Machine({ roms: { level2: sampleRom() } });
    m.debug.coverage.enable();
    m.io.out(0x84, 0x23);
    m.run({ until: 'halt', cycles: 100 });
    expect(m.debug.coverage.keys).toEqual(['0:0']);
    expect(Object.keys(m.debug.labelFile({ name: 'T' }).coverage)).toEqual(['0:0']);
  });
});

describe('the label file carries each (map, page) as its own key', () => {
  it('writes "0:0" first and each key with a bit set, and they parse back', () => {
    const m = switcher();
    m.debug.coverage.enable();
    m.run({ until: 'halt', cycles: 1000 });
    m.io.out(0x84, 0x02); // a map visited with nothing recorded (no instruction ran) is not written
    m.debug.coverage.bits; // eslint-disable-line no-unused-expressions -- reading it makes the key
    const file = m.debug.labelFile({ name: 'SWITCHER' });
    expect(file.program.model).toBe(4);
    expect(Object.keys(file.coverage)).toEqual(['0:0', '3:2']);
    expect(bit(file.coverage['0:0'].exec, 0x000c)).toBe(1);
    expect(bit(file.coverage['0:0'].exec, 0x0004)).toBe(0);
    expect(bit(file.coverage['3:2'].exec, 0x0004)).toBe(1);
    expect(bit(file.coverage['3:2'].write, 0x9000)).toBe(1);
    const text = JSON.stringify(file);
    const back = parseLabelFile(text);
    expect(back.errors).toEqual([]);
    expect(JSON.stringify(back.file)).toBe(text);
    // Merged with itself: the same keys, and a bit set in either stays set.
    const merged = mergeLabelFiles(file, JSON.parse(text));
    expect(Object.keys(merged.coverage)).toEqual(['0:0', '3:2']);
    expect(merged.coverage['3:2'].exec).toBe(file.coverage['3:2'].exec);
  });

  it('a merge writes the keys in the stated order ("0:0", then map, then page), not first seen', () => {
    const m = switcher();
    m.debug.coverage.enable();
    m.run({ until: 'halt', cycles: 1000 });
    const a = JSON.parse(JSON.stringify(m.debug.labelFile({ name: 'SWITCHER' })));
    expect(Object.keys(a.coverage)).toEqual(['0:0', '3:2']);
    // b: the same program with map 2, page 0 and map 1, page 5 visited instead.
    const b = JSON.parse(JSON.stringify(a));
    b.coverage = { '0:0': a.coverage['0:0'], '2:0': a.coverage['3:2'], '1:5': a.coverage['3:2'] };
    expect(Object.keys(mergeLabelFiles(a, b).coverage)).toEqual(['0:0', '1:5', '2:0', '3:2']);
    expect(Object.keys(mergeLabelFiles(b, a).coverage)).toEqual(['0:0', '1:5', '2:0', '3:2']);
  });

  it('a loaded byte is compared in the map it was loaded in, so another map adds no false write', () => {
    const rom = new Uint8Array(0x3800).fill(0xc9);
    rom[0] = 0x76;
    const m = new Machine({ model: 4, roms: { level2: rom } });
    m.load.cmd(buildCmd([{ name: 'LOADED' }, { addr: 0x7000, data: [0x11, 0x22, 0x33, 0x44] }], 0x7000));
    // Map 3 with page 6 (bank 2 in place of the low 32K), where $7000 is other RAM entirely.
    m.io.out(0x84, 0x63);
    m.mem.write(0x7000, [0x99]);
    let file = m.debug.labelFile();
    expect(file.coverage['0:0'].write).toBe('10000');
    expect(m.system.memory.mapRegister).toBe(0x63); // put back after the comparison
    // A loaded byte changed in its own map is marked.
    m.io.out(0x84, 0x00);
    m.mem.write(0x7001, [0x55]);
    m.io.out(0x84, 0x63);
    file = m.debug.labelFile();
    expect(file.coverage['0:0'].write).toBe('7001,1,8FFE');
  });

  it('the disassembler applies "0:0" and warns that the other keys are ignored', () => {
    const m = switcher();
    // A .CMD at $7000 whose code jumps to the ROM's switch: JP 0000H / (data) FF 00.
    const cmd = buildCmd([{ name: 'PAGED' }, { addr: 0x7000, data: [0xc3, 0x00, 0x00, 0xff, 0x00] }], 0x7000);
    m.load.cmd(cmd);
    m.debug.coverage.enable();
    expect(m.run({ until: 'halt', cycles: 1000 }).reason).toBe('halt');
    const file = m.debug.labelFile();
    expect(Object.keys(file.coverage)).toEqual(['0:0', '3:2']);
    expect(bit(file.coverage['0:0'].exec, 0x7000)).toBe(1);
    const { file: parsed, errors } = parseInDisasm(JSON.stringify(file));
    expect(errors).toEqual([]);
    const listing = renderSession(withLabelFile(openProgram(cmd, { name: 'paged.cmd' }), /** @type {any} */ (parsed), 'paged.labels.json'), 'listing');
    expect(listing).toContain('coverage for map 3, page 2 is ignored; only "0:0" applies to this machine');
  });
});
