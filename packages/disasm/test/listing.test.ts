import { describe, expect, it } from 'vitest';
import { loadBas } from '../src/bas.js';
import { loadCmd } from '../src/cmd.js';
import { renderBasListing, renderCmdListing, renderRawListing } from '../src/listing.js';
import { loadRaw } from '../src/raw.js';
import { BAS_FIXTURES, CMD_FIXTURES } from './fixtures.js';

const cmd = (name: string) => renderCmdListing(loadCmd(CMD_FIXTURES[name]!()), { source: `${name}.cmd` });

describe('renderCmdListing', () => {
  it('writes a header, one ORG per run, and address/bytes/mnemonic columns', () => {
    const text = cmd('non-contiguous');
    const lines = text.split('\n');
    expect(lines[0]).toBe('; non-contiguous.cmd: load module, 2 blocks, 2 runs, 14 bytes, entry $6000 (transfer address)');
    expect(lines).toContain('; block 0: $6000-$6005 (6 bytes)');
    expect(lines).toContain('; block 1: $7000-$7007 (8 bytes)');
    expect(lines).toContain('        ORG 6000H');
    expect(lines).toContain('        ORG 7000H');
    expect(lines).toContain('6000  21 00 3C      LD HL,3C00H             ; entry');
    expect(lines).toContain('6003  36 41         LD (HL),41H');
    expect(lines).toContain('6005  C9            RET');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('describes load-time patches from the overlap log', () => {
    const lines = cmd('overlap').split('\n');
    expect(lines).toContain('; block 1: $7004-$7006 (3 bytes) patches block 0 at $7004-$7006');
  });

  it('repeats loader warnings and names the entry source', () => {
    const lines = cmd('missing-02').split('\n');
    expect(lines[0]).toBe('; missing-02.cmd: load module, 2 blocks, 2 runs, 14 bytes, entry $5200 (lowest loaded address)');
    expect(lines).toContain('; warning: no transfer address record; using lowest loaded address $5200');
    const end03 = cmd('end-03').split('\n');
    expect(end03[0]).toBe('; end-03.cmd: load module, 1 block, 1 run, 6 bytes, no entry (03 record)');
  });

  it('shows the module name and copyright', () => {
    expect(cmd('header-05').split('\n')).toContain('; name: ASYLUM');
    expect(cmd('copyright-1f').split('\n')).toContain('; copyright: (C) 1981 MED SYSTEMS');
  });

  it('notes an entry point that falls inside an instruction', () => {
    const bytes = CMD_FIXTURES['non-contiguous']!().slice();
    bytes[bytes.length - 2] = 0x01; // transfer address $6001, inside LD HL,3C00H
    const lines = renderCmdListing(loadCmd(bytes)).split('\n');
    expect(lines).toContain('; note: entry $6001 falls inside the instruction at $6000 (linear sweep)');
  });
});

describe('renderRawListing', () => {
  it('lists a raw binary from its base with the entry there', () => {
    const lines = renderRawListing(loadRaw(Uint8Array.from([0x3e, 0x01, 0xc9]), 0x5200), { source: 'x.bin' }).split('\n');
    expect(lines[0]).toBe('; x.bin: raw binary, 3 bytes at $5200-$5202');
    expect(lines).toContain('        ORG 5200H');
    expect(lines).toContain('5200  3E 01         LD A,01H                ; entry');
    expect(lines).toContain('5202  C9            RET');
  });
});

describe('renderBasListing', () => {
  it('prints a header and one detokenized line per program line', () => {
    const prog = loadBas(BAS_FIXTURES['prog-62c8']!());
    const text = renderBasListing(prog, { source: 'prog-62c8.bas' });
    expect(text).toBe(
      [
        '; prog-62c8.bas: tokenized BASIC, 6 lines, saved from $62C8 to $635A, FF header, 0 unparsed',
        '10 CLS:PRINT"VOYAGE OF THE VALKYRIE"',
        '20 FOR I=1 TO 10:PRINT I;:NEXT',
        '30 X=PEEK(16548)+256*PEEK(16549)',
        '40 IF X>0 THEN GOSUB 100 ELSE END',
        '100 DATA 1,2,"A:B":RETURN',
        "250 ' END OF PROGRAM",
        '',
      ].join('\n'),
    );
  });

  it('reports unparsed lines with the body address and length', () => {
    const lines = renderBasListing(loadBas(BAS_FIXTURES['hidden-code']!())).split('\n');
    expect(lines[0]).toBe('; tokenized BASIC, 3 lines, saved from $7000 to $701A, FF header, 1 unparsed');
    expect(lines[1]).toBe('10 GOTO 30');
    expect(lines[2]).toBe('20 [unparsed: 7 bytes at $700D: embedded 00 at +1]');
    expect(lines[3]).toBe('30 END');
  });

  it('repeats loader warnings', () => {
    const lines = renderBasListing(loadBas(BAS_FIXTURES['trailing-bytes']!())).split('\n');
    expect(lines).toContain('; warning: 3 bytes after the program end ignored');
    expect(renderBasListing(loadBas(BAS_FIXTURES['no-header']!())).split('\n')[0]).toContain('no FF header');
  });
});
