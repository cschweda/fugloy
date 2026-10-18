/**
 * The synthetic Model III session behind the committed state fixture
 * (fixtures/synthetic/emu/model3-state.json): a 14K synthetic ROM that unmasks the 30 Hz RTC,
 * sets 32-column mode, prints a byte, and loops reading the keyboard into RAM, walking video RAM,
 * writing (ignored) into the ROM and keyboard regions, counting at $FFFF, and toggling port $FF;
 * its IM 1 handler at $0038 acknowledges the RTC and counts ticks at $4101. A key is held for
 * part of the run. The fixture is the session's `serializeState`, the SHA-256 of the whole 64K
 * as the CPU reads it, and the screen text.
 *
 * It was captured from the code before emu phase 6 factored the machine by model, so the test
 * `the Model III is unchanged` (model1.test.js) proves that refactor left the Model III
 * byte-identical. scripts/write-model3-state-fixture.mjs (`pnpm fixtures`) writes it; rewrite it
 * only for an intended change to the Model III.
 */
import { Machine, serializeState } from '../../src/index.js';
import { sha256Hex } from '../../src/machine/sha256.js';

/** The session's 14K ROM. */
export function model3SampleRom() {
  const rom = new Uint8Array(0x3800);
  const at = (addr, bytes) => rom.set(bytes, addr);
  at(0x0000, [0xf3]); //                0000  DI
  at(0x0001, [0x31, 0x00, 0xff]); //    0001  LD SP,FF00H
  at(0x0004, [0xed, 0x56]); //          0004  IM 1
  at(0x0006, [0x3e, 0x04]); //          0006  LD A,04H
  at(0x0008, [0xd3, 0xe0]); //          0008  OUT (E0H),A    unmask the RTC
  at(0x000a, [0x3e, 0x04]); //          000A  LD A,04H
  at(0x000c, [0xd3, 0xec]); //          000C  OUT (ECH),A    32-column mode
  at(0x000e, [0x3e, 0x41]); //          000E  LD A,'A'
  at(0x0010, [0xd3, 0xf8]); //          0010  OUT (F8H),A    the printer
  at(0x0012, [0xfb]); //                0012  EI
  at(0x0013, [0x21, 0x00, 0x3c]); //    0013  LD HL,3C00H
  at(0x0016, [0x3a, 0x01, 0x38]); //    0016  LD A,(3801H)   keyboard row 0
  at(0x0019, [0x32, 0x00, 0x40]); //    0019  LD (4000H),A
  at(0x001c, [0x34]); //                001C  INC (HL)
  at(0x001d, [0x23]); //                001D  INC HL
  at(0x001e, [0x7c]); //                001E  LD A,H
  at(0x001f, [0xe6, 0x03]); //          001F  AND 03H
  at(0x0021, [0xf6, 0x3c]); //          0021  OR 3CH          HL stays in $3C00-$3FFF
  at(0x0023, [0x67]); //                0023  LD H,A
  at(0x0024, [0x32, 0x00, 0x10]); //    0024  LD (1000H),A   ROM: ignored
  at(0x0027, [0x32, 0x00, 0x39]); //    0027  LD (3900H),A   keyboard: ignored
  at(0x002a, [0x3a, 0xff, 0xff]); //    002A  LD A,(FFFFH)
  at(0x002d, [0x3c]); //                002D  INC A
  at(0x002e, [0x32, 0xff, 0xff]); //    002E  LD (FFFFH),A
  at(0x0031, [0xd3, 0xff]); //          0031  OUT (FFH),A
  at(0x0033, [0x18, 0xe1]); //          0033  JR 0016H
  at(0x0038, [0xf5]); //                0038  PUSH AF
  at(0x0039, [0xdb, 0xec]); //          0039  IN A,(ECH)     acknowledge the RTC
  at(0x003b, [0x3a, 0x01, 0x41]); //    003B  LD A,(4101H)
  at(0x003e, [0x3c]); //                003E  INC A
  at(0x003f, [0x32, 0x01, 0x41]); //    003F  LD (4101H),A
  at(0x0042, [0xf1]); //                0042  POP AF
  at(0x0043, [0xfb]); //                0043  EI
  at(0x0044, [0xed, 0x4d]); //          0044  RETI
  return rom;
}

/** Run the session on a fresh Model III and return what the fixture holds. */
export function model3SampleState() {
  const m = new Machine({ roms: { level2: model3SampleRom() } });
  m.run({ cycles: 300000 });
  m.keyboard.press('A');
  m.run({ cycles: 200000 });
  m.keyboard.release('A');
  m.run({ cycles: 150000 });
  return {
    state: serializeState(m.system),
    memory64k: sha256Hex(m.mem.read(0, 0x10000)),
    screen: m.video.text(),
  };
}

/** The fixture file's text. */
export function model3SampleText() {
  return `${JSON.stringify(model3SampleState(), null, 2)}\n`;
}
