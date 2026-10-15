import { describe, expect, it } from 'vitest';
import { loadBas } from '../src/bas.js';
import { loadCmd } from '../src/cmd.js';
import { renderPass1Listing } from '../src/listing.js';
import { analyze } from '../src/pipeline.js';
import { loadRaw } from '../src/raw.js';
import { BAS_FIXTURES, CMD_FIXTURES } from './fixtures.js';

const cmd = (name: string, entries?: number[]) =>
  renderPass1Listing(analyze(loadCmd(CMD_FIXTURES[name]!()), entries === undefined ? {} : { entries }), { source: `${name}.cmd` });

describe('analyze', () => {
  it('uses the module entry as the root and adds --entry addresses', () => {
    const a = analyze(loadCmd(CMD_FIXTURES['non-contiguous']!()), { entries: [0x7000] });
    expect(a.entry).toBe(0x6000);
    expect(a.roots).toEqual([0x6000, 0x7000]);
    expect(a.pass1.instructions.has(0x7000)).toBe(true);
  });

  it('diagnoses an unloaded extra entry', () => {
    const a = analyze(loadCmd(CMD_FIXTURES['non-contiguous']!()), { entries: [0x9000] });
    expect(a.pass1.diagnostics).toEqual([{ kind: 'unloaded-root', addr: 0x9000, message: 'entry $9000 is not in loaded memory' }]);
  });

  it('exposes the address END may carry: the transfer address, the raw base, or nothing', () => {
    expect(analyze(loadCmd(CMD_FIXTURES['non-contiguous']!())).transfer).toBe(0x6000);
    const lowest = analyze(loadCmd(CMD_FIXTURES['missing-02']!()));
    expect(lowest.entry).toBe(0x5200); // still the root
    expect(lowest.transfer).toBeNull(); // but the file had no transfer record
    expect(analyze(loadRaw(Uint8Array.from([0xc9]), 0x5200)).transfer).toBe(0x5200);
    expect(analyze(loadBas(BAS_FIXTURES['prog-62c8']!())).transfer).toBeNull();
  });

  it('has no roots for a BASIC program and for a module ended by 03', () => {
    expect(analyze(loadBas(BAS_FIXTURES['prog-62c8']!())).roots).toEqual([]);
    expect(analyze(loadCmd(CMD_FIXTURES['end-03']!())).roots).toEqual([]);
  });

  it('uses the raw base as the root', () => {
    expect(analyze(loadRaw(Uint8Array.from([0xc9]), 0x5200)).roots).toEqual([0x5200]);
  });
});

describe('renderPass1Listing', () => {
  it('prints the module header, a pass 1 line, blocks, and the listing with DB rows for unreached bytes', () => {
    const lines = cmd('non-contiguous').split('\n');
    expect(lines[0]).toBe('; non-contiguous.cmd: load module, 2 blocks, 2 runs, 14 bytes, entry $6000 (transfer address)');
    expect(lines[1]).toBe('; pass 1: roots $6000; 6 of 14 bytes reached (43%); 0 external targets; 0 notes');
    expect(lines).toContain('; block 0: $6000-$6005 (6 bytes)');
    expect(lines).toContain('        ORG 6000H');
    expect(lines).toContain('6000  21 00 3C      LD HL,3C00H             ; entry');
    expect(lines).toContain('6003  36 41         LD (HL),41H');
    expect(lines).toContain('6005  C9            RET');
    expect(lines).toContain('        ORG 7000H');
    expect(lines).toContain('7000  00 01 02 03   DB 00H,01H,02H,03H');
    expect(lines).toContain('7004  04 05 06 07   DB 04H,05H,06H,07H');
  });

  it('decodes the second run when --entry names it', () => {
    const lines = cmd('non-contiguous', [0x7000]).split('\n');
    // The eight pattern bytes at $7000 all decode as instructions, so everything is reached.
    expect(lines[1]).toBe('; pass 1: roots $6000, $7000; 14 of 14 bytes reached (100%); 0 external targets; 0 notes');
    expect(lines).toContain('7000  00            NOP                     ; entry');
    expect(lines).toContain('7001  01 02 03      LD BC,0302H');
  });

  it('says what to do when there are no roots', () => {
    const lines = cmd('end-03').split('\n');
    expect(lines[1]).toBe('; pass 1: no roots; use --entry <hex> or --sweep');
    expect(lines).toContain('5200  21 00 3C 36   DB 21H,00H,3CH,36H');
  });

  it('cuts DB rows at an instruction start and at the run end', () => {
    // The raw base is always a root; a RET there ends that path so the middle bytes stay unreached.
    const mod = loadRaw(Uint8Array.from([0xc9, 1, 2, 3, 4, 5, 0xc9]), 0x7000);
    const lines = renderPass1Listing(analyze(mod, { entries: [0x7006] }), { source: 'x.bin' }).split('\n');
    expect(lines[0]).toBe('; x.bin: raw binary, 7 bytes at $7000-$7006');
    expect(lines).toContain('7000  C9            RET                     ; entry');
    expect(lines).toContain('7001  01 02 03 04   DB 01H,02H,03H,04H');
    expect(lines).toContain('7005  05            DB 05H');
    expect(lines).toContain('7006  C9            RET                     ; entry');
  });

  it('lists diagnostics as notes and counts external targets', () => {
    const mod = loadRaw(Uint8Array.from([0xcd, 0x33, 0x00, 0x18, 0xfc]), 0x6000); // CALL 0033 ; JR 6001
    const lines = renderPass1Listing(analyze(mod), { source: 'x.bin' }).split('\n');
    expect(lines[1]).toBe('; pass 1: roots $6000; 5 of 5 bytes reached (100%); 1 external target; 1 note');
    expect(lines[2]).toBe('; note: target $6001 is inside the instruction at $6000');
  });
});
