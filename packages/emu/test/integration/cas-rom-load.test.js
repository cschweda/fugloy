/**
 * m.load.cas via 'rom' on the Model III ROM: the tape goes in the deck and the ROM's own loader
 * reads it. A SYSTEM tape at 500 baud through SYSTEM, the *? prompt, the name, then `/`; a BASIC
 * tape at 1500 baud through CLOAD and RUN. Each boot answers Cass? with the matching rate
 * (L for 500, ENTER for 1500), as test/integration/cassette-tape.test.js does.
 */
import { describe, expect, it } from 'vitest';
import { Machine } from '../../src/index.js';
import { configuredRom, ROM_TEST_TIMEOUT } from '../rom.js';
import { buildBasicCas, buildSystemCas, T_PRINT } from '../unit/cas-builders.js';

const rom = configuredRom('model3');

/** A Model III at READY, its Cass? prompt answered "" (ENTER: H, 1500 baud) or "L" (500 baud). */
function bootToReady(cassAnswer) {
  const m = new Machine({ roms: { level2: rom } });
  const sys = m.system;
  sys.runSeconds(1);
  if (cassAnswer) sys.typeText(cassAnswer);
  sys.typeText('\n');
  sys.runSeconds(0.5);
  sys.typeText('\n'); // Memory Size?
  sys.runSeconds(2);
  expect(screen(m)).toContain('READY');
  return m;
}

const screen = (m) => m.video.text().join('\n');

// LD A,'O' / LD ($3C00),A / LD A,'K' / LD ($3C01),A / JR $
const PROGRAM = [0x3e, 0x4f, 0x32, 0x00, 0x3c, 0x3e, 0x4b, 0x32, 0x01, 0x3c, 0x18, 0xfe];

describe.skipIf(rom === null)("m.load.cas via 'rom' on the Model III ROM", { timeout: ROM_TEST_TIMEOUT }, () => {
  it('a SYSTEM tape at 500 baud loads through SYSTEM, *?, the name, and /, then runs', () => {
    const m = bootToReady('L');
    const manifest = m.load.cas(buildSystemCas([{ addr: 0x7000, data: PROGRAM }], 0x7000, { name: 'HELLO' }), { baud: 500 });
    expect(manifest).toEqual({ format: 'cas', kind: 'system', name: 'HELLO', entry: 0x7000, blocks: [{ addr: 0x7000, len: PROGRAM.length, why: 'block 3C' }], baud: 500, via: 'rom' });
    const sys = m.system;
    sys.typeText('SYSTEM\n');
    sys.runSeconds(0.5);
    expect(screen(m)).toMatch(/\*\?\s*$/m);
    sys.typeText('HELLO\n');
    sys.runSeconds(10);
    expect([...m.mem.read(0x7000, PROGRAM.length)]).toEqual(PROGRAM); // the ROM read the tape
    expect(m.cassette.motor).toBe(false);
    expect(screen(m).match(/\*\?/g)?.length).toBe(2); // asks again, for the / that runs it
    sys.typeText('/\n');
    sys.runSeconds(0.5);
    expect(m.cpu.regs.pc).toBe(0x700a);
    expect(screen(m).startsWith('OK')).toBe(true);
  });

  it('a BASIC tape at 1500 baud loads through CLOAD, then RUN shows its output', () => {
    const m = bootToReady('');
    // 10 PRINT "FROM TAPE"
    const tokens = [T_PRINT, 0x20, 0x22, ...[...'FROM TAPE'].map((c) => c.charCodeAt(0)), 0x22];
    const manifest = m.load.cas(buildBasicCas([{ lineNo: 10, tokens }], { name: 'A' }), { baud: 1500 });
    const txttab = m.system.memory.readWord(0x40a4);
    expect(manifest).toEqual({ format: 'cas', kind: 'basic', name: 'A', blocks: [{ addr: txttab, len: 5 + tokens.length + 2, why: 'BASIC program' }], baud: 1500, via: 'rom' });
    const sys = m.system;
    sys.typeText('CLOAD\n');
    sys.runSeconds(10);
    expect(screen(m)).toContain('READY');
    expect(m.system.memory.readWord(0x40f9)).toBe(txttab + manifest.blocks[0].len); // where the manifest said
    sys.typeText('RUN\n');
    sys.runSeconds(1);
    expect(screen(m)).toContain('FROM TAPE');
  });
});
