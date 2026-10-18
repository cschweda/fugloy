/**
 * The synthetic session behind the committed label file fixture
 * (fixtures/synthetic/label-file/sample.labels.json): a small .CMD over a synthetic ROM, run with
 * coverage on to its HALT, with two user labels. Shared by label-file.test.js, which checks the
 * committed file against it, and scripts/write-label-fixture.mjs (`pnpm fixtures`), which writes it.
 */
import { Machine } from '../../src/index.js';

/** Records in order: { name } → 05, { addr, data } → 01, then 02 entry. */
export function buildCmd(records, entry) {
  const out = [];
  for (const r of records) {
    if (r.name !== undefined) out.push(0x05, r.name.length, ...[...r.name].map((c) => c.charCodeAt(0)));
    else out.push(0x01, (r.data.length + 2) & 0xff, r.addr & 0xff, r.addr >> 8, ...r.data);
  }
  out.push(0x02, 0x02, entry & 0xff, entry >> 8);
  return new Uint8Array(out);
}

/** A 14K ROM: HALT at $0000 and RET at $0008 (the RST 08H handler). */
export function sampleRom() {
  const rom = new Uint8Array(0x3800);
  rom[0x0000] = 0x76;
  rom[0x0008] = 0xc9;
  return rom;
}

/** Block 0, $7000..$703F: the code. */
const CODE = new Array(0x40).fill(0);
const place = (addr, bytes) => CODE.splice(addr - 0x7000, bytes.length, ...bytes);
place(0x7000, [0xf3]); //                 7000  DI
place(0x7001, [0x31, 0x00, 0x7f]); //     7001  LD SP,7F00H
place(0x7004, [0x06, 0x03]); //           7004  LD B,3
place(0x7006, [0xcd, 0x20, 0x70]); //     7006  CALL 7020H     taken 3×
place(0x7009, [0x10, 0xfb]); //           7009  DJNZ 7006H     taken 2×
place(0x700b, [0xcf]); //                 700B  RST 08H        to the ROM's RET
place(0x700c, [0x3a, 0x40, 0x70]); //     700C  LD A,(7040H)
place(0x700f, [0x32, 0x41, 0x70]); //     700F  LD (7041H),A
place(0x7012, [0xcd, 0x30, 0x70]); //     7012  CALL 7030H
place(0x7015, [0xcd, 0x30, 0x70]); //     7015  CALL 7030H     a second site
place(0x7018, [0x76]); //                 7018  HALT
place(0x7020, [0x21, 0x40, 0x70]); //     7020  LD HL,7040H
place(0x7023, [0x7e]); //                 7023  LD A,(HL)
place(0x7024, [0xc9]); //                 7024  RET
place(0x7030, [0xc3, 0x34, 0x70]); //     7030  JP 7034H
//                                        7033  (a byte never run)
place(0x7034, [0xc9]); //                 7034  RET

/** The sample program's .CMD bytes: name SAMPLE, the code block, a two-byte data block at $7040, entry $7000. */
export function sampleCmd() {
  return buildCmd([{ name: 'SAMPLE' }, { addr: 0x7000, data: CODE }, { addr: 0x7040, data: [0x12, 0x34] }], 0x7000);
}

/** The sample session's Machine: loaded, coverage on, run to the HALT, two user labels added. */
export function sampleMachine() {
  const m = new Machine({ roms: { level2: sampleRom() } });
  m.load.cmd(sampleCmd());
  m.debug.coverage.enable();
  const r = m.run({ until: 'halt', cycles: 100000 });
  if (r.reason !== 'halt') throw new Error(`the sample program did not halt: ${JSON.stringify(r)}`);
  m.debug.label(0x7040, 'SCORE', { kind: 'data', size: 2 });
  m.debug.label(0x7034, 'BUMP');
  return m;
}

/** The fixture's object: the sample session's label file (no `started`, so it is deterministic). */
export function sampleLabelFile() {
  return sampleMachine().debug.labelFile({ input: 'none: the program reads no keys' });
}

/** The fixture's text, as written to disk. */
export function sampleLabelText() {
  return `${JSON.stringify(sampleLabelFile(), null, 2)}\n`;
}
