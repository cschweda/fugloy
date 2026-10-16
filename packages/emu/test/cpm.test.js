import { describe, expect, it } from 'vitest';
import { runCpm } from './cpm.js';
import { runZexGroup, zexBinary, zexGroups } from './zex.js';

describe('the CP/M harness', () => {
  it('prints with BDOS 9 up to the $ and with BDOS 2 from E, and ends at a jump to 0000H', () => {
    // 0100 LD DE,0112H / LD C,9 / CALL 5 / LD E,'!' / LD C,2 / CALL 5 / JP 0 / 0112 DB 'HI$'
    const program = Uint8Array.from([
      0x11, 0x12, 0x01, 0x0e, 0x09, 0xcd, 0x05, 0x00, 0x1e, 0x21, 0x0e, 0x02, 0xcd, 0x05, 0x00, 0xc3, 0x00, 0x00,
      0x48, 0x49, 0x24,
    ]);
    expect(runCpm(program)).toMatchObject({ output: 'HI!', exited: true });
  });

  it('gives up after maxTStates when the program never ends', () => {
    // 0100 JR 0100H
    expect(runCpm(Uint8Array.from([0x18, 0xfe]), { maxTStates: 1000 })).toMatchObject({ exited: false });
  });
});

const zexdoc = zexBinary('zexdoc.com');

describe('the exerciser runner (pnpm zex:install)', () => {
  it.skipIf(zexdoc === null)('finds the 67 groups and their names in the binary', () => {
    const groups = zexGroups(zexdoc);
    expect(groups).toHaveLength(67);
    expect(groups[0].name).toBe('<adc,sbc> hl,<bc,de,hl,sp>');
    expect(groups[66]).toMatchObject({ name: 'ld (<bc,de>),a', label: 'ld (<bc,de>),a................' });
  });

  it.skipIf(zexdoc === null)('runs one group alone and returns its result line', () => {
    expect(runZexGroup(zexdoc, 66)).toBe('ld (<bc,de>),a................  OK');
  });
});
