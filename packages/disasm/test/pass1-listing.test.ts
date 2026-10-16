import { describe, expect, it } from 'vitest';
import { loadBas } from '../src/bas.js';
import { loadCmd } from '../src/cmd.js';
import { renderPass1Listing } from '../src/listing.js';
import { analyze } from '../src/pipeline.js';
import { loadRaw } from '../src/raw.js';
import { applyHints } from '../src/hints/apply.js';
import { BAS_FIXTURES, CMD_FIXTURES, HINT_FIXTURES } from './fixtures.js';

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
    // The jump target inside the instruction gets a synthesized symbol, emitted as EQU in source; the listing says so.
    expect(lines[2]).toBe('; symbol L6001 = $6001 (inside the instruction at $6000)');
    expect(lines[3]).toBe('; note: target $6001 is inside the instruction at $6000');
  });
});

describe('renderPass1Listing with hints and symbols', () => {
  const listing = () => {
    const mod = loadCmd(CMD_FIXTURES['hint-paths']!());
    const applied = applyHints(HINT_FIXTURES['hint-paths']!(), mod.image);
    const a = analyze(mod, {
      annotations: applied.annotations,
      hints: { source: 'hint-paths.hints', matched: applied.matched.length, unmatched: applied.unmatched.length, applied: 11, warnings: applied.warnings },
    });
    return renderPass1Listing(a, { source: 'hint-paths.cmd' }).split('\n');
  };

  it('summarises the hint file and lists symbols that sit inside instructions', () => {
    const lines = listing();
    expect(lines).toContain('; hints: hint-paths.hints: 1 block matched, 0 unmatched, 11 hints applied');
    expect(lines).toContain('; symbol MIDCALL = $6001 (inside the instruction at $6000)');
  });

  it('prints label lines before their rows and symbol names in operands', () => {
    const lines = listing();
    const i = lines.indexOf('PRINT:');
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toBe('6020  3E 41         LD A,41H');
    expect(lines).toContain('6000  CD 20 60      CALL PRINT              ; entry; call PRINT, then dispatch through the table');
    expect(lines).toContain('6003  21 40 60      LD HL,DATA_6040');
    expect(lines).toContain('6006  3A 50 60      LD A,(FLAGS)');
  });

  it('shows words and tables as DW rows and splits data rows at symbols and kind changes', () => {
    const lines = listing();
    expect(lines).toContain('DISPATCH:');
    expect(lines).toContain('6030  19 60 1B 60   DW L6019,L601B');
    expect(lines).toContain('6040  34 12 78 56   DW 1234H,5678H');
    expect(lines).toContain('6044  BB AA         DW 0AABBH');
    expect(lines).toContain('FLAGS:');
    expect(lines).toContain('6050  01 02 03 04   DB 01H,02H,03H,04H');
    expect(lines).toContain('6054  48 45 4C 4C   DB 48H,45H,4CH,4CH');
    expect(lines).toContain('605A  FF            DB 0FFH');
  });

  it('repeats apply warnings in the header', () => {
    const mod = loadCmd(CMD_FIXTURES['hint-paths']!());
    const a = analyze(mod, { hints: { source: 'x.hints', matched: 0, unmatched: 1, applied: 0, warnings: ['hint block 0 (length $0001, hash 0000000000000000) has no matching run; 2 hints skipped'] } });
    const lines = renderPass1Listing(a).split('\n');
    expect(lines).toContain('; hints: x.hints: 0 blocks matched, 1 unmatched, 0 hints applied');
    expect(lines).toContain('; warning: hint block 0 (length $0001, hash 0000000000000000) has no matching run; 2 hints skipped');
  });
});
